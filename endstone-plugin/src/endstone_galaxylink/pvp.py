"""GalaxySMP PvP (2.94): our own PvP server, in space arenas floating over the End's void (pvp_arenas.py).

Get there from the "PvP" card on the Main Menu. Your survival things (items, armour, level, game mode, where you
were) are put away safely and come back when you leave (the red bed, or /leave from the lobby).

    Free-for-all   jump into an arena any time: Potion, Classic, Sumo or Build (placed blocks fade after 10 s)
    Duels          casual 1v1s in any kit: Potion, Classic, Sumo, Boxing (first to 100 hits) or Build
    Ranked         1v1s for a rating (starts at 1000) and a tier: Bronze, Silver, Gold, Platinum, Diamond, Galaxy
    /duel <player> challenge someone (they can say yes from anywhere: it brings them to PvP)
    Party fights   your party (Main Menu > Social > Party, up to 4) splits into two teams, or a party free-for-all
    Events         staff start a Sumo event or a Knockout tournament; one fight at a time in the Colosseum,
                   everyone else watches from the stands, the last one standing wins a prize
    Kit Editor     move a kit's items where you like them; every match uses your layout

Kill streaks, ratings, wins and kills go on your website profile and the PvP leaderboards. Wins and kills pay a
little money (capped per day) and count for the season pass. Your kill and victory effects (/cosmetics) play here too.
Ender pearls have a 15-second cooldown (shown on the XP bar).
"""
import json
import math
import random
import time

from endstone.form import ActionForm
from endstone_galaxylink import money
from endstone_galaxylink import pvp_arenas as A

MARK = "§8GalaxySMP PvP"
START_RATING = 1000
TIERS = [(1700, "Galaxy", "§d"), (1500, "Diamond", "§b"), (1300, "Platinum", "§3"), (1100, "Gold", "§6"), (900, "Silver", "§7"), (-99999, "Bronze", "§c")]
PEARL_COOLDOWN = 15
COUNTDOWN = 3
MATCH_LIMIT = 300        # seconds; then the side with more health left wins
SPAWN_SAFE = 3           # seconds of spawn protection in free-for-all
COMBAT_TAG = 10          # leaving within this many seconds of a hit counts as a death
DECAY = 10               # Build free-for-all: placed blocks fade after this many seconds
VOID_DROP = 12           # falling this far below an arena's floor is a death
REWARD = {"ffa_kill": 500, "duel_win": 2000, "ranked_win": 4000, "party_win": 1500, "event_win": 30000, "streak": 1000}
DAY_CAP = 40000          # most money from PvP in a day (events don't count toward it)
DAY_WINS = 15            # wins that count for the season pass each day
ALLOWED = {"leave", "pvp", "duel", "msg", "tell", "w", "whisper", "r", "reply", "party", "p", "report", "support", "help",
           "guide", "cosmetics", "stats", "call", "dm", "list", "me", "afk", "ping"}

POT, SPEED = 22, 16      # splash Healing II and Swiftness II (Bedrock potion data values)
KITS = {
    "potion": {"name": "Potion PvP", "short": "Potion", "icon": "textures/items/potion_bottle_splash_heal", "kind": "open",
               "armor": ("diamond_helmet", "diamond_chestplate", "diamond_leggings", "diamond_boots"),
               "items": [("diamond_sword", 1, 0), ("ender_pearl", 16, 0), ("potion", 1, SPEED), ("potion", 1, SPEED), ("cooked_beef", 64, 0)]
                        + [("splash_potion", 1, POT)] * 30,
               "effects": [], "about": "Diamond gear, healing potions and pearls. Heal up, outlast them."},
    "classic": {"name": "Classic", "short": "Classic", "icon": "textures/items/diamond_sword", "kind": "open",
                "armor": ("diamond_helmet", "iron_chestplate", "iron_leggings", "diamond_boots"),
                "items": [("diamond_sword", 1, 0), ("fishing_rod", 1, 0), ("bow", 1, 0), ("golden_apple", 3, 0), ("cooked_beef", 64, 0), ("arrow", 16, 0)],
                "effects": [], "about": "Sword, bow, fishing rod and golden apples."},
    "sumo": {"name": "Sumo", "short": "Sumo", "icon": "textures/items/slimeball", "kind": "sumo", "armor": (), "items": [],
             "effects": [("resistance", 4)], "no_damage": True, "about": "No weapons and no damage: knock them off the edge."},
    "boxing": {"name": "Boxing", "short": "Boxing", "icon": "textures/items/iron_sword", "kind": "open", "armor": (),
               "items": [("diamond_sword", 1, 0)], "effects": [("resistance", 4), ("speed", 0)], "no_damage": True, "hits": 100,
               "duel_only": True, "about": "No damage: the first to land 100 hits wins."},
    "build": {"name": "Build", "short": "Build", "icon": "textures/blocks/wool_colored_white", "kind": "build", "build": True,
              "armor": ("iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots"),
              "items": [("iron_sword", 1, 0), ("bow", 1, 0), ("diamond_pickaxe", 1, 0), ("white_wool", 64, 0), ("white_wool", 64, 0),
                        ("golden_apple", 3, 0), ("water_bucket", 1, 0), ("lava_bucket", 1, 0), ("cooked_beef", 64, 0), ("arrow", 16, 0)],
              "ffa_skip": ("water_bucket", "lava_bucket"), "effects": [], "about": "Blocks, buckets, a bow and a sword. Bridge over and fight."},
}
DESIGN_FOR = {"open": ("moon_base", "comet_garden"), "sumo": ("orbit_pad",), "build": ("star_bridge",)}
KB = {"sumo": (1.08, 1.0), "boxing": (0.92, 0.9), "potion": (0.95, 0.92)}   # GalaxySMP's own knockback feel per kit (horizontal, up)
LOBBY = [(0, "ffa", "iron_sword", "§b§lFree-for-all", "Jump into an arena any time"),
         (1, "duels", "diamond_sword", "§a§lDuels", "Casual 1v1s, challenges, watch a match"),
         (2, "ranked", "nether_star", "§6§lRanked", "1v1s for your rating and tier"),
         (4, "party", "totem_of_undying", "§d§lParty fights", "Your party against itself"),
         (5, "events", "bell", "§e§lEvents", "Sumo events and tournaments"),
         (6, "kits", "book", "§f§lKit Editor", "Put a kit's items where you like"),
         (7, "stats", "clock", "§b§lStats & Effects", "Ratings, leaderboards and your effects"),
         (8, "leave", "bed", "§c§lBack to GalaxySMP", "Your own items come back")]


def now():
    return time.time()


def today():
    return time.strftime("%Y-%m-%d", time.gmtime())


def tier(rating):
    return next((name, color) for need, name, color in TIERS if rating >= need)


def tier_text(rating):
    name, color = tier(rating)
    return f"{color}{name} {int(rating)}"


def elo(ra, rb, score, k):
    expected = 1 / (1 + 10 ** ((rb - ra) / 400))
    return round(k * (score - expected))


