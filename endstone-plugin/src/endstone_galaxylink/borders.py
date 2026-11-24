"""World borders: every server (the main world, the Sift, and any other Featured Server) has its own border.

Nobody can walk, fly, ride or throw a pearl out of a border; they're put back where they just were. The Sift and the
other servers are outside the main world's border, so the only way in is the Main Menu or a portal. Only the owner
(a player with the Owner rank) can go outside.

The Border Axe (operators, /border axe): tap one corner, then the opposite corner, then pick which server the border
belongs to. Crouch + tap inside a border with the axe to see or remove it. /border list shows them all.
Defaults (until changed with the axe): the main world is 20,000 x 20,000 blocks around the world's spawn;
the Sift is its round valley.
"""

import math
import time

AXE = "galaxysmp:border_axe"
MAIN = "GalaxySMP"
MAIN_HALF = 10000        # the default main world border: this far from spawn in each direction
WARN = 8                 # blocks from the edge where the striped border wall shows
PUSH = 1.5               # how far back inside someone is put


def item_id(stack):
    try:
        return str(getattr(stack.type, "id", stack.type))
    except Exception:
        return ""


def dim_key(name):
    n = str(name).lower()
    return "nether" if "nether" in n else "the_end" if "end" in n else "overworld"


class Borders:
    def __init__(self, plugin):
        self.plugin = plugin
        self.safe = {}      # player uuid -> last spot inside a border (dim, x, y, z, yaw, pitch)
        self.corner = {}    # player uuid -> first corner tapped with the Border Axe
        self.warned = {}    # player uuid -> last "edge" message time
        self.tick_n = 0

    # ---------- the borders ----------
    def borders(self):
        """Every border: {id, server, dim, shape: box|circle, x1, z1, x2, z2 | cx, cz, r}."""
        saved = self.plugin.economy.get_config("borders")
        if saved is not None:
            items = list(saved)
            for b in items:   # the Sift grew: its border follows its (wavy) valley edge now
                if b.get("id") == "sift" and b.get("shape") == "circle":
                    b["shape"] = "sift"
            return items
        out = []
        spawn = self.plugin.economy.get_config("spawn") or {}
        sx, sz = float(spawn.get("x", 0)), float(spawn.get("z", 0))
        out.append({"id": "main", "server": MAIN, "name": "Main World", "dim": "overworld", "shape": "box",
                    "x1": int(sx - MAIN_HALF), "z1": int(sz - MAIN_HALF), "x2": int(sx + MAIN_HALF), "z2": int(sz + MAIN_HALF)})
        try:
            from endstone_galaxylink import sift as S
            out.append({"id": "sift", "server": "The Sift", "name": "The Sift", "dim": "overworld", "shape": "sift", "cx": S.CX, "cz": S.CZ, "r": self.sift_r()})
        except Exception:
            pass
        return out

    @staticmethod
    def sift_r():
        """The Sift's border: just inside where its cliffs begin."""
        try:
            from endstone_galaxylink import sift as S
            return int(S.R * 0.88 * S.CLIFF_START) - 4
        except Exception:
            return 220

    def save(self, items):
        self.plugin.economy.set_config("borders", items)

    @staticmethod
    def sift_edge(b, x, z):
        """For the Sift's border (which follows its wavy valley): (how far inside, the border's radius here)."""
        from endstone_galaxylink import sift as S
        dx, dz = x - b["cx"], z - b["cz"]
        d = math.hypot(dx, dz)
        limit = S.CLIFF_START + 0.015   # a few blocks up the bottom of the cliffs
        e = S.edge(dx, dz)
        r_here = d * limit / e if e > 0.001 else S.R * limit
        return r_here - d, r_here

    @staticmethod
    def inside(b, dim, x, z, pad=0.0):
        if b["dim"] != dim:
            return False
        if b.get("shape") == "sift":
            return Borders.sift_edge(b, x, z)[0] >= pad
        if b.get("shape") == "circle":
            return math.hypot(x - b["cx"], z - b["cz"]) <= b["r"] - pad
        return b["x1"] + pad <= x <= b["x2"] + 1 - pad and b["z1"] + pad <= z <= b["z2"] + 1 - pad

    @staticmethod
    def to_edge(b, x, z):
        """How far inside the border a spot is (negative = outside)."""
        if b.get("shape") == "sift":
            return Borders.sift_edge(b, x, z)[0]
        if b.get("shape") == "circle":
            return b["r"] - math.hypot(x - b["cx"], z - b["cz"])
        return min(x - b["x1"], b["x2"] + 1 - x, z - b["z1"], b["z2"] + 1 - z)

    def border_at(self, dim, x, z):
        return next((b for b in self.borders() if self.inside(b, dim, x, z)), None)

    def free(self, player):
        """Only the owner can go outside the borders."""
        try:
            ranks = getattr(self.plugin, "ranks", None)
            if ranks is not None and any(str(r.get("name", "")).strip().lower() == "owner" for r in ranks.ranks_of(player.xuid)):
                return True
        except Exception:
            pass
        return False

    def in_minigame(self, p):
        welcome = getattr(self.plugin, "welcome", None)
        try:
            return bool(welcome and welcome.in_minigame(p))
        except Exception:
            return False

    # ---------- keeping people inside ----------
    def tick(self):
        """Every few ticks: anyone outside every border goes back to where they just were."""
        items = self.borders()
        self.tick_n += 1
        for p in list(self.plugin.server.online_players):
            try:
                l = p.location
                dim = dim_key(p.dimension.name)
                mine = [b for b in items if b["dim"] == dim]
                if not mine:
                    continue   # no borders in this dimension (the Nether and the End, unless you add some)
                uid = str(p.unique_id)
                here = next((b for b in mine if self.inside(b, dim, l.x, l.z)), None)
                if here is not None:
                    edge = self.to_edge(here, l.x, l.z)
                    if edge >= PUSH:
                        self.safe[uid] = (p.dimension.name, l.x, l.y, l.z, l.yaw, l.pitch)
                    if edge < WARN:
                        self.show_edge(p, here)
                    continue
                if self.free(p) or self.in_minigame(p):
                    continue
                self.push_back(p, mine)
            except Exception:
                continue

    def push_back(self, p, mine):
        from endstone.level import Location
        uid = str(p.unique_id)
        spot = self.safe.get(uid)
        try:
            if spot is not None:
                dim = self.plugin.server.level.get_dimension(spot[0])
                p.teleport(Location(dim, spot[1], spot[2], spot[3], spot[5], spot[4]))
            else:
                # no safe spot yet (they arrived outside): the nearest border's middle, or spawn
                spawn = self.plugin.economy.get_config("spawn")
                if spawn:
                    p.teleport(self.plugin.teleports.location(spawn))
        except Exception:
            return
        now = time.time()
        if now - self.warned.get(uid, 0) > 3:
            self.warned[uid] = now
            try:
                p.send_tip("§c§lYou've reached the edge of the world")
                p.play_sound(p.location, "note.bass", 0.6, 0.6)
            except Exception:
                pass

    def show_edge(self, p, b):
        """A blue striped wall along the border near you (like a world border), made of flat particles from the pack."""
        from endstone_galaxylink.floating import dim_cmd
        l = p.location
        walls = []   # (x, z, particle): particle "x" is a wall along x (facing z), "z" a wall along z (facing x)
        if b.get("shape") in ("circle", "sift"):
            a0 = math.atan2(l.z - b["cz"], l.x - b["cx"])
            radius = self.sift_edge(b, l.x, l.z)[1] if b.get("shape") == "sift" else b["r"]
            for k in range(-4, 5):
                a = a0 + k * 2.0 / radius
                if b.get("shape") == "sift":
                    px, pz = b["cx"] + math.cos(a) * radius, b["cz"] + math.sin(a) * radius
                    radius_k = self.sift_edge(b, px, pz)[1]
                else:
                    radius_k = radius
                tx, tz = -math.sin(a), math.cos(a)   # the direction the wall runs here
                walls.append((b["cx"] + math.cos(a) * radius_k, b["cz"] + math.sin(a) * radius_k, "x" if abs(tx) >= abs(tz) else "z"))
        else:
            span = [l.x + k * 2 for k in range(-4, 5)], [l.z + k * 2 for k in range(-4, 5)]
            if l.x - b["x1"] < WARN:
                walls += [(b["x1"], zz, "z") for zz in span[1] if b["z1"] <= zz <= b["z2"] + 1]
            if b["x2"] + 1 - l.x < WARN:
                walls += [(b["x2"] + 1, zz, "z") for zz in span[1] if b["z1"] <= zz <= b["z2"] + 1]
            if l.z - b["z1"] < WARN:
                walls += [(xx, b["z1"], "x") for xx in span[0] if b["x1"] <= xx <= b["x2"] + 1]
            if b["z2"] + 1 - l.z < WARN:
                walls += [(xx, b["z2"] + 1, "x") for xx in span[0] if b["x1"] <= xx <= b["x2"] + 1]
        where = dim_cmd(p.dimension.name)
        server = self.plugin.server
        base = math.floor(l.y)
        for x, z, kind in walls:
            for dy in (-1, 1, 3, 5):
                try:
                    server.dispatch_command(server.command_sender,
                                            f"execute in {where} run particle galaxysmp:border_{kind} {x:.2f} {base + dy} {z:.2f}")
                except Exception:
                    pass

    def on_quit(self, player):
        uid = str(player.unique_id)
        for d in (self.safe, self.corner, self.warned):
            d.pop(uid, None)

    # ---------- the Border Axe ----------
    def servers(self):
        welcome = getattr(self.plugin, "welcome", None)
        names = [MAIN] + [str(s.get("name")) for s in (welcome.servers() if welcome else []) if s.get("action") != "play"]
        if "The Sift" not in names:
            names.append("The Sift")
        return list(dict.fromkeys(names))

    def on_interact(self, event):
        """Returns True when the Border Axe handled the tap."""
        if not event.has_item or item_id(event.item) != AXE:
            return False
        event.is_cancelled = True
        p = event.player
        if not p.is_op:
            p.send_message("§cOnly operators can use the Border Axe.")
            return True
        if not event.has_block:
            return True
        b = event.block
        dim = dim_key(p.dimension.name)
        uid = str(p.unique_id)
        if p.is_sneaking:
            hit = self.border_at(dim, b.x + 0.5, b.z + 0.5)
            if hit:
                self.ask_remove(p, hit)
            else:
                p.send_message("§7No border here.")
            return True
        first = self.corner.get(uid)
        here = (dim, b.x, b.z)
        if first is not None and first[:3] == here:
            return True   # the same tap again (holding the button)
        if first is None or first[0] != dim or time.time() - first[3] > 300:
            self.corner[uid] = here + (time.time(),)
            p.send_message(f"§bBorder corner 1 §7({b.x}, {b.z}). §fNow tap the opposite corner (it can be far away: fly there).")
            return True
        self.corner.pop(uid, None)
        box = {"dim": dim, "shape": "box", "x1": min(first[1], b.x), "z1": min(first[2], b.z), "x2": max(first[1], b.x), "z2": max(first[2], b.z)}
        if box["x2"] - box["x1"] < 8 or box["z2"] - box["z1"] < 8:
            p.send_message("§cThat's too small for a border. Try again.")
            return True
        self.pick(p, box)
        return True

    def pick(self, p, box):
        from endstone.form import ModalForm, Dropdown, TextInput
        names = self.servers()

        def submit(pl, data):
            import json
            try:
                v = json.loads(data)
                i = int(v[1])
                name = clean(v[0]) or names[i]
            except Exception:
                return
            self.set_border(pl, box, names[i], name)
        size = f"{box['x2'] - box['x1'] + 1} x {box['z2'] - box['z1'] + 1} blocks"
        p.send_form(ModalForm(title="New Border", controls=[
            TextInput(f"Name this border ({size})", "e.g. Main World", ""),
            Dropdown("Whose border is this?", names, 0)],
            submit_button="Save border", on_submit=submit))

    def set_border(self, p, box, server, name=None):
        """A server has one border per dimension: a new one replaces the old one."""
        name = name or server
        items = [b for b in self.borders() if not (b["server"] == server and b["dim"] == box["dim"])]
        items.append(dict(box, id=f"{server.lower().replace(' ', '_')}_{box['dim']}", server=server, name=name))
        self.save(items)
        p.send_message(f"§aBorder §f{name}§a saved for §f{server}§a ({box['x2'] - box['x1'] + 1} x {box['z2'] - box['z1'] + 1} blocks). "
                       f"§7/border tp {name} §7to go there.")

    # ---------- going to a border ----------
    @staticmethod
    def label(b):
        return b.get("name") or b["server"]

    def find(self, text):
        t = str(text).strip().lower()
        items = self.borders()
        return (next((b for b in items if self.label(b).lower() == t), None) or
                next((b for b in items if b["server"].lower() == t), None) or
                next((b for b in items if self.label(b).lower().startswith(t)), None))

    def center(self, b):
        if b.get("shape") in ("circle", "sift"):
            return b["cx"], b["cz"]
        return (b["x1"] + b["x2"]) // 2, (b["z1"] + b["z2"]) // 2

    def teleport(self, p, b):
        """Takes you to the middle of a border: up high first (so the land loads), then down onto the ground."""
        sift = getattr(self.plugin, "sift", None)
        if b["server"] == "The Sift" and sift is not None and sift.built():
            sift.go(p)
            return
        from endstone.level import Location
        x, z = self.center(b)
        name = {"overworld": "Overworld", "nether": "Nether", "the_end": "TheEnd"}.get(b["dim"], "Overworld")
        level = self.plugin.server.level
        dim = level.get_dimension(name) or next((d for d in level.dimensions if dim_key(d.name) == b["dim"]), None)
        if dim is None:
            p.send_message("§cThat border's world isn't available.")
            return
        high = 100 if b["dim"] == "nether" else 200
        try:
            p.teleport(Location(dim, x + 0.5, high, z + 0.5, 0.0, 0.0))
        except Exception as e:
            p.send_message(f"§cCouldn't teleport: {e}")
            return
        server = self.plugin.server
        pname = p.name.replace('"', "")
        server.dispatch_command(server.command_sender, f'effect "{pname}" slow_falling 15 0 true')
        p.send_message(f"§bTeleporting to §f{self.label(b)}§b...")
        from endstone_galaxylink.safety import later

        def land(pl, tries=0):
            try:
                y = pl.dimension.get_highest_block_y_at(int(x), int(z))
            except Exception:
                y = None
            if (y is None or y < -60) and tries < 5:   # the land isn't loaded yet: try again in a second
                return later(self.plugin, pl, lambda q: land(q, tries + 1), 20)
            if y is not None and y > -60 and (b["dim"] != "nether" or y < 120):
                try:
                    pl.teleport(Location(pl.dimension, x + 0.5, y + 1, z + 0.5, 0.0, 0.0))
                except Exception:
                    pass
            server.dispatch_command(server.command_sender, f'effect "{pname}" slow_falling 0')
        later(self.plugin, p, land, 30)

    def menu(self, p):
        from endstone.form import ActionForm
        items = self.borders()
        form = ActionForm(title="World Borders", content="§7Tap a border to go there or change it. §f/border axe§7 makes a new one.\n"
                                                          "§7Only the owner can go outside the borders.")
        for b in items:
            form.add_button(f"§l{self.label(b)}§r\n§7{b['server']} · {b['dim']}", on_click=lambda pl, b=b: self.border_menu(pl, b))
        form.add_button("§bGet the Border Axe", on_click=lambda pl: self.command(pl, ["axe"]))
        p.send_form(form)

    def border_menu(self, p, b):
        from endstone.form import ActionForm
        form = ActionForm(title=self.label(b), content=self.describe(b))
        form.add_button("§aTeleport there", on_click=lambda pl: self.teleport(pl, b))
        form.add_button("Rename", on_click=lambda pl: self.ask_rename(pl, b))
        form.add_button("§cRemove this border", on_click=lambda pl: self.remove(pl, b["id"]))
        form.add_button("< Back", on_click=self.menu)
        p.send_form(form)

    def ask_rename(self, p, b):
        from endstone.form import ModalForm, TextInput

        def submit(pl, data):
            import json
            try:
                name = clean(json.loads(data)[0])
            except Exception:
                return
            if not name:
                return
            items = self.borders()
            for x in items:
                if x["id"] == b["id"]:
                    x["name"] = name
            self.save(items)
            pl.send_message(f"§aRenamed to §f{name}§a.")
        p.send_form(ModalForm(title="Rename border", controls=[TextInput("New name", self.label(b), self.label(b))],
                              submit_button="Save", on_submit=submit))

    def describe(self, b):
        if b.get("shape") == "sift":
            return f"§f{b['server']}§r\n§7Follows the Sift's valley, inside its cliffs (about 600 blocks across)"
        if b.get("shape") == "circle":
            return f"§f{b['server']}§r\n§7A circle {b['r'] * 2} blocks across, around {b['cx']} {b['cz']}"
        return (f"§f{b['server']}§r\n§7{b['x2'] - b['x1'] + 1} x {b['z2'] - b['z1'] + 1} blocks, "
                f"from {b['x1']} {b['z1']} to {b['x2']} {b['z2']}")

    def ask_remove(self, p, b):
        from endstone.form import ActionForm
        if b.get("shape") == "sift":
            where = "the Sift's valley, inside its cliffs"
        elif b.get("shape") == "circle":
            where = f"a circle {b['r'] * 2} blocks across"
        else:
            where = f"{b['x2'] - b['x1'] + 1} x {b['z2'] - b['z1'] + 1} blocks, from {b['x1']} {b['z1']} to {b['x2']} {b['z2']}"
        form = ActionForm(title=f"{self.label(b)} border", content=f"§f{where}§r\n\n§7Make a new one with the Border Axe to replace it.")
        form.add_button("§aTeleport to the middle", on_click=lambda pl: self.teleport(pl, b))
        form.add_button("§cRemove this border", on_click=lambda pl: self.remove(pl, b["id"]))
        form.add_button("Keep it")
        p.send_form(form)

    def remove(self, p, bid):
        items = self.borders()
        left = [b for b in items if b["id"] != bid]
        self.save(left)
        p.send_message("§eBorder removed." if len(left) < len(items) else "§cNo such border.")

    # ---------- /border ----------
    def command(self, sender, args):
        if not sender.is_op:
            sender.send_message("§cOnly operators can manage borders.")
            return True
        sub = args[0].lower() if args else ("menu" if hasattr(sender, "xuid") else "list")
        if sub == "menu":
            self.menu(sender)
            return True
        if sub == "axe":
            if hasattr(sender, "xuid"):
                server = self.plugin.server
                server.dispatch_command(server.command_sender, f'give "{sender.name}" {AXE} 1')
                sender.send_message("§bBorder Axe: §ftap one corner, then the opposite corner, then name it and pick whose border it is.")
            return True
        if sub == "tp":
            if not hasattr(sender, "xuid"):
                sender.send_message("Players only.")
                return True
            b = self.find(" ".join(args[1:])) if len(args) > 1 else None
            if b is None:
                sender.send_message("§cNo border with that name. §7/border list shows them.")
                return True
            self.teleport(sender, b)
            return True
        if sub == "list":
            for b in self.borders():
                sender.send_message(f"§b{self.label(b)} §7- {self.describe(b).splitlines()[-1][2:]} ({b['server']}, {b['dim']})")
            sender.send_message("§7/border tp <name> to go there. Only the owner can go outside the borders.")
            return True
        if sub == "reset":
            self.plugin.economy.set_config("borders", None)
            sender.send_message("§eBorders reset to the defaults (main world + the Sift).")
            return True
        sender.send_message("§7/border | /border tp <name> | /border list | /border axe | /border reset")
        return True


def clean(text):
    import re
    return re.sub(r"\s+", " ", re.sub(r"§.|[^\w '\-!&.]", "", str(text or ""))).strip()[:32]
