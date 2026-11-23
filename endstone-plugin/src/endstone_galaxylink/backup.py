"""Nightly world backups.

Every night (4 AM New York time), and when staff press "Back up now" on the website:
  1. "save hold" pauses Minecraft's disk writes (the game keeps running), then "save query" lists the exact files
     and sizes that make up a consistent copy of the world.
  2. Those files are zipped (in a background thread) into backups/<world>-<date>.zip, then "save resume".
  3. The last 3 zips stay on the server; the newest is uploaded to the website's private storage, which also keeps 3.

Restoring (Control Panel > Server control > Backups > Restore): the plugin downloads that backup and the world is
swapped on the next server start, before Minecraft opens it (the current world is kept as <world>-before-restore-<date>).
The swap only happens when the world isn't open (its LevelDB lock is free), so a running world is never touched.
"""

import json
import os
import re
import shutil
import threading
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

from endstone_galaxylink import settings

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("America/New_York")
except Exception:   # no time zone data: UTC
    TZ = None

KEEP = 3
HOUR = 4                       # 4 AM New York time
PART = 16 * 1024 * 1024        # upload part size
PENDING = "restore_pending.json"


def world_folder():
    from endstone_galaxylink.ranktags import level_folder
    return level_folder()


def backup_dir():
    d = Path.cwd() / "backups"
    d.mkdir(exist_ok=True)
    return d


def parse_query(text):
    """'Data saved. Files are now ready to be copied. World/db/000005.ldb:1234, World/level.dat:5678' -> [(path, size)]"""
    if "ready to be copied" not in text:
        return None
    body = text.split("copied.", 1)[-1]
    return [(m.group(1).strip(), int(m.group(2))) for m in re.finditer(r"([^,\n]+?):(\d+)(?=,|\s*$)", body, re.M) if m.group(1).strip()]


