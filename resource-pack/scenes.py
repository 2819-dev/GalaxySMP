# The join screen backgrounds: cinematic 3D scenes with GalaxySMP adventurers (original characters).
#   python3 scenes.py <block texture folder> <output folder> [quick] [only=<scene>]
# Writes gsmp_bg_<scene>.png for: valley, trials, deepdark, lush, nether, end, sift
import math, os, sys
import numpy as np
import render3d as R
from render3d import B, put, tree, Boxes, adventurer, gather_lights, render, Sky, vnoise

OUT = sys.argv[2]
QUICK = "quick" in sys.argv
ONLY = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("only=")), None)
SIZE = (960, 360) if QUICK else (1440, 540)
SS = 1 if QUICK else 2


class FlatSky(Sky):
    """A sky with its own colours (Nether, End, The Sift)."""
    def __init__(self, top, mid, hor, sun=(0.3, 0.4, 1.0), stars=0.0, planet=False, moons=()):
        super().__init__(np.array(sun, float), night=1.0, planet=planet)
        self.cols = [np.array(c) for c in (top, mid, hor)]
        self.stars, self.moons = stars, moons

    def __call__(self, d, bare=False):
        top, mid, hor = self.cols
        e = np.clip(d[:, 1], -1, 1)
        k = np.clip(e, 0, 1)[:, None]
        col = np.where(k < 0.2, hor + (mid - hor) * (k / 0.2), mid + (top - mid) * np.clip((k - 0.2) / 0.6, 0, 1))
        col = np.where(e[:, None] < 0, hor * 0.7, col)
        if bare:
            return col
        if self.stars:
            q = np.floor(d * 340).astype(np.int64)
            h = (q[:, 0] * 73856093 ^ q[:, 1] * 19349663 ^ q[:, 2] * 83492791) & 0xFFFF
            col = col + ((h < 70) * np.clip((e + 0.1) * 3, 0, 1) * self.stars)[:, None] * np.array([1.0, 0.95, 1.0])
        for mdir, r, mc in self.moons:
            md = np.array(mdir, float); md /= np.linalg.norm(md)
            ang = np.arccos(np.clip(d @ md, -1, 1))
            col = np.where((ang < r)[:, None], np.array(mc) * (0.75 + 0.25 * np.cos(ang / r * 1.5))[:, None], col)
            col = col + (np.exp(-np.clip(ang - r, 0, None) * 30) * (ang >= r))[:, None] * np.array(mc) * 0.25
        return col


def bg(name, W, o, look, sky, sun_col, amb, fog, boxes=None, lights=None, lr=12.0, sun_on=True, hfov=120, vfov=46, steps=420):
    if ONLY and ONLY != name:
        return
    img = render(W, o, look, SIZE, hfov, vfov, sky, sun_col, amb, fog=fog, steps=steps, cylindrical=True, ss=SS,
                 boxes=boxes, lights=lights, lr=lr, sun_on=sun_on)
    img.save(os.path.join(OUT, f"gsmp_bg_{name}.png"))
    print("rendered", name, flush=True)


rng = np.random.default_rng(7)


# ------------------------------------------------------------------ the GalaxySMP valley (spawn at sunset)
def valley():
    W = R.galaxy_world()
    bx = Boxes()
    gy = ground(W, 190, 52, 100)
    adventurer(bx, 190.5, gy, 52.5, 0, "galaxy", item="sword", cape=(0.30, 0.85, 0.95))
    adventurer(bx, 193.5, ground(W, 193, 50, 100), 50.0, 0, "explorer", item="torch")
    sun = np.array([-0.75, 0.13, 1.0])
    bg("valley", W, (192, gy + 4.5, 42), (180, 48, 230), Sky(sun), (2.6, 1.5, 0.85), (0.34, 0.32, 0.55), 0.0016, boxes=bx, hfov=130, vfov=50, steps=560)


