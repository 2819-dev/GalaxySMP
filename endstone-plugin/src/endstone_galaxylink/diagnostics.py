"""Diagnostics: sends the server console, errors and health readings to the website, for troubleshooting.

- Console: every new line of logs/latest.log (the same as the hosting panel's console), sent every 15 seconds.
  Lines are kept while the website is unreachable and sent once it's back. Kept 3 days on the website.
- Errors: error lines and Python tracebacks, grouped (the same error = one entry with a count), with the full
  details. Kept 30 days.
- Health, every minute: lag (TPS / ms per tick), players, memory (and the host's memory limit, its peak, and
  whether the host killed anything for using too much), CPU (and whether the host is slowing the server
  down), disk space, slow plugin tasks.
- Start and stop: versions, the host's limits, and whether the machine or the container was restarted.
Nothing here is shown on the website; it's stored for the Owner and for troubleshooting.
"""

import hashlib
import os
import re
import shutil
import sys
import threading
import time
import traceback
from collections import deque
from pathlib import Path

SEND_SECONDS = 15
HEALTH_SECONDS = 60
MAX_PENDING = 3000         # console lines kept while the website is unreachable
MAX_BATCH = 400            # lines per message
LINE_CHARS = 4000          # a traceback is one "line" with several rows
SLOW_TASK_MS = 250

PREFIX = re.compile(r"^\[(\d{1,2}):(\d{2}):(\d{2})(?:[.:,]\d+)?[^\]]*\]\s*\[([^\]/]+)/([A-Za-z]+)\]:?\s?(.*)$")
ERROR_LEVELS = {"ERROR", "CRITICAL", "SEVERE", "FATAL"}


# ---------- reading the host (Linux /proc and cgroups); every helper returns None when it can't tell ----------
def _read(path):
    try:
        with open(path) as fh:
            return fh.read().strip()
    except Exception:
        return None


def _num(path):
    v = _read(path)
    if v is None or v == "max":
        return None
    try:
        return int(v.split()[0])
    except Exception:
        return None


def _kv(path):
    v = _read(path)
    out = {}
    for line in (v or "").splitlines():
        parts = line.split()
        if len(parts) >= 2:
            try:
                out[parts[0]] = int(parts[1])
            except ValueError:
                pass
    return out


def boot_time():
    """When the whole machine started (seconds since 1970)."""
    for line in (_read("/proc/stat") or "").splitlines():
        if line.startswith("btime "):
            return int(line.split()[1])
    return None


def container_start():
    """When this container started: the start time of process 1 (the container's first process)."""
    stat = _read("/proc/1/stat")
    bt = boot_time()
    if not stat or bt is None:
        return None
    try:
        fields = stat[stat.rindex(")") + 2:].split()
        ticks = int(fields[19])  # field 22 (starttime), counted after the name
        return round(bt + ticks / os.sysconf("SC_CLK_TCK"))
    except Exception:
        return None


def cgroup_memory():
    ev = _kv("/sys/fs/cgroup/memory.events")
    mb = lambda b: round(b / 1048576) if b else None
    out = {
        "peakMB": mb(_num("/sys/fs/cgroup/memory.peak") or _num("/sys/fs/cgroup/memory/memory.max_usage_in_bytes")),
        "swapMB": mb(_num("/sys/fs/cgroup/memory.swap.current")),
        "oomKills": ev.get("oom_kill") if ev else _kv("/sys/fs/cgroup/memory/memory.oom_control").get("oom_kill"),
        "nearLimit": ev.get("high") if ev else None,
    }
    return {k: v for k, v in out.items() if v is not None}


def cpu_stat():
    s = _kv("/sys/fs/cgroup/cpu.stat")
    if s:
        return {"usage": s.get("usage_usec", 0) / 1e6, "throttledN": s.get("nr_throttled", 0), "throttled": s.get("throttled_usec", 0) / 1e6}
    usage = _num("/sys/fs/cgroup/cpuacct/cpuacct.usage")
    if usage is not None:
        t = _kv("/sys/fs/cgroup/cpu/cpu.stat")
        return {"usage": usage / 1e9, "throttledN": t.get("nr_throttled", 0), "throttled": t.get("throttled_time", 0) / 1e9}
    return None


