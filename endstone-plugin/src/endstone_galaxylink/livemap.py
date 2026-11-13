"""Live server map for galaxymc.us/map.

Little by little, the land around online players is drawn from above exactly like a Minecraft paper map:
Minecraft's own map colour for the top block of every column, shaded by height the way a map item does,
and water darker where it's deep (16 x 16 colours per chunk), plus the height of every column for the
website's 3D view. Chunks are sent to
the website, which keeps them, so the map fills in as people explore. Only the Overworld is mapped.

Every few seconds the website also gets who is online and where (the map shows their heads), and once
a minute the markers: spawn, plots and shops.

To keep the server smooth, only a few chunks are drawn each time, nearest first, and a chunk is
redrawn at most every 10 minutes. Only chunks the server already has loaded are read: reading blocks in
a chunk that isn't loaded can crash the server.
"""

import base64
import time

RADIUS = 5              # chunks around each player
PER_RUN = 3             # chunks drawn per run (every 2 seconds)
REDRAW_SECONDS = 600
STYLE = 3               # map look version (2 = Minecraft map item, 3 = with heights for the 3D view)
LIVE_EVERY = 5          # seconds between live player updates
MARKERS_EVERY = 60

# Minecraft's map colours (the ones a paper map item uses), and which block gets which.
MC = {
    "grass": (127, 178, 56), "sand": (247, 233, 163), "wool": (199, 199, 199), "fire": (255, 0, 0), "ice": (160, 160, 255),
    "metal": (167, 167, 167), "plant": (0, 124, 0), "snow": (255, 255, 255), "clay": (164, 168, 184), "dirt": (151, 109, 77),
    "stone": (112, 112, 112), "water": (64, 64, 255), "wood": (143, 119, 72), "quartz": (255, 252, 245),
    "orange": (216, 127, 51), "magenta": (178, 76, 216), "light_blue": (102, 153, 216), "yellow": (229, 229, 51),
    "lime": (127, 204, 25), "pink": (242, 127, 165), "gray": (76, 76, 76), "light_gray": (153, 153, 153), "cyan": (76, 127, 153),
    "purple": (127, 63, 178), "blue": (51, 76, 178), "brown": (102, 76, 51), "green": (102, 127, 51), "red": (153, 51, 51),
    "black": (25, 25, 25), "gold": (250, 238, 77), "diamond": (92, 219, 213), "lapis": (74, 128, 255), "emerald": (0, 217, 58),
    "podzol": (129, 86, 49), "nether": (112, 2, 0), "deepslate": (100, 100, 100), "raw_iron": (216, 175, 147),
    "t_white": (209, 177, 161), "t_orange": (159, 82, 36), "t_magenta": (149, 87, 108), "t_light_blue": (112, 108, 138),
    "t_yellow": (186, 133, 36), "t_lime": (103, 117, 53), "t_pink": (160, 77, 78), "t_gray": (57, 41, 35),
    "t_light_gray": (135, 107, 98), "t_cyan": (87, 92, 92), "t_purple": (122, 73, 88), "t_blue": (76, 62, 92),
    "t_brown": (76, 50, 35), "t_green": (76, 82, 42), "t_red": (142, 60, 46), "t_black": (37, 22, 16),
    "crimson": (189, 48, 49), "warped": (22, 126, 134), "warped_wart": (20, 180, 133),
}
BLOCKS = {
    "grass_block": "grass", "dirt": "dirt", "coarse_dirt": "dirt", "rooted_dirt": "dirt", "farmland": "dirt", "dirt_path": "dirt",
    "podzol": "podzol", "mycelium": "purple", "mud": "t_cyan", "clay": "clay", "gravel": "stone", "sand": "sand",
    "red_sand": "orange", "sandstone": "sand", "red_sandstone": "orange", "stone": "stone", "cobblestone": "stone",
    "mossy_cobblestone": "stone", "andesite": "stone", "diorite": "quartz", "granite": "dirt", "tuff": "t_gray",
    "calcite": "t_white", "deepslate": "deepslate", "bedrock": "stone", "obsidian": "black", "crying_obsidian": "black",
    "water": "water", "flowing_water": "water", "ice": "ice", "packed_ice": "ice", "blue_ice": "ice", "frosted_ice": "ice",
    "snow": "snow", "snow_layer": "snow", "powder_snow": "snow", "lava": "fire", "flowing_lava": "fire", "magma": "nether",
    "cherry_leaves": "pink", "pumpkin": "orange", "carved_pumpkin": "orange", "melon_block": "lime", "hay_block": "yellow",
    "netherrack": "nether", "bricks": "red", "brick_block": "red", "quartz_block": "quartz", "glowstone": "sand",
    "sea_lantern": "quartz", "gold_block": "gold", "diamond_block": "diamond", "emerald_block": "emerald",
    "lapis_block": "lapis", "iron_block": "metal", "raw_iron_block": "raw_iron", "white_wool": "snow", "terracotta": "orange",
    "hardened_clay": "orange", "end_stone": "sand", "slime": "grass", "honey_block": "orange", "bookshelf": "wood",
    "crafting_table": "wood", "chest": "wood", "barrel": "wood", "tnt": "fire", "moss_block": "green", "moss_carpet": "green",
    "amethyst_block": "purple", "copper_block": "orange", "prismarine": "cyan", "dark_prismarine": "diamond",
    "basalt": "black", "blackstone": "black", "soul_sand": "brown", "soul_soil": "brown", "crimson_nylium": "crimson",
    "warped_nylium": "warped", "nether_wart_block": "red", "warped_wart_block": "warped_wart",
}
# Wood colours by type (logs from above, planks, slabs, stairs, fences...)
WOODS = {"oak": "wood", "spruce": "podzol", "birch": "sand", "jungle": "dirt", "acacia": "orange", "dark_oak": "brown",
         "mangrove": "red", "cherry": "t_white", "bamboo": "yellow", "crimson": "crimson", "warped": "warped", "pale_oak": "quartz"}
