"""Shop NPCs: /shopnpc summons one where you stand.

Operators tap an NPC to edit it (name, dialog, which menus it opens, its look,
move or remove it). Everyone else taps it to use it. NPCs don't move, can't be
hurt and come back if they go missing.
"""

import json
import math
import time

from endstone import GameMode
from endstone.form import ActionForm, ModalForm, TextInput, Toggle

TAG = "gsmp_npc"
HOLD_TICKS = 10
NEAR = 32  # blocks: NPCs further than this from every player are left alone

# (label, entity type, spawn event)
LOOKS = [
    ("NPC (Minecraft outfits)", "minecraft:npc", None),
    ("Villager: Farmer", "minecraft:villager_v2", "minecraft:spawn_farmer"),
    ("Villager: Librarian", "minecraft:villager_v2", "minecraft:spawn_librarian"),
    ("Villager: Armorer", "minecraft:villager_v2", "minecraft:spawn_armorer"),
    ("Villager: Cleric", "minecraft:villager_v2", "minecraft:spawn_cleric"),
    ("Villager: Weaponsmith", "minecraft:villager_v2", "minecraft:spawn_weaponsmith"),
    ("Villager: Toolsmith", "minecraft:villager_v2", "minecraft:spawn_toolsmith"),
    ("Villager: Cartographer", "minecraft:villager_v2", "minecraft:spawn_cartographer"),
    ("Villager: Fisherman", "minecraft:villager_v2", "minecraft:spawn_fisherman"),
    ("Villager: Butcher", "minecraft:villager_v2", "minecraft:spawn_butcher"),
    ("Villager: Mason", "minecraft:villager_v2", "minecraft:spawn_mason"),
    ("Villager: Nitwit", "minecraft:villager_v2", "minecraft:spawn_nitwit"),
    ("Wandering Trader", "minecraft:wandering_trader", None),
    ("Iron Golem", "minecraft:iron_golem", None),
    ("Snow Golem", "minecraft:snow_golem", None),
    ("Allay", "minecraft:allay", None),
    ("Fox", "minecraft:fox", None),
    ("Cat", "minecraft:cat", None),
    ("Panda", "minecraft:panda", None),
    ("Frog", "minecraft:frog", None),
]

# What an NPC can open (key, label, button icon)
ACTIONS = [
    ("shop", "Shop", "textures/ui/store_home_icon"),
    ("sell", "Sell items", "textures/ui/MCoin"),
    ("ah", "Auction House", "textures/ui/icon_book_writable"),
    ("top", "Money Leaderboard", "textures/ui/icon_best3"),
    ("balance", "My balance", "textures/ui/icon_balloon"),
]


