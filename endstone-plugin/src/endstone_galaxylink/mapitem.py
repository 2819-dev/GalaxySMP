"""/map: a map item that shows the GalaxySMP server map, the same one as galaxymc.us/map.

It's drawn from the land the website has already mapped (so it shows explored places, not just what's
loaded), centered on whoever is holding it, with arrows for online players and a marker for spawn.
Everyone shares one map item; each player sees their own area. /map again changes the zoom.

The picture comes from the website on a background thread, so the server never waits for it. Nothing
here reads blocks from the world.
"""

import base64
import threading
import time

from endstone import Player
from endstone.form import ActionForm

SIZE = 128                  # map pixels per side
ZOOMS = [1, 2, 4]           # blocks per pixel (128, 256 or 512 blocks across)
REFRESH = 90                # seconds before the picture is fetched again
MARK = "§0§8galaxy-map"     # hidden lore line that marks our map item
# Plot outlines, like the website map: yours, public plots and free plots (other private plots aren't shown)
MINE, PUBLIC, FREE = (79, 235, 253), (176, 120, 255), (63, 191, 127)

try:
    import numpy as np
    from endstone.map import MapCursor, MapRenderer
except Exception:   # older Endstone: no maps
    np = MapRenderer = MapCursor = None


if MapRenderer is not None:
    class _Renderer(MapRenderer):
        def __init__(self, owner):
            super().__init__(True)   # contextual: each player gets their own picture
            self.owner = owner

        def render(self, view, canvas, player):
            try:
                self.owner.render(canvas, player)
            except Exception as e:
                self.owner.fail(e)


