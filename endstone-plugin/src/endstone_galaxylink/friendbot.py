"""Friend bot: runs MCXboxBroadcast next to the Minecraft server, so GalaxySMP shows under Play > Friends
for anyone who is friends with the bot's Xbox account (GalaxyPRO#9842).

The plugin looks after it by itself:
  - the first time, downloads Java (a small private copy in the plugin folder) and the bot program;
  - writes the bot's settings (it relays joins straight to this server: 127.0.0.1 and the server's port);
  - starts it, restarts it if it stops (waiting a little longer each time), and stops it with the server;
  - when Microsoft sign-in is needed, the link and code show in the Control Panel (Server control > Friend bot);
  - the sign-in is saved in the plugin folder, so it's only needed once.
Turn it on or off, and choose whether friend requests are accepted by themselves, in the Control Panel.
"""

import json
import os
import platform
import re
import shutil
import subprocess
import tarfile
import threading
import time
import urllib.request
from pathlib import Path

JAR_URL = "https://github.com/MCXboxBroadcast/Broadcaster/releases/latest/download/MCXboxBroadcastStandalone.jar"
JRE_API = "https://api.adoptium.net/v3/binary/latest/21/ga/linux/{arch}/jre/hotspot/normal/eclipse"
JRE_GITHUB = "https://api.github.com/repos/adoptium/temurin21-binaries/releases/latest"
JAR_REFRESH_DAYS = 7
# Keep Java small (the Minecraft server comes first), but not too small: newer bot versions crash with a
# StackOverflowError when the thread stack is limited (-Xss256k did that), so the stack keeps Java's normal size.
JAVA_OPTS = ["-Xmx256m", "-XX:MaxMetaspaceSize=128m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1",
             "-XX:ReservedCodeCacheSize=48m", "-XX:CICompilerCount=1"]
