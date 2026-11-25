"""Player progress: stats, daily rewards, daily quests and achievements.

Stats      playtime, blocks mined and placed, mobs killed, deaths, money earned by selling.
/daily     log in every day for a reward: day 1 $100, day 2 $200 ... day 7 $700 + a Rare crate key,
           then it starts over at day 1. Missing a day restarts the streak, unless you have a Streak Freeze:
           one is used up by itself for each missed day. You earn a freeze every 7 days of streak (holding up
           to 2 earned ones), and can get more from the Store or Galaxy Pro+ (holding up to 10).
           Streak milestones (7, 30, 50, 100, 200, 365 days) are celebrated.
           Galaxy+ gets 25% more, Galaxy Pro+ 50% more. Days start at midnight (US Eastern).
/quests    3 new quests every day: one easy, one medium, one hard. Finishing all 3 gives a Common crate key.
/achievements  milestones (shown on galaxymc.us profiles) and small money rewards.
/stats [player]  someone's stats.

Rewards are kept small on purpose so the economy stays realistic.
Stats are sent to galaxymc.us for the leaderboards and player profiles.
"""

import datetime
import json
import random
import time

from endstone.form import ActionForm
from endstone_galaxylink.announcements import show_title

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("America/New_York")
except Exception:  # no time zone data on this machine: use UTC
    TZ = datetime.timezone.utc

DAILY_CENTS = [2500, 5000, 2500, 7500, 5000, 10000, 10000]  # $25 ... $100 (packs and keys do the heavy lifting now)
DAILY_PACKS = {3: {"food": 1}, 5: {"tools": 1}, 7: {"rare": 1}}   # day -> item packs
DAILY_KEYS = {5: {"common": 1}, 7: {"rare": 1}}                    # day -> crate keys
PLAN_BONUS = {"free": 1.0, "plus": 1.25, "pro": 1.5}

STONE = {"stone", "cobblestone", "deepslate", "cobbled_deepslate", "andesite", "diorite", "granite", "tuff", "netherrack", "blackstone", "basalt"}
DIRT = {"dirt", "grass_block", "grass", "sand", "red_sand", "gravel", "coarse_dirt", "clay", "mud", "podzol", "mycelium"}
CROPS = {"wheat", "carrots", "potatoes", "beetroot"}
HOSTILE = {"zombie", "husk", "drowned", "zombie_villager_v2", "zombie_villager", "skeleton", "stray", "bogged", "creeper", "spider", "cave_spider",
           "enderman", "witch", "slime", "magma_cube", "phantom", "pillager", "vindicator", "evoker", "ravager", "vex", "blaze", "ghast",
           "wither_skeleton", "piglin_brute", "hoglin", "zoglin", "zombie_pigman", "silverfish", "endermite", "guardian", "elder_guardian",
           "shulker", "breeze", "warden", "wither", "ender_dragon"}


def short(t):
    return str(t or "").replace("minecraft:", "")


def ore(name):
    return lambda b: short(b) in (f"{name}_ore", f"deepslate_{name}_ore") or (name == "gold" and short(b) == "nether_gold_ore")


# Quest kinds: what counts towards them.
#   mine: a broken block passing the filter; place: placed blocks; kill: killed mobs passing the filter;
#   harvest: fully grown crops; sell: dollars earned selling; play: minutes played;
#   bw_play / bw_win / bw_kill / bw_bed: Bedwars games played, won, kills and beds broken.
QUESTS = {
    "easy": [
        ("mine_stone_64", "Mine 64 stone", "mine", lambda b: short(b) in STONE, 64),
        ("chop_32", "Chop 32 logs", "mine", lambda b: short(b).endswith(("_log", "_stem")), 32),
        ("dig_64", "Dig 64 dirt, sand or gravel", "mine", lambda b: short(b) in DIRT, 64),
        ("place_64", "Place 64 blocks", "place", None, 64),
        ("kill_5", "Defeat 5 hostile mobs", "kill", lambda m: short(m) in HOSTILE, 5),
        ("harvest_32", "Harvest 32 fully grown crops", "harvest", None, 32),
        ("play_20", "Play for 20 minutes", "play", None, 20),
        ("bw_play_1", "Play a game of Bedwars", "bw_play", None, 1),
    ],
    "medium": [
        ("mine_stone_256", "Mine 256 stone", "mine", lambda b: short(b) in STONE, 256),
        ("coal_16", "Mine 16 coal ore", "mine", ore("coal"), 16),
        ("iron_12", "Mine 12 iron ore", "mine", ore("iron"), 12),
        ("chop_128", "Chop 128 logs", "mine", lambda b: short(b).endswith(("_log", "_stem")), 128),
        ("kill_20", "Defeat 20 hostile mobs", "kill", lambda m: short(m) in HOSTILE, 20),
        ("harvest_128", "Harvest 128 fully grown crops", "harvest", None, 128),
        ("sell_50", "Sell $50 of items to the Shop", "sell", None, 50),
        ("play_60", "Play for 1 hour", "play", None, 60),
        ("bw_kill_5", "Get 5 kills in Bedwars", "bw_kill", None, 5),
        ("bw_bed_1", "Break a bed in Bedwars", "bw_bed", None, 1),
    ],
    "hard": [
        ("diamond_5", "Mine 5 diamond ore", "mine", ore("diamond"), 5),
        ("gold_16", "Mine 16 gold ore", "mine", ore("gold"), 16),
        ("mine_1000", "Mine 1,000 blocks", "mine", lambda b: True, 1000),
        ("kill_60", "Defeat 60 hostile mobs", "kill", lambda m: short(m) in HOSTILE, 60),
        ("endermen_10", "Defeat 10 endermen", "kill", lambda m: short(m) == "enderman", 10),
        ("sell_250", "Sell $250 of items to the Shop", "sell", None, 250),
        ("place_500", "Place 500 blocks", "place", None, 500),
        ("play_120", "Play for 2 hours", "play", None, 120),
        ("bw_win_1", "Win a game of Bedwars", "bw_win", None, 1),
        ("bw_bed_2", "Break 2 beds in Bedwars", "bw_bed", None, 2),
    ],
}
QUEST_REWARD = {"easy": 1000, "medium": 2500, "hard": 5000}  # $10, $25, $50
QUEST_PACKS = {"hard": {"food": 1}}  # hard quests also give a Food Pack
QUEST_BY_ID = {q[0]: (tier, q) for tier, qs in QUESTS.items() for q in qs}

