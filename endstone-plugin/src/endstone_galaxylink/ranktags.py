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
PAGES = list(range(0xE9, 0xF8))   # glyph pages E9-F7 (256 pictures each)
CELL = 16                          # pixels per picture (256x256 page = the same size as normal text)
UNIT = 2                           # pixels per Minecraft font pixel
FILE = "GalaxySMP_RankTags.mcpack"

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


def render_tag(text, stops):
    """[OWNER] or a name -> one 16x16 picture per character, with one smooth gradient across the whole text.
    Returns a list of (char, pixels or None for a space). pixels[y][x] = (r, g, b, a)."""
    chars = [(ch, font_char(ch)) for ch in text]
    total = sum((len(g[0]) + 1) * UNIT for ch, g in chars if g) or 1
    out, x0 = [], 0
    for ch, g in chars:
        if g is None:
            out.append((ch, None))
            continue
        w = len(g[0])
        px = [[(0, 0, 0, 0)] * CELL for _ in range(CELL)]
        for row, line in enumerate(g):
            for col, c in enumerate(line):
                if c != "#":
                    continue
                for dx in range(UNIT):
                    x = x0 + col * UNIT + dx
                    color = color_at(stops, x / max(1, total - UNIT - 1))
                    for dy in range(UNIT):
                        px[row * UNIT + dy][col * UNIT + dx] = (*color, 255)
        out.append((ch, px))
        x0 += (w + 1) * UNIT
    return out


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
    return lines


def signature(item):
    """What a text looks like (text + gradient colors): same signature = same pictures."""
    return json.dumps([item.get("text", ""), item.get("stops")], separators=(",", ":"))


class RankTags:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        cfg = self.eco.get_config("ranktags") or {}
        self.enabled = cfg.get("enabled", True)
        self.version = cfg.get("version", 0)
        self.built = cfg.get("built") or {}           # signature -> glyph string, in the pack file on disk
        self.history = cfg.get("history") or {}       # pack version -> its glyphs (the last few builds)
        # Only use pictures from the pack version the world really loaded (world_resource_packs.json).
        self.installed = installed_version(PACK_UUID)
        mapping = self.history.get(str(self.installed))
        if mapping is None and self.installed == self.version:  # built by an older plugin version (no history yet)
            mapping = self.built
        self.active = dict(mapping or {}) if self.installed else {}

    def save(self):
        keep = sorted(self.history, key=int)[-3:]
        self.history = {k: self.history[k] for k in keep}
        self.eco.set_config("ranktags", {"enabled": self.enabled, "version": self.version, "built": self.built, "history": self.history})

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
        return self.active.get(signature({"text": text, "stops": stops}))

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
        if set(want) == set(self.built):
            return False
        built, cp, pages = {}, 0, {}
        for sig, t in sorted(want.items()):
            text = t["text"]
            glyphs = []
            for ch, px in render_tag(text, t["stops"]):
                if px is None:
                    glyphs.append(ch)
                    continue
                if cp >= len(PAGES) * 256:
                    break
                page, idx = PAGES[cp // 256], cp % 256
                pages.setdefault(page, {})
                cx, cy = (idx % 16) * CELL, (idx // 16) * CELL
                for y, row in enumerate(px):
                    for x, c in enumerate(row):
                        if c[3]:
                            pages[page][(cx + x, cy + y)] = c
                glyphs.append(chr((page << 8) + idx))
                cp += 1
            built[sig] = "".join(glyphs)
        self.version += 1
        self.write_pack(pages)
        self.built = built
        self.history[str(self.version)] = built
        self.save()
        self.plugin.logger.info(f"Gradient pictures updated ({len(built)} tags and names). They show after the next server restart.")
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
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("manifest.json", json.dumps(manifest, indent=2))
            for page, pixels in pages.items():
                z.writestr(f"font/glyph_{page:02X}.png", png(16 * CELL, 16 * CELL, pixels))
        path = self.pack_path()
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(buf.getvalue())
        tmp.replace(path)

    # ---------- /ranktags ----------
    def command(self, sender, args):
        what = " ".join(args).strip().lower()
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
        for line in pack_report():
            sender.send_message("§8- " + line)
