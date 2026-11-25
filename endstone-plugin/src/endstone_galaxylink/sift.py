"""The Sift: a dreamy valley of its own, far out at x/z 50000 (Bedrock add-ons can't add new dimensions).

A round valley about 600 blocks across, closed in by tall banded red cliffs so it feels like its own world:
salmon-pink ground with mossy flower meadows, tall spiky pink grass, pale weeping trees with long white curtains,
and huge red rock pillars with flat, tree-covered tops. While you're inside, the sky turns teal (a fog from the pack).
Staff build it once with /sift build (best when the server is quiet): a 64 x 64 piece at a time, slowly, pausing
whenever the server is busy or memory is high, and checking each piece really built. It never builds by itself:
building far-away land is the heaviest thing the server does, and doing it at every start made the server unstable.
Wild Dumplings and Blubs are spawned by the plugin near players in the Sift.

Get there: the "The Sift" card on the Main Menu, a Sift portal (Portal Axe), or /sift (staff).
"""

import math
import random
import time
from collections import deque

CX, CZ = 50000, 50000   # middle of the Sift
BASE = 68               # ground height
LOW = 52                # the Sift's ground is solid from here up
CLEAR_TO = 240          # everything above the ground is cleared up to here (old trees, hills, the old sky island)
R = 300                 # radius of the valley: 600 x 600 blocks, red cliffs all around the edge
TILE = 64
TILES = [(tx, tz) for tx in range(-320, 320, TILE) for tz in range(-320, 320, TILE)]   # 100 pieces
SEED = 2027
PER_TICK = 50           # at most this many commands per tick while building...
BUDGET = 0.005          # ...and at most 5 ms of each tick (a tick is 50 ms), so the server stays smooth
BUSY_MSPT = 30          # if the server is already slow (ms per tick), wait instead of building
MEM_PAUSE = 0.55        # pause building while the server uses more than this share of its memory limit
TILE_REST = 300         # ticks to rest between pieces (15 seconds), so new land can settle and memory drop
AREA = "gsmp_sift_build"
VERSION = 3             # bump to rebuild the Sift after a redesign (3: 600 x 600)
UNDER = "minecraft:red_terracotta"
# note: on Bedrock, plain terracotta is "hardened_clay" and the snow block is "snow"
LEAF = 'minecraft:cherry_leaves["persistent_bit"=true]'
PALE_LEAF = 'minecraft:pale_oak_leaves["persistent_bit"=true]'

# only Dumplings and Blubs live in the Sift
PASSIVE = {"ground": ["galaxysmp:dumpling", "galaxysmp:dumpling", "galaxysmp:blub", "galaxysmp:blub", "galaxysmp:blub"]}
PASSIVE_CAP = 10


# ---------- terrain (the same numbers every time, so the plugin knows the ground height anywhere) ----------
def _hash(ix, iz, salt):
    h = (ix * 374761393 + iz * 668265263 + salt * 2147483647 + SEED * 1442695040888963407) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def noise(x, z, scale, salt):
    """Smooth value noise between 0 and 1."""
    fx, fz = x / scale, z / scale
    ix, iz = math.floor(fx), math.floor(fz)
    tx, tz = fx - ix, fz - iz
    sx, sz = tx * tx * (3 - 2 * tx), tz * tz * (3 - 2 * tz)
    a, b = _hash(ix, iz, salt), _hash(ix + 1, iz, salt)
    c, d = _hash(ix, iz + 1, salt), _hash(ix + 1, iz + 1, salt)
    return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz


def edge(dx, dz):
    """0 in the middle, 1 at the outer edge of the cliffs (wobbly)."""
    return math.hypot(dx, dz) / (R * (0.88 + 0.12 * noise(dx, dz, 60, 3)))


CLIFF_START = 1 - 44 / R   # the cliffs rise over the outer ~40 blocks


