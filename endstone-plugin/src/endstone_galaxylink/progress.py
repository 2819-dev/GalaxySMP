"""Player progress: stats, daily rewards, daily quests and achievements.

Stats      playtime, blocks mined and placed, mobs killed, deaths, money earned by selling.
/daily     log in every day for a reward: day 1 $100, day 2 $200 ... day 7 $700 + a Rare crate key,
           then it starts over at day 1. Missing a day restarts the streak.
           Galaxy+ gets 25% more, Galaxy Pro+ 50% more. Days start at midnight (US Eastern).
/quests    3 new quests every day: one easy, one medium, one hard. Finishing all 3 gives a Common crate key.
/achievements  milestones with badges (shown on galaxymc.us profiles) and small money rewards.
/stats [player]  someone's stats.

Rewards are kept small on purpose so the economy stays realistic.
Stats are sent to galaxymc.us for the leaderboards and player profiles.
"""

import datetime
import json
import random
import time

from endstone.form import ActionForm

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("America/New_York")
except Exception:  # no time zone data on this machine: use UTC
    TZ = datetime.timezone.utc

DAILY_CENTS = [10000, 20000, 30000, 40000, 50000, 60000, 70000]  # $100 ... $700
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
#   harvest: fully grown crops; sell: dollars earned selling; play: minutes played.
QUESTS = {
    "easy": [
        ("mine_stone_64", "Mine 64 stone", "mine", lambda b: short(b) in STONE, 64),
        ("chop_32", "Chop 32 logs", "mine", lambda b: short(b).endswith(("_log", "_stem")), 32),
        ("dig_64", "Dig 64 dirt, sand or gravel", "mine", lambda b: short(b) in DIRT, 64),
        ("place_64", "Place 64 blocks", "place", None, 64),
        ("kill_5", "Defeat 5 hostile mobs", "kill", lambda m: short(m) in HOSTILE, 5),
        ("harvest_32", "Harvest 32 fully grown crops", "harvest", None, 32),
        ("play_20", "Play for 20 minutes", "play", None, 20),
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
    ],
}
QUEST_REWARD = {"easy": 2500, "medium": 7500, "hard": 20000}  # $25, $75, $200
QUEST_BY_ID = {q[0]: (tier, q) for tier, qs in QUESTS.items() for q in qs}

