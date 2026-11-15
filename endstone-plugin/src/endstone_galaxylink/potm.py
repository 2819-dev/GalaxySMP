"""Player of the Month: Voting Computers.

Staff turn any block into a Voting Computer with /votecomputer (then tap the block). A label above it says
"Player of the Month". One switch opens or closes voting on every computer: staff use the Lock / Unlock button
on any computer (or /votecomputer), and the owner can also do it in the Control Panel on galaxymc.us.
  - Closed: tapping a computer shows "Voting Closed".
  - Open: "Start Voting" lets a player pick anyone who has ever joined (not banned, not themselves). One vote
    each per round; voting again while it's open changes the vote.
The votes are kept on the website and are secret: only the owner sees them (Control Panel > Server control).
"""

import json
import time
import uuid

from endstone.event import PlayerInteractEvent
from endstone.form import ActionForm, ModalForm, TextInput

LIST_LIMIT = 60  # names per page in the list


class PlayerOfTheMonth:
    def __init__(self, plugin):
        self.plugin = plugin
        self.computers = list(plugin.economy.get_config("potm_computers") or [])
        cached = plugin.economy.get_config("potm_state") or {}
        self.open = bool(cached.get("open"))
        self.round = int(cached.get("round") or 1)
        self.candidates = list(cached.get("candidates") or [])
        self.pending = {}     # staff unique id -> "place" | "remove" (their next tap)
        self.waiting = {}     # request id -> (player unique id, when)
        self.mine = {}        # xuid -> name they voted for this round (only shown to them)

    # ---------- saved data ----------
    def save(self):
        self.plugin.economy.set_config("potm_computers", self.computers)

    def at(self, block):
        for c in self.computers:
            if (c["dim"], c["x"], c["y"], c["z"]) == (block.dimension.name, block.x, block.y, block.z):
                return c
        return None

    def label_text(self):
        return "§6§l★ Player of the Month ★\n§r" + ("§aVoting is open: tap to vote" if self.open else "§7Voting closed")

    def label(self, c):
        ft = getattr(self.plugin, "floating", None)
        if ft:
            ft.set(f"potm:{c['id']}", c["dim"], c["x"] + 0.5, c["y"] + 1.3, c["z"] + 0.5, self.label_text())

    def relabel(self):
        for c in self.computers:
            self.label(c)

    # ---------- from the website ----------
    def update(self, msg):
        was_open = self.open
        new_round = int(msg.get("round") or 1)
        if new_round != self.round:
            self.mine = {}
        self.open = bool(msg.get("open"))
        self.round = new_round
        self.candidates = [{"xuid": str(c.get("xuid")), "name": str(c.get("name") or "")[:32]}
                           for c in (msg.get("candidates") or [])[:2000] if c.get("xuid")]
        self.plugin.economy.set_config("potm_state", {"open": self.open, "round": self.round, "candidates": self.candidates})
        self.relabel()
        if self.open != was_open:
            text = ("§6§l★ Player of the Month §r§avoting is open! §7Find a Voting Computer to vote." if self.open
                    else "§6§l★ Player of the Month §r§7voting is now closed. Thanks for voting!")
            for p in self.plugin.server.online_players:
                p.send_message(text)

    def result(self, msg):
        """The website answered a vote (or a staff open/close)."""
        req = msg.get("req")
        who = self.waiting.pop(req, None)
        if msg.get("mine") is not None or msg.get("ok"):
            if msg.get("mine"):
                self.mine[str(msg.get("xuid"))] = msg["mine"]
        if not who:
            return
        player = self.plugin.server.get_player(who[0])
        if player is None or not msg.get("message"):
            return
        player.send_message(("§a" if msg.get("ok") else "§c") + str(msg["message"]))
        if msg.get("ok") and msg.get("mine"):
            try:
                player.send_title("§6★ Vote saved ★", f"§fYou voted for §e{msg['mine']}", 5, 50, 15)
            except Exception:
                pass

    def ask(self, player, payload):
        voice = getattr(self.plugin, "_voice", None)
        if voice is None or not getattr(voice, "ws", None):
            player.send_message("§cVoting can't reach galaxymc.us right now. Try again in a minute.")
            return False
        req = uuid.uuid4().hex[:12]
        now = time.time()
        self.waiting = {k: v for k, v in self.waiting.items() if now - v[1] < 120}
        self.waiting[req] = (player.unique_id, now)
        voice.send_json({**payload, "req": req, "xuid": str(player.xuid), "name": player.name})
        return True

    # ---------- staff ----------
    def is_staff(self, p):
        return self.plugin.moderation.is_staff(p)

    def command(self, player):
        if not self.is_staff(player):
            player.send_message("§cOnly staff can set up Voting Computers. Tap a Voting Computer to vote.")
            return
        form = ActionForm(title="§l§6Voting Computers", content=f"§7Voting is {'§aopen' if self.open else '§cclosed'}§7. There {'is' if len(self.computers) == 1 else 'are'} {len(self.computers)} Voting Computer{'' if len(self.computers) == 1 else 's'}.")
        form.add_button("§lMake a Voting Computer§r\n§8Then tap any block", icon="textures/ui/color_plus", on_click=lambda p: self.arm(p, "place"))
        form.add_button("§lRemove a Voting Computer§r\n§8Then tap it", icon="textures/ui/trash", on_click=lambda p: self.arm(p, "remove"))
        form.add_button(self.switch_label(), icon="textures/ui/lock" if self.open else "textures/ui/unlock", on_click=self.toggle)
        player.send_form(form)

    def switch_label(self):
        return "§l§cLock voting§r\n§8Close it on every computer" if self.open else "§l§aUnlock voting§r\n§8Open it on every computer"

    def arm(self, player, what):
        self.pending[str(player.unique_id)] = what
        player.send_message("§eTap the block to turn into a Voting Computer." if what == "place" else "§eTap the Voting Computer to remove.")

    def toggle(self, player):
        if not self.is_staff(player):
            return
        if self.ask(player, {"type": "potm_set", "open": not self.open}):
            player.send_message("§7Updating every Voting Computer...")

    # ---------- taps ----------
    def on_interact(self, event):
        if event.action != PlayerInteractEvent.Action.RIGHT_CLICK_BLOCK or not getattr(event, "has_block", False):
            return False
        p = event.player
        block = event.block
        job = self.pending.pop(str(p.unique_id), None)
        if job:
            event.is_cancelled = True
            existing = self.at(block)
            if job == "place":
                if existing:
                    p.send_message("§cThat block is already a Voting Computer.")
                    return True
                cid = max([c["id"] for c in self.computers] + [0]) + 1
                c = {"id": cid, "dim": block.dimension.name, "x": block.x, "y": block.y, "z": block.z}
                self.computers.append(c)
                self.save()
                self.label(c)
                p.send_message("§aThat block is now a Voting Computer.")
            else:
                if not existing:
                    p.send_message("§cThat block isn't a Voting Computer.")
                    return True
                self.computers.remove(existing)
                self.save()
                ft = getattr(self.plugin, "floating", None)
                if ft:
                    ft.remove(f"potm:{existing['id']}")
                p.send_message("§aVoting Computer removed.")
            return True
        if self.at(block) is None:
            return False
        event.is_cancelled = True
        self.open_computer(p)
        return True

    # ---------- the computer ----------
    def open_computer(self, player):
        staff = self.is_staff(player)
        if not self.open:
            form = ActionForm(title="§l§6Player of the Month",
                              content="§l§cVoting Closed§r\n\n§7Voting for Player of the Month isn't open right now. Check back soon!")
            if staff:
                form.add_button(self.switch_label(), icon="textures/ui/unlock", on_click=self.toggle)
            form.add_button("Close")
            player.send_form(form)
            return
        self.ask(player, {"type": "potm_mine"})  # so we can show their current vote next time
        mine = self.mine.get(str(player.xuid))
        text = ("§fWho made GalaxySMP better this month? Pick any player who has joined the server.\n\n"
                "§7Your vote is secret. You get one vote, and you can change it while voting is open.")
        if mine:
            text += f"\n\n§7Your vote: §e{mine}"
        form = ActionForm(title="§l§6Player of the Month", content=text)
        form.add_button("§l§aStart Voting" if not mine else "§l§aChange my vote", icon="textures/ui/icon_best3", on_click=self.choose)
        if staff:
            form.add_button(self.switch_label(), icon="textures/ui/lock", on_click=self.toggle)
        form.add_button("Close")
        player.send_form(form)

    def others(self, player):
        me = str(player.xuid)
        return [c for c in self.candidates if c["xuid"] != me]

    def choose(self, player):
        if not self.open:
            return self.open_computer(player)
        form = ActionForm(title="§l§6Start Voting", content="§7Search for a player by name, or browse everyone.")
        form.add_button("§lSearch by name", icon="textures/ui/magnifyingGlass", on_click=self.search)
        form.add_button(f"§lBrowse everyone§r\n§8{len(self.others(player))} players", icon="textures/ui/FriendsIcon", on_click=lambda p: self.listing(p, self.others(p), 0))
        form.add_button("Back", on_click=self.open_computer)
        player.send_form(form)

    def search(self, player):
        def submit(p, data):
            try:
                q = str(json.loads(data)[0] or "").strip().lower()
            except Exception:
                q = ""
            found = [c for c in self.others(p) if q in c["name"].lower()] if q else self.others(p)
            if not found:
                p.send_message(f"§cNo player found for \"{q}\".")
                return self.choose(p)
            self.listing(p, found, 0, q)
        player.send_form(ModalForm(title="§l§6Search", controls=[TextInput("Type part of their name", "e.g. Steve")],
                                   submit_button="Search", on_submit=submit))

    def listing(self, player, people, page, q=""):
        start = page * LIST_LIMIT
        chunk = people[start:start + LIST_LIMIT]
        head = f"§7Results for \"{q}\"" if q else "§7Everyone who has played on GalaxySMP"
        form = ActionForm(title="§l§6Pick a player", content=f"{head} §8({start + 1}-{start + len(chunk)} of {len(people)})")
        for c in chunk:
            form.add_button(c["name"], on_click=lambda p, c=c: self.confirm(p, c))
        if start + LIST_LIMIT < len(people):
            form.add_button("§lNext page", icon="textures/ui/arrow_right", on_click=lambda p: self.listing(p, people, page + 1, q))
        if page > 0:
            form.add_button("§lPrevious page", icon="textures/ui/arrow_left", on_click=lambda p: self.listing(p, people, page - 1, q))
        form.add_button("Back", on_click=self.choose)
        player.send_form(form)

    def confirm(self, player, c):
        form = ActionForm(title="§l§6Confirm your vote", content=f"§fVote for §e§l{c['name']}§r§f as Player of the Month?\n\n§7Nobody else will see who you voted for.")
        form.add_button("§l§aYes, vote", icon="textures/ui/confirm", on_click=lambda p: self.vote(p, c))
        form.add_button("Pick someone else", on_click=self.choose)
        player.send_form(form)

    def vote(self, player, c):
        if not self.open:
            return self.open_computer(player)
        self.ask(player, {"type": "potm_vote", "target": c["xuid"]})
