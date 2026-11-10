"""Voice link: sends player positions to the website and shows voice icons in game.

Uses a small built-in WebSocket client (Python standard library only), so the
plugin needs nothing extra installed on the server.
"""

import base64
import json
import os
import socket
import ssl
import struct
import threading
import time
import urllib.parse

# Shown before a player's name above their head, like Simple Voice Chat.
# These characters are drawn by the "GalaxySMP Voice Icons" resource pack
# (resource-pack/ in the website repository), which the server sends to players.
ICONS = {
    "talking": "\ue200",         # white speaker: talking nearby
    "talking_group": "\ue201",   # green speaker: talking in a group
    "talking_global": "\ue202",  # gold speaker: talking on the Global Mic
    "muted": "\ue203",           # microphone crossed out: muted themselves
    "deafened": "\ue204",        # headphones crossed out: deafened
    "voice_muted": "\ue205",     # grey microphone crossed out: muted by staff
    "disconnected": "\ue206",    # unplugged cable: not connected to voice
}
# In voice and quiet ("connected") shows no icon, like Simple Voice Chat.

POSITION_TICKS = 6  # 20 ticks = 1 second, so about 3 updates per second
STATUS_EVERY = 50   # x POSITION_TICKS = every 15 seconds: player count for the website status page


class _Socket:
    """Minimal WebSocket client (text frames, ping/pong, close)."""

    def __init__(self, url, headers):
        u = urllib.parse.urlparse(url)
        self.host = u.hostname
        port = u.port or (443 if u.scheme == "wss" else 80)
        raw = socket.create_connection((self.host, port), timeout=15)
        if u.scheme == "wss":
            raw = ssl.create_default_context().wrap_socket(raw, server_hostname=self.host)
        self.sock = raw
        self.lock = threading.Lock()
        key = base64.b64encode(os.urandom(16)).decode()
        lines = [
            f"GET {u.path or '/'} HTTP/1.1",
            f"Host: {self.host}",
            "Upgrade: websocket",
            "Connection: Upgrade",
            f"Sec-WebSocket-Key: {key}",
            "Sec-WebSocket-Version: 13",
        ] + [f"{k}: {v}" for k, v in headers.items()]
        self.sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1024)
            if not chunk:
                raise ConnectionError("connection closed during handshake")
            head += chunk
        status = head.split(b"\r\n", 1)[0].decode(errors="replace")
        if " 101 " not in status:
            raise ConnectionError(f"voice server refused: {status}")
        self.buffer = head.split(b"\r\n\r\n", 1)[1]
        self.sock.settimeout(None)

    def _read(self, n):
        while len(self.buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("connection closed")
            self.buffer += chunk
        data, self.buffer = self.buffer[:n], self.buffer[n:]
        return data

    def send_frame(self, opcode, payload=b""):
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack("!H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack("!Q", n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        with self.lock:
            self.sock.sendall(header + mask + masked)

    def send_text(self, text):
        self.send_frame(0x1, text.encode("utf-8"))

    def recv_text(self):
        message = b""
        while True:
            b1, b2 = self._read(2)
            opcode = b1 & 0x0F
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack("!H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            payload = self._read(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x8:
                raise ConnectionError("closed by server")
            if opcode == 0x9:
                self.send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            message += payload
            if b1 & 0x80:
                return message.decode("utf-8", errors="replace")

    def close(self):
        try:
            self.send_frame(0x8, struct.pack("!H", 1000))
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass


class VoiceLink:
    def __init__(self, plugin, website, secret):
        self.plugin = plugin
        self.url = website.replace("https://", "wss://").replace("http://", "ws://").rstrip("/") + "/api/voice/server"
        self.secret = secret
        self.ws = None
        self.active = False
        self.stopped = False
        self.applied = {}  # player uuid -> icon key currently shown
        self.wanted = {}
        self.task = None

    # ---------- lifecycle ----------
    def start(self):
        threading.Thread(target=self._run, daemon=True).start()
        self.task = self.plugin.server.scheduler.run_task(self.plugin, self._tick, delay=POSITION_TICKS, period=POSITION_TICKS)

    def stop(self):
        self.stopped = True
        if self.ws:
            self.ws.close()
        self.wanted = {}
        self._apply_icons()

    def _run(self):
        delay = 2
        while not self.stopped:
            try:
                self.ws = _Socket(self.url, {
                    "Authorization": "Bearer " + self.secret,
                    "User-Agent": "GalaxyLink-Endstone/2.17.2",
                })
                self.plugin.logger.info("Voice chat connected.")
                self.plugin.server.scheduler.run_task(self.plugin, self.announce_online)
                delay = 2
                threading.Thread(target=self._keepalive, args=(self.ws,), daemon=True).start()
                while not self.stopped:
                    self._on_message(self.ws.recv_text())
            except Exception as e:
                if not self.stopped:
                    self.plugin.logger.warning(f"Voice chat disconnected ({e}). Retrying in {delay}s.")
            self.active = False
            self.ws = None
            self.wanted = {}
            self.plugin.server.scheduler.run_task(self.plugin, self._apply_icons)
            if self.stopped:
                return
            time.sleep(delay)
            delay = min(delay * 2, 60)

    def _keepalive(self, ws):
        while not self.stopped and self.ws is ws:
            time.sleep(25)
            try:
                ws.send_text("ping")
            except Exception:
                return

    def _on_message(self, text):
        if text == "pong":
            return
        try:
            msg = json.loads(text)
        except ValueError:
            return
        if msg.get("type") == "active":
            self.active = bool(msg.get("on"))
        elif msg.get("type") == "ranks":
            self.plugin.ranks.update(msg)
        elif msg.get("type") == "shop":
            self._on_main(lambda: self.plugin.shop.update_from_website(msg))
        elif msg.get("type") == "help":
            self._on_main(lambda: self.plugin.help.update_from_website(msg))
        elif msg.get("type") == "plans":
            self._on_main(lambda: self.plugin.plans.update_from_website(msg))
        elif msg.get("type") == "words":
            self._on_main(lambda: self.plugin.chatfilter.update_words(msg.get("words")))
        elif msg.get("type") == "chatfilter":
            self._on_main(lambda: self.plugin.chatfilter.set_enabled(msg.get("enabled"), msg.get("by") or "staff on the website"))
        elif msg.get("type") == "ah_buy":
            self._on_main(lambda: self.plugin.auction.from_website(msg))
        elif msg.get("type") == "eco":
            self._on_main(lambda: self.plugin.economy.from_website(msg))
        elif msg.get("type") == "icons":
            self.wanted = {k.lower(): v for k, v in (msg.get("icons") or {}).items()}
            self.plugin.server.scheduler.run_task(self.plugin, self._apply_icons)

    def _on_main(self, fn):
        def run():
            try:
                fn()
            except Exception as e:
                self.plugin.logger.warning(f"Couldn't apply a change from the website: {e}")
        self.plugin.server.scheduler.run_task(self.plugin, run)

    # ---------- main server thread ----------
    def _tick(self):
        self._ticks = getattr(self, "_ticks", 0) + 1
        if self._ticks % 4 == 0:
            self._apply_icons()  # catches players who just joined the server
        if self.ws and (self._ticks % STATUS_EVERY == 1 or getattr(self, "_status_ws", None) is not self.ws):
            self._status_ws = self.ws
            self._send_status(self.ws)
        if not self.active or not self.ws:
            return
        players = []
        for p in self.plugin.server.online_players:
            try:
                loc = p.location
                players.append({
                    "uuid": str(p.unique_id),
                    "x": round(loc.x, 2), "y": round(loc.y, 2), "z": round(loc.z, 2),
                    "yaw": round(loc.yaw, 1),
                    "dim": p.dimension.name,
                })
            except Exception:
                continue
        ws = self.ws
        payload = json.dumps({"type": "positions", "players": players})
        threading.Thread(target=self._safe_send, args=(ws, payload), daemon=True).start()

    def _send_status(self, ws):
        server = self.plugin.server
        try:
            info = {"type": "server", "online": len(server.online_players), "max": int(server.max_players)}
            try:
                info["version"] = str(server.minecraft_version)
            except Exception:
                pass
        except Exception:
            return
        threading.Thread(target=self._safe_send, args=(ws, json.dumps(info)), daemon=True).start()

    def announce_online(self):
        """Tell the website which players are here (so ranks can be given on the website) and everyone's money."""
        self.send_seen(list(self.plugin.server.online_players))
        try:
            self.plugin.chatfilter.report()
        except Exception as e:
            self.plugin.logger.warning(f"Couldn't send the chat filter state to the website: {e}")
        try:
            self.plugin.minigames.push()
        except Exception as e:
            self.plugin.logger.warning(f"Couldn't send minigames to the website: {e}")
        try:
            self.plugin.auction.push()
        except Exception as e:
            self.plugin.logger.warning(f"Couldn't send Auction House listings to the website: {e}")
        try:
            self.send_json(self.plugin.progress.definitions())
            self.plugin.progress.push(everything=True)
        except Exception as e:
            self.plugin.logger.warning(f"Couldn't send stats to the website: {e}")
        try:
            self.plugin.economy.sync(everything=True)
        except Exception as e:
            self.plugin.logger.warning(f"Couldn't send balances to the website: {e}")

    def send_json(self, obj):
        ws = self.ws
        if ws:
            threading.Thread(target=self._safe_send, args=(ws, json.dumps(obj)), daemon=True).start()

    def send_seen(self, players):
        ws = self.ws
        if not ws or not players:
            return
        payload = json.dumps({"type": "seen", "players": [
            {"xuid": str(p.xuid), "uuid": str(p.unique_id), "name": p.name} for p in players]})
        threading.Thread(target=self._safe_send, args=(ws, payload), daemon=True).start()

    def _safe_send(self, ws, payload):
        try:
            ws.send_text(payload)
        except Exception:
            pass

    def _apply_icons(self):
        for p in self.plugin.server.online_players:
            key = str(p.unique_id).lower()
            icon = self.wanted.get(key, "disconnected")
            tag = self.plugin.compose_tag(p, ICONS.get(icon))
            if self.applied.get(key) == tag:
                continue
            try:
                p.name_tag = tag
                self.applied[key] = tag
            except Exception:
                pass
        online = {str(p.unique_id).lower() for p in self.plugin.server.online_players}
        for key in list(self.applied):
            if key not in online:
                del self.applied[key]
