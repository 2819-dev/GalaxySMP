"""Elevators: a real moving cabin with doors, call buttons and a floor panel.

The Elevator Tool (a nether star) is in the inventory of staff, Galaxy+ and Galaxy Pro+ players: use it to
build and manage elevators. It's given automatically and taken away if the plan ends. /elevator gives it back.

How one works
  - The cabin is a floor of blocks inside a shaft that players build (up to 5x5 inside).
  - Riding: everyone standing in the cabin moves with its floor, about 2 blocks a second, and sees the
    shaft walls go by. Iron doors next to the cabin close before it leaves and open with a ding when it
    arrives. A display above the hotbar shows the floor while it moves.
  - Call buttons: any button within 3 blocks of the shaft, at a floor's height, calls the elevator there.
  - Floor panel: crouch (sneak) in the cabin, tap the cabin floor, or press a button on the shaft wall
    next to you, to pick a floor.

Building one (/elevator)
  1. Build the shaft and put the cabin floor at the bottom floor (any blocks, e.g. polished stone).
  2. Use the Elevator Tool > Create an elevator > tap two opposite corner blocks of the cabin floor.
  3. Go to every other floor, stand on the landing next to the shaft and use the tool > Add a floor here.
  4. Optional: iron doors right next to the shaft at each floor (they open and close by themselves),
     and buttons next to the shaft (call) and inside the cabin (panel).
  Staff can build elevators anywhere. Galaxy+ (2 elevators) and Galaxy Pro+ (4) players can build them
  inside their own plots.
"""

import json
import math
import time

from endstone.event import PlayerInteractEvent
from endstone.form import ActionForm, ModalForm, TextInput

STEP = 0.2            # blocks per move (every 2 ticks = 2 blocks a second)
DOOR_WAIT = 20        # ticks between doors closing and moving
OPEN_TIME = 60        # ticks the doors stay open before the next trip
MAX_SIZE = 5
LIMITS = {"free": 0, "plus": 2, "pro": 4}
CALL_RANGE = 3


def is_button(block_type):
    return str(block_type).endswith("_button")


