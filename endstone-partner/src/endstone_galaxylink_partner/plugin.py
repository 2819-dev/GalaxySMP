"""GalaxySMP Network (for Network Servers): GalaxySMP ranks, operator access for GalaxySMP's owner and admins, and the
network logo pack. See core.py for exactly what it does (and never does). No token is ever logged or shown."""
import json
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from endstone.command import Command, CommandSender
from endstone.event import PlayerChatEvent, PlayerJoinEvent, PlayerQuitEvent, event_handler
from endstone.plugin import Plugin

from endstone_galaxylink_partner import core

VERSION = "1.0.0"
TIMEOUT = 15


class GalaxyNetwork(Plugin):
    api_version = "0.5"
    description = "GalaxySMP Network: GalaxySMP ranks, operator access for GalaxySMP's admin team and the network logo."
    website = "https://galaxymc.us"

    commands = {
        "network": {"description": "GalaxySMP Network status (operators only). /network reload checks the setup file and logo pack again.",
                    "usages": ["/network [action: message]"], "permissions": ["galaxynetwork.command.network"]},
    }
    permissions = {
        "galaxynetwork.command.network": {"description": "Allows /network (server operators).", "default": "op"},
    }

    # ---------- start ----------
    def on_enable(self) -> None:
        self.folder = Path(self.data_folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        example = self.folder / "config.example.json"
        if not example.exists():
            try:
                example.write_text(json.dumps({"token": "gp_PASTE_THE_TOKEN_FROM_GALAXYSMP_HERE", "website": core.WEBSITE}, indent=2) + "\n", "utf-8")
            except Exception:
                pass
        self.state = self._load_state()
        self.tags = {}          # xuid -> {"prefix", "color", "name"}: the GalaxySMP rank tag of each player we know
        self.shown = {}         # xuid -> the name tag we put above their head
        self.wanted = set(self.state.get("wanted", []))   # who GalaxySMP says should be an operator here (last answer)
        self.busy = False
        self.next_sync = 0.0
        self.fails = 0
        self.last_ok = None
        self.last_error = None
        self.last_players = 0
        self.warned = {}
        self.link, self.problem = None, None
        self.reload()
        self.register_events(self)
        self.server.scheduler.run_task(self, self._tick, delay=60, period=20)

    def reload(self):
        """Reads the setup file and installs the logo pack. Safe to run again."""
        self.link, self.problem = core.load_config(self.folder)
        if self.problem:
            self._warn("config", self.problem, 3600)
        else:
            self.logger.info("GalaxySMP Network: setup file found. Connecting to galaxymc.us...")
            self.next_sync = 0.0
        self.install_logo()

    def on_disable(self) -> None:
        self._save_state()

    # ---------- the saved state (only things this plugin did itself) ----------
    def _load_state(self):
        try:
            data = json.loads((self.folder / "state.json").read_text("utf-8"))
            if isinstance(data, dict):
                data.setdefault("granted", {})
                data.setdefault("packs", {})
                data.setdefault("wanted", [])
                return data
        except Exception:
            pass
        return {"granted": {}, "packs": {}, "wanted": []}

    def _save_state(self):
        self.state["wanted"] = sorted(self.wanted)
        try:
            tmp = self.folder / "state.json.tmp"
            tmp.write_text(json.dumps(self.state), "utf-8")
            tmp.replace(self.folder / "state.json")
        except Exception as e:
            self._warn("state", f"Couldn't save its notes: {e}", 600)

    def _warn(self, key, text, every):
        if time.time() - self.warned.get(key, 0) >= every:
            self.warned[key] = time.time()
            self.logger.warning(f"GalaxySMP Network: {text}")

    # ---------- the logo pack ----------
    def install_logo(self):
        root = Path.cwd()
        found = sorted(self.folder.glob("*.mcpack"))
        for pack in found:
            message, changed = core.install_pack(pack, root, core.level_folder(root), self.state["packs"])
            if message:
                (self.logger.info if changed else self.logger.warning)(f"GalaxySMP Network: {message}")
            if changed:
                self._save_state()
        if found and (core.server_property(root, "texturepack-required", "false") or "false").lower() != "true":
            self._warn("texturepack", "Tip: set texturepack-required=true in server.properties so every player gets the logo.", 86400)

    # ---------- talking to galaxymc.us (on a background thread) ----------
    def _tick(self):
        if not self.link or self.busy or time.time() < self.next_sync:
            return
        players = [{"xuid": str(p.xuid), "name": p.name} for p in self.server.online_players][:300]
        self.busy = True
        threading.Thread(target=self._sync_thread, args=(players,), daemon=True).start()

    def _post(self, path, body):
        req = urllib.request.Request(
            self.link["website"] + path, data=json.dumps(body).encode("utf-8"), method="POST",
            headers={"Authorization": "Bearer " + self.link["token"], "Content-Type": "application/json", "User-Agent": "GalaxyNetwork-Partner/" + VERSION})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
                return res.status, json.loads(res.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read().decode("utf-8") or "{}")
            except ValueError:
                return e.code, {}

    def _sync_thread(self, players):
        try:
            status, data = self._post("/api/partner/sync", {"version": VERSION, "players": players})
        except Exception as e:
            status, data = 0, {"error": f"{type(e).__name__}: {e}"}
        self.last_players = len(players)
        self.server.scheduler.run_task(self, lambda: self._finish(status, data))

    def _finish(self, status, data):
        self.busy = False
        seconds = self.link["sync_seconds"] if self.link else core.SYNC_SECONDS
        if status == 200 and isinstance(data, dict) and data.get("ok"):
            self.fails, self.last_error, self.last_ok = 0, None, time.time()
            self.next_sync = time.time() + seconds
            self.apply(data)
            return
        if status == 401:
            # paused, reset or removed on GalaxySMP's side: stop showing ranks and take back the operator access we gave
            self.last_error = "GalaxySMP doesn't accept this setup file (the connection was paused or reset)."
            self._warn("401", self.last_error + " Ask GalaxySMP for a new setup file.", 3600)
            self.next_sync = time.time() + 300
            self.apply({"tags": {}, "operators": []})
            return
        self.fails += 1
        error = data.get("error") if isinstance(data, dict) else None
        self.last_error = error or (f"the website answered {status}" if status else "no connection")
        self.next_sync = time.time() + min(300, seconds * (2 ** min(self.fails, 3)))
        self._warn("sync", f"Couldn't reach galaxymc.us ({self.last_error}). Ranks and operators stay as they were; trying again soon.", 600)

    # ---------- applying what the website says ----------
    def apply(self, data):
        tags = {}
        for xuid, raw in (data.get("tags") or {}).items():
            tag = core.clean_tag(raw)
            if tag and re.fullmatch(r"\d{1,20}", str(xuid)):
                tags[str(xuid)] = tag
        self.tags = tags
        self.wanted = {str(x) for x in (data.get("operators") or []) if re.fullmatch(r"\d{1,20}", str(x))}
        self._save_state()
        for p in list(self.server.online_players):
            self.refresh(p)

    def refresh(self, player):
        """Their rank above the head, and operator access if GalaxySMP says so (or taken back if it no longer does)."""
        xuid = str(player.xuid)
        tag = self.tags.get(xuid)
        text = core.name_tag(player.name, tag) if tag else None
        if text != self.shown.get(xuid):
            try:
                player.name_tag = text if text else player.name
            except Exception:
                pass
            if text:
                self.shown[xuid] = text
            else:
                self.shown.pop(xuid, None)
        add, remove = core.plan_operators(self.wanted & {xuid}, set(self.state["granted"]) & {xuid}, {xuid} if player.is_op else set())
        if xuid in add:
            self._set_op(player, True)
            self.state["granted"][xuid] = player.name
            self._save_state()
            try:
                player.send_message("§bGalaxySMP Network: §fyou're an operator here as part of the GalaxySMP admin team.")
            except Exception:
                pass
        elif xuid in remove:
            self._set_op(player, False)
            self.state["granted"].pop(xuid, None)
            self._save_state()

    def _set_op(self, player, on):
        try:
            player.is_op = on
        except Exception:
            pass
        name = player.name.replace('"', "")
        try:
            self.server.dispatch_command(self.server.command_sender, f'{"op" if on else "deop"} "{name}"')
        except Exception:
            pass

    # ---------- events ----------
    @event_handler
    def on_join(self, event: PlayerJoinEvent):
        player = event.player
        self.refresh(player)
        if self.link and time.time() >= self.next_sync - self.link["sync_seconds"] + 10:
            self.next_sync = min(self.next_sync, time.time() + 2)   # someone new: ask for their rank soon (at most every 10 s)

    @event_handler
    def on_quit(self, event: PlayerQuitEvent):
        self.shown.pop(str(event.player.xuid), None)

    @event_handler
    def on_chat(self, event: PlayerChatEvent):
        tag = self.tags.get(str(event.player.xuid))
        if tag:
            event.format = core.chat_format(tag)

    # ---------- /network ----------
    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if command.name != "network":
            return False
        if " ".join(args).strip().lower() == "reload":
            self.reload()
            sender.send_message("§bGalaxySMP Network: §fsetup file and logo pack checked again." + (f" §c{self.problem}" if self.problem else ""))
            return True
        online_ops = [p.name for p in self.server.online_players if str(p.xuid) in self.state["granted"]]
        if self.problem:
            link = f"§ewaiting for the setup file §7({self.problem})"
        elif self.last_ok:
            link = f"§aconnected §7(synced {core.ago(time.time() - self.last_ok)}, {self.last_players} players sent)"
        else:
            link = "§econnecting..." + (f" §c{self.last_error}" if self.last_error else "")
        if self.last_error and self.last_ok:
            link += f" §c(last problem: {self.last_error})"
        sender.send_message(
            f"§bGalaxySMP Network §7(plugin {VERSION})\n"
            f"§fConnection: {link}\n"
            f"§fRanks known: §a{len(self.tags)}§f · GalaxySMP admins online here as operators: §a{', '.join(online_ops) or 'none'}\n"
            f"§fLogo pack: §a{len(self.state['packs'])} installed" + ("" if self.state["packs"] else " §7(put the .mcpack in the plugin's folder, then /network reload)") + "\n"
            "§7What it sends: gamertags online, nothing else. Chat stays on this server; no menu is added.")
        return True
