"""Add-on block colours for the website map. Run from endstone-plugin/:  PYTHONPATH=src python3 tests/test_blockcolors.py"""
import io
import json
import struct
import tempfile
import threading
import time
import types
import zlib
from pathlib import Path

from PIL import Image

from endstone_galaxylink import blockcolors as BC
from endstone_galaxylink import livemap as LM

NS = types.SimpleNamespace
fails = 0


def ok(cond, label):
    global fails
    fails += 0 if cond else 1
    print(("PASS " if cond else "FAIL ") + label)


def near(a, b, tol=1.5):
    return a is not None and all(abs(x - y) <= tol for x, y in zip(a, b))


# ---------- our own PNG writer: every colour type, depth and compression filter (Pillow can't write most of them) ----------
def chunk(kind, body):
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)


def png(w, h, ctype, depth, rows, plte=b"", trns=b"", filters=(0,), interlace=0):
    """rows: list of raw byte rows (already packed for this colour type and depth)."""
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    bpp = max(1, depth * channels // 8)
    out, prev = bytearray(), bytearray(len(rows[0]))
    for y, row in enumerate(rows):
        f = filters[y % len(filters)]
        line = bytearray(row)
        enc = bytearray(len(line))
        for i in range(len(line)):
            a = row[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            pred = 0 if f == 0 else a if f == 1 else b if f == 2 else (a + b) >> 1 if f == 3 else (a if abs(b - c) <= abs(a - c) and abs(b - c) <= abs(a + b - 2 * c) else b if abs(a - c) <= abs(a + b - 2 * c) else c)
            enc[i] = (row[i] - pred) & 255
        out += bytes([f]) + enc
        prev = bytearray(row)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, depth, ctype, 0, 0, interlace))
    if plte:
        data += chunk(b"PLTE", plte)
    if trns:
        data += chunk(b"tRNS", trns)
    data += chunk(b"IDAT", zlib.compress(bytes(out))) + chunk(b"IEND", b"")
    return data


def solid_rgba(w, h, rgba):
    return [bytes(rgba) * w for _ in range(h)]


# every filter, on a picture whose colours change from pixel to pixel
w = h = 8
rows = [bytes(v for x in range(w) for v in ((x * 31 + y * 7) % 256, (x * 13 + y * 29) % 256, (x * 5 + y * 3) % 256, 255)) for y in range(h)]
expect = tuple(sum(rows[y][x * 4 + k] for y in range(h) for x in range(w)) / (w * h) for k in range(3))
for f in range(5):
    ok(near(BC.png_average(png(w, h, 6, 8, rows, filters=(f,))), expect, 0.01), f"RGBA 8-bit, compression filter {f}")
