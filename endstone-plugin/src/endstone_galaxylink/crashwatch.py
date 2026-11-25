"""Crash watch: notices when the server stopped without shutting down properly, and tells the staff.

When the server crashes (or the host kills it), Minecraft loses whatever it hadn't saved yet, so the last
few minutes of builds and inventories go back. To find out why it happens, the plugin keeps a small
"still running" note while the server is up, with what it was doing last. A normal stop removes the note.
If the note is still there at the next start, the server didn't stop properly: the plugin sends a crash
report (when it happened, who was online, what the plugin was doing, the end of the server log) to
#Staff Logs on the website.
"""

import faulthandler
import json
import time
from pathlib import Path

BEAT_SECONDS = 2          # the "still running" note is refreshed this often (with a memory reading each time)
MEM_WARN = 0.85           # memory guard: above this share of the limit, warn staff and pause heavy jobs
LOG_LINES = 150


def _kb(path, key):
    try:
        for line in open(path):
            if line.startswith(key):
                return int(line.split()[1])
    except Exception:
        return None
    return None


def _num(path):
    try:
        v = open(path).read().strip()
        return None if v == "max" else int(v)
    except Exception:
        return None


def memory():
    """Memory in MB: the server process, any Java program in the container (e.g. the host's Xbox Broadcast), the machine, and the host's limit."""
    mb = lambda kb: round(kb / 1024) if kb else None
    out = {"server": mb(_kb("/proc/self/status", "VmRSS")), "machineFree": mb(_kb("/proc/meminfo", "MemAvailable")),
           "machineTotal": mb(_kb("/proc/meminfo", "MemTotal"))}
    used = _num("/sys/fs/cgroup/memory.current") or _num("/sys/fs/cgroup/memory/memory.usage_in_bytes")
    limit = _num("/sys/fs/cgroup/memory.max") or _num("/sys/fs/cgroup/memory/memory.limit_in_bytes")
    if used:
        out["containerUsed"] = round(used / 1048576)
    if limit and limit < 1 << 50:
        out["containerLimit"] = round(limit / 1048576)
    try:
        import os
        total = 0
        for pid in os.listdir("/proc"):
            if pid.isdigit():
                try:
                    if b"java" in open(f"/proc/{pid}/cmdline", "rb").read()[:200]:
                        total += _kb(f"/proc/{pid}/status", "VmRSS") or 0
                except Exception:
                    continue
        if total:
            out["friendBot"] = mb(total)
    except Exception:
        pass
    return {k: v for k, v in out.items() if v is not None}


