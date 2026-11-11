"""Bedwars.

Players join from a Minigame Computer (or /bedwars). Joining saves their whole inventory, clears it and
sends them to the waiting room with a Leave item. When at least 2 players are waiting a countdown
starts; teams (up to 4) are made at random and evenly. Classic rules: iron and gold at your island,
diamonds and emeralds in the middle, an Item Shop, respawn while your bed stands, knocked out once it's
broken. Last team standing wins. When the game ends (or a player leaves), their own items, game mode
and position come back, plus their plot tool.

Only players in the game see the HUD (sidebar with teams and beds, upgrade timers, your stats, and big
on-screen alerts). Everyone else is kept out of the arena, and nothing changes for them.

Admins set up the arena in game: /bedwars > Arena setup (waiting room, arena corners, each team's spawn,
bed, iron/gold generator and shop, diamond and emerald generators, rewards).
"""

import json
import math
import random
import time

from endstone.form import ActionForm, ModalForm, TextInput

from endstone_galaxylink import money
from endstone_galaxylink.announcements import show_title

TEAMS = [  # key, name, colour code, block colour, leather colour
    ("red", "Red", "§c", "red", 0xB02E26),
    ("blue", "Blue", "§9", "blue", 0x3C44AA),
    ("green", "Green", "§a", "lime", 0x80C71F),
    ("yellow", "Yellow", "§e", "yellow", 0xFED83D),
]
TEAM = {t[0]: t for t in TEAMS}
LEAVE_MARK = "§0§bwleave"
SHOP_NAME = "§e§lItem Shop"
CURRENCY = {"iron": "minecraft:iron_ingot", "gold": "minecraft:gold_ingot", "diamond": "minecraft:diamond", "emerald": "minecraft:emerald"}
CUR_NAME = {"iron": "Iron", "gold": "Gold", "diamond": "Diamond", "emerald": "Emerald"}
CUR_COLOR = {"iron": "§f", "gold": "§6", "diamond": "§b", "emerald": "§a"}
IRON_EVERY, GOLD_EVERY = 1.5, 8.0
DIAMOND_EVERY = {1: 30, 2: 23, 3: 15}
EMERALD_EVERY = {1: 65, 2: 50, 3: 35}
TIMELINE = [  # seconds after the start
    (360, "diamond", 2, "Diamond II"), (720, "emerald", 2, "Emerald II"),
    (1080, "diamond", 3, "Diamond III"), (1440, "emerald", 3, "Emerald III"),
    (1800, "beds", 0, "Bed Destruction"), (2400, "end", 0, "Game End"),
]
RESPAWN_SECONDS = 5
ALLOWED_COMMANDS = {"leave", "bedwars", "bw", "report", "dm", "r", "tell", "msg", "w", "guide", "me"}
DEFAULT_CFG = {"lobby": None, "bounds": None, "teams": {}, "diamond": [], "emerald": [],
               "rewards": {"win": 25000, "final": 1000, "bed": 2500}, "max_per_team": 4, "countdown": 30}

# Item Shop: (label, cost currency, cost amount, kind, value...)
SHOP = [
    ("Blocks", [
        ("Wool x16", "iron", 4, "item", "{wool}", 16),
        ("Terracotta x16", "iron", 12, "item", "{terracotta}", 16),
        ("Oak Planks x16", "gold", 4, "item", "minecraft:oak_planks", 16),
        ("End Stone x12", "iron", 24, "item", "minecraft:end_stone", 12),
        ("Ladder x8", "iron", 4, "item", "minecraft:ladder", 8),
        ("Obsidian x4", "emerald", 4, "item", "minecraft:obsidian", 4),
    ]),
    ("Weapons", [
        ("Stone Sword", "iron", 10, "sword", "minecraft:stone_sword", 1),
        ("Iron Sword", "gold", 7, "sword", "minecraft:iron_sword", 2),
        ("Diamond Sword", "emerald", 4, "sword", "minecraft:diamond_sword", 3),
        ("Knockback Stick", "gold", 5, "kbstick", "minecraft:stick", 1),
        ("Bow", "gold", 12, "item", "minecraft:bow", 1),
        ("Arrows x8", "gold", 2, "item", "minecraft:arrow", 8),
    ]),
    ("Armor", [
        ("Chainmail Armor (kept on death)", "iron", 24, "armor", "chainmail", 1),
        ("Iron Armor (kept on death)", "gold", 12, "armor", "iron", 2),
        ("Diamond Armor (kept on death)", "emerald", 6, "armor", "diamond", 3),
    ]),
    ("Tools", [
        ("Wooden Pickaxe", "iron", 10, "item", "minecraft:wooden_pickaxe", 1),
        ("Iron Pickaxe", "gold", 3, "item", "minecraft:iron_pickaxe", 1),
        ("Diamond Pickaxe", "gold", 6, "item", "minecraft:diamond_pickaxe", 1),
        ("Wooden Axe", "iron", 10, "item", "minecraft:wooden_axe", 1),
        ("Shears", "iron", 20, "item", "minecraft:shears", 1),
    ]),
    ("Utility", [
        ("Golden Apple", "gold", 3, "item", "minecraft:golden_apple", 1),
        ("Ender Pearl", "emerald", 4, "item", "minecraft:ender_pearl", 1),
        ("Speed II (45 seconds)", "emerald", 1, "effect", "speed", 1),
        ("Jump Boost V (45 seconds)", "emerald", 1, "effect", "jump_boost", 4),
        ("Invisibility (30 seconds)", "emerald", 2, "effect", "invisibility", 0),
    ]),
]


def now():
    return time.time()


def mmss(seconds):
    s = max(0, int(seconds))
    return f"{s // 60}:{s % 60:02d}"


def spot(player):
    l = player.location
    return {"dim": player.dimension.name, "x": l.x, "y": l.y, "z": l.z, "yaw": l.yaw, "pitch": l.pitch}


def block_spot(player):
    l = player.location
    return [math.floor(l.x), math.floor(l.y), math.floor(l.z)]


