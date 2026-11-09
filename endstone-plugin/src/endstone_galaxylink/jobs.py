"""Jobs: earn a little money for what you already do.

/jobs   pick one job. Your first job is free; switching costs $250 and starts the new job at level 1.
        Every paid action gives job XP. Each level pays 5% more, up to level 21 (2x pay).

Pay is small on purpose (realistic economy), and there's a daily limit of $300 from jobs.
Blocks that players placed don't pay when broken (no place-and-break farming), and Builders are only
paid once per spot per day.
Money is added every few seconds and shown above the hotbar.
"""

import datetime
import time

from endstone.form import ActionForm

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("America/New_York")
except Exception:
    TZ = datetime.timezone.utc

SWITCH_CENTS = 25000
DAILY_CAP = 30000
MAX_LEVEL = 21
PLACED_MEMORY = 200000

STONE = {"stone", "cobblestone", "deepslate", "cobbled_deepslate", "andesite", "diorite", "granite", "tuff", "netherrack",
         "blackstone", "basalt", "calcite", "end_stone", "sandstone", "red_sandstone", "dripstone_block"}
ORES = {"coal": (50, 3), "copper": (30, 2), "iron": (75, 4), "gold": (100, 5), "redstone": (50, 3), "lapis": (75, 4),
        "diamond": (300, 15), "emerald": (400, 20), "quartz": (30, 2)}
DIRT = {"dirt", "grass_block", "sand", "red_sand", "gravel", "coarse_dirt", "clay", "mud", "podzol", "mycelium", "soul_sand",
        "soul_soil", "rooted_dirt", "snow", "snow_layer"}
CROPS = {"wheat": 7, "carrots": 7, "potatoes": 7, "beetroot": 7, "nether_wart": 3}
EASY_FARM = {"melon_block": 3, "pumpkin": 3, "cocoa": 3, "sweet_berry_bush": 2}
HOSTILE_PAY = 50
PASSIVE_PAY = 10

JOBS = [
    ("miner", "Miner", "textures/items/diamond_pickaxe", "Stone $0.05, coal $0.50, iron $0.75, gold $1, diamond $3, emerald $4"),
    ("lumberjack", "Lumberjack", "textures/items/stone_axe", "Logs $0.08 each"),
    ("farmer", "Farmer", "textures/items/wheat", "Fully grown crops $0.04, melons and pumpkins $0.03"),
    ("hunter", "Hunter", "textures/items/iron_sword", "Hostile mobs $0.50, other mobs $0.10"),
    ("digger", "Digger", "textures/items/stone_shovel", "Dirt, sand, gravel and snow $0.03"),
    ("builder", "Builder", "textures/blocks/brick", "Placing blocks $0.02 (once per spot per day)"),
]
JOB_BY_KEY = {j[0]: j for j in JOBS}


def short(t):
    return str(t or "").replace("minecraft:", "")


def xp_for(level):
    """Total XP needed to reach a level (level 2 = 100, level 3 = 300, ... grows each level)."""
    return 50 * (level - 1) * level


def level_of(xp):
    level = 1
    while level < MAX_LEVEL and xp >= xp_for(level + 1):
        level += 1
    return level


def multiplier(level):
    return 1 + 0.05 * (level - 1)


def dollars(cents):
    return f"${cents / 100:,.2f}"