class CrashWatch:
    def __init__(self, plugin):
        self.plugin = plugin
        folder = Path(plugin.data_folder)
        folder.mkdir(parents=True, exist_ok=True)
        self.file = folder / "running.json"
        self.started = time.time()
        self.doing = "starting up"
        self.last_beat = 0
        self.report = None
        self.trail = []           # [seconds since start, container MB] every 2 seconds, the last 2 minutes
        self.full_memory = {}
        self.full_at = 0
        self.warned_at = 0
        try:
            prev = json.loads(self.file.read_text("utf-8"))
        except FileNotFoundError:
            prev = None
        except Exception:
            prev = {}
        self.fault_file = folder / "crash_traceback.txt"
        from endstone_galaxylink import diagnostics as dg
        self.boot = dg.boot_time()
        self.container = dg.container_start()
        if prev is not None:
            self.report = self.build_report(prev)
            plugin.logger.warning(f"The server didn't stop properly last time (last seen {self.report['lastSeen']}). "
                                  f"Last activity: {self.report['doing']}. A crash report goes to #Staff Logs.")
        self.beat(force=True)
        # If the server crashes hard (a native crash), Python writes what every thread was doing into this file,
        # down to the exact line. It goes into the next crash report.
        try:
            self._fault_fh = open(self.fault_file, "w", encoding="utf-8")
            faulthandler.enable(file=self._fault_fh, all_threads=True)
        except Exception as e:
            plugin.logger.warning(f"Couldn't turn on the crash tracer: {e}")
        self.log_copy = folder / "last_server_log.txt"
        self.last_copy = 0

    # ---------- while running ----------
    def mark(self, what):
        """Notes what the plugin is about to do (shown in the crash report if the server dies during it). Starting a
        task writes the note straight away (a light write: no new memory readings); going back to idle doesn't."""
        if what != self.doing:
            self.doing = what
            if what != "idle":
                self.beat(force=True, light=True)

    def beat(self, force=False, light=False):
        now = time.time()
        if not force and now - self.last_beat < BEAT_SECONDS:
            return
        data = getattr(self, "last_data", None)
        if light and data is not None:
            # only "what it's doing" changed: rewrite the last note with that (no new readings)
            data = dict(data, t=now, doing=self.doing)
        else:
            self.last_beat = now
            try:
                players = [p.name for p in self.plugin.server.online_players]
            except Exception:
                players = []
            from endstone_galaxylink.diagnostics import cgroup_memory, cgroup_now
            cg = cgroup_memory()
            used, limit = cgroup_now()
            self.trail = (self.trail + [[round(now - self.started), used]])[-60:]   # one reading every 2 seconds
            if now - self.full_at >= 10:   # the full memory picture (it looks through all processes) every 10 seconds
                self.full_at = now
                self.full_memory = memory()
            self.guard(used, limit)
            diag = getattr(self.plugin, "diagnostics", None)
            data = {"started": self.started, "t": now, "doing": self.doing, "players": players[:40], "memory": self.full_memory,
                    "bootTime": self.boot, "containerStart": self.container, "oomKills": cg.get("oomKills"), "cgroup": cg,
                    "health": getattr(diag, "latest", None), "memTrail": self.trail, "memLimit": limit}
            self.last_data = data
        try:
            tmp = self.file.with_suffix(".tmp")
            tmp.write_text(json.dumps(data), "utf-8")
            tmp.replace(self.file)
        except Exception:
            pass

    def guard(self, used, limit):
        """Memory guard: when the server gets close to its memory limit (the host kills it at the limit, with no
        warning), pause the heavy background jobs and tell staff, at most once a minute."""
        if not used or not limit or used < limit * MEM_WARN:
            return
        now = time.time()
        sift = getattr(self.plugin, "sift", None)
        if sift is not None and getattr(sift, "tile", None) is not None:
            sift.wait = max(getattr(sift, "wait", 0), 1200)   # the Sift builder rests a minute
        if now - self.warned_at < 60:
            return
        self.warned_at = now
        msg = f"Memory is high: {used} MB of {limit} MB. Heavy background jobs are paused."
        self.plugin.logger.warning(msg)
        try:
            for p in self.plugin.server.online_players:
                if p.is_op:
                    p.send_message(f"§c[Server] §7{msg}")
        except Exception:
            pass

    def tick(self):
        """Every second: keep the note fresh, and send a waiting crash report once the website is connected."""
        self.beat()
        self.copy_log()
        diag = getattr(self.plugin, "diagnostics", None)
        if diag is not None:
            try:
                diag.tick()
            except Exception:
                pass
        voice = getattr(self.plugin, "_voice", None)
        if self.report and voice is not None and getattr(voice, "ws", None):
            voice.send_json({"type": "server_crash", **self.report})
            self.report = None

    def stopped(self):
        """A proper stop: remove the note."""
        try:
            self.file.unlink()
        except Exception:
            pass

    def copy_log(self):
        """Every 10 seconds: keep a copy of the end of this run's server log in our own folder. The server starts
        a new log file when it restarts, so this copy is the only way to see what happened just before a crash."""
        now = time.time()
        if now - self.last_copy < BEAT_SECONDS:
            return
        self.last_copy = now
        try:
            src = Path.cwd() / "logs" / "latest.log"
            with open(src, "rb") as fh:
                fh.seek(0, 2)
                size = fh.tell()
                fh.seek(max(0, size - 30000))
                data = fh.read()
            tmp = self.log_copy.with_suffix(".tmp")
            tmp.write_bytes(data)
            tmp.replace(self.log_copy)
        except Exception:
            pass

    # ---------- after a crash ----------
    def build_report(self, prev):
        last = prev.get("t") or 0
        fmt = lambda t: time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(t)) if t else "unknown"
        up = (last - prev["started"]) / 60 if prev.get("started") and last else None
        from endstone_galaxylink.diagnostics import crash_cause, cgroup_memory
        tb = self.traceback()
        ec = self.endstone_crash(prev.get("started") or 0)
        try:
            cause = crash_cause(prev, {"bootTime": self.boot, "containerStart": self.container,
                                       "oomKills": cgroup_memory().get("oomKills"), "traceback": tb or (ec or {}).get("lines")})
        except Exception:
            cause = None
        return {
            "cause": cause,
            "downSeconds": round(self.started - last) if last else None,
            "lastHealth": prev.get("health") or None,
            "cgroup": prev.get("cgroup") or {},
            "containerRestarted": bool(prev.get("containerStart") and self.container and abs(self.container - prev["containerStart"]) > 5),
            "lastSeen": fmt(last),
            "lastSeenAt": int(last * 1000) if last else None,
            "uptimeMinutes": round(up) if up is not None else None,
            "doing": str(prev.get("doing") or "unknown")[:200],
            "players": [str(p)[:32] for p in (prev.get("players") or [])][:40],
            "log": self.log_tail(last),
            "traceback": tb,
            "memory": prev.get("memory") or {},
            "memTrail": (prev.get("memTrail") or [])[-60:],
            "endstoneCrash": ec,
        }

    def endstone_crash(self, since):
        """Endstone writes crash_reports/crash-<time>-server.txt when the game itself crashes: the newest one written
        during the run that stopped, if any (its last lines)."""
        folder = Path.cwd() / "crash_reports"
        try:
            files = [f for f in folder.iterdir() if f.is_file() and f.stat().st_mtime >= since - 5]
        except Exception:
            return None
        if not files:
            return None
        f = max(files, key=lambda x: x.stat().st_mtime)
        try:
            text = f.read_bytes()[-20000:].decode("utf-8", "replace")
        except Exception as e:
            return {"file": f.name, "lines": [f"(couldn't read it: {e})"]}
        return {"file": f.name, "lines": [ln.rstrip()[:300] for ln in text.splitlines() if ln.strip()][-80:]}

    def traceback(self):
        """What Python was doing at the moment of the crash (written by faulthandler), if anything."""
        try:
            text = self.fault_file.read_text("utf-8", "replace").strip()
        except Exception:
            return []
        return [ln.rstrip()[:300] for ln in text.splitlines() if ln.strip()][:80]

    def log_tail(self, before):
        """The end of the server log from the run that crashed (our own copy, saved every 10 seconds), or else
        the newest crash report or log written before this start."""
        cwd = Path.cwd()
        saved = Path(self.plugin.data_folder) / "last_server_log.txt"
        try:
            if saved.is_file() and saved.stat().st_size > 0:
                text = saved.read_bytes().decode("utf-8", "replace")
                lines = [ln.rstrip()[:300] for ln in text.splitlines() if ln.strip()][-LOG_LINES:]
                return {"file": "server log (saved by GalaxyLink before the crash)", "lines": lines}
        except Exception:
            pass
        found = []
        for folder in (cwd, cwd / "logs", cwd / "crash_reports", cwd / "crashes", cwd / "crash_dumps", cwd / "CrashDumps"):
            if not folder.is_dir():
                continue
            for f in folder.iterdir():
                try:
                    if f.is_file() and f.suffix.lower() in (".log", ".txt") and f.stat().st_size > 0 \
                            and f.stat().st_mtime < self.started:
                        found.append((f.stat().st_mtime, f))
                except Exception:
                    continue
        if not found:
            return {"file": None, "lines": []}
        _, f = max(found)
        try:
            with open(f, "rb") as fh:
                fh.seek(0, 2)
                size = fh.tell()
                fh.seek(max(0, size - 24000))
                text = fh.read().decode("utf-8", "replace")
        except Exception as e:
            return {"file": f.name, "lines": [f"(couldn't read it: {e})"]}
        lines = [ln.rstrip()[:300] for ln in text.splitlines() if ln.strip()][-LOG_LINES:]
        return {"file": str(f.relative_to(cwd)) if f.is_relative_to(cwd) else f.name, "lines": lines}