def cliff(dx, dz):
    """How high the red cliffs rise here (0 inside the valley)."""
    e = edge(dx, dz)
    if e < CLIFF_START:
        return 0
    t = min(1.0, (e - CLIFF_START) / (0.97 - CLIFF_START))
    t = t * t * (3 - 2 * t)
    return int(t * (26 + noise(dx, dz, 14, 8) * 22 + noise(dx, dz, 5, 9) * 4))


def column(dx, dz):
    """(top y, cliff height, surface block) at an offset from the middle, or None outside the Sift."""
    if edge(dx, dz) >= 1:
        return None
    d = math.hypot(dx, dz)
    h = 3 + noise(dx, dz, 30, 1) * 4 + noise(dx, dz, 11, 2) * 1.5 + max(0.0, noise(dx, dz, 44, 7) - 0.6) * 14
    if d < 34:   # open, gently sloping ground around the landing spot in the middle
        k = max(0.0, (d - 10) / 24)
        h = 3 + (h - 3) * k * k
    c = cliff(dx, dz)
    top = BASE + int(h) + c
    if c > 4:
        surf = "minecraft:moss_block" if noise(dx, dz, 6, 13) > 0.55 else ("minecraft:pink_terracotta" if noise(dx, dz, 4, 14) > 0.5 else UNDER)
    elif noise(dx, dz, 9, 11) > 0.6:
        surf = "minecraft:moss_block"
    else:
        surf = "minecraft:pink_terracotta"
    return top, c, surf


BANDS = [UNDER, UNDER, "minecraft:hardened_clay", UNDER, "minecraft:pink_terracotta", UNDER]
WHITE = ["minecraft:snow", "minecraft:snow", "minecraft:snow", "minecraft:white_concrete_powder", PALE_LEAF]
MINT = "minecraft:waxed_oxidized_copper"   # the mint-teal shading under the white trees
FLOWERS = ["minecraft:blue_orchid", "minecraft:blue_orchid", "minecraft:cornflower", "minecraft:torchflower", "minecraft:firefly_bush",
           "minecraft:short_grass", "minecraft:short_grass", "minecraft:allium", "minecraft:pink_tulip", "minecraft:dandelion",
           "minecraft:azalea", "minecraft:flowering_azalea", "minecraft:oxeye_daisy"]


def spires():
    """The big red rock pillars with flat, tree-covered tops: (dx, dz, radius, height, cap radius). Each fits inside one piece."""
    out = []
    for tx, tz in TILES:
        rng = random.Random(f"{SEED}:spire:{tx}:{tz}")
        for _ in range(6):
            cap = rng.randint(6, 10)
            dx, dz = tx + rng.randint(cap + 2, TILE - cap - 3), tz + rng.randint(cap + 2, TILE - cap - 3)
            if edge(dx, dz) > CLIFF_START - 0.06 or math.hypot(dx, dz) < 26 or rng.random() < 0.3:
                continue
            if any(math.hypot(dx - a, dz - b) < cap + c + 8 for a, b, r, h, c in out):
                continue
            out.append((dx, dz, rng.randint(3, 5), rng.randint(18, 36), cap))
            if len([1 for a, b, *_ in out if tx <= a < tx + TILE and tz <= b < tz + TILE]) >= 1:
                break
    return out


SPIRES = spires()


def disc_rows(x, z, r):
    """Rows (z, x1, x2) that fill a circle of radius r."""
    for dz in range(-r, r + 1):
        hw = int(math.sqrt(max(0, r * r - dz * dz)) + 0.35)
        yield z + dz, x - hw, x + hw