DYES = ["light_blue", "light_gray", "white", "orange", "magenta", "yellow", "lime", "pink", "gray", "cyan", "purple",
        "blue", "brown", "green", "red", "black", "silver"]
# Keywords for everything else (first match wins).
KEYWORDS = [
    ("leaves", "plant"), ("grass", "plant"), ("fern", "plant"), ("flower", "plant"), ("tulip", "plant"), ("rose", "plant"),
    ("dandelion", "plant"), ("poppy", "plant"), ("orchid", "plant"), ("allium", "plant"), ("daisy", "plant"), ("bluet", "plant"),
    ("sapling", "plant"), ("vine", "plant"), ("lily", "plant"), ("cactus", "plant"), ("bush", "plant"), ("crop", "plant"),
    ("wheat", "plant"), ("carrots", "plant"), ("potatoes", "plant"), ("beetroot", "plant"), ("bamboo", "plant"),
    ("kelp", "water"), ("seagrass", "water"), ("coral", "pink"), ("mushroom", "brown"),
    ("water", "water"), ("ice", "ice"), ("snow", "snow"), ("sand", "sand"), ("glass", "quartz"), ("quartz", "quartz"),
    ("brick", "red"), ("deepslate", "deepslate"), ("cobble", "stone"), ("stone", "stone"), ("andesite", "stone"),
    ("ore", "stone"), ("copper", "orange"), ("prismarine", "cyan"), ("nether", "nether"), ("blackstone", "black"),
    ("purpur", "magenta"), ("amethyst", "purple"), ("moss", "green"), ("rail", "metal"), ("iron", "metal"),
    ("dirt", "dirt"), ("mud", "t_cyan"), ("rail", "metal"), ("torch", "wood"), ("door", "wood"), ("sign", "wood"),
]
UNKNOWN = MC["stone"]
_cache = {}


def color_of(block_id):
    """The Minecraft map colour of a block."""
    c = _cache.get(block_id)
    if c is not None:
        return c
    name = block_id.split(":", 1)[-1]
    key = BLOCKS.get(name)
    if key is None and any(w in name for w in ("_log", "_wood", "_planks", "_slab", "_stairs", "_fence", "_stem", "_hyphae", "_trapdoor")):
        for wood in sorted(WOODS, key=len, reverse=True):
            if name.startswith(wood + "_") or name.startswith("stripped_" + wood + "_"):
                key = WOODS[wood]
                break
    if key is None and any(name.endswith(s) for s in ("_wool", "_concrete", "_carpet", "_stained_glass", "_concrete_powder", "_terracotta",
                                                       "_glazed_terracotta", "_shulker_box", "_candle", "_bed", "_banner")):
        for dye in DYES:
            if name.startswith(dye + "_"):
                d = "light_gray" if dye == "silver" else dye
                key = ("t_" + d) if name.endswith("_terracotta") and "glazed" not in name else ("snow" if d == "white" and name.endswith("_wool") else d)
                break
    if key is None and "leaves" in name and name.startswith("cherry"):
        key = "pink"
    if key is None:
        key = next((k for word, k in KEYWORDS if word in name), None)
    c = MC.get(key, UNKNOWN) if key else UNKNOWN
    _cache[block_id] = c
    return c