ok(near(BC.png_average(png(w, h, 6, 8, rows, filters=(1, 2, 3, 4, 0, 4, 3, 2))), expect, 0.01), "RGBA 8-bit, a different filter on every row")
rgb_rows = [bytes(v for x in range(w) for v in rows[y][x * 4:x * 4 + 3]) for y in range(h)]
ok(near(BC.png_average(png(w, h, 2, 8, rgb_rows, filters=(4,))), expect, 0.01), "RGB 8-bit")
r16 = [bytes(v for x in range(w) for px in (rows[y][x * 4:x * 4 + 3] + bytes([255]),) for ch in px for v in (ch, 77)) for y in range(h)]
ok(near(BC.png_average(png(w, h, 6, 16, r16, filters=(4,))), expect, 0.01), "RGBA 16-bit (high byte used)")
gray = [bytes((x * 30 + y * 9) % 256 for x in range(w)) for y in range(h)]
g_exp = sum(sum(r) for r in gray) / (w * h)
ok(near(BC.png_average(png(w, h, 0, 8, gray, filters=(3,))), (g_exp,) * 3, 0.01), "grey 8-bit")
ga = [bytes(v for x in range(w) for v in (gray[y][x], 255 if x < 4 else 0)) for y in range(h)]
g2 = sum(gray[y][x] for y in range(h) for x in range(4)) / (4 * h)
ok(near(BC.png_average(png(w, h, 4, 8, ga, filters=(2,))), (g2,) * 3, 0.01), "grey + see-through: only the solid half counts")
pal = bytes([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0])
idx = [bytes([0, 1, 2, 3, 0, 1, 2, 3]) for _ in range(h)]
ok(near(BC.png_average(png(w, h, 3, 8, idx, plte=pal, filters=(1,))), (127.5, 127.5, 63.75), 0.01), "palette 8-bit")
packed = [bytes([0b00011011, 0b00011011]) for _ in range(h)]   # 2-bit indices 0,1,2,3,0,1,2,3
ok(near(BC.png_average(png(w, h, 3, 2, packed, plte=pal, filters=(0,))), (127.5, 127.5, 63.75), 0.01), "palette 2-bit (packed)")
ok(near(BC.png_average(png(w, h, 3, 8, idx, plte=pal, trns=bytes([255, 255, 255, 0]), filters=(0,))), (85, 85, 85), 0.01), "palette with a see-through colour: the yellow pixels don't count (red, green, blue left)")
bw = [bytes([0b10101010]) for _ in range(8)]
ok(near(BC.png_average(png(8, 8, 0, 1, bw, filters=(0,))), (127.5,) * 3, 0.01), "1-bit black and white")
# an animated strip: only its first frame counts
strip = solid_rgba(16, 16, (200, 0, 0, 255)) + solid_rgba(16, 48, (0, 0, 200, 255))
ok(near(BC.png_average(png(16, 64, 6, 8, strip)), (200, 0, 0), 0.01), "animated strip (16 x 64): first frame only")
# a corner cut away
corner = [bytes(v for x in range(8) for v in ((10, 200, 10, 0) if x < 2 and y < 2 else (200, 10, 10, 255))) for y in range(8)]
ok(near(BC.png_average(png(8, 8, 6, 8, corner)), (200, 10, 10), 0.01), "transparent corners don't pull the colour")
ok(BC.png_average(png(4, 4, 6, 8, solid_rgba(4, 4, (1, 2, 3, 0)))) is None, "fully see-through: no colour")
ok(BC.png_average(b"not a png") is None and BC.png_average(png(4, 4, 6, 8, solid_rgba(4, 4, (1, 2, 3, 255)), interlace=1)) is None, "junk and interlaced pictures are skipped, not crashed on")
ok(BC.png_average(png(4, 4, 6, 8, solid_rgba(4, 4, (1, 2, 3, 255)))[:-30]) is None, "a cut-off picture is skipped")
bomb = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 16, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\0" * 50_000_000)) + chunk(b"IEND", b"")
t0 = time.time(); res = BC.png_average(bomb)
ok(res is None and time.time() - t0 < 2, "a picture that unpacks to far too much is refused quickly")
# the same as Pillow, on real pictures made by Pillow
for mode, colour in (("RGBA", (30, 60, 90, 200)), ("RGB", (200, 100, 50)), ("L", 90), ("LA", (90, 120)), ("P", 3)):
    im = Image.new(mode, (16, 16), colour)
    if mode == "P":
        im.putpalette([0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 200, 90])
    if mode == "RGBA":
        im.putpixel((0, 0), (255, 255, 255, 0))
    buf = io.BytesIO(); im.save(buf, "PNG")
    ref = im.convert("RGBA")
    px = [p for p in ref.getdata() if p[3] >= 8]
    want = tuple(sum(p[k] * p[3] for p in px) / sum(p[3] for p in px) for k in range(3))
    got = BC.png_average(buf.getvalue())
    ok(near(got, want, 1.0), f"agrees with Pillow on a {mode} picture")
