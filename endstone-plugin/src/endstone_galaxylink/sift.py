"""The Sift: a glowing land of its own, floating high above the far edge of the world.

Bedrock add-ons can't add new dimensions, so the Sift is a big sky island (192 x 192 blocks) at x/z 50000.
The plugin builds it once by itself (about 2 minutes, a piece at a time) with three areas:
  Glow Meadow  - teal ground, blue flowers, fireflies and drooping teal trees (Dumplings, Blubs, Seedlings)
  Rose Hills   - pink rock hills with blossom bushes (Blubs, Trills)
  Bone Flats   - a pale bone desert with giant ribs and amethyst (Sifters come out here at night)
Mobs are spawned by the plugin near players in the Sift (wild Dumplings, Blubs, Seedlings, Trills;
Baby Sifters, Bearded Sifters and Nesters at night). An invisible wall keeps people from falling off.

Get there: the "The Sift" card on the Main Menu (staff add it on the website), a Sift portal (Portal Axe), or /sift.
"""

import math
import random
import time

CX, CZ = 50000, 50000   # middle of the island
BASE = 200              # ground height
R = 96                  # island radius
TILE = 64
TILES = [(tx, tz) for tx in range(-96, 96, TILE) for tz in range(-96, 96, TILE)]   # 9 tiles
SEED = 2027
PER_TICK = 200          # commands per tick while building
AREA = "gsmp_sift_build"

PASSIVE = {"meadow": ["galaxysmp:dumpling", "galaxysmp:dumpling", "galaxysmp:blub", "galaxysmp:seedling", "galaxysmp:trill"],
           "hills": ["galaxysmp:blub", "galaxysmp:blub", "galaxysmp:trill", "galaxysmp:dumpling"],
           "bones": ["galaxysmp:seedling", "galaxysmp:trill"]}
HOSTILE = {"meadow": ["galaxysmp:baby_sifter"], "hills": ["galaxysmp:baby_sifter", "galaxysmp:nester"],
           "bones": ["galaxysmp:bearded_sifter", "galaxysmp:nester", "galaxysmp:baby_sifter"]}
PASSIVE_CAP, HOSTILE_CAP = 10, 6


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


def zone(dx, dz):
    """meadow, hills or bones: three wedges around the middle, with wobbly borders."""
    ang = (math.degrees(math.atan2(dz, dx)) + 360 + (noise(dx, dz, 24, 7) - 0.5) * 50) % 360
    return "meadow" if ang < 140 else "hills" if ang < 250 else "bones"


def edge(dx, dz):
    """0 in the middle, 1 at the island's edge (wobbly)."""
    return math.hypot(dx, dz) / (R * (0.86 + 0.14 * noise(dx, dz, 30, 3)))


def column(dx, dz):
    """(top y, bottom y, zone) of the land at an offset from the middle, or None for open sky."""
    e = edge(dx, dz)
    if e >= 1:
        return None
    z = zone(dx, dz)
    hill = {"meadow": 5, "hills": 14, "bones": 3}[z]
    top = BASE + int(noise(dx, dz, 22, 1) * hill + noise(dx, dz, 9, 2) * 3 - max(0, e - 0.8) * 20)
    depth = int(6 + (1 - e * e) * 34 * (0.6 + 0.4 * noise(dx, dz, 14, 4)))
    return top, top - depth, z


SURFACE = {"meadow": ("minecraft:warped_nylium", "minecraft:moss_block"),
           "hills": ("minecraft:pink_terracotta", "minecraft:magenta_terracotta"),
           "bones": ("minecraft:bone_block", "minecraft:calcite")}
# what can grow on each ground block
FLOWERS = {"minecraft:moss_block": ["minecraft:blue_orchid", "minecraft:blue_orchid", "minecraft:short_grass", "minecraft:firefly_bush",
                                    "minecraft:torchflower", "minecraft:pink_petals", "minecraft:azure_bluet"],
           "minecraft:warped_nylium": ["minecraft:warped_roots", "minecraft:warped_roots", "minecraft:nether_sprouts"],
           "minecraft:sand": ["minecraft:dead_bush"],
           "minecraft:bone_block": ["minecraft:small_amethyst_bud"]}


