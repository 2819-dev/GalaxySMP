"""The PvP arenas: original GalaxySMP space arenas floating in the End's empty void (no land to generate there, so
they're light to build, and its dark starry sky looks like space).

They sit between the End's main island and its outer islands (250 to 720 blocks from the middle), so the dragon
fight and survival players' End trips are never in the way:

    Galaxy Station    the PvP lobby: a round deck with a glass rail
    Nebula Ring       Potion free-for-all: a purple ring around a hole into the void
    Asteroid Field    Classic free-for-all: rocky ground with craters and boulders for cover
    Orbit Disc        Sumo free-for-all: a small white disc (knock them off)
    Crystal Canyon    Build free-for-all: calcite ridges and amethyst; placed blocks fade after 10 seconds
    Moon Base (x2), Comet Garden (x2)   duel arenas for Potion, Classic and Boxing (and party fights)
    Orbit Pad (x3)    Sumo duels
    Star Bridge (x3)  Build duels: three islands over the void
    Starfall Colosseum  events: a fighting disc in the middle, stands all around

Built once, gently, a piece at a time (like the Sift), while the server is quiet, or with /pvp build.
"""
import math
import time

DIM = "TheEnd"          # Endstone's name for the End
WHERE = "the_end"       # the name commands use (execute in the_end run ...)
Y = 100                 # every arena's floor
VERSION = 1             # bump to rebuild the arenas after a redesign
BUILT = f"pvp_arenas_v{VERSION}"
MID = "pvp_arena_now"   # the arena being built (cleared on a normal shutdown)
STOPS = "pvp_arena_stops"
AUTO = "pvp_arena_auto"
PER_TICK = 40
BUDGET = 0.005          # at most 5 ms of a tick
BUSY_MSPT = 30
QUIET = 3               # builds by itself while at most this many players are on (the arenas are small)
QUIET_MSPT = 20
AUTO_AFTER = 300        # and the server has been up 5 minutes
REST = 100              # ticks between arenas
ZONE = (200, -40, 640, 480)   # x1, z1, x2, z2: the PvP area (only PvP players belong here)

SEA = "minecraft:sea_lantern"
PEARL = "minecraft:pearlescent_froglight"
BARRIER = "minecraft:barrier"


def _hash(x, z, salt=0):
    h = (x * 374761393 + z * 668265263 + salt * 2147483647) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


