"""Blub piles (2.95): now and then, wild Blubs lazing about close together in the Sift climb on top of each other
into a little pile: usually 2 or 3, now and then 4, and a tower of 5 is a rare sight. Each one faces its own way
and leans a little (the add-on turns them; the ones underneath look squished).

About one pile every 15 minutes while someone is in the Sift (only grown-up, untamed, resting Blubs). Hit or bump
the pile and they squeak and tumble off in all directions; they also climb down by themselves after a few minutes.
"""
import math
import random
import time

EVERY = (600, 1200)       # a new pile 10 to 20 minutes after the last one (about every 15), while someone's in the Sift
RETRY = 30                # no Blubs to pile up right now: look again in 30 seconds
SIZES = [(2, 46), (3, 32), (4, 16), (5, 6)]   # how big a pile is (weights): 5 is rare
NEAR = 7                  # Blubs this close to each other can pile up
SEEN = 40                 # ...near a player in the Sift
LASTS = (150, 300)        # they climb down by themselves after 2.5 to 5 minutes
BUMP = 1.4                # a player this close bumps the pile over
TAG = "gsmp_pile"         # on every Blub in a pile (plus gsmp_pile_<pile>_<place>, 0 = the bottom)
OWNER_TAG = "gsmp_owner_" # tamed pets carry this (see penguins.py)


def weighted_size(most):
    sizes = [(n, w) for n, w in SIZES if n <= most]
    total = sum(w for _, w in sizes)
    r = random.uniform(0, total)
    for n, w in sizes:
        r -= w
        if r <= 0:
            return n
    return sizes[-1][0]