real = Path(__file__).resolve().parents[2] / "resource-pack" / "src" / "textures"
checked = 0
for f in sorted(real.rglob("*.png"))[:60]:
    try:
        im = Image.open(f).convert("RGBA"); im = im.crop((0, 0, im.width, min(im.height, im.width)))
        px = [p for p in im.getdata() if p[3] >= 8]
        if not px or im.width > 1024: continue
        want = tuple(sum(p[k] * p[3] for p in px) / sum(p[3] for p in px) for k in range(3))
        got = BC.png_average(f.read_bytes())
        if got is None: continue   # e.g. interlaced
        checked += 1
        assert near(got, want, 1.0), (f, got, want)
    except AssertionError:
        raise
    except Exception:
        continue
ok(checked > 10, f"agrees with Pillow on {checked} of this project's real pictures")

# ---------- snapping to the map's colours ----------
ok(BC.nearest_map_colour((127, 63, 178), LM.MC) == LM.MC["purple"], "the map's own purple stays purple")
ok(BC.nearest_map_colour((150, 70, 200), LM.MC) == LM.MC["magenta"], "a brighter purple picture gets the map's magenta (its darker shade matches)")
ok(BC.nearest_map_colour((20, 20, 20), LM.MC) == LM.MC["black"], "dark gets black")
ok(BC.nearest_map_colour((40, 60, 250), LM.MC) != LM.MC["water"], "a blue block never becomes the map's water")
ok(BC.nearest_map_colour((255, 0, 0), LM.MC) != LM.MC["fire"], "...and never fire red")

# ---------- a server folder with add-ons in it ----------
root = Path(tempfile.mkdtemp())
(root / "server.properties").write_text("level-name=Bedrock level\n")
level = root / "worlds" / "Bedrock level"
def put(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else data.encode())
purple = png(16, 16, 6, 8, solid_rgba(16, 16, (160, 60, 210, 255)))
side = png(16, 16, 6, 8, solid_rgba(16, 16, (240, 240, 240, 255)))
green = png(16, 16, 6, 8, solid_rgba(16, 16, (60, 180, 60, 255)))
red = png(16, 16, 6, 8, solid_rgba(16, 16, (200, 40, 40, 255)))
cyan = png(16, 16, 6, 8, solid_rgba(16, 16, (40, 200, 200, 255)))
# behavior pack in the server's behavior_packs folder: new-style blocks, with // comments like real add-ons have
put(root / "behavior_packs" / "Addon_BP" / "blocks" / "capsula.json", """{
  // a block with a different top
  "format_version": "1.20.50",
  "minecraft:block": {"description": {"identifier": "mx:capsula_amatista"},
    "components": {"minecraft:material_instances": {"*": {"texture": "capsula_side"}, "up": {"texture": "capsula_top"}}}}
}""")
put(root / "behavior_packs" / "Addon_BP" / "blocks" / "nested" / "weapon.json", json.dumps({"minecraft:block": {"description": {"identifier": "mx:weapon_stand"},
    "components": {}, "permutations": [{"condition": "q.block_state('mx:x') == 1", "components": {"minecraft:material_instances": {"*": "stand_tex"}}}]}}))