def world_is_open(folder):
    """True if Minecraft has the world open (its LevelDB LOCK file is locked)."""
    lock = Path(folder) / "db" / "LOCK"
    if not lock.exists():
        return False
    try:
        import fcntl
        with open(lock, "a") as f:
            try:
                fcntl.lockf(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.lockf(f, fcntl.LOCK_UN)
                return False
            except OSError:
                return True
    except Exception:
        return True   # can't tell: play it safe


def apply_pending_restore(logger):
    """Called from on_load (before the world opens): swap in a downloaded backup."""
    try:
        pend = backup_dir() / PENDING
        if not pend.exists():
            return
        info = json.loads(pend.read_text("utf-8"))
        zpath = Path(info["zip"])
        world = world_folder()
        if world_is_open(world):
            logger.warning("[Backups] A restore is waiting, but the world is already open. It will be applied on the next start.")
            return
        if not zpath.exists():
            logger.warning("[Backups] The restore file is missing; restore cancelled.")
            pend.unlink()
            return
        stamp = datetime.now().strftime("%Y%m%d-%H%M")
        if world.exists():
            world.rename(world.with_name(f"{world.name}-before-restore-{stamp}"))
        tmp = world.with_name(world.name + "-restoring")
        if tmp.exists():
            shutil.rmtree(tmp)
        with zipfile.ZipFile(zpath) as z:
            z.extractall(tmp)
        # the zip holds "<world name>/..." (as save query lists it)
        inner = [p for p in tmp.iterdir() if p.is_dir()]
        src = inner[0] if len(inner) == 1 and not (tmp / "db").exists() else tmp
        src.rename(world) if src is not tmp else tmp.rename(world)
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
        pend.unlink()
        logger.info(f"[Backups] World restored from {zpath.name}. The old world was kept as {world.name}-before-restore-{stamp}.")
    except Exception as e:
        logger.error(f"[Backups] Restore failed: {e}")


class Backups:
    def __init__(self, plugin):
        self.plugin = plugin
        self.busy = False
        self.status = plugin.economy.get_config("backup_status") or {}
        self._query_out = []
        self._tries = 0

    # ---------- schedule ----------
    def tick(self):
        """Every minute: is it time for tonight's backup?"""
        now = datetime.now(TZ) if TZ else datetime.utcnow()
        today = now.strftime("%Y-%m-%d")
        if now.hour == HOUR and self.status.get("day") != today and not self.busy:
            self.start("nightly")

    def save_status(self, **kw):
        self.status.update(kw)
        self.plugin.economy.set_config("backup_status", self.status)

    # ---------- making a backup ----------
    def run_cmd(self, cmd, capture=False):
        server = self.plugin.server
        if not capture:
            return server.dispatch_command(server.command_sender, cmd)
        from endstone.command import CommandSenderWrapper
        out = []
        sender = CommandSenderWrapper(server.command_sender, on_message=lambda m: out.append(str(m)), on_error=lambda m: out.append(str(m)))
        server.dispatch_command(sender, cmd)
        return "\n".join(out)

    def start(self, why="manual"):
        if self.busy:
            return False
        self.busy = True
        self.why = why
        self._tries = 0
        self.plugin.logger.info(f"[Backups] Starting a backup ({why}).")
        self.save_status(day=(datetime.now(TZ) if TZ else datetime.utcnow()).strftime("%Y-%m-%d"), state="saving", at=time.time())
        self.run_cmd("save hold")
        self.plugin.server.scheduler.run_task(self.plugin, self._poll, delay=40)
        return True

    def _poll(self):
        self._tries += 1
        out = self.run_cmd("save query", capture=True)
        files = parse_query(out)
        if files is None:
            if self._tries > 30:
                self.run_cmd("save resume")
                self.busy = False
                self.save_status(state="failed", error="Minecraft didn't get the files ready")
                self.plugin.logger.error("[Backups] save query never became ready; backup skipped.")
                return
            self.plugin.server.scheduler.run_task(self.plugin, self._poll, delay=20)
            return
        threading.Thread(target=self._zip, args=(files,), daemon=True).start()

    def _zip(self, files):
        worlds = Path.cwd() / "worlds"
        name = world_folder().name
        stamp = datetime.now(TZ).strftime("%Y-%m-%d_%H-%M") if TZ else datetime.utcnow().strftime("%Y-%m-%d_%H-%M")
        zpath = backup_dir() / f"{name.replace(' ', '_')}-{stamp}.zip"
        ok = True
        try:
            with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                for rel, size in files:
                    src = worlds / rel
                    if not src.exists():
                        continue
                    with open(src, "rb") as f:
                        data = f.read(size)   # only the part Minecraft says is complete
                    z.writestr(rel, data)
        except Exception as e:
            ok = False
            self.plugin.logger.error(f"[Backups] Zipping failed: {e}")
            try:
                zpath.unlink()
            except Exception:
                pass
        self.plugin.server.scheduler.run_task(self.plugin, lambda: self._after_zip(ok, zpath))

    def _after_zip(self, ok, zpath):
        self.run_cmd("save resume")
        if not ok:
            self.busy = False
            return self.save_status(state="failed", error="Zipping the world failed")
        # keep the newest 3 on the server
        zips = sorted(backup_dir().glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in [z for z in zips if not z.name.startswith("restore")][KEEP:]:
            try:
                old.unlink()
            except Exception:
                pass
        size = zpath.stat().st_size
        self.save_status(state="uploading", file=zpath.name, size=size)
        self.plugin.logger.info(f"[Backups] Saved {zpath.name} ({size // (1024 * 1024)} MB). Uploading a copy to the website.")
        threading.Thread(target=self._upload, args=(zpath,), daemon=True).start()

    # ---------- website copy ----------
    def _http(self, method, path, data=None, headers=None, timeout=120):
        req = urllib.request.Request(settings.WEBSITE + path, data=data, method=method,
                                     headers={"Authorization": f"Bearer {settings.SECRET}", **(headers or {})})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()

    def _upload(self, zpath):
        try:
            size = zpath.stat().st_size
            start = json.loads(self._http("POST", "/api/plugin/backup/start", json.dumps({"name": zpath.name, "size": size}).encode(),
                                          {"Content-Type": "application/json"}))
            key, upload = start["key"], start["uploadId"]
            parts = []
            with open(zpath, "rb") as f:
                n = 1
                while True:
                    chunk = f.read(PART)
                    if not chunk:
                        break
                    q = f"?key={urllib.parse.quote(key)}&uploadId={urllib.parse.quote(upload)}&part={n}"
                    res = json.loads(self._http("PUT", "/api/plugin/backup/part" + q, chunk, {"Content-Type": "application/octet-stream"}, timeout=600))
                    parts.append({"partNumber": n, "etag": res["etag"]})
                    n += 1
            self._http("POST", "/api/plugin/backup/complete", json.dumps({"key": key, "uploadId": upload, "parts": parts, "size": size}).encode(),
                       {"Content-Type": "application/json"})
            done = dict(state="done", uploaded=True, finished=time.time(), error=None)
            self.plugin.logger.info(f"[Backups] {zpath.name} is safe on the website too.")
        except Exception as e:
            done = dict(state="done", uploaded=False, finished=time.time(), error=f"Upload failed: {e}")
            self.plugin.logger.warning(f"[Backups] Upload to the website failed: {e} (the copy on the server is fine).")
        self.plugin.server.scheduler.run_task(self.plugin, lambda: self._finish(done))

    def _finish(self, done):
        self.busy = False
        self.save_status(**done)

    # ---------- restore (from the website) ----------
    def restore(self, key, by=""):
        """Downloads a backup; it's swapped in on the next server start."""
        if self.busy:
            return
        self.busy = True
        self.plugin.logger.info(f"[Backups] Downloading backup {key} for a restore (asked by {by or 'staff'}).")
        threading.Thread(target=self._download, args=(key, by), daemon=True).start()

    def _download(self, key, by):
        try:
            dest = backup_dir() / "restore.zip"
            req = urllib.request.Request(settings.WEBSITE + "/api/plugin/backup/download?key=" + urllib.parse.quote(key),
                                         headers={"Authorization": f"Bearer {settings.SECRET}"})
            with urllib.request.urlopen(req, timeout=600) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f, 1024 * 1024)
            with zipfile.ZipFile(dest) as z:
                bad = z.testzip()
                if bad:
                    raise ValueError(f"damaged file in the backup: {bad}")
            (backup_dir() / PENDING).write_text(json.dumps({"zip": str(dest), "key": key, "by": by, "at": time.time()}), "utf-8")
            msg = "§a[Backups] The backup is ready. It will be put back the next time the server restarts."
            self.plugin.logger.info("[Backups] Restore ready: it will be applied on the next server start.")
            self.plugin.server.scheduler.run_task(self.plugin, lambda: self._restore_ready(msg))
        except Exception as e:
            self.plugin.logger.error(f"[Backups] Download for restore failed: {e}")
            self.plugin.server.scheduler.run_task(self.plugin, lambda: setattr(self, "busy", False))

    def _restore_ready(self, msg):
        self.busy = False
        self.save_status(restore_pending=True)
        for p in self.plugin.server.online_players:
            if p.is_op:
                p.send_message(msg)

