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
WARN = 6                 # blocks from the edge where the glowing border shows
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
            return list(saved)
        out = []
        spawn = self.plugin.economy.get_config("spawn") or {}
        sx, sz = float(spawn.get("x", 0)), float(spawn.get("z", 0))
        out.append({"id": "main", "server": MAIN, "dim": "overworld", "shape": "box",
                    "x1": int(sx - MAIN_HALF), "z1": int(sz - MAIN_HALF), "x2": int(sx + MAIN_HALF), "z2": int(sz + MAIN_HALF)})
        try:
            from endstone_galaxylink import sift as S
            out.append({"id": "sift", "server": "The Sift", "dim": "overworld", "shape": "circle", "cx": S.CX, "cz": S.CZ, "r": int(S.R * 0.8)})
        except Exception:
            pass
        return out

    def save(self, items):
        self.plugin.economy.set_config("borders", items)

    @staticmethod
    def inside(b, dim, x, z, pad=0.0):
        if b["dim"] != dim:
            return False
        if b.get("shape") == "circle":
            return math.hypot(x - b["cx"], z - b["cz"]) <= b["r"] - pad
        return b["x1"] + pad <= x <= b["x2"] + 1 - pad and b["z1"] + pad <= z <= b["z2"] + 1 - pad

    @staticmethod
    def to_edge(b, x, z):
        """How far inside the border a spot is (negative = outside)."""
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
                    if edge < WARN and self.tick_n % 2 == 0:
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
        """A glowing wall of particles along the border near you."""
        from endstone_galaxylink.floating import dim_cmd
        l = p.location
        server = self.plugin.server
        pts = []
        if b.get("shape") == "circle":
            a0 = math.atan2(l.z - b["cz"], l.x - b["cx"])
            for k in range(-3, 4):
                a = a0 + k * 1.5 / b["r"]
                pts.append((b["cx"] + math.cos(a) * b["r"], b["cz"] + math.sin(a) * b["r"]))
        else:
            for k in range(-3, 4):
                if l.x - b["x1"] < WARN:
                    pts.append((b["x1"], l.z + k * 1.5))
                if b["x2"] + 1 - l.x < WARN:
                    pts.append((b["x2"] + 1, l.z + k * 1.5))
                if l.z - b["z1"] < WARN:
                    pts.append((l.x + k * 1.5, b["z1"]))
                if b["z2"] + 1 - l.z < WARN:
                    pts.append((l.x + k * 1.5, b["z2"] + 1))
        where = dim_cmd(p.dimension.name)
        for x, z in pts:
            for dy in (0.2, 1.2, 2.2):
                try:
                    server.dispatch_command(server.command_sender,
                                            f"execute in {where} run particle minecraft:blue_flame_particle {x:.2f} {l.y + dy:.2f} {z:.2f}")
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
        from endstone.form import ModalForm, Dropdown
        names = self.servers()

        def submit(pl, data):
            import json
            try:
                i = int(json.loads(data)[0])
            except Exception:
                return
            self.set_border(pl, box, names[i])
        size = f"{box['x2'] - box['x1'] + 1} x {box['z2'] - box['z1'] + 1} blocks"
        p.send_form(ModalForm(title="New Border", controls=[Dropdown(f"Whose border is this? ({size})", names, 0)],
                              submit_button="Save border", on_submit=submit))

    def set_border(self, p, box, server):
        """A server has one border per dimension: a new one replaces the old one."""
        items = [b for b in self.borders() if not (b["server"] == server and b["dim"] == box["dim"])]
        items.append(dict(box, id=f"{server.lower().replace(' ', '_')}_{box['dim']}", server=server))
        self.save(items)
        p.send_message(f"§aBorder saved for §f{server}§a ({box['x2'] - box['x1'] + 1} x {box['z2'] - box['z1'] + 1} blocks).")

    def ask_remove(self, p, b):
        from endstone.form import ActionForm
        if b.get("shape") == "circle":
            where = f"a circle {b['r'] * 2} blocks across"
        else:
            where = f"{b['x2'] - b['x1'] + 1} x {b['z2'] - b['z1'] + 1} blocks, from {b['x1']} {b['z1']} to {b['x2']} {b['z2']}"
        form = ActionForm(title=f"{b['server']} border", content=f"§f{where}§r\n\n§7Make a new one with the Border Axe to replace it.")
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
        sub = args[0].lower() if args else "list"
        if sub == "axe":
            if hasattr(sender, "xuid"):
                server = self.plugin.server
                server.dispatch_command(server.command_sender, f'give "{sender.name}" {AXE} 1')
                sender.send_message("§bBorder Axe: §ftap one corner, then the opposite corner, then pick whose border it is.")
            return True
        if sub == "list":
            for b in self.borders():
                if b.get("shape") == "circle":
                    sender.send_message(f"§b{b['server']} §7({b['dim']}): circle around {b['cx']} {b['cz']}, {b['r']} blocks out")
                else:
                    sender.send_message(f"§b{b['server']} §7({b['dim']}): {b['x1']} {b['z1']} to {b['x2']} {b['z2']}")
            sender.send_message("§7Only the owner can go outside the borders. §f/border axe§7 to change them.")
            return True
        if sub == "reset":
            self.plugin.economy.set_config("borders", None)
            sender.send_message("§eBorders reset to the defaults (main world + the Sift).")
            return True
        sender.send_message("§7/border list | /border axe | /border reset")
        return True