def tile_commands(tx, tz):
    """All the commands that build one 64 x 64 piece."""
    out = []
    rng = random.Random(f"{SEED}:{tx}:{tz}")
    tops = {}
    for dx in range(tx, tx + TILE):
        for dz in range(tz, tz + TILE):
            c = column(dx, dz)
            if c is None:
                continue
            top, bot, z = c
            x, zz = CX + dx, CZ + dz
            surf, sub = SURFACE[z]
            if z == "bones" and noise(dx, dz, 6, 9) > 0.7:
                surf = "minecraft:sand"
            if z == "hills" and noise(dx, dz, 5, 10) > 0.72:
                surf = "minecraft:moss_block"
            if z == "meadow" and noise(dx, dz, 7, 11) > 0.55:
                surf = "minecraft:moss_block"
            under = "minecraft:tuff" if noise(dx, dz, 8, 5) > 0.35 else "minecraft:deepslate"
            out.append(f"fill {x} {bot} {zz} {x} {top - 3} {zz} {under}")
            out.append(f"fill {x} {top - 2} {zz} {x} {top - 1} {zz} {sub}")
            out.append(f"setblock {x} {top} {zz} {surf}")
            tops[(dx, dz)] = (top, z, surf)
            if 0.94 < edge(dx, dz) < 1 and rng.random() < 0.08:
                out.append(f"setblock {x} {bot - 1} {zz} minecraft:pale_hanging_moss")   # moss hanging under the edge
    # things on top
    for (dx, dz), (top, z, surf) in tops.items():
        x, y, zz = CX + dx, top + 1, CZ + dz
        if edge(dx, dz) > 0.9:
            continue
        r = rng.random()
        if z == "meadow" and r < 0.006:
            out += tree(rng, x, y, zz)
        elif z == "hills" and r < 0.004:
            out += boulder(rng, x, y, zz)
        elif z == "hills" and r < 0.008:
            out += blossom(rng, x, y, zz)
        elif z == "bones" and r < 0.0016:
            out += rib(rng, x, y, zz)
        elif z == "bones" and r < 0.004:
            out.append(f"setblock {x} {y} {zz} minecraft:amethyst_cluster")
        elif surf in FLOWERS and r < (0.16 if z == "meadow" else 0.07):
            out.append(f"setblock {x} {y} {zz} {rng.choice(FLOWERS[surf])}")
        elif z == "meadow" and r < 0.145:
            out.append(f"setblock {x} {top} {zz} minecraft:verdant_froglight")   # glowing spots in the grass
    return out


def tree(rng, x, y, z):
    """A drooping teal tree with glowing bits."""
    h = rng.randint(5, 8)
    out = [f"fill {x} {y} {z} {x} {y + h} {z} minecraft:warped_stem"]
    cy = y + h
    for dy, rad in ((0, 3), (1, 3), (2, 2)):   # rounded layers (corners cut off)
        out.append(f"fill {x - rad} {cy + dy} {z - rad + 1} {x + rad} {cy + dy} {z + rad - 1} minecraft:warped_wart_block replace air")
        out.append(f"fill {x - rad + 1} {cy + dy} {z - rad} {x + rad - 1} {cy + dy} {z + rad} minecraft:warped_wart_block replace air")
    out.append(f"setblock {x} {cy + 1} {z} minecraft:shroomlight")
    for _ in range(9):
        hx, hz = x + rng.randint(-3, 3), z + rng.randint(-3, 3)
        if (abs(hx - x) == 3) != (abs(hz - z) == 3):
            ln = rng.randint(1, 4)
            out.append(f"fill {hx} {cy - ln} {hz} {hx} {cy - 1} {hz} minecraft:pale_hanging_moss replace air")
    return out


def boulder(rng, x, y, z):
    r = rng.randint(2, 3)
    return [f"fill {x - r} {y - 1} {z - r + 1} {x + r} {y + r} {z + r - 1} minecraft:pink_terracotta",
            f"fill {x - r + 1} {y - 1} {z - r} {x + r - 1} {y + r - 1} {z + r} minecraft:magenta_terracotta",
            f"setblock {x} {y + r + 1} {z} minecraft:moss_carpet"]


