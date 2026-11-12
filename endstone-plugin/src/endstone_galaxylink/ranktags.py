"""Rank badges as pictures.

Bedrock text can't use hex colors or backgrounds, but it can show small pictures. So the plugin draws
every rank tag (and the Galaxy+ / Pro+ plan tags) as a badge: a rounded pill in the rank's colors with
the rank's icon and name in white (badges.py), and packs them into a tiny resource pack:
    BDS-Addons/GalaxySMP_RankTags.mcpack
BisectHosting's add-on installer installs it when the server starts. When ranks change, the pack is
rebuilt by itself and the new badges show after the next restart (until then the tag is the normal
colored text [icon NAME], so nothing ever looks broken). Player names are normal colored text.

/ranktags off  switches back to the colored text right away; /ranktags on  turns badges back on.
"""

import json
import struct
import zlib
from pathlib import Path

from endstone_galaxylink.badges import render_badge

PACK_UUID = "c1a5e6f2-7b3d-4e9a-8f21-5d6c7b8a9e01"
MODULE_UUID = "d2b6f7a3-8c4e-4fab-9a32-6e7d8c9bae12"
PAGES = [0xE9, 0xEA, 0xEB]         # badge pictures (F7, F8 = GalaxySMP Icons)
CELL = 32                          # 512x512 pages: 32 picture pixels per cell = 16 text pixels (2 picture pixels per text pixel)
FILE = "GalaxySMP_RankTags.mcpack"
FORMAT = 7                         # bump when the drawing changes, so everything is rebuilt
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


def tiles(pixels, width):
    """Cuts a badge into CELL-wide pictures. Each piece but the last gets a nearly invisible pixel at its
    right edge so Minecraft keeps its full width (no gaps, no overlap); the last one is trimmed to the badge."""
    out = []
    for left in range(0, width, CELL):
        tile = {}
        for x in range(CELL):
            for y in range(CELL):
                c = pixels.get((left + x, y))
                if c:
                    tile[(x, y)] = c
        tile.setdefault((0, CELL - 1), (255, 255, 255, 1))
        if left + CELL < width:
            tile.setdefault((CELL - 1, CELL - 1), (255, 255, 255, 1))
        out.append(tile)
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


def signature(item):
    return json.dumps([FORMAT, "badge", item.get("prefix", ""), item.get("stops"), item.get("icon")], separators=(",", ":"))


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

    # ---------- used by ranks.tag_text ----------
    def glyphs_for(self, tag):
        """The badge pictures for a rank tag {"prefix", "stops", "icon"}, or None to use colored text."""
        if not self.enabled or not tag or not tag.get("prefix") or not tag.get("stops"):
            return None
        found = self.active.get(signature(tag))
        return found if isinstance(found, str) and found else None

    # ---------- building the pack ----------
    def wanted(self, items):
        """items: rank and plan tags {"prefix", "stops", "icon"}."""
        out = {}
        for t in items:
            if t and t.get("prefix") and t.get("stops"):
                item = {"prefix": t["prefix"], "stops": t["stops"], "icon": t.get("icon")}
                out[signature(item)] = item
        return out

    def refresh(self, tags):
        """Called when ranks arrive from the website: rebuild the pack if any tag changed."""
        want = self.wanted(tags)
        newest = self.history.get(str(self.version))
        fingerprinted = isinstance(newest, dict) and bool(newest.get("hash"))  # builds before 2.26.1 have none: rebuild once
        if fingerprinted and set(want) == set(self.built):
            return False
        built, pages = {}, {}
        cp = [0]

        def place(tile_list):
            chars = []
            for tile in tile_list:
                page, idx = PAGES[cp[0] // 256], cp[0] % 256
                cx, cy = (idx % 16) * CELL, (idx // 16) * CELL
                page_px = pages.setdefault(page, {})
                for (x, y), c in tile.items():
                    page_px[(cx + x, cy + y)] = c
                chars.append(chr((page << 8) + idx))
                cp[0] += 1
            return "".join(chars)

        for sig, t in sorted(want.items()):
            pixels, width, _ = render_badge(t["prefix"], t["stops"], t.get("icon"), font_char)
            if cp[0] + (width + CELL - 1) // CELL > len(PAGES) * 256:
                continue  # no room left: this one stays colored text
            built[sig] = place(tiles(pixels, width))
        self.version += 1
        prints = self.write_pack(pages)
        self.built = built
        self.history[str(self.version)] = {"glyphs": built, "hash": prints}
        self.save()
        self.plugin.logger.info(f"Rank badges updated ({len(built)} badges). They show after the next server restart.")
        for p in self.plugin.server.online_players:
            if p.is_op:
                p.send_message("§7New rank badges are ready. §eThey show after the next server restart.")
        return True

    def write_pack(self, pages):
        import io
        import zipfile
        manifest = {
            "format_version": 2,
            "header": {"name": "GalaxySMP Rank Tags", "description": "Rank badges (made by the GalaxyLink plugin)",
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
        return (f"Rank badges: {'on' if self.enabled else 'off'}; the world loads version {self.installed or 'none'}, "
                f"newest built {self.version}; {len(self.active)} badges ready.")

    # ---------- /ranktags ----------
    def command(self, sender, args):
        what = " ".join(args).strip().lower()
        if what in ("chat on", "chat off"):
            self.chat_pictures = what == "chat on"
            self.save()
            sender.send_message("§7Chat style: " + ("§aDiscord style§7: a name line with the rank badge, then messages in the normal font." if self.chat_pictures
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
        sender.send_message(f"§7Rank badges are {state}§7 (pictures {ready}; file: BDS-Addons/{FILE}). "
                            "Use /ranktags on or /ranktags off.")
        sender.send_message("§8- " + self.status())
        for line in pack_report():
            sender.send_message("§8- " + line)