# (id, name, description, emoji for the website, reward cents, test(stats, extra))
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
    ("first_death", "Oops", "Die for the first time", "💀", 0, lambda s, x: s["deaths"] >= 1),
    ("streak_7", "Week Streak", "Claim your daily reward 7 days in a row", "🔥", 5000, lambda s, x: s["best_streak"] >= 7),
    ("streak_30", "Dedicated", "Claim your daily reward 30 days in a row", "📅", 25000, lambda s, x: s["best_streak"] >= 30),
    ("quests_10", "Quester", "Complete 10 quests", "📜", 5000, lambda s, x: s["quests"] >= 10),
    ("quests_100", "Quest Master", "Complete 100 quests", "🏆", 25000, lambda s, x: s["quests"] >= 100),
    ("seller", "Merchant", "Sell $100 of items to the Shop", "🪙", 1000, lambda s, x: s["sold"] >= 10000),
    ("landowner", "Landowner", "Claim a plot", "🏡", 2500, lambda s, x: x.get("plots", 0) >= 1),
    ("rich_1k", "Pocket Money", "Have $1,000", "💵", 0, lambda s, x: x.get("money", 0) >= 100000),
    ("rich_10k", "Wealthy", "Have $10,000", "💰", 0, lambda s, x: x.get("money", 0) >= 1000000),
    ("rich_100k", "Tycoon", "Have $100,000", "👑", 0, lambda s, x: x.get("money", 0) >= 10000000),
    ("rich_1m", "Millionaire", "Have $1,000,000", "🤑", 0, lambda s, x: x.get("money", 0) >= 100000000),
    ("play_500h", "Living Legend", "Play for 500 hours", "🌠", 100000, lambda s, x: s["playtime"] >= 1800000),
    ("diamonds_100", "Diamond Hoarder", "Mine 100 diamond ores", "💎", 15000, lambda s, x: s.get("diamonds", 0) >= 100),
    ("deaths_100", "Never Give Up", "Die 100 times", "🪦", 1000, lambda s, x: s["deaths"] >= 100),
    ("streak_100", "Unstoppable", "Claim your daily reward 100 days in a row", "☄️", 75000, lambda s, x: s["best_streak"] >= 100),
    ("dailies_50", "Loyal Player", "Claim 50 daily rewards", "🎁", 10000, lambda s, x: s.get("dailies", 0) >= 50),
    ("quests_500", "Legendary Quester", "Complete 500 quests", "🗺️", 75000, lambda s, x: s["quests"] >= 500),
    ("seller_10k", "Trader", "Sell $10,000 of items to the Shop", "⚖️", 5000, lambda s, x: s["sold"] >= 1000000),
    ("crate_1", "Lucky Dip", "Open a crate", "🎰", 500, lambda s, x: s.get("crates", 0) >= 1),
    ("crate_50", "Crate Collector", "Open 50 crates", "🎁", 10000, lambda s, x: s.get("crates", 0) >= 50),
    ("shopkeeper", "Shopkeeper", "Earn $1,000 from your shop chests", "🏪", 2500, lambda s, x: s.get("shop_earned", 0) >= 100000),
    ("shop_tycoon", "Store Tycoon", "Earn $50,000 from your shop chests", "🏬", 15000, lambda s, x: s.get("shop_earned", 0) >= 5000000),
    ("customer", "Window Shopper", "Buy from another player's shop chest", "🛍️", 500, lambda s, x: s.get("shop_buys", 0) >= 1),
    ("auctioneer", "Auctioneer", "Sell 10 items on the Auction House", "🔨", 5000, lambda s, x: s.get("ah_sold", 0) >= 10),
    ("generous", "Generous", "Pay other players $1,000 in total", "🤝", 1000, lambda s, x: s.get("paid", 0) >= 100000),
    ("job_10", "Skilled Worker", "Reach job level 10", "🛠️", 5000, lambda s, x: s.get("job_level", 0) >= 10),
    ("job_21", "Master of the Trade", "Reach the top job level (21)", "🎖️", 25000, lambda s, x: s.get("job_level", 0) >= 21),
    ("traveler", "Traveler", "Teleport to friends 25 times", "🌀", 2500, lambda s, x: s.get("tpas", 0) >= 25),
    ("engineer", "Engineer", "Build an elevator", "🛗", 5000, lambda s, x: s.get("elevators", 0) >= 1),
    ("landlord", "Landlord", "Own 3 plots at once", "🏘️", 10000, lambda s, x: x.get("plots", 0) >= 3),
]
ACH_BY_ID = {a[0]: a for a in ACHIEVEMENTS}

NEW_STATS = {"playtime": 0, "mined": 0, "placed": 0, "kills": 0, "deaths": 0, "sold": 0, "diamonds": 0, "quests": 0,
             "streak": 0, "best_streak": 0, "last_daily": None, "keys": 0, "achievements": {}, "daily": None,
             "crate_keys": {"common": 0, "rare": 0, "galaxy": 0}}
KEY_NAMES = {"common": "Common", "rare": "Rare", "galaxy": "Galaxy"}


def dollars(cents):
    d = cents / 100
    return f"${d:,.0f}" if d == int(d) else f"${d:,.2f}"