def blossom(rng, x, y, z):
    return [f"setblock {x} {y} {z} minecraft:cherry_log", f"fill {x - 1} {y + 1} {z - 1} {x + 1} {y + 2} {z + 1} minecraft:cherry_leaves replace air"]


def rib(rng, x, y, z):
    """A giant bone arch."""
    out, span, along_x = [], rng.randint(5, 8), rng.random() < 0.5
    for i in range(-span, span + 1):
        hgt = int(math.sqrt(max(0, span * span - i * i)) * 1.2)
        bx, bz = (x + i, z) if along_x else (x, z + i)
        out.append(f"setblock {bx} {y + hgt} {bz} minecraft:bone_block")
        if abs(i) == span:
            out.append(f"fill {bx} {y} {bz} {bx} {y + hgt} {bz} minecraft:bone_block")
    return out


def wall_commands():
    """An invisible wall around the edge (barrier blocks), so nobody falls off."""
    out, seen = [], set()
    for a in range(0, 3600, 4):
        ang = math.radians(a / 10)
        for k in range(0, R + 12):
            dx, dz = int(round(math.cos(ang) * k)), int(round(math.sin(ang) * k))
            if column(dx, dz) is None:
                break
        dx, dz = int(round(math.cos(ang) * (k + 1))), int(round(math.sin(ang) * (k + 1)))
        if (dx, dz) in seen:
            continue
        seen.add((dx, dz))
        out.append(f"fill {CX + dx} {BASE - 10} {CZ + dz} {CX + dx} {BASE + 30} {CZ + dz} minecraft:barrier replace air")
    return out


