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
import queue
import threading
import time
import urllib.parse

# Shown before a player's name above their head, like Simple Voice Chat.
# These characters are drawn by the "GalaxySMP Voice Icons" resource pack
# (resource-pack/ in the website repository), which the server sends to players.
ICONS = {
    "talking": "\uf700",         # white speaker: talking nearby
    "talking_group": "\uf701",   # green speaker: talking in a group
    "talking_global": "\uf702",  # gold speaker: talking on the Global Mic
    "muted": "\uf703",           # microphone crossed out: muted themselves
    "deafened": "\uf704",        # headphones crossed out: deafened
    "voice_muted": "\uf705",     # grey microphone crossed out: muted by staff
    "disconnected": "\uf706",    # unplugged cable: not connected to voice
}
# In voice and quiet ("connected") shows no icon, like Simple Voice Chat.

POSITION_TICKS = 6  # 20 ticks = 1 second, so about 3 updates per second
STATUS_EVERY = 50   # x POSITION_TICKS = every 15 seconds: player count for the website status page


def _xor(data, mask):
    """WebSocket masking, done on whole numbers at once (much faster than byte by byte)."""
    n = len(data)
    if not n:
        return b""
    m = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "big") ^ int.from_bytes(m, "big")).to_bytes(n, "big")


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
        # the website answers our ping every 25 seconds, so 90 seconds of silence means the connection is dead
        self.sock.settimeout(90)
        # one sending thread with a queue (instead of a new thread for every message)
        self.queue = queue.Queue(maxsize=1000)
        self.dropped = 0
        threading.Thread(target=self._sender, daemon=True).start()

    def post(self, text):
        """Queues a text message to send (never blocks the game). Drops it if the queue is full."""
        try:
            self.queue.put_nowait(text)
        except queue.Full:
            self.dropped += 1

    def _sender(self):
        while True:
            text = self.queue.get()
            if text is None:
                return
            try:
                self.send_text(text)
            except Exception:
                try:
                    self.sock.close()   # the reader notices and reconnects
                except Exception:
                    pass
                return

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
        masked = _xor(payload, mask)
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
                payload = _xor(payload, mask)
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
            self.queue.put_nowait(None)
        except Exception:
            pass
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
        tick = self.plugin._safe("voice chat positions", self._tick) if hasattr(self.plugin, "_safe") else self._tick
        self.task = self.plugin.server.scheduler.run_task(self.plugin, tick, delay=POSITION_TICKS, period=POSITION_TICKS)

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
                    "User-Agent": "GalaxyLink-Endstone/2.84.0",
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
        elif msg.get("type") == "teams":
            self._on_main(lambda m=msg: (self.plugin.teams.update(m), self.plugin.refresh_tags()))
        elif msg.get("type") == "potm":
            self._on_main(lambda m=msg: self.plugin.potm.update(m))
        elif msg.get("type") == "potm_result":
            self._on_main(lambda m=msg: self.plugin.potm.result(m))
        elif msg.get("type") == "teamchat":
            self.plugin.server.scheduler.run_task(self.plugin, lambda m=msg: self.plugin.teams.from_website(m))
        elif msg.get("type") == "ranks":
            self._on_main(lambda m=msg: self.plugin.ranks.update(m))
        elif msg.get("type") == "shop":
            self._on_main(lambda: self.plugin.shop.update_from_website(msg))
        elif msg.get("type") == "help":
            self._on_main(lambda: self.plugin.help.update_from_website(msg))
        elif msg.get("type") == "backup_now":
            self._on_main(lambda: self.plugin.backups.start("from the website"))
        elif msg.get("type") == "backup_restore" and msg.get("key"):
            self._on_main(lambda m=msg: self.plugin.backups.restore(str(m["key"]), str(m.get("by") or "")))
        elif msg.get("type") == "web_mute":  # muted or unmuted on the website: the same in game
            self._on_main(lambda m=msg: self.plugin.moderation.web_mute(m))
        elif msg.get("type") == "welcome":
            self._on_main(lambda: self.plugin.welcome.update_from_website(msg))
        elif msg.get("type") == "plans":
            self._on_main(lambda: self.plugin.plans.update_from_website(msg))
        elif msg.get("type") == "words":
            self._on_main(lambda: self.plugin.chatfilter.update_words(msg.get("words")))
        elif msg.get("type") == "chatfilter":
            self._on_main(lambda: self.plugin.chatfilter.set_enabled(msg.get("enabled"), msg.get("by") or "staff on the website"))
        elif msg.get("type") == "trade":  # trades started on the website (galaxymc.us/trades)
            self._on_main(lambda: self.plugin.trades.from_website(msg))
        elif msg.get("type") == "server_control":  # maintenance / restart / welcome kit (Control Panel)
            self._on_main(lambda: self.plugin.servercontrol.update(msg))
        elif msg.get("type") == "allowlist":  # owner approved a join request on the website
            self._on_main(lambda: self._allowlist(msg))
        elif msg.get("type") == "shopchest_buy":  # Buy on galaxymc.us/shops
            self._on_main(lambda: self.plugin.shopchests.from_website(msg))
        elif msg.get("type") == "ah_buy":
            self._on_main(lambda: self.plugin.auction.from_website(msg))
        elif msg.get("type") == "plots_market":  # buy or rent a plot in the Marketplace
            self._on_main(lambda: self.plugin.plotplus.from_website(msg))
        elif msg.get("type") == "visit":  # Visit on galaxymc.us/map (a public plot or a warp)
            self._on_main(lambda: self.plugin.visits.from_website(msg))
        elif msg.get("type") == "web_tpa":  # Teleport request from the Friends list on the website
            self._on_main(lambda: self.plugin.visits.web_tpa(msg))
        elif msg.get("type") == "market":  # Marketplace on the website: sell from your inventory, buy orders
            self._on_main(lambda: self.plugin.market.from_website(msg))
        elif msg.get("type") == "goal":  # the server-wide goal and its progress (website, every few minutes)
            self._on_main(lambda: self.plugin.goals.from_website(msg))
        elif msg.get("type") == "plot_public":  # the owner made their plot public/private on the website map
            self._on_main(lambda: self.plugin.plots.public_from_website(msg))
        elif msg.get("type") == "webchat":  # someone wrote in #Chat on the website
            self._on_main(lambda: self.plugin.gamechat.from_website(msg))
        elif msg.get("type") == "job":  # #Jobs on the website: hold the reward
            self._on_main(lambda: self.plugin.jobboard.from_website(msg))
        elif msg.get("type") == "rewards":  # referrals, season pass, server goals
            self._on_main(lambda: self.plugin.rewards.from_website(msg))
        elif msg.get("type") == "eco":
            self._on_main(lambda: self.plugin.economy.from_website(msg))
        elif msg.get("type") == "announce":
            self._on_main(lambda: self.plugin.announcements.announce(str(msg.get("text") or "")[:300], by=str(msg.get("by") or "staff")))
        elif msg.get("type") == "stream_live":  # someone this player follows went live on the website (#Streams)
            def tell_live():
                wanted = {str(x) for x in (msg.get("xuids") or [])}
                text = str(msg.get("text") or "")[:200]
                for p in self.plugin.server.online_players:
                    if str(p.xuid) in wanted:
                        p.send_message(f"§d● LIVE §f{text}")
            self._on_main(tell_live)
        elif msg.get("type") == "support_reply":  # staff answered a /support request on the website
            self._on_main(lambda: self.plugin.support.deliver(msg.get("xuid"), msg.get("text")))
        elif msg.get("type") == "ah_alert":  # Auction House price alerts matched new listings
            self._on_main(lambda: self.plugin.auction.alert_hits(msg.get("alerts")))
        elif msg.get("type") == "voice_invite":
            def tell():
                p = next((x for x in self.plugin.server.online_players if str(x.xuid) == str(msg.get("toXuid"))), None)
                if p is not None:
                    p.send_message(f"§b{str(msg.get('from'))[:32]}§7 invited you to the voice group §b{str(msg.get('group'))[:24]}§7. "
                                   "Join on §egalaxymc.us/voice§7 (Voice Chat > Groups).")
            self._on_main(tell)
        elif msg.get("type") == "dm":
            self._on_main(lambda: self.plugin.dms.deliver(msg))
        elif msg.get("type") == "staff_alert":
            text = str(msg.get("text") or "")[:200].replace("§", "")
            self._on_main(lambda: [p.send_message(f"§d[Staff] §f{text}") for p in self.plugin.moderation.staff_online()])
        elif msg.get("type") == "mod_action":
            self._on_main(lambda: self._mod_action(msg))
        elif msg.get("type") == "givekey":
            self._on_main(lambda: self.plugin.crates.give_keys(WebActor(msg.get("by")), str(msg.get("name") or ""),
                                                               str(msg.get("kind") or "common"), max(1, min(1000, int(msg.get("amount") or 1)))))
        elif msg.get("type") == "setop":
            self._on_main(lambda: self.plugin.set_operator(str(msg.get("xuid") or ""), str(msg.get("name") or ""), bool(msg.get("op")), str(msg.get("by") or "the website")))
        elif msg.get("type") == "map":  # server map switched on/off in the Control Panel
            lm = getattr(self.plugin, "livemap", None)
            if lm is not None:
                self._on_main(lambda: lm.set_enabled(bool(msg.get("enabled"))))
        elif msg.get("type") == "icons":
            self.wanted = {k.lower(): v for k, v in (msg.get("icons") or {}).items()}
            self.plugin.server.scheduler.run_task(self.plugin, self._apply_icons)

    def _allowlist(self, msg):
        """The server's allowlist from the website (join requests and Control Panel > Server control).
        action: add (default), remove, add_many, list. Always answers."""
        import json as _json
        from pathlib import Path
        server = self.plugin.server
        action = str(msg.get("action") or "add")
        by = str(msg.get("by") or "The owner")[:32]

        def clean(n):
            return "".join(c for c in str(n or "") if c.isalnum() or c == " ").strip()[:16]

        def run(cmd):
            try:
                return server.dispatch_command(server.command_sender, cmd) is not False
            except Exception as e:
                self.plugin.logger.warning(f"Allowlist command failed ({cmd}): {e}")
                return False

        ok, text, names = True, "", None
        if action == "list":
            try:
                path = Path("allowlist.json")
                entries = _json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
                names = sorted({str(e.get("name") or "") for e in entries if isinstance(e, dict) and e.get("name")}, key=str.lower)
            except Exception as e:
                ok, text = False, f"The allowlist file couldn't be read: {e}"
        elif action == "remove":
            name = clean(msg.get("name"))
            ok = bool(name) and run(f'allowlist remove "{name}"')
            text = f"{name} was removed from the allowlist." if ok else "That name couldn't be removed."
            self.plugin.logger.info(f"[Website] {by}: allowlist remove {name} -> {ok}")
        else:
            wanted = [clean(n) for n in (msg.get("names") or [msg.get("name")])][:200]
            wanted = [n for n in wanted if n]
            done = [n for n in wanted if run(f'allowlist add "{n}"')]
            ok = bool(done) or not wanted
            text = (f"{done[0]} was added to the allowlist." if len(done) == 1 else f"{len(done)} players were added to the allowlist.") if done else "That gamertag isn't valid."
            self.plugin.logger.info(f"[Website] {by}: allowlist add {', '.join(done)} -> {ok}")
        reply = {"type": "answer", "req": msg.get("req"), "ok": ok, "message": text}
        if names is not None:
            reply["names"] = names
        self.send_json(reply)

    def _mod_action(self, msg):
        """Warn / mute / unmute / kick / ban / unban from the staff panel on the website."""
        mod = self.plugin.moderation
        actor = WebActor(msg.get("by"))
        xuid, name = str(msg.get("xuid") or ""), str(msg.get("name") or "")
        reason = str(msg.get("reason") or "")[:200]
        minutes = msg.get("minutes")
        minutes = None if minutes in (None, "", 0) else max(1, int(minutes))
        kind = msg.get("action")
        if kind == "warn":
            mod.warn(actor, xuid, name, reason)
        elif kind == "mute":
            mod.mute(actor, xuid, name, minutes or 60, reason)
        elif kind == "unmute":
            mod.unmute(actor, xuid, name)
        elif kind == "kick":
            mod.kick(actor, xuid, name, reason)
        elif kind == "ban":
            mod.ban(actor, xuid, name, minutes, reason)
        elif kind == "unban":
            mod.unban(actor, xuid, name)
        for line in actor.lines:
            self.plugin.logger.info(f"[Website] {line}")

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
        if self.ws and self._ticks % 40 == 0 and not getattr(self.plugin.ranks, "received_at", 0):
            self.send_json({"type": "need_ranks"})  # connected but the ranks didn't arrive: ask again
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
        self._safe_send(ws, payload)

    def _send_status(self, ws):
        server = self.plugin.server
        try:
            info = {"type": "server", "online": len(server.online_players), "max": int(server.max_players)}
            info["players"] = [{"xuid": str(p.xuid), "name": p.name, "doing": self.doing(p)} for p in list(server.online_players)[:60]]
            try:
                from endstone_galaxylink.plugin import VERSION
                info["plugin"] = VERSION
                from endstone_galaxylink.ranktags import world_packs
                icons = [v for p, v in world_packs("resource") if p == "6b0f4c3e-2d1a-4a8e-9c5b-1f7e3a9d2c41"]
                info["iconsPack"] = ".".join(map(str, max(icons))) if icons else "missing"
                from endstone_galaxylink.ranktags import glyph_conflicts
                info["iconConflicts"] = [f"{n} ({pg})" for n, pg in glyph_conflicts()][:5]
            except Exception:
                pass
            try:
                info["version"] = str(server.minecraft_version)
            except Exception:
                pass
        except Exception:
            return
        self._safe_send(ws, json.dumps(info))

    def doing(self, p):
        """What a player is up to, in a few words (for "who's online" on the home page)."""
        pl = self.plugin
        try:
            afk = getattr(pl, "afk", None)
            if afk is not None and afk.is_afk(p):
                return "AFK"
            bw = getattr(pl, "bedwars", None)
            if bw is not None:
                uid = str(p.unique_id)
                if uid in bw.queue:
                    return "Waiting for Bedwars"
                if uid in bw.players:
                    return "Playing Bedwars"
            bc = getattr(pl, "buildcontest", None)
            if bc is not None and bc.building(p):
                return "In a Build Contest"
            dim = p.dimension.name.lower()
            if "nether" in dim:
                return "In the Nether"
            if "end" in dim:
                return "In the End"
            plots = getattr(pl, "plots", None)
            if plots is not None:
                l = p.location
                plot = plots.at(p.dimension.name, l.x, l.y, l.z)
                if plot and plot.get("owner") == str(p.xuid):
                    return "Building on their plot"
        except Exception:
            pass
        return "Exploring"

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
            self.plugin.crates.push()  # the Crate Odds page
        except Exception as e:
            self.plugin.logger.warning(f"Couldn't send crate odds to the website: {e}")
        try:
            self.plugin.auction.push()
            if getattr(self.plugin, "market", None):
                self.plugin.market.push()
            if getattr(self.plugin, "parkour", None):
                self.plugin.parkour.push()
            if getattr(self.plugin, "collection", None):
                self.plugin.collection.resend(self)
            if getattr(self.plugin, "plotplus", None):
                self.plugin.plotplus.push()
        except Exception as e:
            self.plugin.logger.warning(f"Couldn't send Auction House listings to the website: {e}")
        self.plugin.shopchests.push()
        try:
            from endstone_galaxylink.heads import send_head
            for p in list(self.plugin.server.online_players):
                send_head(self.plugin, p)
        except Exception as e:
            self.plugin.logger.warning(f"Couldn't send player heads to the website: {e}")
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
            self._safe_send(ws, json.dumps(obj))

    def send_seen(self, players):
        ws = self.ws
        if not ws or not players:
            return
        payload = json.dumps({"type": "seen", "players": [
            {"xuid": str(p.xuid), "uuid": str(p.unique_id), "name": p.name} for p in players]})
        self._safe_send(ws, payload)

    def _safe_send(self, ws, payload):
        try:
            if ws is not None:
                ws.post(payload)
        except Exception:
            pass

    def _apply_icons(self):
        for p in self.plugin.server.online_players:
            key = str(p.unique_id).lower()
            icon = self.wanted.get(key, "disconnected")
            tag = self.plugin.compose_tag(p, ICONS.get(icon))
            try:
                current = p.name_tag
            except Exception:
                current = None
            if current == tag:
                self.applied[key] = tag
                continue
            if self.applied.get(key) == tag and current is not None and not getattr(self, "_overwrite_warned", False):
                # we set it before and something else (another plugin) changed it: say so once, then put ours back
                self._overwrite_warned = True
                self.plugin.logger.warning(f"Another plugin changed {p.name}'s name above their head to {current!r}. "
                                           "GalaxyLink puts the rank badge back; if this keeps happening, turn off name tags in the other plugin.")
            try:
                p.name_tag = tag
                self.applied[key] = tag
            except Exception:
                pass
        online = {str(p.unique_id).lower() for p in self.plugin.server.online_players}
        for key in list(self.applied):
            if key not in online:
                del self.applied[key]


class WebActor:
    """Stands in for a staff member acting from the website (like the console: no in-game limits;
    the website already checked their permissions)."""

    def __init__(self, by):
        self.name = f"{str(by or 'Staff')[:32]} (website)"
        self.lines = []

    def send_message(self, text):
        import re
        self.lines.append(re.sub("§.", "", str(text)))