class Bedwars:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS bw_saved (xuid TEXT PRIMARY KEY, data TEXT);
            CREATE TABLE IF NOT EXISTS bw_placed (x INTEGER, y INTEGER, z INTEGER, PRIMARY KEY (x, y, z));
        """)
        self.db.commit()
        cfg = self.eco.get_config("bedwars") or {}
        self.cfg = {**DEFAULT_CFG, **cfg}
        self.queue = []          # uuids in the waiting room, in join order
        self.players = {}        # uuid -> state while a game runs (players and knocked-out spectators)
        self.game = None
        self.countdown_at = None
        self.boards = {}         # uuid -> (scoreboard, objective, lines)
        self.warned = {}         # uuid -> time of the last "keep out" message
        self._tick = 0
        self.shop_actor = {}     # team -> actor
        self.cleanup_leftovers() # a game that was running when the server stopped

    # ---------- storage ----------
    def save_cfg(self):
        self.eco.set_config("bedwars", self.cfg)

    def online(self, uid):
        return next((p for p in self.plugin.server.online_players if str(p.unique_id) == uid), None)

    def playing(self, player):
        uid = str(player.unique_id)
        return uid in self.players or uid in self.queue

    def ready(self):
        c = self.cfg
        teams = [k for k, _n, *_ in TEAMS if self.team_ready(k)]
        return bool(c.get("lobby") and c.get("bounds") and len(teams) >= 2)

    def team_ready(self, key):
        t = self.cfg["teams"].get(key) or {}
        return bool(t.get("spawn") and t.get("bed") and t.get("gen"))

    def dim(self):
        return self.plugin.server.level.get_dimension((self.cfg.get("lobby") or {}).get("dim", "Overworld"))

    def loc(self, s, dy=0.0):
        from endstone.level import Location
        if isinstance(s, dict):
            return Location(self.plugin.server.level.get_dimension(s["dim"]), s["x"], s["y"] + dy, s["z"], s.get("pitch", 0.0), s.get("yaw", 0.0))
        return Location(self.dim(), s[0] + 0.5, s[1] + dy, s[2] + 0.5)

    def cmd(self, text):
        try:
            self.plugin.server.dispatch_command(self.plugin.server.command_sender, text)
        except Exception:
            pass

    def qname(self, player):
        return '"' + player.name.replace('"', "") + '"'

    # ---------- items ----------
    def leave_item(self):
        from endstone.inventory import ItemStack
        stack = ItemStack("minecraft:bed", 1, 14)  # red bed
        meta = stack.item_meta
        meta.display_name = "§c§lLeave Bedwars"
        meta.lore = ["§7Use this to leave the game.", "§7Your own items come back.", LEAVE_MARK]
        stack.set_item_meta(meta)
        return stack

    @staticmethod
    def is_leave(stack):
        try:
            return stack is not None and LEAVE_MARK in (stack.item_meta.lore or [])
        except Exception:
            return False

    def colored(self, item_id, amount, team):
        from endstone.inventory import ItemStack
        color = TEAM[team][3]
        return ItemStack(item_id.replace("{wool}", f"minecraft:{color}_wool").replace("{terracotta}", f"minecraft:{color}_terracotta"), amount)

    def leather(self, piece, team):
        from endstone.inventory import ItemStack
        stack = ItemStack(f"minecraft:leather_{piece}", 1)
        try:  # dye it the team colour
            from endstone import nbt as N
            tag = stack.nbt
            inner = tag["tag"] if "tag" in tag else N.CompoundTag()
            color = TEAM[team][4] | 0xFF000000
            inner["customColor"] = N.IntTag(color - (1 << 32) if color >= 1 << 31 else color)
            tag["tag"] = inner
            stack.nbt = tag
        except Exception:
            pass
        try:
            meta = stack.item_meta
            meta.is_unbreakable = True
            stack.set_item_meta(meta)
        except Exception:
            pass
        return stack

    def unbreakable(self, item_id):
        from endstone.inventory import ItemStack
        stack = ItemStack(item_id, 1)
        try:
            meta = stack.item_meta
            meta.is_unbreakable = True
            stack.set_item_meta(meta)
        except Exception:
            pass
        return stack

    # ---------- saving and restoring a player's own things ----------
    def save_player(self, player):
        inv = player.inventory
        data = {
            "items": {str(i): money.snapshot(inv.get_item(i)) for i in range(inv.size) if inv.get_item(i) is not None},
            "armor": {k: money.snapshot(getattr(inv, k)) for k in ("helmet", "chestplate", "leggings", "boots") if getattr(inv, k) is not None},
            "offhand": money.snapshot(inv.item_in_off_hand) if inv.item_in_off_hand is not None else None,
            "loc": spot(player), "mode": int(player.game_mode.value), "level": int(getattr(player, "exp_level", 0) or 0),
        }
        self.db.execute("INSERT OR REPLACE INTO bw_saved (xuid, data) VALUES (?, ?)", (str(player.xuid), json.dumps(data)))
        self.db.commit()
        self.clear(player)

    def clear(self, player):
        inv = player.inventory
        inv.clear()
        for k in ("helmet", "chestplate", "leggings", "boots"):
            try:
                setattr(inv, k, None)
            except Exception:
                pass
        try:
            inv.item_in_off_hand = None
        except Exception:
            pass

    def has_saved(self, player):
        return self.db.execute("SELECT 1 FROM bw_saved WHERE xuid = ?", (str(player.xuid),)).fetchone() is not None

    def restore_player(self, player, teleport=True):
        """Gives back everything saved when they joined: items, armour, game mode, level and position."""
        from endstone import GameMode
        uid = str(player.unique_id)
        self.players.pop(uid, None)
        if uid in self.queue:
            self.queue.remove(uid)
        self.hud_off(player)
        row = self.db.execute("SELECT data FROM bw_saved WHERE xuid = ?", (str(player.xuid),)).fetchone()
        self.cmd(f"effect {self.qname(player)} clear")
        self.clear(player)
        if row:
            data = json.loads(row[0])
            inv = player.inventory
            for slot, snap in data.get("items", {}).items():
                try:
                    inv.set_item(int(slot), money.rebuild(snap))
                except Exception as e:
                    self.plugin.logger.warning(f"Bedwars: couldn't give back an item to {player.name}: {e}")
            for k, snap in data.get("armor", {}).items():
                try:
                    setattr(inv, k, money.rebuild(snap))
                except Exception:
                    pass
            if data.get("offhand"):
                try:
                    inv.item_in_off_hand = money.rebuild(data["offhand"])
                except Exception:
                    pass
            try:
                player.game_mode = GameMode(int(data.get("mode", 0)))
            except Exception:
                player.game_mode = GameMode.SURVIVAL
            try:
                player.exp_level = int(data.get("level", 0))
            except Exception:
                pass
            if teleport and data.get("loc"):
                try:
                    player.teleport(self.loc(data["loc"]))
                except Exception:
                    pass
            self.db.execute("DELETE FROM bw_saved WHERE xuid = ?", (str(player.xuid),))
            self.db.commit()
        else:
            player.game_mode = GameMode.SURVIVAL
        try:
            player.health = player.max_health
        except Exception:
            pass
        plots = getattr(self.plugin, "plots", None)
        if plots is not None:
            plots.ensure_tool(player)
        self.refresh_tag(player)

    def refresh_tag(self, player):
        voice = getattr(self.plugin, "_voice", None)
        try:
            if voice is not None:
                self.plugin.server.scheduler.run_task(self.plugin, voice._apply_icons, delay=2)
        except Exception:
            pass

    # ---------- joining and leaving ----------
    def menu(self, player):
        uid = str(player.unique_id)
        g = self.game
        status = ("§aA game is running" + (f" ({mmss(now() - g['started'])})" if g else "")) if g else (
            f"§e{len(self.queue)} waiting" + (f", starting in {int(self.countdown_at - now())}s" if self.countdown_at else ""))
        form = ActionForm(title="§l§cBedwars", content=f"Protect your bed and destroy everyone else's. Last team standing wins.\n\n{status}")
        if not self.ready():
            form.content += "\n\n§7Bedwars isn't set up yet."
        elif uid in self.queue or uid in self.players:
            form.add_button("§c§lLeave Bedwars§r\n§8Get your own items back", icon="textures/ui/cancel", on_click=self.confirm_leave)
        else:
            form.add_button("§a§lPlay Bedwars§r\n§8Your items are kept safe until you leave", icon="textures/ui/sword", on_click=self.join)
        form.add_button("§lHow to play§r", icon="textures/ui/how_to_play_button_default", on_click=self.how_to)
        if player.is_op:
            form.add_button("§6§lArena setup§r\n§8Admins", icon="textures/ui/hammer_l", on_click=self.setup_menu)
        player.send_form(form)

    def how_to(self, player):
        form = ActionForm(title="§l§cHow to play Bedwars", content=(
            "§l1. Collect§r: Iron and gold appear at your island. Diamonds and emeralds appear in the middle.\n\n"
            "§l2. Shop§r: Trade them with the §eItem Shop§r for blocks, weapons, armour and tools.\n\n"
            "§l3. Protect your bed§r: While your bed stands, you come back after dying.\n\n"
            "§l4. Break other beds§r: Without a bed, a team is out after its next death.\n\n"
            "§l5. Win§r: Be the last team left.\n\n"
            "§7Use the §cLeave Bedwars§7 item (or /leave) any time to get your own items back."))
        form.add_button("§l< Back", on_click=self.menu)
        player.send_form(form)

    def join(self, player):
        from endstone import GameMode
        uid = str(player.unique_id)
        if not self.ready():
            return player.send_message("§cBedwars isn't set up yet.")
        if uid in self.queue or uid in self.players:
            return
        if len(self.queue) >= self.capacity():
            return player.send_message("§cThe Bedwars waiting room is full. Please try again in a moment.")
        self.save_player(player)
        self.queue.append(uid)
        player.game_mode = GameMode.ADVENTURE
        player.teleport(self.loc(self.cfg["lobby"]))
        player.inventory.set_item(8, self.leave_item())
        self.cmd(f"effect {self.qname(player)} clear")
        self.cmd(f"effect {self.qname(player)} saturation 99999 255 true")
        player.send_message("§aYou joined Bedwars. §7Your items are saved and come back when you leave. "
                            "Use the §cLeave Bedwars§7 item or /leave to leave.")
        self.broadcast_lobby(f"§e{player.name} joined §7({len(self.queue)}/{self.capacity()})")
        if self.game:
            player.send_message("§7A game is running. You'll play in the next one.")

    def confirm_leave(self, player):
        playing = self.game and self.players.get(str(player.unique_id), {}).get("alive")
        form = ActionForm(title="§l§cLeave Bedwars?", content=(
            "You'll get your own items back and return to where you were." +
            ("\n\n§eYou're still in the game, so your team loses a player." if playing else "")))
        form.add_button("§c§lLeave", icon="textures/ui/cancel", on_click=lambda p: self.leave(p))
        form.add_button("§lStay", on_click=lambda p: None)
        player.send_form(form)

    def leave(self, player, quiet=False):
        uid = str(player.unique_id)
        if uid not in self.queue and uid not in self.players:
            return player.send_message("§7You're not in Bedwars.")
        st = self.players.get(uid)
        if st and self.game and st.get("alive"):
            st["alive"] = False
            team = st["team"]
            self.broadcast(f"{TEAM[team][2]}{player.name}§7 left the game.")
        self.restore_player(player)
        if not quiet:
            player.send_message("§aYou left Bedwars. Your items are back.")
        if self.game:
            self.check_winner()
        elif len(self.queue) < 2:
            self.countdown_at = None

    def on_quit(self, player):
        uid = str(player.unique_id)
        if uid in self.queue:
            self.queue.remove(uid)
            self.hud_drop(uid)
            if len(self.queue) < 2:
                self.countdown_at = None
        if uid in self.players:
            st = self.players.pop(uid)
            self.hud_drop(uid)
            if self.game and st.get("alive"):
                self.broadcast(f"{TEAM[st['team']][2]}{player.name}§7 disconnected.")
                self.check_winner()
        # their saved items stay saved and come back when they next join

    def on_join(self, player):
        if self.has_saved(player) and not self.playing(player):
            self.plugin.server.scheduler.run_task(self.plugin, lambda: self._welcome_back(str(player.unique_id)), delay=40)

    def _welcome_back(self, uid):
        p = self.online(uid)
        if p is not None and not self.playing(p) and self.has_saved(p):
            self.restore_player(p)
            p.send_message("§aYou left Bedwars when you disconnected. Your items are back.")

    def capacity(self):
        teams = sum(1 for k, *_ in TEAMS if self.team_ready(k))
        return teams * int(self.cfg.get("max_per_team", 4))

    # ---------- starting ----------
    def start(self):
        from endstone import GameMode
        players = [self.online(u) for u in self.queue]
        players = [p for p in players if p is not None][: self.capacity()]
        if len(players) < 2:
            self.countdown_at = None
            return
        team_keys = [k for k, *_ in TEAMS if self.team_ready(k)]
        size = math.ceil(len(players) / len(team_keys))
        count = math.ceil(len(players) / size)
        keys = team_keys[:count]
        random.shuffle(players)
        self.game = {"started": now(), "teams": {k: {"bed": True, "members": []} for k in keys},
                     "tiers": {"diamond": 1, "emerald": 1}, "next": {}, "done_events": [], "ending": None}
        for i, p in enumerate(players):
            key = keys[i % len(keys)]
            uid = str(p.unique_id)
            self.queue.remove(uid)
            self.game["teams"][key]["members"].append(uid)
            self.players[uid] = {"team": key, "alive": True, "kills": 0, "finals": 0, "beds": 0, "respawn_at": None,
                                 "last_hit": None, "armor": 0, "name": p.name, "xuid": str(p.xuid)}
        # teams nobody plays: their beds are taken away for this game
        for key in team_keys:
            if key not in keys:
                self.remove_bed(key)
        t = now()
        for kind in ("iron", "gold"):
            for key in keys:
                self.game["next"][f"{kind}:{key}"] = t + 2
        self.game["next"]["diamond"] = t + DIAMOND_EVERY[1]
        self.game["next"]["emerald"] = t + EMERALD_EVERY[1]
        self.spawn_shops(keys)
        for uid, st in self.players.items():
            p = self.online(uid)
            if p is None:
                continue
            p.game_mode = GameMode.SURVIVAL
            self.kit(p, st)
            p.teleport(self.loc(self.cfg["teams"][st["team"]]["spawn"]))
            name, color = TEAM[st["team"]][1], TEAM[st["team"]][2]
            show_title(self.plugin, p, f"{color}§l{name} Team", "§fProtect your bed!", 5, 50, 15)
            p.send_message(f"§lBedwars started!§r You're on the {color}{name}§r team. Protect your bed and destroy the others.")
            self.sound(p, "mob.enderdragon.growl", 0.4, 1.4)
        self.countdown_at = None
        self.plugin.logger.info(f"[Bedwars] Game started with {len(players)} players in {len(keys)} teams")

    def kit(self, p, st):
        team = st["team"]
        self.clear(p)
        inv = p.inventory
        inv.set_item(0, self.unbreakable("minecraft:wooden_sword"))
        inv.helmet = self.leather("helmet", team)
        inv.chestplate = self.leather("chestplate", team)
        tier = st.get("armor", 0)
        if tier:
            name = {1: "chainmail", 2: "iron", 3: "diamond"}[tier]
            inv.leggings = self.unbreakable(f"minecraft:{name}_leggings")
            inv.boots = self.unbreakable(f"minecraft:{name}_boots")
        else:
            inv.leggings = self.leather("leggings", team)
            inv.boots = self.leather("boots", team)
        inv.set_item(8, self.leave_item())
        try:
            p.health = p.max_health
        except Exception:
            pass
        self.cmd(f"effect {self.qname(p)} clear")
        self.cmd(f"effect {self.qname(p)} saturation 99999 255 true")

    # ---------- shops ----------
    def spawn_shops(self, keys):
        for key in keys:
            s = self.cfg["teams"][key].get("shop")
            if not s:
                continue
            actor = self.shop_actor.get(key)
            try:
                if actor is not None and not actor.is_dead:
                    continue
            except Exception:
                pass
            try:
                actor = self.dim().spawn_actor(self.loc(s), "minecraft:villager_v2")
                actor.name_tag = SHOP_NAME
                self.shop_actor[key] = actor
                self.cmd(f"effect @e[type=villager_v2,name=\"{SHOP_NAME}\"] slowness 99999 255 true")
            except Exception as e:
                self.plugin.logger.warning(f"Bedwars: couldn't place the {key} Item Shop: {e}")

    def remove_shops(self):
        for actor in self.shop_actor.values():
            try:
                actor.remove()
            except Exception:
                pass
        self.shop_actor = {}

    def keep_shops_still(self):
        for key, actor in list(self.shop_actor.items()):
            s = self.cfg["teams"].get(key, {}).get("shop")
            if not s:
                continue
            try:
                l = actor.location
                if abs(l.x - s["x"]) > 0.6 or abs(l.z - s["z"]) > 0.6:
                    actor.teleport(self.loc(s))
            except Exception:
                pass

    def on_interact_actor(self, event):
        """Tapping the Item Shop villager opens the shop (and never the villager's trades)."""
        try:
            if event.actor.name_tag != SHOP_NAME:
                return False
        except Exception:
            return False
        event.is_cancelled = True
        uid = str(event.player.unique_id)
        st = self.players.get(uid)
        if self.game and st and st.get("alive") and not st.get("respawn_at"):
            self.shop(event.player)
        return True

    def count(self, player, cur):
        item = CURRENCY[cur]
        total = 0
        inv = player.inventory
        for i in range(inv.size):
            s = inv.get_item(i)
            if s is not None and money.item_id(s) == item:
                total += s.amount
        return total

    def take(self, player, cur, amount):
        from endstone.inventory import ItemStack
        player.inventory.remove_item(ItemStack(CURRENCY[cur], amount))

    def shop(self, player):
        form = ActionForm(title="§l§eItem Shop", content=self.wallet(player))
        for i, (cat, _items) in enumerate(SHOP):
            form.add_button(f"§l{cat}", on_click=lambda p, i=i: self.shop_category(p, i))
        player.send_form(form)

    def wallet(self, player):
        return "  ".join(f"{CUR_COLOR[c]}{CUR_NAME[c]}: {self.count(player, c)}" for c in ("iron", "gold", "diamond", "emerald"))

    def shop_category(self, player, i):
        cat, items = SHOP[i]
        form = ActionForm(title=f"§l§e{cat}", content=self.wallet(player))
        for j, (label, cur, cost, *_rest) in enumerate(items):
            have = self.count(player, cur) >= cost
            form.add_button(f"§l{label}§r\n{CUR_COLOR[cur] if have else '§c'}{cost} {CUR_NAME[cur]}",
                            on_click=lambda p, i=i, j=j: self.buy(p, i, j))
        form.add_button("§l< Back", on_click=self.shop)
        player.send_form(form)

    def buy(self, player, i, j):
        from endstone.inventory import ItemStack
        uid = str(player.unique_id)
        st = self.players.get(uid)
        if not (self.game and st and st.get("alive")):
            return
        label, cur, cost, kind, value, amount = SHOP[i][1][j]
        if kind == "armor" and st.get("armor", 0) >= amount:
            player.send_message("§7You already have this armour or better.")
            return self.shop_category(player, i)
        if self.count(player, cur) < cost:
            player.send_message(f"§cYou need {cost} {CUR_NAME[cur]} for {label}.")
            self.sound(player, "note.bass", 0.8, 0.8)
            return self.shop_category(player, i)
        self.take(player, cur, cost)
        team = st["team"]
        if kind == "item":
            money.give(player, self.colored(value, amount, team))
        elif kind == "sword":
            inv = player.inventory
            for k in range(inv.size):
                s = inv.get_item(k)
                if s is not None and money.item_id(s) == "minecraft:wooden_sword":
                    inv.set_item(k, None)
            money.give(player, self.unbreakable(value))
        elif kind == "kbstick":
            stick = ItemStack(value, 1)
            try:
                meta = stick.item_meta
                meta.display_name = "§fKnockback Stick"
                meta.add_enchant("knockback", 1, True)
                stick.set_item_meta(meta)
            except Exception:
                pass
            money.give(player, stick)
        elif kind == "armor":
            st["armor"] = amount
            player.inventory.leggings = self.unbreakable(f"minecraft:{value}_leggings")
            player.inventory.boots = self.unbreakable(f"minecraft:{value}_boots")
        elif kind == "effect":
            seconds = 30 if value == "invisibility" else 45
            self.cmd(f"effect {self.qname(player)} {value} {seconds} {amount} true")
        self.sound(player, "random.orb", 0.8, 1.4)
        player.send_message(f"§aBought {label}.")
        self.shop_category(player, i)

    # ---------- beds and blocks ----------
    def bed_team(self, x, y, z):
        for key, t in self.cfg["teams"].items():
            for b in t.get("bed") or []:
                if b[0] == x and b[1] == y and b[2] == z:
                    return key
        return None

    def remove_bed(self, key):
        for b in self.cfg["teams"].get(key, {}).get("bed") or []:
            try:
                self.dim().get_block_at(b[0], b[1], b[2]).set_type("minecraft:air", False)
            except Exception:
                pass

    def restore_beds(self):
        server = self.plugin.server
        for key, t in self.cfg["teams"].items():
            for b in t.get("bed") or []:
                try:
                    block = self.dim().get_block_at(b[0], b[1], b[2])
                    block.set_data(server.create_block_data(b[3], b[4] if len(b) > 4 else None), False)
                except Exception as e:
                    self.plugin.logger.warning(f"Bedwars: couldn't put the {key} bed back: {e}")

    def in_bounds(self, x, y, z, pad=0.0):
        b = self.cfg.get("bounds")
        if not b:
            return False
        return (b[0] - pad <= x <= b[3] + 1 + pad and b[1] - pad - 64 <= y <= b[4] + 1 + pad + 32 and b[2] - pad <= z <= b[5] + 1 + pad)

    def on_break(self, event):
        """Returns True when Bedwars dealt with it (other features should then leave the event alone)."""
        block = event.block
        try:
            if block.dimension.name != self.dim().name or not self.in_bounds(block.x, block.y, block.z):
                return False
        except Exception:
            return False
        player = event.player
        uid = str(player.unique_id)
        st = self.players.get(uid)
        if st is None:
            if player.is_op and not self.game:
                return False  # admins can build the map when no game is running
            event.is_cancelled = True
            return True
        if not self.game or not st.get("alive") or st.get("respawn_at"):
            event.is_cancelled = True
            return True
        key = self.bed_team(block.x, block.y, block.z)
        if key:
            event.is_cancelled = True
            if key == st["team"]:
                player.send_message("§cYou can't break your own bed.")
            elif key in self.game["teams"] and self.game["teams"][key]["bed"]:
                self.break_bed(key, player)
            return True
        pos = (block.x, block.y, block.z)
        if self.db.execute("SELECT 1 FROM bw_placed WHERE x = ? AND y = ? AND z = ?", pos).fetchone():
            self.db.execute("DELETE FROM bw_placed WHERE x = ? AND y = ? AND z = ?", pos)
            self.db.commit()
            return True
        event.is_cancelled = True
        player.send_message("§7You can only break blocks placed by players.")
        return True

    def on_place(self, event):
        block = event.block_placed_state if hasattr(event, "block_placed_state") else event.block
        player = event.player
        uid = str(player.unique_id)
        try:
            inside = block.dimension.name == self.dim().name and self.in_bounds(block.x, block.y, block.z)
        except Exception:
            inside = False
        if uid in self.queue:
            event.is_cancelled = True
            return True
        st = self.players.get(uid)
        if st is None:
            if inside and not (player.is_op and not self.game):
                event.is_cancelled = True
                return True
            return False
        if not inside or not self.game or not st.get("alive") or self.is_leave(player.inventory.item_in_main_hand):
            event.is_cancelled = True
            return True
        self.db.execute("INSERT OR IGNORE INTO bw_placed (x, y, z) VALUES (?, ?, ?)", (block.x, block.y, block.z))
        self.db.commit()
        return True

    def break_bed(self, key, breaker):
        g = self.game
        g["teams"][key]["bed"] = False
        self.remove_bed(key)
        st = self.players[str(breaker.unique_id)]
        st["beds"] += 1
        color, name = TEAM[key][2], TEAM[key][1]
        bcolor = TEAM[st["team"]][2]
        self.broadcast(f"§l§fBED DESTROYED > §r{color}{name} Bed§7 was destroyed by {bcolor}{breaker.name}§7!")
        self.pay(breaker, "bed", "breaking a bed")
        for uid in g["teams"][key]["members"]:
            p = self.online(uid)
            if p is not None:
                show_title(self.plugin, p, "§c§lBED DESTROYED!", "§fYou won't respawn after your next death.", 5, 60, 15)
                self.sound(p, "mob.wither.death", 0.6, 1.0)
        for uid in self.players:
            p = self.online(uid)
            if p is not None and self.players[uid]["team"] != key:
                self.sound(p, "mob.enderdragon.growl", 0.3, 1.6)

    def clear_placed(self):
        rows = self.db.execute("SELECT x, y, z FROM bw_placed").fetchall()
        dim = self.dim()
        for x, y, z in rows:
            try:
                dim.get_block_at(x, y, z).set_type("minecraft:air", False)
            except Exception:
                pass
        self.db.execute("DELETE FROM bw_placed")
        self.db.commit()

    def clear_drops(self):
        b = self.cfg.get("bounds")
        if b:
            self.cmd(f"kill @e[type=item,x={b[0]},y={b[1] - 64},z={b[2]},dx={b[3] - b[0] + 1},dy={b[4] - b[1] + 97},dz={b[5] - b[2] + 1}]")

    def cleanup_leftovers(self):
        """If the server stopped during a game: remove placed blocks and put the beds back (players get
        their items back when they next join)."""
        try:
            if self.db.execute("SELECT 1 FROM bw_placed LIMIT 1").fetchone():
                self.plugin.server.scheduler.run_task(self.plugin, lambda: (self.clear_placed(), self.restore_beds()), delay=100)
        except Exception:
            pass

    # ---------- deaths ----------
    def armor_points(self, player):
        pts = {"leather": (1, 3, 2, 1), "chainmail": (2, 5, 4, 1), "iron": (2, 6, 5, 2), "diamond": (3, 8, 6, 3)}
        total = 0
        inv = player.inventory
        for i, k in enumerate(("helmet", "chestplate", "leggings", "boots")):
            s = getattr(inv, k)
            if s is None:
                continue
            mat = money.item_id(s).split(":")[-1].split("_")[0]
            total += pts.get(mat, (0, 0, 0, 0))[i]
        return min(20, total)

    def on_damage(self, event):
        """Friendly fire is off; the waiting room, knocked-out players and the Item Shop can't be hurt;
        a hit that would kill is handled by Bedwars (no death screen, no dropped items)."""
        victim = event.actor
        try:
            if getattr(victim, "name_tag", "") == SHOP_NAME:
                event.is_cancelled = True
                return True
        except Exception:
            pass
        uid = str(getattr(victim, "unique_id", ""))
        if uid in self.queue:
            event.is_cancelled = True
            return True
        st = self.players.get(uid)
        if st is None:
            return False
        if not self.game or not st.get("alive") or st.get("respawn_at"):
            event.is_cancelled = True
            return True
        attacker = None
        try:
            attacker = event.damage_source.actor
        except Exception:
            pass
        auid = str(getattr(attacker, "unique_id", "")) if attacker is not None else ""
        ast = self.players.get(auid)
        if attacker is not None and auid and auid != uid:
            if ast is None or not ast.get("alive"):
                event.is_cancelled = True
                return True
            if ast["team"] == st["team"]:
                event.is_cancelled = True
                return True
            st["last_hit"] = (auid, now())
        dmg = float(event.damage)
        try:
            kind = str(event.damage_source.type)
        except Exception:
            kind = ""
        if any(k in kind for k in ("attack", "projectile", "explosion")):
            dmg *= 1 - self.armor_points(victim) / 25
        if dmg >= victim.health:
            event.is_cancelled = True
            killer = auid if ast else (st["last_hit"][0] if st.get("last_hit") and now() - st["last_hit"][1] < 10 else None)
            self.died(victim, killer, "void" if "void" in kind else "killed")
        return True

    def died(self, player, killer_uid, how):
        from endstone import GameMode
        from endstone.inventory import ItemStack
        uid = str(player.unique_id)
        st = self.players.get(uid)
        if not self.game or st is None or not st.get("alive") or st.get("respawn_at"):
            return
        team = st["team"]
        color = TEAM[team][2]
        killer = self.online(killer_uid) if killer_uid else None
        kst = self.players.get(killer_uid) if killer_uid else None
        final = not self.game["teams"][team]["bed"]
        if killer and kst:
            kcolor = TEAM[kst["team"]][2]
            verb = "was knocked into the void by" if how == "void" else "was killed by"
            self.broadcast(f"{color}{player.name}§7 {verb} {kcolor}{killer.name}§7." + (" §b§lFINAL KILL!" if final else ""))
            loot = []
            for cur in ("iron", "gold", "diamond", "emerald"):
                n = self.count(player, cur)
                if n:
                    money.give(killer, ItemStack(CURRENCY[cur], n))
                    loot.append(f"{CUR_COLOR[cur]}+{n} {CUR_NAME[cur]}")
            if loot:
                killer.send_message(" ".join(loot))
            kst["kills"] += 1
            if final:
                kst["finals"] += 1
                self.pay(killer, "final", "a final kill")
            self.sound(killer, "random.orb", 0.7, 1.8)
        else:
            self.broadcast(f"{color}{player.name}§7 " + ("fell into the void." if how == "void" else "died.") + (" §b§lFINAL KILL!" if final else ""))
        st["last_hit"] = None
        # lose everything except armour; the Leave item stays
        inv = player.inventory
        for i in range(inv.size):
            s = inv.get_item(i)
            if s is not None and not self.is_leave(s):
                inv.set_item(i, None)
        try:
            player.health = player.max_health
        except Exception:
            pass
        player.game_mode = GameMode.SPECTATOR
        player.teleport(self.spectate_loc())
        if final:
            st["alive"] = False
            show_title(self.plugin, player, "§c§lELIMINATED", "§fYou can watch until the end. Type /leave to go back.", 5, 80, 15)
            player.send_message("§cYou're out. §7You can watch the rest of the game, or type §f/leave§7 to go back now.")
            self.check_winner()
        else:
            st["respawn_at"] = now() + RESPAWN_SECONDS
            show_title(self.plugin, player, "§c§lYOU DIED!", f"§eRespawning in {RESPAWN_SECONDS} seconds", 0, 25, 5)

    def respawn(self, player, st):
        from endstone import GameMode
        st["respawn_at"] = None
        player.game_mode = GameMode.SURVIVAL
        self.kit(player, st)
        player.teleport(self.loc(self.cfg["teams"][st["team"]]["spawn"]))
        show_title(self.plugin, player, "§a§lRESPAWNED!", "", 0, 20, 10)

    def spectate_loc(self):
        b = self.cfg["bounds"]
        center = [(b[0] + b[3]) / 2, b[4] + 5, (b[2] + b[5]) / 2]
        from endstone.level import Location
        return Location(self.dim(), center[0], center[1], center[2], 60.0, 0.0)

    def on_respawn(self, player):
        """A real death slipped through (for example /kill): treat it as a normal Bedwars death."""
        uid = str(player.unique_id)
        st = self.players.get(uid)
        if self.game and st and st.get("alive") and not st.get("respawn_at"):
            self.plugin.server.scheduler.run_task(self.plugin, lambda: (self.online(uid) and self.died(self.online(uid), None, "died")), delay=5)
        elif uid in self.queue:
            self.plugin.server.scheduler.run_task(self.plugin, lambda: (self.online(uid) and self.online(uid).teleport(self.loc(self.cfg["lobby"]))), delay=5)

    # ---------- winning ----------
    def alive_teams(self):
        out = []
        for key, t in self.game["teams"].items():
            if any(self.players.get(u, {}).get("alive") for u in t["members"]):
                out.append(key)
        return out

    def check_winner(self):
        g = self.game
        if not g or g.get("ending"):
            return
        teams = self.alive_teams()
        for key, t in g["teams"].items():
            if key not in teams and not t.get("out"):
                t["out"] = True
                t["bed"] = False
                self.broadcast(f"§l§fTEAM ELIMINATED > §r{TEAM[key][2]}{TEAM[key][1]} Team§7 has been eliminated!")
                for uid in self.players:
                    p = self.online(uid)
                    if p is not None:
                        show_title(self.plugin, p, "", f"{TEAM[key][2]}§l{TEAM[key][1].upper()} TEAM ELIMINATED", 0, 40, 10)
        if len(teams) <= 1:
            self.finish(teams[0] if teams else None)

    def finish(self, winner, reason=None):
        g = self.game
        if not g or g.get("ending"):
            return
        g["ending"] = now() + 8
        name = f"{TEAM[winner][2]}{TEAM[winner][1]} Team" if winner else "Nobody"
        self.broadcast(f"§l§6GAME OVER > §r{name}§6 wins!" + (f" §7({reason})" if reason else ""))
        prog = getattr(self.plugin, "progress", None)
        for uid, st in self.players.items():
            p = self.online(uid)
            won = winner is not None and st["team"] == winner
            if p is not None:
                show_title(self.plugin, p, "§6§lVICTORY!" if won else "§c§lGAME OVER", f"{name} §fwon the game", 5, 120, 20)
                self.sound(p, "random.levelup" if won else "mob.wither.spawn", 0.6, 1.0)
                if won:
                    self.pay(p, "win", "winning")
            if prog is not None and p is not None:
                s = prog.stats(p)
                s["bw_games"] = s.get("bw_games", 0) + 1
                s["bw_wins"] = s.get("bw_wins", 0) + (1 if won else 0)
                s["bw_kills"] = s.get("bw_kills", 0) + st["kills"]
                s["bw_finals"] = s.get("bw_finals", 0) + st["finals"]
                s["bw_beds"] = s.get("bw_beds", 0) + st["beds"]
                prog.touch(p)
                try:
                    prog.check_achievements(p)
                except Exception:
                    pass
        self.plugin.logger.info(f"[Bedwars] Game over: {name} won")

    def wrap_up(self):
        """After the end screen: everyone gets their own things back, and the map is reset."""
        for uid in list(self.players):
            p = self.online(uid)
            if p is not None:
                self.restore_player(p)
                p.send_message("§aThanks for playing Bedwars! Your items are back.")
        self.players = {}
        self.game = None
        self.remove_shops()
        self.clear_placed()
        self.restore_beds()
        self.clear_drops()

    def pay(self, player, kind, why):
        cents = int((self.cfg.get("rewards") or {}).get(kind, 0))
        if cents > 0:
            self.eco.credit(player, cents)
            player.send_message(f"§6+{money.fmt(cents)} §7for {why}")

    # ---------- every half second ----------
    def tick(self):
        self._tick += 1
        t = now()
        try:
            self.keep_out()
            if self.game:
                self.game_tick(t)
            else:
                self.lobby_tick(t)
            if self._tick % 2 == 0:
                self.hud_all(t)
        except Exception as e:
            self.plugin.logger.warning(f"Bedwars: {e}")

    def lobby_tick(self, t):
        self.queue = [u for u in self.queue if self.online(u) is not None]
        if len(self.queue) >= 2 and self.ready():
            if self.countdown_at is None:
                secs = 10 if len(self.queue) >= self.capacity() else int(self.cfg.get("countdown", 30))
                self.countdown_at = t + secs
                self.broadcast_lobby(f"§eThe game starts in {secs} seconds!")
            elif len(self.queue) >= self.capacity() and self.countdown_at - t > 10:
                self.countdown_at = t + 10
            left = self.countdown_at - t
            if left <= 5.25 and abs(left - round(left)) < 0.26 and round(left) >= 1:
                for u in self.queue:
                    p = self.online(u)
                    if p is not None:
                        show_title(self.plugin, p, f"§e§l{round(left)}", "", 0, 12, 4)
                        self.sound(p, "note.hat", 0.8, 1.2)
            if left <= 0:
                self.start()
        elif self.countdown_at is not None:
            self.countdown_at = None
            self.broadcast_lobby("§7Not enough players. Waiting for more...")
        lobby = self.cfg.get("lobby")
        for u in self.queue:  # stay in the waiting room
            p = self.online(u)
            if p is not None and lobby:
                l = p.location
                if p.dimension.name != lobby["dim"] or math.dist((l.x, l.y, l.z), (lobby["x"], lobby["y"], lobby["z"])) > 40:
                    p.teleport(self.loc(lobby))

    def game_tick(self, t):
        g = self.game
        if g.get("ending"):
            if t >= g["ending"]:
                self.wrap_up()
            return
        dim = self.dim()
        from endstone.inventory import ItemStack
        # generators
        for key in g["teams"]:
            gen = self.cfg["teams"][key]["gen"]
            for kind, every in (("iron", IRON_EVERY), ("gold", GOLD_EVERY)):
                k = f"{kind}:{key}"
                if t >= g["next"][k]:
                    g["next"][k] = t + every
                    try:
                        dim.drop_item(self.loc(gen, 0.5), ItemStack(CURRENCY[kind], 1))
                    except Exception:
                        pass
        for kind, table in (("diamond", DIAMOND_EVERY), ("emerald", EMERALD_EVERY)):
            if t >= g["next"][kind]:
                g["next"][kind] = t + table[g["tiers"][kind]]
                for pos in self.cfg.get(kind) or []:
                    try:
                        dim.drop_item(self.loc(pos, 0.5), ItemStack(CURRENCY[kind], 1))
                    except Exception:
                        pass
        # timeline
        elapsed = t - g["started"]
        for at, kind, tier, label in TIMELINE:
            if elapsed >= at and label not in g["done_events"]:
                g["done_events"].append(label)
                if kind in ("diamond", "emerald"):
                    g["tiers"][kind] = tier
                    self.broadcast(f"{CUR_COLOR[kind]}§l{label}§r§7: {CUR_NAME[kind]} generators are now faster.")
                elif kind == "beds":
                    for key, team in g["teams"].items():
                        if team["bed"]:
                            team["bed"] = False
                            self.remove_bed(key)
                    self.broadcast("§c§lBED DESTRUCTION§r§7: All beds have been destroyed!")
                    for uid in self.players:
                        p = self.online(uid)
                        if p is not None:
                            show_title(self.plugin, p, "§c§lALL BEDS DESTROYED", "§fNo more respawns!", 5, 60, 15)
                elif kind == "end":
                    alive = sorted(self.alive_teams(), key=lambda k: -sum(1 for u in g["teams"][k]["members"] if self.players.get(u, {}).get("alive")))
                    self.finish(alive[0] if len(alive) == 1 or (len(alive) > 1 and self._more(alive[0], alive[1])) else None, "time ran out")
                    return
        # players: respawns, staying inside, falling into the void
        b = self.cfg["bounds"]
        for uid, st in list(self.players.items()):
            p = self.online(uid)
            if p is None:
                continue
            if st.get("respawn_at"):
                left = st["respawn_at"] - t
                if left <= 0:
                    self.respawn(p, st)
                elif abs(left - round(left)) < 0.26:
                    show_title(self.plugin, p, "§c§lYOU DIED!", f"§eRespawning in {max(1, round(left))} seconds", 0, 15, 0)
                continue
            l = p.location
            if not st.get("alive"):
                if not self.in_bounds(l.x, l.y, l.z, 10):
                    p.teleport(self.spectate_loc())
                continue
            if l.y < b[1] - 8:
                self.died(p, st["last_hit"][0] if st.get("last_hit") and t - st["last_hit"][1] < 10 else None, "void")
            elif not self.in_bounds(l.x, l.y, l.z, 2):
                p.teleport(self.loc(self.cfg["teams"][st["team"]]["spawn"]))
                p.send_message("§7You can't leave the arena during a game.")
        if self._tick % 6 == 0:
            self.keep_shops_still()

    def _more(self, a, b):
        g = self.game
        n = lambda k: sum(1 for u in g["teams"][k]["members"] if self.players.get(u, {}).get("alive"))
        return n(a) > n(b)

    def keep_out(self):
        """Players who aren't in Bedwars can't go into the arena (admins can while no game is running)."""
        b = self.cfg.get("bounds")
        if not b:
            return
        dname = self.dim().name
        for p in self.plugin.server.online_players:
            uid = str(p.unique_id)
            if uid in self.players or uid in self.queue or (p.is_op and not self.game):
                continue
            if p.dimension.name != dname:
                continue
            l = p.location
            if not self.in_bounds(l.x, l.y, l.z):
                continue
            # push them out over the nearest edge
            edges = [(l.x - b[0], (b[0] - 3, l.z)), (b[3] + 1 - l.x, (b[3] + 4, l.z)),
                     (l.z - b[2], (l.x, b[2] - 3)), (b[5] + 1 - l.z, (l.x, b[5] + 4))]
            _d, (x, z) = min(edges, key=lambda e: e[0])
            from endstone.level import Location
            p.teleport(Location(p.dimension, x, max(l.y, b[1]) + 1, z, l.pitch, l.yaw))
            if now() - self.warned.get(uid, 0) > 5:
                self.warned[uid] = now()
                p.send_message("§cThat's the Bedwars arena. §7Join from a Minigame Computer to play.")

    # ---------- HUD (only for players in Bedwars) ----------
    def hud_lines(self, uid, t):
        g = self.game
        if not g:
            n = len(self.queue)
            lines = ["§7Waiting room", "", f"§fPlayers: §a{n}/{self.capacity()}"]
            if self.countdown_at:
                lines.append(f"§fStarting in §a{max(0, int(self.countdown_at - t))}s")
            else:
                lines.append("§7Waiting for players...")
            return lines + ["", "§7/leave to leave", "§egalaxymc.us"]
        st = self.players.get(uid, {})
        elapsed = t - g["started"]
        upcoming = next(((at, label) for at, _k, _ti, label in TIMELINE if label not in g["done_events"]), None)
        lines = [f"§f{upcoming[1]} in §a{mmss(upcoming[0] - elapsed)}" if upcoming else "§7Final phase", ""]
        for key, team in g["teams"].items():
            color, name = TEAM[key][2], TEAM[key][1]
            alive = sum(1 for u in team["members"] if self.players.get(u, {}).get("alive"))
            status = "§a✔" if team["bed"] else (f"§e{alive}" if alive else "§c✘")
            you = " §7(you)" if st.get("team") == key else ""
            lines.append(f"{color}{name[0]} §f{name}: {status}{you}")
        lines += ["", f"§fKills: §a{st.get('kills', 0)}", f"§fFinal kills: §a{st.get('finals', 0)}",
                  f"§fBeds broken: §a{st.get('beds', 0)}", "", "§egalaxymc.us"]
        return lines

    def hud_all(self, t):
        for uid in list(self.queue) + list(self.players):
            p = self.online(uid)
            if p is None:
                continue
            self.hud(p, self.hud_lines(uid, t))
            st = self.players.get(uid)
            if st and self.game and not self.game.get("ending"):
                color, name = TEAM[st["team"]][2], TEAM[st["team"]][1]
                bed = "§a✔ Bed" if self.game["teams"][st["team"]]["bed"] else "§c✘ No bed"
                tip = f"{color}§l{name} Team§r  {bed}" if st.get("alive") else "§7Watching · /leave to go back"
                try:
                    p.send_tip(tip)
                except Exception:
                    pass

    def hud(self, player, lines):
        from endstone.scoreboard import Criteria, DisplaySlot, ObjectiveSortOrder
        uid = str(player.unique_id)
        # every line has to be different text: add invisible colour codes to repeats (like empty lines)
        seen, fixed = set(), []
        for i, line in enumerate(lines):
            text = line
            while text in seen:
                text += "§r"
            seen.add(text)
            fixed.append(text)
        board = self.boards.get(uid)
        try:
            if board is None:
                sb = self.plugin.server.create_scoreboard()
                obj = sb.add_objective("bedwars", Criteria.DUMMY, "§l§cBED§fWARS")
                obj.set_display(DisplaySlot.SIDE_BAR, ObjectiveSortOrder.DESCENDING)
                player.scoreboard = sb
                board = [sb, obj, []]
                self.boards[uid] = board
            sb, obj, old = board
            for line in old:
                if line not in fixed:
                    sb.reset_scores(line)
            for i, line in enumerate(fixed):
                obj.get_score(line).value = len(fixed) - i
            board[2] = fixed
        except Exception as e:
            self.plugin.logger.warning(f"Bedwars HUD: {e}")

    def hud_off(self, player):
        self.boards.pop(str(player.unique_id), None)
        try:
            player.scoreboard = self.plugin.server.scoreboard
        except Exception:
            pass

    def hud_drop(self, uid):
        self.boards.pop(uid, None)

    # ---------- helpers ----------
    def broadcast(self, text):
        for uid in self.players:
            p = self.online(uid)
            if p is not None:
                p.send_message(text)

    def broadcast_lobby(self, text):
        for uid in self.queue:
            p = self.online(uid)
            if p is not None:
                p.send_message(text)

    def sound(self, p, name, vol, pitch):
        try:
            p.play_sound(p.location, name, vol, pitch)
        except Exception:
            pass

    def name_tag(self, player):
        st = self.players.get(str(player.unique_id))
        if st:
            return f"{TEAM[st['team']][2]}{player.name}"
        return None

    def on_command(self, event):
        """While in Bedwars, only a few commands work (so nobody can teleport away with game items)."""
        uid = str(event.player.unique_id)
        if uid not in self.players and uid not in self.queue:
            return False
        name = event.command.lstrip("/").split(" ")[0].lower().split(":")[-1]
        if name in ALLOWED_COMMANDS:
            return False
        event.is_cancelled = True
        event.player.send_message("§cYou can't use that during Bedwars. §7Use the Leave Bedwars item or /leave first.")
        return True

    def on_drop(self, event):
        if self.is_leave(event.item):
            event.is_cancelled = True
            return True
        return False

    def on_use(self, event):
        """Using the Leave item asks to leave (and never places the bed)."""
        if self.is_leave(event.item):
            event.is_cancelled = True
            self.confirm_leave(event.player)
            return True
        return False

    def command(self, player, args):
        sub = (args[0].lower() if args else "")
        if sub == "leave":
            return self.leave(player)
        if sub == "setup" and player.is_op:
            return self.setup_menu(player)
        self.menu(player)

    # ---------- arena setup (admins) ----------
    def setup_menu(self, player):
        if not player.is_op:
            return
        c = self.cfg
        teams = [k for k, *_ in TEAMS if self.team_ready(k)]
        lines = [
            ("§a✔" if c.get("lobby") else "§c✘") + " §fWaiting room",
            ("§a✔" if c.get("bounds") else "§c✘") + " §fArena corners",
            ("§a✔" if len(teams) >= 2 else "§c✘") + f" §fTeams ready: {len(teams)} (need at least 2)",
            f"§7Diamond generators: {len(c.get('diamond') or [])}, emerald generators: {len(c.get('emerald') or [])}",
        ]
        form = ActionForm(title="§l§6Bedwars setup", content="\n".join(lines) + "\n\n§7Stand where you want something and tap its button.")
        form.add_button("§lSet waiting room here", on_click=lambda p: self._set(p, "lobby", spot(p), "Waiting room set."))
        form.add_button("§lArena corner 1 (here)", on_click=lambda p: self._corner(p, 0))
        form.add_button("§lArena corner 2 (here)", on_click=lambda p: self._corner(p, 1))
        for key, name, color, *_ in TEAMS:
            ok = "§a✔" if self.team_ready(key) else "§7not set"
            form.add_button(f"{color}§l{name} team§r  {ok}", on_click=lambda p, key=key: self.team_menu(p, key))
        form.add_button("§b§lAdd a diamond generator here", on_click=lambda p: self._gen(p, "diamond"))
        form.add_button("§a§lAdd an emerald generator here", on_click=lambda p: self._gen(p, "emerald"))
        form.add_button("§lRemove all middle generators", on_click=self._clear_gens)
        form.add_button("§lRewards and settings", on_click=self.settings_form)
        if self.game:
            form.add_button("§c§lEnd the current game", on_click=lambda p: self.finish(None, "ended by staff"))
        elif len(self.queue) >= 2:
            form.add_button("§a§lStart now", on_click=lambda p: self.start())
        form.add_button("§l< Back", on_click=self.menu)
        player.send_form(form)

    def _set(self, player, key, value, msg):
        self.cfg[key] = value
        self.save_cfg()
        player.send_message(f"§a{msg}")
        self.setup_menu(player)

    def _corner(self, player, i):
        corners = self.cfg.setdefault("_corners", [None, None])
        corners[i] = block_spot(player)
        if corners[0] and corners[1]:
            a, b = corners
            self.cfg["bounds"] = [min(a[0], b[0]), min(a[1], b[1]), min(a[2], b[2]), max(a[0], b[0]), max(a[1], b[1]), max(a[2], b[2])]
            player.send_message(f"§aArena set: {self.cfg['bounds'][3] - self.cfg['bounds'][0] + 1} x {self.cfg['bounds'][5] - self.cfg['bounds'][2] + 1} blocks. "
                                "§7The bottom corner is where falling counts as the void.")
        else:
            player.send_message(f"§aCorner {i + 1} set. §7Now set the other corner.")
        self.save_cfg()
        self.setup_menu(player)

    def _gen(self, player, kind):
        self.cfg.setdefault(kind, []).append(block_spot(player))
        self.save_cfg()
        player.send_message(f"§a{kind.title()} generator added.")
        self.setup_menu(player)

    def _clear_gens(self, player):
        self.cfg["diamond"], self.cfg["emerald"] = [], []
        self.save_cfg()
        player.send_message("§aMiddle generators removed.")
        self.setup_menu(player)

    def team_menu(self, player, key):
        _k, name, color, *_ = TEAM[key]
        t = self.cfg["teams"].get(key) or {}
        mark = lambda v: "§a✔" if v else "§c✘"
        form = ActionForm(title=f"{color}§l{name} team", content=(
            f"{mark(t.get('spawn'))} §fSpawn point\n{mark(t.get('bed'))} §fBed\n{mark(t.get('gen'))} §fIron and gold generator\n"
            f"{mark(t.get('shop'))} §fItem Shop §7(optional)\n\n§7Stand on the spot and tap its button. For the bed, stand right next to it."))
        form.add_button("§lSet spawn point here", on_click=lambda p: self._team_set(p, key, "spawn", spot(p)))
        form.add_button("§lSet bed (stand next to it)", on_click=lambda p: self._team_bed(p, key))
        form.add_button("§lSet iron & gold generator here", on_click=lambda p: self._team_set(p, key, "gen", block_spot(p)))
        form.add_button("§lSet Item Shop here", on_click=lambda p: self._team_set(p, key, "shop", spot(p)))
        form.add_button("§c§lClear this team", on_click=lambda p: self._team_clear(p, key))
        form.add_button("§l< Back", on_click=self.setup_menu)
        player.send_form(form)

    def _team_set(self, player, key, what, value):
        self.cfg["teams"].setdefault(key, {})[what] = value
        self.save_cfg()
        player.send_message(f"§a{TEAM[key][1]} team: {what} set.")
        self.team_menu(player, key)

    def _team_bed(self, player, key):
        l = player.location
        dim = player.dimension
        found = []
        for dx in range(-3, 4):
            for dy in range(-2, 3):
                for dz in range(-3, 4):
                    b = dim.get_block_at(math.floor(l.x) + dx, math.floor(l.y) + dy, math.floor(l.z) + dz)
                    if "bed" in b.type and "bedrock" not in b.type:
                        data = b.data
                        found.append([b.x, b.y, b.z, data.type, dict(data.block_states)])
        if not found:
            player.send_message("§cNo bed found. Stand right next to the team's bed and try again.")
            return self.team_menu(player, key)
        first = found[0]
        bed = [first] + [f for f in found[1:] if abs(f[0] - first[0]) + abs(f[2] - first[2]) == 1 and f[1] == first[1]][:1]
        self.cfg["teams"].setdefault(key, {})["bed"] = bed
        self.save_cfg()
        player.send_message(f"§a{TEAM[key][1]} team bed set ({len(bed)} blocks).")
        self.team_menu(player, key)

    def _team_clear(self, player, key):
        self.cfg["teams"].pop(key, None)
        self.save_cfg()
        player.send_message(f"§a{TEAM[key][1]} team cleared.")
        self.setup_menu(player)

    def settings_form(self, player):
        r = self.cfg.get("rewards") or {}
        form = ModalForm(title="§lBedwars rewards and settings", submit_button="Save")
        form.add_control(TextInput("Money for winning (each player)", "250", money.fmt(r.get("win", 25000)).replace("$", "")))
        form.add_control(TextInput("Money per final kill", "10", money.fmt(r.get("final", 1000)).replace("$", "")))
        form.add_control(TextInput("Money per bed broken", "25", money.fmt(r.get("bed", 2500)).replace("$", "")))
        form.add_control(TextInput("Players per team (1-8)", "4", str(self.cfg.get("max_per_team", 4))))
        form.add_control(TextInput("Countdown before a game (seconds)", "30", str(self.cfg.get("countdown", 30))))

        def submit(p, data):
            vals = json.loads(data) if isinstance(data, str) else data
            try:
                win, final, bed = (money.parse(v) or 0 for v in vals[:3])
                per = max(1, min(8, int(vals[3])))
                cd = max(5, min(120, int(vals[4])))
            except Exception:
                return p.send_message("§cPlease use numbers only.")
            self.cfg["rewards"] = {"win": win, "final": final, "bed": bed}
            self.cfg["max_per_team"], self.cfg["countdown"] = per, cd
            self.save_cfg()
            p.send_message("§aBedwars settings saved.")
            self.setup_menu(p)
        form.on_submit = submit
        player.send_form(form)