class Sift:
    def __init__(self, plugin):
        self.plugin = plugin
        self.queue = []          # commands waiting to run
        self.tile = None         # the tile being built
        self.wait = 0            # ticks to wait (for a ticking area to load)
        self.last_spawn = 0.0

    # ---------- state ----------
    def built(self):
        return bool(self.plugin.economy.get_config("sift_built"))

    def spot(self):
        top = column(0, 0)[0]
        return {"dim": "overworld", "x": CX + 0.5, "y": top + 1.0, "z": CZ + 0.5, "yaw": 0.0, "pitch": 0.0}

    @staticmethod
    def inside(loc):
        try:
            dim = str(loc.dimension.name).lower()
        except Exception:
            dim = "overworld"
        return "over" in dim and abs(loc.x - CX) < R + 16 and abs(loc.z - CZ) < R + 16 and loc.y > BASE - 60

    # ---------- building ----------
    def start_build(self, sender=None):
        if self.tile is not None or self.queue:
            return False
        done = set(map(tuple, self.plugin.economy.get_config("sift_tiles") or []))
        self.todo = [t for t in TILES if t not in done] + ["wall"]
        self.sender = sender
        self.plugin.logger.info(f"The Sift: building {len(self.todo)} pieces...")
        self.next_tile()
        return True

    def cmd(self, c):
        try:
            return self.plugin.server.dispatch_command(self.plugin.server.command_sender, c)
        except Exception:
            return False

    def next_tile(self):
        self.cmd(f"tickingarea remove {AREA}")
        if not self.todo:
            self.tile = None
            self.plugin.economy.set_config("sift_built", True)
            self.plugin.logger.info("The Sift is ready.")
            if self.sender is not None:
                try:
                    self.sender.send_message("§bThe Sift is ready! §7/sift to go there.")
                except Exception:
                    pass
            return
        self.tile = self.todo.pop(0)
        if self.tile == "wall":
            self.queue = wall_commands()
            self.cmd(f"tickingarea add circle {CX} {BASE} {CZ} 4 {AREA}")   # the wall runs in pieces below
            self.wall_parts = True
        else:
            tx, tz = self.tile
            self.queue = tile_commands(tx, tz)
            self.cmd(f"tickingarea add {CX + tx} {BASE} {CZ + tz} {CX + tx + TILE - 1} {BASE} {CZ + tz + TILE - 1} {AREA} true")
        self.wait = 100   # let the chunks load

    def build_tick(self):
        """Called every tick while building."""
        if self.tile is None:
            return
        if self.wait > 0:
            self.wait -= 1
            return
        if self.tile == "wall":
            # the wall goes all around, so load a small area at a time where the next commands are
            batch = []
            while self.queue and len(batch) < 40:
                batch.append(self.queue.pop(0))
            if batch:
                x, _, z = batch[0].split()[1:4]
                self.cmd(f"tickingarea remove {AREA}")
                self.cmd(f"tickingarea add circle {x} {BASE} {z} 2 {AREA}")
                self.pending = batch
                self.wait = 40
                self.tile = "wall_run"
            else:
                self.next_tile()
            return
        if self.tile == "wall_run":
            for c in getattr(self, "pending", []):
                self.cmd(c)
            self.pending = []
            self.tile = "wall"
            return
        for _ in range(PER_TICK):
            if not self.queue:
                break
            self.cmd(self.queue.pop(0))
        if not self.queue:
            tiles = list(self.plugin.economy.get_config("sift_tiles") or [])
            tiles.append(list(self.tile))
            self.plugin.economy.set_config("sift_tiles", tiles)
            self.next_tile()

    def building(self):
        return self.tile is not None

    # ---------- going there ----------
    def go(self, player):
        if not self.built():
            player.send_message("§bThe Sift is still being made. §7Try again in a few minutes!")
            if not self.building():
                self.start_build()
            return False
        tp = getattr(self.plugin, "teleports", None)
        try:
            player.teleport(tp.location(self.spot()))
        except Exception:
            return False
        try:
            player.send_title("§b§lThe Sift", "§7Something is singing out there...", 10, 60, 20)
        except Exception:
            pass
        return True

    # ---------- life: mobs and fireflies ----------
    def tick(self):
        """Every 5 seconds: wild mobs show up around players in the Sift, and fireflies at night."""
        if not self.built():
            return
        server = self.plugin.server
        here = [p for p in server.online_players if self.inside(p.location)]
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
            hostile = [a for a in near if str(a.type) in ("galaxysmp:baby_sifter", "galaxysmp:bearded_sifter", "galaxysmp:nester")]
            passive = [a for a in near if a not in hostile and str(a.type) != "galaxysmp:sift_orb"]
            if len(passive) < PASSIVE_CAP:
                self.spawn_near(l, PASSIVE)
            if night and len(hostile) < HOSTILE_CAP:
                self.spawn_near(l, HOSTILE)
            if night:
                for _ in range(4):
                    fx, fz = l.x + random.uniform(-10, 10), l.z + random.uniform(-10, 10)
                    self.cmd(f"particle minecraft:obsidian_glow_dust_particle {fx:.1f} {l.y + random.uniform(0.5, 3):.1f} {fz:.1f}")

    def spawn_near(self, l, table):
        for _ in range(6):
            ang, dist = random.uniform(0, math.tau), random.uniform(16, 32)
            dx, dz = int(l.x + math.cos(ang) * dist) - CX, int(l.z + math.sin(ang) * dist) - CZ
            c = column(dx, dz)
            if c is None or edge(dx, dz) > 0.9:
                continue
            top, _, z = c
            mob = random.choice(table[z])
            y = top + (random.randint(6, 12) if mob == "galaxysmp:trill" else 1)
            self.cmd(f"summon {mob} {CX + dx + 0.5} {y} {CZ + dz + 0.5}")
            return True
        return False

    # ---------- /sift ----------
    def command(self, sender, args):
        sub = (args[0].lower() if args else "")
        if sub == "build" and sender.is_op:
            if self.built() and (len(args) < 2 or args[1].lower() != "again"):
                sender.send_message("§eThe Sift is already built. §7/sift build again rebuilds it.")
                return True
            if len(args) > 1 and args[1].lower() == "again":
                self.plugin.economy.set_config("sift_tiles", [])
                self.plugin.economy.set_config("sift_built", False)
            sender.send_message("§bBuilding the Sift... §7(about 2 minutes)" if self.start_build(sender) else "§eIt's already being built.")
            return True
        if sub == "status" and sender.is_op:
            done = len(self.plugin.economy.get_config("sift_tiles") or [])
            sender.send_message(f"§bThe Sift: §f{'ready' if self.built() else f'{done}/{len(TILES)} pieces built'}")
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
