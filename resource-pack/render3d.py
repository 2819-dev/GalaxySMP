# A small voxel ray tracer for the join screen art: real 3D Minecraft-style scenes (block textures, sun shadows,
# smooth-lighting corner shadows, glowing blocks, water reflections, blocky clouds, a sunset sky with a ringed planet).
#
#   python3 render3d.py <block texture folder> <output folder> [quick]
#
# Block textures come from Mojang's bedrock-samples (resource_pack/textures/blocks), downloaded into the folder first.
# Writes gsmp_title_bg.png (wide, pans behind the title screen) and gsmp_srv_<key>.png (server card pictures).
import math, os, sys
from multiprocessing import Pool
import numpy as np
from PIL import Image, ImageFilter

TEX = sys.argv[1] if len(sys.argv) > 1 else "blocks"
OUT = sys.argv[2] if len(sys.argv) > 2 else "out"
QUICK = len(sys.argv) > 3

# ---------------------------------------------------------------- blocks
GRASS = np.array([0.50, 0.76, 0.33]); OAK = np.array([0.36, 0.66, 0.22]); BIRCH = np.array([0.50, 0.66, 0.33])
SPRUCE = np.array([0.30, 0.48, 0.30]); WATER = np.array([0.20, 0.42, 0.78])
DEFS = [  # name, top, side, bottom, tint(top) / tint(all), cutout, emissive, water
    ("air", None, None, None, None, False, 0, False),
    ("grass", "grass_top", "grass_side_carried", "dirt", ("top", GRASS), False, 0, False),
    ("dirt", "dirt", "dirt", "dirt", None, False, 0, False),
    ("stone", "stone", "stone", "stone", None, False, 0, False),
    ("sand", "sand", "sand", "sand", None, False, 0, False),
    ("water", "water_still_grey", "water_still_grey", "water_still_grey", ("all", WATER), False, 0, True),
    ("log", "log_oak_top", "log_oak", "log_oak_top", None, False, 0, False),
    ("leaves", "leaves_oak", "leaves_oak", "leaves_oak", ("all", OAK), True, 0, False),
    ("planks", "planks_oak", "planks_oak", "planks_oak", None, False, 0, False),
    ("stonebrick", "stonebrick", "stonebrick", "stonebrick", None, False, 0, False),
    ("mossy", "stonebrick_mossy", "stonebrick_mossy", "stonebrick_mossy", None, False, 0, False),
    ("glowstone", "glowstone", "glowstone", "glowstone", None, False, 1.6, False),
    ("sea_lantern", "sea_lantern", "sea_lantern", "sea_lantern", None, False, 1.5, False),
    ("snow", "snow", "snow", "snow", None, False, 0, False),
    ("birch_log", "log_oak_top", "log_birch", "log_oak_top", None, False, 0, False),
    ("birch_leaves", "leaves_birch", "leaves_birch", "leaves_birch", ("all", BIRCH), True, 0, False),
    ("spruce_leaves", "leaves_spruce", "leaves_spruce", "leaves_spruce", ("all", SPRUCE), True, 0, False),
    ("gravel", "gravel", "gravel", "gravel", None, False, 0, False),
    ("cobble", "cobblestone", "cobblestone", "cobblestone", None, False, 0, False),
    ("brick", "brick", "brick", "brick", None, False, 0, False),
    ("red", "wool_colored_red", "wool_colored_red", "wool_colored_red", None, False, 0, False),
    ("blue", "wool_colored_blue", "wool_colored_blue", "wool_colored_blue", None, False, 0, False),
    ("lime", "wool_colored_lime", "wool_colored_lime", "wool_colored_lime", None, False, 0, False),
    ("yellow", "wool_colored_yellow", "wool_colored_yellow", "wool_colored_yellow", None, False, 0, False),
    ("magenta", "wool_colored_magenta", "wool_colored_magenta", "wool_colored_magenta", None, False, 0, False),
    ("lightblue", "wool_colored_light_blue", "wool_colored_light_blue", "wool_colored_light_blue", None, False, 0, False),
    ("white_c", "concrete_white", "concrete_white", "concrete_white", None, False, 0, False),
    ("orange_c", "concrete_orange", "concrete_orange", "concrete_orange", None, False, 0, False),
    ("cyan_c", "concrete_cyan", "concrete_cyan", "concrete_cyan", None, False, 0, False),
    ("purple_c", "concrete_purple", "concrete_purple", "concrete_purple", None, False, 0, False),
    ("quartz", "quartz_block_side", "quartz_block_side", "quartz_block_side", None, False, 0, False),
    ("obsidian", "obsidian", "obsidian", "obsidian", None, False, 0, False),
    ("end_stone", "end_stone", "end_stone", "end_stone", None, False, 0, False),
    ("purpur", "purpur_block", "purpur_block", "purpur_block", None, False, 0, False),
    ("portal", "purpur_block", "purpur_block", "purpur_block", ("all", np.array([0.9, 0.45, 1.0])), False, 2.2, False),
    ("lava", "lava_still", "lava_still", "lava_still", None, False, 1.4, False),
    ("glass", "glass", "glass", "glass", None, True, 0, False),
    ("deepslate", "deepslate_top", "deepslate_top", "deepslate_top", None, False, 0, False),
]
B = {d[0]: i for i, d in enumerate(DEFS)}


