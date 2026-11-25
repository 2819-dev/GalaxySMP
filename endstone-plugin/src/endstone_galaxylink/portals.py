"""Picture portals, made with the Portal Axe (operators only).

/portalaxe gives you the axe. Tap one corner block of your portal's opening, then the opposite corner
(the opening must be flat: one block thick). Then pick a picture (Wilderness, Copper, The Sift, Chaos)
and where it goes (any Featured Server on the Main Menu, or The Sift). The picture fills the opening;
walking into it plays that server's joining animation and takes you there.

Crouch + tap inside a portal with the axe to remove it. /portal list shows them all.
"""

import time
import uuid

AXE = "galaxysmp:portal_axe"
PICTURES = [("Wilderness", 0), ("Copper Age", 1), ("The Sift", 2), ("Chaos Cubed", 3)]
MAX = 32           # biggest opening (blocks)
COOLDOWN = 6.0     # seconds before the same player can use a portal again


def item_id(stack):
    try:
        return str(getattr(stack.type, "id", stack.type))
    except Exception:
        return ""


class Portals:
    def __init__(self, plugin):
        self.plugin = plugin
        self.corner = {}    # player uuid -> first corner (dim, x, y, z)
        self.used = {}      # player uuid -> time of the last portal trip
        self.checked = 0.0

    def portals(self):
        return list(self.plugin.economy.get_config("portals") or [])

    def save(self, items):
        self.plugin.economy.set_config("portals", items)

    def cmd(self, c):
        try:
            from endstone_galaxylink.safety import run_cmd
            return run_cmd(self.plugin, c)
        except Exception:
            return False

    # ---------- the axe ----------
    def give_axe(self, player):
        if not player.is_op:
            return player.send_message("§cOnly operators can make portals.")
        self.cmd(f'give "{player.name}" {AXE} 1')
        player.send_message("§dPortal Axe: §ftap one corner of the opening, then the opposite corner.")

    def on_interact(self, event):
        """Returns True when the Portal Axe handled the tap."""
        p = event.player
        if not event.has_item or item_id(event.item) != AXE:
            return False
        event.is_cancelled = True
        if not p.is_op:
            p.send_message("§cOnly operators can use the Portal Axe.")
            return True
        if not event.has_block:
            return True
        b = event.block
        dim = p.dimension.name
        here = (dim, b.x, b.y, b.z)
        uid = str(p.unique_id)
        if p.is_sneaking:
            hit = self.portal_at(dim, b.x + 0.5, b.y + 0.5, b.z + 0.5, pad=1.0)
            if hit:
                return self.ask_remove(p, hit) or True
        first = self.corner.get(uid)
        if first is not None and first[:4] == here:
            return True   # the same tap again (holding the button)
        if first is None or first[0] != dim or time.time() - first[4] > 120:
            self.corner[uid] = here + (time.time(),)
            p.send_message(f"§dCorner 1 set §7({b.x}, {b.y}, {b.z}). §fNow tap the opposite corner.")
            return True
        self.corner.pop(uid, None)
        x1, y1, z1 = min(first[1], b.x), min(first[2], b.y), min(first[3], b.z)
        x2, y2, z2 = max(first[1], b.x), max(first[2], b.y), max(first[3], b.z)
        if x1 != x2 and z1 != z2:
            p.send_message("§cThe opening must be flat (one block thick). Try again.")
            return True
        w, h = (x2 - x1 + 1) if z1 == z2 else (z2 - z1 + 1), y2 - y1 + 1
        if w > MAX or h > MAX:
            p.send_message(f"§cToo big: a portal can be up to {MAX} x {MAX} blocks.")
            return True
        self.pick(p, {"dim": dim, "x1": x1, "y1": y1, "z1": z1, "x2": x2, "y2": y2, "z2": z2})
        return True

    def destinations(self):
        welcome = getattr(self.plugin, "welcome", None)
        names = [str(s.get("name")) for s in (welcome.servers() if welcome else []) if s.get("action") != "soon"]
        if not any(n.lower() == "the sift" for n in names):
            names.append("The Sift")
        return names

    def pick(self, p, box):
        from endstone.form import ModalForm, Dropdown

        dests = self.destinations()

        def submit(pl, data):
            import json
            try:
                v = json.loads(data)
                img, dest = int(v[0]), int(v[1])
            except Exception:
                return
            self.create(pl, box, PICTURES[img][1], dests[dest])
        p.send_form(ModalForm(title="New Portal", controls=[
            Dropdown("Picture", [n for n, _ in PICTURES], 2),
            Dropdown("Where it goes (Featured Servers)", dests, len(dests) - 1 if dests[-1] == "The Sift" else 0)],
            submit_button="Make portal", on_submit=submit))

    def create(self, p, box, img, dest):
        item = dict(box, id=uuid.uuid4().hex[:8], img=img, dest=dest)
        items = self.portals()
        items.append(item)
        self.save(items)
        self.summon(item)
        p.send_message(f"§aPortal made! §7It goes to §f{dest}§7. Crouch + tap it with the axe to remove it.")

    # ---------- the picture ----------
    @staticmethod
    def size(item):
        along_x = item["z1"] == item["z2"]
        w = (item["x2"] - item["x1"] + 1) if along_x else (item["z2"] - item["z1"] + 1)
        return along_x, w, item["y2"] - item["y1"] + 1

    def summon(self, item):
        from endstone_galaxylink.floating import dim_cmd
        along_x, w, h = self.size(item)
        cx = (item["x1"] + item["x2"] + 1) / 2
        cz = (item["z1"] + item["z2"] + 1) / 2
        yaw = 0 if along_x else 90
        name = f"gsmp_portal_{item['id']}"
        where = f"execute in {dim_cmd(item['dim'])} run"
        self.cmd(f"{where} summon galaxysmp:portal_screen {cx:.2f} {item['y1']} {cz:.2f} {yaw} 0 minecraft:entity_spawned {name}")
        sel = f"@e[type=galaxysmp:portal_screen,name={name}]"
        for ev in (f"galaxysmp:w{w}", f"galaxysmp:h{h}", f"galaxysmp:img{item['img']}"):
            self.cmd(f"{where} event entity {sel} {ev}")

    def remove_picture(self, item):
        from endstone_galaxylink.floating import dim_cmd
        self.cmd(f"execute in {dim_cmd(item['dim'])} run kill @e[type=galaxysmp:portal_screen,name=gsmp_portal_{item['id']}]")

    def ask_remove(self, p, item):
        from endstone.form import ActionForm
        form = ActionForm(title="Remove portal?", content=f"This portal goes to §f{item['dest']}§r.")
        form.add_button("Remove", on_click=lambda pl: self.remove(pl, item["id"]))
        form.add_button("Keep it")
        p.send_form(form)

    def remove(self, p, pid):
        items = self.portals()
        gone = [i for i in items if i["id"] == pid]
        for i in gone:
            self.remove_picture(i)
        self.save([i for i in items if i["id"] != pid])
        p.send_message("§ePortal removed." if gone else "§cNo such portal.")

    # ---------- walking in ----------
    @staticmethod
    def inside(item, dim, x, y, z, pad=0.0):
        if item["dim"] != dim:
            return False
        along_x = item["z1"] == item["z2"]
        thin = 0.35 + pad
        if along_x:
            ok_x = item["x1"] - pad <= x < item["x2"] + 1 + pad
            ok_z = item["z1"] + 0.5 - thin <= z <= item["z1"] + 0.5 + thin
        else:
            ok_z = item["z1"] - pad <= z < item["z2"] + 1 + pad
            ok_x = item["x1"] + 0.5 - thin <= x <= item["x1"] + 0.5 + thin
        return ok_x and ok_z and item["y1"] - 0.5 <= y < item["y2"] + 1

    def portal_at(self, dim, x, y, z, pad=0.0):
        return next((i for i in self.portals() if self.inside(i, dim, x, y, z, pad)), None)

    def tick(self):
        """Every few ticks: anyone stepping into a portal goes where it leads."""
        items = self.portals()
        if not items:
            return
        now = time.time()
        welcome = getattr(self.plugin, "welcome", None)
        for p in list(self.plugin.server.online_players):
            try:
                l = p.location
                hit = next((i for i in items if self.inside(i, p.dimension.name, l.x, l.y, l.z)), None)
                if hit is None or now - self.used.get(str(p.unique_id), 0) < COOLDOWN:
                    continue
                self.used[str(p.unique_id)] = now
                if welcome is None or not welcome.travel(p, hit["dest"]):
                    p.send_message(f"§c{hit['dest']} isn't open right now.")
            except Exception:
                continue
        if now - self.checked > 30:
            self.checked = now
            self.repair(items)

    def repair(self, items):
        """Puts a portal's picture back if it went missing (only near players, where the chunks are loaded)."""
        players = list(self.plugin.server.online_players)
        for item in items:
            try:
                near = [p for p in players if p.dimension.name == item["dim"] and
                        (p.location.x - item["x1"]) ** 2 + (p.location.z - item["z1"]) ** 2 < 40 * 40]
                if not near:
                    continue
                name = f"gsmp_portal_{item['id']}"
                if not any(str(a.type) == "galaxysmp:portal_screen" and a.name_tag == name for a in near[0].dimension.actors):
                    self.summon(item)
            except Exception:
                continue

    def on_quit(self, player):
        self.corner.pop(str(player.unique_id), None)
        self.used.pop(str(player.unique_id), None)

    # ---------- /portal ----------
    def command(self, sender, args):
        if not sender.is_op:
            sender.send_message("§cOnly operators can manage portals.")
            return True
        sub = args[0].lower() if args else "axe"
        if sub == "axe":
            if hasattr(sender, "xuid"):
                self.give_axe(sender)
            return True
        if sub == "list":
            items = self.portals()
            if not items:
                sender.send_message("§7No portals yet. §f/portal axe§7 to make one.")
            for i in items:
                sender.send_message(f"§d{i['id']} §f→ {i['dest']} §7at {i['x1']} {i['y1']} {i['z1']} ({i['dim']})")
            return True
        if sub == "remove" and len(args) > 1:
            self.remove(sender, args[1])
            return True
        sender.send_message("§7/portal axe | /portal list | /portal remove <id>")
        return True