def achievement_cents(cents):
    """Achievements pay a quarter of their listed amount (rounded to $5), so rewards don't flood the economy."""
    if not cents:
        return 0
    return max(500, int(round(cents / 4 / 500)) * 500)


# (id, name, description, emoji for the website, reward cents (paid at a quarter), test(stats, extra))
ACHIEVEMENTS = [
    ("welcome", "Welcome to the Galaxy", "Join GalaxySMP for the first time", "🌌", 0, lambda s, x: True),
    ("play_1h", "Settling In", "Play for 1 hour", "⏱️", 1000, lambda s, x: s["playtime"] >= 3600),
    ("play_10h", "Regular", "Play for 10 hours", "🕰️", 10000, lambda s, x: s["playtime"] >= 36000),
    ("play_100h", "Galaxy Veteran", "Play for 100 hours", "🏅", 50000, lambda s, x: s["playtime"] >= 360000),
    ("mine_1k", "Rookie Miner", "Mine 1,000 blocks", "⛏️", 2500, lambda s, x: s["mined"] >= 1000),
    ("mine_10k", "Miner", "Mine 10,000 blocks", "⛏️", 10000, lambda s, x: s["mined"] >= 10000),
    ("mine_100k", "Master Miner", "Mine 100,000 blocks", "💎", 50000, lambda s, x: s["mined"] >= 100000),
    ("diamonds", "Diamonds!", "Mine your first diamond ore", "💠", 2500, lambda s, x: s.get("diamonds", 0) >= 1),
    ("build_1k", "Builder", "Place 1,000 blocks", "🧱", 2500, lambda s, x: s["placed"] >= 1000),
    ("build_10k", "Architect", "Place 10,000 blocks", "🏗️", 10000, lambda s, x: s["placed"] >= 10000),
    ("build_100k", "Master Builder", "Place 100,000 blocks", "🏰", 50000, lambda s, x: s["placed"] >= 100000),
    ("hunt_100", "Monster Hunter", "Defeat 100 mobs", "🗡️", 2500, lambda s, x: s["kills"] >= 100),
    ("hunt_1k", "Slayer", "Defeat 1,000 mobs", "⚔️", 10000, lambda s, x: s["kills"] >= 1000),
    ("hunt_10k", "Legendary Slayer", "Defeat 10,000 mobs", "🐉", 50000, lambda s, x: s["kills"] >= 10000),
    ("first_death", "First Defeat", "Die for the first time", "💀", 0, lambda s, x: s["deaths"] >= 1),
    ("streak_7", "Week Streak", "Claim your daily reward 7 days in a row", "🔥", 5000, lambda s, x: s["best_streak"] >= 7),
    ("streak_30", "Dedicated", "Claim your daily reward 30 days in a row", "📅", 25000, lambda s, x: s["best_streak"] >= 30),
    ("quests_10", "Quester", "Complete 10 quests", "📜", 5000, lambda s, x: s["quests"] >= 10),
    ("quests_100", "Quest Master", "Complete 100 quests", "🏆", 25000, lambda s, x: s["quests"] >= 100),
    ("seller", "Merchant", "Sell $100 of items to the Shop", "🪙", 1000, lambda s, x: s["sold"] >= 10000),
    ("landowner", "Landowner", "Claim a plot", "🏡", 2500, lambda s, x: x.get("plots", 0) >= 1),
    ("rich_1k", "Pocket Money", "Have $1K", "💵", 0, lambda s, x: x.get("money", 0) >= 100000),
    ("rich_10k", "Wealthy", "Have $10K", "💰", 0, lambda s, x: x.get("money", 0) >= 1000000),
    ("rich_100k", "Tycoon", "Have $100K", "👑", 0, lambda s, x: x.get("money", 0) >= 10000000),
    ("rich_1m", "Millionaire", "Have $1M", "🤑", 0, lambda s, x: x.get("money", 0) >= 100000000),
    ("play_500h", "Living Legend", "Play for 500 hours", "🌠", 100000, lambda s, x: s["playtime"] >= 1800000),
    ("diamonds_100", "Diamond Hoarder", "Mine 100 diamond ores", "💎", 15000, lambda s, x: s.get("diamonds", 0) >= 100),
    ("deaths_100", "Never Give Up", "Die 100 times", "🪦", 1000, lambda s, x: s["deaths"] >= 100),
    ("streak_100", "Unstoppable", "Claim your daily reward 100 days in a row", "☄️", 75000, lambda s, x: s["best_streak"] >= 100),
    ("dailies_50", "Loyal Player", "Claim 50 daily rewards", "🎁", 10000, lambda s, x: s.get("dailies", 0) >= 50),
    ("quests_500", "Legendary Quester", "Complete 500 quests", "🗺️", 75000, lambda s, x: s["quests"] >= 500),
    ("seller_10k", "Trader", "Sell $10K of items to the Shop", "⚖️", 5000, lambda s, x: s["sold"] >= 1000000),
    ("crate_1", "Lucky Dip", "Open a crate", "🎰", 500, lambda s, x: s.get("crates", 0) >= 1),
    ("crate_50", "Crate Collector", "Open 50 crates", "🎁", 10000, lambda s, x: s.get("crates", 0) >= 50),
    ("shopkeeper", "Shopkeeper", "Earn $1K from your shop chests", "🏪", 2500, lambda s, x: s.get("shop_earned", 0) >= 100000),
    ("shop_tycoon", "Store Tycoon", "Earn $50K from your shop chests", "🏬", 15000, lambda s, x: s.get("shop_earned", 0) >= 5000000),
    ("customer", "Window Shopper", "Buy from another player's shop chest", "🛍️", 500, lambda s, x: s.get("shop_buys", 0) >= 1),
    ("auctioneer", "Auctioneer", "Sell 10 items on the Auction House", "🔨", 5000, lambda s, x: s.get("ah_sold", 0) >= 10),
    ("parkour_1", "Free Runner", "Finish a parkour course", "🏃", 2500, lambda s, x: s.get("parkour_courses", 0) >= 1),
    ("parkour_5", "Parkour Pro", "Finish 5 different parkour courses", "🤸", 10000, lambda s, x: s.get("parkour_courses", 0) >= 5),
    ("collect_100", "Collector", "Collect 100 different items", "🗃️", 5000, lambda s, x: s.get("collection", 0) >= 100),
    ("collect_250", "Curator", "Collect 250 different items", "🏛️", 15000, lambda s, x: s.get("collection", 0) >= 250),
    ("collect_500", "Living Museum", "Collect 500 different items", "💎", 40000, lambda s, x: s.get("collection", 0) >= 500),
    ("parkour_record", "Record Breaker", "Set the record time on a parkour course", "⚡", 5000, lambda s, x: s.get("parkour_records", 0) >= 1),
    ("generous", "Generous", "Pay other players $1K in total", "🤝", 1000, lambda s, x: s.get("paid", 0) >= 100000),
    ("job_10", "Skilled Worker", "Reach job level 10", "🛠️", 5000, lambda s, x: s.get("job_level", 0) >= 10),
    ("job_21", "Master of the Trade", "Reach the top job level (21)", "🎖️", 25000, lambda s, x: s.get("job_level", 0) >= 21),
    ("traveler", "Traveler", "Teleport to friends 25 times", "🌀", 2500, lambda s, x: s.get("tpas", 0) >= 25),
    ("engineer", "Engineer", "Build an elevator", "🛗", 5000, lambda s, x: s.get("elevators", 0) >= 1),
    ("landlord", "Landlord", "Own 3 plots at once", "🏘️", 10000, lambda s, x: x.get("plots", 0) >= 3),
    ("bw_first_game", "Bedwars Rookie", "Play a game of Bedwars", "🛏️", 500, lambda s, x: s.get("bw_games", 0) >= 1),
    ("bw_first_win", "First Victory", "Win a game of Bedwars", "🏆", 2500, lambda s, x: s.get("bw_wins", 0) >= 1),
    ("bw_wins_10", "Bedwars Veteran", "Win 10 games of Bedwars", "🥇", 15000, lambda s, x: s.get("bw_wins", 0) >= 10),
    ("bw_beds_10", "Bed Breaker", "Destroy 10 beds in Bedwars", "🪓", 7500, lambda s, x: s.get("bw_beds", 0) >= 10),
    ("bw_finals_25", "Finisher", "Get 25 final kills in Bedwars", "⚔️", 10000, lambda s, x: s.get("bw_finals", 0) >= 25),
]
ACH_BY_ID = {a[0]: a for a in ACHIEVEMENTS}

