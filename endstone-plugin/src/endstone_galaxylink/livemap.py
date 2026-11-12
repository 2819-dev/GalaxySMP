"""Live server map for galaxymc.us/map.

Little by little, the land around online players is drawn from above: the colour of the top block of
every column, shaded by height like a Minecraft map (16 x 16 colours per chunk). Chunks are sent to
the website, which keeps them, so the map fills in as people explore. Only the Overworld is mapped.

Every few seconds the website also gets who is online and where (the map shows their heads), and once
a minute the markers: spawn, plots and shops.

To keep the server smooth, only a few chunks are drawn each time, nearest first, and a chunk is
redrawn at most every 10 minutes.
"""

import base64
import time

RADIUS = 5              # chunks around each player
PER_RUN = 3             # chunks drawn per run (every 2 seconds)
REDRAW_SECONDS = 600
LIVE_EVERY = 5          # seconds between live player updates
MARKERS_EVERY = 60

# Colours for common top blocks (Minecraft map colours, a little brighter). Anything else is
# matched by name further down.
COLORS = {
    "grass_block": (109, 153, 48), "dirt": (134, 96, 67), "coarse_dirt": (119, 85, 59), "podzol": (91, 63, 24),
    "rooted_dirt": (144, 103, 76), "mycelium": (111, 99, 105), "farmland": (116, 76, 45), "dirt_path": (148, 122, 65),
    "mud": (60, 57, 61), "clay": (160, 166, 179), "gravel": (131, 127, 126), "sand": (219, 207, 163),
    "red_sand": (190, 102, 33), "sandstone": (216, 203, 155), "red_sandstone": (186, 99, 29),
    "stone": (125, 125, 125), "cobblestone": (122, 122, 122), "mossy_cobblestone": (110, 118, 94), "deepslate": (80, 80, 82),
    "andesite": (136, 136, 136), "diorite": (188, 188, 188), "granite": (149, 103, 85), "tuff": (108, 109, 102),
    "calcite": (223, 224, 220), "bedrock": (85, 85, 85), "obsidian": (21, 18, 30),
    "water": (52, 92, 196), "flowing_water": (52, 92, 196), "ice": (145, 183, 253), "packed_ice": (141, 180, 250),
    "blue_ice": (116, 167, 253), "snow": (249, 254, 254), "snow_layer": (249, 254, 254), "powder_snow": (248, 253, 253),
    "lava": (207, 92, 20), "flowing_lava": (207, 92, 20), "magma": (142, 63, 31),
    "oak_leaves": (60, 110, 36), "spruce_leaves": (54, 86, 54), "birch_leaves": (88, 120, 52), "jungle_leaves": (48, 120, 20),
    "acacia_leaves": (76, 110, 30), "dark_oak_leaves": (44, 92, 22), "mangrove_leaves": (66, 112, 30),
    "cherry_leaves": (229, 172, 194), "azalea_leaves": (90, 116, 44), "flowering_azalea_leaves": (110, 116, 70),
    "oak_log": (102, 81, 50), "spruce_log": (58, 37, 16), "birch_log": (216, 215, 210), "jungle_log": (85, 67, 25),
    "acacia_log": (103, 96, 86), "dark_oak_log": (60, 46, 26), "cherry_log": (54, 33, 44), "mangrove_log": (84, 66, 36),
    "cactus": (85, 127, 43), "pumpkin": (198, 118, 24), "melon_block": (111, 145, 30), "hay_block": (166, 136, 38),
    "netherrack": (111, 54, 52), "glass": (190, 214, 222), "white_wool": (233, 236, 236), "white_concrete": (207, 213, 214),
    "bricks": (150, 97, 83), "stone_bricks": (122, 121, 122), "quartz_block": (235, 229, 222), "smooth_stone": (158, 158, 158),
    "glowstone": (171, 131, 84), "sea_lantern": (172, 199, 190), "lily_pad": (32, 128, 48), "kelp": (52, 92, 196),
    "seagrass": (52, 92, 196), "short_grass": (109, 153, 48), "tall_grass": (109, 153, 48), "fern": (95, 140, 50),
}
# Keywords for blocks not listed above (first match wins).
KEYWORDS = [
    ("leaves", (64, 108, 36)), ("log", (102, 81, 50)), ("wood", (102, 81, 50)), ("planks", (162, 130, 78)),
    ("water", (52, 92, 196)), ("ice", (145, 183, 253)), ("snow", (249, 254, 254)), ("sand", (219, 207, 163)),
    ("terracotta", (152, 94, 67)), ("concrete", (160, 160, 160)), ("wool", (210, 210, 210)), ("glass", (190, 214, 222)),
    ("brick", (150, 97, 83)), ("andesite", (136, 136, 136)), ("diorite", (188, 188, 188)), ("granite", (149, 103, 85)),
    ("deepslate", (80, 80, 82)), ("cobble", (122, 122, 122)), ("tuff", (108, 109, 102)), ("stone", (125, 125, 125)), ("slab", (150, 150, 150)), ("stairs", (150, 150, 150)),
    ("flower", (190, 60, 70)), ("tulip", (200, 80, 80)), ("rose", (190, 30, 40)), ("dandelion", (230, 210, 40)),
    ("mushroom", (150, 110, 90)), ("coral", (180, 80, 140)), ("crop", (120, 160, 50)), ("wheat", (186, 160, 70)),
    ("carrots", (120, 160, 50)), ("potatoes", (120, 160, 50)), ("vine", (60, 110, 36)), ("grass", (109, 153, 48)),
    ("dirt", (134, 96, 67)), ("copper", (190, 110, 80)), ("prismarine", (99, 156, 151)), ("quartz", (235, 229, 222)),
    ("nether", (111, 54, 52)), ("blackstone", (42, 36, 41)), ("basalt", (80, 80, 86)), ("end_stone", (219, 222, 158)),
    ("purpur", (169, 125, 169)), ("bamboo", (95, 145, 40)), ("moss", (89, 109, 45)), ("amethyst", (133, 97, 191)),
]
COLORS_DYED = {"white": (233, 236, 236), "orange": (240, 118, 19), "magenta": (189, 68, 179), "light_blue": (58, 175, 217),
               "yellow": (248, 197, 39), "lime": (112, 185, 25), "pink": (237, 141, 172), "gray": (62, 68, 71),
               "light_gray": (142, 142, 134), "cyan": (21, 137, 145), "purple": (121, 42, 172), "blue": (53, 57, 157),
               "brown": (114, 71, 40), "green": (84, 109, 27), "red": (161, 39, 34), "black": (20, 21, 25)}