# ------------------------------------------------------------------ Trial Chambers
def trials():
    X, Y, Z = 96, 36, 110
    W = np.zeros((X, Y, Z), np.uint8)
    W[:, :, :] = B["tuff"]
    put(W, 8, 5, 6, 88, 24, 104, 0)                       # the hall
    for x in range(8, 89):
        for z in range(6, 105):
            W[x, 4, z] = B["copper_ox"] if ((x // 4 + z // 4) % 2) else B["polished_tuff"]
            if abs(x - 48) < 9 and abs(z - 60) < 9:
                W[x, 4, z] = B["copper"] if ((x + z) % 2) else B["copper_we"]
    for x in (8, 88):
        put(W, x, 5, 6, x, 24, 104, B["tuff_bricks"])
    put(W, 8, 5, 104, 88, 24, 104, B["tuff_bricks"])
    put(W, 8, 25, 6, 88, 25, 104, B["tuff_bricks"])
    put(W, 40, 25, 50, 56, 35, 70, 0)                       # a skylight in the middle
    for px in (22, 36, 60, 74):
        for pz in (30, 54, 78):
            put(W, px - 1, 5, pz - 1, px + 1, 24, pz + 1, B["chiseled_tuff"])
            W[px, 11, pz - 2] = W[px, 11, pz + 2] = W[px - 2, 11, pz] = W[px + 2, 11, pz] = B["copper_bulb"]
            put(W, px - 2, 5, pz - 2, px + 2, 5, pz + 2, B["tuff_bricks"])
    put(W, 47, 5, 59, 49, 5, 61, B["tuff_bricks"])
    W[48, 6, 60] = B["spawner"]
    for z in range(10, 100, 12):
        W[9, 14, z] = W[87, 14, z] = B["copper_bulb"]
    bx = Boxes()
    adventurer(bx, 44.5, 5, 46.0, 0, "knight", item="mace", cape=(0.85, 0.2, 0.25), pose=0.8)
    adventurer(bx, 52.5, 5, 44.5, 0, "galaxy", item="sword", pose=-0.6)
    adventurer(bx, 48.5, 5, 38.0, 0, "explorer", item="torch")
    lights = gather_lights(W, [((48.5, 7, 60.5), (2.0, 1.2, 0.5))], limit=70)
    sun = np.array([0.15, 1.0, 0.25])
    bg("trials", W, (47, 7.6, 37), (49, 7.2, 70), Sky(sun, day=True, planet=False), (2.2, 2.0, 1.7), (0.10, 0.10, 0.12), 0.0035,
       boxes=bx, lights=lights, lr=14, hfov=110, vfov=46)


# ------------------------------------------------------------------ Deep Dark (an ancient city)
def deepdark():
    X, Y, Z = 128, 48, 128
    W = np.zeros((X, Y, Z), np.uint8)
    n = vnoise((X, Z), 20, 5, 3)
    for x in range(X):
        for z in range(Z):
            f = int(6 + n[x, z] * 6)
            W[x, :f, z] = B["deepslate"]
            c = int(36 + n[z % X, x % Z] * 8)
            W[x, c:, z] = B["deepslate"]
            if n[x, z] > 0.55:
                W[x, f - 1, z] = B["sculk"]
    for _ in range(40):
        x, z = rng.integers(10, 118), rng.integers(10, 118)
        f = np.nonzero(W[x, :20, z])[0].max()
        W[x, f, z] = B["catalyst"]
    # the city: platforms, a great frame, walls, soul lanterns
    put(W, 30, 8, 60, 98, 9, 110, B["ds_tiles"])
    put(W, 50, 10, 92, 78, 34, 96, B["ds_bricks"])
    put(W, 56, 10, 92, 72, 28, 96, 0)
    put(W, 57, 11, 93, 71, 27, 95, B["crying"])
    for x in (36, 46, 82, 92):
        for z in (66, 80):
            put(W, x, 10, z, x + 2, 18 + (x % 5), z + 2, B["ds_bricks"])
            W[x + 1, 19 + (x % 5), z + 1] = B["soul_lamp"]
    for x in range(32, 97, 8):
        W[x, 10, 62] = B["soul_lamp"]
    bx = Boxes()
    adventurer(bx, 63.5, 10, 70.0, 0, "mage", item="lantern")
    adventurer(bx, 66.0, 10, 66.0, 0, "galaxy", item="sword", cape=(0.3, 0.85, 0.95))
    lights = gather_lights(W, limit=90)
    bg("deepdark", W, (63, 12.6, 62), (64, 15, 100), FlatSky((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)), (0, 0, 0), (0.035, 0.05, 0.08), 0.012,
       boxes=bx, lights=lights, lr=16, sun_on=False, hfov=110, vfov=46)


# ------------------------------------------------------------------ Lush Caves (a cave opening onto cliffs)
def lush():
    X, Y, Z = 128, 80, 200
    W = np.zeros((X, Y, Z), np.uint8)
    n = vnoise((X, Z), 18, 11, 3)
    W[:, :, :90] = B["stone"]
    for x in range(X):
        for z in range(90):
            e = ((x - 64) / 52) ** 2 + ((z - 45) / 50) ** 2
            if e < 1:
                floor = int(10 + n[x, z] * 5)
                roof = int(46 - e * 18 + n[z % X, x] * 6)
                W[x, floor:roof, z] = 0
                W[x, floor - 1, z] = B["moss"] if n[x, z] > 0.35 else B["clay"]
    for x in range(30, 98):   # the cave mouth
        for z in range(80, 92):
            top = int(34 - ((x - 64) / 34) ** 2 * 18)
            W[x, 12:max(12, top), z] = 0
    for x in range(X):   # outside: a sunny valley falling away, hills in the distance
        for z in range(90, Z):
            hgt = int(11 - (z - 90) * 0.12 + n[x, z] * 6 + max(0, z - 150) * 0.55 + abs(x - 64) * 0.08)
            hgt = int(np.clip(hgt, 2, Y - 2))
            W[x, :hgt, z] = B["stone"]; W[x, hgt, z] = B["grass"]; W[x, hgt - 3:hgt, z] = B["dirt"]
            if hgt < 6:
                W[x, hgt + 1:7, z] = B["water"]
    for _ in range(260):
        x, z = rng.integers(4, 124), rng.integers(96, 196)
        g = np.nonzero(W[x, :, z])[0].max()
        if W[x, g, z] == B["grass"]:
            tree(W, x, g + 1, z, "birch" if rng.random() < 0.3 else "oak", rng)
    put(W, 50, 9, 40, 78, 10, 62, 0)
    put(W, 50, 8, 40, 78, 8, 62, B["clay"])
    put(W, 51, 9, 41, 77, 9, 61, B["water"])
    for _ in range(34):   # azalea trees inside (not right in front of the camera)
        x, z = rng.integers(20, 108), rng.integers(10, 84)
        if 48 < x < 82 and z > 50:
            continue
        f = np.nonzero(W[x, :40, z] == 0)[0]
        if f.size == 0 or W[x, f.min() - 1, z] == 0:
            continue
        y = f.min()
        put(W, x, y, z, x, y + 3, z, B["log"])
        for dx in range(-2, 3):
            for dz in range(-2, 3):
                for dy in range(3, 6):
                    if abs(dx) + abs(dz) + abs(dy - 4) < 4 and W[x + dx, y + dy, z + dz] == 0:
                        W[x + dx, y + dy, z + dz] = B["azalea"]
    for _ in range(320):   # glow berry vines and dripstone from the roof
        x, z = rng.integers(14, 114), rng.integers(4, 84)
        col = np.nonzero(W[x, 16:, z])[0]
        if col.size == 0:
            continue
        top = 16 + col.min()
        if rng.random() < 0.8:
            for k in range(1, int(rng.integers(3, 12))):
                W[x, top - k, z] = B["berries"] if k % 3 == 0 else B["azalea"]
        else:
            W[x, top - int(rng.integers(1, 5)):top, z] = B["dripstone"]
    bx = Boxes()
    gy = ground(W, 62, 74, 30)
    adventurer(bx, 62.5, gy, 74.0, 0, "explorer", item="torch", cape=(0.9, 0.7, 0.3))
    adventurer(bx, 66.5, ground(W, 66, 70, 30), 70.0, 0, "galaxy", item="sword")
    lights = gather_lights(W, limit=90)
    sun = np.array([0.15, 0.55, 1.0])
    bg("lush", W, (64, gy + 3.5, 58), (64, 20, 160), Sky(sun, day=True, planet=False), (2.6, 2.3, 1.9), (0.16, 0.2, 0.16), 0.002,
       boxes=bx, lights=lights, lr=12, hfov=115, vfov=50)


# ------------------------------------------------------------------ The Nether (a fortress bridge over lava)
def nether():
    X, Y, Z = 160, 72, 160
    W = np.zeros((X, Y, Z), np.uint8)
    n = vnoise((X, Z), 26, 21, 4)
    for x in range(X):
        for z in range(Z):
            h = int(6 + n[x, z] * 30 * (abs(x - 80) / 80) ** 0.6)
            W[x, :h, z] = B["netherrack"]
            if h > 18 and n[x, z] > 0.6:
                W[x, h - 1, z] = B["crimson"]
            if h < 12:
                W[x, h:12, z] = B["lava"]
            c = int(68 - n[z, x] * 8)
            W[x, c:, z] = B["netherrack"]
            if n[z, x] > 0.7:
                W[x, c - 1, z] = B["glowstone"]
    put(W, 74, 26, 0, 86, 27, 159, B["nether_brick"])       # the bridge
    for z in range(0, 160, 3):
        W[74, 28, z] = W[86, 28, z] = B["nether_brick"]
    for z in range(10, 160, 24):
        put(W, 77, 0, z, 83, 25, z + 4, B["nether_brick"])
    put(W, 70, 26, 110, 90, 44, 130, B["nether_brick"])
    put(W, 72, 28, 112, 88, 42, 128, 0)
    put(W, 77, 28, 110, 83, 34, 110, 0)
    for y in (36, 40):
        for x in range(72, 89, 4):
            W[x, y, 110] = B["glowstone"]
    bx = Boxes()
    adventurer(bx, 78.5, 28, 40.0, 0, "netherite", item="sword", cape=(0.75, 0.45, 0.95))
    adventurer(bx, 82.0, 28, 37.0, 0, "knight", item="mace")
    lights = gather_lights(W, [((80, 14, z), (2.4, 0.8, 0.2)) for z in range(10, 160, 20)], limit=80)
    sky = FlatSky((0.10, 0.015, 0.02), (0.22, 0.04, 0.04), (0.45, 0.10, 0.05))
    bg("nether", W, (80.5, 31.5, 31), (80, 29, 120), sky, (0, 0, 0), (0.42, 0.16, 0.10), 0.004,
       boxes=bx, lights=lights, lr=20, sun_on=False, hfov=115, vfov=48)


# ------------------------------------------------------------------ The End (end city towers, elytra flyers)
def end():
    X, Y, Z = 160, 96, 180
    W = np.zeros((X, Y, Z), np.uint8)
    def island(cx, cy, cz, r):
        for x in range(cx - r, cx + r + 1):
            for z in range(cz - r, cz + r + 1):
                d = math.hypot(x - cx, z - cz)
                if d <= r and 0 <= x < X and 0 <= z < Z:
                    depth = int((r - d) * 0.9) + 1
                    W[x, max(0, cy - depth):cy + 1, z] = B["end_stone"]
    island(80, 20, 40, 22); island(110, 30, 120, 18); island(40, 26, 140, 14)
    def tower(x, y, z, w, h):
        put(W, x, y, z, x + w, y + h, z + w, B["purpur"])
        put(W, x + 1, y + 1, z + 1, x + w - 1, y + h - 1, z + w - 1, 0)
        for yy in range(y + 3, y + h, 5):
            W[x + w // 2, yy:yy + 2, z] = B["end_bricks"]
            W[x, yy:yy + 2, z + w // 2] = B["end_bricks"]
        put(W, x - 1, y + h, z - 1, x + w + 1, y + h + 1, z + w + 1, B["purpur_pillar"])
        W[x + w // 2, y + h + 2:y + h + 5, z + w // 2] = B["sea_lantern"]
    tower(104, 31, 112, 10, 34); tower(118, 31, 124, 8, 22); tower(36, 27, 136, 7, 18)
    for x in range(60, 100, 6):
        W[x, 21, 30] = B["obsidian"]; W[x, 22, 30] = B["obsidian"]
    bx = Boxes()
    adventurer(bx, 79.5, 21, 52.0, 0, "galaxy", item="sword", cape=(0.30, 0.85, 0.95))
    adventurer(bx, 86.0, 34, 66.0, 0, "mage", wings=True)
    adventurer(bx, 72.0, 40, 80.0, 0, "explorer", wings=True)
    sky = FlatSky((0.02, 0.0, 0.05), (0.10, 0.04, 0.18), (0.22, 0.10, 0.30), sun=(0.4, 0.6, 1.0), stars=1.2,
                  moons=[((0.35, 0.45, 1.0), 0.05, (0.85, 0.75, 1.0))])
    lights = gather_lights(W, limit=40)
    bg("end", W, (78, 23.8, 45), (88, 32, 120), sky, (1.1, 0.95, 1.3), (0.22, 0.18, 0.32), 0.003,
       boxes=bx, lights=lights, lr=14, hfov=115, vfov=50)


# ------------------------------------------------------------------ The Sift (bone desert under an alien sky)
def sift():
    X, Y, Z = 192, 80, 220
    W = np.zeros((X, Y, Z), np.uint8)
    n = vnoise((X, Z), 30, 31, 4); n2 = vnoise((X, Z), 10, 32, 2)
    for x in range(X):
        for z in range(Z):
            h = int(12 + n[x, z] * 10 + n2[x, z] * 2)
            W[x, :h, z] = B["sandstone"]
            W[x, h, z] = B["calcite"] if n2[x, z] > 0.62 else (B["red_sand"] if n[x, z] > 0.6 else B["sand"])
            if z < 40 and n2[x, z] > 0.45:
                W[x, h, z] = B["pale_grass"]
    def ribcage(cx, cz, length, height, rot=0):
        for i in range(0, length, 4):
            for a in range(0, 181, 6):
                t = math.radians(a)
                x = int(cx + math.cos(t) * height * 0.8) if not rot else int(cx + i)
                z = int(cz + i) if not rot else int(cz + math.cos(t) * height * 0.8)
                y = int(18 + math.sin(t) * height)
                if 0 <= x < X and 0 <= z < Z and y < Y:
                    W[x, y:y + 2, z] = B["bone"]
        for i in range(length):   # spine
            x, z = (cx, cz + i) if not rot else (cx + i, cz)
            if 0 <= x < X and 0 <= z < Z:
                W[x, 18 + height:20 + height, z] = B["bone"]
    ribcage(96, 110, 44, 26); ribcage(40, 150, 30, 18, rot=1); ribcage(150, 70, 20, 14)
    for _ in range(25):   # amethyst crystals
        x, z = rng.integers(10, 182), rng.integers(50, 210)
        h = np.nonzero(W[x, :, z])[0].max()
        put(W, x, h + 1, z, x, h + int(rng.integers(2, 6)), z, B["amethyst"])
    bx = Boxes()
    adventurer(bx, 94.5, ground(W, 94, 70, 40), 70.0, 0, "explorer", item="torch", cape=(0.9, 0.7, 0.3))
    adventurer(bx, 98.0, ground(W, 98, 66, 40), 66.0, 0, "mage", item="sword")
    sky = FlatSky((0.06, 0.10, 0.22), (0.25, 0.30, 0.55), (0.80, 0.62, 0.70), sun=(0.6, 0.3, 1.0), stars=0.4,
                  moons=[((-0.5, 0.35, 1.0), 0.09, (0.75, 0.95, 0.95)), ((0.2, 0.55, 1.0), 0.035, (1.0, 0.8, 0.9))])
    bg("sift", W, (95, ground(W, 95, 62, 40) + 3.8, 58), (96, 26, 160), sky, (2.2, 1.7, 1.5), (0.40, 0.38, 0.55), 0.0035, boxes=bx, hfov=120, vfov=48)


def ground(W, x, z, below=None):
    col = np.nonzero(W[int(x), :below, int(z)])[0] if below else np.nonzero(W[int(x), :, int(z)])[0]
    return int(col.max()) + 1 if col.size else 0


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for fn in (valley, trials, deepdark, lush, nether, end, sift):
        if ONLY and ONLY != fn.__name__:
            continue
        fn()