def tile_commands(tx, tz):
    """All the commands that build one 64 x 64 piece."""
    out = []
    rng = random.Random(f"{SEED}:{tx}:{tz}")
    cols = {}
    for dx in range(tx, tx + TILE):
        for dz in range(tz, tz + TILE):
            c = column(dx, dz)
            if c is None:
                continue
            top, cl, surf = c
            cols[(dx, dz)] = c
            x, z = CX + dx, CZ + dz
            if cl > 3:   # cliffs: red rock in bands of color on the part you can see
                band_from = max(LOW, top - 26)
                out.append(f"fill {x} {LOW} {z} {x} {band_from - 1} {z} {UNDER}")
                y = band_from
                while y <= top - 1:
                    y2 = min(top - 1, y + 2)
                    out.append(f"fill {x} {y} {z} {x} {y2} {z} {BANDS[(y // 3) % len(BANDS)]}")
                    y = y2 + 1
            else:
                out.append(f"fill {x} {LOW} {z} {x} {top - 3} {z} {UNDER}")
                out.append(f"fill {x} {top - 2} {z} {x} {top - 1} {z} minecraft:hardened_clay")
            out.append(f"setblock {x} {top} {z} {surf}")
            out.append(f"fill {x} {top + 1} {z} {x} {CLEAR_TO} {z} air")
    # the rock pillars in this piece
    for sx, sz, r, hgt, cap in SPIRES:
        if tx <= sx < tx + TILE and tz <= sz < tz + TILE:
            out += spire(rng, sx, sz, r, hgt, cap)
    # plants and trees on the ground
    taken = set()
    for (dx, dz), (top, cl, surf) in cols.items():
        x, y, z = CX + dx, top + 1, CZ + dz
        if (dx, dz) in taken or edge(dx, dz) > 0.97 or any((dx - sx) ** 2 + (dz - sz) ** 2 < (cap + 1) ** 2 for sx, sz, r, h, cap in SPIRES):
            continue
        inner = tx + 5 <= dx < tx + TILE - 5 and tz + 5 <= dz < tz + TILE - 5   # big things stay inside this piece
        r_ = rng.random()
        grassy = noise(dx, dz, 14, 21) > 0.52
        if inner and r_ < (0.012 if cl > 4 else 0.005) and math.hypot(dx, dz) > 12:
            out += pale_tree(rng, x, y, z)
            taken.update((dx + i, dz + j) for i in range(-4, 5) for j in range(-4, 5))
        elif inner and grassy and r_ < 0.045 and cl < 4 and math.hypot(dx, dz) > 9:
            out += pink_grass(rng, x, y, z, cols, dx, dz)
            taken.update((dx + i, dz + j) for i in range(-2, 3) for j in range(-2, 3))
        elif surf == "minecraft:moss_block" and r_ < 0.3:
            out.append(f"setblock {x} {y} {z} {rng.choice(FLOWERS)}")
        elif surf == "minecraft:pink_terracotta" and r_ < 0.012 and inner:
            out += rock(rng, x, y, z)
    return out