class Elevators:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.list = self.eco.get_config("elevators") or {}   # id (str) -> elevator
        self.pending = {}      # player uuid -> ("corner", first corner or None)
        self.trips = {}        # elevator id -> running trip
        self.callers = {}      # elevator id -> players who called it (told if it can't come)
        self.crouching = set() # players who were crouching in a cabin last check
        self.ticks = 0
        self.last_tap = {}
        for e in self.list.values():  # the server stopped mid-trip: put the floor back where it was
            if e.get("row") is not None and e["row"] != e["cur"]:
                try:
                    self.set_row(e, e["row"], None)
                    self.set_row(e, e["cur"], e["floor_block"])
                except Exception:
                    pass
            e["row"] = e["cur"]
            e["queue"] = []

    def save(self):
        self.eco.set_config("elevators", self.list)

    # ---------- blocks ----------
    def dim(self, e):
        return self.plugin.server.level.get_dimension(e["dim"])

    def set_row(self, e, y, block):
        """Fills the cabin footprint at height y with the floor block (or air)."""
        d = self.dim(e)
        server = self.plugin.server
        for x in range(e["x1"], e["x2"] + 1):
            for z in range(e["z1"], e["z2"] + 1):
                b = d.get_block_at(x, y, z)
                if block is None:
                    b.set_type("minecraft:air", False)
                else:
                    b.set_type(block[0], False)
                    if block[1]:
                        try:
                            b.set_data(server.create_block_data(block[0], block[1]), False)
                        except Exception:
                            pass

    def blocker(self, e, y):
        """The first block in the shaft at height y, as (x, y, z, type), or None if it's empty."""
        d = self.dim(e)
        for x in range(e["x1"], e["x2"] + 1):
            for z in range(e["z1"], e["z2"] + 1):
                t = d.get_block_at(x, y, z).type
                if t not in ("minecraft:air", "minecraft:light_block") and not t.endswith("_air"):
                    return (x, y, z, t)
        return None

    def clear(self, e, y):
        """Is the shaft free (only air) at height y?"""
        return self.blocker(e, y) is None

    def first_blocker(self, e, frm, to):
        """What's in the way of a trip from floor frm to floor to (needs the shaft plus 2 blocks of headroom)."""
        lo, hi = min(frm, to), max(frm, to) + 2
        for y in range(lo, hi + 1):
            if y == frm:
                continue  # the cabin floor itself
            b = self.blocker(e, y)
            if b:
                return b
        return None

    @staticmethod
    def blocked_text(b):
        x, y, z, t = b
        return (f"§cThe elevator can't move: there's {t.replace('minecraft:', '').replace('_', ' ')} inside the shaft at "
                f"{x}, {y}, {z}. §7Only the cabin has a floor: above and below it the shaft must be an empty hole "
                "(no floor on the other floors inside the shaft).")

    def doors(self, e, floor_y):
        """Iron doors right next to the cabin at a floor (their bottom half)."""
        d = self.dim(e)
        out = []
        for x in range(e["x1"] - 1, e["x2"] + 2):
            for z in range(e["z1"] - 1, e["z2"] + 2):
                if e["x1"] <= x <= e["x2"] and e["z1"] <= z <= e["z2"]:
                    continue
                b = d.get_block_at(x, floor_y + 1, z)
                if "iron_door" in b.type:
                    out.append(b)
        return out

    def set_doors(self, e, floor_y, open_):
        server = self.plugin.server
        for b in self.doors(e, floor_y):
            try:
                states = dict(b.data.block_states)
                if bool(states.get("open_bit")) == open_:
                    continue
                states["open_bit"] = open_
                b.set_data(server.create_block_data(b.type, states))
            except Exception:
                pass

    # ---------- who's where ----------
    def inside(self, e, p, y=None):
        """Is the player standing in the cabin?"""
        if p.dimension.name != e["dim"]:
            return False
        l = p.location
        floor_top = (e["row"] if y is None else y) + 1
        return (e["x1"] <= l.x < e["x2"] + 1 and e["z1"] <= l.z < e["z2"] + 1 and floor_top - 0.6 <= l.y <= floor_top + 2.5)

    def floor_index(self, e, y):
        return next((i for i, f in enumerate(e["floors"]) if f["y"] == y), None)

    def floor_name(self, e, y):
        i = self.floor_index(e, y)
        return e["floors"][i]["name"] if i is not None else f"y {y}"

    def near(self, e, block, reach=CALL_RANGE):
        return (block.dimension.name == e["dim"] and e["x1"] - reach <= block.x <= e["x2"] + reach
                and e["z1"] - reach <= block.z <= e["z2"] + reach)

    # ---------- taps ----------
    # ---------- the Elevator Tool ----------
    def allowed(self, player):
        return player.is_op or LIMITS.get(self.plan_key(player), 0) > 0

    def is_tool(self, stack):
        plots = getattr(self.plugin, "plots", None)
        return bool(plots) and plots.tool_kind(stack) == "elevator"

    def check_tool(self, player):
        """Staff, Galaxy+ and Galaxy Pro+ always have the tool; everyone else never does."""
        plots = getattr(self.plugin, "plots", None)
        if not plots:
            return
        has = plots.has_tool(player, "elevator")
        if self.allowed(player) and not has:
            plots.give_tool(player, "elevator")
            player.send_message("§bYou got the Elevator Tool. §7Use it to build elevators" + (" anywhere." if player.is_op else " in your plots."))
        elif not self.allowed(player) and has:
            plots.take_tool(player, "elevator", every=True)
            player.send_message("§7Your Elevator Tool was removed (elevators are a Galaxy+ and Galaxy Pro+ perk).")

    def check_tools(self):
        for p in self.plugin.server.online_players:
            self.check_tool(p)

    def command(self, player):
        if not self.allowed(player):
            return player.send_message("§eElevators are a Galaxy+ and Galaxy Pro+ perk (in your own plots). §7galaxymc.us/store")
        plots = getattr(self.plugin, "plots", None)
        if plots and not plots.has_tool(player, "elevator"):
            self.check_tool(player)
        else:
            self.menu(player)

    def on_interact(self, event):
        p = event.player
        right = event.action in (PlayerInteractEvent.Action.RIGHT_CLICK_BLOCK, PlayerInteractEvent.Action.RIGHT_CLICK_AIR)
        tool = right and getattr(event, "has_item", False) and self.is_tool(event.item)
        if tool and (str(p.unique_id) not in self.pending or not getattr(event, "has_block", False)):
            event.cancel()
            if self._debounce(p):
                if not self.allowed(p):
                    self.check_tool(p)
                else:
                    self.menu(p)
            return True
        if event.action != PlayerInteractEvent.Action.RIGHT_CLICK_BLOCK or not getattr(event, "has_block", False):
            return False
        block = event.block
        job = self.pending.get(str(p.unique_id))
        if job:
            event.cancel()
            if self._debounce(p):
                self.corner(p, block, job)
            return True
        for eid, e in self.list.items():  # tapping the cabin floor from inside opens the floor panel
            if (block.dimension.name == e["dim"] and block.y == e["row"] and e["x1"] <= block.x <= e["x2"]
                    and e["z1"] <= block.z <= e["z2"] and self.inside(e, p)):
                event.cancel()
                if self._debounce(p):
                    self.panel(p, eid)
                return True
        if not is_button(block.type):
            return False
        for eid, e in self.list.items():
            if not self.near(e, block, 1) or not self.inside(e, p):
                continue
            if self._debounce(p):
                self.panel(p, eid)
            return True
        for eid, e in self.list.items():
            if not self.near(e, block):
                continue
            # the floor whose landing is closest to the button (buttons sit 1-2 blocks above the landing)
            f = min(e["floors"], key=lambda f: abs(block.y - (f["y"] + 1.5)))
            if f["y"] <= block.y <= f["y"] + 4:
                if self._debounce(p):
                    self.call(p, eid, f["y"])
                return True
        return False

    def _debounce(self, p):
        now = time.time()
        if now - self.last_tap.get(str(p.unique_id), 0) < 0.7:
            return False
        self.last_tap[str(p.unique_id)] = now
        return True

    def call(self, player, eid, y):
        e = self.list[eid]
        if e["row"] == y and eid not in self.trips:
            self.set_doors(e, y, True)
            return player.send_tip(f"§aThe elevator is here: {self.floor_name(e, y)}")
        if y not in e["queue"]:
            e["queue"].append(y)
        self.callers.setdefault(eid, set()).add(str(player.unique_id))
        player.send_tip(f"§eElevator called to {self.floor_name(e, y)}")
        self.plugin.server.scheduler.run_task(self.plugin, lambda: self.next(eid))

    def panel(self, player, eid):
        e = self.list[eid]
        here = e["row"]
        form = ActionForm(title=f"§l{e.get('name') or 'Elevator'}", content="Choose a floor.")
        for f in reversed(e["floors"]):
            mark = " §a(here)" if f["y"] == here and eid not in self.trips else ""
            form.add_button(f"§l{f['name']}{mark}", on_click=lambda p, y=f["y"]: self.call(p, eid, y))
        form.add_button("Close")
        player.send_form(form)

    # ---------- trips ----------
    def next(self, eid):
        e = self.list.get(eid)
        if not e or eid in self.trips or not e["queue"]:
            return
        target = e["queue"].pop(0)
        if target == e["row"]:
            self.set_doors(e, target, True)
            return self.next(eid)
        step = 1 if target > e["row"] else -1
        b = self.first_blocker(e, e["row"], target)  # the shaft must be empty on the way
        if b:
            told = self.callers.pop(eid, set())
            e["queue"].clear()
            for p in self.plugin.server.online_players:
                if self.inside(e, p) or str(p.unique_id) in told:
                    p.send_message(self.blocked_text(b))
            return
        self.callers.pop(eid, None)
        self.set_doors(e, e["row"], False)
        for p in self.riders(e):
            self._sound(p, "random.door_close", 0.8, 1.0)
        self.trips[eid] = {"from": e["row"], "to": target, "dir": step, "p": 0.0, "riders": None, "wait": DOOR_WAIT}

    def riders(self, e):
        return [p for p in self.plugin.server.online_players if self.inside(e, p)]

    @staticmethod
    def _sound(p, name, volume, pitch):
        try:
            p.play_sound(p.location, name, volume, pitch)
        except Exception:
            pass

    def check_crouch(self):
        """Crouching in a stopped cabin opens the floor menu (easy on phones)."""
        now = set()
        for eid, e in self.list.items():
            if eid in self.trips:
                continue
            for p in self.plugin.server.online_players:
                try:
                    if not p.is_sneaking or not self.inside(e, p):
                        continue
                except Exception:
                    continue
                uid = str(p.unique_id)
                now.add(uid)
                if uid not in self.crouching:
                    self.panel(p, eid)
        self.crouching = now

    def tick(self):
        """Every 2 ticks: move every elevator that's on a trip (and every 1/2 second, check for crouching)."""
        from endstone.level import Location
        self.ticks += 1
        if self.ticks % 5 == 0 and self.list:
            self.check_crouch()
        for eid in list(self.trips):
            t = self.trips[eid]
            e = self.list.get(eid)
            if not e:
                self.trips.pop(eid, None)
                continue
            if t["wait"] > 0:
                t["wait"] -= 2
                if t["wait"] <= 0:
                    t["riders"] = [str(p.unique_id) for p in self.riders(e)]
                continue
            distance = abs(t["to"] - t["from"])
            t["p"] = min(distance, t["p"] + STEP)
            floor_top = t["from"] + 1 + t["dir"] * t["p"]  # where riders' feet are
            row = math.floor(floor_top - 1) if t["dir"] == 1 else math.floor(floor_top - 1 - 1e-9)
            if t["p"] >= distance:
                row = t["to"]  # stop exactly at the floor
            if row != e["row"]:
                # going up: put the floor under them first; going down: lower it first. Then clear the old row.
                old = e["row"]
                self.set_row(e, row, e["floor_block"])
                self.set_row(e, old, None)
                e["row"] = row
            dim = self.dim(e)
            for uid in t["riders"] or []:
                p = next((x for x in self.plugin.server.online_players if str(x.unique_id) == uid), None)
                if p is None or p.dimension.name != e["dim"]:
                    continue
                l = p.location
                if not (e["x1"] - 0.3 <= l.x < e["x2"] + 1.3 and e["z1"] - 0.3 <= l.z < e["z2"] + 1.3):
                    continue  # stepped out
                p.teleport(Location(dim, l.x, floor_top, l.z, l.pitch, l.yaw))
                arrow = "§a▲" if t["dir"] == 1 else "§c▼"
                nearest = min(e["floors"], key=lambda f: abs(f["y"] + 1 - floor_top))
                try:
                    p.send_tip(f"{arrow} §f{nearest['name']} §7→ §f{self.floor_name(e, t['to'])}")
                except Exception:
                    pass
                if int(t["p"] / STEP) % 10 == 0:
                    self._sound(p, "minecart.base", 0.25, 0.6)
            if t["p"] >= distance:
                self.arrive(eid)

    def arrive(self, eid):
        e = self.list[eid]
        t = self.trips.pop(eid)
        e["cur"] = e["row"] = t["to"]
        self.save()
        self.set_doors(e, t["to"], True)
        name = self.floor_name(e, t["to"])
        for p in self.plugin.server.online_players:
            if self.inside(e, p) or (p.dimension.name == e["dim"] and self.near(e, p.location, 4) and abs(p.location.y - (t["to"] + 1)) < 3):
                self._sound(p, "note.pling", 0.9, 1.6)
                self.plugin.server.scheduler.run_task(self.plugin, lambda p=p: self._sound(p, "note.pling", 0.9, 1.2), delay=4)
                self._sound(p, "random.door_open", 0.8, 1.0)
                try:
                    p.send_title("", f"§f§l{name}", 3, 25, 8)
                except Exception:
                    pass
        if e["queue"]:
            self.plugin.server.scheduler.run_task(self.plugin, lambda: self.next(eid), delay=OPEN_TIME)

    # ---------- building ----------
    def plan_key(self, player):
        plans = getattr(self.plugin, "plans", None)
        return plans.plan_key(player) if plans else "free"

    def can_build_here(self, player, dim, x1, z1, x2, z2, y=None):
        """Staff anywhere; Galaxy+/Pro+ only inside a plot they own."""
        if player.is_op:
            return True
        plots = getattr(self.plugin, "plots", None)
        if not plots:
            return False
        for x, z in ((x1, z1), (x2, z2), (x1, z2), (x2, z1)):
            plot = plots.at(dim, x, y if y is not None else 64, z)
            if not plot or plot.get("owner") != str(player.xuid):
                return False
        return True

    def mine(self, player):
        return [e for e in self.list.values() if e["owner"] == str(player.xuid)]

    def menu(self, player):
        key = self.plan_key(player)
        if not player.is_op and LIMITS.get(key, 0) == 0:
            return player.send_message("§eElevators are a Galaxy+ and Galaxy Pro+ perk (in your own plots). §7galaxymc.us/store")
        e = self.nearest(player)
        form = ActionForm(title="§l§bElevator Tool", content=f"Your elevators: {len(self.mine(player))}"
                          + ("" if player.is_op else f"/{LIMITS.get(key, 0)}")
                          + (f"\nNearest: §l{e.get('name') or 'Elevator'}§r ({len(e['floors'])} floors)" if e else ""))
        form.add_button("§lCreate an elevator§r\n§8Then tap 2 corners of the cabin floor", icon="textures/ui/color_plus", on_click=self.start_create)
        if e:
            form.add_button("§lAdd a floor here§r\n§8Stand on the landing next to the shaft", icon="textures/ui/up_arrow", on_click=lambda p: self.add_floor_form(p, e["id"]))
            form.add_button("§lFloors§r\n§8Rename or remove floors", icon="textures/ui/book_edit_default", on_click=lambda p: self.floors_menu(p, e["id"]))
            form.add_button("§lCheck the shaft§r\n§8Find blocks in the way", icon="textures/ui/magnifyingGlass", on_click=lambda p: self.check_shaft(p, e["id"]))
            form.add_button("§c§lDelete this elevator", icon="textures/ui/trash", on_click=lambda p: self.delete(p, e["id"]))
        form.add_button("Close")
        player.send_form(form)

    def nearest(self, player, within=8):
        best, dist = None, within
        for e in self.list.values():
            if e["dim"] != player.dimension.name or (e["owner"] != str(player.xuid) and not player.is_op):
                continue
            l = player.location
            d = math.dist((l.x, l.z), ((e["x1"] + e["x2"] + 1) / 2, (e["z1"] + e["z2"] + 1) / 2))
            if d < dist:
                best, dist = e, d
        return best

    def start_create(self, player):
        key = self.plan_key(player)
        if not player.is_op and len(self.mine(player)) >= LIMITS.get(key, 0):
            return player.send_message(f"§cYou already have {len(self.mine(player))} elevators, your limit.")
        self.pending[str(player.unique_id)] = ("corner", None)
        player.send_message("§eTap one corner block of the cabin floor (at the bottom floor).")

    def corner(self, player, block, job):
        _, first = job
        if first is None:
            self.pending[str(player.unique_id)] = ("corner", (block.dimension.name, block.x, block.y, block.z))
            return player.send_message("§eNow tap the opposite corner block of the cabin floor.")
        self.pending.pop(str(player.unique_id), None)
        d, x0, y0, z0 = first
        if block.dimension.name != d or block.y != y0:
            return player.send_message("§cBoth corners must be on the same level. Start again with /elevator.")
        x1, x2 = sorted((x0, block.x))
        z1, z2 = sorted((z0, block.z))
        if x2 - x1 + 1 > MAX_SIZE or z2 - z1 + 1 > MAX_SIZE:
            return player.send_message(f"§cCabins can be at most {MAX_SIZE}x{MAX_SIZE}.")
        if not self.can_build_here(player, d, x1, z1, x2, z2, y0):
            return player.send_message("§cYou can only build elevators inside your own plot.")
        for e in self.list.values():
            if e["dim"] == d and not (x2 < e["x1"] or x1 > e["x2"] or z2 < e["z1"] or z1 > e["z2"]):
                return player.send_message("§cThat overlaps another elevator.")
        floor = self.dim({"dim": d}).get_block_at(x1, y0, z1)
        if floor.type == "minecraft:air":
            return player.send_message("§cTap the cabin floor blocks (not air).")
        try:
            states = dict(floor.data.block_states)
        except Exception:
            states = {}
        eid = str(max([int(k) for k in self.list] + [0]) + 1)
        self.list[eid] = {"id": eid, "name": "Elevator", "owner": str(player.xuid), "owner_name": player.name, "dim": d,
                          "x1": x1, "z1": z1, "x2": x2, "z2": z2, "cur": y0, "row": y0, "floor_block": [floor.type, states],
                          "floors": [{"y": y0, "name": "Lobby"}], "queue": []}
        self.set_row(self.list[eid], y0, self.list[eid]["floor_block"])  # make the whole cabin floor the same block
        self.save()
        self.plugin.progress.add(player, "elevators")
        player.send_message(f"§aElevator created ({x2 - x1 + 1}x{z2 - z1 + 1} cabin) with its first floor, Lobby. "
                            "§7Now go to each other floor, stand on the landing next to the shaft and use the Elevator Tool > Add a floor here. "
                            "Keep the shaft above the cabin an empty hole (no floor inside it on the other floors).")

    def add_floor_form(self, player, eid):
        e = self.list.get(eid)
        if not e:
            return
        y = math.floor(player.location.y) - 1
        if self.floor_index(e, y) is not None:
            return player.send_message("§eThere's already a floor at this height.")
        if not player.is_op and not self.can_build_here(player, e["dim"], e["x1"], e["z1"], e["x2"], e["z2"], y):
            return player.send_message("§cThis floor would be outside your plot.")

        def submit(p, data):
            try:
                name = " ".join(str(json.loads(data)[0]).split())[:20]
            except (ValueError, IndexError):
                return
            e["floors"].append({"y": y, "name": name or f"Floor {len(e['floors']) + 1}"})
            e["floors"].sort(key=lambda f: f["y"])
            self.save()
            p.send_message(f"§aAdded floor §f{e['floors'][self.floor_index(e, y)]['name']}§a. §7Put a button next to the shaft here to call the elevator.")
            in_way = [self.blocker(e, yy) for yy in (y, y + 1, y + 2) if yy != e["row"]]
            in_way = [b for b in in_way if b]
            if in_way:
                x, by, z, t = in_way[0]
                p.send_message(f"§eRemove the {t.replace('minecraft:', '').replace('_', ' ')} inside the shaft here (at {x}, {by}, {z}): "
                               "on this floor the shaft must be an empty hole. The cabin's floor comes up into it.")
        player.send_form(ModalForm(title="Add a floor", controls=[TextInput("Floor name", "e.g. Floor 2, Shops, Roof", f"Floor {len(e['floors']) + 1}")],
                                   submit_button="Add", on_submit=submit))

    def check_shaft(self, player, eid):
        e = self.list.get(eid)
        if not e:
            return
        lo, hi = e["floors"][0]["y"], e["floors"][-1]["y"]
        b = self.first_blocker(e, e["row"], lo) or self.first_blocker(e, e["row"], hi)
        names = ", ".join(f"{f['name']} (height {f['y']})" for f in e["floors"])
        if len(e["floors"]) < 2:
            player.send_message("§eThis elevator has only 1 floor. §7Stand on the landing of another floor next to the shaft and use Add a floor here.")
        elif b:
            player.send_message(self.blocked_text(b))
        else:
            player.send_message(f"§aThe shaft is clear. §7Floors: {names}. The cabin is at {self.floor_name(e, e['row'])}.")

    def floors_menu(self, player, eid):
        e = self.list.get(eid)
        if not e:
            return
        form = ActionForm(title="Floors", content="Tap a floor to rename or remove it. Tap the elevator's name to rename the elevator.")
        form.add_button(f"§lElevator name: {e.get('name') or 'Elevator'}", on_click=lambda p: self.rename(p, eid, None))
        for f in reversed(e["floors"]):
            form.add_button(f"{f['name']}\n§8height {f['y']}", on_click=lambda p, y=f["y"]: self.floor_edit(p, eid, y))
        form.add_button("§l< Back", on_click=self.menu)
        player.send_form(form)

    def floor_edit(self, player, eid, y):
        e = self.list[eid]
        form = ActionForm(title=self.floor_name(e, y))
        form.add_button("§lRename", on_click=lambda p: self.rename(p, eid, y))
        if len(e["floors"]) > 1 and y != e["cur"]:
            form.add_button("§c§lRemove this floor", on_click=lambda p: (e["floors"].pop(self.floor_index(e, y)), self.save(), p.send_message("§7Floor removed.")))
        form.add_button("§l< Back", on_click=lambda p: self.floors_menu(p, eid))
        player.send_form(form)

    def rename(self, player, eid, y):
        e = self.list[eid]

        def submit(p, data):
            try:
                name = " ".join(str(json.loads(data)[0]).split())[:20]
            except (ValueError, IndexError):
                return
            if not name:
                return
            if y is None:
                e["name"] = name
            else:
                e["floors"][self.floor_index(e, y)]["name"] = name
            self.save()
            p.send_message("§aRenamed.")
        player.send_form(ModalForm(title="Rename", controls=[TextInput("Name", "", e.get("name") if y is None else self.floor_name(e, y))],
                                   submit_button="Save", on_submit=submit))

    def delete(self, player, eid):
        e = self.list.get(eid)
        if not e or eid in self.trips:
            return player.send_message("§eWait until the elevator stops.")
        self.list.pop(eid)
        self.save()
        player.send_message("§7Elevator deleted. The cabin floor stays where it is.")

    def remove_in_plot(self, plot):
        """A plot was unclaimed: its owner's elevators inside it stop working."""
        for eid in [k for k, e in self.list.items() if e["dim"] == plot["dim"] and plot["x1"] <= e["x1"] <= plot["x2"]
                    and plot["z1"] <= e["z1"] <= plot["z2"] and e["owner"] == plot.get("owner")]:
            self.trips.pop(eid, None)
            self.list.pop(eid, None)
        self.save()
