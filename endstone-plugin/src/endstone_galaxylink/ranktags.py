"""Smooth gradient rank tags.

Bedrock text can't use hex colors, but it can show small pictures (like the rank icons). So the plugin
draws every gradient rank tag (and the Galaxy+ / Pro+ plan tags) letter by letter as pictures with a
true smooth hex gradient across the whole tag, and packs them into a tiny resource pack:
    BDS-Addons/GalaxySMP_RankTags.mcpack
BisectHosting's add-on installer installs it when the server starts. When ranks change, the pack is
rebuilt by itself and the new pictures show after the next restart (until then the tag uses the normal
28-color gradient, so nothing ever looks broken).

/ranktags off  switches back to the normal colored text right away; /ranktags on  turns pictures back on.
"""

import json
import struct
import zlib
from pathlib import Path

PACK_UUID = "c1a5e6f2-7b3d-4e9a-8f21-5d6c7b8a9e01"
MODULE_UUID = "d2b6f7a3-8c4e-4fab-9a32-6e7d8c9bae12"
# Glyph pages (256 pictures each):
#   "instant" letters: every letter/digit/symbol in a range of gradient colors, so any rank or name shows a real
#   gradient the moment it's given (Bedrock trims each picture's empty right side, so letters keep natural widths).
#   "strips": whole tags/names drawn perfectly smooth; these need a restart, then replace the instant letters.
BASE_PAGES = list(range(0xE4, 0xE9)) + list(range(0xEC, 0xF7))   # E4-E8, EC-F6: 16 pages (F7, F8 = GalaxySMP Icons)
PAGES = [0xE9, 0xEA, 0xEB]                                       # strips
CELL = 16                          # pixels per picture (256x256 page = the same size as normal text)
UNIT = 1                           # 1 image pixel = 1 text pixel (Bedrock draws pictures at that scale: same size as chat)
TOP = 0                            # letters at the top of each picture (Bedrock lines pictures up by their top, like text)
FILE = "GalaxySMP_RankTags.mcpack"
FORMAT = 6                         # bump when the drawing changes, so everything is rebuilt
CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789[]+-_.!?&'"