def cpu_limit():
    v = _read("/sys/fs/cgroup/cpu.max")
    if v:
        q, p = (v.split() + ["100000"])[:2]
        return None if q == "max" else round(int(q) / int(p), 2)
    q, p = _num("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"), _num("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
    return round(q / p, 2) if q and p and q > 0 else None


class Diagnostics:
    def __init__(self, plugin):
        self.plugin = plugin
        self.log_file = Path.cwd() / "logs" / "latest.log"
        self.offset = 0
        self.partial = b""
        self.pending = deque(maxlen=MAX_PENDING)
        self.dropped = 0
        self.record = None              # the log entry being read (an entry can span several lines)
        self.errors = {}                # signature -> {level, message, detail, count, first, last}
        self.slow = {}                  # task -> [count, worst ms]
        self.last_send = 0
        self.last_health = 0
        self.last_read = 0
        self.cpu_prev = (time.time(), cpu_stat())
        self.start_info = self._start_info()
        self.sent_start = False
        prev_hook = threading.excepthook

        def thread_hook(args):  # a background thread that dies would otherwise fail silently
            try:
                tb = "".join(traceback.format_exception(args.exc_type, args.exc_value, args.exc_traceback))
                plugin.logger.error(f"A background task stopped with an error (thread {getattr(args.thread, 'name', '?')}):\n{tb}")
            except Exception:
                pass
            try:
                prev_hook(args)
            except Exception:
                pass
        threading.excepthook = thread_hook

    # ---------- start ----------
    def _start_info(self):
        s = self.plugin.server
        info = {}
        for key, fn in (("endstone", lambda: str(s.version)), ("minecraft", lambda: str(s.minecraft_version)),
                        ("plugin", lambda: str(self.plugin.description.version)), ("python", lambda: sys.version.split()[0]),
                        ("system", lambda: " ".join(os.uname()[i] for i in (0, 2, 4))), ("host", lambda: os.uname()[1][:40]),
                        ("bootTime", boot_time), ("containerStart", container_start), ("cpuLimit", cpu_limit),
                        ("cpus", os.cpu_count), ("init", lambda: os.path.basename((_read("/proc/1/cmdline") or "").split("\x00")[0])[:60]),   # only the program's name (the full command can hold secrets)
                        ("diskFreeMB", lambda: round(shutil.disk_usage(Path.cwd()).free / 1048576))):
            try:
                v = fn()
                if v not in (None, ""):
                    info[key] = v
            except Exception:
                pass
        try:
            from endstone_galaxylink.crashwatch import memory
            info["memory"] = memory()
        except Exception:
            pass
        info["cgroup"] = cgroup_memory()
        return info

    # ---------- every second (from the plugin's 1-second task) ----------
    def tick(self):
        now = time.time()
        if now - self.last_read >= 5:
            self.last_read = now
            try:
                self.read_log()
            except Exception:
                pass
        if now - self.last_health >= HEALTH_SECONDS:
            self.last_health = now
            try:
                self.health()
            except Exception:
                pass
        if now - self.last_send >= SEND_SECONDS:
            self.last_send = now
            self.flush()

    def timed(self, what, ms):
        """A plugin task took `ms` milliseconds (only slow ones are noted)."""
        if ms >= SLOW_TASK_MS:
            c = self.slow.setdefault(what, [0, 0])
            c[0] += 1
            c[1] = max(c[1], round(ms))

    # ---------- the console ----------
    def read_log(self):
        try:
            size = self.log_file.stat().st_size
        except Exception:
            return
        if size < self.offset:            # a new log file (the server restarted it)
            self.offset, self.partial = 0, b""
        if size == self.offset:
            self._finish_record_if_old()
            return
        with open(self.log_file, "rb") as fh:
            fh.seek(self.offset)
            data = fh.read(min(size - self.offset, 2_000_000))
        self.offset += len(data)
        data = self.partial + data
        lines = data.split(b"\n")
        self.partial = lines.pop()        # an unfinished last line waits for the next read
        for raw in lines:
            self._line(raw.decode("utf-8", "replace").rstrip("\r"))
        self._finish_record_if_old()

    def _line(self, text):
        if not text.strip():
            return
        m = PREFIX.match(text)
        if m:
            self._finish_record()
            hh, mm, ss, thread, level, msg = m.groups()
            t = time.localtime()
            try:
                at = time.mktime((t.tm_year, t.tm_mon, t.tm_mday, int(hh), int(mm), int(ss), 0, 0, -1))
                if at > time.time() + 600:  # just after midnight: the line is from yesterday
                    at -= 86400
            except Exception:
                at = time.time()
            self.record = {"at": at, "level": level.upper(), "thread": thread, "text": msg, "seen": time.time()}
        elif self.record is not None:     # a continuation (for example the rest of a traceback)
            if len(self.record["text"]) < LINE_CHARS:
                self.record["text"] += "\n" + text
        else:
            self.record = {"at": time.time(), "level": "INFO", "thread": "", "text": text, "seen": time.time()}

    def _finish_record_if_old(self):
        if self.record and time.time() - self.record["seen"] > 4:
            self._finish_record()

    def _finish_record(self):
        r, self.record = self.record, None
        if not r:
            return
        text = r["text"][:LINE_CHARS]
        if len(self.pending) == self.pending.maxlen:
            self.dropped += 1
        self.pending.append([int(r["at"] * 1000), r["level"], f"[{r['thread']}] {text}" if r["thread"] else text])
        if r["level"] in ERROR_LEVELS or "Traceback (most recent call last)" in text:
            self._error(r["level"], text, r["at"])

    # ---------- errors ----------
    @staticmethod
    def signature(level, text):
        rows = [x for x in text.splitlines() if x.strip()]
        first = rows[0] if rows else ""
        last = rows[-1] if rows else ""
        where = ""
        for x in rows:
            m = re.search(r'File "([^"]+)", line (\d+)', x)
            if m:
                where = f"{Path(m.group(1)).name}:{m.group(2)}"   # the deepest place in the traceback
        norm = lambda s: re.sub(r"0x[0-9a-fA-F]+|\d+|'[^']*'|\"[^\"]*\"", "#", s)[:200]
        return hashlib.sha1(f"{level}|{norm(first)}|{norm(last)}|{where}".encode()).hexdigest()[:16]

    def _error(self, level, text, at):
        sig = self.signature(level, text)
        e = self.errors.get(sig)
        if e:
            e["count"] += 1
            e["last"] = at
        else:
            rows = [x for x in text.splitlines() if x.strip()]
            msg = rows[-1] if len(rows) > 1 and "Traceback" in text else (rows[0] if rows else "")
            self.errors[sig] = {"sig": sig, "level": level, "message": msg[:300], "detail": text[:LINE_CHARS], "count": 1, "first": at, "last": at}

    # ---------- health ----------
    def health(self):
        s = self.plugin.server
        h = {"t": int(time.time() * 1000)}
        for key, attr in (("tps", "current_tps"), ("avgTps", "average_tps"), ("mspt", "current_mspt"), ("avgMspt", "average_mspt"), ("tickUse", "average_tick_usage")):
            try:
                h[key] = round(float(getattr(s, attr)), 2)
            except Exception:
                pass
        try:
            h["players"] = len(s.online_players)
        except Exception:
            pass
        try:
            h["entities"] = len(s.level.actors)
        except Exception:
            pass
        try:
            from endstone_galaxylink.crashwatch import memory
            h["memory"] = memory()
        except Exception:
            pass
        h["cgroup"] = cgroup_memory()
        now, cur = time.time(), cpu_stat()
        t0, prev = self.cpu_prev
        if cur and prev and now > t0:
            span = now - t0
            h["cpuPct"] = round((cur["usage"] - prev["usage"]) / span * 100)            # 100 = one full core
            h["throttledPct"] = round((cur["throttled"] - prev["throttled"]) / span * 100)  # time the host held the server back
        self.cpu_prev = (now, cur)
        try:
            h["load"] = [float(x) for x in (_read("/proc/loadavg") or "").split()[:3]]
        except Exception:
            pass
        h["threads"] = _kv("/proc/self/status").get("Threads")
        try:
            h["fds"] = len(os.listdir("/proc/self/fd"))
        except Exception:
            pass
        try:
            h["diskFreeMB"] = round(shutil.disk_usage(Path.cwd()).free / 1048576)
        except Exception:
            pass
        cw = getattr(self.plugin, "crashwatch", None)
        if cw:
            h["doing"] = cw.doing
        if self.slow:
            h["slowTasks"] = {k: {"n": v[0], "worstMs": v[1]} for k, v in sorted(self.slow.items(), key=lambda kv: -kv[1][1])[:10]}
            self.slow = {}
        voice = getattr(self.plugin, "_voice", None)
        h["website"] = bool(voice is not None and getattr(voice, "ws", None))
        h = {k: v for k, v in h.items() if v is not None}
        self.latest = h
        self._send({"type": "diag_health", "health": h}, keep=False)

    # ---------- sending ----------
    def _ws(self):
        voice = getattr(self.plugin, "_voice", None)
        return voice if voice is not None and getattr(voice, "ws", None) else None

    def _send(self, obj, keep=True):
        v = self._ws()
        if not v:
            return False
        v.send_json(obj)
        return True

    def flush(self, sync=False):
        v = self._ws()
        if not v:
            return
        if not self.sent_start:
            self.sent_start = True
            v.send_json({"type": "diag_event", "event": "start", "data": self.start_info})
        if self.errors:
            errs, self.errors = list(self.errors.values()), {}
            for e in errs:
                e["first"], e["last"] = int(e["first"] * 1000), int(e["last"] * 1000)
            self._out(v, {"type": "diag_errors", "errors": errs[:50]}, sync)
        while self.pending:
            batch = [self.pending.popleft() for _ in range(min(MAX_BATCH, len(self.pending)))]
            self._out(v, {"type": "diag_console", "lines": batch, "dropped": self.dropped}, sync)
            self.dropped = 0

    @staticmethod
    def _out(v, obj, sync):
        if sync:
            try:
                import json
                v.ws.send_text(json.dumps(obj))
            except Exception:
                pass
        else:
            v.send_json(obj)

    def stopping(self, reason="The server is stopping"):
        """A normal stop: send what's left, and note that it stopped properly."""
        try:
            self.read_log()
            self._finish_record()
        except Exception:
            pass
        self.flush(sync=True)
        v = self._ws()
        if v:
            self._out(v, {"type": "diag_event", "event": "stop", "data": {"reason": reason, "uptimeMinutes": round((time.time() - self.plugin.crashwatch.started) / 60) if getattr(self.plugin, "crashwatch", None) else None}}, True)


def crash_cause(prev, now_info):
    """Our best guess at why the server stopped without shutting down, from the note it left while running
    (prev) and what we see now. Plain words, for the crash report."""
    traceback_found = now_info.get("traceback")
    mem = prev.get("memory") or {}
    cg = prev.get("cgroup") or {}
    used, limit = mem.get("containerUsed"), mem.get("containerLimit")
    if prev.get("bootTime") and now_info.get("bootTime") and abs(now_info["bootTime"] - prev["bootTime"]) > 5:
        return "The whole host machine restarted (the hosting company rebooted it, or it lost power)."
    if prev.get("oomKills") is not None and now_info.get("oomKills") is not None and now_info["oomKills"] > prev["oomKills"]:
        return "It ran out of memory: the host stopped the server because it used more than its memory limit."
    if traceback_found:
        return "The server crashed inside the game itself (a native crash). The technical details are below."
    container_new = prev.get("containerStart") and now_info.get("containerStart") and abs(now_info["containerStart"] - prev["containerStart"]) > 5
    if used and limit and used >= limit * 0.9:
        return "It probably ran out of memory: it was using almost all of its memory limit just before it stopped."
    if container_new:
        return ("It was stopped from outside: the hosting panel or the host restarted the server's container. "
                "There was no error and no shutdown message, which is what a Kill/Restart in the panel or a host restart looks like.")
    return ("The server process was stopped suddenly from outside (killed), with no error and no shutdown message. "
            "This is usually the hosting panel (Kill, a scheduled restart, or a watchdog) or the host.")
