"""Map colours for blocks from add-ons (custom blocks), for galaxymc.us/map.

Vanilla blocks have a ready-made colour table (mapcolors.json). A block that comes from an add-on installed on the server
(capsula_amatista, logo_3_0, weapon_stand...) isn't in it, so it used to be drawn as grey stone. Now the plugin finds the
block's own picture in the add-on packs on the server (its behavior pack says which texture it uses, the resource pack
says where that picture is), averages the top of it and snaps that to the nearest map colour, exactly how the vanilla table
was made, so everything on the map has the same look. The answer is remembered, so each block is looked up only once.

It runs on a background thread (reading packs and pictures takes a moment) and uses only the standard library.
"""
import json
import re
import struct
import threading
import time
import zlib
from pathlib import Path

CONFIG_KEY = "map_addon_colors"
MAX_JSON = 2_000_000
MAX_BLOCK_FILES = 6000
MAX_PIXEL_BYTES = 8_000_000
BATCH_WAIT = 3.0                      # seconds to gather the blocks seen together before looking them up
SHADES = (1.0, 220 / 255, 180 / 255, 135 / 255)   # how Minecraft draws each map colour (light to dark)
PREFER = ("up", "*", "side", "north", "south", "east", "west", "down")


# ---------- reading a PNG picture (no Pillow on a Minecraft server) ----------
def png_average(data):
    """The average colour (r, g, b) of the top of a PNG picture (an animated strip counts as its first frame), weighted by
    how solid each pixel is. None if it isn't a PNG we can read, or it is see-through everywhere."""
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    pos, idat, plte, trns, hdr = 8, [], b"", b"", None
    while pos + 8 <= len(data):
        n, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if kind == b"IHDR" and len(body) >= 13:
            hdr = struct.unpack(">IIBBBBB", body[:13])
        elif kind == b"PLTE":
            plte = body
        elif kind == b"tRNS":
            trns = body
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
    if not hdr or not idat:
        return None
    w, h, depth, ctype, comp, filt, interlace = hdr
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(ctype)
    if interlace or comp or filt or not channels or not (1 <= w <= 1024) or h < 1 or depth not in (1, 2, 4, 8, 16):
        return None
    if (ctype in (2, 4, 6) and depth < 8) or (ctype == 3 and depth == 16):
        return None
    rows_wanted = min(h, w)
    bits = depth * channels
    stride = (w * bits + 7) // 8
    bpp = max(1, bits // 8)
    if stride * rows_wanted > MAX_PIXEL_BYTES:
        return None
    want = (stride + 1) * rows_wanted
    try:
        raw = zlib.decompressobj().decompress(b"".join(idat), want)   # never more than the rows we use
    except zlib.error:
        return None
    if len(raw) < want:
        return None
    rows, prev, p = [], bytearray(stride), 0
    for _ in range(rows_wanted):
        f = raw[p]
        line = bytearray(raw[p + 1:p + 1 + stride])
        p += 1 + stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            line = bytearray((a + b) & 255 for a, b in zip(line, prev))
        elif f == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        elif f != 0:
            return None
        rows.append(line)
        prev = line
    sr = sg = sb = total = 0
    mask = (1 << depth) - 1
    step = 2 if depth == 16 else 1
    for line in rows:
        for x in range(w):
            if ctype == 6:
                i = x * 4 * step
                r, g, b, a = line[i], line[i + step], line[i + 2 * step], line[i + 3 * step]
            elif ctype == 2:
                i = x * 3 * step
                r, g, b, a = line[i], line[i + step], line[i + 2 * step], 255
            elif ctype == 4:
                i = x * 2 * step
                r = g = b = line[i]
                a = line[i + step]
            elif ctype == 0:
                if depth >= 8:
                    r = line[x * step]
                else:
                    r = ((line[(x * depth) // 8] >> (8 - depth - (x * depth) % 8)) & mask) * 255 // mask
                g = b = r
                a = 255
            else:   # palette
                idx = line[x] if depth == 8 else (line[(x * depth) // 8] >> (8 - depth - (x * depth) % 8)) & mask
                if idx * 3 + 2 >= len(plte):
                    continue
                r, g, b = plte[idx * 3], plte[idx * 3 + 1], plte[idx * 3 + 2]
                a = trns[idx] if idx < len(trns) else 255
            if a < 8:
                continue
            sr += r * a
            sg += g * a
            sb += b * a
            total += a
    if total == 0:
        return None
    return sr / total, sg / total, sb / total


def nearest_map_colour(c, palette):
    """The map colour (r, g, b) a paper map would use for something this colour (any of its four shades can match)."""
    r, g, b = c
    best, best_e = None, None
    for key, v in palette.items():
        if key in ("fire", "water"):   # bright red is only for fire and TNT; water gets its own depth shading
            continue
        for f in SHADES:
            x = (v[0] * f, v[1] * f, v[2] * f)
            rm = (r + x[0]) / 2
            e = (2 + rm / 256) * (r - x[0]) ** 2 + 4 * (g - x[1]) ** 2 + (2 + (255 - rm) / 256) * (b - x[2]) ** 2
            if best_e is None or e < best_e:
                best, best_e = tuple(v), e
    return best


# ---------- finding the pictures in the packs ----------
def load_json(path):
    try:
        if path.stat().st_size > MAX_JSON:
            return None
        text = path.read_text("utf-8-sig", errors="ignore")
        try:
            return json.loads(text)
        except ValueError:
            return json.loads(re.sub(r"^\s*//.*$", "", text, flags=re.M))
    except Exception:
        return None


def pack_folders(root, level, kind):
    """Every pack folder of this kind ("resource" or "behavior") the server could be using."""
    out = []
    for base in (Path(root) / f"{kind}_packs", Path(root) / f"development_{kind}_packs", Path(level) / f"{kind}_packs"):
        try:
            if base.is_dir():
                out += [p for p in sorted(base.iterdir()) if p.is_dir()]
        except Exception:
            continue
    return out


def ordered_keys(textures):
    """Texture names from a block's face list ({"up": ..., "*": ...}) or a plain name, best face for a map (the top) first."""
    if isinstance(textures, str):
        return [textures]
    if not isinstance(textures, dict):
        return []
    keys = []
    for face in list(PREFER) + [f for f in textures if f not in PREFER]:
        v = textures.get(face)
        t = v.get("texture") if isinstance(v, dict) else v
        if isinstance(t, str) and t not in keys:
            keys.append(t)
    return keys


def first_path(entry):
    t = entry.get("textures") if isinstance(entry, dict) else entry
    if isinstance(t, list):
        t = t[0] if t else None
    if isinstance(t, dict):
        t = t.get("path")
    return t if isinstance(t, str) else None


def build_index(root, level):
    """What the packs say: texture name -> picture path, block id -> its texture names (new add-ons say it in the block's own
    file, older ones in the resource pack's blocks.json)."""
    textures, legacy, blocks = {}, {}, {}
    resource = pack_folders(root, level, "resource")
    for pack in resource:
        terrain = load_json(pack / "textures" / "terrain_texture.json")
        for key, entry in ((terrain or {}).get("texture_data") or {}).items():
            path = first_path(entry)
            if path:
                textures.setdefault(key, path)
        old = load_json(pack / "blocks.json")
        for ident, entry in (old or {}).items():
            if isinstance(entry, dict):
                keys = ordered_keys(entry.get("textures"))
                if keys:
                    legacy.setdefault(ident, keys)
    seen = 0
    for pack in pack_folders(root, level, "behavior"):
        folder = pack / "blocks"
        if not folder.is_dir():
            continue
        for path in folder.rglob("*.json"):
            seen += 1
            if seen > MAX_BLOCK_FILES:
                break
            block = (load_json(path) or {}).get("minecraft:block")
            ident = ((block or {}).get("description") or {}).get("identifier")
            if not ident:
                continue
            parts = [(block.get("components") or {})] + [(p.get("components") or {}) for p in (block.get("permutations") or []) if isinstance(p, dict)]
            keys = []
            for comp in parts:
                keys += [k for k in ordered_keys(comp.get("minecraft:material_instances")) if k not in keys]
            if keys:
                blocks.setdefault(ident, keys)
    return {"textures": textures, "legacy": legacy, "blocks": blocks, "resource": resource}


def resolve(index, block_id):
    """-> ((r, g, b) average, None) or (None, why not)."""
    name = block_id.split(":", 1)[-1]
    keys = list(index["blocks"].get(block_id, [])) + [k for k in index["legacy"].get(block_id, []) if k not in index["blocks"].get(block_id, [])]
    if not keys:
        keys = [name]   # most add-ons name the picture like the block
    reason = "no picture found for it"
    for key in keys:
        path = index["textures"].get(key)
        if not path:
            continue
        for pack in index["resource"]:
            file = pack / (path if path.lower().endswith(".png") else path + ".png")
            try:
                if file.is_file() and file.stat().st_size <= 8_000_000:
                    c = png_average(file.read_bytes())
                    if c:
                        return c, None
                    reason = f"couldn't read {file.name}"
            except Exception:
                continue
    return None, reason


class AddonColors:
    def __init__(self, plugin, palette, root=None, level=None):
        self.plugin = plugin
        self.palette = palette
        self.root = root
        self.level = level
        saved = {}
        try:
            saved = plugin.economy.get_config(CONFIG_KEY) or {}
        except Exception:
            pass
        self.colors = {k: tuple(v) for k, v in saved.items() if isinstance(v, list) and len(v) == 3 and all(isinstance(x, int) for x in v)}
        self.failed = {}          # block id -> why (until the server restarts, then it tries again)
        self.queue = []
        self.running = False
        self.lock = threading.Lock()
        self.index = None
        self.on_change = None     # called on the main thread when new colours were learned

    def get(self, block_id):
        return self.colors.get(block_id)

    def waiting(self, block_id):
        """True while this block's colour is still being looked up."""
        return block_id not in self.colors and block_id not in self.failed

    def want(self, block_id):
        """Starts looking this add-on block's colour up (once)."""
        with self.lock:
            if block_id in self.colors or block_id in self.failed or block_id in self.queue:
                return
            self.queue.append(block_id)
            if self.running:
                return
            self.running = True
        threading.Thread(target=self._work, daemon=True).start()

    def _folders(self):
        from endstone_galaxylink.ranktags import level_folder
        return (self.root or Path.cwd()), (self.level or level_folder())

    def _work(self):
        time.sleep(BATCH_WAIT)
        with self.lock:
            ids, self.queue = self.queue, []
        found, failed = {}, {}
        try:
            if self.index is None:
                self.index = build_index(*self._folders())
            for ident in ids:
                try:
                    c, why = resolve(self.index, ident)
                except Exception as e:
                    c, why = None, f"{type(e).__name__}: {e}"
                if c is None:
                    failed[ident] = why
                else:
                    found[ident] = tuple(int(v) for v in nearest_map_colour(c, self.palette))
        except Exception as e:
            for ident in ids:
                failed.setdefault(ident, f"{type(e).__name__}: {e}")
        try:
            self.plugin.server.scheduler.run_task(self.plugin, lambda: self._finished(found, failed))
        except Exception:
            with self.lock:
                self.running = False

    def _finished(self, found, failed):
        """On the main thread: remember what was learned, tell the owner, and have the map redrawn."""
        self.colors.update(found)
        self.failed.update(failed)
        if found:
            try:
                self.plugin.economy.set_config(CONFIG_KEY, {k: list(v) for k, v in self.colors.items()})
            except Exception:
                pass
            names = sorted(k.split(":", 1)[-1] for k in found)
            self.plugin.logger.info(f"Live map: learned the colours of {len(found)} add-on block(s) from their pictures: " + ", ".join(names[:12]) + (" ..." if len(names) > 12 else ""))
        if failed:
            names = sorted(k.split(":", 1)[-1] for k in failed)
            self.plugin.logger.warning(f"Live map: couldn't find the picture of {len(failed)} add-on block(s), so they stay grey: " + ", ".join(names[:12])
                                       + (" ..." if len(names) > 12 else "") + f" ({next(iter(failed.values()))})")
        with self.lock:
            self.running = False
            again = bool(self.queue)
        if found and self.on_change:
            try:
                self.on_change()
            except Exception:
                pass
        if again:
            with self.lock:
                self.running = True
            threading.Thread(target=self._work, daemon=True).start()