NEW_STATS = {"playtime": 0, "mined": 0, "placed": 0, "kills": 0, "deaths": 0, "sold": 0, "diamonds": 0, "quests": 0,
             "streak": 0, "best_streak": 0, "last_daily": None, "keys": 0, "achievements": {}, "daily": None,
             "freezes": 0, "streak_log": {},  # streak_log: recent days -> "played" or "frozen" (for the website)
             "crate_keys": {"common": 0, "rare": 0, "galaxy": 0}}
KEY_NAMES = {"common": "Common", "rare": "Rare", "galaxy": "Galaxy"}


def dollars(cents):
    from endstone_galaxylink.money import fmt
    return fmt(cents)


def bar(n, total, width=10):
    filled = min(width, int(width * n / total)) if total else width
    return "§a" + "|" * filled + "§8" + "|" * (width - filled)


MAX_FREEZES = 10            # most Streak Freezes anyone can hold
EARNED_FREEZE_CAP = 2       # free ones (every 7 days of streak) only while holding fewer than this
STREAK_MILESTONES = {7, 30, 50, 100, 200, 365}


class Progress:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.execute("CREATE TABLE IF NOT EXISTS player_stats (xuid TEXT PRIMARY KEY, name TEXT, data TEXT)")
        self.db.commit()
        self.cache = {}      # xuid -> stats dict (online players)
        self.dirty = set()   # changed since last save
        self.unsent = set()  # changed since last sent to the website

    # ---------- storage ----------
    def today(self):
        return datetime.datetime.now(TZ).date()

    def stats(self, player):
        x = str(player.xuid)
        s = self.cache.get(x)
        if s is None:
            s = self.load(x) or {**json.loads(json.dumps(NEW_STATS))}
            for k, v in NEW_STATS.items():
                s.setdefault(k, json.loads(json.dumps(v)))
            if s.get("keys"):  # keys from before there were 3 crates count as Rare keys (the day-7 reward)
                s["crate_keys"]["rare"] = s["crate_keys"].get("rare", 0) + s["keys"]
                s["keys"] = 0
            s["name"] = player.name
            self.cache[x] = s
        return s

    def load(self, xuid):
        row = self.db.execute("SELECT data FROM player_stats WHERE xuid = ?", (str(xuid),)).fetchone()
        return json.loads(row[0]) if row else None

    def touch(self, player):
        self.dirty.add(str(player.xuid))
        self.unsent.add(str(player.xuid))

    def save(self):
        for x in list(self.dirty):
            s = self.cache.get(x)
            if s is not None:
                self.db.execute("INSERT OR REPLACE INTO player_stats (xuid, name, data) VALUES (?,?,?)", (x, s.get("name"), json.dumps(s)))
        if self.dirty:
            self.db.commit()
        self.dirty.clear()

    def on_join(self, player):
        new = self.load(player.xuid) is None
        s = self.stats(player)
        self.touch(player)
        self.check_achievements(player)
        if not new and s.get("last_daily") != str(self.today()):
            player.send_message("§6Your daily reward is ready! §eType /daily§6 to claim it.")
        elif new:
            player.send_message("§6Welcome! §7Type §e/daily§7 every day for a reward and §e/quests§7 for today's quests.")
        self.quests_for(player)

    def on_quit(self, player):
        self.save()
        self.cache.pop(str(player.xuid), None)

    # ---------- counting ----------
    def add(self, player, key, n=1):
        s = self.stats(player)
        s[key] = s.get(key, 0) + n
        self.touch(player)

    def bump(self, xuid, key, n=1, most=False, name=None):
        """Counts something for any player, online or not (most=True keeps the highest value instead)."""
        x = str(xuid)
        s = self.cache.get(x)
        online = s is not None
        if not online:
            s = self.load(x)
            if s is None:
                return
        s[key] = max(s.get(key, 0), n) if most else s.get(key, 0) + n
        if online:
            self.dirty.add(x)
            self.unsent.add(x)
        else:
            self.db.execute("INSERT OR REPLACE INTO player_stats (xuid, name, data) VALUES (?,?,?)", (x, s.get("name") or name, json.dumps(s)))
            self.db.commit()

    EDITABLE = ("playtime", "mined", "placed", "kills", "deaths", "quests", "streak", "best_streak",
                "bw_games", "bw_wins", "bw_kills", "bw_finals", "bw_beds")

    def set_stats(self, xuid, name, values):
        """The owner set some leaderboard stats on the website; play keeps counting up from them."""
        x = str(xuid)
        s = self.cache.get(x)
        online = s is not None
        if not online:
            s = self.load(x) or json.loads(json.dumps(NEW_STATS))
            for k, v in NEW_STATS.items():
                s.setdefault(k, json.loads(json.dumps(v)))
            s.setdefault("name", name)
        for k, v in (values or {}).items():
            if k in self.EDITABLE:
                s[k] = max(0, int(v))
        if online:
            self.dirty.add(x)
            self.unsent.add(x)
            self.save()
            p = next((q for q in self.plugin.server.online_players if str(q.xuid) == x), None)
            if p is not None:
                self.check_achievements(p)
        else:
            self.db.execute("INSERT OR REPLACE INTO player_stats (xuid, name, data) VALUES (?,?,?)", (x, s.get("name") or name, json.dumps(s)))
            self.db.commit()
        voice = getattr(self.plugin, "_voice", None)  # tell the website the new numbers right away
        if voice is not None and getattr(voice, "ws", None):
            voice.send_json({"type": "stats", "players": [self.row(x, {**NEW_STATS, **s})],
                             "online": [str(p.xuid) for p in self.plugin.server.online_players]})
        self.unsent.discard(x)

    def on_break(self, player, block_type, states):
        self.add(player, "mined")
        if ore("diamond")(block_type):
            self.add(player, "diamonds")
            self.check_achievements(player)
        self.progress(player, "mine", block_type, 1)
        if short(block_type) in CROPS and int((states or {}).get("growth", 0)) >= 7:
            self.progress(player, "harvest", None, 1)

    def on_place(self, player):
        self.add(player, "placed")
        self.progress(player, "place", None, 1)

    def on_kill(self, player, mob_type):
        self.add(player, "kills")
        self.progress(player, "kill", mob_type, 1)

    def on_death(self, player):
        self.add(player, "deaths")
        self.check_achievements(player)

    def on_sold(self, player, cents):
        self.add(player, "sold", int(cents))
        self.progress(player, "sell", None, int(cents) / 100)
        self.check_achievements(player)

    def tick(self):
        """Every minute: playtime, 'play' quests, achievements, saving, and sending stats to the website."""
        afk = getattr(self.plugin, "afk", None)
        for p in self.plugin.server.online_players:
            if afk is not None and afk.is_afk(p):
                continue  # AFK time doesn't count as playtime
            self.add(p, "playtime", 60)
            self.progress(p, "play", None, 1)
            self.check_achievements(p)
        self.save()
        self.push()

    # ---------- daily reward ----------
    def missed_days(self, s):
        """How many days were missed since the last claim (0 if claimed yesterday or today)."""
        if not s.get("last_daily"):
            return None
        last = datetime.date.fromisoformat(s["last_daily"])
        return max(0, (self.today() - last).days - 1)

    def daily_state(self, player):
        """(can claim now?, the day number they'd get, current streak)"""
        s = self.stats(player)
        today = self.today()
        last = datetime.date.fromisoformat(s["last_daily"]) if s.get("last_daily") else None
        if last == today:
            return False, (s["streak"] - 1) % 7 + 1, s["streak"]
        missed = self.missed_days(s)
        # missed days are covered by Streak Freezes (one each), so the streak goes on
        streak = s["streak"] if missed is not None and missed <= s.get("freezes", 0) else 0
        return True, streak % 7 + 1, streak

    def add_freezes(self, xuid, name, n):
        """Streak Freezes from the Store, Pro+ or staff (any player, online or not). Holds up to 10."""
        x = str(xuid)
        s = self.cache.get(x) or self.load(x) or json.loads(json.dumps(NEW_STATS))
        for k, v in NEW_STATS.items():
            s.setdefault(k, json.loads(json.dumps(v)))
        s.setdefault("name", name)
        s["freezes"] = max(0, min(MAX_FREEZES, s.get("freezes", 0) + int(n)))
        if x in self.cache:
            self.dirty.add(x)
            self.unsent.add(x)
        else:
            self.db.execute("INSERT OR REPLACE INTO player_stats (xuid, name, data) VALUES (?,?,?)", (x, s.get("name") or name, json.dumps(s)))
            self.db.commit()
            self.unsent.add(x)
        return s["freezes"]

    def daily_amount(self, player, day):
        plans = getattr(self.plugin, "plans", None)
        key = plans.plan_key(player) if plans else "free"
        return int(DAILY_CENTS[day - 1] * PLAN_BONUS.get(key, 1.0))

    def daily_text(self, player, day):
        from endstone_galaxylink.packs import name as pack_name
        parts = [dollars(self.daily_amount(player, day))]
        parts += [pack_name(k, n) for k, n in DAILY_PACKS.get(day, {}).items()]
        parts += [f"{n} {k.capitalize()} key{'s' if n != 1 else ''}" for k, n in DAILY_KEYS.get(day, {}).items()]
        return " + ".join(parts)

    def claim_daily(self, player):
        can, day, streak = self.daily_state(player)
        if not can:
            return player.send_message("§7You already claimed today's reward. Come back tomorrow!")
        s = self.stats(player)
        cents = self.daily_amount(player, day)
        missed = self.missed_days(s) or 0
        used = missed if streak and missed else 0
        log = s.setdefault("streak_log", {})
        if used:  # Streak Freezes kept the streak going
            s["freezes"] = max(0, s.get("freezes", 0) - used)
            for i in range(1, used + 1):
                log[str(self.today() - datetime.timedelta(days=i))] = "frozen"
        log[str(self.today())] = "played"
        for d in sorted(log)[:-21]:  # keep three weeks
            log.pop(d, None)
        s["streak"] = streak + 1
        s["best_streak"] = max(s["best_streak"], s["streak"])
        s["last_daily"] = str(self.today())
        s["dailies"] = s.get("dailies", 0) + 1
        self.eco.credit(player, cents)
        extra = ""
        for kind, n in DAILY_KEYS.get(day, {}).items():
            s["crate_keys"][kind] = s["crate_keys"].get(kind, 0) + n
            extra += f" §d+ {n} {kind.capitalize()} crate key{'s' if n != 1 else ''}"
        if DAILY_PACKS.get(day):
            from endstone_galaxylink.packs import name as pack_name
            extra += "§6 + " + ", ".join(pack_name(k, n) for k, n in DAILY_PACKS[day].items())
            self.plugin.packs.give(player.xuid, DAILY_PACKS[day])
        self.touch(player)
        player.send_message(f"§6§lDaily reward: §r§aDay {day}: {dollars(cents)}{extra} §7(streak: {s['streak']} day{'s' if s['streak'] != 1 else ''})")
        if used:
            player.send_message(f"§b❄ {used} Streak Freeze{'s' if used != 1 else ''} saved your streak. §7You have {s['freezes']} left.")
        if s["streak"] % 7 == 0 and s.get("freezes", 0) < EARNED_FREEZE_CAP:
            s["freezes"] = s.get("freezes", 0) + 1
            player.send_message("§b❄ You earned a Streak Freeze! §7If you miss a day, it saves your streak by itself.")
        if s["streak"] in STREAK_MILESTONES:
            player.send_message(f"§6§l🔥 {s['streak']}-day streak!§r §7Amazing. Keep it going!")
        try:
            show_title(self.plugin, player, "§6Daily reward", f"§aDay {day}: {dollars(cents)}", 5, 50, 15)
        except Exception:
            pass
        from endstone_galaxylink import fx
        fx.reward(self.plugin, player)
        self.check_achievements(player)

    def daily_menu(self, player):
        can, day, streak = self.daily_state(player)
        lines = []
        for d in range(1, 8):
            amount = self.daily_text(player, d)
            if d < day or (d == day and not can):
                lines.append(f"§a✔ Day {d}: {amount}")
            elif d == day:
                lines.append(f"§e➜ Day {d}: {amount}  §l(today)")
            else:
                lines.append(f"§7   Day {d}: {amount}")
        now = datetime.datetime.now(TZ)
        midnight = datetime.datetime.combine(now.date() + datetime.timedelta(days=1), datetime.time(), tzinfo=TZ)
        left = int((midnight - now).total_seconds())
        fz = self.stats(player).get("freezes", 0)
        info = (f"Streak: §l{streak} day{'s' if streak != 1 else ''}§r · Streak Freezes: §b{fz}§r\n"
                "§7A freeze saves your streak by itself if you miss a day. You earn one every 7 days (more in the Store).§r"
                f"\n\n" + "\n".join(lines) + f"\n\n§7Next reward in {left // 3600}h {left % 3600 // 60}m.")
        form = ActionForm(title="§l§6Daily Reward", content=info)
        if can:
            form.add_button(f"§a§lClaim Day {day}§r\n§8{self.daily_text(player, day)}", icon="textures/ui/gift_square",
                            on_click=lambda p: (self.claim_daily(p), None)[1])
        form.add_button("§lQuests", icon="textures/ui/book_edit_default", on_click=self.quests_menu)
        form.add_button("Close")
        player.send_form(form)

    # ---------- quests ----------
    def quests_for(self, player):
        """Today's 3 quests for this player (picked once per day)."""
        s = self.stats(player)
        today = str(self.today())
        if not s.get("daily") or s["daily"].get("date") != today:
            rng = random.Random(f"{player.xuid}-{today}")
            s["daily"] = {"date": today, "quests": [{"id": rng.choice(QUESTS[t])[0], "n": 0, "done": False} for t in ("easy", "medium", "hard")]}
            self.touch(player)
        return s["daily"]["quests"]

    def progress(self, player, kind, what, n):
        for q in self.quests_for(player):
            if q["done"] or q["id"] not in QUEST_BY_ID:
                continue
            tier, (qid, label, qkind, test, goal) = QUEST_BY_ID[q["id"]]
            if qkind != kind or (test and not test(what)):
                continue
            q["n"] = min(goal, q["n"] + n)
            self.touch(player)
            if q["n"] >= goal:
                q["done"] = True
                cents = QUEST_REWARD[tier]
                self.eco.credit(player, cents)
                s = self.stats(player)
                s["quests"] += 1
                bonus = ""
                if QUEST_PACKS.get(tier):
                    from endstone_galaxylink.packs import name as pack_name
                    bonus = " §6+ " + ", ".join(pack_name(k, n) for k, n in QUEST_PACKS[tier].items())
                    self.plugin.packs.give(player.xuid, QUEST_PACKS[tier])
                player.send_message(f"§a§lQuest complete! §r§f{label} §a+{dollars(cents)}{bonus}")
                try:
                    player.send_toast("§aQuest complete!", f"{label}: +{dollars(cents)}")
                    player.play_sound(player.location, "random.levelup", 0.6, 1.5)
                except Exception:
                    pass
                if all(x["done"] for x in self.quests_for(player)):
                    s["crate_keys"]["common"] = s["crate_keys"].get("common", 0) + 1
                    player.send_message("§6You finished all of today's quests! §d+1 Common crate key. §7New quests tomorrow.")
                self.check_achievements(player)

    def quests_menu(self, player):
        lines = []
        for q, tier in zip(self.quests_for(player), ("easy", "medium", "hard")):
            if q["id"] not in QUEST_BY_ID:
                continue
            _, (qid, label, kind, test, goal) = QUEST_BY_ID[q["id"]]
            color = {"easy": "§a", "medium": "§e", "hard": "§c"}[tier]
            n = int(q["n"])
            prog = "§a§lDONE" if q["done"] else f"{bar(n, goal)} §f{n:,}/{goal:,}"
            lines.append(f"{color}§l{tier.upper()}§r  {label}\n   {prog}  §7reward {dollars(QUEST_REWARD[tier])}")
        now = datetime.datetime.now(TZ)
        midnight = datetime.datetime.combine(now.date() + datetime.timedelta(days=1), datetime.time(), tzinfo=TZ)
        left = int((midnight - now).total_seconds())
        form = ActionForm(title="§l§bDaily Quests", content="\n\n".join(lines) + f"\n\n§7New quests in {left // 3600}h {left % 3600 // 60}m.")
        form.add_button("§lDaily reward", icon="textures/ui/gift_square", on_click=self.daily_menu)
        form.add_button("§lAchievements", icon="textures/ui/achievements", on_click=self.achievements_menu)
        form.add_button("Close")
        player.send_form(form)

    # ---------- achievements ----------
    def extra(self, player):
        plots = getattr(self.plugin, "plots", None)
        return {"money": self.eco.get(player.xuid), "plots": len(plots.owned(player.xuid)) if plots else 0}

    def check_achievements(self, player):
        s = self.stats(player)
        x = None
        for aid, name, desc, emoji, cents, test in ACHIEVEMENTS:
            if aid in s["achievements"]:
                continue
            x = x if x is not None else self.extra(player)
            try:
                ok = test(s, x)
            except Exception:
                ok = False
            if not ok:
                continue
            s["achievements"][aid] = int(time.time())
            self.touch(player)
            cents = achievement_cents(cents)
            if cents:
                self.eco.credit(player, cents)
            reward = f" §a+{dollars(cents)}" if cents else ""
            player.send_message(f"§d§lAchievement unlocked: §r§f{name}§7 ({desc}){reward}")
            try:
                player.send_toast("§dAchievement unlocked!", name)
            except Exception:
                pass
            from endstone_galaxylink import fx
            fx.achievement(self.plugin, player)
            if aid != "welcome":
                for p in self.plugin.server.online_players:
                    if p is not player:
                        p.send_message(f"§d{player.name}§7 earned the achievement §d{name}§7!")

    def achievements_menu(self, player):
        s = self.stats(player)
        got = s["achievements"]
        lines = []
        for aid, name, desc, emoji, cents, test in ACHIEVEMENTS:
            mark = "§a✔" if aid in got else "§8✖"
            lines.append(f"{mark} §{'f' if aid in got else '7'}§l{name}§r§7: {desc}{f' ({dollars(achievement_cents(cents))})' if cents else ''}")
        form = ActionForm(title="§l§dAchievements", content=f"{len(got)}/{len(ACHIEVEMENTS)} unlocked. Your achievements show on your galaxymc.us profile.\n\n" + "\n".join(lines))
        form.add_button("§lMy stats", icon="textures/ui/icon_book_writable", on_click=lambda p: self.stats_menu(p, p))
        form.add_button("Close")
        player.send_form(form)

    # ---------- /stats ----------
    def stats_menu(self, viewer, target):
        s = self.stats(target)
        h = s["playtime"] // 3600
        m = s["playtime"] % 3600 // 60
        text = (f"§lPlaytime:§r {h}h {m}m\n§lMoney:§r {dollars(self.eco.get(target.xuid))}\n§lBlocks mined:§r {s['mined']:,}\n"
                f"§lBlocks placed:§r {s['placed']:,}\n§lMobs defeated:§r {s['kills']:,}\n§lDeaths:§r {s['deaths']:,}\n"
                f"§lQuests completed:§r {s['quests']:,}\n§lDaily streak:§r {s['streak']} (best {s['best_streak']})\n"
                f"§lAchievements:§r {len(s['achievements'])}/{len(ACHIEVEMENTS)}\n"
                f"§lCrate keys:§r {', '.join(f'{n} {KEY_NAMES[k]}' for k, n in s['crate_keys'].items() if n) or 'none'}\n\n"
                f"§7Full profile: galaxymc.us/player/{target.name.replace(' ', '%20')}")
        form = ActionForm(title=f"§l{target.name}", content=text)
        form.add_button("Close")
        viewer.send_form(form)

    def stats_command(self, sender, args):
        name = " ".join(args).strip().lower()
        target = sender
        if name:
            target = next((p for p in self.plugin.server.online_players if p.name.lower() == name), None) or \
                     next((p for p in self.plugin.server.online_players if p.name.lower().startswith(name)), None)
            if target is None:
                return sender.send_message(f"§7{name} isn't online. See everyone's stats on galaxymc.us/leaderboard.")
        self.stats_menu(sender, target)

    # ---------- crate keys ----------
    def keys(self, player):
        return self.stats(player)["crate_keys"]

    def add_keys(self, xuid, name, kind, n):
        """Gives crate keys to any player, online or not. Returns their new count."""
        x = str(xuid)
        if x in self.cache:
            s = self.cache[x]
        else:
            s = self.load(x) or json.loads(json.dumps(NEW_STATS))
            for k, v in NEW_STATS.items():
                s.setdefault(k, json.loads(json.dumps(v)))
            s.setdefault("name", name)
        s["crate_keys"][kind] = max(0, s["crate_keys"].get(kind, 0) + n)
        if x in self.cache:
            self.dirty.add(x)
        else:
            self.db.execute("INSERT OR REPLACE INTO player_stats (xuid, name, data) VALUES (?,?,?)", (x, s.get("name") or name, json.dumps(s)))
            self.db.commit()
        return s["crate_keys"][kind]

    # ---------- website ----------
    def row(self, xuid, s):
        return {"xuid": xuid, "name": s.get("name"), "playtime": s["playtime"], "mined": s["mined"], "placed": s["placed"],
                "kills": s["kills"], "deaths": s["deaths"], "quests": s["quests"], "streak": s["streak"], "best": s["best_streak"],
                "achievements": sorted(s["achievements"].keys()), "lastDaily": s.get("last_daily"),
                "freezes": int(s.get("freezes", 0)), "streakLog": dict(sorted((s.get("streak_log") or {}).items())[-21:]),
                "bedwars": {k: int(s.get(f"bw_{k}", 0)) for k in ("games", "wins", "kills", "finals", "beds")}}

    def push(self, everything=False):
        voice = getattr(self.plugin, "_voice", None)
        if not voice or not voice.ws:
            return
        if everything:
            rows = [self.row(x, {**NEW_STATS, **json.loads(d)}) for x, d in self.db.execute("SELECT xuid, data FROM player_stats").fetchall()]
        else:
            rows = [self.row(x, self.cache[x]) for x in self.unsent if x in self.cache]
        online = [str(p.xuid) for p in self.plugin.server.online_players]
        for i in range(0, max(1, len(rows)), 200):
            voice.send_json({"type": "stats", "players": rows[i:i + 200], "online": online})
        self.unsent.clear()

    def definitions(self):
        return {"type": "achievement_defs", "list": [{"id": a[0], "name": a[1], "desc": a[2], "emoji": a[3]} for a in ACHIEVEMENTS]}

    def leaderboards(self, keys, limit=10):
        """Top players for several stats with ONE pass over everyone's saved stats (floating leaderboards, every minute)."""
        import heapq
        keys = set(keys)
        out = {}
        if "money" in keys:
            out["money"] = self.leaderboard("money", limit)
        stat_keys = keys - {"money"}
        if not stat_keys:
            return out
        self.save()
        rows = {k: [] for k in stat_keys}
        for x, name, d in self.db.execute("SELECT xuid, name, data FROM player_stats").fetchall():
            try:
                s = json.loads(d)
            except Exception:
                continue
            for k in stat_keys:
                v = len(s.get("achievements", {})) if k == "achievements" else s.get(k, 0)
                if v:
                    rows[k].append((name, v))
        for k, r in rows.items():
            out[k] = heapq.nlargest(limit, r, key=lambda t: t[1])
        return out

    def leaderboard(self, key, limit=10):
        """Top players for a stat (used by the floating leaderboards). Online players' latest numbers are included."""
        self.save()
        if key == "money":  # operators are included too
            return self.db.execute("SELECT name, cents FROM balances WHERE name IS NOT NULL ORDER BY cents DESC LIMIT ?", (limit,)).fetchall()
        out = []
        for x, name, d in self.db.execute("SELECT xuid, name, data FROM player_stats").fetchall():
            s = json.loads(d)
            v = len(s.get("achievements", {})) if key == "achievements" else s.get(key, 0)
            out.append((name, v))
        out.sort(key=lambda r: -r[1])
        return [r for r in out if r[1]][:limit]