def bar(n, total, width=10):
    filled = min(width, int(width * n / total)) if total else width
    return "§a" + "|" * filled + "§8" + "|" * (width - filled)


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
        for p in self.plugin.server.online_players:
            self.add(p, "playtime", 60)
            self.progress(p, "play", None, 1)
            self.check_achievements(p)
        self.save()
        self.push()

    # ---------- daily reward ----------
    def daily_state(self, player):
        """(can claim now?, the day number they'd get, current streak)"""
        s = self.stats(player)
        today = self.today()
        last = datetime.date.fromisoformat(s["last_daily"]) if s.get("last_daily") else None
        if last == today:
            return False, (s["streak"] - 1) % 7 + 1, s["streak"]
        streak = s["streak"] if last == today - datetime.timedelta(days=1) else 0
        return True, streak % 7 + 1, streak

    def daily_amount(self, player, day):
        plans = getattr(self.plugin, "plans", None)
        key = plans.plan_key(player) if plans else "free"
        return int(DAILY_CENTS[day - 1] * PLAN_BONUS.get(key, 1.0))

    def claim_daily(self, player):
        can, day, streak = self.daily_state(player)
        if not can:
            return player.send_message("§7You already claimed today's reward. Come back tomorrow!")
        s = self.stats(player)
        cents = self.daily_amount(player, day)
        s["streak"] = streak + 1
        s["best_streak"] = max(s["best_streak"], s["streak"])
        s["last_daily"] = str(self.today())
        s["dailies"] = s.get("dailies", 0) + 1
        self.eco.credit(player, cents)
        extra = ""
        if day == 7:
            s["crate_keys"]["rare"] = s["crate_keys"].get("rare", 0) + 1
            extra = " §d+ 1 Rare crate key!"
        self.touch(player)
        player.send_message(f"§6§lDaily reward: §r§aDay {day}: {dollars(cents)}{extra} §7(streak: {s['streak']} day{'s' if s['streak'] != 1 else ''})")
        try:
            player.send_title("§6Daily reward", f"§aDay {day}: {dollars(cents)}", 5, 50, 15)
            player.play_sound(player.location, "random.levelup", 0.8, 1.2)
        except Exception:
            pass
        self.check_achievements(player)

    def daily_menu(self, player):
        can, day, streak = self.daily_state(player)
        lines = []
        for d in range(1, 8):
            amount = dollars(self.daily_amount(player, d)) + (" + Rare crate key" if d == 7 else "")
            if d < day or (d == day and not can):
                lines.append(f"§a✔ Day {d}: {amount}")
            elif d == day:
                lines.append(f"§e➜ Day {d}: {amount}  §l(today)")
            else:
                lines.append(f"§7   Day {d}: {amount}")
        now = datetime.datetime.now(TZ)
        midnight = datetime.datetime.combine(now.date() + datetime.timedelta(days=1), datetime.time(), tzinfo=TZ)
        left = int((midnight - now).total_seconds())
        info = (f"Streak: §l{streak} day{'s' if streak != 1 else ''}§r. Log in every day to keep it going. Missing a day starts again at day 1."
                f"\n\n" + "\n".join(lines) + f"\n\n§7Next reward in {left // 3600}h {left % 3600 // 60}m.")
        form = ActionForm(title="§l§6Daily Reward", content=info)
        if can:
            form.add_button(f"§a§lClaim Day {day}§r\n§8{dollars(self.daily_amount(player, day))}", icon="textures/ui/gift_square",
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
                player.send_message(f"§a§lQuest complete! §r§f{label} §a+{dollars(cents)}")
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
            if cents:
                self.eco.credit(player, cents)
            reward = f" §a+{dollars(cents)}" if cents else ""
            player.send_message(f"§d§lAchievement unlocked: §r§f{name}§7 ({desc}){reward}")
            try:
                player.send_toast("§dAchievement unlocked!", name)
            except Exception:
                pass
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
            lines.append(f"{mark} §{'f' if aid in got else '7'}§l{name}§r§7: {desc}{f' ({dollars(cents)})' if cents else ''}")
        form = ActionForm(title="§l§dAchievements", content=f"{len(got)}/{len(ACHIEVEMENTS)} unlocked. Your badges show on your galaxymc.us profile.\n\n" + "\n".join(lines))
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
                "achievements": sorted(s["achievements"].keys())}

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