class BlubPiles:
    def __init__(self, plugin, cmd):
        self.plugin = plugin
        self.cmd = cmd            # runs a command quietly (the Sift's)
        self.piles = {}           # pile id -> {"members": [actors, bottom first], "until": time}
        self.next_at = time.time() + random.uniform(*EVERY) / 2
        self.cleaned = False
        self._id = 0

    @staticmethod
    def tags(actor):
        try:
            return list(actor.scoreboard_tags)
        except Exception:
            return []

    def wild(self, actor):
        t = self.tags(actor)
        return not any(x.startswith(OWNER_TAG) or x.startswith(TAG) for x in t)

    # ---------- every 5 seconds (from the Sift, while players are in it) ----------
    def tick(self, here, mobs):
        now = time.time()
        if not self.cleaned:   # piles left over from before a restart climb down
            self.cleaned = True
            if any(TAG in self.tags(a) for a in mobs if str(a.type) == "galaxysmp:blub"):
                self.cmd(f"ride @e[tag={TAG}] stop_riding")
                self.cmd(f"event entity @e[tag={TAG}] galaxysmp:pile_off")
                self.cmd(f"effect @e[tag={TAG}] slowness 0")
                for a in mobs:
                    for t in self.tags(a):
                        if t.startswith(TAG):
                            try:
                                a.remove_scoreboard_tag(t)
                            except Exception:
                                pass
        if now < self.next_at or not here:
            return
        group = self.find(here, mobs)
        if not group:
            self.next_at = now + RETRY
            return
        self.make(group)
        self.next_at = now + random.uniform(*EVERY)

    def find(self, here, mobs):
        """Grown-up wild Blubs resting close together near a player: the group for a pile (or None)."""
        blubs = []
        for a in mobs:
            try:
                if str(a.type) != "galaxysmp:blub" or not a.is_valid or not self.wild(a):
                    continue
                l, v = a.location, a.velocity
                if math.hypot(v.x, v.z) > 0.06 or not a.is_on_ground:
                    continue   # resting Blubs only
                if not any((p.location.x - l.x) ** 2 + (p.location.z - l.z) ** 2 < SEEN * SEEN for p in here):
                    continue
                blubs.append(a)
            except Exception:
                continue
        if len(blubs) < 2:
            return None
        # babies don't pile up (the add-on marks them; the game's own selector checks it)
        for a in blubs:
            a.add_scoreboard_tag("gsmp_pile_c")
        checked = self.cmd("tag @e[tag=gsmp_pile_c,has_property={galaxysmp:small=false}] add gsmp_pile_a")
        grown = [a for a in blubs if "gsmp_pile_a" in self.tags(a)] if checked is not False else []
        for a in blubs:
            for t in ("gsmp_pile_c", "gsmp_pile_a"):
                try:
                    a.remove_scoreboard_tag(t)
                except Exception:
                    pass
        best = []
        for a in grown:
            near = [b for b in grown if (b.location.x - a.location.x) ** 2 + (b.location.z - a.location.z) ** 2 <= NEAR * NEAR
                    and abs(b.location.y - a.location.y) < 2.5]
            if len(near) > len(best):
                best = sorted(near, key=lambda b: (b.location.x - a.location.x) ** 2 + (b.location.z - a.location.z) ** 2)
        if len(best) < 2:
            return None
        return best[:weighted_size(min(5, len(best)))]

    def make(self, group):
        """They climb up one at a time: each one rides the one below it."""
        self._id += 1
        pid = self._id
        for i, a in enumerate(group):
            a.add_scoreboard_tag(TAG)
            a.add_scoreboard_tag(f"{TAG}_{pid}_{i}")
            self.cmd(f"event entity @e[tag={TAG}_{pid}_{i}] galaxysmp:pile_on")
        self.cmd(f"effect @e[tag={TAG}_{pid}_0] slowness {LASTS[1] + 30} 255 true")   # the bottom one stays put
        for i in range(1, len(group)):
            self.cmd(f"ride @e[tag={TAG}_{pid}_{i}] start_riding @e[tag={TAG}_{pid}_{i - 1},c=1] teleport_rider")
        b = group[0].location
        self.cmd(f"playsound random.pop @a[x={b.x:.1f},y={b.y:.1f},z={b.z:.1f},r=16] {b.x:.1f} {b.y:.1f} {b.z:.1f} 0.5 1.6")
        self.piles[pid] = {"members": list(group), "until": time.time() + random.uniform(*LASTS)}
        self.plugin.logger.info(f"The Sift: {len(group)} Blubs piled up")

    # ---------- every half second while there's a pile ----------
    def fast_tick(self):
        if not self.piles:
            return
        now = time.time()
        players = list(self.plugin.server.online_players)
        for pid, pile in list(self.piles.items()):
            members = pile["members"]
            if not all(self.valid(a) for a in members) or any(not self.wild_or_ours(a) for a in members):
                self.release(pid, tumble=False)   # one left, was tamed or went away: the rest climb down
                continue
            if now >= pile["until"]:
                self.release(pid, tumble=False)
                continue
            b = members[0].location
            for p in players:
                try:
                    l = p.location
                    if "over" in str(p.dimension.name).lower() and (l.x - b.x) ** 2 + (l.z - b.z) ** 2 < BUMP * BUMP and abs(l.y - b.y) < 3:
                        self.release(pid, tumble=True)
                        break
                except Exception:
                    continue

    @staticmethod
    def valid(a):
        try:
            return bool(a.is_valid) and not a.is_dead
        except Exception:
            return False

    def wild_or_ours(self, a):
        return not any(x.startswith(OWNER_TAG) for x in self.tags(a))

    def pile_of(self, actor):
        for t in self.tags(actor):
            if t.startswith(TAG + "_"):
                try:
                    return int(t.split("_")[2])
                except Exception:
                    return None
        return None

    def on_damage(self, event):
        """Hitting a Blub in a pile knocks the pile over (the hit itself is normal)."""
        try:
            if str(event.actor.type) != "galaxysmp:blub":
                return False
        except Exception:
            return False
        pid = self.pile_of(event.actor)
        if pid in self.piles:
            self.release(pid, tumble=True)
        return False

    def release(self, pid, tumble=True):
        """Down they come: bumped, they tumble off in all directions with a squeak; otherwise they climb down."""
        pile = self.piles.pop(pid, None)
        if pile is None:
            return
        n = len(pile["members"])
        for i in reversed(range(1, n)):
            self.cmd(f"ride @e[tag={TAG}_{pid}_{i}] stop_riding")
        for i in range(n):
            sel = f"@e[tag={TAG}_{pid}_{i}]"
            self.cmd(f"event entity {sel} galaxysmp:pile_off")
            if i:
                ang = random.uniform(0, math.tau)
                dist = random.uniform(1.0, 2.2) if tumble else 0.9
                self.cmd(f"execute as {sel} at @s run tp @s ~{math.cos(ang) * dist:.2f} ~{0.4 if tumble else 0.0} ~{math.sin(ang) * dist:.2f}")
        self.cmd(f"effect @e[tag={TAG}_{pid}_0] slowness 0")
        try:
            b = pile["members"][0].location
            where = f"{b.x:.1f} {b.y:.1f} {b.z:.1f}"
            if tumble:
                self.cmd(f"playsound mob.rabbit.hurt @a[x={b.x:.1f},y={b.y:.1f},z={b.z:.1f},r=16] {where} 0.6 1.8")
                self.cmd(f"particle minecraft:villager_happy {b.x:.1f} {b.y + 1.5:.1f} {b.z:.1f}")
        except Exception:
            pass
        for i, a in enumerate(pile["members"]):
            for t in (TAG, f"{TAG}_{pid}_{i}"):
                try:
                    a.remove_scoreboard_tag(t)
                except Exception:
                    pass

    def stopping(self):
        """The server is shutting down: every pile climbs down (so none is left stuck after a restart)."""
        for pid in list(self.piles):
            self.release(pid, tumble=False)