class Jobs:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.data = self.eco.get_config("jobs") or {}   # xuid -> {job, xp, earned_today, day}
        self.pending = {}     # xuid -> (cents not yet paid, player)
        self.placed = {}      # (dim, x, y, z) -> time a player placed a block there
        self.paid_spots = {}  # (dim, x, y, z) -> day a Builder was paid there

    def save(self):
        self.eco.set_config("jobs", self.data)

    def today(self):
        return str(datetime.datetime.now(TZ).date())

    def info(self, player):
        """The player's job record, or None if they have no job right now."""
        info = self.data.get(str(player.xuid))
        return info if info and info.get("job") else None

    # ---------- what pays ----------
    def break_pay(self, job, block_type, states):
        b = short(block_type)
        if job == "miner":
            if b in STONE:
                return 5, 1
            for name, (cents, xp) in ORES.items():
                if b.endswith(f"{name}_ore") or (name == "quartz" and b == "quartz_ore"):
                    return cents, xp
            if b == "ancient_debris":
                return 500, 25
        elif job == "lumberjack" and b.endswith(("_log", "_stem")) and not b.startswith("stripped"):
            return 8, 1
        elif job == "digger" and b in DIRT:
            return 3, 1
        elif job == "farmer":
            if b in CROPS and int((states or {}).get("growth", (states or {}).get("age", 0))) >= CROPS[b]:
                return 4, 1
            if b in EASY_FARM:
                return 3, 1
        return 0, 0

    # ---------- events ----------
    def on_break(self, player, block):
        key = (block.dimension.name, block.x, block.y, block.z)
        placed_by_player = self.placed.pop(key, None) is not None
        info = self.info(player)
        crop = short(block.type) in CROPS or short(block.type) in EASY_FARM
        if not info or (placed_by_player and not crop):  # planted crops still pay when fully grown
            return
        try:
            states = dict(block.data.block_states)
        except Exception:
            states = {}
        cents, xp = self.break_pay(info["job"], block.type, states)
        if cents:
            self.pay(player, info, cents, xp)

    def on_place(self, player, block):
        key = (block.dimension.name, block.x, block.y, block.z)
        if len(self.placed) > PLACED_MEMORY:
            for k in list(self.placed)[:PLACED_MEMORY // 4]:
                self.placed.pop(k, None)
        self.placed[key] = time.time()
        info = self.info(player)
        if info and info["job"] == "builder":
            day = self.today()
            if self.paid_spots.get(key) != day:
                if len(self.paid_spots) > PLACED_MEMORY:
                    self.paid_spots.clear()
                self.paid_spots[key] = day
                self.pay(player, info, 2, 1)

    def on_kill(self, player, mob_type, hostile):
        info = self.info(player)
        if info and info["job"] == "hunter":
            self.pay(player, info, HOSTILE_PAY if hostile else PASSIVE_PAY, 3 if hostile else 1)

    # ---------- paying ----------
    def pay(self, player, info, cents, xp):
        if not cents:
            return
        day = self.today()
        if info.get("day") != day:
            info["day"], info["earned_today"] = day, 0
        level = level_of(info["xp"])
        cents = int(round(cents * multiplier(level)))
        room = DAILY_CAP - info["earned_today"]
        if room <= 0:
            if not info.get("capped_told") == day:
                info["capped_told"] = day
                player.send_message(f"§eYou've earned the daily job limit ({dollars(DAILY_CAP)}). §7Jobs pay again tomorrow.")
            return
        cents = min(cents, room)
        info["earned_today"] += cents
        info["xp"] += xp
        new_level = level_of(info["xp"])
        if new_level > level:
            name = JOB_BY_KEY[info["job"]][1]
            player.send_message(f"§a§lLevel up! §r§f{name} level {new_level}§a: you now earn {multiplier(new_level):.2f}x.")
            try:
                player.send_toast("§aJob level up!", f"{name} level {new_level}")
                player.play_sound(player.location, "random.levelup", 0.7, 1.0)
            except Exception:
                pass
        x = str(player.xuid)
        owed, _ = self.pending.get(x, (0, None))
        self.pending[x] = (owed + cents, player)

    def tick(self):
        """Every 5 seconds: add what players earned and show it above the hotbar."""
        if not self.pending:
            return
        for x, (cents, player) in list(self.pending.items()):
            if cents <= 0:
                continue
            self.eco.add(x, player.name, cents)
            info = self.data.get(x)
            try:
                player.send_tip(f"§a+{dollars(cents)} §7({JOB_BY_KEY[info['job']][1]})" if info else f"§a+{dollars(cents)}")
            except Exception:
                pass
        self.pending.clear()
        self.save()

    # ---------- /jobs ----------
    def menu(self, player):
        info = self.info(player)
        if info:
            name = JOB_BY_KEY[info["job"]][1]
            level = level_of(info["xp"])
            if level < MAX_LEVEL:
                need = xp_for(level + 1) - xp_for(level)
                have = info["xp"] - xp_for(level)
                prog = f"XP: {have:,}/{need:,} to level {level + 1}"
            else:
                prog = "Max level!"
            earned = info["earned_today"] if info.get("day") == self.today() else 0
            head = (f"Your job: §l{name}§r, level {level} ({multiplier(level):.2f}x pay)\n{prog}\n"
                    f"Earned today: {dollars(earned)} of {dollars(DAILY_CAP)}\n\n§7Switching jobs costs {dollars(SWITCH_CENTS)} and starts at level 1.")
        else:
            head = ("Pick a job to earn money while you play. Your first job is free!" if str(player.xuid) not in self.data
                    else f"You don't have a job. Picking one costs {dollars(SWITCH_CENTS)}.")
        form = ActionForm(title="§l§2Jobs", content=head)
        for key, name, icon, pay in JOBS:
            mark = " §a(your job)" if info and info["job"] == key else ""
            form.add_button(f"§l{name}{mark}§r\n§8{pay[:44]}", icon=icon, on_click=lambda p, k=key: self.job_detail(p, k))
        if info:
            form.add_button("§cLeave my job", on_click=self.confirm_leave)
        form.add_button("Close")
        player.send_form(form)

    def job_detail(self, player, key):
        _, name, icon, pay = JOB_BY_KEY[key]
        info = self.info(player)
        form = ActionForm(title=f"§l{name}", content=f"{pay}\n\nEach level pays 5% more, up to 2x at level {MAX_LEVEL}.")
        if info and info["job"] == key:
            form.add_button("§7This is your job")
        elif str(player.xuid) in self.data:
            form.add_button(f"§lSwitch to {name}§r\n§8Costs {dollars(SWITCH_CENTS)}, starts at level 1", on_click=lambda p: self.join(p, key))
        else:
            form.add_button(f"§a§lBecome a {name}§r\n§8Free", on_click=lambda p: self.join(p, key))
        form.add_button("§l< Back", on_click=self.menu)
        player.send_form(form)

    def join(self, player, key):
        info = self.info(player)
        if info and info["job"] == key:
            return
        record = self.data.get(str(player.xuid))  # anyone who had a job before pays to pick a new one
        if record and not self.eco.charge(player, SWITCH_CENTS):
            return player.send_message(f"§cSwitching jobs costs {dollars(SWITCH_CENTS)}. You don't have enough money.")
        self.data[str(player.xuid)] = {"job": key, "xp": 0, "earned_today": record.get("earned_today", 0) if record else 0,
                                       "day": record.get("day") if record else self.today()}
        self.save()
        player.send_message(f"§aYou're now a §l{JOB_BY_KEY[key][1]}§r§a! §7{JOB_BY_KEY[key][3]}.")

    def confirm_leave(self, player):
        form = ActionForm(title="Leave your job?", content="You'll stop earning job money and lose your job level. "
                                                           "Picking a job again later costs " + dollars(SWITCH_CENTS) + ".")
        form.add_button("§c§lLeave my job", on_click=self.leave)
        form.add_button("Cancel", on_click=self.menu)
        player.send_form(form)

    def leave(self, player):
        info = self.data.get(str(player.xuid))
        if info and info.get("job"):
            info.update({"job": None, "xp": 0})
            self.save()
            player.send_message("§7You left your job.")