# Minecraft's map shading: a block higher than the one north of it is brightest, the same height is a bit
# darker, lower is darker still (255, 220, 180 out of 255).
BRIGHT, NORMAL, DARK = 1.0, 220 / 255, 180 / 255


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
        self.enabled = False     # switched on from the Control Panel (the website tells us when we connect)

    def voice(self):
        v = getattr(self.plugin, "_voice", None)
        return v if v is not None and getattr(v, "ws", None) else None

    def tick(self):
        """Every 2 seconds."""
        voice = self.voice()
        if voice is None or not self.enabled:
            return
        if not self.started:
            self.started = True
            pass
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

    def set_enabled(self, on):
        if bool(on) != self.enabled:
            self.enabled = bool(on)
            self.plugin.logger.info("Live map: on (drawing for galaxymc.us/map)" if on else "Live map: off (switched off in the Control Panel)")
            self.next_live = self.next_markers = 0

    def fail(self, text):
        if text != self.last_error:  # log each new problem once, not every 2 seconds
            self.plugin.logger.warning(text)
        self.last_error = text

    # ---------- the land ----------
    @staticmethod
    def loaded(dim):
        """{(cx, cz)} of the chunks this dimension has loaded right now."""
        out = set()
        for c in dim.loaded_chunks:
            try:
                out.add((c.x, c.z))
            except Exception:
                continue
        return out

    def wanted(self, now):
        """Chunks near Overworld players that need (re)drawing (and are loaded), nearest first."""
        seen = {}
        loaded = None
        for p in self.plugin.server.online_players:
            try:
                if p.dimension.type.name.lower() != "overworld":
                    continue
                l = p.location
                if loaded is None:
                    loaded = self.loaded(p.dimension)
            except Exception:
                continue
            pcx, pcz = int(l.x) >> 4, int(l.z) >> 4
            for dx in range(-RADIUS, RADIUS + 1):
                for dz in range(-RADIUS, RADIUS + 1):
                    if dx * dx + dz * dz > RADIUS * RADIUS:
                        continue
                    key = (pcx + dx, pcz + dz)
                    if key not in loaded or now - self.drawn.get(key, 0) < REDRAW_SECONDS:
                        continue
                    d = dx * dx + dz * dz
                    if key not in seen or d < seen[key][0]:
                        seen[key] = (d, p.dimension)
        self.loaded_now = loaded or set()
        return sorted(((d, key, dim) for key, (d, dim) in seen.items()), key=lambda t: t[0])

    def draw_some(self, voice, now):
        todo = self.wanted(now)[:PER_RUN]
        if not todo:
            return
        chunks = []
        for _, (cx, cz), dim in todo:
            drawn = self.draw_chunk(dim, cx, cz)
            self.drawn[(cx, cz)] = now
            if drawn is not None:
                rgb, heights = drawn
                chunks.append({"cx": cx, "cz": cz, "rgb": base64.b64encode(rgb).decode("ascii"),
                               "h": base64.b64encode(heights).decode("ascii")})
        if len(self.drawn) > 20000:  # forget the oldest so memory stays small
            for k in sorted(self.drawn, key=self.drawn.get)[:5000]:
                self.drawn.pop(k, None)
        if chunks:
            voice.send_json({"type": "map_chunks", "dim": "overworld", "style": STYLE, "chunks": chunks})
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
        north_loaded = (cx, cz - 1) in getattr(self, "loaded_now", ())
        for i in range(16):
            try:
                north.append(dim.get_highest_block_y_at(x0 + i, z0 - 1) if north_loaded else None)
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
                    name = str(kind)
                    c = color_of(name)
                    if c == MC["water"]:
                        # deep water is darker, with Minecraft's checkered look in between
                        depth = 1
                        while depth < 10:
                            try:
                                below = str(dim.get_block_at(x0 + i, y - depth, z0 + j).type)
                            except Exception:
                                break
                            if "water" not in below and "kelp" not in below and "seagrass" not in below:
                                break
                            depth += 1
                        d = depth * 0.1 + ((i + j) & 1) * 0.2
                        c = shade(c, BRIGHT if d < 0.5 else DARK if d > 0.9 else NORMAL)
                    else:
                        above = heights.get((i, j - 1)) if j else north[i]
                        f = NORMAL if above is None else BRIGHT if y > above else DARK if y < above else NORMAL
                        c = shade(c, f)
                k = (j * 16 + i) * 3
                out[k], out[k + 1], out[k + 2] = c
        if len(errors) == 256:
            raise RuntimeError(f"couldn't read the ground ({type(errors[0]).__name__}: {errors[0]})")
        if blank == 256:
            return None
        # heights for the 3D view: y + 65 as 16-bit numbers (0 = nothing there)
        hb = bytearray(512)
        for j in range(16):
            for i in range(16):
                y = heights.get((i, j))
                v = 0 if y is None else max(1, min(65535, int(y) + 65))
                k = (j * 16 + i) * 2
                hb[k], hb[k + 1] = v & 255, v >> 8
        return bytes(out), bytes(hb)

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
            # (the website only shows a player's plot to others once it's public; it shows free plots to everyone)
            plots.append({"kind": kind, "label": self.plugin.plots.label(p) if kind != "plot" or p.get("name") else "",
                          "owner": p.get("owner_name") or "", "owner_xuid": p.get("owner") or None, "public": bool(p.get("public")),
                          "id": p.get("id"), "x1": p["x1"], "z1": p["z1"], "x2": p["x2"], "z2": p["z2"]})
        voice.send_json({"type": "map_markers", "markers": markers, "plots": plots[:2000],
                         "status": {"sent": self.sent, "error": self.last_error, "method": self.method}})
