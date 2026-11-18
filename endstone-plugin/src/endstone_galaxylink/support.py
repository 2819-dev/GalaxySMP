"""/support: ask staff for help from inside the game.

A form opens with a box for your message. It's posted in #Staff Chat on the website as
"@Staff, <player> requests assistance." with the message (staff get a notification), and staff who are
online in game see it in chat right away.
"""

import json
import time

from endstone.form import ModalForm, TextInput

COOLDOWN = 60   # seconds between requests from the same player


def clean(text, limit):
    return " ".join(str(text or "").split())[:limit]


class Support:
    def __init__(self, plugin):
        self.plugin = plugin
        self.last = {}   # xuid -> when they last asked

    def command(self, player, args):
        wait = COOLDOWN - (time.time() - self.last.get(str(player.xuid), 0))
        if wait > 0:
            return player.send_message(f"§eStaff already have your request. You can send another in {int(wait) + 1}s.")

        def submit(p, data):
            try:
                text = clean(json.loads(data)[0], 500)
            except (ValueError, IndexError, TypeError):
                return
            if len(text) < 3:
                return p.send_message("§cPlease write what you need help with, then press Send.")
            self.send(p, text)

        player.send_form(ModalForm(
            title="§l§bAsk staff for help",
            controls=[TextInput("Tell staff what you need. They'll see it on the website and in game.",
                                "e.g. My items disappeared after I died", clean(" ".join(args), 500))],
            submit_button="Send to staff", on_submit=submit))

    def send(self, player, text):
        self.last[str(player.xuid)] = time.time()
        l = player.location
        body = {"name": player.name, "xuid": str(player.xuid), "message": text,
                "world": player.dimension.name, "x": int(l.x), "y": int(l.y), "z": int(l.z)}
        self.plugin.moderation.send("/api/plugin/support", body)   # retried until the website gets it
        player.send_message("§aSent! §7Staff have your message and will help you soon.")
        mod = self.plugin.moderation
        for s in mod.staff_online():
            if s is player:
                continue
            s.send_message(f"§b[Support] §f{player.name}§7 requests assistance: §f{text}")
            try:
                s.send_toast("§bSupport request", f"{player.name}: {text[:60]}")
                s.play_sound(s.location, "note.pling", 1.0, 1.4)
            except Exception:
                pass
