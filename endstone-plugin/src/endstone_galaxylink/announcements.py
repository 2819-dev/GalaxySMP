"""In-game announcements: a darkened galaxy box near the top of everyone's screen for 30 seconds.
Announcements typed by staff play a chime; auto announcements show quietly.

/announcement (or /ann) opens the panel:
  - Announce now: type a message (colour codes like §3 work).
  - Auto announcements: messages that are announced at random every few minutes.

Only one announcement is ever on screen. If one is showing, the next waits in line until it's gone
(plus a short gap). Messages typed in the panel go before auto announcements, and auto
announcements only run when nothing else is waiting.

How the box works: the plugin sends a normal title that starts with a hidden marker (colour codes
spelling "announce"). The GalaxySMP resource pack (ui/hud_screen.json) spots the marker and draws
the box at the top instead of the big centred title. Without the pack it shows as a normal title.
"""

import json
import random
import time

from endstone.form import ActionForm, ModalForm, Slider, TextInput, Toggle

MARK = "§a§n§n§o§u§n§c§e"  # must match resource-pack/src/ui/hud_screen.json
SHOW_SECONDS = 30
GAP_SECONDS = 3            # quiet time between two announcements
MAX_LEN = 200
DEFAULT_MESSAGES = [
    "Need blocks, but don't wanna mine? Use §3/shop§r to buy blocks and items!",
    "Lost? Type §3/guide§r for the rules, commands and server info.",
    "Protect your builds! Use §3/plot§r to claim a plot.",
    "Sell your extra items with §3/sell§r, or list them on the Auction House with §3/ah§r.",
    "Want to play with friends? Find a Minigame Computer and host or join a game!",
    "Join the community at §3galaxymc.us§r: chat, events, suggestions and voice chat.",
]


def tidy(text):
    """One message: no line breaks from the text box, trimmed, length-limited."""
    return " ".join(str(text).split())[:MAX_LEN]