def load_tex(name):
    im = Image.open(os.path.join(TEX, name + ".png")).convert("RGBA")
    im = im.crop((0, 0, 16, 16))   # first frame of animated textures
    return np.asarray(im, dtype=np.float32) / 255.0


names, atlas = {}, []
FT = np.zeros((len(DEFS), 3), np.int32)   # block -> texture index for top / side / bottom
for bi, (n, top, side, bot, tint, cut, emit, water) in enumerate(DEFS):
    if top is None:
        continue
    for fi, tn in enumerate((top, side, bot)):
        key = (tn, str(tint), fi == 0)
        if key not in names:
            t = load_tex(tn).copy()
            if tint is not None and (tint[0] == "all" or (tint[0] == "top" and fi == 0)):
                t[..., :3] *= tint[1]
            if n == "grass" and fi == 1:
                pass   # the "carried" side texture is already green
            names[key] = len(atlas)
            atlas.append(t)
        FT[bi, fi] = names[key]
ATLAS = np.stack(atlas)
ATLAS[..., :3] = ATLAS[..., :3] ** 2.2   # to linear light
CUT = np.array([d[5] for d in DEFS]); EMIT = np.array([d[6] for d in DEFS], np.float32); ISW = np.array([d[7] for d in DEFS])
OPAQUE = np.array([i != 0 and not d[7] for i, d in enumerate(DEFS)])