# ---------- shapes (each returns commands) ----------
def fill(x1, y1, z1, x2, y2, z2, block, extra=""):
    """A box of blocks, split so no single command fills more than 32,768 blocks."""
    x1, x2 = sorted((int(x1), int(x2)))
    y1, y2 = sorted((int(y1), int(y2)))
    z1, z2 = sorted((int(z1), int(z2)))
    out = []
    layer = (x2 - x1 + 1) * (z2 - z1 + 1)
    step = max(1, 32768 // max(1, layer))
    if layer > 32768:   # very wide: split along x too
        for xa in range(x1, x2 + 1, 64):
            out += fill(xa, y1, z1, min(x2, xa + 63), y2, z2, block, extra)
        return out
    for ya in range(y1, y2 + 1, step):
        out.append(f"fill {x1} {ya} {z1} {x2} {min(y2, ya + step - 1)} {z2} {block}{(' ' + extra) if extra else ''}")
    return out


def disc(cx, y, cz, r, block, r_in=-1.0):
    """A flat disc (or a ring, with r_in) one block thick."""
    out = []
    for dz in range(-int(r), int(r) + 1):
        hw = math.sqrt(max(0.0, r * r - dz * dz))
        x_out = int(hw + 0.35)
        if r_in >= 0 and abs(dz) <= r_in:
            x_in = int(math.sqrt(max(0.0, r_in * r_in - dz * dz)) + 0.35)
            if x_in < x_out:
                out.append(f"fill {cx - x_out} {y} {cz + dz} {cx - x_in - 1} {y} {cz + dz} {block}")
                out.append(f"fill {cx + x_in + 1} {y} {cz + dz} {cx + x_out} {y} {cz + dz} {block}")
            continue
        out.append(f"fill {cx - x_out} {y} {cz + dz} {cx + x_out} {y} {cz + dz} {block}")
    return out


def column_ring(cx, y1, y2, cz, r, block, step=1):
    """Single blocks on a circle (a rail or a wall), from y1 to y2."""
    out, seen = [], set()
    n = max(8, int(2 * math.pi * r / step))
    for i in range(n):
        a = i * 2 * math.pi / n
        x, z = cx + int(round(math.cos(a) * r)), cz + int(round(math.sin(a) * r))
        if (x, z) not in seen:
            seen.add((x, z))
            out.append(f"fill {x} {y1} {z} {x} {y2} {z} {block}")
    return out


def box_walls(x1, z1, x2, z2, y1, y2, block):
    return (fill(x1, y1, z1, x2, y2, z1, block) + fill(x1, y1, z2, x2, y2, z2, block) +
            fill(x1, y1, z1, x1, y2, z2, block) + fill(x2, y1, z1, x2, y2, z2, block))


def lights_in_square(cx, y, cz, h, gap, block=SEA):
    return [f"setblock {cx + dx} {y} {cz + dz} {block}" for dx in range(-h + 3, h - 2, gap) for dz in range(-h + 3, h - 2, gap)]


def near_spawn(a, x, z, d=3.5):
    """True if (x, z) is close to one of the arena's spawn points (nothing tall is built there)."""
    return any(math.hypot(a["cx"] + sx - x, a["cz"] + sz - z) < d for sx, _y, sz, _yaw in a.get("spawns", []))


def lights_in_disc(cx, y, cz, r, gap, block=SEA):
    out = []
    for dx in range(-int(r), int(r) + 1, gap):
        for dz in range(-int(r), int(r) + 1, gap):
            if dx * dx + dz * dz <= (r - 1) ** 2:
                out.append(f"setblock {cx + dx} {y} {cz + dz} {block}")
    return out


# ---------- the arenas ----------
def _spawns_circle(n, r, dy=1.0):
    """n spawn points around a circle, each looking at the middle: (dx, dy, dz, yaw)."""
    out = []
    for i in range(n):
        a = i * 2 * math.pi / n
        dx, dz = math.cos(a) * r, math.sin(a) * r
        yaw = math.degrees(math.atan2(dx, -dz))   # Bedrock: yaw 0 looks south (+z), 90 looks west (-x)
        out.append((round(dx, 1), dy, round(dz, 1), round(yaw, 1)))
    return out


def lobby(a):
    cx, cz = a["cx"], a["cz"]
    out = disc(cx, Y - 1, cz, 19, "minecraft:black_concrete") + disc(cx, Y - 2, cz, 14, "minecraft:crying_obsidian")
    out += disc(cx, Y, cz, 20, "minecraft:deepslate_tiles")
    out += disc(cx, Y, cz, 17, "minecraft:purple_concrete", 15.6)
    out += disc(cx, Y, cz, 11, "minecraft:polished_blackstone_bricks", 9.6)
    out += disc(cx, Y, cz, 5, "minecraft:amethyst_block")
    for k in range(8):   # a star of light from the middle
        ang = k * math.pi / 4
        for d in range(6, 15, 2):
            out.append(f"setblock {cx + int(round(math.cos(ang) * d))} {Y} {cz + int(round(math.sin(ang) * d))} {SEA}")
    out.append(f"setblock {cx} {Y} {cz} {SEA}")
    out += column_ring(cx, Y + 1, Y + 1, cz, 20, "minecraft:light_blue_stained_glass")
    out += column_ring(cx, Y + 1, Y + 4, cz, 21, BARRIER)
    for k in range(8):   # light posts on the rail
        ang = k * math.pi / 4 + math.pi / 8
        x, z = cx + int(round(math.cos(ang) * 19)), cz + int(round(math.sin(ang) * 19))
        out += [f"fill {x} {Y + 1} {z} {x} {Y + 2} {z} minecraft:polished_blackstone_wall", f"setblock {x} {Y + 3} {z} {PEARL}"]
    return out


def nebula_ring(a):
    """Potion free-for-all: a wide purple ring around a hole into the void, with amethyst pillars for cover."""
    cx, cz = a["cx"], a["cz"]
    out = disc(cx, Y - 1, cz, 23, "minecraft:black_concrete", 4.5)
    for band in range(6):   # rings of purple and magenta
        r2, r1 = 24 - band * 3.3, 24 - (band + 1) * 3.3
        out += disc(cx, Y, cz, r2, "minecraft:purple_concrete" if band % 2 == 0 else "minecraft:magenta_concrete", max(4.5, r1))
    out += lights_in_disc(cx, Y, cz, 23, 5)
    out = [c for c in out if not (c.startswith("setblock") and abs(int(c.split()[1]) - cx) <= 5 and abs(int(c.split()[3]) - cz) <= 5)]
    out += column_ring(cx, Y + 1, Y + 1, cz, 24, "minecraft:purple_stained_glass")
    out += column_ring(cx, Y + 1, Y + 6, cz, 25, BARRIER)
    for k in range(6):
        ang = k * math.pi / 3
        x, z = cx + int(round(math.cos(ang) * 14)), cz + int(round(math.sin(ang) * 14))
        out += fill(x - 1, Y + 1, z - 1, x + 1, Y + 4, z + 1, "minecraft:amethyst_block") + [f"setblock {x} {Y + 5} {z} minecraft:end_rod"]
    return out


def asteroid_field(a):
    """Classic free-for-all: rocky, uneven ground with craters and boulders."""
    cx, cz = a["cx"], a["cz"]
    rocks = ["minecraft:blackstone", "minecraft:tuff", "minecraft:deepslate_tiles", "minecraft:polished_blackstone", "minecraft:cobbled_deepslate"]
    out = disc(cx, Y - 1, cz, 25, "minecraft:blackstone")
    for dx in range(-26, 27):
        for dz in range(-26, 27):
            d = math.hypot(dx, dz)
            wob = 24 + 3 * _hash(dx // 6, dz // 6, 3)
            if d > wob:
                continue
            blk = rocks[int(_hash(dx, dz, 1) * len(rocks)) % len(rocks)]
            if _hash(dx // 3, dz // 3, 5) > 0.93:
                blk = "minecraft:ochre_froglight"
            out.append(f"setblock {cx + dx} {Y} {cz + dz} {blk}")
    for i in range(5):   # craters
        ang, dist = _hash(i, 0, 7) * 2 * math.pi, 6 + _hash(i, 1, 7) * 12
        x, z = cx + int(math.cos(ang) * dist), cz + int(math.sin(ang) * dist)
        out += disc(x, Y, z, 2.6, "minecraft:air") + disc(x, Y - 1, z, 2.6, "minecraft:crying_obsidian" if i % 2 else "minecraft:tuff")
    for i in range(8):   # boulders
        ang, dist = _hash(i, 2, 9) * 2 * math.pi, 5 + _hash(i, 3, 9) * 16
        x, z = cx + int(math.cos(ang) * dist), cz + int(math.sin(ang) * dist)
        if near_spawn(a, x, z, 4):
            continue
        out += fill(x - 1, Y + 1, z - 1, x + 1, Y + 2, z + 1, "minecraft:blackstone") + [f"setblock {x} {Y + 3} {z} minecraft:polished_blackstone"]
    out += lights_in_disc(cx, Y, cz, 24, 6, "minecraft:ochre_froglight")
    out += column_ring(cx, Y + 1, Y + 8, cz, 28, BARRIER)
    return out


def orbit_disc(a, r=10.0):
    """Sumo: a small white disc with a blue ring (knock them off the edge)."""
    cx, cz = a["cx"], a["cz"]
    out = disc(cx, Y - 1, cz, r - 1, "minecraft:light_gray_concrete")
    out += disc(cx, Y, cz, r, "minecraft:white_concrete")
    out += disc(cx, Y, cz, r * 0.75, "minecraft:light_blue_concrete", r * 0.75 - 1)
    out += disc(cx, Y, cz, 1.5, SEA)
    for k in range(4):
        ang = k * math.pi / 2 + math.pi / 4
        out.append(f"setblock {cx + int(round(math.cos(ang) * r * 0.45))} {Y} {cz + int(round(math.sin(ang) * r * 0.45))} {SEA}")
    out += disc(cx, Y - 2, cz, r * 0.5, "minecraft:glowstone")
    return out


def orbit_pad(a):
    return orbit_disc(a, 6.0)


def crystal_canyon(a):
    """Build free-for-all: a square of calcite with ridges and amethyst, walls and a ceiling you can't see."""
    cx, cz, h = a["cx"], a["cz"], 20
    out = fill(cx - h, Y - 1, cz - h, cx + h, Y - 1, cz + h, "minecraft:smooth_basalt")
    out += fill(cx - h, Y, cz - h, cx + h, Y, cz + h, "minecraft:calcite")
    for dx in range(-h, h + 1):
        for dz in range(-h, h + 1):
            n = _hash(dx // 4, dz // 4, 11)
            if n > 0.86:
                out.append(f"setblock {cx + dx} {Y} {cz + dz} minecraft:amethyst_block")
    for i in range(7):   # ridges
        x, z = cx - 15 + int(_hash(i, 0, 12) * 30), cz - 15 + int(_hash(i, 1, 12) * 30)
        along_x = _hash(i, 2, 12) > 0.5
        ln, ht = 4 + int(_hash(i, 3, 12) * 6), 2 + int(_hash(i, 4, 12) * 3)
        x2, z2 = (x + ln, z + 1) if along_x else (x + 1, z + ln)
        if any(near_spawn(a, xx, zz, 3) for xx in range(x, x2 + 1) for zz in range(z, z2 + 1)):
            continue
        out += fill(x, Y + 1, z, min(x2, cx + h - 2), Y + ht, min(z2, cz + h - 2), "minecraft:calcite")
        out.append(f"setblock {x} {Y + ht + 1} {z} minecraft:amethyst_cluster")
    for dx in range(-h + 3, h - 2, 7):
        for dz in range(-h + 3, h - 2, 7):
            out.append(f"setblock {cx + dx} {Y} {cz + dz} {PEARL}")
    out += box_walls(cx - h - 1, cz - h - 1, cx + h + 1, cz + h + 1, Y, Y + 16, BARRIER)
    out += fill(cx - h - 1, Y + 17, cz - h - 1, cx + h + 1, Y + 17, cz + h + 1, BARRIER)
    out += box_walls(cx - h - 1, cz - h - 1, cx + h + 1, cz + h + 1, Y, Y, "minecraft:purple_stained_glass")
    return out


def moon_base(a):
    """A duel arena: grey moon tiles, low craters and two glass domes for cover."""
    cx, cz, h = a["cx"], a["cz"], 18
    out = fill(cx - h, Y - 1, cz - h, cx + h, Y - 1, cz + h, "minecraft:gray_concrete")
    for dx in range(-h, h + 1, 3):
        for dz in range(-h, h + 1, 3):
            blk = "minecraft:smooth_stone" if ((dx + dz) // 3) % 2 == 0 else "minecraft:light_gray_concrete"
            out.append(f"fill {cx + dx} {Y} {cz + dz} {min(cx + h, cx + dx + 2)} {Y} {min(cz + h, cz + dz + 2)} {blk}")
    for i, (dx, dz) in enumerate(((-6, -9), (7, 8), (0, 0), (-10, 7), (10, -7))):
        out += disc(cx + dx, Y, cz + dz, 2.4, "minecraft:gray_concrete")
    for dx, dz in ((0, -10), (0, 10)):   # glass domes
        for yy, rr in ((1, 3.0), (2, 2.6), (3, 1.6)):
            out += disc(cx + dx, Y + yy, cz + dz, rr, "minecraft:glass", rr - 1.1)
        out.append(f"setblock {cx + dx} {Y + 4} {cz + dz} minecraft:glass")
    out += lights_in_square(cx, Y, cz, h, 6)
    out += box_walls(cx - h - 1, cz - h - 1, cx + h + 1, cz + h + 1, Y, Y + 8, BARRIER)
    out += box_walls(cx - h - 1, cz - h - 1, cx + h + 1, cz + h + 1, Y, Y, "minecraft:light_blue_stained_glass")
    return out


def comet_garden(a):
    """A duel arena: deep teal tiles with glowing paths and purple comet rocks for cover."""
    cx, cz, h = a["cx"], a["cz"], 18
    out = fill(cx - h, Y - 1, cz - h, cx + h, Y - 1, cz + h, "minecraft:cyan_terracotta")
    out += fill(cx - h, Y, cz - h, cx + h, Y, cz + h, "minecraft:cyan_terracotta")
    out += fill(cx - h, Y, cz - 1, cx + h, Y, cz + 1, "minecraft:cyan_concrete") + fill(cx - 1, Y, cz - h, cx + 1, Y, cz + h, "minecraft:cyan_concrete")
    out += disc(cx, Y, cz, 4, "minecraft:cyan_concrete") + [f"setblock {cx} {Y} {cz} {SEA}"]
    for i, (dx, dz) in enumerate(((-9, -9), (9, 9), (-9, 9), (9, -9), (-4, 12), (4, -12))):
        out += fill(cx + dx - 1, Y + 1, cz + dz - 1, cx + dx, Y + 3 + (i % 2), cz + dz, "minecraft:purpur_block")
        out.append(f"setblock {cx + dx} {Y + 4 + (i % 2)} {cz + dz} minecraft:end_rod")
    out += lights_in_square(cx, Y, cz, h, 6)
    out += box_walls(cx - h - 1, cz - h - 1, cx + h + 1, cz + h + 1, Y, Y + 8, BARRIER)
    out += box_walls(cx - h - 1, cz - h - 1, cx + h + 1, cz + h + 1, Y, Y, "minecraft:cyan_stained_glass")
    return out


def star_bridge(a):
    """Build duels: two spawn islands and a middle island over the void; build across and fight."""
    cx, cz = a["cx"], a["cz"]
    out = []
    for dx, blk in ((-14, "minecraft:light_blue_concrete"), (14, "minecraft:purple_concrete")):
        out += fill(cx + dx - 3, Y - 2, cz - 3, cx + dx + 3, Y - 1, cz + 3, "minecraft:black_concrete")
        out += fill(cx + dx - 3, Y, cz - 3, cx + dx + 3, Y, cz + 3, blk) + [f"setblock {cx + dx} {Y} {cz} {SEA}"]
    out += fill(cx - 4, Y - 2, cz - 4, cx + 4, Y - 1, cz + 4, "minecraft:black_concrete")
    out += fill(cx - 4, Y, cz - 4, cx + 4, Y, cz + 4, "minecraft:quartz_block")
    out += fill(cx - 1, Y + 1, cz - 1, cx + 1, Y + 3, cz + 1, "minecraft:quartz_bricks") + [f"setblock {cx} {Y + 4} {cz} {SEA}"]
    for dx, dz in ((-3, -3), (3, 3), (-3, 3), (3, -3)):
        out.append(f"setblock {cx + dx} {Y} {cz + dz} {SEA}")
    x1, x2, z1, z2 = cx - 24, cx + 24, cz - 14, cz + 14
    out += box_walls(x1, z1, x2, z2, Y - 8, Y + 12, BARRIER)
    out += fill(x1, Y + 13, z1, x2, Y + 13, z2, BARRIER)
    return out


def colosseum(a):
    """Events: a fighting disc in the middle and raised stands around it (with a gap so watchers can't join in)."""
    cx, cz = a["cx"], a["cz"]
    out = disc(cx, Y - 1, cz, 9, "minecraft:glowstone") + disc(cx, Y, cz, 9, "minecraft:quartz_block")
    out += disc(cx, Y, cz, 8, "minecraft:gold_block", 7.0) + disc(cx, Y, cz, 1.5, SEA)
    out += disc(cx, Y + 2, cz, 18, "minecraft:black_concrete", 13.0)
    out += disc(cx, Y + 3, cz, 18, "minecraft:polished_blackstone_bricks", 13.0)
    out += disc(cx, Y + 3, cz, 15.5, "minecraft:purple_concrete", 14.5)
    out += column_ring(cx, Y + 3, Y + 3, cz, 16.5, SEA, step=4)
    out += column_ring(cx, Y + 4, Y + 4, cz, 18, "minecraft:light_blue_stained_glass")
    out += column_ring(cx, Y + 4, Y + 9, cz, 19, BARRIER)
    out += column_ring(cx, Y + 4, Y + 9, cz, 13, BARRIER)   # watchers stay in the stands
    return out


def _arenas():
    A = []

    def add(aid, name, kind, design, cx, cz, size, kits=(), spawns=(), stands=None, floor_lose=None):
        A.append({"id": aid, "name": name, "kind": kind, "design": design, "cx": cx, "cz": cz, "size": size, "kits": list(kits),
                  "spawns": list(spawns), "stands": stands, "lose_below": floor_lose})
    add("lobby", "Galaxy Station", "lobby", "lobby", 400, 0, 22, spawns=[(0.5, 1, 6.5, 180.0)])
    add("ffa_potion", "Nebula Ring", "ffa", "nebula_ring", 250, 120, 26, ["potion"], _spawns_circle(8, 18))
    add("ffa_classic", "Asteroid Field", "ffa", "asteroid_field", 350, 120, 28, ["classic"], _spawns_circle(8, 17))
    add("ffa_sumo", "Orbit Disc", "ffa", "orbit_disc", 450, 120, 11, ["sumo"], _spawns_circle(6, 6), floor_lose=Y - 1.5)
    add("ffa_build", "Crystal Canyon", "ffa", "crystal_canyon", 550, 120, 22, ["build"], _spawns_circle(8, 15))
    duel = [(-12.0, 1, 0.5, -90.0), (13.0, 1, 0.5, 90.0), (-12.0, 1, -2.5, -90.0), (13.0, 1, 3.5, 90.0)]
    for i, (x, design, name) in enumerate(((250, "moon_base", "Moon Base"), (330, "comet_garden", "Comet Garden"),
                                           (410, "moon_base", "Moon Base"), (490, "comet_garden", "Comet Garden"))):
        add(f"duel_open_{i + 1}", name, "duel", design, x, 240, 20, ["potion", "classic", "boxing"], duel)
    for i, x in enumerate((260, 300, 340)):
        add(f"duel_sumo_{i + 1}", "Orbit Pad", "duel", "orbit_pad", x, 330, 7, ["sumo"],
            [(-3.0, 1, 0.5, -90.0), (4.0, 1, 0.5, 90.0), (0.5, 1, -2.5, 0.0), (0.5, 1, 3.5, 180.0)], floor_lose=Y - 1.5)
    for i, x in enumerate((260, 340, 420)):
        add(f"duel_build_{i + 1}", "Star Bridge", "duel", "star_bridge", x, 420, 25, ["build"],
            [(-13.5, 1, 0.5, -90.0), (14.5, 1, 0.5, 90.0), (-13.5, 1, -1.5, -90.0), (14.5, 1, 2.5, 90.0)])
    add("event", "Starfall Colosseum", "event", "colosseum", 450, 330, 20, ["sumo", "classic", "potion", "boxing"],
        [(-4.0, 1, 0.5, -90.0), (5.0, 1, 0.5, 90.0)], stands=_spawns_circle(10, 15.8, dy=4.0), floor_lose=Y - 1.5)
    return A


ARENAS = _arenas()
BY_ID = {a["id"]: a for a in ARENAS}
DESIGNS = {"lobby": lobby, "nebula_ring": nebula_ring, "asteroid_field": asteroid_field, "orbit_disc": orbit_disc,
           "crystal_canyon": crystal_canyon, "moon_base": moon_base, "comet_garden": comet_garden, "orbit_pad": orbit_pad,
           "star_bridge": star_bridge, "colosseum": colosseum}
PROBE = {"lobby": SEA, "nebula_ring": None, "asteroid_field": None, "orbit_disc": SEA, "crystal_canyon": None, "moon_base": None,
         "comet_garden": SEA, "orbit_pad": SEA, "star_bridge": "minecraft:quartz_bricks", "colosseum": SEA}


def bounds(a, pad=0):
    """x1, z1, x2, z2 of an arena (its square around the middle)."""
    s = a["size"] + pad
    return a["cx"] - s, a["cz"] - s, a["cx"] + s, a["cz"] + s


def commands(a):
    """Everything that builds one arena: clear the space first (so a rebuild is clean), then the design."""
    x1, z1, x2, z2 = bounds(a, 2)
    return fill(x1, Y - 10, z1, x2, Y + 18, z2, "minecraft:air") + DESIGNS[a["design"]](a)


def probe(a):
    """A block that must be there once the arena is built."""
    blk = PROBE.get(a["design"])
    if a["design"] == "star_bridge":
        return f"testforblock {a['cx']} {Y + 1} {a['cz']} {blk}"
    if blk is None:   # the design's floor at a spot every one of these has
        floor = {"nebula_ring": None, "asteroid_field": None, "crystal_canyon": "minecraft:smooth_basalt", "moon_base": "minecraft:gray_concrete"}
        if a["design"] == "nebula_ring":
            return f"testforblock {a['cx'] + 20} {Y - 1} {a['cz']} minecraft:black_concrete"
        if a["design"] == "asteroid_field":
            return f"testforblock {a['cx']} {Y - 1} {a['cz']} minecraft:blackstone"
        return f"testforblock {a['cx']} {Y - 1} {a['cz']} {floor[a['design']]}"
    return f"testforblock {a['cx']} {Y} {a['cz']} {blk}"


def in_zone(x, z):
    return ZONE[0] <= x <= ZONE[2] and ZONE[1] <= z <= ZONE[3]


def arena_at(x, z, y=None):
    """The arena whose square this spot is in (or None)."""
    for a in ARENAS:
        x1, z1, x2, z2 = bounds(a, 1)
        if x1 <= x <= x2 and z1 <= z <= z2:
            return a
    return None


class ArenaBuilder:
    """Builds the arenas a few commands per tick (like the Sift), pausing when the server is busy."""

    def __init__(self, plugin):
        self.plugin = plugin
        self.todo, self.queue, self.cur, self.wait, self.auto, self.sender = [], [], None, 0, False, None
        self.started = time.time()
        self.booted = False
        self.tries = {}

    # ---------- state ----------
    def eco(self):
        return self.plugin.economy

    def done_ids(self):
        return set(self.eco().get_config(BUILT) or [])

    def ready(self):
        return all(a["id"] in self.done_ids() for a in ARENAS)

    def progress(self):
        d = self.done_ids()
        return sum(1 for a in ARENAS if a["id"] in d), len(ARENAS)

    def building(self):
        return self.cur is not None

    def cmd(self, c):
        server = self.plugin.server
        try:
            if getattr(self, "quiet", None) is None:
                try:
                    from endstone.command import CommandSenderWrapper
                    self.quiet = CommandSenderWrapper(server.command_sender, on_message=lambda m: None, on_error=lambda m: None)
                except Exception:
                    self.quiet = server.command_sender
            return server.dispatch_command(self.quiet, f"execute in {WHERE} run {c}")
        except Exception:
            return False

    def memory_high(self):
        try:
            from endstone_galaxylink.diagnostics import cgroup_now
            used, limit = cgroup_now()
            return bool(used and limit and used > limit * 0.55)
        except Exception:
            return False

    def players(self):
        try:
            return len(list(self.plugin.server.online_players))
        except Exception:
            return 0

    # ---------- building ----------
    def boot(self):
        self.booted = True
        eco = self.eco()
        if not eco.get_config(MID):
            return
        stops = int(eco.get_config(STOPS) or 0) + 1
        eco.set_config(STOPS, stops)
        eco.set_config(MID, None)
        if stops >= 2 and eco.get_config(AUTO) is not False:
            eco.set_config(AUTO, False)
            self.plugin.logger.warning("PvP arenas: the server stopped twice while building them, so they won't build by itself any more. "
                                       "Staff: /pvp build when the server is quiet.")

    def auto_check(self):
        """Every few seconds until they're all built: build them while the server is quiet."""
        if not self.booted:
            self.boot()
        if self.cur is not None or self.ready() or self.eco().get_config(AUTO) is False:
            return
        if time.time() - self.started < AUTO_AFTER or self.players() > QUIET or self.memory_high():
            return
        try:
            if float(self.plugin.server.current_mspt) > QUIET_MSPT:
                return
        except Exception:
            pass
        self.start(None, auto=True)

    def start(self, sender=None, again=False, auto=False):
        if self.cur is not None:
            return False
        if again:
            self.eco().set_config(BUILT, [])
        d = self.done_ids()
        self.todo = [a for a in ARENAS if a["id"] not in d]
        self.sender, self.auto = sender, auto
        if not self.todo:
            return False
        self.plugin.logger.info(f"PvP arenas: building {len(self.todo)} arenas" + (" (the server is quiet)" if auto else "") + "...")
        self.next()
        return True

    def stop(self):
        if self.cur is not None:
            self.cmd(f"tickingarea remove {self.area}")
        self.cur, self.queue, self.todo = None, [], []
        self.eco().set_config(MID, None)

    def next(self):
        if self.cur is not None:
            self.cmd(f"tickingarea remove {self.area}")
        if not self.todo:
            self.cur = None
            self.eco().set_config(MID, None)
            if self.ready():
                self.plugin.logger.info("PvP arenas are ready.")
                for s in [self.sender] + [p for p in self.plugin.server.online_players if p.is_op and p is not self.sender]:
                    if s is not None:
                        try:
                            s.send_message("§bThe PvP arenas are ready! §7PvP is open on the Main Menu.")
                        except Exception:
                            pass
            return
        self.cur = self.todo.pop(0)
        self.queue = list(reversed(commands(self.cur)))   # popped from the end
        self.eco().set_config(MID, self.cur["id"])
        x1, z1, x2, z2 = bounds(self.cur, 2)
        self.area = f"gsmp_pvp_{self.cur['id']}"
        self.cmd(f"tickingarea add {x1} {Y} {z1} {x2} {Y} {z2} {self.area} true")
        self.wait = REST

    def loaded(self):
        try:
            from endstone_galaxylink.safety import loaded_chunks
            dim = self.plugin.server.level.get_dimension(DIM)
            have = loaded_chunks(dim, max_age=0)
            x1, z1, x2, z2 = bounds(self.cur, 2)
            need = {(cx, cz) for cx in range(x1 >> 4, (x2 >> 4) + 1) for cz in range(z1 >> 4, (z2 >> 4) + 1)}
            return need <= have
        except Exception:
            return True

    def tick(self):
        """Every tick while building."""
        if self.cur is None:
            return
        if self.wait > 0:
            self.wait -= 1
            return
        if not self.loaded():
            self.waited = getattr(self, "waited", 0) + 20
            if self.waited < 1200:
                self.wait = 20
                return
        self.waited = 0
        try:
            if float(self.plugin.server.current_mspt) > BUSY_MSPT:
                return
        except Exception:
            pass
        if self.memory_high():
            self.wait = 200
            return
        if self.auto and self.players() > QUIET:
            self.wait = 200
            return
        start = time.perf_counter()
        for _ in range(PER_TICK):
            if not self.queue or time.perf_counter() - start > BUDGET:
                break
            self.cmd(self.queue.pop())
        if self.queue:
            return
        a = self.cur
        if self.cmd(probe(a)) is False:
            n = self.tries.get(a["id"], 0) + 1
            self.tries[a["id"]] = n
            self.plugin.logger.warning(f"PvP arenas: {a['name']} didn't build, try {n}")
            if n < 3:
                self.todo.insert(0, a)
            self.next()
            self.wait = 200 * n
            return
        built = [x for x in (self.eco().get_config(BUILT) or []) if x != a["id"]] + [a["id"]]
        self.eco().set_config(BUILT, built)
        self.eco().set_config(STOPS, 0)
        self.next()