class PvP:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS pvp_saved (xuid TEXT PRIMARY KEY, data TEXT);
            CREATE TABLE IF NOT EXISTS pvp_data (xuid TEXT PRIMARY KEY, name TEXT, data TEXT);
        """)
        self.db.commit()
        self.builder = A.ArenaBuilder(plugin)
        self.players = {}       # uuid -> state while in PvP
        self.queues = {}        # (kit, ranked) -> [(uuid, joined at)]
        self.matches = {}       # match id -> match
        self.busy = {}          # arena id -> match id (or "reset" while a Build arena is being cleaned)
        self.placed = {}        # arena id -> {(x, y, z): time placed}
        self.challenges = {}    # target uuid -> {from uuid: (kit, time)}
        self.event = None
        self.boards = {}
        self._n = 0
        self._next_id = 1
        if self.keep_for_later not in money.GIVE_HOOKS:
            money.GIVE_HOOKS.append(self.keep_for_later)

    # ---------- small helpers ----------
    def ready(self):
        return self.builder.ready()

    def online(self, uid):
        return next((p for p in self.plugin.server.online_players if str(p.unique_id) == uid), None)

    def playing(self, player):
        return str(player.unique_id) in self.players

    def state(self, player):
        return self.players.get(str(player.unique_id))

    def dim(self):
        return self.plugin.server.level.get_dimension(A.DIM)

    def at(self, arena, spot):
        from endstone.level import Location
        dx, dy, dz, yaw = spot
        return Location(self.dim(), arena["cx"] + dx, A.Y + dy, arena["cz"] + dz, 0.0, float(yaw))

    def cmd(self, text):
        try:
            from endstone_galaxylink.safety import run_cmd
            run_cmd(self.plugin, text)
        except Exception:
            pass

    def end_cmd(self, text):
        self.cmd(f"execute in {A.WHERE} run {text}")

    @staticmethod
    def q(player):
        return '"' + player.name.replace('"', "") + '"'

    def tip(self, p, text):
        try:
            p.send_tip(text)
        except Exception:
            pass

    def title(self, p, big, small="", fade_in=0, stay=30, fade_out=5):
        try:
            p.send_title(big, small, fade_in, stay, fade_out)
        except Exception:
            pass

    def sound(self, p, name, vol=0.7, pitch=1.0):
        try:
            p.play_sound(p.location, name, vol, pitch)
        except Exception:
            pass

    def freeze(self, p, on):
        self.cmd(f'inputpermission set {self.q(p)} movement {"disabled" if on else "enabled"}')

    # ---------- saved numbers (ratings, wins, layouts) ----------
    def data(self, xuid):
        row = self.db.execute("SELECT data FROM pvp_data WHERE xuid = ?", (str(xuid),)).fetchone()
        d = json.loads(row[0]) if row else {}
        for k, v in (("ratings", {}), ("games", {}), ("wins", {}), ("losses", {}), ("ranked", {}), ("layouts", {}), ("kills", 0),
                     ("deaths", 0), ("best_streak", 0), ("events", 0), ("paid_wins", 0), ("day", ""), ("day_cents", 0), ("day_wins", 0)):
            d.setdefault(k, v if not isinstance(v, dict) else {})
        return d

    def save_data(self, xuid, name, d):
        self.db.execute("INSERT OR REPLACE INTO pvp_data (xuid, name, data) VALUES (?, ?, ?)", (str(xuid), str(name)[:32], json.dumps(d)))
        self.db.commit()

    def rating(self, d, kit):
        return int(d["ratings"].get(kit, START_RATING))

    def best_rating(self, d):
        played = [self.rating(d, k) for k in KITS if d["ranked"].get(k)]
        return max(played) if played else 0

    def sync_stats(self, player, d=None):
        """Copies the PvP numbers into the player's stats, which go to the website."""
        prog = getattr(self.plugin, "progress", None)
        if prog is None:
            return
        d = d or self.data(player.xuid)
        try:
            s = prog.stats(player)
            s["pvp_kills"], s["pvp_deaths"], s["pvp_best_streak"], s["pvp_events"] = d["kills"], d["deaths"], d["best_streak"], d["events"]
            s["pvp_wins"], s["pvp_losses"] = sum(d["wins"].values()), sum(d["losses"].values())
            s["pvp_rating"], s["pvp_paid_wins"] = self.best_rating(d), d["paid_wins"]
            s["pvp_ratings"] = {k: self.rating(d, k) for k in KITS if d["ranked"].get(k)}
            prog.touch(player)
            prog.check_achievements(player)
        except Exception as e:
            self.plugin.logger.warning(f"PvP stats: {e}")

    def pay(self, player, kind, why):
        """A little money for wins and kills (up to DAY_CAP a day; event prizes don't count toward it)."""
        d = self.data(player.xuid)
        if d["day"] != today():
            d["day"], d["day_cents"], d["day_wins"] = today(), 0, 0
        cents = REWARD.get(kind, 0)
        if kind != "event_win":
            cents = max(0, min(cents, DAY_CAP - d["day_cents"]))
            d["day_cents"] += cents
        if kind.endswith("_win") and d["day_wins"] < DAY_WINS:
            d["day_wins"] += 1
            d["paid_wins"] += 1   # counts for the season pass
        self.save_data(player.xuid, player.name, d)
        if cents > 0:
            self.eco.credit(player, cents)
            player.send_message(f"§6+{money.fmt(cents)} §7for {why}")
        elif kind != "event_win":
            player.send_message("§7You've earned today's most from PvP. More tomorrow!")

    # ---------- putting a player's own things away (like Bedwars) ----------
    def keep_for_later(self, player, stacks):
        """Items given to someone in PvP (a reward, a Store pack...) are kept with their saved things."""
        try:
            row = self.db.execute("SELECT data FROM pvp_saved WHERE xuid = ?", (str(player.xuid),)).fetchone()
            if not row:
                return False
            data = json.loads(row[0])
            data.setdefault("extra", []).extend(money.snapshot(s) for s in stacks if s is not None)
            self.db.execute("UPDATE pvp_saved SET data = ? WHERE xuid = ?", (json.dumps(data), str(player.xuid)))
            self.db.commit()
            player.send_message("§7You got items during PvP. They're kept safe and you get them when you leave.")
            return True
        except Exception:
            return False

    def save_player(self, player):
        inv = player.inventory
        l = player.location
        data = {"items": {str(i): money.snapshot(inv.get_item(i)) for i in range(inv.size) if inv.get_item(i) is not None},
                "armor": {k: money.snapshot(getattr(inv, k)) for k in ("helmet", "chestplate", "leggings", "boots") if getattr(inv, k) is not None},
                "offhand": money.snapshot(inv.item_in_off_hand) if inv.item_in_off_hand is not None else None,
                "loc": {"dim": player.dimension.name, "x": l.x, "y": l.y, "z": l.z, "yaw": l.yaw, "pitch": l.pitch},
                "mode": int(player.game_mode.value), "level": int(getattr(player, "exp_level", 0) or 0),
                "progress": float(getattr(player, "exp_progress", 0) or 0)}
        self.db.execute("INSERT OR REPLACE INTO pvp_saved (xuid, data) VALUES (?, ?)", (str(player.xuid), json.dumps(data)))
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
        return self.db.execute("SELECT 1 FROM pvp_saved WHERE xuid = ?", (str(player.xuid),)).fetchone() is not None

    def restore_player(self, player, teleport=True):
        from endstone import GameMode
        from endstone.level import Location
        self.freeze(player, False)
        self.hud_off(player)
        self.cmd(f"effect {self.q(player)} clear")
        self.clear(player)
        row = self.db.execute("SELECT data FROM pvp_saved WHERE xuid = ?", (str(player.xuid),)).fetchone()
        if row:
            data = json.loads(row[0])
            inv = player.inventory
            for slot, snap in data.get("items", {}).items():
                try:
                    inv.set_item(int(slot), money.rebuild(snap))
                except Exception as e:
                    self.plugin.logger.warning(f"PvP: couldn't give back an item to {player.name}: {e}")
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
                mode = GameMode(int(data.get("mode", 0)))
                if mode == GameMode.CREATIVE and not player.is_op:
                    mode = GameMode.SURVIVAL
                player.game_mode = mode
            except Exception:
                player.game_mode = GameMode.SURVIVAL
            try:
                player.exp_level = int(data.get("level", 0))
                player.exp_progress = float(data.get("progress", 0))
            except Exception:
                pass
            loc = data.get("loc")
            if teleport and loc:
                try:
                    dim = self.plugin.server.level.get_dimension(loc["dim"])
                    player.teleport(Location(dim, loc["x"], loc["y"], loc["z"], loc.get("pitch", 0.0), loc.get("yaw", 0.0)))
                except Exception:
                    pass
            self.db.execute("DELETE FROM pvp_saved WHERE xuid = ?", (str(player.xuid),))
            self.db.commit()
            extra = [money.rebuild(s) for s in data.get("extra") or []]
            if extra:
                money.give(player, [x for x in extra if x is not None])
        else:
            player.game_mode = GameMode.SURVIVAL
        try:
            player.health = player.max_health
        except Exception:
            pass
        plots = getattr(self.plugin, "plots", None)
        if plots is not None:
            try:
                plots.ensure_tool(player)
            except Exception:
                pass
        welcome = getattr(self.plugin, "welcome", None)
        if welcome is not None:
            try:
                welcome.give_compass(player)
            except Exception:
                pass

    # ---------- items ----------
    def stack(self, item_id, amount=1, data=0, name=None, lore=None, unbreakable=False):
        from endstone.inventory import ItemStack
        s = ItemStack(item_id if ":" in item_id else "minecraft:" + item_id, int(amount), int(data))
        if name or lore or unbreakable:
            try:
                meta = s.item_meta
                if name:
                    meta.display_name = name
                if lore:
                    meta.lore = lore
                if unbreakable:
                    meta.is_unbreakable = True
                s.set_item_meta(meta)
            except Exception:
                pass
        return s

    @staticmethod
    def mark_of(stack):
        try:
            lore = stack.item_meta.lore or []
        except Exception:
            return None
        for line in lore:
            if line.startswith(MARK + ":"):
                return line[len(MARK) + 1:]
        return None

    def give_lobby(self, player):
        from endstone import GameMode
        self.clear(player)
        try:
            player.game_mode = GameMode.ADVENTURE
        except Exception:
            pass
        inv = player.inventory
        for slot, key, item, name, about in LOBBY:
            data = 14 if item == "bed" else 0
            inv.set_item(slot, self.stack(item, 1, data, name, [f"§7{about}", f"{MARK}:{key}"]))

    def kit_stacks(self, kit, ffa=False):
        K = KITS[kit]
        skip = set(K.get("ffa_skip", ())) if ffa else set()
        return [(i, n, d) for i, n, d in K["items"] if i not in skip]

    def give_kit(self, player, kit, ffa=False):
        """The kit's items in the player's own layout (Kit Editor), its armour and its effects."""
        from endstone import GameMode
        K = KITS[kit]
        self.clear(player)
        inv = player.inventory
        stacks = self.kit_stacks(kit, ffa)
        layout = [tuple(x) for x in self.data(player.xuid)["layouts"].get(kit, [])]
        used, slots, later = set(), {}, []
        for idx, (item, n, d) in enumerate(stacks):
            spot = next((i for i, (slot, lid, ld) in enumerate(layout) if i not in used and lid == "minecraft:" + item and ld == d), None)
            if spot is None:
                later.append(idx)
            else:
                used.add(spot)
                slots[idx] = layout[spot][0]
        taken = set(slots.values())
        free = (s for s in range(36) if s not in taken)
        for idx in later:
            slots[idx] = next(free, None)
        for idx, (item, n, d) in enumerate(stacks):
            slot = slots.get(idx)
            if slot is None or not 0 <= slot < 36:
                continue
            tool = item.endswith(("_sword", "_pickaxe", "bow", "fishing_rod"))
            inv.set_item(slot, self.stack(item, n, d, unbreakable=tool))
        for piece, item in zip(("helmet", "chestplate", "leggings", "boots"), K["armor"]):
            try:
                setattr(inv, piece, self.stack(item, unbreakable=True))
            except Exception:
                pass
        try:
            player.game_mode = GameMode.SURVIVAL if K.get("build") else GameMode.ADVENTURE
        except Exception:
            pass
        self.effects(player, kit)

    def effects(self, player, kit=None):
        self.cmd(f"effect {self.q(player)} clear")
        self.cmd(f"effect {self.q(player)} saturation 99999 0 true")
        for eff, amp in (KITS[kit]["effects"] if kit else []):
            self.cmd(f"effect {self.q(player)} {eff} 99999 {amp} true")
        try:
            player.health = player.max_health
        except Exception:
            pass

    # ---------- joining and leaving ----------
    def other_minigame(self, player):
        bw = getattr(self.plugin, "bedwars", None)
        bc = getattr(self.plugin, "buildcontest", None)
        try:
            in_bw = bw is not None and (str(player.unique_id) in bw.players or str(player.unique_id) in bw.queue)
            return in_bw or (bc is not None and bc.building(player))
        except Exception:
            return False

    def join(self, player):
        if not self.ready():
            done, total = self.builder.progress()
            return player.send_message(f"§bPvP is opening soon! §7The arenas are being built ({done}/{total}).")
        if self.playing(player):
            return self.to_lobby(player)
        if self.other_minigame(player):
            return player.send_message("§cFinish your other game first.")
        if self.has_saved(player):   # left over from a disconnect: give those back first
            self.restore_player(player, teleport=False)
        self.save_player(player)
        uid = str(player.unique_id)
        self.players[uid] = {"uid": uid, "xuid": str(player.xuid), "name": player.name, "where": "lobby", "kit": None, "arena": None,
                             "match": None, "streak": 0, "kills": 0, "last_hit": None, "pearl": 0.0, "safe_until": 0.0, "combo": 0,
                             "joined": now()}
        self.to_lobby(player, first=True)
        self.refresh_tags()

    def to_lobby(self, player, first=False):
        st = self.state(player)
        if st is None:
            return
        uid = st["uid"]
        self.unqueue(uid)
        if st["where"] == "ffa":
            self.combat_leave(player, st)
        if st["where"] == "match" and st.get("match") in self.matches:
            self.forfeit(player, st)
        if st["where"] == "event":
            self.leave_event(uid)
        st.update(where="lobby", kit=None, arena=None, match=None, streak=0, last_hit=None, combo=0)
        self.freeze(player, False)
        self.give_lobby(player)
        self.effects(player)
        try:
            player.exp_level, player.exp_progress = 0, 0.0
        except Exception:
            pass
        lobby = A.BY_ID["lobby"]
        try:
            player.teleport(self.at(lobby, lobby["spawns"][0]))
        except Exception as e:
            self.plugin.logger.warning(f"PvP: couldn't move {player.name} to the lobby: {e}")
        if first:
            self.title(player, "§b§lGALAXY §f§lPVP", "§7Pick a mode from your hotbar", 5, 50, 15)
            d = self.data(player.xuid)
            best = self.best_rating(d)
            player.send_message("§b⚔ Welcome to GalaxySMP PvP! §7Use your hotbar: §bFree-for-all§7, §aDuels§7, §6Ranked§7, §dParty fights§7, "
                                "§eEvents§7, §fKit Editor§7. " + (f"Your best rating: {tier_text(best)}§7. " if best else "")
                                + "§7The red bed takes you back to GalaxySMP with your own items.")
            self.sound(player, "random.levelup", 0.6, 1.4)

    def leave(self, player, quiet=False):
        """Back to GalaxySMP with your own things (from anywhere in PvP)."""
        st = self.state(player)
        if st is None:
            return False
        if st["where"] == "ffa":
            self.combat_leave(player, st)
        if st["where"] == "match" and st.get("match") in self.matches:
            self.forfeit(player, st)
        self.unqueue(st["uid"])
        self.leave_event(st["uid"], quiet=True)
        self.players.pop(st["uid"], None)
        self.restore_player(player)
        self.refresh_tags()
        if not quiet:
            player.send_message("§aBack to GalaxySMP! §7Your own items are back.")
        return True

    def leave_command(self, player):
        """/leave: out of an arena or match to the lobby; from the lobby, back to GalaxySMP."""
        st = self.state(player)
        if st is None:
            return False
        if st["where"] == "lobby":
            return self.leave(player)
        self.to_lobby(player)
        player.send_message("§7Back in the PvP lobby. §8(/leave again goes back to GalaxySMP)")
        return True

    def on_quit(self, player):
        st = self.state(player)
        if st is None:
            return
        if st["where"] == "match" and st.get("match") in self.matches:
            self.forfeit(player, st, quit=True)
        if st["where"] == "ffa":
            self.combat_leave(player, st)
        self.unqueue(st["uid"])
        self.leave_event(st["uid"], quiet=True)
        self.challenges.pop(st["uid"], None)
        self.players.pop(st["uid"], None)
        self.boards.pop(st["uid"], None)
        try:
            self.cmd(f'inputpermission set {self.q(player)} movement enabled')
        except Exception:
            pass

    def on_join(self, player):
        """Back after a disconnect or a restart while in PvP: your own things come back."""
        if self.has_saved(player) and not self.playing(player):
            from endstone_galaxylink.safety import later
            later(self.plugin, player, lambda p: (not self.playing(p) and self.has_saved(p)) and (
                self.restore_player(p), p.send_message("§7You left PvP. Your own items are back.")), 40)

    def on_respawn(self, player):
        """A real death slipped through (for example /kill): back to the lobby."""
        st = self.state(player)
        if st is not None:
            from endstone_galaxylink.safety import later
            later(self.plugin, player, lambda p: self.playing(p) and self.to_lobby(p), 5)

    # ---------- free-for-all ----------
    def ffa_arena(self, kit):
        return next((a for a in A.ARENAS if a["kind"] == "ffa" and kit in a["kits"]), None)

    def ffa_count(self, arena_id):
        return sum(1 for s in self.players.values() if s["where"] == "ffa" and s["arena"] == arena_id)

    def join_ffa(self, player, kit):
        st = self.state(player)
        a = self.ffa_arena(kit)
        if st is None or a is None:
            return
        self.unqueue(st["uid"])
        st.update(where="ffa", kit=kit, arena=a["id"], streak=0, last_hit=None)
        self.ffa_spawn(player, st, first=True)

    def ffa_spawn(self, player, st, first=False):
        a = A.BY_ID[st["arena"]]
        self.give_kit(player, st["kit"], ffa=True)
        others = [self.online(u) for u, s in self.players.items() if s["where"] == "ffa" and s["arena"] == a["id"] and u != st["uid"]]
        others = [o for o in others if o is not None]

        def far(spot):   # the spawn point farthest from everyone else
            x, z = a["cx"] + spot[0], a["cz"] + spot[2]
            return min((math.hypot(o.location.x - x, o.location.z - z) for o in others), default=999) + random.random()
        spot = max(a["spawns"], key=far)
        try:
            player.teleport(self.at(a, spot))
        except Exception:
            pass
        st["safe_until"] = now() + SPAWN_SAFE
        st["last_hit"] = None
        if first:
            K = KITS[st["kit"]]
            self.title(player, f"§b§l{K['short']} FFA", f"§7{a['name']} · {K['about']}", 5, 50, 10)
            player.send_message(f"§b{K['name']} free-for-all. §7Kill streaks pay more. §f/leave§7 goes back to the lobby."
                                + (" §7Placed blocks fade after 10 seconds." if K.get("build") else ""))

    def combat_leave(self, player, st):
        """Leaving a free-for-all right after being hit counts as a death for whoever hit you."""
        if st.get("last_hit") and now() - st["last_hit"][1] < COMBAT_TAG:
            killer = self.online(st["last_hit"][0])
            if killer is not None and self.playing(killer):
                self.count_kill(killer, player, f"§c{player.name} §7left the fight with §a{killer.name}")
                self.count_death(player)

    # ---------- queues and duels ----------
    def unqueue(self, uid):
        for key in list(self.queues):
            self.queues[key] = [(u, t) for u, t in self.queues[key] if u != uid]

    def queued(self, uid):
        return next((key for key, q in self.queues.items() if any(u == uid for u, _ in q)), None)

    def queue(self, player, kit, ranked=False):
        st = self.state(player)
        if st is None or st["where"] != "lobby":
            return player.send_message("§cGo back to the lobby first (/leave).")
        self.unqueue(st["uid"])
        self.queues.setdefault((kit, ranked), []).append((st["uid"], now()))
        K = KITS[kit]
        d = self.data(player.xuid)
        extra = f" §7Your rating: {tier_text(self.rating(d, kit))}" if ranked else ""
        player.send_message(f"§aLooking for a {'ranked ' if ranked else ''}{K['name']} duel...{extra} §8(open Duels again to leave the queue)")
        self.sound(player, "random.orb", 0.5, 1.2)

    def free_arena(self, kit, size=2):
        """A duel arena of the right kind for this kit that nobody is using."""
        designs = DESIGN_FOR[KITS[kit]["kind"]]
        return next((a for a in A.ARENAS if a["kind"] == "duel" and a["design"] in designs and a["id"] not in self.busy
                     and len(a["spawns"]) >= size), None)

    def match_queues(self):
        t = now()
        for (kit, ranked), q in list(self.queues.items()):
            q[:] = [(u, w) for u, w in q if u in self.players and self.players[u]["where"] == "lobby"]
            while len(q) >= 2:
                pair = None
                if ranked:
                    best = None
                    for i in range(len(q)):
                        for j in range(i + 1, len(q)):
                            a, b = self.players[q[i][0]], self.players[q[j][0]]
                            ra, rb = self.rating(self.data(a["xuid"]), kit), self.rating(self.data(b["xuid"]), kit)
                            window = 100 + 25 * min(t - q[i][1], t - q[j][1])
                            if abs(ra - rb) <= window and (best is None or abs(ra - rb) < best[0]):
                                best = (abs(ra - rb), i, j)
                    if best:
                        pair = (best[1], best[2])
                else:
                    pair = (0, 1)
                if pair is None:
                    break
                arena = self.free_arena(kit)
                if arena is None:
                    for u, _ in q:
                        p = self.online(u)
                        if p is not None:
                            self.tip(p, "§eWaiting for a free arena...")
                    break
                i, j = pair
                ua, ub = q[i][0], q[j][0]
                q[:] = [x for k, x in enumerate(q) if k not in (i, j)]
                self.start_match("duel", kit, {"a": [ua], "b": [ub]}, arena, ranked=ranked)
            for u, w in q:
                p = self.online(u)
                if p is not None and self._n % 4 == 0:
                    self.tip(p, f"§aLooking for a {'ranked ' if ranked else ''}{KITS[kit]['short']} duel §7({int(t - w)}s)")

    def start_match(self, kind, kit, teams, arena, ranked=False, event=False):
        mid = self._next_id
        self._next_id += 1
        m = {"id": mid, "kind": kind, "kit": kit, "ranked": ranked, "arena": arena["id"], "teams": teams,
             "alive": {u for us in teams.values() for u in us}, "start_at": now() + COUNTDOWN, "fighting": False, "ending": None,
             "hits": {}, "kills": {}, "started": now(), "event": event, "said": set(), "before": {}}
        self.matches[mid] = m
        self.busy[arena["id"]] = mid
        order = []
        keys = list(teams)
        for i in range(max(len(v) for v in teams.values())):
            for k in keys:
                if i < len(teams[k]):
                    order.append((k, teams[k][i]))
        spawn_of = {}
        if len(keys) == 2:
            for k in keys:
                for i, u in enumerate(teams[k]):
                    spawn_of[u] = arena["spawns"][(0 if k == keys[0] else 1) + 2 * i]
        else:
            for i, (_k, u) in enumerate(order):
                spawn_of[u] = arena["spawns"][i % len(arena["spawns"])]
        names = {k: ", ".join(self.players[u]["name"] for u in v if u in self.players) for k, v in teams.items()}
        for k, us in teams.items():
            for u in us:
                st, p = self.players.get(u), self.online(u)
                if st is None or p is None:
                    m["alive"].discard(u)
                    continue
                self.unqueue(u)
                st.update(where="match", kit=kit, arena=arena["id"], match=mid, last_hit=None, combo=0)
                if ranked:
                    m["before"][u] = self.rating(self.data(st["xuid"]), kit)
                self.give_kit(p, kit)
                try:
                    p.teleport(self.at(arena, spawn_of[u]))
                except Exception:
                    pass
                self.freeze(p, True)
                them = " vs ".join(names[x] for x in keys if x != k) if len(keys) > 2 else names[[x for x in keys if x != k][0]]
                label = ("Ranked " if ranked else "") + KITS[kit]["name"]
                self.title(p, f"§e§l{COUNTDOWN}", f"§f{label} §7vs §c{them}", 0, 25, 0)
                p.send_message(f"§b⚔ {label}: §fyou vs §c{them}§7 on {arena['name']}." +
                               (f" First to {KITS[kit]['hits']} hits wins." if KITS[kit].get("hits") else ""))
        return m

    def match_players(self, m):
        return [u for us in m["teams"].values() for u in us]

    def team_of(self, m, uid):
        return next((k for k, us in m["teams"].items() if uid in us), None)

    def match_tick(self, t):
        for m in list(self.matches.values()):
            arena = A.BY_ID[m["arena"]]
            if m["ending"] is not None:
                if t >= m["ending"]:
                    self.wrap_match(m)
                continue
            if not m["fighting"]:
                left = int(math.ceil(m["start_at"] - t))
                if left <= 0:
                    m["fighting"] = True
                    for u in self.match_players(m):
                        p = self.online(u)
                        if p is not None:
                            self.freeze(p, False)
                            self.title(p, "§a§lFIGHT!", "", 0, 15, 5)
                            self.sound(p, "random.orb", 0.8, 1.6)
                elif left not in m["said"]:
                    m["said"].add(left)
                    for u in self.match_players(m):
                        p = self.online(u)
                        if p is not None:
                            self.title(p, f"§e§l{left}", "", 0, 25, 0)
                            self.sound(p, "note.pling", 0.6, 1.0)
                continue
            if t - m["started"] > MATCH_LIMIT + COUNTDOWN:
                self.time_up(m)
            # teams with nobody left
            alive_teams = {self.team_of(m, u) for u in m["alive"]}
            if len(alive_teams) <= 1:
                self.end_match(m, next(iter(alive_teams), None))

    def time_up(self, m):
        """Time's up: the side with more health left (or more hits, in Boxing) wins; even is a draw."""
        score = {}
        for k, us in m["teams"].items():
            if KITS[m["kit"]].get("hits"):
                score[k] = sum(m["hits"].get(u, 0) for u in us)
            else:
                score[k] = sum(getattr(self.online(u), "health", 0) for u in us if u in m["alive"] and self.online(u) is not None)
        best = max(score.values()) if score else 0
        top = [k for k, v in score.items() if v == best]
        self.end_match(m, top[0] if len(top) == 1 else None, "time's up")

    def player_out(self, m, uid, killer_uid=None):
        from endstone import GameMode
        if uid not in m["alive"]:
            return
        m["alive"].discard(uid)
        p = self.online(uid)
        if p is not None:
            arena = A.BY_ID[m["arena"]]
            try:
                p.game_mode = GameMode.SPECTATOR
                p.teleport(self.at(arena, (0.5, 7, 0.5, 0.0)))
            except Exception:
                pass
            self.title(p, "§c§lOUT!", "§7Watch the rest of the fight", 0, 30, 10)

    def forfeit(self, player, st, quit=False):
        """Leaving (or disconnecting from) a match: you lose it."""
        m = self.matches.get(st.get("match"))
        if m is None or m["ending"] is not None:
            return
        uid = st["uid"]
        if uid in m["alive"]:
            m["alive"].discard(uid)
            killer = st["last_hit"][0] if st.get("last_hit") and now() - st["last_hit"][1] < COMBAT_TAG else None
            kp = self.online(killer) if killer else None
            if kp is not None and m["fighting"]:
                self.count_kill(kp, player, f"§c{player.name} §7left the fight with §a{kp.name}")
        alive_teams = {self.team_of(m, u) for u in m["alive"]}
        if len(alive_teams) <= 1:
            self.end_match(m, next(iter(alive_teams), None), f"{player.name} left")

    def end_match(self, m, winner, reason=None):
        if m["ending"] is not None:
            return
        m["ending"] = now() + 4
        m["fighting"] = False
        m["winner"] = winner
        kit = m["kit"]
        K = KITS[kit]
        everyone = self.match_players(m)
        win_names = ", ".join(self.players[u]["name"] for u in m["teams"].get(winner, []) if u in self.players) if winner else "Nobody"
        changes = {}
        if m["ranked"] and winner and len(everyone) == 2:   # ratings: more for beating a stronger player
            wa = m["teams"][winner][0]
            lb = next(u for u in everyone if u != wa)
            ra, rb = m["before"].get(wa, START_RATING), m["before"].get(lb, START_RATING)
            for u, mine, theirs, score in ((wa, ra, rb, 1), (lb, rb, ra, 0)):
                st = self.players.get(u)
                if st is not None:
                    k = 40 if self.data(st["xuid"])["ranked"].get(kit, 0) < 10 else 24   # new players move faster
                    changes[u] = elo(mine, theirs, score, k)
        for u in everyone:
            st, p = self.players.get(u), self.online(u)
            if st is None:
                continue
            won = winner is not None and u in m["teams"].get(winner, [])
            d = self.data(st["xuid"])
            d["games"][kit] = d["games"].get(kit, 0) + 1
            if winner is not None:
                key = "wins" if won else "losses"
                d[key][kit] = d[key].get(kit, 0) + 1
            if u in changes:
                d["ranked"][kit] = d["ranked"].get(kit, 0) + 1
                d["ratings"][kit] = max(100, self.rating(d, kit) + changes[u])
            self.save_data(st["xuid"], st["name"], d)
            if p is None:
                continue
            delta = changes.get(u)
            rate = f" §7Rating: {tier_text(d['ratings'][kit])} ({'+' if delta >= 0 else ''}{delta})" if delta is not None else ""
            if winner is None:
                self.title(p, "§e§lDRAW", f"§7{reason or ''}", 5, 60, 15)
            else:
                self.title(p, "§6§lVICTORY!" if won else "§c§lDEFEAT", f"§f{win_names} §7won" + (f" ({reason})" if reason else ""), 5, 60, 15)
            p.send_message((f"§6§lVictory! " if won else "§c§lDefeat. ") + f"§r§7{K['name']}{' (ranked)' if m['ranked'] else ''}" + rate)
            self.sound(p, "random.levelup" if won else "note.bass", 0.6, 1.0)
            if won and not m["event"]:
                kind = "ranked_win" if m["ranked"] else ("party_win" if m["kind"] != "duel" else "duel_win")
                self.pay(p, kind, "winning")
                cos = getattr(self.plugin, "cosmetics", None)
                if cos is not None:
                    try:
                        cos.bw_effect(p, "win", p.location)
                    except Exception:
                        pass
            self.sync_stats(p, d)
        self.send_match(m, changes)

    def wrap_match(self, m):
        """After the end screen: everyone back to the lobby (or the event stands), and the arena is free again."""
        self.matches.pop(m["id"], None)
        arena = A.BY_ID[m["arena"]]
        if KITS[m["kit"]].get("build"):
            self.reset_arena(arena)
        if self.busy.get(m["arena"]) == m["id"]:
            self.busy.pop(m["arena"], None)
        for u, st in list(self.players.items()):
            if st.get("match") != m["id"]:
                continue
            p = self.online(u)
            if p is None:
                continue
            if m["event"] and self.event and u in self.event["players"]:
                self.to_stands(p, st)
            else:
                self.to_lobby(p)
        if m["event"]:
            self.event_next(m)

    def send_match(self, m, changes):
        voice = getattr(self.plugin, "_voice", None)
        if voice is None or not getattr(voice, "ws", None):
            return
        players = []
        for k, us in m["teams"].items():
            for u in us:
                st = self.players.get(u)
                if st is None:
                    continue
                before = m["before"].get(u)
                players.append({"xuid": st["xuid"], "name": st["name"], "team": k, "won": m.get("winner") == k,
                                "kills": m["kills"].get(u, 0), "hits": m["hits"].get(u, 0),
                                "before": before, "after": (before + changes[u]) if before is not None and u in changes else None})
        mode = "event" if m["event"] else ("ranked" if m["ranked"] else ("party" if m["kind"] != "duel" else "duel"))
        try:
            voice.send_json({"type": "pvp_match", "mode": mode, "kit": m["kit"], "started": int(m["started"]),
                             "seconds": round(now() - m["started"]), "winner": m.get("winner"), "arena": A.BY_ID[m["arena"]]["name"],
                             "players": players})
        except Exception:
            pass

    # ---------- challenges (/duel) ----------
    def challenge(self, player, target, kit="classic"):
        if target is None or target is player or str(target.unique_id) == str(player.unique_id):
            return player.send_message("§cPick someone else to duel.")
        if kit not in KITS:
            return player.send_message("§cKits: " + ", ".join(KITS))
        if not self.ready():
            return player.send_message("§bPvP is opening soon!")
        if self.other_minigame(target):
            return player.send_message(f"§c{target.name} is in another game right now.")
        tu = str(target.unique_id)
        self.challenges.setdefault(tu, {})[str(player.unique_id)] = (kit, now())
        player.send_message(f"§aChallenged {target.name} to a {KITS[kit]['name']} duel. §7They have 60 seconds to say yes.")
        target.send_message(f"§b⚔ {player.name}§f challenged you to a §e{KITS[kit]['name']}§f duel! §7Type §a/duel accept§7 or §c/duel deny§7.")
        self.sound(target, "note.pling", 0.8, 1.5)
        form = ActionForm(title="§l§bDuel challenge", content=f"§f{player.name}§7 challenged you to a §e{KITS[kit]['name']}§7 duel.\n\n§8{KITS[kit]['about']}")
        form.add_button("§a§lAccept", on_click=lambda p: self.accept(p, str(player.unique_id)))
        form.add_button("§c§lNo thanks", on_click=lambda p: self.deny(p))
        try:
            if self.state(target) is None or self.state(target)["where"] == "lobby":
                target.send_form(form)
        except Exception:
            pass

    def accept(self, player, from_uid=None):
        mine = self.challenges.get(str(player.unique_id), {})
        mine = {u: v for u, v in mine.items() if now() - v[1] < 60}
        if not mine:
            return player.send_message("§7You don't have a duel challenge right now (they last 60 seconds).")
        from_uid = from_uid if from_uid in mine else max(mine, key=lambda u: mine[u][1])
        kit = mine[from_uid][0]
        self.challenges.pop(str(player.unique_id), None)
        rival = self.online(from_uid)
        if rival is None:
            return player.send_message("§7They're not online any more.")
        for p in (player, rival):
            if self.other_minigame(p):
                return player.send_message("§cOne of you is in another game right now.")
            if not self.playing(p):
                self.join(p)
            st = self.state(p)
            if st is None:
                return
            if st["where"] != "lobby":
                self.to_lobby(p)
        arena = self.free_arena(kit)
        if arena is None:
            for p in (player, rival):
                p.send_message("§eAll the arenas for that kit are busy. §7Try again in a moment.")
            return
        self.start_match("duel", kit, {"a": [from_uid], "b": [str(player.unique_id)]}, arena)

    def deny(self, player):
        mine = self.challenges.pop(str(player.unique_id), {})
        for u in mine:
            p = self.online(u)
            if p is not None:
                p.send_message(f"§7{player.name} said no to your duel.")
        player.send_message("§7Challenge declined.")

    def duel_command(self, sender, args):
        args = " ".join(args or []).split()
        if not hasattr(sender, "xuid"):
            return sender.send_message("Players only.")
        if not args:
            return sender.send_message("§e/duel <player> [kit]§7, §e/duel accept§7, §e/duel deny§7. Kits: " + ", ".join(KITS))
        sub = args[0].lower()
        if sub in ("accept", "yes"):
            return self.accept(sender)
        if sub in ("deny", "no", "decline"):
            return self.deny(sender)
        kit = args[-1].lower() if len(args) > 1 and args[-1].lower() in KITS else "classic"
        name = " ".join(args[:-1] if len(args) > 1 and args[-1].lower() in KITS else args).strip('"')
        target = self.plugin.server.get_player(name)
        if target is None:
            return sender.send_message("§cThat player isn't online.")
        self.challenge(sender, target, kit)

    # ---------- party fights ----------
    def party(self, player):
        social = getattr(self.plugin, "social", None)
        try:
            return social.party_of(str(player.unique_id)) if social is not None else []
        except Exception:
            return []

    def party_fight(self, player, kit, split=True):
        party = self.party(player)
        if not party or party[0] != str(player.unique_id):
            return player.send_message("§cOnly your party's leader can start a party fight.")
        here = [u for u in party if u in self.players and self.players[u]["where"] == "lobby"]
        missing = [self.online(u) for u in party if u not in here]
        for m in missing:
            if m is not None:
                m.send_message(f"§d{player.name}§7 started a party fight. Join §bPvP§7 from the Main Menu to play the next one.")
        if len(here) < 2:
            return player.send_message("§cAt least 2 of your party need to be in the PvP lobby.")
        arena = self.free_arena(kit, size=len(here))
        if arena is None:
            return player.send_message("§eAll the arenas for that kit are busy. §7Try again in a moment.")
        random.shuffle(here)
        if split:
            teams = {"a": here[0::2], "b": here[1::2]}
        else:
            teams = {f"p{i}": [u] for i, u in enumerate(here)}
        self.start_match("party_split" if split else "party_ffa", kit, teams, arena)

    # ---------- events ----------
    def start_event(self, player, kind, kit=None):
        if self.event is not None:
            return player.send_message("§cAn event is already on. §7/pvp event stop ends it.")
        kit = "sumo" if kind == "sumo" else (kit if kit in KITS and kit != "build" else "classic")
        self.event = {"kind": kind, "kit": kit, "phase": "signup", "players": [], "remaining": [], "round": 0, "pairs": [],
                      "next_round": [], "starts": now() + 60, "host": player.name, "said": set()}
        label = self.event_label()
        self.plugin.server.broadcast_message(f"§e§l⚔ {label}§r§e starts in 60 seconds! §7Join from the PvP lobby (Main Menu > PvP > Events)."
                                             f" The winner gets {money.fmt(REWARD['event_win'])}.")
        for st in self.players.values():
            p = self.online(st["uid"])
            if p is not None:
                self.title(p, f"§e§l{label}", "§7Open Events on your hotbar to join", 5, 50, 10)

    def event_label(self):
        e = self.event
        if not e:
            return ""
        return "Sumo Event" if e["kind"] == "sumo" else f"{KITS[e['kit']]['name']} Knockout"

    def join_event(self, player):
        e = self.event
        st = self.state(player)
        if e is None or st is None:
            return player.send_message("§7There's no event right now.")
        if e["phase"] != "signup":
            return player.send_message("§7The event has already started. §fYou can watch from the stands.")
        if st["uid"] not in e["players"]:
            if st["where"] != "lobby":
                self.to_lobby(player)
            self.unqueue(st["uid"])
            e["players"].append(st["uid"])
        player.send_message(f"§aYou're in the {self.event_label()}! §7It starts in {max(0, int(e['starts'] - now()))} seconds.")

    def leave_event(self, uid, quiet=False):
        e = self.event
        if e is None or uid not in e["players"]:
            return
        e["players"].remove(uid)
        if uid in e["remaining"]:
            e["remaining"].remove(uid)
        e["next_round"] = [u for u in e["next_round"] if u != uid]
        e["pairs"] = [pr for pr in e["pairs"] if uid not in pr]
        st = self.players.get(uid)
        if st is not None and st["where"] == "event":
            st["where"] = "lobby"

    def stop_event(self, player=None):
        if self.event is None:
            return
        for u in list(self.event["players"]):
            st, p = self.players.get(u), self.online(u)
            if st is not None and p is not None and st["where"] in ("event",):
                self.to_lobby(p)
        self.event = None
        self.plugin.server.broadcast_message("§7The PvP event was stopped.")

    def to_stands(self, player, st):
        from endstone import GameMode
        arena = A.BY_ID["event"]
        st.update(where="event", match=None, last_hit=None, kit=None, arena="event")
        self.freeze(player, False)
        self.give_lobby(player)
        self.effects(player)
        try:
            player.game_mode = GameMode.ADVENTURE
            player.teleport(self.at(arena, random.choice(arena["stands"])))
        except Exception:
            pass

    def event_tick(self, t):
        e = self.event
        if e is None:
            return
        e["players"] = [u for u in e["players"] if u in self.players]
        if e["phase"] == "signup":
            left = int(e["starts"] - t)
            if left in (30, 10) and left not in e["said"]:
                e["said"].add(left)
                for st in self.players.values():
                    p = self.online(st["uid"])
                    if p is not None:
                        p.send_message(f"§e{self.event_label()} starts in {left} seconds! §7({len(e['players'])} joined) Open Events to join.")
            if t < e["starts"]:
                return
            if len(e["players"]) < 2:
                self.plugin.server.broadcast_message(f"§7The {self.event_label()} needed at least 2 players, so it didn't start.")
                self.event = None
                return
            e["phase"] = "running"
            e["remaining"] = list(e["players"])
            for u in e["players"]:
                p = self.online(u)
                if p is not None:
                    self.to_stands(p, self.players[u])
            for st in self.players.values():
                p = self.online(st["uid"])
                if p is not None:
                    p.send_message(f"§e§l{self.event_label()}§r§e has started with {len(e['players'])} players!")
            self.event_next(None)

    def event_next(self, finished):
        """After each fight: the winner goes on, the loser is out; then the next pair (a new round when this one's done)."""
        e = self.event
        if e is None or e["phase"] != "running":
            return
        if finished is not None:
            winner_uids = finished["teams"].get(finished.get("winner"), []) if finished.get("winner") else []
            for u in self.match_players(finished):
                if u in winner_uids:
                    e["next_round"].append(u)
                elif u in e["remaining"]:
                    e["remaining"].remove(u)
                    p = self.online(u)
                    if p is not None:
                        p.send_message("§cYou're out of the event. §7Stay and watch, or /leave.")
            if not winner_uids:   # a draw: both go on
                e["next_round"] += [u for u in self.match_players(finished) if u in e["remaining"]]
        e["remaining"] = [u for u in e["remaining"] if u in self.players]
        if len(e["remaining"]) <= 1:
            return self.event_done(e["remaining"][0] if e["remaining"] else None)
        if not e["pairs"]:
            pool = [u for u in e["remaining"] if u not in e["next_round"]]
            if e["round"] == 0 or len(pool) < 2:   # the first round, or this round is done: start the next one
                e["round"] += 1
                pool = list(e["remaining"])
                e["next_round"] = []
                random.shuffle(pool)
                if len(pool) % 2:
                    bye = pool.pop()
                    e["next_round"].append(bye)
                    p = self.online(bye)
                    if p is not None:
                        p.send_message("§7You go straight to the next round (odd number of players).")
                e["pairs"] = [(pool[i], pool[i + 1]) for i in range(0, len(pool), 2)]
                self.event_say(f"§e{self.event_label()}: round {e['round']} §7({len(e['remaining'])} players left)")
            else:
                random.shuffle(pool)
                e["pairs"] = [(pool[i], pool[i + 1]) for i in range(0, len(pool) - 1, 2)]
        a, b = e["pairs"].pop(0)
        arena = A.BY_ID["event"]
        self.event_say(f"§e⚔ §f{self.players[a]['name']} §7vs §f{self.players[b]['name']}")
        self.start_match("event", e["kit"], {"a": [a], "b": [b]}, arena, event=True)

    def event_say(self, text):
        e = self.event
        for u in (e["players"] if e else []):
            p = self.online(u)
            if p is not None:
                p.send_message(text)

    def event_done(self, champion):
        e = self.event
        label = self.event_label()
        self.event = None
        if champion is None:
            return
        st, p = self.players.get(champion), self.online(champion)
        name = st["name"] if st else "Someone"
        self.plugin.server.broadcast_message(f"§6§l🏆 {name} won the {label}!")
        if p is not None:
            d = self.data(st["xuid"])
            d["events"] += 1
            self.save_data(st["xuid"], st["name"], d)
            self.title(p, "§6§lCHAMPION!", f"§fYou won the {label}", 5, 80, 20)
            self.pay(p, "event_win", f"winning the {label}")
            cos = getattr(self.plugin, "cosmetics", None)
            if cos is not None:
                try:
                    cos.bw_effect(p, "win", p.location)
                except Exception:
                    pass
            self.sync_stats(p, d)
        for u in (e["players"] if e else []):
            sp, ss = self.online(u), self.players.get(u)
            if sp is not None and ss is not None and ss["where"] == "event":
                self.to_lobby(sp)

    # ---------- spectating ----------
    def spectate(self, player, mid):
        from endstone import GameMode
        m = self.matches.get(mid)
        st = self.state(player)
        if m is None or st is None:
            return player.send_message("§7That fight has ended.")
        self.unqueue(st["uid"])
        st.update(where="spectate", match=mid, arena=m["arena"])
        self.clear(player)
        try:
            player.game_mode = GameMode.SPECTATOR
            player.teleport(self.at(A.BY_ID[m["arena"]], (0.5, 7, 0.5, 0.0)))
        except Exception:
            pass
        player.send_message("§7Watching. §f/leave§7 goes back to the lobby.")

    # ---------- kills and deaths ----------
    def count_kill(self, killer, victim, text=None):
        kst = self.state(killer)
        if kst is None:
            return
        kst["kills"] = kst.get("kills", 0) + 1
        kst["streak"] = kst.get("streak", 0) + 1
        d = self.data(killer.xuid)
        d["kills"] += 1
        d["best_streak"] = max(d["best_streak"], kst["streak"])
        self.save_data(killer.xuid, killer.name, d)
        m = self.matches.get(kst.get("match"))
        if m is not None:
            m["kills"][kst["uid"]] = m["kills"].get(kst["uid"], 0) + 1
        hp = getattr(killer, "health", 0) or 0
        text = (text or f"§c{victim.name} §7was killed by §a{killer.name}") + f" §8[§c{hp / 2:.1f}❤§8]"
        for st in self.players.values():
            if (kst["where"] == "ffa" and st["arena"] == kst["arena"]) or (m is not None and st.get("match") == m["id"]):
                p = self.online(st["uid"])
                if p is not None:
                    p.send_message(text)
        self.sound(killer, "random.orb", 0.7, 1.8)
        cos = getattr(self.plugin, "cosmetics", None)
        if cos is not None:
            try:
                cos.bw_effect(killer, "kill", victim.location)
            except Exception:
                pass
        if kst["where"] == "ffa":
            self.pay(killer, "ffa_kill", "a kill")
            s = kst["streak"]
            if s % 5 == 0:
                for st in self.players.values():
                    p = self.online(st["uid"])
                    if p is not None:
                        p.send_message(f"§6🔥 {killer.name}§e is on a §6{s} kill streak§e in {KITS[kst['kit']]['short']} FFA!")
                self.pay(killer, "streak", f"a {s} kill streak")
        self.sync_stats(killer, d)

    def count_death(self, player):
        st = self.state(player)
        d = self.data(player.xuid)
        d["deaths"] += 1
        if st is not None:
            d["best_streak"] = max(d["best_streak"], st.get("streak", 0))
            st["streak"] = 0
        self.save_data(player.xuid, player.name, d)
        self.sync_stats(player, d)

    def died(self, player, killer_uid, how):
        st = self.state(player)
        if st is None:
            return
        if st["where"] == "match":   # only while the fight is on, and only once
            m = self.matches.get(st.get("match"))
            if m is None or not m["fighting"] or st["uid"] not in m["alive"]:
                return
        killer = self.online(killer_uid) if killer_uid else None
        if killer is not None and self.playing(killer) and killer_uid != st["uid"]:
            self.count_kill(killer, player, f"§c{player.name} §7was knocked into the void by §a{killer.name}" if how == "void" else None)
        else:
            text = f"§c{player.name} §7" + ("fell into the void." if how == "void" else "died.")
            for s in self.players.values():
                if s["arena"] == st["arena"] and s["where"] in ("ffa", "match", "spectate"):
                    p = self.online(s["uid"])
                    if p is not None:
                        p.send_message(text)
        self.count_death(player)
        if st["where"] == "ffa":
            self.ffa_spawn(player, st)
            self.title(player, "§c§lYOU DIED", f"§7{'by ' + killer.name if killer else ''}", 0, 20, 5)
            if killer is not None and self.state(killer) and self.state(killer)["where"] == "ffa":
                self.give_kit(killer, self.state(killer)["kit"], ffa=True)   # a fresh kit for the winner of the fight
        elif st["where"] == "match":
            m = self.matches.get(st["match"])
            if m is not None:
                self.player_out(m, st["uid"], killer_uid)

    # ---------- events from the server ----------
    def armor_points(self, player):
        pts = {"leather": (1, 3, 2, 1), "chainmail": (2, 5, 4, 1), "iron": (2, 6, 5, 2), "diamond": (3, 8, 6, 3), "netherite": (3, 8, 6, 3)}
        total = 0
        inv = player.inventory
        for i, k in enumerate(("helmet", "chestplate", "leggings", "boots")):
            s = getattr(inv, k)
            if s is not None:
                total += pts.get(money.item_id(s).split(":")[-1].split("_")[0], (0, 0, 0, 0))[i]
        return min(20, total)

    def on_damage(self, event):
        """Who can hurt whom in PvP; a hit that would kill is handled here (no death screen, no dropped items)."""
        victim = event.actor
        uid = str(getattr(victim, "unique_id", ""))
        attacker = None
        try:
            attacker = event.damage_source.actor
        except Exception:
            pass
        auid = str(getattr(attacker, "unique_id", "")) if attacker is not None else ""
        st = self.players.get(uid)
        if st is None:
            if auid in self.players:   # PvP players can't hurt anyone outside PvP
                event.is_cancelled = True
                return True
            return False
        if st["where"] not in ("ffa", "match"):
            event.is_cancelled = True
            return True
        m = self.matches.get(st.get("match")) if st["where"] == "match" else None
        if st["where"] == "match" and (m is None or not m["fighting"] or uid not in m["alive"]):
            event.is_cancelled = True
            return True
        t = now()
        ast = self.players.get(auid) if auid else None
        if attacker is not None and auid and auid != uid and hasattr(attacker, "xuid"):
            if ast is None:
                event.is_cancelled = True
                return True
            if st["where"] == "ffa":
                if ast["where"] != "ffa" or ast["arena"] != st["arena"]:
                    event.is_cancelled = True
                    return True
                if t < st["safe_until"]:
                    event.is_cancelled = True
                    self.tip(attacker, "§7Spawn protection")
                    return True
                ast["safe_until"] = 0
            else:
                if ast.get("match") != st.get("match") or auid not in m["alive"] or self.team_of(m, auid) == self.team_of(m, uid):
                    event.is_cancelled = True
                    return True
            st["last_hit"] = (auid, t)
            ast["combo"] = ast.get("combo", 0) + 1
            st["combo"] = 0
            K = KITS[st["kit"]]
            if K.get("hits") and m is not None:
                m["hits"][auid] = m["hits"].get(auid, 0) + 1
                if m["hits"][auid] >= K["hits"]:
                    self.player_out(m, uid, auid)
                return True
        elif st["where"] == "ffa" and t < st["safe_until"]:
            event.is_cancelled = True
            return True
        if KITS[st["kit"]].get("no_damage"):
            return True
        dmg = float(event.damage)
        try:
            kind = str(event.damage_source.type)
        except Exception:
            kind = ""
        if any(k in kind for k in ("attack", "projectile", "explosion")):
            dmg *= 1 - self.armor_points(victim) / 25
        if dmg >= victim.health:
            event.is_cancelled = True
            killer = auid if ast else (st["last_hit"][0] if st.get("last_hit") and t - st["last_hit"][1] < COMBAT_TAG else None)
            self.died(victim, killer, "void" if "void" in kind else "killed")
        return True

    def on_knockback(self, event):
        """GalaxySMP's own knockback feel for some kits."""
        st = self.players.get(str(getattr(event.actor, "unique_id", "")))
        if st is None or st["where"] not in ("ffa", "match") or st.get("kit") not in KB:
            return False
        h, v = KB[st["kit"]]
        try:
            from endstone.util import Vector
            kb = event.knockback
            event.knockback = Vector(kb.x * h, kb.y * v, kb.z * h)
        except Exception:
            pass
        return True

    def in_build_area(self, st, x, y, z):
        if not st or st["where"] not in ("ffa", "match") or not KITS.get(st.get("kit") or "", {}).get("build"):
            return None
        a = A.BY_ID.get(st["arena"])
        if a is None:
            return None
        x1, z1, x2, z2 = A.bounds(a)
        if x1 <= x <= x2 and z1 <= z <= z2 and A.Y - 8 <= y <= A.Y + 16:
            return a
        return None

    def on_place(self, event):
        p = event.player
        st = self.state(p)
        b = event.block
        here = self.in_end(p) and A.in_zone(b.x, b.z)
        if st is None and not here:
            return False
        a = self.in_build_area(st, b.x, b.y, b.z)
        if a is None:
            event.is_cancelled = True
            return True
        self.placed.setdefault(a["id"], {})[(b.x, b.y, b.z)] = now()
        return True

    def on_break(self, event):
        p = event.player
        st = self.state(p)
        b = event.block
        here = self.in_end(p) and A.in_zone(b.x, b.z)
        if st is None and not here:
            return False
        a = self.in_build_area(st, b.x, b.y, b.z)
        spots = self.placed.get(a["id"], {}) if a else {}
        if a is None or (b.x, b.y, b.z) not in spots:
            event.is_cancelled = True
            return True
        spots.pop((b.x, b.y, b.z), None)
        return True

    def reset_arena(self, a):
        """A Build arena after a match: the placed blocks, water, lava and what they made are cleared."""
        spots = self.placed.pop(a["id"], {})
        for x, y, z in spots:
            self.end_cmd(f"setblock {x} {y} {z} air")
        x1, z1, x2, z2 = A.bounds(a)
        for blk in ("water", "flowing_water", "lava", "flowing_lava", "cobblestone", "stone", "obsidian", "white_wool"):
            for c in A.fill(x1, A.Y - 8, z1, x2, A.Y + 12, z2, "minecraft:air", f"replace minecraft:{blk}"):
                self.end_cmd(c)
        self.end_cmd(f"kill @e[type=item,x={x1},y={A.Y - 10},z={z1},dx={x2 - x1},dy=30,dz={z2 - z1}]")

    def decay_tick(self, t):
        """Build free-for-all: placed blocks fade after a few seconds."""
        for aid, spots in self.placed.items():
            a = A.BY_ID.get(aid)
            if a is None or a["kind"] != "ffa":
                continue
            for spot, at in list(spots.items()):
                if t - at >= DECAY:
                    spots.pop(spot, None)
                    self.end_cmd(f"setblock {spot[0]} {spot[1]} {spot[2]} air")

    @staticmethod
    def in_end(p):
        try:
            return "end" in str(p.dimension.name).lower()
        except Exception:
            return False

    def on_drop(self, event):
        if self.playing(event.player):
            event.is_cancelled = True
            return True
        return False

    def on_pickup(self, event):
        if self.playing(event.player):
            event.is_cancelled = True
            return True
        return False

    def on_command(self, event):
        """Only a few commands work in PvP (no teleporting away with the kit)."""
        st = self.state(event.player)
        if st is None:
            return False
        name = event.command.lstrip("/").split(" ")[0].lower()
        if name in ALLOWED or event.player.is_op and name in ("sift", "border", "pvp"):
            return False
        event.is_cancelled = True
        event.player.send_message("§cThat command doesn't work in PvP. §7/leave goes back (to the lobby, then to GalaxySMP).")
        return True

    def on_use(self, event):
        """The lobby hotbar, the Kit Editor's Save, and the ender pearl cooldown."""
        p = event.player
        st = self.state(p)
        if st is None:
            return False
        item = event.item
        key = self.mark_of(item) if item is not None else None
        if key:
            event.is_cancelled = True
            {"ffa": self.ffa_menu, "duels": self.duels_menu, "ranked": self.ranked_menu, "party": self.party_menu,
             "events": self.events_menu, "kits": self.kits_menu, "stats": self.stats_menu, "leave": self.leave,
             "save": self.save_layout}.get(key, lambda x: None)(p)
            return True
        if item is not None and money.item_id(item) == "minecraft:ender_pearl" and st["where"] in ("ffa", "match"):
            t = now()
            if t < st["pearl"]:
                event.is_cancelled = True
                self.tip(p, f"§cPearl ready in {int(math.ceil(st['pearl'] - t))}s")
                return True
            st["pearl"] = t + PEARL_COOLDOWN
            return False
        if st["where"] not in ("ffa", "match"):   # no throwing pearls or potions in the lobby, the stands or the Kit Editor
            event.is_cancelled = True
            return True
        return False

    # ---------- the Kit Editor ----------
    def edit_kit(self, player, kit):
        st = self.state(player)
        if st is None:
            return
        st.update(where="edit", kit=kit)
        self.give_kit(player, kit)
        from endstone import GameMode
        try:
            player.game_mode = GameMode.ADVENTURE
        except Exception:
            pass
        inv = player.inventory
        for piece in ("helmet", "chestplate", "leggings", "boots"):
            try:
                setattr(inv, piece, None)
            except Exception:
                pass
        free = next((i for i in (8, *range(9, 36), *range(0, 8)) if inv.get_item(i) is None), 8)
        inv.set_item(free, self.stack("lime_dye", 1, 0, "§a§lSave this layout", ["§7Tap to save where your items are", f"{MARK}:save"]))
        player.send_message(f"§fKit Editor: §e{KITS[kit]['name']}§f. §7Open your inventory and move the items where you want them, "
                            "then tap §aSave this layout§7. §f/leave§7 cancels.")

    def save_layout(self, player):
        st = self.state(player)
        if st is None or st["where"] != "edit":
            return
        inv = player.inventory
        layout = []
        for i in range(36):
            s = inv.get_item(i)
            if s is None or self.mark_of(s):
                continue
            layout.append([i, money.item_id(s), int(getattr(s, "data", 0) or 0)])
        d = self.data(player.xuid)
        d["layouts"][st["kit"]] = layout
        self.save_data(player.xuid, player.name, d)
        player.send_message(f"§aSaved your {KITS[st['kit']]['name']} layout! §7Every match uses it now.")
        self.sound(player, "random.orb", 0.6, 1.4)
        self.to_lobby(player)

    # ---------- menus ----------
    def ffa_menu(self, player):
        form = ActionForm(title="§l§bFree-for-all", content="§7Jump in any time. Kill streaks pay more. §f/leave§7 brings you back here.")
        for kit in ("potion", "classic", "sumo", "build"):
            a = self.ffa_arena(kit)
            form.add_button(f"§l{KITS[kit]['name']}§r\n§8{a['name']} · {self.ffa_count(a['id'])} fighting", icon=KITS[kit]["icon"],
                            on_click=lambda p, k=kit: self.join_ffa(p, k))
        player.send_form(form)

    def duels_menu(self, player, ranked=False):
        uid = str(player.unique_id)
        q = self.queued(uid)
        d = self.data(player.xuid)
        title = "§l§6Ranked" if ranked else "§l§aDuels"
        text = ("§7Win to climb: §cBronze §7· §7Silver §7· §6Gold §7· §3Platinum §7· §bDiamond §7· §dGalaxy§7. Everyone starts at 1000."
                if ranked else "§7Casual 1v1s. Pick a kit, or challenge someone.")
        if q:
            text += f"\n\n§aYou're in the {'ranked ' if q[1] else ''}{KITS[q[0]]['name']} queue."
        form = ActionForm(title=title, content=text)
        if q:
            form.add_button("§c§lLeave the queue", icon="textures/ui/cancel", on_click=lambda p: (self.unqueue(uid), p.send_message("§7Left the queue.")))
        for kit, K in KITS.items():
            waiting = len(self.queues.get((kit, ranked), []))
            sub = f"{tier_text(self.rating(d, kit))}§8 · {waiting} waiting" if ranked else f"{waiting} waiting"
            form.add_button(f"§l{K['name']}§r\n§8{sub}", icon=K["icon"], on_click=lambda p, k=kit: self.queue(p, k, ranked))
        if not ranked:
            form.add_button("§lChallenge a player§r\n§8/duel <name> [kit] works too", icon="textures/ui/FriendsIcon", on_click=self.challenge_menu)
            if self.matches:
                form.add_button(f"§lWatch a match§r\n§8{len(self.matches)} on now", icon="textures/ui/camera-yo", on_click=self.watch_menu)
        player.send_form(form)

    def ranked_menu(self, player):
        self.duels_menu(player, ranked=True)

    def challenge_menu(self, player):
        others = [p for p in self.plugin.server.online_players if str(p.unique_id) != str(player.unique_id)]
        form = ActionForm(title="§l§aChallenge a player", content="§7Who do you want to duel? (They can say yes from anywhere.)" if others
                          else "§7Nobody else is online right now.")
        for o in others[:40]:
            where = "in PvP" if self.playing(o) else "on GalaxySMP"
            form.add_button(f"§l{o.name}§r\n§8{where}", on_click=lambda p, t=str(o.unique_id): self.challenge_kit(p, t))
        player.send_form(form)

    def challenge_kit(self, player, target_uid):
        form = ActionForm(title="§l§aPick a kit", content="§7Which kit?")
        for kit, K in KITS.items():
            form.add_button(f"§l{K['name']}", icon=K["icon"], on_click=lambda p, k=kit: self.challenge(p, self.online(target_uid), k))
        player.send_form(form)

    def watch_menu(self, player):
        form = ActionForm(title="§l§aWatch a match", content="§7Fights going on right now:")
        for m in list(self.matches.values())[:20]:
            names = " vs ".join(", ".join(self.players[u]["name"] for u in us if u in self.players) for us in m["teams"].values())
            form.add_button(f"§l{names}§r\n§8{KITS[m['kit']]['name']}{' · ranked' if m['ranked'] else ''}",
                            on_click=lambda p, mid=m["id"]: self.spectate(p, mid))
        player.send_form(form)

    def party_menu(self, player):
        party = self.party(player)
        here = [u for u in party if u in self.players]
        if not party:
            form = ActionForm(title="§l§dParty fights", content="§7You're not in a party. Invite friends with §f/party invite <name>§7 "
                                                                "(up to 4), then come back here.")
            form.add_button("OK")
            return player.send_form(form)
        names = "\n".join(f" §7• §f{self.players[u]['name'] if u in self.players else 'Not in PvP yet'}" for u in party)
        form = ActionForm(title="§l§dParty fights", content=f"§fYour party ({len(here)}/{len(party)} in PvP):\n{names}")
        if party[0] == str(player.unique_id):
            for split, label in ((True, "Split into two teams"), (False, "Party free-for-all")):
                form.add_button(f"§l{label}", on_click=lambda p, s=split: self.party_kit(p, s))
        else:
            form.content += "\n\n§7Your party leader starts the fights."
        player.send_form(form)

    def party_kit(self, player, split):
        form = ActionForm(title="§l§dPick a kit", content="§7Which kit?")
        for kit, K in KITS.items():
            form.add_button(f"§l{K['name']}", icon=K["icon"], on_click=lambda p, k=kit: self.party_fight(p, k, split))
        player.send_form(form)

    def events_menu(self, player):
        e = self.event
        if e is None:
            text = "§7No event right now. Staff start Sumo events and Knockout tournaments; you'll see it in chat."
        elif e["phase"] == "signup":
            text = f"§e{self.event_label()}§7 starts in {max(0, int(e['starts'] - now()))}s · {len(e['players'])} joined\n§7Prize: {money.fmt(REWARD['event_win'])}"
        else:
            text = f"§e{self.event_label()}§7: round {e['round']}, {len(e['remaining'])} players left"
        form = ActionForm(title="§l§eEvents", content=text)
        uid = str(player.unique_id)
        if e and e["phase"] == "signup":
            if uid in e["players"]:
                form.add_button("§c§lLeave the event", on_click=lambda p: (self.leave_event(uid), p.send_message("§7You left the event.")))
            else:
                form.add_button("§a§lJoin the event", on_click=self.join_event)
        elif e:
            form.add_button("§lWatch from the stands", on_click=lambda p: self.to_stands(p, self.state(p)) if self.state(p) else None)
        if player.is_op:
            if e is None:
                form.add_button("§6§lStart a Sumo event§r\n§8Staff", on_click=lambda p: self.start_event(p, "sumo"))
                form.add_button("§6§lStart a Knockout§r\n§8Staff: pick a kit", on_click=self.knockout_kit)
            else:
                form.add_button("§c§lStop the event§r\n§8Staff", on_click=self.stop_event)
        player.send_form(form)

    def knockout_kit(self, player):
        form = ActionForm(title="§l§eKnockout kit", content="§7Which kit should the tournament use?")
        for kit in ("classic", "potion", "boxing", "sumo"):
            form.add_button(f"§l{KITS[kit]['name']}", icon=KITS[kit]["icon"], on_click=lambda p, k=kit: self.start_event(p, "knockout", k))
        player.send_form(form)

    def kits_menu(self, player):
        form = ActionForm(title="§l§fKit Editor", content="§7Pick a kit to move its items where you like them. Matches and free-for-all use your layout.")
        d = self.data(player.xuid)
        for kit, K in KITS.items():
            if not K["items"]:
                continue
            custom = "your layout" if d["layouts"].get(kit) else "default layout"
            form.add_button(f"§l{K['name']}§r\n§8{custom}", icon=K["icon"], on_click=lambda p, k=kit: self.edit_kit(p, k))
        if d["layouts"]:
            form.add_button("§c§lReset all layouts", on_click=self.reset_layouts)
        player.send_form(form)

    def reset_layouts(self, player):
        d = self.data(player.xuid)
        d["layouts"] = {}
        self.save_data(player.xuid, player.name, d)
        player.send_message("§7Your kits are back to their normal layouts.")

    def stats_menu(self, player):
        d = self.data(player.xuid)
        lines = [f"§fKills §a{d['kills']}§f · Deaths §c{d['deaths']}§f · Best streak §6{d['best_streak']}",
                 f"§fWins §a{sum(d['wins'].values())}§f · Losses §c{sum(d['losses'].values())}§f · Events won §e{d['events']}", ""]
        for kit, K in KITS.items():
            w, l = d["wins"].get(kit, 0), d["losses"].get(kit, 0)
            rated = f"{tier_text(self.rating(d, kit))}§7" if d["ranked"].get(kit) else "§8not ranked yet§7"
            lines.append(f"§f{K['name']}: {rated} · {w}W {l}L")
        form = ActionForm(title="§l§bStats & Effects", content="\n".join(lines) + "\n\n§7More on your profile at §bgalaxymc.us")
        form.add_button("§lTop ranked players", icon="textures/ui/icon_trophy", on_click=self.top_menu)
        cos = getattr(self.plugin, "cosmetics", None)
        if cos is not None:
            form.add_button("§lKill & victory effects", icon="textures/items/nether_star", on_click=cos.bw_menu)
        player.send_form(form)

    def top_menu(self, player):
        rows = self.db.execute("SELECT name, data FROM pvp_data").fetchall()
        lines = []
        for kit, K in KITS.items():
            ranked = []
            for name, raw in rows:
                try:
                    d = json.loads(raw)
                except Exception:
                    continue
                if (d.get("ranked") or {}).get(kit):
                    ranked.append((int((d.get("ratings") or {}).get(kit, START_RATING)), name))
            ranked.sort(reverse=True)
            lines.append(f"§e§l{K['name']}§r")
            lines += [f" §7{i + 1}. §f{n} {tier_text(r)}" for i, (r, n) in enumerate(ranked[:5])] or [" §8Nobody yet"]
        form = ActionForm(title="§l§bTop ranked", content="\n".join(lines))
        form.add_button("< Back", on_click=self.stats_menu)
        player.send_form(form)

    # ---------- /pvp ----------
    def command(self, sender, args):
        args = " ".join(args or []).split()
        sub = args[0].lower() if args else ""
        if sub in ("build", "status", "stop", "auto") and sender.is_op:
            return self.staff(sender, sub, args[1:])
        if sub == "event" and sender.is_op and hasattr(sender, "xuid"):
            what = args[1].lower() if len(args) > 1 else ""
            if what == "stop":
                return self.stop_event(sender)
            if what in ("sumo", "knockout"):
                return self.start_event(sender, what, args[2].lower() if len(args) > 2 else None)
            return sender.send_message("§e/pvp event sumo§7, §e/pvp event knockout [kit]§7, §e/pvp event stop")
        if not hasattr(sender, "xuid"):
            return sender.send_message("Players only.")
        if sub == "leave":
            return self.leave(sender)
        if sub == "stats":
            return self.stats_menu(sender) if self.playing(sender) else sender.send_message("§7Join PvP from the Main Menu first.")
        if self.playing(sender):
            st = self.state(sender)
            return self.to_lobby(sender) if st["where"] != "lobby" else sender.send_message("§7Use your hotbar to pick a mode.")
        return self.join(sender)

    def staff(self, sender, sub, rest):
        b = self.builder
        if sub == "build":
            again = bool(rest) and rest[0].lower() == "again"
            if b.ready() and not again:
                return sender.send_message("§eThe arenas are already built. §7/pvp build again rebuilds them (nobody should be in PvP).")
            if again and self.players:
                return sender.send_message("§cEveryone has to leave PvP first.")
            b.eco().set_config(A.STOPS, 0)
            if b.start(sender, again=again):
                sender.send_message("§bBuilding the PvP arenas in the background. §7It pauses when the server is busy. /pvp status shows progress.")
            else:
                sender.send_message("§eThey're already being built.")
            return
        if sub == "stop":
            b.stop()
            b.eco().set_config(A.AUTO, False)
            return sender.send_message("§eStopped building the arenas. §7/pvp build carries on; /pvp auto on lets it finish when quiet.")
        if sub == "auto":
            on = not rest or rest[0].lower() in ("on", "yes")
            b.eco().set_config(A.AUTO, on)
            if on:
                b.eco().set_config(A.STOPS, 0)
            return sender.send_message("§bThe arenas will build by themselves while the server is quiet." if on else "§eThe arenas won't build by themselves.")
        done, total = b.progress()
        state = "§aready" if b.ready() else (f"§e{done}/{total} arenas built§f, " + ("building now" if b.building() else
                                             ("builds when the server is quiet" if b.eco().get_config(A.AUTO) is not False else "not building (/pvp build)")))
        sender.send_message(f"§bPvP: §f{state}§f · {len(self.players)} in PvP · {len(self.matches)} matches on")

    # ---------- every quarter second ----------
    def tick(self):
        self._n += 1
        t = now()
        try:
            if not self.ready():
                if self._n % 20 == 0:
                    self.builder.auto_check()
                return
            for st in list(self.players.values()):
                p = self.online(st["uid"])
                if p is None:
                    self.players.pop(st["uid"], None)
                    continue
                self.player_tick(p, st, t)
            self.match_tick(t)
            self.event_tick(t)
            if self._n % 2 == 0:
                self.match_queues()
            if self._n % 4 == 0:
                self.decay_tick(t)
                self.hud_all(t)
            if self._n % 8 == 0:
                self.keep_out()
            if self._n % 120 == 0:
                self.sweep()
        except Exception as e:
            self.plugin.logger.warning(f"PvP: {e}")

    def player_tick(self, p, st, t):
        where = st["where"]
        try:
            y = p.location.y
        except Exception:
            return
        if where in ("ffa", "match"):
            a = A.BY_ID.get(st["arena"])
            lose = a.get("lose_below") if a else None
            fighting = where == "ffa" or (st["match"] in self.matches and self.matches[st["match"]]["fighting"]
                                          and st["uid"] in self.matches[st["match"]]["alive"])
            if lose is not None and y < lose and fighting:
                killer = st["last_hit"][0] if st.get("last_hit") and t - st["last_hit"][1] < COMBAT_TAG else None
                self.died(p, killer, "void")
                return
            if y < A.Y - VOID_DROP and fighting:
                killer = st["last_hit"][0] if st.get("last_hit") and t - st["last_hit"][1] < COMBAT_TAG else None
                self.died(p, killer, "void")
                return
            left = st["pearl"] - t
            try:
                p.exp_level = max(0, int(math.ceil(left)))
                p.exp_progress = max(0.0, min(1.0, left / PEARL_COOLDOWN))
            except Exception:
                pass
        elif where in ("lobby", "event", "edit") and y < A.Y - 6:
            if where == "event":
                self.to_stands(p, st)
            else:
                lobby = A.BY_ID["lobby"]
                try:
                    p.teleport(self.at(lobby, lobby["spawns"][0]))
                except Exception:
                    pass
        elif where == "spectate":
            a = A.BY_ID.get(st["arena"])
            if st.get("match") not in self.matches:
                return self.to_lobby(p)
            if a and (abs(p.location.x - a["cx"]) > a["size"] + 25 or abs(p.location.z - a["cz"]) > a["size"] + 25 or y < A.Y - 20 or y > A.Y + 50):
                try:
                    p.teleport(self.at(a, (0.5, 7, 0.5, 0.0)))
                except Exception:
                    pass

    def keep_out(self):
        """Only PvP players belong in the PvP area of the End (the owner can go anywhere)."""
        borders = getattr(self.plugin, "borders", None)
        for p in self.plugin.server.online_players:
            if self.playing(p) or not self.in_end(p):
                continue
            l = p.location
            if not A.in_zone(l.x, l.z):
                continue
            try:
                if borders is not None and borders.free(p):
                    continue
            except Exception:
                pass
            spot = self.plugin.economy.get_config("spawn")
            try:
                if spot:
                    p.teleport(self.plugin.teleports.location(spot))
            except Exception:
                pass
            p.send_message("§cThat part of the End is GalaxySMP PvP. §7Join it from the Main Menu.")

    def sweep(self):
        """Every 30 seconds: dropped items, arrows and any mobs that wandered onto the arenas are cleared."""
        x1, z1, x2, z2 = A.ZONE
        self.end_cmd(f"kill @e[type=item,x={x1},y={A.Y - 30},z={z1},dx={x2 - x1},dy=70,dz={z2 - z1}]")
        self.end_cmd(f"kill @e[type=arrow,x={x1},y={A.Y - 30},z={z1},dx={x2 - x1},dy=70,dz={z2 - z1}]")
        self.end_cmd(f"kill @e[type=enderman,x={x1},y={A.Y - 30},z={z1},dx={x2 - x1},dy=70,dz={z2 - z1}]")

    # ---------- the sidebar ----------
    def hud_lines(self, st, t):
        d = self.data(st["xuid"])
        where = st["where"]
        lines = []
        if where == "lobby":
            best = self.best_rating(d)
            q = self.queued(st["uid"])
            lines = [f"§fRating: {tier_text(best) if best else '§8not ranked'}", f"§fWins: §a{sum(d['wins'].values())}",
                     f"§fKills: §a{d['kills']}", f"§fBest streak: §6{d['best_streak']}", "",
                     f"§fIn PvP: §b{len(self.players)}", f"§fFighting: §b{sum(1 for s in self.players.values() if s['where'] in ('ffa', 'match'))}"]
            if q:
                lines += ["", f"§aQueue: {KITS[q[0]]['short']}{' ranked' if q[1] else ''}"]
            if self.event and self.event["phase"] == "signup":
                lines += ["", f"§e{self.event_label()} in {max(0, int(self.event['starts'] - t))}s"]
        elif where == "ffa":
            a = A.BY_ID[st["arena"]]
            lines = [f"§f{KITS[st['kit']]['name']} FFA", f"§7{a['name']}", "", f"§fKills: §a{st.get('kills', 0)}",
                     f"§fStreak: §6{st.get('streak', 0)}", f"§fBest: §6{d['best_streak']}", "", f"§fPlayers: §b{self.ffa_count(a['id'])}"]
        elif where in ("match", "spectate"):
            m = self.matches.get(st["match"])
            if m:
                lines = [f"§f{'Ranked ' if m['ranked'] else ''}{KITS[m['kit']]['name']}", f"§7{A.BY_ID[m['arena']]['name']}", ""]
                for k, us in m["teams"].items():
                    for u in us:
                        o = self.online(u)
                        name = self.players[u]["name"] if u in self.players else "?"
                        hp = f"§c{(o.health if o else 0) / 2:.1f}❤" if u in m["alive"] else "§8out"
                        extra = f" §e{m['hits'].get(u, 0)}" if KITS[m["kit"]].get("hits") else ""
                        ping = f" §8{getattr(o, 'ping', 0)}ms" if o is not None else ""
                        lines.append(f"{'§a' if u == st['uid'] else '§f'}{name[:12]} {hp}{extra}{ping}")
                secs = max(0, int(t - m["started"] - COUNTDOWN))
                lines += ["", f"§fTime: §7{secs // 60}:{secs % 60:02d}"]
        elif where == "event" and self.event:
            e = self.event
            lines = [f"§e{self.event_label()}", "", f"§fRound: §a{e['round']}", f"§fPlayers left: §a{len(e['remaining'])}",
                     "§7You're in!" if st["uid"] in e["remaining"] else "§8Watching"]
        elif where == "edit":
            lines = ["§fKit Editor", f"§e{KITS[st['kit']]['name']}", "", "§7Move items, then tap Save"]
        return lines + ["", "§bgalaxymc.us"]

    def hud_all(self, t):
        for st in list(self.players.values()):
            p = self.online(st["uid"])
            if p is not None:
                self.hud(p, self.hud_lines(st, t))

    def hud(self, player, lines):
        from endstone.scoreboard import Criteria, DisplaySlot, ObjectiveSortOrder
        uid = str(player.unique_id)
        seen, fixed = set(), []
        for line in lines:
            text = line
            while text in seen:
                text += "§r"
            seen.add(text)
            fixed.append(text)
        board = self.boards.get(uid)
        try:
            if board is None:
                sb = self.plugin.server.create_scoreboard()
                obj = sb.add_objective("pvp", Criteria.DUMMY, "§l§bGALAXY §fPVP")
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
            self.plugin.logger.warning(f"PvP HUD: {e}")

    def hud_off(self, player):
        self.boards.pop(str(player.unique_id), None)
        try:
            player.scoreboard = self.plugin.server.scoreboard
        except Exception:
            pass

    def refresh_tags(self):
        voice = getattr(self.plugin, "_voice", None)
        try:
            if voice is not None:
                self.plugin.server.scheduler.run_task(self.plugin, voice._apply_icons, delay=2)
        except Exception:
            pass

    def stopping(self):
        """The server is shutting down: nobody is left frozen, and arenas being built are noted."""
        for st in list(self.players.values()):
            p = self.online(st["uid"])
            if p is not None:
                self.freeze(p, False)
        try:
            self.plugin.economy.set_config(A.MID, None)
        except Exception:
            pass