# ---------------------------------------------------------------- noise
def vnoise(shape, scale, seed, octaves=4):
    rng = np.random.default_rng(seed)
    out = np.zeros(shape, np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        s = max(2, int(scale / (2 ** o)))
        g = rng.random((shape[0] // s + 3, shape[1] // s + 3)).astype(np.float32)
        im = Image.fromarray(g, mode="F").resize(((shape[1] // s + 3) * s, (shape[0] // s + 3) * s), Image.BICUBIC)
        out += amp * np.asarray(im)[: shape[0], : shape[1]]
        tot += amp
        amp *= 0.5
    return out / tot


# ---------------------------------------------------------------- tracing
def trace(o, d, W, max_steps, shadow=False):
    """Voxel DDA. Returns t, axis, block, cell, and the first water entry (t, cell) for each ray."""
    n = d.shape[0]
    X, Y, Z = W.shape
    cell = np.floor(o).astype(np.int32)
    step = np.where(d >= 0, 1, -1).astype(np.int32)
    inv = 1.0 / np.where(np.abs(d) < 1e-9, 1e-9, d)
    tmax = ((cell + (step > 0)) - o) * inv
    tdel = np.abs(inv)
    t_hit = np.full(n, np.inf, np.float32); axis_hit = np.zeros(n, np.int8); blk = np.zeros(n, np.int32)
    cell_hit = np.zeros((n, 3), np.int32)
    w_t = np.full(n, np.inf, np.float32)
    act = np.arange(n)
    for _ in range(max_steps):
        if act.size == 0:
            break
        tm = tmax[act]
        ax = np.argmin(tm, axis=1)
        tn = tm[np.arange(act.size), ax]
        c = cell[act]
        c[np.arange(act.size), ax] += step[act, ax]
        cell[act] = c
        tmax[act, ax] += tdel[act, ax]
        inb = (c[:, 0] >= 0) & (c[:, 0] < X) & (c[:, 1] >= 0) & (c[:, 1] < Y) & (c[:, 2] >= 0) & (c[:, 2] < Z)
        keep = inb.copy()
        idx = np.nonzero(inb)[0]
        b = W[c[idx, 0], c[idx, 1], c[idx, 2]]
        nz = b != 0
        idx, b = idx[nz], b[nz]
        if idx.size:
            water = ISW[b]
            if not shadow and water.any():
                wi = idx[water]
                first = np.isinf(w_t[act[wi]])
                w_t[act[wi[first]]] = tn[wi[first]]
            solid = ~water
            idx, b = idx[solid], b[solid]
            if idx.size:
                cut = CUT[b]
                ok = np.ones(idx.size, bool)
                if cut.any():
                    ci = np.nonzero(cut)[0]
                    a = act[idx[ci]]
                    p = o[a] + d[a] * tn[idx[ci], None]
                    u, v = uv(p, ax[idx[ci]])
                    face = np.where(ax[idx[ci]] == 1, 0, 1)
                    tx = FT[b[ci], face]
                    alpha = ATLAS[tx, (v * 16).astype(int) % 16, (u * 16).astype(int) % 16, 3]
                    ok[ci] = alpha > 0.5
                hits = idx[ok]
                a = act[hits]
                t_hit[a] = tn[hits]; axis_hit[a] = ax[hits]; blk[a] = b[ok]; cell_hit[a] = c[hits]
                keep[hits] = False
        act = act[keep]
    return t_hit, axis_hit, blk, cell_hit, w_t


def uv(p, ax):
    f = p - np.floor(p)
    u = np.where(ax == 0, f[:, 2], f[:, 0])
    v = np.where(ax == 1, f[:, 2], 1 - f[:, 1])
    return np.clip(u, 0, 0.9999), np.clip(v, 0, 0.9999)


# ---------------------------------------------------------------- sky
class Sky:
    def __init__(self, sun, night=0.0, planet=True, fireworks=False, day=False):
        self.sun = sun / np.linalg.norm(sun)
        self.night, self.planet, self.fireworks, self.day = night, planet, fireworks, day
        self.pdir = np.array([0.62, 0.30, 0.72]); self.pdir /= np.linalg.norm(self.pdir)

    def __call__(self, d, bare=False):
        e = np.clip(d[:, 1], -1, 1)
        if self.day:
            top, mid, hor = np.array([0.05, 0.16, 0.55]), np.array([0.16, 0.34, 0.72]), np.array([0.45, 0.6, 0.85])
        else:
            top, mid, hor = np.array([0.015, 0.02, 0.08]), np.array([0.09, 0.06, 0.26]), np.array([0.85, 0.36, 0.22])
        hor = hor + (np.array([0.16, 0.08, 0.30]) - hor) * min(1.0, self.night * 1.1)
        k = np.clip(e, 0, 1)[:, None]
        col = np.where(k < 0.18, hor + (mid - hor) * (k / 0.18), mid + (top - mid) * np.clip((k - 0.18) / 0.6, 0, 1))
        col = np.where(e[:, None] < 0, (mid * 0.7 if self.day else hor * 0.55), col)
        sd = np.clip(d @ self.sun, 0, 1)
        if not self.day:
            warm = np.array([1.0, 0.55, 0.25]) * (1 - self.night)
            col = col + warm * (sd ** 8 * 0.55 + sd ** 90 * 0.9)[:, None] * np.clip(1.2 - k * 2.5, 0, 1)
            if bare:
                return col
            col = col + np.array([1.0, 0.85, 0.6]) * (sd > 0.9994)[:, None] * 3 * (1 - self.night)
            # stars and a soft galaxy band
            q = np.floor(d * 340).astype(np.int64)
            h = (q[:, 0] * 73856093 ^ q[:, 1] * 19349663 ^ q[:, 2] * 83492791) & 0xFFFF
            star = (h < 60) * np.clip((e - 0.12) * 3, 0, 1) * (0.5 + 0.5 * ((h % 7) / 6))
            col = col + star[:, None] * np.array([1.0, 0.95, 0.9]) * (0.6 + self.night)
            band = np.exp(-((d @ np.array([0.3, 0.6, -0.74])) ** 2) / 0.02)
            col = col + band[:, None] * np.array([0.35, 0.18, 0.55]) * 0.18 * np.clip(e * 3, 0, 1)[:, None]
        else:
            col = col + np.array([1.0, 0.95, 0.8]) * (sd ** 32 * 0.4)[:, None]
            if bare:
                return col
            col = col + np.array([1.0, 0.95, 0.8]) * ((sd > 0.9995) * 4)[:, None]
        if self.planet:
            pd = self.pdir
            cosang = d @ pd
            right = np.cross(pd, [0, 1, 0]); right /= np.linalg.norm(right)
            up = np.cross(right, pd)
            pu, pv = (d @ right) / np.maximum(cosang, 1e-3), (d @ up) / np.maximum(cosang, 1e-3)
            r = 0.085
            disk = (pu ** 2 + pv ** 2 < r * r) & (cosang > 0)
            nz = np.sqrt(np.clip(1 - (pu ** 2 + pv ** 2) / (r * r), 0, 1))
            lit = np.clip(0.25 + 0.9 * (-pu / r * 0.6 + pv / r * 0.3 + nz * 0.5), 0, 1.4)
            bands = 0.85 + 0.15 * np.sin(pv / r * 18)
            pcol = np.array([0.45, 0.62, 1.0])[None] * (lit * bands)[:, None]
            # ring (tilted ellipse), drawn behind the top half of the planet and in front of the bottom half
            ru, rv = pu * 0.95 + pv * 0.31, -pu * 0.31 + pv * 0.95
            ell = np.sqrt((ru / (r * 2.1)) ** 2 + (rv / (r * 0.42)) ** 2)
            ring = (ell > 0.78) & (ell < 1.0) & (cosang > 0)
            front = rv < 0
            col = np.where((ring & ~front & ~disk)[:, None], col * 0.4 + np.array([0.9, 0.85, 1.0]) * 0.55, col)
            col = np.where(disk[:, None], pcol, col)
            col = np.where((ring & front)[:, None], col * 0.35 + np.array([0.95, 0.9, 1.0]) * 0.6, col)
            glow = np.exp(-np.clip((pu ** 2 + pv ** 2) / (r * r) - 1, 0, None) * 3) * (cosang > 0) * ~disk
            col = col + glow[:, None] * np.array([0.2, 0.3, 0.7]) * 0.35
        if self.fireworks:
            for fd, fc in ((np.array([-0.3, 0.45, 0.85]), (1.0, 0.3, 0.5)), (np.array([0.25, 0.55, 0.8]), (1.0, 0.85, 0.3)),
                           (np.array([0.0, 0.35, 0.93]), (0.3, 0.9, 1.0)), (np.array([0.45, 0.38, 0.8]), (0.75, 0.4, 1.0))):
                fd = fd / np.linalg.norm(fd)
                ang = np.arccos(np.clip(d @ fd, -1, 1))
                spokes = np.abs(np.sin(np.arctan2(d @ np.cross(fd, [0, 1, 0]), d[:, 1]) * 12))
                shell = np.exp(-((ang - 0.07) ** 2) / 0.0004) * (spokes > 0.6) + np.exp(-(ang ** 2) / 0.0006) * 0.6
                col = col + shell[:, None] * np.array(fc) * 2.2
        return col


_CLOUDS = None


def clouds(o, d, sky, t_scene, height=150):
    """Minecraft-style flat blocky clouds: 12-block cells from a noise map."""
    global _CLOUDS
    if _CLOUDS is None:
        _CLOUDS = vnoise((256, 256), 18, 77, 3) > 0.56
    up = d[:, 1] > 0.02
    t = np.where(up, (height - o[1]) / np.maximum(d[:, 1], 1e-3), np.inf)
    p = o + d * np.where(np.isfinite(t), t, 0)[:, None]
    cx = (np.floor(p[:, 0] / 12).astype(np.int64)) % 256
    cz = (np.floor(p[:, 2] / 12).astype(np.int64)) % 256
    is_c = up & _CLOUDS[cx, cz] & (t < t_scene) & (t < 1600)
    return np.clip(1 - t / 1600, 0, 1) ** 0.7 * 0.6 * is_c


# ---------------------------------------------------------------- shading
def shade(o, d, W, sky, sun_col, amb_col, fog_density, max_steps):
    n = d.shape[0]
    O = np.broadcast_to(o, (n, 3)).astype(np.float32)
    t, ax, b, c, wt = trace(O, d, W, max_steps)
    hit = np.isfinite(t)
    col = sky(d)
    if hit.any():
        hi = np.nonzero(hit)[0]
        p = O[hi] + d[hi] * t[hi, None]
        u, v = uv(p, ax[hi])
        sgn = np.where(d[hi, ax[hi]] > 0, -1, 1)
        face = np.where(ax[hi] == 1, np.where(sgn > 0, 0, 2), 1)
        tx = FT[b[hi], face]
        alb = ATLAS[tx, (v * 16).astype(int), (u * 16).astype(int), :3]
        nrm = np.zeros((hi.size, 3), np.float32); nrm[np.arange(hi.size), ax[hi]] = sgn
        # sun shadows
        ndl = np.clip(nrm @ sky.sun, 0, 1)
        lit = ndl > 0
        vis = np.zeros(hi.size, np.float32)
        if lit.any():
            li = np.nonzero(lit)[0]
            so = p[li] + nrm[li] * 0.002
            st, *_ = trace(so, np.broadcast_to(sky.sun, (li.size, 3)).astype(np.float32), W, 160, shadow=True)
            vis[li] = ~np.isfinite(st)
        # smooth-lighting corner shadows
        a = c[hi] + nrm.astype(np.int32)
        ao = np.zeros(hi.size, np.float32)
        f = p - np.floor(p)
        for t1 in range(3):
            m = ax[hi] != t1
            e = np.zeros(3, np.int32); e[t1] = 1
            fr = f[:, t1]
            for sgn2, w in ((1, fr), (-1, 1 - fr)):
                q = a + e * sgn2
                inside = (q >= 0).all(1) & (q[:, 0] < W.shape[0]) & (q[:, 1] < W.shape[1]) & (q[:, 2] < W.shape[2])
                s = np.zeros(hi.size, bool)
                s[inside] = OPAQUE[W[q[inside, 0], q[inside, 1], q[inside, 2]]]
                ao += m * s * np.clip(w - 0.35, 0, 1) ** 1.5 * 1.6
        ao = 1 - np.clip(ao, 0, 1) * 0.55
        sky_amb = amb_col * (0.75 + 0.25 * np.clip(nrm[:, 1], 0, 1))[:, None]
        light = sky_amb * ao[:, None] + sun_col * (ndl * vis)[:, None]
        shaded = alb * light + alb * EMIT[b[hi], None] * 1.6
        # fog toward the horizon colour
        fog = 1 - np.exp(-t[hi] * fog_density)
        hz = d[hi].copy(); hz[:, 1] = np.abs(hz[:, 1]) * 0.15 + 0.02
        hz /= np.linalg.norm(hz, axis=1, keepdims=True)
        col[hi] = shaded * (1 - fog[:, None]) + sky(hz, bare=True) * fog[:, None]
    # water surface: sky reflection, sun glint, see-through to the bottom
    wm = np.isfinite(wt) & (wt < t)
    if wm.any():
        wi = np.nonzero(wm)[0]
        cosi = np.clip(-d[wi, 1], 0, 1)
        fres = 0.04 + 0.96 * (1 - cosi) ** 5
        r = d[wi].copy(); r[:, 1] = -r[:, 1]
        p = O[wi] + d[wi] * wt[wi, None]
        wob = 0.012 * np.sin(p[:, 0] * 1.7 + p[:, 2] * 0.9) + 0.012 * np.sin(p[:, 2] * 2.3)
        r[:, 0] += wob; r /= np.linalg.norm(r, axis=1, keepdims=True)
        refl = sky(r) + np.clip(r @ sky.sun, 0, 1)[:, None] ** 900 * 3 * sun_col
        depth = np.where(np.isfinite(t[wi]), t[wi] - wt[wi], 20)
        under = col[wi] * np.exp(-depth * 0.18)[:, None] + WATER[None] * 0.25 * amb_col * (1 - np.exp(-depth * 0.18))[:, None]
        wcol = under * (1 - fres[:, None]) + refl * fres[:, None] * 0.9
        fog = 1 - np.exp(-wt[wi] * fog_density)
        hz = d[wi].copy(); hz[:, 1] = 0.03; hz /= np.linalg.norm(hz, axis=1, keepdims=True)
        col[wi] = wcol * (1 - fog[:, None]) + sky(hz, bare=True) * fog[:, None]
    ca = clouds(o, d, sky, t)
    ccol = (amb_col * 0.9 + sun_col * 0.6) * np.array([1.0, 0.92, 0.95])
    col = col * (1 - ca[:, None]) + ccol * ca[:, None]
    return col


def camera_rays(w, h, o, look, hfov, vfov, cylindrical=True):
    fwd = look - o; fwd = fwd / np.linalg.norm(fwd)
    yaw = math.atan2(fwd[0], fwd[2]); pitch = math.asin(fwd[1])
    xs = (np.arange(w) + 0.5) / w - 0.5
    ys = 0.5 - (np.arange(h) + 0.5) / h
    if cylindrical:
        az = yaw + xs * math.radians(hfov)
        el = pitch + ys * math.radians(vfov)
        AZ, EL = np.meshgrid(az, el)
        d = np.stack([np.sin(AZ) * np.cos(EL), np.sin(EL), np.cos(AZ) * np.cos(EL)], -1)
    else:
        right = np.cross([0, 1, 0], fwd); right /= np.linalg.norm(right)
        up = np.cross(fwd, right)
        tx, ty = math.tan(math.radians(hfov) / 2), math.tan(math.radians(vfov) / 2)
        X_, Y_ = np.meshgrid(xs * 2 * tx, ys * 2 * ty)
        d = fwd + X_[..., None] * right + Y_[..., None] * up
        d /= np.linalg.norm(d, axis=-1, keepdims=True)
    return d.reshape(-1, 3).astype(np.float32)


_JOB = {}


def _work(rows):
    j = _JOB
    d = j["d"][rows[0] * j["w"]: rows[1] * j["w"]]
    return shade(j["o"], d, j["W"], j["sky"], j["sun"], j["amb"], j["fog"], j["steps"])


def render(W, o, look, size, hfov, vfov, sky, sun_col, amb_col, fog=0.004, steps=420, cylindrical=False, ss=2):
    w, h = size[0] * ss, size[1] * ss
    d = camera_rays(w, h, np.array(o, np.float32), np.array(look, np.float32), hfov, vfov, cylindrical)
    _JOB.update(d=d, w=w, o=np.array(o, np.float32), W=W, sky=sky, sun=np.array(sun_col), amb=np.array(amb_col), fog=fog, steps=steps)
    chunks = [(r, min(h, r + 24)) for r in range(0, h, 24)]
    with Pool(os.cpu_count()) as pool:
        parts = pool.map(_work, chunks)
    img = np.concatenate(parts).reshape(h, w, 3)
    return post(img, size)


def post(img, size):
    # bloom from bright pixels, filmic tone curve, gentle vignette
    bright = np.clip(img - 1.1, 0, None)
    bl = Image.fromarray(np.clip(bright * 80, 0, 255).astype(np.uint8))
    blur = np.asarray(bl.filter(ImageFilter.GaussianBlur(img.shape[1] / 90)), np.float32) / 80
    img = img + blur * 0.6
    a, b_, c, d_, e = 2.51, 0.03, 2.43, 0.59, 0.14
    img = np.clip((img * (a * img + b_)) / (img * (c * img + d_) + e), 0, 1) ** (1 / 2.2)
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    vig = 1 - 0.28 * (((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) ** 1.4
    img = img * vig[..., None]
    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    return out.resize(size, Image.LANCZOS)


# ---------------------------------------------------------------- worlds
def put(W, x0, y0, z0, x1, y1, z1, b):
    W[max(0, x0):x1 + 1, max(0, y0):y1 + 1, max(0, z0):z1 + 1] = b


def tree(W, x, y, z, kind, rng):
    X, Y, Z = W.shape
    if kind == "spruce":
        hgt = rng.integers(7, 11)
        put(W, x, y, z, x, y + hgt, z, B["log"])
        for i in range(hgt - 1, 1, -1):
            r = 1 + (hgt - i) // 3 if i % 2 == 0 else max(1, (hgt - i) // 3)
            for dx in range(-r, r + 1):
                for dz in range(-r, r + 1):
                    if abs(dx) + abs(dz) <= r + 0.5 and 0 <= x + dx < X and 0 <= z + dz < Z and W[x + dx, y + i, z + dz] == 0:
                        W[x + dx, y + i, z + dz] = B["spruce_leaves"]
        W[x, y + hgt + 1, z] = B["spruce_leaves"]
        return
    log, leaf = (B["birch_log"], B["birch_leaves"]) if kind == "birch" else (B["log"], B["leaves"])
    hgt = rng.integers(4, 7)
    put(W, x, y, z, x, y + hgt - 1, z, log)
    for dy in range(hgt - 3, hgt + 2):
        r = 2 if dy < hgt else 1
        for dx in range(-r, r + 1):
            for dz in range(-r, r + 1):
                if abs(dx) == r and abs(dz) == r and (dy >= hgt or rng.random() < 0.5):
                    continue
                xx, yy, zz = x + dx, y + dy, z + dz
                if 0 <= xx < X and 0 <= zz < Z and yy < Y and W[xx, yy, zz] == 0:
                    W[xx, yy, zz] = leaf


def galaxy_world():
    """A valley at sunset: GalaxySMP spawn (a tower, houses, a glowing portal) on a plateau above a lake, forests,
    and snowy mountains behind."""
    X, Y, Z = 384, 144, 448
    rng = np.random.default_rng(42)
    W = np.zeros((X, Y, Z), np.uint8)
    n1 = vnoise((X, Z), 64, 1, 5); n2 = vnoise((X, Z), 24, 2, 3); ridge = 1 - np.abs(vnoise((X, Z), 96, 3, 5) * 2 - 1)
    xx, zz = np.mgrid[0:X, 0:Z]
    far = np.clip((zz - 200) / 140, 0, 1) ** 1.3
    side = np.clip((np.abs(xx - 192) - 120) / 60, 0, 1)
    h = 30 + n1 * 14 + n2 * 4 + (far + side * 0.7) * (ridge ** 2.5) * 88 + far * 10
    # lake in the valley, spawn plateau in front of it
    lake = np.exp(-(((xx - 150) / 46) ** 2 + ((zz - 175) / 30) ** 2))
    h = h - lake * 16
    hub = np.sqrt((xx - 200.0) ** 2 + (zz - 120.0) ** 2)
    h = np.where(hub < 26, 40, np.where(hub < 40, h + (40 - h) * (1 - (hub - 26) / 14), h))
    h = np.clip(h, 4, Y - 6).astype(np.int32)
    SEA = 31
    for x in range(X):
        for z in range(Z):
            hh = h[x, z]
            W[x, :hh - 4, z] = B["stone"]
            slope = abs(int(h[min(x + 1, X - 1), z]) - hh) + abs(int(h[x, min(z + 1, Z - 1)]) - hh)
            if hh > 92:
                W[x, hh - 4:hh, z] = B["stone"]; W[x, hh, z] = B["snow"]
            elif slope > 3 and hh > 50:
                W[x, hh - 4:hh + 1, z] = B["stone"]
            elif hh <= SEA + 1:
                W[x, hh - 4:hh + 1, z] = B["sand"]
            else:
                W[x, hh - 4:hh, z] = B["dirt"]; W[x, hh, z] = B["grass"]
            if hh < SEA:
                W[x, hh + 1:SEA + 1, z] = B["water"]
    # forests
    dens = vnoise((X, Z), 40, 9, 3)
    for _ in range(5200):
        x, z = rng.integers(3, X - 3), rng.integers(3, Z - 3)
        hh = h[x, z]
        if W[x, hh, z] != B["grass"] and not (W[x, hh, z] == B["stone"] and 60 < hh < 90):
            continue
        if hub[x, z] < 44 or dens[x, z] < 0.45:
            continue
        kind = "spruce" if hh > 52 else ("birch" if rng.random() < 0.25 else "oak")
        tree(W, x, hh + 1, z, kind, rng)
    build_spawn(W, 200, 41, 120)
    return W


def build_spawn(W, cx, y, cz):
    # plaza
    for x in range(cx - 25, cx + 26):
        for z in range(cz - 25, cz + 26):
            r = math.hypot(x - cx, z - cz)
            if r < 25:
                W[x, y:y + 20, z] = 0
                W[x, y - 1, z] = B["stonebrick"] if (int(r) % 6) else B["mossy"]
                if r > 23.5:
                    W[x, y, z] = B["stonebrick"]
    # paths
    for i in range(25, 60):
        for w in range(-1, 2):
            for (x, z) in ((cx + w, cz - i), (cx + i, cz + w), (cx - i, cz + w)):
                if 0 <= x < W.shape[0] and 0 <= z < W.shape[2]:
                    col = W[x, :, z]
                    top = np.nonzero(col)[0]
                    if top.size and W[x, top.max(), z] in (B["grass"], B["dirt"]):
                        W[x, top.max(), z] = B["gravel"]
    # central tower
    put(W, cx - 4, y, cz - 4, cx + 4, y + 30, cz + 4, B["stonebrick"])
    put(W, cx - 3, y + 1, cz - 3, cx + 3, y + 30, cz + 3, 0)
    for yy in range(y + 4, y + 30, 6):
        for (x, z) in ((cx, cz - 4), (cx, cz + 4), (cx - 4, cz), (cx + 4, cz)):
            W[x, yy:yy + 2, z] = B["sea_lantern"]
    put(W, cx - 5, y + 31, cz - 5, cx + 5, y + 31, cz + 5, B["stonebrick"])
    for x in range(cx - 5, cx + 6, 2):
        W[x, y + 32, cz - 5] = W[x, y + 32, cz + 5] = B["stonebrick"]
    for z in range(cz - 5, cz + 6, 2):
        W[cx - 5, y + 32, z] = W[cx + 5, y + 32, z] = B["stonebrick"]
    put(W, cx - 1, y + 32, cz - 1, cx + 1, y + 34, cz + 1, B["glowstone"])
    put(W, cx, y + 35, cz, cx, y + 37, cz, B["sea_lantern"])
    # houses around the plaza
    for (hx, hz, wid, dep) in ((cx - 18, cz - 8, 8, 9), (cx + 11, cz - 9, 8, 8), (cx - 17, cz + 9, 8, 7), (cx + 11, cz + 10, 7, 8)):
        put(W, hx, y, hz, hx + wid, y + 5, hz + dep, B["planks"])
        put(W, hx + 1, y, hz + 1, hx + wid - 1, y + 5, hz + dep - 1, 0)
        for corner in ((hx, hz), (hx + wid, hz), (hx, hz + dep), (hx + wid, hz + dep)):
            W[corner[0], y:y + 6, corner[1]] = B["log"]
        for i in range(0, (min(wid, dep)) // 2 + 2):
            put(W, hx - 1 + i, y + 6 + i, hz - 1 + i, hx + wid + 1 - i, y + 6 + i, hz + dep + 1 - i, B["brick"])
        for wx in range(hx + 2, hx + wid - 1, 3):
            W[wx, y + 2:y + 4, hz] = B["glowstone"]; W[wx, y + 2:y + 4, hz + dep] = B["glowstone"]
        for wz in range(hz + 2, hz + dep - 1, 3):
            W[hx, y + 2:y + 4, wz] = B["glowstone"]; W[hx + wid, y + 2:y + 4, wz] = B["glowstone"]
    # the Galaxy portal (front of the plaza)
    px, pz = cx, cz - 17
    put(W, px - 4, y, pz, px + 4, y + 9, pz, B["obsidian"])
    put(W, px - 3, y + 1, pz, px + 3, y + 8, pz, B["portal"])
    for a in range(0, 360, 30):   # lanterns around the plaza edge
        x, z = int(cx + math.cos(math.radians(a)) * 22), int(cz + math.sin(math.radians(a)) * 22)
        W[x, y:y + 2, z] = B["log"]; W[x, y + 2, z] = B["glowstone"]


def bedwars_world():
    X, Y, Z = 160, 64, 160
    W = np.zeros((X, Y, Z), np.uint8)
    def island(cx, cz, r, col):
        for x in range(cx - r, cx + r + 1):
            for z in range(cz - r, cz + r + 1):
                if (x - cx) ** 2 + (z - cz) ** 2 <= r * r:
                    depth = int(3 + (r - math.hypot(x - cx, z - cz)) * 0.6)
                    W[x, 30 - depth:30, z] = B["stone"]; W[x, 30, z] = B["grass"] if col != "mid" else B["end_stone"]
        if col != "mid":
            W[cx, 31, cz:cz + 2] = B[col]
            put(W, cx + 3, 31, cz - 2, cx + 4, 33, cz - 1, B[col])
    island(50, 80, 9, "red"); island(110, 80, 9, "blue"); island(80, 50, 10, "mid"); island(80, 112, 7, "lime")
    put(W, 59, 30, 80, 70, 30, 80, B["white_c"]); put(W, 89, 30, 80, 101, 30, 80, B["white_c"])
    put(W, 78, 31, 48, 82, 34, 52, B["obsidian"]); put(W, 79, 35, 49, 81, 36, 51, B["glowstone"])
    return W


def parkour_world():
    X, Y, Z = 128, 72, 160
    W = np.zeros((X, Y, Z), np.uint8)
    rng = np.random.default_rng(5)
    cols = [B[c] for c in ("red", "yellow", "lime", "lightblue", "magenta", "blue")]
    x, y, z = 64, 20, 30
    for i in range(34):
        put(W, x, y, z, x + 1, y, z + 1, cols[i % 6])
        x += int(rng.integers(-2, 3)); z += int(rng.integers(3, 5)); y += int(rng.integers(0, 2))
        x = int(np.clip(x, 20, 106))
    put(W, x - 2, y + 1, z - 2, x + 2, y + 1, z + 2, B["quartz"]); put(W, x, y + 2, z, x, y + 6, z, B["quartz"]); W[x, y + 7, z] = B["glowstone"]
    return W


def build_world():
    X, Y, Z = 160, 64, 160
    W = np.zeros((X, Y, Z), np.uint8)
    W[:, :20, :] = B["dirt"]; W[:, 20, :] = B["grass"]
    rng = np.random.default_rng(3)
    for (x, z, w, d_, hgt, c) in ((50, 70, 12, 12, 26, "white_c"), (70, 60, 9, 9, 18, "cyan_c"), (88, 74, 11, 10, 30, "purple_c"), (64, 88, 10, 8, 12, "orange_c")):
        put(W, x, 21, z, x + w, 21 + hgt, z + d_, B[c])
        for yy in range(24, 21 + hgt, 4):
            put(W, x, yy, z, x + w, yy, z, B["glass"]) if False else None
            W[x:x + w + 1:2, yy, z] = B["glowstone"]
    for _ in range(40):
        tree(W, int(rng.integers(10, 150)), 21, int(rng.integers(100, 150)), "oak", rng)
    put(W, 40, 21, 40, 120, 21, 44, B["gravel"])
    return W


# ---------------------------------------------------------------- go
if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    ss = 1 if QUICK else 2
    W = galaxy_world()
    sun = np.array([-0.75, 0.13, 1.0])
    golden = dict(sun_col=(2.6, 1.5, 0.85), amb_col=(0.34, 0.32, 0.55))
    # title screen background: a wide panorama across the valley toward the sunset
    bg = render(W, (196, 74, 34), (176, 52, 230), (1280, 480) if QUICK else (2048, 768), 150, 56, Sky(sun), golden["sun_col"], golden["amb_col"],
                fog=0.0016, steps=560, cylindrical=True, ss=ss)
    bg.save(os.path.join(OUT, "gsmp_title_bg.png"))
    print("title background done")
    card = (384, 216)
    render(W, (232, 66, 78), (196, 48, 124), card, 64, 36, Sky(sun), golden["sun_col"], golden["amb_col"], fog=0.0015, ss=ss).save(os.path.join(OUT, "gsmp_srv_galaxysmp.png"))
    night = Sky(np.array([0.3, -0.05, 1.0]), night=1.0, fireworks=True)
    render(W, (176, 50, 66), (204, 60, 124), card, 70, 40, night, (0.05, 0.05, 0.1), (0.12, 0.14, 0.32), fog=0.002, ss=ss).save(os.path.join(OUT, "gsmp_srv_event.png"))
    render(bedwars_world(), (80, 44, 30), (80, 30, 76), card, 70, 40, Sky(np.array([0.6, 0.2, 0.8]), night=0.85), (2.0, 1.5, 1.2), (0.30, 0.28, 0.55), fog=0.0008, ss=ss).save(os.path.join(OUT, "gsmp_srv_bedwars.png"))
    render(parkour_world(), (46, 27, 16), (66, 30, 52), card, 70, 40, Sky(np.array([0.5, 0.6, 0.4]), planet=False, day=True), (2.0, 1.85, 1.6), (0.45, 0.52, 0.75), fog=0.0008, ss=ss).save(os.path.join(OUT, "gsmp_srv_parkour.png"))
    render(build_world(), (34, 38, 30), (74, 40, 76), card, 70, 40, Sky(np.array([-0.6, 0.35, 0.7]), planet=False, day=True), (2.2, 1.9, 1.6), (0.42, 0.48, 0.72), fog=0.0012, ss=ss).save(os.path.join(OUT, "gsmp_srv_build.png"))
    print("server pictures done")