def spire(rng, dx, dz, r, hgt, cap):
    """A tall, knobbly red rock pillar with a wide flat top covered in white weeping trees."""
    x, z = CX + dx, CZ + dz
    base = column(dx, dz)[0] - 1
    top = base + hgt
    out = []
    for y in range(base, top - 2, 3):   # banded rock that wobbles in width, wider at the bottom
        rad = r + (1 if y < base + hgt // 3 else 0) + int(round((noise(y, dx, 4, 31) - 0.5) * 2.4))
        ox, oz = int(round((noise(y, dz, 9, 32) - 0.5) * 2)), int(round((noise(y, dx, 9, 33) - 0.5) * 2))
        blk = BANDS[(y // 3) % len(BANDS)]
        for zz, x1, x2 in disc_rows(x + ox, z + oz, max(2, rad)):
            out.append(f"fill {x1} {y} {zz} {x2} {min(y + 2, top - 3)} {zz} {blk}")
    for i, rad in enumerate((cap - 3, cap - 1, cap)):   # the flat top, like a mushroom
        for zz, x1, x2 in disc_rows(x, z, rad):
            out.append(f"fill {x1} {top - 2 + i} {zz} {x2} {top - 2 + i} {zz} {UNDER if i < 2 else 'minecraft:pink_terracotta'}")
    for _ in range(cap * 3):   # white curtains hanging off the rim
        a = rng.uniform(0, math.tau)
        hx, hz = x + int(round(math.cos(a) * cap)), z + int(round(math.sin(a) * cap))
        ln = rng.randint(1, 5)
        out.append(f"fill {hx} {top - ln} {hz} {hx} {top} {hz} {rng.choice(WHITE)} replace air")
        out.append(f"setblock {hx} {top - ln - 1} {hz} minecraft:pale_hanging_moss")
    n = max(2, cap // 2)
    for k in range(n):   # trees covering the top
        a, d = k * math.tau / n + rng.uniform(-0.3, 0.3), rng.uniform(0, cap - 4)
        out += pale_tree(rng, x + int(math.cos(a) * d), top + 1, z + int(math.sin(a) * d), small=True)
    return out


def pale_tree(rng, x, y, z, small=False):
    """A white weeping tree: a wide, flat white crown with mint-teal shading and long curtains hanging down."""
    h = rng.randint(3, 5) if small else rng.randint(5, 8)
    rad = rng.randint(3, 4) if small else rng.randint(4, 5)
    out = [f"fill {x} {y} {z} {x} {y + h} {z} minecraft:pale_oak_log"]
    cy = y + h
    for i, rr in enumerate((rad, rad, rad - 2)):   # the crown: white on top, mint underneath
        for zz, x1, x2 in disc_rows(x, z, rr):
            blk = MINT if i == 0 and rng.random() < 0.45 else rng.choice(WHITE)
            out.append(f"fill {x1} {cy + i - 1} {zz} {x2} {cy + i - 1} {zz} {blk} replace air")
    for _ in range(rad * 8):   # the curtains
        a = rng.uniform(0, math.tau)
        rr = rad if rng.random() < 0.7 else rad - 1
        hx, hz = x + int(round(math.cos(a) * rr)), z + int(round(math.sin(a) * rr))
        ln = rng.randint(2, max(2, h))
        out.append(f"fill {hx} {cy - ln} {hz} {hx} {cy - 2} {hz} {rng.choice(WHITE + [MINT])} replace air")
        if rng.random() < 0.6:
            out.append(f"setblock {hx} {cy - ln - 1} {hz} minecraft:pale_hanging_moss")
    return out


def pink_grass(rng, x, y, z, cols, dx, dz):
    """A clump of tall, spiky pink grass."""
    out = []
    for _ in range(rng.randint(6, 14)):
        i, j = rng.randint(-2, 2), rng.randint(-2, 2)
        c = cols.get((dx + i, dz + j))
        if c is None or c[1] > 3:
            continue
        hgt = max(1, rng.randint(2, 6) - (abs(i) + abs(j)) // 2)
        out.append(f"fill {x + i} {c[0] + 1} {z + j} {x + i} {c[0] + hgt} {z + j} {LEAF}")
    return out


def rock(rng, x, y, z):
    r = rng.randint(1, 2)
    return [f"fill {x - r} {y - 1} {z - r} {x + r} {y + r - 1} {z + r} {UNDER}", f"setblock {x} {y + r} {z} minecraft:hardened_clay"]


def probes(tx, tz):
    """A few spots in a piece whose deep ground must be red rock once it's built."""
    pts = [(dx, dz) for dx in range(tx + 8, tx + TILE, 16) for dz in range(tz + 8, tz + TILE, 16) if column(dx, dz) is not None]
    return [f"testforblock {CX + dx} {LOW + 1} {CZ + dz} {UNDER}" for dx, dz in pts[:4]]


BUILT, PIECES = f"sift_v{VERSION}_built", f"sift_v{VERSION}_tiles"   # saved progress (a new version builds again)
FOG = "galaxysmp:sift"


class Sift:
    def __init__(self, plugin):
        self.plugin = plugin
        self.queue = []          # commands waiting to run
        self.tile = None         # the piece being built
        self.wait = 0            # ticks to wait (for a ticking area to load)
        self.todo = []
        self.tries = {}
        self.sender = None
        self.fogged = set()      # players who see the Sift's teal sky right now

    # ---------- state ----------
    def built(self):
        return bool(self.plugin.economy.get_config(BUILT))

    def spot(self):
        top = column(0, 0)[0]
        return {"dim": "Overworld", "x": CX + 0.5, "y": top + 1.0, "z": CZ + 0.5, "yaw": 0.0, "pitch": 0.0}

    @staticmethod
    def inside(loc):
        try:
            dim = str(loc.dimension.name).lower()
        except Exception:
            dim = "overworld"
        return "over" in dim and math.hypot(loc.x - CX, loc.z - CZ) < R + 8 and loc.y > LOW - 20

    # ---------- building ----------
    def start_build(self, sender=None):
        if self.tile is not None or self.queue:
            return False
        if self.memory_high():
            if sender is not None:
                try:
                    sender.send_message("§eThe server is using a lot of memory right now. §7Try /sift build again later (when it's quieter).")
                except Exception:
                    pass
            return None
        done = set(map(tuple, self.plugin.economy.get_config(PIECES) or []))
        self.todo = [t for t in TILES if t not in done]
        self.sender = sender
        self.cmd(f"tickingarea remove {AREA}")   # a leftover from an older version
        self.plugin.logger.info(f"The Sift: building {len(self.todo)} pieces...")
        self.next_tile()
        return True

    def cmd(self, c):
        """Runs a command quietly (building runs hundreds of thousands; they shouldn't flood the console)."""
        server = self.plugin.server
        try:
            if getattr(self, "quiet", None) is None:
                try:
                    from endstone.command import CommandSenderWrapper
                    self.quiet = CommandSenderWrapper(server.command_sender, on_message=lambda m: None, on_error=lambda m: None)
                except Exception:
                    self.quiet = server.command_sender
            return server.dispatch_command(self.quiet, c)
        except Exception:
            return False

    def next_tile(self):
        # each piece gets its own loading-area name (removing one finishes a moment later, so a reused name clashes)
        self.cmd(f"tickingarea remove {getattr(self, 'area', AREA)}")
        if not self.todo:
            self.tile = None
            if getattr(self, "incomplete", False):
                self.incomplete = False
                self.plugin.logger.warning("The Sift: some pieces didn't build; it will try again after the next restart (or /sift build).")
                return
            self.plugin.economy.set_config(BUILT, True)
            self.plugin.logger.info("The Sift is ready.")
            if self.sender is not None:
                try:
                    self.sender.send_message("§bThe Sift is ready! §7/sift to go there.")
                except Exception:
                    pass
            return
        self.tile = self.todo.pop(0)
        tx, tz = self.tile
        self.queue = deque(tile_commands(tx, tz))
        self.area = f"{AREA}_{(tx + 128) // TILE}{(tz + 128) // TILE}"
        self.cmd(f"tickingarea add {CX + tx} {BASE} {CZ + tz} {CX + tx + TILE - 1} {BASE} {CZ + tz + TILE - 1} {self.area} true")
        self.wait = TILE_REST   # rest, then let the chunks load

    def build_tick(self):
        """Called every tick while building."""
        if self.tile is None:
            return
        if self.wait > 0:
            self.wait -= 1
            return
        if not self.loaded():
            self.waited = getattr(self, "waited", 0) + 20
            if self.waited < 1800:   # up to 90 seconds for the land to load
                self.wait = 20
                return
        self.waited = 0
        try:
            if float(self.plugin.server.current_mspt) > BUSY_MSPT:
                return   # the server is busy right now: build a little later
        except Exception:
            pass
        if self.memory_high():
            self.wait = 200   # memory is high: wait 10 seconds and check again
            return
        start = time.perf_counter()
        for _ in range(PER_TICK):
            if not self.queue or time.perf_counter() - start > BUDGET:
                break
            self.cmd(self.queue.popleft())
        if self.queue:
            return
        tx, tz = self.tile
        if not all(self.cmd(c) is not False for c in probes(tx, tz)):
            # the area wasn't loaded: build this piece again (more patiently), up to 3 times
            tries = self.tries.get(self.tile, 0) + 1
            self.tries[self.tile] = tries
            self.plugin.logger.warning(f"The Sift: piece {self.tile} didn't build, try {tries}")
            if tries < 4:
                self.todo.insert(0, self.tile)
            else:
                self.incomplete = True
            self.next_tile()
            self.wait = 200 * tries
            return
        tiles = list(self.plugin.economy.get_config(PIECES) or [])
        tiles.append(list(self.tile))
        self.plugin.economy.set_config(PIECES, tiles)
        # leaves and plants cut by the build drop items: clear them, so they don't pile up as thousands of entities
        self.cmd(f"execute in overworld run kill @e[type=item,x={CX + tx},y={LOW - 10},z={CZ + tz},dx={TILE},dy={CLEAR_TO - LOW + 20},dz={TILE}]")
        self.next_tile()

    def memory_high(self):
        """True while the server uses more than MEM_PAUSE of its memory limit (or when we can't tell, False)."""
        try:
            from endstone_galaxylink.diagnostics import cgroup_now
            used, limit = cgroup_now()
            return bool(used and limit and used > limit * MEM_PAUSE)
        except Exception:
            return False

    def building(self):
        return self.tile is not None

    def loaded(self):
        """True once every chunk of the piece being built is loaded (new land far away takes a while)."""
        try:
            from endstone_galaxylink.safety import loaded_chunks
            dim = self.plugin.server.level.get_dimension("Overworld")
            have = loaded_chunks(dim, max_age=0)
            tx, tz = self.tile
            need = {(cx, cz) for cx in range((CX + tx) >> 4, ((CX + tx + TILE - 1) >> 4) + 1)
                    for cz in range((CZ + tz) >> 4, ((CZ + tz + TILE - 1) >> 4) + 1)}
            return need <= have
        except Exception:
            return True

    # ---------- going there ----------
    def go(self, player):
        if not self.built():
            player.send_message("§bThe Sift is coming soon! §7It isn't open yet.")
            return False
        tp = getattr(self.plugin, "teleports", None)
        try:
            player.teleport(tp.location(self.spot()))
            self.cmd(f'effect "{player.name}" slow_falling 8 0 true')   # a soft landing, just in case
            from endstone_galaxylink.safety import later
            later(self.plugin, player, self.check_landing, 40)
        except Exception:
            return False
        try:
            player.send_title("§b§lThe Sift", "§7Something is singing out there...", 10, 60, 20)
        except Exception:
            pass
        return True

    def check_landing(self, player):
        """2 seconds after arriving (the area is loaded now): if the ground isn't there, the build didn't take.
        Send them back to spawn and build the Sift again."""
        try:
            top = column(0, 0)[0]
            name = str(getattr(player.dimension.get_block_at(CX, top, CZ), "type", ""))
        except Exception:
            return
        if name != "minecraft:air":
            return
        self.plugin.logger.warning("The Sift: no ground at the landing spot (staff can run /sift build again)")
        spot = self.plugin.economy.get_config("spawn")
        try:
            if spot:
                player.teleport(self.plugin.teleports.location(spot))
        except Exception:
            pass
        player.send_message("§bSorry! The Sift isn't finished yet. §7Staff have been told.")
        # never wipe the progress or start building by itself here: staff decide (/sift status, /sift build)
        self.plugin.economy.set_config(BUILT, False)
        for s in self.plugin.server.online_players:
            if s.is_op:
                s.send_message("§e[Sift] §7A player landed on missing ground at the Sift. Type §e/sift build§7 when the server is quiet.")

    # ---------- life: mobs and fireflies ----------
    def tick(self):
        """Every 5 seconds: wild mobs show up around players in the Sift, and fireflies at night."""
        if not self.built():
            return
        server = self.plugin.server
        here = [p for p in server.online_players if self.inside(p.location)]
        self.update_fog(here)
        if not here:
            return
        night = 13000 <= (server.level.time % 24000) <= 23000
        try:
            actors = here[0].dimension.actors
        except Exception:
            return
        sift_mobs = [a for a in actors if str(a.type).startswith("galaxysmp:") and self.inside(a.location)]
        for p in here:
            l = p.location
            near = [a for a in sift_mobs if (a.location.x - l.x) ** 2 + (a.location.z - l.z) ** 2 < 48 * 48]
            passive = [a for a in near if str(a.type) in ("galaxysmp:dumpling", "galaxysmp:blub")]
            if len(passive) < PASSIVE_CAP:
                self.spawn_near(l, PASSIVE)
            if night:
                for _ in range(4):
                    fx, fz = l.x + random.uniform(-10, 10), l.z + random.uniform(-10, 10)
                    self.cmd(f"particle minecraft:obsidian_glow_dust_particle {fx:.1f} {l.y + random.uniform(0.5, 3):.1f} {fz:.1f}")

    def update_fog(self, here):
        """The Sift's dreamy teal sky (a fog from the resource pack) while you're in it."""
        uids = {str(p.unique_id) for p in here}
        for p in self.plugin.server.online_players:
            uid, name = str(p.unique_id), p.name.replace('"', "")
            if uid in uids and uid not in self.fogged:
                self.cmd(f'fog "{name}" push {FOG} gsmp_sift')
                self.fogged.add(uid)
            elif uid not in uids and uid in self.fogged:
                self.cmd(f'fog "{name}" remove gsmp_sift')
                self.fogged.discard(uid)

    def on_quit(self, player):
        self.fogged.discard(str(player.unique_id))

    def spawn_near(self, l, table):
        for _ in range(6):
            ang, dist = random.uniform(0, math.tau), random.uniform(16, 32)
            dx, dz = int(l.x + math.cos(ang) * dist) - CX, int(l.z + math.sin(ang) * dist) - CZ
            c = column(dx, dz)
            if c is None or edge(dx, dz) > 0.85:
                continue
            top, cl, _ = c
            if cl > 2:
                continue
            mob = random.choice(table["ground"])
            y = top + 1
            self.cmd(f"summon {mob} {CX + dx + 0.5} {y} {CZ + dz + 0.5}")
            return True
        return False

    # ---------- /sift ----------
    def command(self, sender, args):
        args = " ".join(args or []).split()   # "/sift build again" arrives as one piece of text
        sub = (args[0].lower() if args else "")
        if sub == "build" and sender.is_op:
            if self.built() and (len(args) < 2 or args[1].lower() != "again"):
                sender.send_message("§eThe Sift is already built. §7/sift build again rebuilds it.")
                return True
            if len(args) > 1 and args[1].lower() == "again":
                self.plugin.economy.set_config(PIECES, [])
                self.plugin.economy.set_config(BUILT, False)
            started = self.start_build(sender)
            if started:
                sender.send_message("§bBuilding the Sift slowly in the background. §7It pauses when the server is busy. "
                                    "Best when few players are on. §e/sift stop§7 pauses it, §e/sift status§7 shows progress.")
            elif started is False:
                sender.send_message("§eIt's already being built.")
            return True
        if sub == "stop" and sender.is_op:
            if self.tile is None:
                sender.send_message("§7The Sift isn't being built right now.")
                return True
            self.cmd(f"tickingarea remove {getattr(self, 'area', AREA)}")
            self.tile, self.queue, self.todo = None, deque(), []
            sender.send_message("§eStopped building the Sift. §7Finished pieces are kept; §e/sift build§7 carries on later.")
            return True
        if sub == "status" and sender.is_op:
            done = len(self.plugin.economy.get_config(PIECES) or [])
            state = "ready" if self.built() else f"{done}/{len(TILES)} pieces built" + (" (building now)" if self.building() else " (not building)")
            sender.send_message(f"§bThe Sift: §f{state}")
            return True
        if not hasattr(sender, "xuid"):
            sender.send_message("Players only.")
            return True
        tp = getattr(self.plugin, "teleports", None)
        if tp is not None and tp.in_minigame(sender):
            sender.send_message("§cYou can't go to the Sift during a minigame.")
            return True
        self.go(sender)
        return True