class NpcManager:
    def __init__(self, plugin):
        self.plugin = plugin
        self.db = plugin.economy.db
        self.npcs = {}       # id -> record
        self.actors = {}     # id -> Actor
        self.expecting = None  # (npc id, mob type) being summoned right now
        self.last_try = {}     # npc id -> when we last summoned it
        self.passthrough = {}  # player uuid -> npc id: let Minecraft's own NPC editor open once
        for nid, data in self.db.execute("SELECT id, data FROM npcs").fetchall():
            self.npcs[nid] = json.loads(data)
        self._ticks = 0

    def save(self, nid):
        self.db.execute("UPDATE npcs SET data = ? WHERE id = ?", (json.dumps(self.npcs[nid]), nid))
        self.db.commit()

    # ---------- spawning ----------
    def create(self, player):
        loc = player.location
        rec = {
            "name": "§6§lShop", "dialog": "Welcome! What would you like to do?",
            "actions": ["shop", "sell", "ah", "top"], "look": 0,
            "dim": player.dimension.name, "x": round(loc.x, 2), "y": round(loc.y, 2), "z": round(loc.z, 2),
            "yaw": round(loc.yaw, 1),
        }
        cur = self.db.execute("INSERT INTO npcs (data) VALUES (?)", (json.dumps(rec),))
        self.db.commit()
        nid = cur.lastrowid
        self.npcs[nid] = rec
        self.spawn(nid)
        player.send_message("§aShop NPC created. §7Tap it to edit it (operators only). Players who tap it get its menu.")

    def spawn(self, nid):
        """Summons the NPC. We catch the new mob in the spawn event (never by looking through all entities)."""
        rec = self.npcs[nid]
        _, kind, event = LOOKS[rec["look"] if rec["look"] < len(LOOKS) else 0]
        dim = self.dimension_cmd(rec["dim"])
        self.kill_tagged(nid)  # no duplicates: clear any old copy first
        line = f"summon {kind} {rec['x']} {rec['y']} {rec['z']} {rec['yaw']} 0 {event or 'minecraft:entity_spawned'}"
        self.last_try[nid] = time.time()
        self.expecting = (nid, kind)
        try:
            self.plugin.server.dispatch_command(self.plugin.server.command_sender, f"execute in {dim} run " + line)
        finally:
            self.expecting = None

    def kill_tagged(self, nid):
        dim = self.dimension_cmd(self.npcs[nid]["dim"]) if nid in self.npcs else "overworld"
        self.plugin.server.dispatch_command(self.plugin.server.command_sender, f"execute in {dim} run kill @e[tag={TAG}_{nid}]")

    @staticmethod
    def dimension_cmd(name):
        n = str(name).lower()
        return "nether" if "nether" in n else "the_end" if "end" in n else "overworld"

    def on_spawn(self, event):
        """ActorSpawnEvent: the NPC we're summoning right now."""
        want = self.expecting
        if want is None:
            return
        nid, kind = want
        try:
            actor = event.actor
            if actor.type != kind:
                return
        except Exception:
            return
        self.expecting = None
        # set it up on the next tick, once it's fully in the world
        self.plugin.server.scheduler.run_task(self.plugin, lambda: self.setup(nid, actor), delay=1)

    def setup(self, nid, actor):
        rec = self.npcs.get(nid)
        if rec is None:
            return
        try:
            actor.add_scoreboard_tag(TAG)
            actor.add_scoreboard_tag(f"{TAG}_{nid}")
            actor.name_tag = rec["name"]
            actor.is_name_tag_always_visible = True
        except Exception:
            return
        self.actors[nid] = actor

    def npc_id(self, actor):
        try:
            for t in actor.scoreboard_tags:
                if t.startswith(TAG + "_"):
                    return int(t[len(TAG) + 1:])
        except Exception:
            pass
        return None

    def near(self, rec, dist=NEAR):
        """Is a player close to this spot? Only then is the area surely loaded, so the NPC is safe to touch."""
        for p in self.plugin.server.online_players:
            try:
                if p.dimension.name == rec["dim"] and math.dist((p.location.x, p.location.z), (rec["x"], rec["z"])) < dist:
                    return True
            except Exception:
                continue
        return False

    # ---------- keeping NPCs in place ----------
    def tick(self):
        """Holds NPCs still, but only those with a player nearby. When nobody is near, we let go of the mob
        (its area can unload, and touching an unloaded mob can crash the server). When a player comes back,
        the NPC is replaced with a fresh one."""
        self._ticks += 1
        for nid, actor in list(self.actors.items()):
            rec = self.npcs.get(nid)
            if rec is None or not self.near(rec):
                self.actors.pop(nid, None)
                continue
            try:
                if not actor.is_valid or actor.is_dead:
                    self.actors.pop(nid, None)
                    continue
                l = actor.location
                if math.dist((l.x, l.y, l.z), (rec["x"], rec["y"], rec["z"])) > 0.3 or abs(l.yaw - rec["yaw"]) > 5:
                    from endstone.level import Location
                    actor.teleport(Location(actor.dimension, rec["x"], rec["y"], rec["z"], 0.0, rec["yaw"]))
                if actor.name_tag != rec["name"]:
                    actor.name_tag = rec["name"]
            except Exception:
                self.actors.pop(nid, None)
        if self._ticks % 10 == 0:
            self.find_missing()

    def find_missing(self):
        now = time.time()
        for nid, rec in list(self.npcs.items()):
            if nid in self.actors or now - self.last_try.get(nid, 0) < 10:
                continue
            if self.near(rec):
                self.spawn(nid)

    def remove(self, nid):
        actor = self.actors.pop(nid, None)
        if actor is not None:
            try:
                actor.remove()
            except Exception:
                pass
        if nid in self.npcs:
            self.kill_tagged(nid)
        self.npcs.pop(nid, None)
        self.db.execute("DELETE FROM npcs WHERE id = ?", (nid,))
        self.db.commit()

    # ---------- events ----------
    def on_interact(self, event):
        nid = self.npc_id(event.actor)
        if nid is None or nid not in self.npcs:
            return
        player = event.player
        if self.passthrough.get(str(player.unique_id)) == nid:
            self.passthrough.pop(str(player.unique_id), None)
            return  # let Minecraft's NPC editor open (outfits)
        event.is_cancelled = True
        if player.is_op and not player.is_sneaking:
            self.open_editor(player, nid)
        else:
            self.use(player, nid)

    def on_damage(self, event):
        if self.npc_id(event.actor) is not None:
            event.is_cancelled = True

    # ---------- using an NPC ----------
    def run_action(self, player, key):
        p = self.plugin
        if key == "shop":
            p.shop.open(player)
        elif key == "sell":
            p.shop.open_sell(player)
        elif key == "ah":
            p.auction.open(player)
        elif key == "top":
            p.economy.open_top(player)
        elif key == "balance":
            player.send_message(f"§7Your balance: §e{p.economy.balance_text(player)}")

    def use(self, player, nid):
        rec = self.npcs[nid]
        actions = [a for a in ACTIONS if a[0] in rec["actions"]]
        if len(actions) == 1 and not rec["dialog"].strip():
            self.run_action(player, actions[0][0])
            return
        form = ActionForm(title=rec["name"], content=rec["dialog"] or " ")
        for key, label, icon in actions:
            form.add_button(label, icon=icon, on_click=lambda pl, key=key: self.run_action(pl, key))
        if not actions:
            form.add_button("Goodbye")
        player.send_form(form)

    # ---------- editor (operators) ----------
    def open_editor(self, player, nid):
        rec = self.npcs[nid]
        look = LOOKS[rec["look"] if rec["look"] < len(LOOKS) else 0][0]
        opens = ", ".join(label for key, label, _ in ACTIONS if key in rec["actions"]) or "nothing"
        form = ActionForm(title="Edit NPC", content=f"{rec['name']}§r\nLook: §f{look}§r\nOpens: §f{opens}§r\n\n"
                          "§7Sneak and tap to use it like a player would.")
        form.add_button("§lName, dialog and menus", icon="textures/ui/book_edit_default", on_click=lambda p: self.edit_form(p, nid))
        form.add_button("§lChange look", icon="textures/ui/dressing_room_skins", on_click=lambda p: self.look_form(p, nid))
        form.add_button("§lMove here", icon="textures/ui/move", on_click=lambda p: self.move_here(p, nid))
        form.add_button("§lTry it", icon="textures/ui/icon_recipe_item", on_click=lambda p: self.use(p, nid))
        form.add_button("§c§lRemove NPC", icon="textures/ui/trash", on_click=lambda p: self.confirm_remove(p, nid))
        player.send_form(form)

    def edit_form(self, player, nid):
        rec = self.npcs[nid]
        controls = [
            TextInput("Name (shown above its head, § colors work)", "e.g. §6§lShop", rec["name"]),
            TextInput("Dialog (what it says when tapped)", "e.g. Welcome to the market!", rec["dialog"]),
        ]
        controls += [Toggle(f"Opens: {label}", key in rec["actions"]) for key, label, _ in ACTIONS]

        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            name = str(v[0]).strip()[:48] or "§6§lShop"
            rec["name"] = name
            rec["dialog"] = str(v[1]).strip()[:400]
            rec["actions"] = [key for (key, _, _), on in zip(ACTIONS, v[2:2 + len(ACTIONS)]) if on]
            self.save(nid)
            actor = self.actors.get(nid)
            if actor is not None:
                actor.name_tag = name
            p.send_message("§aNPC saved.")
            self.open_editor(p, nid)

        player.send_form(ModalForm(title="Edit NPC", controls=controls, submit_button="Save", on_submit=submit))

    def look_form(self, player, nid):
        form = ActionForm(title="Change look", content="Choose what this NPC looks like.\n"
                          "§7For Minecraft's NPC outfits: choose NPC, then use \"Pick an NPC outfit\".")
        if LOOKS[self.npcs[nid]["look"]][1] == "minecraft:npc":
            form.add_button("§lPick an NPC outfit§r\n§8Opens Minecraft's NPC editor", icon="textures/ui/dressing_room_skins",
                            on_click=lambda p: self.outfit(p, nid))
        for i, (label, _, _) in enumerate(LOOKS):
            form.add_button(label, on_click=lambda p, i=i: self.set_look(p, nid, i))
        form.add_button("§l< Back", on_click=lambda p: self.open_editor(p, nid))
        player.send_form(form)

    def outfit(self, player, nid):
        self.passthrough[str(player.unique_id)] = nid
        if player.game_mode != GameMode.CREATIVE:
            player.send_message("§eSwitch to Creative (/gamemode creative), then tap the NPC once. "
                                "Minecraft's NPC editor opens: tap the outfit picture to choose a skin.")
        else:
            player.send_message("§eTap the NPC once: Minecraft's NPC editor opens. Tap the outfit picture to choose a skin.")

    def set_look(self, player, nid, index):
        self.npcs[nid]["look"] = index
        self.save(nid)
        actor = self.actors.pop(nid, None)
        if actor is not None:
            try:
                actor.remove()
            except Exception:
                pass
        self.spawn(nid)
        player.send_message(f"§aNPC look changed to {LOOKS[index][0]}.")

    def move_here(self, player, nid):
        rec = self.npcs[nid]
        loc = player.location
        old_dim = rec["dim"]
        rec.update({"dim": player.dimension.name, "x": round(loc.x, 2), "y": round(loc.y, 2), "z": round(loc.z, 2),
                    "yaw": round(loc.yaw, 1)})
        self.save(nid)
        actor = self.actors.get(nid)
        if actor is not None and old_dim == rec["dim"]:
            pass  # the hold-still loop moves it on the next tick
        else:
            self.set_look(player, nid, rec["look"])
        player.send_message("§aNPC moved to where you're standing. Step aside!")

    def confirm_remove(self, player, nid):
        form = ActionForm(title="Remove NPC?", content="This NPC will disappear for good.")
        form.add_button("§c§lYes, remove it", on_click=lambda p: (self.remove(nid), p.send_message("§aNPC removed.")))
        form.add_button("No, keep it", on_click=lambda p: self.open_editor(p, nid))
        player.send_form(form)