class GalaxyMap:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.view = None
        self.renderer = None
        self.state = {}       # uuid -> {"img", "x0", "z0", "zoom", "at", "busy", "ver", "drawn", "calls"}
        self.zoom = {}        # uuid -> index into ZOOMS
        self.last_error = None

    def fail(self, e):
        text = f"Map item: {e}"
        if text != self.last_error:
            self.plugin.logger.warning(text)
        self.last_error = text

    # ---------- the shared map view ----------
    def setup(self):
        """Run a few seconds after start: re-attach our drawing to the saved map (if any)."""
        if MapRenderer is None or self.view is not None:
            return self.view
        try:
            server = self.plugin.server
            v = None
            mid = self.eco.get_config("galaxy_map_id")
            if mid is not None:
                try:
                    v = server.get_map(int(mid))
                except Exception:
                    v = None
            if v is None:
                v = server.create_map(server.level.get_dimension("Overworld"))
                self.eco.set_config("galaxy_map_id", int(v.id))
            for r in list(v.renderers):   # no vanilla drawing on top of ours
                v.remove_renderer(r)
            self.renderer = _Renderer(self)
            v.add_renderer(self.renderer)
            try:
                v.locked = True
                v.is_unlimited_tracking = False
            except Exception:
                pass
            self.view = v
        except Exception as e:
            self.fail(f"couldn't set up the map ({e})")
        return self.view

    # ---------- /map ----------
    def command(self, player, args):
        if not isinstance(player, Player):
            return player.send_message("/map can only be used in game.")
        if MapRenderer is None or self.setup() is None:
            return player.send_message("§cThe map isn't available on this server version. See it at §bgalaxymc.us/map")
        uid = str(player.unique_id)
        if args and args[0].lower() in ("zoom", "in", "out"):
            return self.change_zoom(player, args[0].lower())
        if not self.has_map(player):
            return self.give(player)
        z = ZOOMS[self.zoom.get(uid, 1)]
        form = ActionForm(title="§l§bServer Map", content=f"Hold the map to see the area around you.\n\n§7Zoom: §f{SIZE * z} blocks across\n§7Full map: §bgalaxymc.us/map")
        form.add_button("§lZoom in§r\n§8See more detail", icon="textures/ui/magnifyingGlass", on_click=lambda p: self.change_zoom(p, "in"))
        form.add_button("§lZoom out§r\n§8See a bigger area", icon="textures/items/map_filled", on_click=lambda p: self.change_zoom(p, "out"))
        form.add_button("§lGet another map§r\n§8If you lost yours", icon="textures/items/map_empty", on_click=self.give)
        player.send_form(form)

    def change_zoom(self, player, how):
        uid = str(player.unique_id)
        i = self.zoom.get(uid, 1)
        i = max(0, i - 1) if how == "in" else min(len(ZOOMS) - 1, i + 1) if how == "out" else (i + 1) % len(ZOOMS)
        self.zoom[uid] = i
        self.state.pop(uid, None)   # fetch a new picture
        player.send_message(f"§bMap zoom: §f{SIZE * ZOOMS[i]} blocks across§7.")

    def make_item(self):
        from endstone.inventory import ItemStack
        stack = ItemStack("minecraft:filled_map", 1)
        meta = stack.item_meta
        meta.map_view = self.view
        meta.display_name = "§r§bGalaxySMP Map"
        meta.lore = ["§7The server map, centered on you.", "§7/map to zoom", MARK]
        stack.set_item_meta(meta)
        return stack

    def has_map(self, player):
        inv = player.inventory
        for i in range(inv.size):
            s = inv.get_item(i)
            try:
                if s is not None and MARK in (s.item_meta.lore or []):
                    return True
            except Exception:
                continue
        return False

    def give(self, player):
        from endstone_galaxylink import money
        try:
            money.give(player, self.make_item())
        except Exception as e:
            self.fail(e)
            return player.send_message("§cCouldn't give you the map. See it at §bgalaxymc.us/map")
        player.send_message("§aHere's the server map! §7Hold it to see the area around you. §e/map§7 to zoom.")

    # ---------- drawing (called by the game while someone holds the map) ----------
    def render(self, canvas, player):
        uid = str(player.unique_id)
        st = self.state.get(uid)
        try:
            if player.dimension.type.name.lower() != "overworld":
                return
        except Exception:
            return
        l = player.location
        zoom = ZOOMS[self.zoom.get(uid, 1)]
        now = time.time()
        if st is None:
            st = self.state[uid] = {"img": None, "x0": 0, "z0": 0, "zoom": zoom, "at": 0, "busy": False, "ver": 0, "drawn": -1, "calls": 0}
        # a new picture when you walk near its edge, change zoom, or it's old
        if not st["busy"]:
            far = st["img"] is None or not (st["x0"] + 32 * zoom < l.x < st["x0"] + 96 * zoom and st["z0"] + 32 * zoom < l.z < st["z0"] + 96 * zoom)
            if ((far or st["zoom"] != zoom) and now - st["at"] > 5) or now - st["at"] > REFRESH:
                self.fetch(uid, st, int(l.x), int(l.z), zoom)
        st["calls"] += 1
        if st["img"] is not None and (st["drawn"] != st["ver"] or st["calls"] % 40 == 0):
            canvas.draw_image(0, 0, self.with_plots(st, str(player.xuid)))
            st["drawn"] = st["ver"]
        if st["img"] is not None and st["calls"] % 4 == 0:
            canvas.cursors = self.cursors(player, st)

    def with_plots(self, st, xuid):
        """The map picture with plot outlines drawn on it (a copy: the picture itself stays clean)."""
        img = st["img"]
        plots = getattr(getattr(self.plugin, "plots", None), "plots", None) or {}
        x0, z0, zoom = st["x0"], st["z0"], st["zoom"]
        out = None
        for p in list(plots.values()):
            try:
                if str(p.get("dim", "")).lower() != "overworld" or p.get("status") not in (None, "ready") or p.get("kind") == "area":
                    continue
                owner = p.get("owner")
                color = MINE if owner and str(owner) == xuid else PUBLIC if owner and p.get("public") else FREE if not owner and not p.get("shop") else None
                if color is None:
                    continue
                a, b = int((p["x1"] - x0) // zoom), int((p["x2"] - x0) // zoom)
                c, d = int((p["z1"] - z0) // zoom), int((p["z2"] - z0) // zoom)
                if b < 0 or d < 0 or a >= SIZE or c >= SIZE:
                    continue
                if out is None:
                    out = img.copy()
                ca, cb, cc, cd = max(a, 0), min(b, SIZE - 1), max(c, 0), min(d, SIZE - 1)
                if 0 <= c < SIZE: out[c, ca:cb + 1] = color
                if 0 <= d < SIZE: out[d, ca:cb + 1] = color
                if 0 <= a < SIZE: out[cc:cd + 1, a] = color
                if 0 <= b < SIZE: out[cc:cd + 1, b] = color
            except Exception:
                continue
        return img if out is None else out

    def cursors(self, me, st):
        def spot(x, z):
            px = (x - st["x0"]) / st["zoom"]
            pz = (z - st["z0"]) / st["zoom"]
            if not (0 <= px < SIZE and 0 <= pz < SIZE):
                return None
            return max(-128, min(127, int(px * 2 - 128))), max(-128, min(127, int(pz * 2 - 128)))

        def facing(yaw):
            return int(round(((yaw or 0) + 180) / 22.5)) % 16

        out = []
        spawn = self.eco.get_config("spawn")
        if spawn and str(spawn.get("dim", "")).lower() == "overworld":
            s = spot(spawn["x"], spawn["z"])
            if s:
                out.append(MapCursor(s[0], s[1], 8, MapCursor.Type.RED_MARKER, True, "Spawn"))
        for p in self.plugin.server.online_players:
            if p is me:
                continue
            try:
                if p.dimension.type.name.lower() != "overworld":
                    continue
                pl = p.location
                s = spot(pl.x, pl.z)
                if s:
                    out.append(MapCursor(s[0], s[1], facing(pl.yaw), MapCursor.Type.BLUE_MARKER, True, p.name))
            except Exception:
                continue
        ml = me.location
        s = spot(ml.x, ml.z)
        if s:
            out.append(MapCursor(s[0], s[1], facing(ml.yaw), MapCursor.Type.PLAYER, True, ""))
        return out[:40]

    def fetch(self, uid, st, x, z, zoom):
        st["busy"] = True

        def work():
            img = None
            try:
                status, data = self.plugin._request("/api/plugin/map-image", {"x": x, "z": z, "zoom": zoom})
                if status == 200 and data.get("ok") and data.get("rgb"):
                    raw = base64.b64decode(data["rgb"])
                    if len(raw) == SIZE * SIZE * 3:
                        img = np.frombuffer(raw, dtype=np.uint8).reshape(SIZE, SIZE, 3).copy()
                        x0, z0 = int(data["x0"]), int(data["z0"])
            except Exception as e:
                self.plugin.server.scheduler.run_task(self.plugin, lambda msg=str(e): self.fail(f"couldn't get the picture ({msg})"))

            def done():
                st["busy"] = False
                st["at"] = time.time()
                if img is not None:
                    st.update(img=img, x0=x0, z0=z0, zoom=zoom, ver=st["ver"] + 1)
            self.plugin.server.scheduler.run_task(self.plugin, done)
        threading.Thread(target=work, name="galaxy-map", daemon=True).start()

    def on_quit(self, player):
        uid = str(player.unique_id)
        self.state.pop(uid, None)