put(root / "behavior_packs" / "Addon_BP" / "blocks" / "logo.json", json.dumps({"minecraft:block": {"description": {"identifier": "mx:logo_3_0"}, "components": {}}}))   # no textures listed: named like the block
put(root / "behavior_packs" / "Addon_BP" / "blocks" / "ghost.json", json.dumps({"minecraft:block": {"description": {"identifier": "mx:ghost"}, "components": {"minecraft:material_instances": {"*": {"texture": "nowhere"}}}}}))
put(root / "behavior_packs" / "Addon_BP" / "blocks" / "broken.json", "{ this isn't json")
put(root / "resource_packs" / "Addon_RP" / "textures" / "terrain_texture.json", """{
  // picture names
  "texture_data": {"capsula_side": {"textures": "textures/blocks/capsula_side"}, "capsula_top": {"textures": ["textures/blocks/capsula_top", "textures/blocks/other"]},
                   "stand_tex": {"textures": {"path": "textures/blocks/stand.png"}}, "logo_3_0": {"textures": "textures/blocks/logo/logo_3_0"}}
}""")
put(root / "resource_packs" / "Addon_RP" / "textures" / "blocks" / "capsula_side.png", side)
put(root / "resource_packs" / "Addon_RP" / "textures" / "blocks" / "capsula_top.png", purple)
put(root / "resource_packs" / "Addon_RP" / "textures" / "blocks" / "stand.png", green)
put(root / "resource_packs" / "Addon_RP" / "textures" / "blocks" / "logo" / "logo_3_0.png", cyan)
# an older add-on: the picture is in the resource pack's blocks.json, packs live in the world folder
put(level / "resource_packs" / "Old_RP" / "blocks.json", json.dumps({"format_version": [1, 1, 0], "ol:huevo": {"textures": {"up": "huevo_top", "side": "huevo_side"}}}))
put(level / "resource_packs" / "Old_RP" / "textures" / "terrain_texture.json", json.dumps({"texture_data": {"huevo_top": {"textures": "textures/blocks/huevo_top"}, "huevo_side": {"textures": "textures/blocks/huevo_side"}}}))
put(level / "resource_packs" / "Old_RP" / "textures" / "blocks" / "huevo_top.png", red)
put(level / "resource_packs" / "Old_RP" / "textures" / "blocks" / "huevo_side.png", side)

index = BC.build_index(root, level)
ok(index["blocks"]["mx:capsula_amatista"][:2] == ["capsula_top", "capsula_side"], "the top face's picture is looked at first: " + str(index["blocks"]["mx:capsula_amatista"]))
ok("mx:weapon_stand" in index["blocks"], "a block that only lists its picture in a permutation is found")
ok(index["legacy"].get("ol:huevo", [])[:1] == ["huevo_top"], "an older add-on's blocks.json is read (top first)")
ok(index["textures"]["capsula_top"] == "textures/blocks/capsula_top" and index["textures"]["stand_tex"] == "textures/blocks/stand.png", "picture names: plain, list and {path} forms")
c, why = BC.resolve(index, "mx:capsula_amatista")
ok(near(c, (160, 60, 210)) and why is None, "capsula_amatista: its purple top, not the white side (raw average)")
ok(near(BC.resolve(index, "mx:weapon_stand")[0], (60, 180, 60)), "weapon_stand: green (a .png written in the path is fine)")
ok(near(BC.resolve(index, "mx:logo_3_0")[0], (40, 200, 200)), "logo_3_0: no pictures listed, so the picture named like the block is used")
ok(near(BC.resolve(index, "ol:huevo")[0], (200, 40, 40)), "huevo (older add-on, packs in the world folder): red top")
c, why = BC.resolve(index, "mx:ghost")
ok(c is None and why, "a block whose picture can't be found says so: " + str(why))
c, why = BC.resolve(index, "mx:unknown_thing")
ok(c is None, "a block no pack mentions: nothing, no crash")

# ---------- the background flow, with a pretend plugin ----------
logs, cfg, tasks = [], {}, []
plugin = NS(economy=NS(get_config=lambda k: cfg.get(k), set_config=lambda k, v: cfg.__setitem__(k, v)),
            logger=NS(info=lambda m: logs.append(("i", m)), warning=lambda m: logs.append(("w", m))),
            server=NS(scheduler=NS(run_task=lambda p, fn, delay=0: tasks.append(fn))))
BC.BATCH_WAIT = 0.05
ac = BC.AddonColors(plugin, LM.MC, root=root, level=level)
changed = []
ac.on_change = lambda: changed.append(1)
ok(ac.get("mx:capsula_amatista") is None and ac.waiting("mx:capsula_amatista"), "before it's looked up: unknown, and marked as being looked up")
for b in ("mx:capsula_amatista", "mx:weapon_stand", "mx:ghost", "mx:capsula_amatista", "ol:huevo", "mx:logo_3_0"):
    ac.want(b)
for _ in range(100):
    if tasks: break
    time.sleep(0.05)