# If it still runs out of room (StackOverflowError / OutOfMemoryError), the next start gives it more.
JAVA_OPTS_ROOMY = ["-Xmx512m", "-Xss2m", "-XX:+UseSerialGC"]
MIN_FREE_MB = 700    # don't start the bot unless the machine has at least this much free memory
STOP_FREE_MB = 350   # stop the bot if free memory drops below this (it starts again later when there's room)
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]|\[[0-9;]*m")
URL_RE = re.compile(r"https?://\S+")
CODE_RE = re.compile(r"Enter the code:\s*([A-Z0-9-]{4,})", re.I)


def free_mb():
    """Free memory on the machine (or the host's container limit), in MB; None if unknown."""
    def num(path):
        try:
            v = open(path).read().strip()
            return None if v == "max" else int(v)
        except Exception:
            return None
    limit, used = num("/sys/fs/cgroup/memory.max"), num("/sys/fs/cgroup/memory.current")
    if limit and used and limit < 1 << 50:
        return round((limit - used) / 1048576)
    try:
        for line in open("/proc/meminfo"):
            if line.startswith("MemAvailable"):
                return int(line.split()[1]) // 1024
    except Exception:
        pass
    return None


class FriendBot:
    def __init__(self, plugin):
        self.plugin = plugin
        self.folder = (Path(plugin.data_folder) / "friendbot").resolve()
        self.folder.mkdir(parents=True, exist_ok=True)
        cfg = plugin.economy.get_config("friendbot") or {}
        self.enabled = cfg.get("enabled", True)
        self.auto_friend = cfg.get("auto_friend", False)
        self.proc = None
        self.stopping = False
        self.state = "off"
        self.detail = ""
        self.signin = None          # {"url", "code"} while Microsoft sign-in is needed
        self.lines = []             # the last lines it printed (for the Control Panel)
        self.failures = 0
        self.roomy = False          # after a StackOverflowError / OutOfMemoryError: start with more room
        self.last_logged = None
        self.last_sent = None
        self.wake = threading.Event()
        self.thread = threading.Thread(target=self.run, name="friendbot", daemon=True)
        self.thread.start()

    # ---------- settings from the website ----------
    def settings(self, msg):
        changed = False
        if "enabled" in msg and bool(msg["enabled"]) != self.enabled:
            self.enabled = bool(msg["enabled"])
            changed = True
        if "autoFriend" in msg and bool(msg["autoFriend"]) != self.auto_friend:
            self.auto_friend = bool(msg["autoFriend"])
            changed = True
        self.plugin.economy.set_config("friendbot", {"enabled": self.enabled, "auto_friend": self.auto_friend})
        if changed or msg.get("restart"):
            self.failures = 0
            self.kill()
            self.wake.set()
        self.report(force=True)

    # ---------- status to the website ----------
    def set_state(self, state, detail=""):
        self.state, self.detail = state, detail
        if state != "signin":
            self.signin = None
        if (state, detail) != self.last_logged and state not in ("starting",):
            self.last_logged = (state, detail)
            self.log(f"{state}: {detail}" if detail else state)
        self.report()

    def report(self, force=False):
        payload = {"type": "friendbot", "state": self.state, "detail": self.detail[:300], "signin": self.signin,
                   "enabled": self.enabled, "autoFriend": self.auto_friend, "lines": self.lines[-25:]}
        key = json.dumps({k: payload[k] for k in ("state", "detail", "signin", "enabled", "autoFriend")}, sort_keys=True)
        if not force and key == self.last_sent:
            return
        voice = getattr(self.plugin, "_voice", None)
        if voice is not None and getattr(voice, "ws", None):
            voice.send_json(payload)
            self.last_sent = key

    def log(self, text):
        try:
            self.plugin.logger.info(f"[Friend bot] {text}")
        except Exception:
            pass

    # ---------- getting Java and the bot ----------
    def java(self):
        found = shutil.which("java")
        if found and self.java_ok(found):
            return found
        jre = self.folder / "jre"
        for p in jre.glob("*/bin/java"):
            if self.java_ok(str(p)):
                return str(p)
        self.set_state("installing", "Downloading Java (one time, about 50 MB)...")
        arch = {"x86_64": "x64", "amd64": "x64", "aarch64": "aarch64", "arm64": "aarch64"}.get(platform.machine().lower(), "x64")
        tmp = self.folder / "jre.tar.gz"
        try:
            self.download(JRE_API.format(arch=arch), tmp)
        except Exception as e:  # the Adoptium site is down or blocked: the same file from GitHub
            self.log(f"Java download from adoptium.net failed ({e}); trying GitHub.")
            with urllib.request.urlopen(urllib.request.Request(JRE_GITHUB, headers={"User-Agent": "GalaxyLink"}), timeout=30) as r:
                rel = json.loads(r.read().decode())
            asset = next(a for a in rel["assets"] if a["name"].startswith(f"OpenJDK21U-jre_{arch}_linux_hotspot") and a["name"].endswith(".tar.gz"))
            self.download(asset["browser_download_url"], tmp)
        shutil.rmtree(jre, ignore_errors=True)
        jre.mkdir(parents=True)
        with tarfile.open(tmp) as t:
            for m in t.getmembers():  # never write outside the jre folder
                if m.name.startswith("/") or ".." in Path(m.name).parts:
                    continue
                t.extract(m, jre)
        tmp.unlink(missing_ok=True)
        for p in jre.glob("*/bin/java"):
            os.chmod(p, 0o755)
            if self.java_ok(str(p)):
                return str(p)
        raise RuntimeError("Java was downloaded but doesn't run on this server.")

    @staticmethod
    def java_ok(path):
        try:
            out = subprocess.run([path, "-version"], capture_output=True, text=True, timeout=20)
            m = re.search(r'version "(\d+)', out.stderr + out.stdout)
            return out.returncode == 0 and m is not None and int(m.group(1)) >= 17
        except Exception:
            return False

    def jar(self):
        path = self.folder / "MCXboxBroadcastStandalone.jar"
        fresh = path.exists() and time.time() - path.stat().st_mtime < JAR_REFRESH_DAYS * 86400
        if fresh:
            return path
        self.set_state("installing", "Downloading the newest friend bot...")
        try:
            self.download(JAR_URL, path)
        except Exception as e:
            if not path.exists():
                raise
            self.log(f"Couldn't update the bot ({e}); using the one we have.")
        return path

    @staticmethod
    def download(url, dest):
        tmp = Path(str(dest) + ".part")
        req = urllib.request.Request(url, headers={"User-Agent": "GalaxyLink"})
        with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f)
        if tmp.stat().st_size < 100_000:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"the download from {url} was too small")
        tmp.replace(dest)

    # ---------- the bot's settings ----------
    def server_port(self):
        try:
            for line in (Path.cwd() / "server.properties").read_text("utf-8", "ignore").splitlines():
                if line.startswith("server-port="):
                    return int(line.split("=", 1)[1].strip())
        except Exception:
            pass
        return 19132

    def write_config(self):
        """Changes only our values in the bot's config.yml (it makes the file itself on its first run)."""
        path = self.folder / "config.yml"
        if not path.exists():
            return False
        text = path.read_text("utf-8")
        want = {
            "remote-address": "127.0.0.1",
            "remote-port": str(self.server_port()),
            "query-server": "true",
            "host-name": '"GalaxySMP"',
            "world-name": '"GalaxySMP Survival"',
            "auto-friend": "true" if self.auto_friend else "false",
        }
        new = text
        for key, value in want.items():
            new = re.sub(rf"^(\s*{re.escape(key)}:)[^\n]*$", lambda m, v=value: f"{m.group(1)} {v}", new, count=1, flags=re.M)
        if new != text:
            path.write_text(new, "utf-8")
            return True
        return False

    # ---------- running it ----------
    def run(self):
        time.sleep(20)  # let the server finish starting
        while True:
            if not self.enabled:
                self.set_state("off", "Turned off in the Control Panel.")
                self.wake.wait(3600)
                self.wake.clear()
                continue
            free = free_mb()
            if free is not None and free < MIN_FREE_MB:
                self.set_state("waiting", f"Waiting for free memory ({free} MB free, needs {MIN_FREE_MB} MB) so the Minecraft server isn't slowed down.")
                self.wake.wait(300)
                self.wake.clear()
                continue
            try:
                java = self.java()
                jar = self.jar()
                first = not (self.folder / "config.yml").exists()
                self.write_config()
                code = self.start(java, jar, first)
                if first and (self.folder / "config.yml").exists() and not self.stopping:
                    self.failures = 0  # its first run made config.yml and we set our values: start it again
                    continue
            except Exception as e:
                code = None
                self.set_state("error", f"{type(e).__name__}: {e}")
                self.log(f"Problem: {e}")
            if self.stopping:
                return
            if self.enabled:
                self.failures += 1
                wait = min(300, 10 * 2 ** min(self.failures, 5))
                if self.state != "error":
                    self.set_state("restarting", f"The bot stopped{f' (code {code})' if code is not None else ''}. Starting it again in {wait} seconds.")
                self.wake.wait(wait)
                self.wake.clear()

    def start(self, java, jar, first=False):
        self.set_state("starting", "Starting the friend bot...")
        self.signin = None
        opts = JAVA_OPTS_ROOMY if self.roomy else JAVA_OPTS
        self.proc = subprocess.Popen([java, *opts, "-jar", str(jar)], cwd=str(self.folder), stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        started = time.time()
        pending_url = None
        proc = self.proc

        def guard():  # the Minecraft server comes first: stop the bot if memory runs low
            while proc.poll() is None:
                time.sleep(15)
                free = free_mb()
                if free is not None and free < STOP_FREE_MB and proc.poll() is None:
                    self.log(f"Memory is low ({free} MB free): stopping the friend bot so the server keeps running.")
                    self.kill()
                    return
        threading.Thread(target=guard, name="friendbot-memory", daemon=True).start()
        for raw in self.proc.stdout:
            if first and (self.folder / "config.yml").exists():
                time.sleep(1)  # the bot just made its config.yml: put our values in and restart it
                if self.write_config():
                    self.kill()
                    first = False
                    continue
                first = False
            line = ANSI.sub("", raw).strip()
            if not line or line.startswith("Picked up JAVA_TOOL_OPTIONS") or line.startswith("at ") or line.startswith("..."):
                continue
            self.lines = (self.lines + [line[:300]])[-60:]
            url = URL_RE.search(line)
            if url and ("microsoft" in url.group(0) or "live.com" in url.group(0)):
                pending_url = url.group(0).rstrip(".,)")
            m = CODE_RE.search(line)
            if m:
                self.signin = {"url": pending_url or "https://www.microsoft.com/link", "code": m.group(1)}
                self.state, self.detail = "signin", "Sign in with the bot's Xbox account to finish."
                self.report(force=True)
                continue
            if "StackOverflowError" in line or "OutOfMemoryError" in line or "Metaspace" in line:
                if not self.roomy:
                    self.roomy = True
                    self.log("The bot ran out of memory room; it will start again with more.")
            if "Creating Xbox LIVE session" in line or "Got update session response" in line:
                self.failures = 0
                self.set_state("online", "GalaxySMP shows under Play > Friends for the bot's friends.")
            elif "age verification" in line.lower():
                self.set_state("error", "The bot's Xbox account needs age verification: sign in to xbox.com with it and finish that.")
            elif "invalid_grant" in line or "Failed to get/refresh auth token" in line:
                if self.state != "signin":
                    self.set_state("error", "Microsoft sign-in failed. Use Restart in the Control Panel to get a new code.")
            elif self.state == "starting" and time.time() - started > 5:
                self.report()
        code = self.proc.wait()
        try:
            self.proc.stdin.close()
        except Exception:
            pass  # it already went away
        self.proc = None
        if code and not self.stopping:   # it stopped with an error: put its last words in the server log
            self.log(f"The bot stopped with code {code}. Its last lines:")
            for line in self.lines[-8:]:
                self.log(f"  | {line}")
        return code

    def kill(self):
        p = self.proc
        if p is None:
            return
        try:
            p.stdin.write("stop\n")
            p.stdin.flush()
        except Exception:
            pass
        try:
            p.wait(timeout=8)
        except Exception:
            try:
                p.kill()
            except Exception:
                pass

    def shutdown(self):
        """The server is stopping: stop the bot too."""
        self.stopping = True
        self.enabled = False
        self.kill()
        self.wake.set()
