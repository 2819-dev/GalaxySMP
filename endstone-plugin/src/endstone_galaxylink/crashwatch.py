"""Crash watch: notices when the server stopped without shutting down properly, and tells the staff.

When the server crashes (or the host kills it), Minecraft loses whatever it hadn't saved yet, so the last
few minutes of builds and inventories go back. To find out why it happens, the plugin keeps a small
"still running" note while the server is up, with what it was doing last. A normal stop removes the note.
If the note is still there at the next start, the server didn't stop properly: the plugin sends a crash
report (when it happened, who was online, what the plugin was doing, the end of the server log) to
#Staff Logs on the website.
"""

import json
import time
from pathlib import Path

BEAT_SECONDS = 10
LOG_LINES = 60


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
        try:
            prev = json.loads(self.file.read_text("utf-8"))
        except FileNotFoundError:
            prev = None
        except Exception:
            prev = {}
        if prev is not None:
            self.report = self.build_report(prev)
            plugin.logger.warning(f"The server didn't stop properly last time (last seen {self.report['lastSeen']}). "
                                  f"Last activity: {self.report['doing']}. A crash report goes to #Staff Logs.")
        self.beat(force=True)

    # ---------- while running ----------
    def mark(self, what):
        """Notes what the plugin is about to do (shown in the crash report if the server dies during it)."""
        if what != self.doing:
            self.doing = what
            self.beat(force=True)

    def beat(self, force=False):
        now = time.time()
        if not force and now - self.last_beat < BEAT_SECONDS:
            return
        self.last_beat = now
        try:
            players = [p.name for p in self.plugin.server.online_players]
        except Exception:
            players = []
        data = {"started": self.started, "t": now, "doing": self.doing, "players": players[:40]}
        try:
            tmp = self.file.with_suffix(".tmp")
            tmp.write_text(json.dumps(data), "utf-8")
            tmp.replace(self.file)
        except Exception:
            pass

    def tick(self):
        """Every second: keep the note fresh, and send a waiting crash report once the website is connected."""
        self.beat()
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

    # ---------- after a crash ----------
    def build_report(self, prev):
        last = prev.get("t") or 0
        fmt = lambda t: time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(t)) if t else "unknown"
        up = (last - prev["started"]) / 60 if prev.get("started") and last else None
        return {
            "lastSeen": fmt(last),
            "lastSeenAt": int(last * 1000) if last else None,
            "uptimeMinutes": round(up) if up is not None else None,
            "doing": str(prev.get("doing") or "unknown")[:200],
            "players": [str(p)[:32] for p in (prev.get("players") or [])][:40],
            "log": self.log_tail(last),
        }

    def log_tail(self, before):
        """The end of the newest server log or crash report written before this start."""
        cwd = Path.cwd()
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