class Announcements:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        saved = self.eco.get_config("announcements") or {}
        self.auto_on = saved.get("auto_on", True)
        self.minutes = int(saved.get("minutes", 10))
        self.messages = saved.get("messages") if isinstance(saved.get("messages"), list) else list(DEFAULT_MESSAGES)
        self.queue = []          # waiting manual announcements: [{"text", "by"}]
        self.current = None      # {"text", "ends"} while one is on screen
        self.free_at = 0         # when the next one may start (end of current + gap)
        self.next_auto = time.time() + self.minutes * 60
        self.last_auto = None

    def save(self):
        self.eco.set_config("announcements", {"auto_on": self.auto_on, "minutes": self.minutes, "messages": self.messages})

    # ---------- showing ----------
    def _send(self, player, text, seconds):
        try:
            player.send_title(f"{MARK}§r{text}", "", 10, max(1, int(seconds * 20)), 10)
        except Exception:
            pass

    def _chime(self, player):
        try:
            loc = player.location
            player.play_sound(loc, "note.chime", 1.0, 1.0)
            player.play_sound(loc, "note.chime", 0.8, 1.5)
            player.play_sound(loc, "random.orb", 0.6, 1.2)
        except Exception:
            pass

    def show(self, text, chime=True):
        now = time.time()
        self.current = {"text": text, "ends": now + SHOW_SECONDS}
        self.free_at = now + SHOW_SECONDS + GAP_SECONDS
        for p in self.plugin.server.online_players:
            self._send(p, text, SHOW_SECONDS)
            if chime:  # only announcements typed by staff chime; auto ones show quietly
                self._chime(p)
        self.plugin.logger.info(f"[Announcement] {text}")

    def busy(self):
        return time.time() < self.free_at

    def tick(self):
        """Runs every second: starts the next announcement only when the last one has gone."""
        now = time.time()
        if self.current and now >= self.current["ends"]:
            self.current = None
        if self.busy():
            return
        if self.queue:
            self.show(self.queue.pop(0)["text"])
            return
        if self.auto_on and self.messages and now >= self.next_auto:
            if self.plugin.server.online_players:
                choices = [m for m in self.messages if m != self.last_auto] or self.messages
                self.last_auto = random.choice(choices)
                self.show(self.last_auto, chime=False)
            self.next_auto = now + self.minutes * 60

    def on_join(self, player):
        """Someone joining in the middle still sees the rest of the announcement (no chime)."""
        if self.current:
            left = self.current["ends"] - time.time()
            if left > 1:
                self._send(player, self.current["text"], left)

    def announce(self, text, by="staff"):
        """Adds a message to the line. Returns how many seconds until it shows."""
        text = tidy(text)
        if not text:
            return None
        wait = max(0, self.free_at - time.time()) + len(self.queue) * (SHOW_SECONDS + GAP_SECONDS)
        self.queue.append({"text": text, "by": by})
        # an auto announcement shouldn't fire right after a manual one
        self.next_auto = max(self.next_auto, time.time() + wait + SHOW_SECONDS + 60)
        self.tick()
        return int(wait)

    # ---------- /announce panel ----------
    def command(self, sender, args):
        text = " ".join(args).strip()
        if text:
            self._announce_and_tell(sender, text)
        elif hasattr(sender, "send_form"):
            self.panel(sender)
        else:
            sender.send_message("Usage: /announcement <message>")

    def _announce_and_tell(self, sender, text):
        wait = self.announce(text, getattr(sender, "name", "the console"))
        if wait is None:
            sender.send_message("§cType a message to announce.")
        elif wait == 0:
            sender.send_message("§aAnnounced to everyone.")
        else:
            sender.send_message(f"§eAnother announcement is showing. §7Yours is next in line and shows in about {wait}s.")

    def panel(self, player):
        status = f"§aon§r, every {self.minutes} min" if self.auto_on else "§coff"
        line = f"\n§7{len(self.queue)} waiting in line." if self.queue else ""
        form = ActionForm(title="§l§6Announcements",
                          content=f"Announcements show at the top of everyone's screen for {SHOW_SECONDS} seconds, with a chime. "
                                  f"Only one shows at a time.\n\nAuto announcements: {status}{line}")
        form.add_button("§lAnnounce now§r\n§8Type a message for everyone", icon="textures/ui/chat_send", on_click=self.announce_form)
        form.add_button(f"§lAuto announcements§r\n§8{len(self.messages)} message{'s' if len(self.messages) != 1 else ''}, {('on' if self.auto_on else 'off')}",
                        icon="textures/ui/timer", on_click=self.auto_menu)
        player.send_form(form)

    def announce_form(self, player, default=""):
        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            self._announce_and_tell(p, v[0])
        player.send_form(ModalForm(
            title="Announce now",
            controls=[TextInput("Message (colour codes work)", "e.g. Server event at spawn in 10 minutes!", default)],
            submit_button="Announce", on_submit=submit))

    def auto_menu(self, player):
        form = ActionForm(title="§l§6Auto announcements",
                          content=f"One of these is announced at random every {self.minutes} minutes"
                                  f" ({'§aon' if self.auto_on else '§coff'}§r). Tap one to change it.")
        form.add_button("§l+ Add a message", icon="textures/ui/color_plus", on_click=lambda p: self.edit_form(p, None))
        form.add_button("§lSettings§r\n§8On/off and how often", icon="textures/ui/settings_glyph_color_2x", on_click=self.settings_form)
        for i, m in enumerate(self.messages):
            form.add_button(m[:60] + ("…" if len(m) > 60 else ""), on_click=lambda p, i=i: self.message_menu(p, i))
        form.add_button("§l< Back", on_click=self.panel)
        player.send_form(form)

    def message_menu(self, player, i):
        if i >= len(self.messages):
            return self.auto_menu(player)
        form = ActionForm(title="Auto announcement", content=self.messages[i])
        form.add_button("§lAnnounce it now", on_click=lambda p: (self._announce_and_tell(p, self.messages[i]) if i < len(self.messages) else None))
        form.add_button("§lEdit", on_click=lambda p: self.edit_form(p, i))
        form.add_button("§c§lRemove", on_click=lambda p: self.remove(p, i))
        form.add_button("§l< Back", on_click=self.auto_menu)
        player.send_form(form)

    def edit_form(self, player, i):
        def submit(p, data):
            try:
                text = tidy(json.loads(data)[0])
            except (ValueError, IndexError):
                return
            if not text:
                p.send_message("§cThe message can't be empty.")
            elif i is None:
                self.messages.append(text)
                p.send_message("§aAuto announcement added.")
            elif i < len(self.messages):
                self.messages[i] = text
                p.send_message("§aAuto announcement saved.")
            self.save()
            self.auto_menu(p)
        player.send_form(ModalForm(
            title="Add a message" if i is None else "Edit message",
            controls=[TextInput("Message (colour codes work)", "e.g. Use /shop to buy blocks and items!",
                                "" if i is None else self.messages[i])],
            submit_button="Save", on_submit=submit))

    def remove(self, player, i):
        if i < len(self.messages):
            self.messages.pop(i)
            self.save()
            player.send_message("§7Auto announcement removed.")
        self.auto_menu(player)

    def settings_form(self, player):
        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            self.auto_on = bool(v[0])
            self.minutes = max(1, min(60, int(v[1])))
            self.next_auto = time.time() + self.minutes * 60
            self.save()
            p.send_message(f"§aSaved. §7Auto announcements are {'§aon' if self.auto_on else '§coff'}§7, every {self.minutes} minutes.")
            self.auto_menu(p)
        player.send_form(ModalForm(
            title="Auto announcement settings",
            controls=[Toggle("Auto announcements on", self.auto_on), Slider("Minutes between announcements", 1, 60, 1, self.minutes)],
            submit_button="Save", on_submit=submit))