UNKNOWN = (120, 120, 120)
_cache = {}


def color_of(block_id):
    c = _cache.get(block_id)
    if c is not None:
        return c
    name = block_id.split(":", 1)[-1]
    c = COLORS.get(name)
    if c is None and any(name.endswith(s) for s in ("_wool", "_concrete", "_terracotta", "_carpet", "_stained_glass", "_concrete_powder")):
        for dye, col in sorted(COLORS_DYED.items(), key=lambda kv: -len(kv[0])):
            if name.startswith(dye + "_"):
                c = col
                break
    if c is None:
        c = next((col for key, col in KEYWORDS if key in name), UNKNOWN)
    _cache[block_id] = c
    return c


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c)


class LiveMap:
    def __init__(self, plugin):
        self.plugin = plugin
        self.drawn = {}          # (cx, cz) -> time drawn
        self.next_live = 0
        self.next_markers = 0
        self.sent = 0            # chunks sent since the server started
        self.last_error = None   # the last problem, shown in the Control Panel
        self.method = None       # how the top block is read (some server versions lack the fast way)
        self.started = False

    def voice(self):
        v = getattr(self.plugin, "_voice", None)
        return v if v is not None and getattr(v, "ws", None) else None

    def tick(self):
        """Every 2 seconds."""
        voice = self.voice()
        if voice is None:
            return
        if not self.started:
            self.started = True
            self.plugin.logger.info("Live map: drawing the Overworld around players for galaxymc.us/map")
        now = time.time()
        try:
            self.draw_some(voice, now)
        except Exception as e:
            self.fail(f"Map drawing failed: {e}")
        if now >= self.next_live:
            self.next_live = now + LIVE_EVERY
            try:
                self.send_live(voice)
            except Exception as e:
                self.fail(f"Map players failed: {e}")
        if now >= self.next_markers:
            self.next_markers = now + MARKERS_EVERY
            try:
                self.send_markers(voice)
            except Exception as e:
                self.fail(f"Map markers failed: {e}")

    def fail(self, text):
        if text != self.last_error:  # log each new problem once, not every 2 seconds
            self.plugin.logger.warning(text)
        self.last_error = text

    # ---------- the land ----------
    def wanted(self, now):
        """Chunks near Overworld players that need (re)drawing, nearest first."""
        seen = {}
        for p in self.plugin.server.online_players:
            try:
                if p.dimension.type.name.lower() != "overworld":
                    continue
                l = p.location
            except Exception:
                continue
            pcx, pcz = int(l.x) >> 4, int(l.z) >> 4
            for dx in range(-RADIUS, RADIUS + 1):
                for dz in range(-RADIUS, RADIUS + 1):
                    if dx * dx + dz * dz > RADIUS * RADIUS:
                        continue
                    key = (pcx + dx, pcz + dz)
                    if now - self.drawn.get(key, 0) < REDRAW_SECONDS:
                        continue
                    d = dx * dx + dz * dz
                    if key not in seen or d < seen[key][0]:
                        seen[key] = (d, p.dimension)
        return sorted(((d, key, dim) for key, (d, dim) in seen.items()), key=lambda t: t[0])

    def draw_some(self, voice, now):
        todo = self.wanted(now)[:PER_RUN]
        if not todo:
            return
        chunks = []
        for _, (cx, cz), dim in todo:
            rgb = self.draw_chunk(dim, cx, cz)
            self.drawn[(cx, cz)] = now
            if rgb is not None:
                chunks.append({"cx": cx, "cz": cz, "rgb": base64.b64encode(rgb).decode("ascii")})
        if len(self.drawn) > 20000:  # forget the oldest so memory stays small
            for k in sorted(self.drawn, key=self.drawn.get)[:5000]:
                self.drawn.pop(k, None)
        if chunks:
            voice.send_json({"type": "map_chunks", "dim": "overworld", "chunks": chunks})
            self.sent += len(chunks)
            if self.last_error and self.last_error.startswith("Map drawing failed"):
                self.last_error = None

    def draw_chunk(self, dim, cx, cz):
        x0, z0 = cx * 16, cz * 16
        heights = {}

        def top(x, z):
            # Fast way first; if this server version doesn't have it, read the height and then the block.
            if self.method != "slow":
                try:
                    b = dim.get_highest_block_at(x, z)
                    self.method = "fast"
                    return b.y, b.type
                except (AttributeError, TypeError):
                    if self.method == "fast":
                        raise
                    self.method = "slow"
            y = dim.get_highest_block_y_at(x, z)
            return y, dim.get_block_at(x, y, z).type

        # The row just north of the chunk, for shading the first row.
        north = []
        for i in range(16):
            try:
                north.append(dim.get_highest_block_y_at(x0 + i, z0 - 1))
            except Exception:
                north.append(None)
        out = bytearray(768)
        blank = 0
        errors = []
        for j in range(16):
            for i in range(16):
                try:
                    y, kind = top(x0 + i, z0 + j)
                except Exception as e:
                    y, kind = None, None
                    errors.append(e)
                heights[(i, j)] = y
                if y is None or kind in (None, "minecraft:air"):
                    c = (0, 0, 0)
                    blank += 1
                else:
                    c = color_of(str(kind))
                    above = heights.get((i, j - 1)) if j else north[i]
                    if above is not None and "water" not in str(kind):
                        c = shade(c, 1.12 if y > above else 0.82 if y < above else 1.0)
                    elif "water" in str(kind):
                        c = shade(c, 0.95 + ((i + j) % 2) * 0.05)
                k = (j * 16 + i) * 3
                out[k], out[k + 1], out[k + 2] = c
        if len(errors) == 256:
            raise RuntimeError(f"couldn't read the ground ({type(errors[0]).__name__}: {errors[0]})")
        return None if blank == 256 else bytes(out)

    # ---------- players and markers ----------
    def send_live(self, voice):
        players = []
        for p in self.plugin.server.online_players:
            try:
                if p.dimension.type.name.lower() != "overworld":
                    continue
                l = p.location
                players.append({"name": p.name, "xuid": str(p.xuid), "x": round(l.x, 1), "z": round(l.z, 1), "yaw": round(l.yaw)})
            except Exception:
                continue
        voice.send_json({"type": "map_live", "players": players})

    def send_markers(self, voice):
        markers = []
        spawn = self.plugin.economy.get_config("spawn")
        if spawn and str(spawn.get("dim", "")).lower() == "overworld":
            markers.append({"kind": "spawn", "label": "Spawn", "x": round(spawn["x"]), "z": round(spawn["z"])})
        plots = []
        for p in self.plugin.plots.plots.values():
            if str(p.get("dim", "")).lower() != "overworld" or p.get("status") == "saving":
                continue
            kind = "area" if p.get("kind") == "area" else "shop" if p.get("shop") else "plot"
            plots.append({"kind": kind, "label": self.plugin.plots.label(p) if kind != "plot" or p.get("name") else "",
                          "owner": p.get("owner_name") or "", "x1": p["x1"], "z1": p["z1"], "x2": p["x2"], "z2": p["z2"]})
        voice.send_json({"type": "map_markers", "markers": markers, "plots": plots[:2000],
                         "status": {"sent": self.sent, "error": self.last_error, "method": self.method}})
