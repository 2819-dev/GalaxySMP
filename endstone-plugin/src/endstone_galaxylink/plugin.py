"""GalaxyLink for Endstone (Bedrock Dedicated Server).

Adds /link CODE. The code comes from the GalaxySMP website; this plugin sends it,
with the player's gamertag and ID, to the website to prove they own that account.
"""

import json
import threading
import time
import urllib.error
import urllib.request

from endstone import ColorFormat, Player
from endstone.command import Command, CommandSender
from endstone.plugin import Plugin

from endstone_galaxylink import settings

COOLDOWN_SECONDS = 5
TIMEOUT_SECONDS = 15


class GalaxyLink(Plugin):
    api_version = "0.5"
    description = "Links Bedrock players to their GalaxySMP website account."
    website = "https://galaxymc.us"

    commands = {
        "link": {
            "description": "Link your account to the GalaxySMP website.",
            "usages": ["/link <code: message>"],
            "permissions": ["galaxylink.command.link"],
        }
    }
    permissions = {
        "galaxylink.command.link": {
            "description": "Allows players to use /link.",
            "default": True,
        }
    }

    def on_enable(self) -> None:
        self._last_use = {}
        self._base = settings.WEBSITE.rstrip("/")
        if not settings.SECRET or settings.SECRET.startswith("PASTE_"):
            self.logger.warning("GalaxyLink is missing its secret. Download a fresh build from the website team.")
            return
        threading.Thread(target=self._ping, daemon=True).start()

    # ---------- Website requests (run on a background thread) ----------
    def _request(self, path, body=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            self._base + path,
            data=data,
            method="POST" if data is not None else "GET",
            headers={
                "Authorization": "Bearer " + settings.SECRET,
                "Content-Type": "application/json",
                "User-Agent": "GalaxyLink-Endstone/2.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as res:
                return res.status, json.loads(res.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read().decode("utf-8") or "{}")
            except ValueError:
                payload = {}
            return e.code, payload

    def _ping(self):
        try:
            status, data = self._request("/api/plugin/ping")
            if status == 200:
                self.logger.info("Connected to the GalaxySMP website. /link is ready.")
            else:
                self.logger.warning(f"Website answered {status}: {data.get('error', data)}")
        except Exception as e:  # network problems
            self.logger.warning(f"Could not reach the website at {self._base}: {e}")

    # ---------- /link ----------
    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if command.name != "link":
            return False
        if not isinstance(sender, Player):
            sender.send_message("This command can only be used by players.")
            return True

        code = " ".join(args).strip()
        if not code:
            sender.send_message(f"{ColorFormat.YELLOW}Usage: /link <code>. Generate a code on galaxymc.us/community.")
            return True

        player_id = str(sender.unique_id)
        now = time.monotonic()
        if now - self._last_use.get(player_id, 0) < COOLDOWN_SECONDS:
            sender.send_message(f"{ColorFormat.YELLOW}Please wait a few seconds before trying again.")
            return True
        self._last_use[player_id] = now

        name = sender.name
        sender.send_message(f"{ColorFormat.GRAY}Verifying your code...")
        body = {"code": code, "uuid": player_id, "name": name, "bedrock": True, "xuid": sender.xuid}
        threading.Thread(target=self._link, args=(body, sender.unique_id), daemon=True).start()
        return True

    def _link(self, body, unique_id):
        try:
            status, data = self._request("/api/plugin/link", body)
            ok = bool(data.get("ok"))
            message = data.get("message") or data.get("error") or "Unknown reply from the website."
            if status != 200:
                self.logger.warning(f"Link failed ({status}): {message}")
        except Exception as e:
            ok = False
            message = "The website could not be reached. Please try again shortly."
            self.logger.warning(f"Could not reach the website: {e}")

        color = ColorFormat.GREEN if ok else ColorFormat.RED

        def reply():
            player = self.server.get_player(unique_id)
            if player is not None:
                player.send_message(color + message)

        # Talk to the player from the main server thread.
        self.server.scheduler.run_task(self, reply)