ok(len(tasks) == 1, "one batch for the blocks seen together")
tasks.pop()()
ok(ac.get("mx:capsula_amatista") == tuple(LM.MC["magenta"]) and ac.get("mx:weapon_stand") is not None and ac.get("ol:huevo") is not None, "the colours are learned and snapped to map colours")
ok("mx:ghost" in ac.failed and not ac.waiting("mx:ghost") and ac.get("mx:ghost") is None, "a block without a picture is marked failed (grey) and not asked again")
ok(len(cfg[BC.CONFIG_KEY]) == 4 and changed == [1], "saved for next time, and the map was told to redraw")
ok(any("learned the colours of 4 add-on block" in m for k, m in logs) and any("couldn't find the picture" in m and "ghost" in m for k, m in logs), "the owner's console says what was learned and what wasn't")
ac.want("mx:capsula_amatista"); ac.want("mx:ghost"); time.sleep(0.2)
ok(not tasks and not ac.running, "known and failed blocks aren't looked up again")
ac2 = BC.AddonColors(plugin, LM.MC, root=root, level=level)
ok(ac2.get("mx:capsula_amatista") == ac.get("mx:capsula_amatista") and ac2.get("ol:huevo") is not None, "after a restart the learned colours are there straight away")
# a block seen while the first batch is being worked on gets its own batch right after
cfg.clear()                                    # nothing saved yet, like a first start
ac3 = BC.AddonColors(plugin, LM.MC, root=root, level=level); ac3.index = index
tasks.clear()
ac3.want("mx:weapon_stand")
for _ in range(100):
    if tasks: break
    time.sleep(0.05)
ac3.want("mx:logo_3_0")                        # the first batch has been looked up, but not applied yet
ok(len(tasks) == 1 and ac3.get("mx:logo_3_0") is None and ac3.waiting("mx:logo_3_0"), "a block seen mid-lookup waits for the next batch")
tasks.pop()()
for _ in range(100):
    if tasks: break
    time.sleep(0.05)
ok(len(tasks) == 1, "...which starts by itself")
tasks.pop()()
ok(ac3.get("mx:weapon_stand") and ac3.get("mx:logo_3_0") and not ac3.running and not ac3.queue, "both are known and nothing is left running")

# ---------- the map's colour function ----------
LM._cache.clear(); cfg.clear()
lm = LM.LiveMap(NS(economy=plugin.economy, logger=plugin.logger, server=plugin.server))
fresh = BC.AddonColors(plugin, LM.MC, root=root, level=level); fresh.colors = {}; fresh.failed = {}
LM.ADDONS = fresh; fresh.on_change = lm.redraw_all
tasks.clear()
c1 = LM.color_of("mx:capsula_amatista")
ok(c1 == LM.UNKNOWN or c1 is not None, "while it's being looked up, the map uses the old guess")
ok("mx:capsula_amatista" not in LM._cache, "...and doesn't remember that guess")
for _ in range(100):
    if tasks: break
    time.sleep(0.05)
lm.drawn[(1, 1)] = 5
tasks.pop()()
ok(LM.color_of("mx:capsula_amatista") == tuple(LM.MC["magenta"]) and LM._cache["mx:capsula_amatista"] == tuple(LM.MC["magenta"]), "afterwards: its real colour, remembered")
ok(not lm.drawn, "the land is queued to be drawn again")
ok(LM.color_of("minecraft:stone") == tuple(LM.TABLE["stone"]) and LM.color_of("minecraft:grass_block") == tuple(LM.TABLE["grass_block"]), "vanilla blocks are exactly as before")
ok(LM.color_of("minecraft:some_future_block") == LM.UNKNOWN and "some_future_block" in LM.unknown_seen, "a new vanilla block is still reported like before")
c = LM.color_of("mx:ghost"); time.sleep(0.2)
if tasks: tasks.pop()()
ok(LM.color_of("mx:ghost") == LM.UNKNOWN and LM._cache.get("mx:ghost") == LM.UNKNOWN, "an add-on block with no picture is grey and remembered as grey")
LM.ADDONS = None
ok(LM.color_of("zz:other_block") is not None, "without the add-on reader it still works as before")
print("FAILS:", fails)