# A 5x7 pixel font in the style of Minecraft's (# = pixel). Width = longest row.
FONT_ROWS = {
    "A": [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
    "B": ["#### ", "#   #", "#   #", "#### ", "#   #", "#   #", "#### "],
    "C": [" ### ", "#   #", "#    ", "#    ", "#    ", "#   #", " ### "],
    "D": ["#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "],
    "E": ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
    "F": ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#    "],
    "G": [" ####", "#    ", "#    ", "#  ##", "#   #", "#   #", " ### "],
    "H": ["#   #", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
    "I": ["###", " # ", " # ", " # ", " # ", " # ", "###"],
    "J": ["    #", "    #", "    #", "    #", "#   #", "#   #", " ### "],
    "K": ["#   #", "#  # ", "# #  ", "##   ", "# #  ", "#  # ", "#   #"],
    "L": ["#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"],
    "M": ["#   #", "## ##", "# # #", "#   #", "#   #", "#   #", "#   #"],
    "N": ["#   #", "##  #", "# # #", "#  ##", "#   #", "#   #", "#   #"],
    "O": [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
    "P": ["#### ", "#   #", "#   #", "#### ", "#    ", "#    ", "#    "],
    "Q": [" ### ", "#   #", "#   #", "#   #", "#   #", "#  # ", " ## #"],
    "R": ["#### ", "#   #", "#   #", "#### ", "#  # ", "#   #", "#   #"],
    "S": [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "],
    "T": ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
    "U": ["#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
    "V": ["#   #", "#   #", "#   #", "#   #", " # # ", " # # ", "  #  "],
    "W": ["#   #", "#   #", "#   #", "#   #", "# # #", "## ##", "#   #"],
    "X": ["#   #", " # # ", "  #  ", "  #  ", "  #  ", " # # ", "#   #"],
    "Y": ["#   #", " # # ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
    "Z": ["#####", "    #", "   # ", "  #  ", " #   ", "#    ", "#####"],
    "0": [" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "],
    "1": ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", "#####"],
    "2": [" ### ", "#   #", "    #", "  ## ", " #   ", "#    ", "#####"],
    "3": [" ### ", "#   #", "    #", "  ## ", "    #", "#   #", " ### "],
    "4": ["   ##", "  # #", " #  #", "#   #", "#####", "    #", "    #"],
    "5": ["#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "],
    "6": ["  ## ", " #   ", "#    ", "#### ", "#   #", "#   #", " ### "],
    "7": ["#####", "#   #", "    #", "   # ", "  #  ", "  #  ", "  #  "],
    "8": [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
    "9": [" ### ", "#   #", "#   #", " ####", "    #", "   # ", " ##  "],
    "+": ["     ", "  #  ", "  #  ", "#####", "  #  ", "  #  ", "     "],
    "-": ["     ", "     ", "     ", "#####", "     ", "     ", "     "],
    "!": ["#", "#", "#", "#", "#", " ", "#"],
    "?": [" ### ", "#   #", "    #", "   # ", "  #  ", "     ", "  #  "],
    ".": [" ", " ", " ", " ", " ", " ", "#"],
    "'": ["#", "#", " ", " ", " ", " ", " "],
    "&": [" ##  ", "#  # ", " ##  ", " ## #", "#  # ", "#  # ", " ## #"],
    "*": ["     ", "#   #", " # # ", "  #  ", " # # ", "#   #", "     "],
    "#": [" # # ", " # # ", "#####", " # # ", "#####", " # # ", " # # "],
    "/": ["    #", "   # ", "   # ", "  #  ", " #   ", " #   ", "#    "],
    ":": [" ", "#", "#", " ", " ", "#", "#"],
    "_": ["     ", "     ", "     ", "     ", "     ", "     ", "#####"],
    "(": ["  #", " # ", "#  ", "#  ", "#  ", " # ", "  #"],
    ")": ["#  ", " # ", "  #", "  #", "  #", " # ", "#  "],
    "[": ["###", "#  ", "#  ", "#  ", "#  ", "#  ", "###"],
    "]": ["###", "  #", "  #", "  #", "  #", "  #", "###"],
    "<": ["   #", "  # ", " #  ", "#   ", " #  ", "  # ", "   #"],
    ">": ["#   ", " #  ", "  # ", "   #", "  # ", " #  ", "#   "],
    "=": ["     ", "     ", "#####", "     ", "#####", "     ", "     "],
}


# Lowercase (8 rows: the last row is for the tails of g, j, p, q, y).
FONT_LOWER = {
    "a": ["     ", "     ", " ### ", "    #", " ####", "#   #", " ####", "     "],
    "b": ["#    ", "#    ", "# ## ", "##  #", "#   #", "#   #", "#### ", "     "],
    "c": ["     ", "     ", " ### ", "#   #", "#    ", "#   #", " ### ", "     "],
    "d": ["    #", "    #", " ## #", "#  ##", "#   #", "#   #", " ####", "     "],
    "e": ["     ", "     ", " ### ", "#   #", "#####", "#    ", " ####", "     "],
    "f": ["  ##", " #  ", "####", " #  ", " #  ", " #  ", " #  ", "    "],
    "g": ["     ", "     ", " ####", "#   #", "#   #", " ####", "    #", "#### "],
    "h": ["#    ", "#    ", "# ## ", "##  #", "#   #", "#   #", "#   #", "     "],
    "i": ["#", " ", "#", "#", "#", "#", "#", " "],
    "j": ["    #", "     ", "    #", "    #", "    #", "    #", "#   #", " ### "],
    "k": ["#   ", "#   ", "#  #", "# # ", "##  ", "# # ", "#  #", "    "],
    "l": ["# ", "# ", "# ", "# ", "# ", "# ", " #", "  "],
    "m": ["     ", "     ", "## # ", "# # #", "# # #", "#   #", "#   #", "     "],
    "n": ["     ", "     ", "#### ", "#   #", "#   #", "#   #", "#   #", "     "],
    "o": ["     ", "     ", " ### ", "#   #", "#   #", "#   #", " ### ", "     "],
    "p": ["     ", "     ", "# ## ", "##  #", "#   #", "#### ", "#    ", "#    "],
    "q": ["     ", "     ", " ## #", "#  ##", "#   #", " ####", "    #", "    #"],
    "r": ["     ", "     ", "# ## ", "##  #", "#    ", "#    ", "#    ", "     "],
    "s": ["     ", "     ", " ####", "#    ", " ### ", "    #", "#### ", "     "],
    "t": [" #  ", " #  ", "####", " #  ", " #  ", " #  ", "  ##", "    "],
    "u": ["     ", "     ", "#   #", "#   #", "#   #", "#   #", " ####", "     "],
    "v": ["     ", "     ", "#   #", "#   #", "#   #", " # # ", "  #  ", "     "],
    "w": ["     ", "     ", "#   #", "#   #", "# # #", "# # #", " ####", "     "],
    "x": ["     ", "     ", "#   #", " # # ", "  #  ", " # # ", "#   #", "     "],
    "y": ["     ", "     ", "#   #", "#   #", "#   #", " ####", "    #", "#### "],
    "z": ["     ", "     ", "#####", "   # ", "  #  ", " #   ", "#####", "     "],
}


def font_char(ch):
    rows = FONT_ROWS.get(ch) or FONT_LOWER.get(ch) or FONT_ROWS.get(ch.upper())
    if rows is None:
        return None
    width = max(len(r.rstrip()) for r in rows) or 1
    rows = [r.ljust(width)[:width] for r in rows]
    return rows + [" " * width] * (8 - len(rows))


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def color_at(stops, t):
    if len(stops) == 1:
        return rgb(stops[0])
    pos = max(0.0, min(1.0, t)) * (len(stops) - 1)
    i = min(int(pos), len(stops) - 2)
    f = pos - i
    a, b = rgb(stops[i]), rgb(stops[i + 1])
    return tuple(int(round(a[k] + (b[k] - a[k]) * f)) for k in range(3))


SPACE_UNITS = 3


def render_strip(text, stops):
    """Draws the whole text as one strip with normal letter spacing (like Minecraft's chat font) and one
    smooth gradient across it. Returns (pixels {(x, y): rgba}, width in pixels, x where the 2nd character starts)."""
    layout, x = [], 0
    for i, ch in enumerate(text):
        g = font_char(ch)
        if g is None:  # space (or a character the font doesn't have)
            x += SPACE_UNITS
            layout.append((None, x))
            continue
        layout.append((g, x))
        x += len(g[0]) + 1
    units = max(1, x - 1)
    width = units * UNIT
    pixels, split = {}, None
    for i, (g, x0) in enumerate(layout):
        if i == 1:
            split = x0 * UNIT
        if g is None:
            continue
        for row, line in enumerate(g):
            for col, c in enumerate(line):
                if c != "#":
                    continue
                for dx in range(UNIT):
                    px = (x0 + col) * UNIT + dx
                    color = color_at(stops, px / max(1, width - 1))
                    for dy in range(UNIT):
                        pixels[(px, TOP + row * UNIT + dy)] = (*color, 255)
    return pixels, width, split


def tiles(pixels, x_from, x_to):
    """Cuts part of a strip into 16x16 pictures that fit together exactly. Each picture gets two almost
    invisible pixels at its left and right edge so Minecraft keeps its full width (no gaps, no overlap)."""
    out = []
    for left in range(x_from, x_to, CELL):
        tile = {}
        for x in range(CELL):
            for y in range(CELL):
                c = pixels.get((left + x, y))
                if c:
                    tile[(x, y)] = c
        for edge in (0, CELL - 1):
            tile.setdefault((edge, CELL - 1), (255, 255, 255, 1))
        out.append(tile)
    return out


def render_tag(text, stops):
    """Kept for previews/tests: the strip as a list of 16x16 tiles."""
    pixels, width, _ = render_strip(text, stops)
    return tiles(pixels, 0, width)


def png(width, height, pixels):
    """A tiny PNG writer (no extra libraries needed). pixels: dict (x, y) -> (r, g, b, a)."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(pixels.get((x, y), (0, 0, 0, 0)))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def level_folder():
    """worlds/<level-name> from server.properties."""
    name = "Bedrock level"
    try:
        for line in (Path.cwd() / "server.properties").read_text("utf-8", "ignore").splitlines():
            if line.startswith("level-name="):
                name = line.split("=", 1)[1].strip() or name
    except Exception:
        pass
    return Path.cwd() / "worlds" / name


def world_packs(kind="resource"):
    """The packs the world loads: [(uuid, version list)] from world_resource_packs.json / world_behavior_packs.json."""
    try:
        data = json.loads((level_folder() / f"world_{kind}_packs.json").read_text("utf-8"))
        return [(str(e.get("pack_id")), list(e.get("version") or [])) for e in data if isinstance(e, dict)]
    except Exception:
        return []


def installed_version(pack_uuid):
    for pid, ver in world_packs("resource"):
        if pid == pack_uuid and len(ver) == 3:
            return ver[2]
    return None


def installed_pack_folder(pack_uuid):
    """The folder the server really loads our pack from (resource_packs/<something>), found by its manifest uuid."""
    roots = [Path.cwd() / "resource_packs", level_folder() / "resource_packs", Path.cwd() / "development_resource_packs"]
    for root in roots:
        if not root.is_dir():
            continue
        for manifest in root.glob("*/manifest.json"):
            try:
                if json.loads(manifest.read_text("utf-8")).get("header", {}).get("uuid") == pack_uuid:
                    return manifest.parent
            except Exception:
                continue
    return None


def fingerprint(files):
    """One hash for a set of glyph pictures {name: png bytes} (same pictures = same hash)."""
    import hashlib
    h = hashlib.sha1()
    for name in sorted(files):
        h.update(name.encode())
        h.update(hashlib.sha1(files[name]).digest())
    return h.hexdigest()[:16]


def installed_fingerprint(pack_uuid):
    folder = installed_pack_folder(pack_uuid)
    if folder is None or not (folder / "font").is_dir():
        return None
    try:
        return fingerprint({f.name: f.read_bytes() for f in (folder / "font").glob("glyph_*.png")})
    except Exception:
        return None


GALAXY_PACKS = [("resource", "6b0f4c3e-2d1a-4a8e-9c5b-1f7e3a9d2c41", "GalaxySMP Icons"),
                ("behavior", "27c58f05-2465-44d9-98cc-ff4e5bb2a019", "GalaxySMP Blocks"),
                ("resource", PACK_UUID, "GalaxySMP Rank Tags")]


def clean_world_packs(logger=None):
    """Removes old duplicate entries of our own packs from world_*_packs.json (keeps the newest version).
    Stale entries make Minecraft say "at least one of your packs failed to load". Takes effect next restart."""
    ours = {pid for _, pid, _ in GALAXY_PACKS}
    for kind in ("resource", "behavior"):
        path = level_folder() / f"world_{kind}_packs.json"
        try:
            data = json.loads(path.read_text("utf-8"))
        except Exception:
            continue
        if not isinstance(data, list):
            continue
        best = {}
        for e in data:
            if isinstance(e, dict) and e.get("pack_id") in ours:
                v = list(e.get("version") or [])
                if e["pack_id"] not in best or v > best[e["pack_id"]]:
                    best[e["pack_id"]] = v
        keep, removed = [], []
        for e in data:
            if isinstance(e, dict) and e.get("pack_id") in ours and list(e.get("version") or []) != best[e["pack_id"]]:
                removed.append(e)
                continue
            if isinstance(e, dict) and e.get("pack_id") in ours and any(isinstance(k, dict) and k.get("pack_id") == e["pack_id"] for k in keep):
                removed.append(e)  # exact duplicate
                continue
            keep.append(e)
        if removed:
            path.write_text(json.dumps(keep, indent=2), "utf-8")
            if logger:
                logger.info(f"Removed {len(removed)} old duplicate GalaxySMP pack entr{'y' if len(removed) == 1 else 'ies'} "
                            f"from world_{kind}_packs.json (fixes 'a pack failed to load' after the next restart).")


def pack_report():
    """One line per GalaxySMP pack: which version the world loads, and duplicates (a common cause of
    'at least one of your packs failed to load')."""
    lines = []
    for kind, pid, name in GALAXY_PACKS:
        found = [v for p, v in world_packs(kind) if p == pid]
        if not found:
            lines.append(f"{name}: NOT in world_{kind}_packs.json")
        elif len(found) > 1:
            lines.append(f"{name}: listed {len(found)} times {found} - keep only the newest one")
        else:
            lines.append(f"{name}: version {'.'.join(map(str, found[0]))}")
    for pack, page in glyph_conflicts():
        lines.append(f"WARNING: '{pack}' also draws glyph page {page}, which GalaxySMP Icons uses. Move GalaxySMP Icons "
                     f"above it in the world's resource pack list (or remove that pack), or icons will look wrong.")
    return lines


ICON_PAGES = ("F7", "F8")  # glyph pages drawn by the GalaxySMP Icons pack
OLD_ICON_PAGES = ("E2", "E3")  # where they used to be (other add-ons use these, which broke our icons)


def glyph_conflicts():
    """Other packs on the server that draw the same glyph pages as GalaxySMP Icons (the pack higher in the
    list wins the WHOLE page, so icons show up as someone else's pictures). [(pack name, page)]"""
    import zipfile
    ours = {"6b0f4c3e-2d1a-4a8e-9c5b-1f7e3a9d2c41", PACK_UUID}
    pages = set(ICON_PAGES)
    found = []
    roots = [level_folder() / "resource_packs", Path.cwd() / "resource_packs"]
    for root in roots:
        try:
            entries = list(root.iterdir())
        except Exception:
            continue
        for entry in entries:
            try:
                if entry.is_dir():
                    manifest = json.loads((entry / "manifest.json").read_text("utf-8", "ignore"))
                    fonts = [f.name for f in (entry / "font").glob("glyph_*.png")] if (entry / "font").is_dir() else []
                elif entry.suffix.lower() in (".mcpack", ".zip"):
                    with zipfile.ZipFile(entry) as z:
                        names = z.namelist()
                        mf = next((n for n in names if n.endswith("manifest.json") and n.count("/") <= 1), None)
                        manifest = json.loads(z.read(mf).decode("utf-8", "ignore")) if mf else {}
                        fonts = [n.rsplit("/", 1)[-1] for n in names if "/font/glyph_" in "/" + n]
                else:
                    continue
                head = manifest.get("header") or {}
                if str(head.get("uuid")) in ours:
                    continue
                for f in fonts:
                    page = f[len("glyph_"):-len(".png")].upper()
                    if page in pages:
                        found.append((str(head.get("name") or entry.name), page))
            except Exception:
                continue
    return sorted(set(found))


def gradient_palette():
    """The colors the instant letters come in: every gradient sampled at 5 points (start, 1/4, middle, 3/4, end)."""
    from endstone_galaxylink.ranks import GRADIENT_HEX
    pal = []
    for key in GRADIENT_HEX:
        for t in (0, 0.25, 0.5, 0.75, 1):
            c = color_at(GRADIENT_HEX[key], t)
            if c not in pal:
                pal.append(c)
    room = len(BASE_PAGES) * 256 // len(CHARSET)
    while len(pal) > room:  # too many: drop the color closest to another one
        best = min(((i, j) for i in range(len(pal)) for j in range(i + 1, len(pal))),
                   key=lambda ij: sum((a - b) ** 2 for a, b in zip(pal[ij[0]], pal[ij[1]])))
        pal.pop(best[1])
    return pal


PALETTE = None


def palette():
    global PALETTE
    if PALETTE is None:
        PALETTE = gradient_palette()
    return PALETTE


def base_id():
    """Identifies the instant-letter set (changes if the palette, letters or drawing change)."""
    import hashlib
    return hashlib.sha1(json.dumps([FORMAT, CHARSET, palette(), UNIT, CELL]).encode()).hexdigest()[:12]


def base_char(ch, color_index):
    i = color_index * len(CHARSET) + CHARSET.index(ch)
    return chr((BASE_PAGES[i // 256] << 8) + i % 256)


def nearest_color(rgb_):
    pal = palette()
    return min(range(len(pal)), key=lambda i: sum((a - b) ** 2 for a, b in zip(pal[i], rgb_)))


def instant_text(text, stops):
    """Any text in a real gradient right away, built from the instant letters."""
    letters = [ch for ch in text if ch in CHARSET]
    n = len(letters)
    out, k = [], 0
    for ch in text:
        if ch not in CHARSET:
            out.append(ch)  # spaces etc.
            continue
        out.append(base_char(ch, nearest_color(color_at(stops, k / max(1, n - 1)))))
        k += 1
    return "".join(out)


def base_pages():
    """Draws all instant letters: {page: pixels}."""
    pages = {}
    for ci, color in enumerate(palette()):
        for li, ch in enumerate(CHARSET):
            g = font_char(ch)
            i = ci * len(CHARSET) + li
            page, idx = BASE_PAGES[i // 256], i % 256
            cx, cy = (idx % 16) * CELL, (idx // 16) * CELL
            px = pages.setdefault(page, {})
            for row, line in enumerate(g):
                for col, c in enumerate(line):
                    if c == "#":
                        for dx in range(UNIT):
                            for dy in range(UNIT):
                                px[(cx + col * UNIT + dx, cy + TOP + row * UNIT + dy)] = (*color, 255)
    return pages


def signature(item):
    """What a text looks like (text + gradient colors): same signature = same pictures."""
    return json.dumps([FORMAT, item.get("text", ""), item.get("stops")], separators=(",", ":"))


class RankTags:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        cfg = self.eco.get_config("ranktags") or {}
        self.enabled = cfg.get("enabled", True)
        self.chat_pictures = cfg.get("chat", True)    # Discord-style chat: a picture name line, then the message in normal font
        self.version = cfg.get("version", 0)
        self.built = cfg.get("built") or {}           # signature -> glyph string, in the pack file on disk
        self.history = cfg.get("history") or {}       # pack version -> its glyphs (the last few builds)
        # Only use pictures from the pack version the world really loaded (world_resource_packs.json).
        self.installed = installed_version(PACK_UUID)
        self.active = self.pick_active()

    def pick_active(self):
        """The picture map for the pack the server REALLY loaded. The version number in the world's pack
        list can lag behind the pack's actual pictures (some hosts' add-on installers update the files but
        not the number), and using the wrong map shows wrong pieces of other tags (like "MEMBER]"). So the
        installed pictures are fingerprinted and matched to the build that made them. No match: colored
        text (always correct) until the next restart."""
        entries = {k: (v if isinstance(v, dict) and "glyphs" in v else {"glyphs": v, "hash": None}) for k, v in self.history.items()}
        found = installed_fingerprint(PACK_UUID)
        if found is not None:
            for k, e in entries.items():
                if e.get("hash") == found:
                    self.installed = int(k)
                    return dict(e["glyphs"] or {})
            return {}
        # The pack folder couldn't be read: trust the world's version number, as before.
        e = entries.get(str(self.installed))
        mapping = e["glyphs"] if e else (self.built if self.installed == self.version else None)
        return dict(mapping or {}) if self.installed else {}

    def save(self):
        keep = sorted(self.history, key=int)[-12:]
        self.history = {k: self.history[k] for k in keep}
        self.eco.set_config("ranktags", {"enabled": self.enabled, "chat": self.chat_pictures, "version": self.version,
                                         "built": self.built, "history": self.history})

    def pack_path(self):
        addons = Path.cwd() / "BDS-Addons"
        folder = addons if addons.is_dir() else Path(self.plugin.data_folder)
        return folder / FILE

    # ---------- used by ranks.tag_text and ranks.name_text ----------
    def glyphs_for(self, tag):
        """Pictures for a rank tag "[PREFIX]", or None to use colored text."""
        return self.glyphs_for_text(f"[{tag.get('prefix', '')}]", tag.get("stops"))

    def glyphs_for_text(self, text, stops):
        """Pictures for any text (a tag or a player's name), or None to use colored text."""
        if not self.enabled or not stops or not text:
            return None
        found = self.active.get(signature({"text": text, "stops": stops}))
        if text.startswith("[") and isinstance(found, list):
            return found  # perfectly smooth strip: ["[", "PREFIX]"] so the icon can go in between
        if not text.startswith("[") and isinstance(found, str):
            return found
        if self.active.get("__base__") == base_id():  # instant letters: works for any new rank or name
            if text.startswith("["):
                full = instant_text(text, stops)
                return [full[0], full[1:]]
            return instant_text(text, stops)
        return None

    # ---------- building the pack ----------
    def wanted(self, items):
        """items: rank tags {"prefix", "stops"} and names {"text", "stops"}."""
        out = {}
        for t in items:
            if not t or not t.get("stops"):
                continue
            text = t.get("text") or (f"[{t['prefix']}]" if t.get("prefix") else "")
            if text:
                item = {"text": text, "stops": t["stops"]}
                out[signature(item)] = item
        return out

    def refresh(self, tags):
        """Called when ranks arrive from the website: rebuild the pack if any gradient tag changed."""
        want = self.wanted(tags)
        newest = self.history.get(str(self.version))
        fingerprinted = isinstance(newest, dict) and bool(newest.get("hash"))  # builds before 2.26.1 have none: rebuild once
        if fingerprinted and set(want) == {k for k in self.built if k != "__base__"} and self.built.get("__base__") == base_id():
            return False
        built, pages = {"__base__": base_id()}, base_pages()
        cp = [0]

        def place(tile_list):
            chars = []
            for tile in tile_list:
                if cp[0] >= len(PAGES) * 256:
                    break
                page, idx = PAGES[cp[0] // 256], cp[0] % 256
                cx, cy = (idx % 16) * CELL, (idx // 16) * CELL
                page_px = pages.setdefault(page, {})
                for (x, y), c in tile.items():
                    page_px[(cx + x, cy + y)] = c
                chars.append(chr((page << 8) + idx))
                cp[0] += 1
            return "".join(chars)

        for sig, t in sorted(want.items()):
            pixels, width, split = render_strip(t["text"], t["stops"])
            if cp[0] + (width // CELL + 2) > len(PAGES) * 256:
                continue  # no room left for strips: this one uses the instant letters
            if t["text"].startswith("[") and split:  # tag: "[" and "PREFIX]" separately, the icon goes between
                built[sig] = [place(tiles(pixels, 0, split)), place(tiles(pixels, split, width))]
            else:
                built[sig] = place(tiles(pixels, 0, width))
        self.version += 1
        prints = self.write_pack(pages)
        self.built = built
        self.history[str(self.version)] = {"glyphs": built, "hash": prints}
        self.save()
        self.plugin.logger.info(f"Gradient pictures updated ({len(built) - 1} smooth tags/names + instant letters). "
                                "Smooth versions show after the next restart; new ranks and names use the instant letters right away.")
        for p in self.plugin.server.online_players:
            if p.is_op:
                p.send_message("§7New smooth gradient tags and names are ready. §eThey show after the next server restart.")
        return True

    def write_pack(self, pages):
        import io
        import zipfile
        manifest = {
            "format_version": 2,
            "header": {"name": "GalaxySMP Rank Tags", "description": "Smooth gradient rank tags (made by the GalaxyLink plugin)",
                       "uuid": PACK_UUID, "version": [1, 0, self.version], "min_engine_version": [1, 21, 40]},
            "modules": [{"type": "resources", "uuid": MODULE_UUID, "version": [1, 0, self.version]}],
        }
        buf = io.BytesIO()
        files = {f"glyph_{page:02X}.png": png(16 * CELL, 16 * CELL, pixels) for page, pixels in pages.items()}
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("manifest.json", json.dumps(manifest, indent=2))
            for name, data in files.items():
                z.writestr(f"font/{name}", data)
        path = self.pack_path()
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(buf.getvalue())
        tmp.replace(path)
        return fingerprint(files)

    def status(self):
        instant = "ready (new ranks and names get gradients instantly)" if self.active.get("__base__") == base_id() else "after the next restart"
        return (f"Gradient pictures: {'on' if self.enabled else 'off'}; the world loads version {self.installed or 'none'}, "
                f"newest built {self.version}; {len([k for k in self.active if k != '__base__'])} smooth tags/names; instant letters {instant}.")

    # ---------- /ranktags ----------
    def command(self, sender, args):
        what = " ".join(args).strip().lower()
        if what in ("chat on", "chat off"):
            self.chat_pictures = what == "chat on"
            self.save()
            sender.send_message("§7Chat style: " + ("§aDiscord style§7: a name line with the smooth gradient pictures, then messages in the normal font." if self.chat_pictures
                                else "§eone line§7: [RANK] Name: message, colored text only."))
            return
        if what in ("on", "off"):
            self.enabled = what == "on"
            self.save()
            refresh = getattr(self.plugin, "refresh_tags", None)
            if refresh:
                refresh()
        state = "§aon" if self.enabled else "§coff"
        ready = (f"installed (version {self.installed})" if self.active else
                 f"waiting for a server restart (built version {self.version}, the world has {self.installed or 'none'})")
        sender.send_message(f"§7Smooth gradient rank tags are {state}§7 (pictures {ready}; file: BDS-Addons/{FILE}). "
                            "Use /ranktags on or /ranktags off.")
        sender.send_message("§8- " + self.status())
        for line in pack_report():
            sender.send_message("§8- " + line)
