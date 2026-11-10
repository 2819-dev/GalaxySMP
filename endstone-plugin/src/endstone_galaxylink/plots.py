"""Plots and protected areas.

Admins:  /plotaxe gives the Plot Axe. Left-click the ground for point 1, right-click for
         point 2, then a Save menu opens: a claimable Plot or a Protected area (like spawn).
         Sneak + right-click inside an existing plot or area with the axe to edit or delete it.
Shop plots: the third Save option. Staff make a row of them (the Shop District). Players claim them the
         same way; each plan has its own number of shop plots (Free 1, Galaxy+ 2, Galaxy Pro+ 3). Owners
         put shop chests in them (shopchests.py) and can name their shop.
Players: right-click inside a plot (white concrete edge) with the Plot Claiming Shovel to claim
         it. The shovel breaks; they get a Plot Manager (a clock) to add members, highlight the
         border, teleport there or unclaim (which resets the plot to how it was when it was made).

Plots go from the ground the admin clicked up to a chosen height, and all the way down.
The original blocks are saved with Minecraft's own /structure command (fast and exact), in
64x64 columns, and loaded back when a plot is unclaimed. A temporary ticking area keeps the
plot loaded while that happens, so it works even when nobody is nearby.
"""

import json
import math
import time

from endstone.form import ActionForm, Dropdown, ModalForm, TextInput, Toggle

TOOL_MARK = "§8galaxysmp tool:"
TOOLS = {
    "axe": ("minecraft:wooden_axe", "§6§lPlot Axe", ["§7Left-click: point 1", "§7Right-click: point 2",
                                                    "§7Sneak + right-click a plot: edit it"]),
    "shovel": ("minecraft:golden_shovel", "§b§lPlot Claiming Shovel", ["§7Right-click inside a plot", "§7(white concrete edge) to claim it"]),
    "manager": ("minecraft:clock", "§a§lPlot Manager", ["§7Use it to manage your plot"]),
    "elevator": ("minecraft:nether_star", "§b§lElevator Tool", ["§7Use it to build and manage elevators", "§7(Staff, Galaxy+ and Galaxy Pro+)"]),
}
BOTTOM = {"Overworld": -64, "Nether": 0, "TheEnd": 0}
TOP_LIMIT = {"Overworld": 319, "Nether": 127, "TheEnd": 255}
MAX_SIZE = 128          # blocks per side (keeps the ticking area under Minecraft's 100-chunk limit)
TILE = 64               # /structure pieces
CLAIM_LEVELS = [("all", "Everyone"), ("plus", "Galaxy+ and Pro+ only"), ("pro", "Galaxy Pro+ only")]
PLAN_LEVEL = {"free": 0, "plus": 1, "pro": 2}
AREA_FLAGS = [("doors", "Players can use doors, gates, buttons and levers"),
              ("chests", "Players can open chests and other containers"),
              ("pvp", "Players can fight each other (PvP)"),
              ("explosions", "Explosions can break blocks")]
DOORS = ("door", "trapdoor", "fence_gate", "button", "lever")
CONTAINERS = ("chest", "barrel", "shulker_box", "furnace", "smoker", "hopper", "dropper", "dispenser",
              "brewing_stand", "crafter", "decorated_pot", "chiseled_bookshelf", "lectern", "jukebox")
HARMLESS = ("computer", "crafting_table", "enchanting_table", "cartography_table", "smithing_table", "stonecutter",
            "grindstone", "loom", "bell", "ender_chest")


def dim_cmd(name):
    n = str(name).lower()
    return "nether" if "nether" in n else "the_end" if "end" in n else "overworld"


class Plots:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS plots (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT);
            CREATE TABLE IF NOT EXISTS plot_players (xuid TEXT PRIMARY KEY, shovel_given INTEGER DEFAULT 0);
        """)
        self.db.commit()
        self.plots = {pid: json.loads(d) for pid, d in self.db.execute("SELECT id, data FROM plots").fetchall()}
        self.points = {}       # admin uuid -> {"p1": (dim, x, y, z), "p2": ...}
        self.highlight = set() # player uuids with Highlight Plot on
        self.inside = {}       # player uuid -> plot id they're standing in (for "Entering ..." messages)
        self.jobs = []         # running jobs: [generator, ticks to wait]
        self.extra = {}        # xuid -> extra plots (from the website)
        self.extra_shop = {}   # xuid -> extra shop plots (from the website)
        self._ticks = 0

    # ---------- storage ----------
    def save(self, pid):
        self.db.execute("UPDATE plots SET data = ? WHERE id = ?", (json.dumps(self.plots[pid]), pid))
        self.db.commit()

    def label(self, plot):
        if plot.get("shop"):
            return plot.get("shop_name") or f"Shop {plot['id']}"
        return plot.get("name") or f"Plot {plot['id']}"

    # ---------- items ----------
    def make_tool(self, kind):
        from endstone.inventory import ItemStack
        item, name, lore = TOOLS[kind]
        stack = ItemStack(item, 1)
        meta = stack.item_meta
        meta.display_name = name
        meta.lore = lore + [TOOL_MARK + kind]
        stack.set_item_meta(meta)
        return stack

    @staticmethod
    def tool_kind(stack):
        if stack is None:
            return None
        try:
            meta = stack.item_meta
            for line in (meta.lore or []) if meta.has_lore else []:
                if line.startswith(TOOL_MARK):
                    return line[len(TOOL_MARK):]
        except Exception:
            pass
        return None

    def give_tool(self, player, kind):
        from endstone_galaxylink import money
        money.give(player, self.make_tool(kind))

    def has_tool(self, player, kind):
        inv = player.inventory
        return any(self.tool_kind(inv.get_item(i)) == kind for i in range(inv.size))

    def take_tool(self, player, kind, every=False):
        inv = player.inventory
        for i in range(inv.size):
            s = inv.get_item(i)
            if self.tool_kind(s) == kind:
                if s.amount > 1 and not every:
                    s.amount -= 1
                    inv.set_item(i, s)
                else:
                    inv.set_item(i, None)
                if not every:
                    return True
        return every

    # ---------- where things are ----------
    def at(self, dim, x, y, z):
        for pid, p in self.plots.items():
            if p["dim"] == dim and p["x1"] <= x <= p["x2"] and p["z1"] <= z <= p["z2"] and y <= p["top"]:
                return p
        return None

    def at_block(self, block):
        return self.at(block.dimension.name, block.x, block.y, block.z)

    def at_player(self, player):
        l = player.location
        return self.at(player.dimension.name, math.floor(l.x), math.floor(l.y), math.floor(l.z))

    def owned(self, xuid, shop=None):
        """A player's plots: all of them, or only shop plots (shop=True) or only home plots (shop=False)."""
        return [p for p in self.plots.values() if p.get("owner") == str(xuid) and (shop is None or bool(p.get("shop")) == shop)]

    def allowance(self, player, shop=False):
        plans = getattr(self.plugin, "plans", None)
        if shop:
            return (plans.plan_for(player).get("shopPlots", 1) if plans else 1) + int(self.extra_shop.get(str(player.xuid), 0))
        base = plans.plan_for(player).get("plots", 1) if plans else 1
        return base + int(self.extra.get(str(player.xuid), 0))

    def room(self, player, shop):
        return len(self.owned(player.xuid, shop)) < self.allowance(player, shop)

    def kind_word(self, plot):
        return "shop plot" if plot.get("shop") else "plot"

    def role(self, player, plot):
        if player.is_op:
            return "owner"
        if plot.get("owner") == str(player.xuid):
            return "owner"
        m = (plot.get("members") or {}).get(player.name.lower())
        return m["role"] if m else None

    # ---------- protection ----------
    def may_build(self, player, plot):
        if plot is None or player.is_op:
            return True
        if plot["kind"] == "area" or not plot.get("owner"):
            return False
        return self.role(player, plot) in ("owner", "builder")

    def may_use(self, player, plot, block_type):
        if plot is None or player.is_op:
            return True
        t = block_type.split(":")[-1]
        if any(k in t for k in HARMLESS):
            return True
        is_door = any(k in t for k in DOORS)
        is_box = any(k in t for k in CONTAINERS)
        if plot["kind"] == "area":
            flags = plot.get("flags") or {}
            return (is_door and flags.get("doors")) or (is_box and flags.get("chests")) or False
        if not plot.get("owner"):
            return is_door
        r = self.role(player, plot)
        if r in ("owner", "builder"):
            return True
        return r == "visitor" and (is_door or is_box)

    def deny(self, player, plot):
        who = "a protected area" if plot["kind"] == "area" else (
            f"{plot.get('owner_name', 'someone')}'s plot" if plot.get("owner") else "an unclaimed plot")
        player.send_popup(f"§cYou can't do that in {who}.")

    def on_break(self, event):
        p = event.player
        stack = p.inventory.item_in_main_hand
        kind = self.tool_kind(stack)
        if kind == "axe" and p.is_op:
            event.is_cancelled = True
            b = event.block
            self.set_point(p, "p1", b)
            return
        if kind in ("shovel", "manager"):
            event.is_cancelled = True
            return
        plot = self.at_block(event.block)
        if not self.may_build(p, plot):
            event.is_cancelled = True
            self.deny(p, plot)

    def on_place(self, event):
        p = event.player
        b = event.block_replaced
        plot = self.at_block(b)
        if not self.may_build(p, plot):
            event.is_cancelled = True
            self.deny(p, plot)

    def on_interact(self, event):
        from endstone.event import PlayerInteractEvent
        p = event.player
        action = event.action
        right = action in (PlayerInteractEvent.Action.RIGHT_CLICK_BLOCK, PlayerInteractEvent.Action.RIGHT_CLICK_AIR)
        kind = self.tool_kind(event.item) if event.has_item else None
        if kind == "axe" and p.is_op:
            event.is_cancelled = True
            if action == PlayerInteractEvent.Action.RIGHT_CLICK_BLOCK:
                if p.is_sneaking:
                    plot = self.at_block(event.block)
                    if plot:
                        return self.admin_menu(p, plot["id"])
                self.set_point(p, "p2", event.block)
            elif action == PlayerInteractEvent.Action.LEFT_CLICK_BLOCK:
                self.set_point(p, "p1", event.block)
            return
        if kind == "shovel" and right:
            event.is_cancelled = True
            if action == PlayerInteractEvent.Action.RIGHT_CLICK_BLOCK:
                self.try_claim(p, event.block)
            else:
                p.send_message("§eRight-click the ground inside a plot (white concrete edge) to claim it.")
            return
        if kind == "manager" and right:
            event.is_cancelled = True
            self.open_manager(p)
            return
        if action == PlayerInteractEvent.Action.RIGHT_CLICK_BLOCK and event.has_block:
            plot = self.at_block(event.block)
            if plot is None or p.is_op:
                return
            if self.may_use(p, plot, event.block.type):
                # Using an item on a block (buckets, flint and steel...) counts as building.
                if event.has_item and not self.may_build(p, plot) and self._places_something(event.item):
                    event.is_cancelled = True
                    self.deny(p, plot)
                return
            event.is_cancelled = True
            self.deny(p, plot)

    @staticmethod
    def _places_something(stack):
        t = str(getattr(stack.type, "id", stack.type))
        return any(k in t for k in ("bucket", "flint_and_steel", "fire_charge", "bone_meal", "spawn_egg", "boat", "minecart", "armor_stand", "end_crystal"))

    def on_explode(self, event):
        keep = []
        for b in event.block_list:
            plot = self.at_block(b)
            if plot is None or (plot["kind"] == "area" and (plot.get("flags") or {}).get("explosions")):
                keep.append(b)
        if len(keep) != len(event.block_list):
            event.block_list = keep

    def on_damage(self, event):
        try:
            victim = event.actor
            attacker = event.damage_source.actor
        except Exception:
            return
        if not (hasattr(victim, "xuid") and attacker is not None and hasattr(attacker, "xuid")):
            return
        l = victim.location
        plot = self.at(victim.dimension.name, math.floor(l.x), math.floor(l.y), math.floor(l.z))
        if plot and plot["kind"] == "area" and not (plot.get("flags") or {}).get("pvp"):
            event.is_cancelled = True

    def on_flow(self, event):
        """Water and lava can't flow into a plot from outside it."""
        a, b = event.block, event.to_block
        pa, pb = self.at_block(a), self.at_block(b)
        if pb is not None and pa is not pb:
            event.is_cancelled = True

    def on_join(self, player):
        row = self.db.execute("SELECT shovel_given FROM plot_players WHERE xuid = ?", (str(player.xuid),)).fetchone()
        if not row:
            self.db.execute("INSERT INTO plot_players (xuid, shovel_given) VALUES (?, 1)", (str(player.xuid),))
            self.db.commit()
            if not self.owned(player.xuid):
                self.give_tool(player, "shovel")
                player.send_message("§bYou got a Plot Claiming Shovel! §7Find a plot with a white concrete edge "
                                    "and right-click the ground inside it to claim it.")

    # ---------- admin: making plots ----------
    def set_point(self, player, which, block):
        pts = self.points.setdefault(str(player.unique_id), {})
        pts[which] = (block.dimension.name, block.x, block.y, block.z)
        player.send_message(f"§d{'First' if which == 'p1' else 'Second'} point set §7({block.x}, {block.y}, {block.z})")
        if "p1" in pts and "p2" in pts:
            self.save_form(player)

    def save_form(self, player):
        pts = self.points.get(str(player.unique_id), {})
        (d1, x1, y1, z1), (d2, x2, y2, z2) = pts["p1"], pts["p2"]
        if d1 != d2:
            player.send_message("§cBoth points must be in the same dimension.")
            self.points.pop(str(player.unique_id), None)
            return
        w, l = abs(x2 - x1) + 1, abs(z2 - z1) + 1
        controls = [
            Dropdown("Type", ["Plot (players can claim it)", "Protected area (like spawn)", "Shop plot (Shop District)"], 0),
            TextInput("Name (protected areas only; plots are numbered)", "e.g. Spawn", ""),
            TextInput("Height: blocks above the ground (it always goes all the way down)", "64", "64"),
            Dropdown("Who can claim it (plots only)", [n for _, n in CLAIM_LEVELS], 0),
        ]
        controls += [Toggle(f"Protected area: {label}", False) for _, label in AREA_FLAGS]

        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            self.points.pop(str(p.unique_id), None)
            self.create(p, d1, (x1, y1, z1), (x2, y2, z2), v)

        player.send_form(ModalForm(title=f"Save {w}x{l} area", controls=controls, submit_button="Save", on_submit=submit))

    def create(self, player, dim, a, b, v):
        kind = "area" if int(v[0]) == 1 else "plot"
        shop = int(v[0]) == 2
        name = str(v[1]).strip()[:32]
        try:
            height = int(str(v[2]).strip() or "64")
        except ValueError:
            player.send_message("§cHeight must be a number, like 64.")
            return
        x1, x2 = sorted((a[0], b[0]))
        z1, z2 = sorted((a[2], b[2]))
        y0 = min(a[1], b[1])
        if x2 - x1 + 1 > MAX_SIZE or z2 - z1 + 1 > MAX_SIZE:
            player.send_message(f"§cPlots can be at most {MAX_SIZE}x{MAX_SIZE} blocks.")
            return
        if x2 - x1 < 2 or z2 - z1 < 2:
            player.send_message("§cThat's too small. Make it at least 3x3.")
            return
        if kind == "area" and not name:
            player.send_message("§cGive the protected area a name, like Spawn.")
            return
        height = max(4, min(height, TOP_LIMIT.get(dim, 319) - y0))
        for p in self.plots.values():
            if p["dim"] == dim and not (x2 < p["x1"] or x1 > p["x2"] or z2 < p["z1"] or z1 > p["z2"]):
                player.send_message(f"§cThat overlaps {self.label(p)}. Sneak + right-click it with the Plot Axe to edit or delete it.")
                return
        plot = {
            "kind": kind, "name": name if kind == "area" else "", "dim": dim, "shop": shop,
            "x1": x1, "z1": z1, "x2": x2, "z2": z2, "y0": y0, "top": y0 + height, "bottom": BOTTOM.get(dim, -64),
            "claim": CLAIM_LEVELS[int(v[3])][0] if kind == "plot" else "all",
            "flags": {key: bool(on) for (key, _), on in zip(AREA_FLAGS, v[4:4 + len(AREA_FLAGS)])} if kind == "area" else {},
            "owner": None, "owner_name": None, "members": {}, "status": "saving", "created": time.time(),
            "created_by": player.name, "edges": [],
        }
        cur = self.db.execute("INSERT INTO plots (data) VALUES (?)", (json.dumps(plot),))
        self.db.commit()
        pid = cur.lastrowid
        plot["id"] = pid
        self.plots[pid] = plot
        self.save(pid)
        player.send_message(f"§aSaving {self.label(plot)}... §7(about 5 seconds)")
        self.run(self._job_create(pid, player.unique_id))

    # ---------- jobs (spread over several ticks) ----------
    def run(self, gen):
        self.jobs.append([gen, 0])

    def tick(self):
        self._ticks += 1
        for job in list(self.jobs):
            if job[1] > 0:
                job[1] -= 1
                continue
            try:
                job[1] = next(job[0]) or 0
            except StopIteration:
                self.jobs.remove(job)
            except Exception as e:
                self.plugin.logger.warning(f"Plot job failed: {e}")
                self.jobs.remove(job)
        if self._ticks % 10 == 0:
            self.draw_highlights()
        if self._ticks % 20 == 0:
            self.entering_messages()

    def cmd(self, line, plot):
        server = self.plugin.server
        return server.dispatch_command(server.command_sender, f"execute in {dim_cmd(plot['dim'])} run {line}")

    def tiles(self, plot):
        for x in range(plot["x1"], plot["x2"] + 1, TILE):
            for z in range(plot["z1"], plot["z2"] + 1, TILE):
                yield f"gsmp_plot_{plot['id']}_{x - plot['x1']}_{z - plot['z1']}", x, z, min(x + TILE - 1, plot["x2"]), min(z + TILE - 1, plot["z2"])

    def _keep_loaded(self, plot, on):
        name = f"gsmp_plot_{plot['id']}"
        if on:
            self.cmd(f"tickingarea add {plot['x1']} 0 {plot['z1']} {plot['x2']} 0 {plot['z2']} {name} true", plot)
        else:
            self.cmd(f"tickingarea remove {name}", plot)

    def edge_blocks(self, plot):
        dim = self.plugin.server.level.get_dimension(plot["dim"])
        y = plot["y0"]
        for x in range(plot["x1"], plot["x2"] + 1):
            for z in range(plot["z1"], plot["z2"] + 1):
                if x in (plot["x1"], plot["x2"]) or z in (plot["z1"], plot["z2"]):
                    yield dim.get_block_at(x, y, z)

    def paint_edge(self, plot):
        for b in self.edge_blocks(plot):
            b.set_type("minecraft:white_concrete")

    def restore_edge(self, plot):
        server = self.plugin.server
        for b, (t, states) in zip(self.edge_blocks(plot), plot.get("edges") or []):
            try:
                b.set_data(server.create_block_data(t, states))
            except Exception:
                b.set_type(t)

    def _job_create(self, pid, admin_uid):
        plot = self.plots[pid]
        self._keep_loaded(plot, True)
        yield 60
        for name, ax, az, bx, bz in self.tiles(plot):
            self.cmd(f"structure save {name} {ax} {plot['bottom']} {az} {bx} {plot['top']} {bz} false disk true", plot)
        yield 5
        edges = []
        for b in self.edge_blocks(plot):
            d = b.data
            edges.append((d.type, dict(d.block_states)))
        plot["edges"] = edges
        if plot["kind"] == "plot":
            self.paint_edge(plot)
        plot["status"] = "ready"
        self.save(pid)
        self._keep_loaded(plot, False)
        admin = self.plugin.server.get_player(admin_uid)
        if admin:
            if plot["kind"] == "plot":
                admin.send_message(f"§a{self.label(plot)} is ready to claim! §7The white concrete edge shows it's available.")
            else:
                admin.send_message(f"§aProtected area §f{self.label(plot)}§a saved.")

    def _job_reset(self, pid, then_paint=True):
        plot = self.plots[pid]
        plot["status"] = "resetting"
        self.save(pid)
        self._keep_loaded(plot, True)
        yield 60
        for name, ax, az, bx, bz in self.tiles(plot):
            self.cmd(f"structure load {name} {ax} {plot['bottom']} {az} 0_degrees none false true", plot)
        yield 10
        if then_paint and plot["kind"] == "plot":
            self.paint_edge(plot)
        plot["status"] = "ready"
        self.save(pid)
        self._keep_loaded(plot, False)

    def _job_delete(self, pid):
        plot = self.plots[pid]
        self._keep_loaded(plot, True)
        yield 40
        if plot["kind"] == "plot" and not plot.get("owner"):
            self.restore_edge(plot)
        for name, *_ in self.tiles(plot):
            self.cmd(f"structure delete {name}", plot)
        self._keep_loaded(plot, False)
        self.plots.pop(pid, None)
        self.db.execute("DELETE FROM plots WHERE id = ?", (pid,))
        self.db.commit()

    # ---------- claiming ----------
    def try_claim(self, player, block):
        plot = self.at_block(block)
        if plot is None or plot["kind"] == "area":
            player.send_message("§cYou can't claim here. §7Find a plot with a white concrete edge and right-click inside it.")
            return
        if plot.get("owner") == str(player.xuid):
            player.send_message("§eThis is already your plot. §7Use your Plot Manager (clock) to manage it.")
            return
        if plot.get("owner"):
            player.send_message("§cThis plot is already claimed.")
            return
        if plot.get("status") != "ready":
            player.send_message("§eThis plot is being reset. Try again in a minute.")
            return
        plans = getattr(self.plugin, "plans", None)
        level = PLAN_LEVEL.get(plans.plan_key(player) if plans else "free", 0)
        need = {"all": 0, "plus": 1, "pro": 2}[plot.get("claim", "all")]
        if level < need and not player.is_op:
            player.send_message(f"§cOnly {'Galaxy+ and Pro+' if need == 1 else 'Galaxy Pro+'} players can claim this plot. §7galaxymc.us/store")
            return
        shop = bool(plot.get("shop"))
        have, limit = len(self.owned(player.xuid, shop)), self.allowance(player, shop)
        word = self.kind_word(plot)
        if have >= limit and not player.is_op:
            player.send_message(f"§cYou already have {have} {word}{'s' if have != 1 else ''}, your limit. "
                                + ("§7Galaxy+ and Pro+ get more shop plots (galaxymc.us/store)." if shop else
                                   "§7Get more with an extra plot or Galaxy+/Pro+ (galaxymc.us/store)."))
            return
        w, l = plot["x2"] - plot["x1"] + 1, plot["z2"] - plot["z1"] + 1
        form = ActionForm(title=f"Claim {self.label(plot)}?",
                          content=f"Size: §f{w} x {l}§r blocks, {plot['top'] - plot['y0']} up from the ground.\n\n"
                                  + ("§6This is a shop plot.§r Put shop chests here to sell to other players (sneak + tap a chest).\n"
                                     if shop else "") +
                                  f"It becomes yours: only you and players you add can build here.\n"
                                  f"§7Your {word}s: {have}/{limit}. Your shovel breaks when you claim.")
        form.add_button(f"§2§lClaim this {word}", on_click=lambda p: self.claim(p, plot["id"]))
        form.add_button("Cancel")
        player.send_form(form)

    def claim(self, player, pid):
        plot = self.plots.get(pid)
        if not plot or plot.get("owner") or plot.get("status") != "ready":
            player.send_message("§cThis plot is already claimed.")
            return
        if not self.room(player, bool(plot.get("shop"))) and not player.is_op:
            player.send_message(f"§cYou've reached your {self.kind_word(plot)} limit.")
            return
        if not self.take_tool(player, "shovel"):
            player.send_message("§cYou need a Plot Claiming Shovel to claim a plot.")
            return
        plot.update({"owner": str(player.xuid), "owner_name": player.name, "members": {}, "claimed_at": time.time()})
        self.save(pid)
        self.restore_edge(plot)
        player.send_message(f"§a§lYou claimed {self.label(plot)}! §r§7Your shovel broke. Use your §aPlot Manager§7 (clock) to manage it.")
        if plot.get("shop"):
            player.send_message("§6Shop tip: §7sneak + tap a chest in your shop plot to make it a shop chest. "
                                "Name your shop and place its sign with the Plot Manager.")
        if not self.has_tool(player, "manager"):
            self.give_tool(player, "manager")
        if self.room(player, False) or self.room(player, True):
            self.give_tool(player, "shovel")
            player.send_message("§7You can claim another plot or shop plot, so you got a new shovel.")

    # ---------- the Plot Manager ----------
    def open_manager(self, player):
        mine = self.owned(player.xuid)
        if not mine:
            player.send_message("§eYou don't have a plot yet. §7Claim one with a Plot Claiming Shovel (/plot shovel).")
            return
        if len(mine) == 1:
            return self.manage(player, mine[0]["id"])
        form = ActionForm(title="Your plots", content="Choose a plot.")
        for p in mine:
            form.add_button(f"§l{self.label(p)}§r\n§8{p['x2'] - p['x1'] + 1}x{p['z2'] - p['z1'] + 1} · {len(p.get('members') or {})} members",
                            on_click=lambda pl, pid=p["id"]: self.manage(pl, pid))
        player.send_form(form)

    def manage(self, player, pid):
        plot = self.plots.get(pid)
        if not plot or plot.get("owner") != str(player.xuid):
            return
        members = plot.get("members") or {}
        lit = str(player.unique_id) in self.highlight
        center = ((plot["x1"] + plot["x2"]) // 2, plot["y0"] + 1, (plot["z1"] + plot["z2"]) // 2)
        content = (f"§l{self.label(plot)}§r  §7({plot['dim']} {center[0]}, {center[2]})\n"
                   f"Size: {plot['x2'] - plot['x1'] + 1} x {plot['z2'] - plot['z1'] + 1}\n"
                   f"Members: {', '.join(m['name'] for m in members.values()) or 'none'}")
        form = ActionForm(title="Plot Manager", content=content)
        form.add_button(f"§lMembers§r\n§8{len(members)} added · Builders and Visitors", icon="textures/ui/multiplayer_glyph_color",
                        on_click=lambda p: self.members_menu(p, pid))
        form.add_button(f"§lHighlight Plot: {'§aOn' if lit else '§cOff'}§r\n§8Show the border around your plot",
                        icon="textures/ui/world_glyph_color", on_click=lambda p: self.toggle_highlight(p, pid))
        form.add_button("§lTeleport to plot§r\n§8Go to the middle of your plot", icon="textures/ui/realmsIcon",
                        on_click=lambda p: self.plugin.teleports.go(p, lambda: {"dim": plot["dim"], "x": center[0] + 0.5, "y": center[1], "z": center[2] + 0.5}, self.label(plot))
                        if getattr(self.plugin, "teleports", None) else None)
        if plot.get("shop"):
            form.add_button("§6§lShop name and sign§r\n§8Name your shop, put its sign where you stand", icon="textures/ui/store_home_icon",
                            on_click=lambda p: self.shop_sign_form(p, pid))
        form.add_button("§c§lUnclaim plot§r\n§8Deletes everything and frees the plot", icon="textures/ui/trash",
                        on_click=lambda p: self.confirm_unclaim(p, pid))
        player.send_form(form)

    def shop_sign_form(self, player, pid):
        plot = self.plots.get(pid)
        if not plot or plot.get("owner") != str(player.xuid):
            return

        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            name = " ".join(str(v[0]).split())[:24]
            f = getattr(self.plugin, "chatfilter", None)
            if name and f and f.bad_spans(name):
                return p.send_message("§cPlease pick a different shop name.")
            plot["shop_name"] = name or None
            self.save(pid)
            here = self.at_player(p)
            ft = getattr(self.plugin, "floating", None)
            if ft:
                if v[1] and here and here["id"] == pid:
                    l = p.location
                    plot["sign"] = [round(l.x, 2), round(l.y + 1.6, 2), round(l.z, 2)]
                    self.save(pid)
                if plot.get("sign"):
                    x, y, z = plot["sign"]
                    ft.set(f"shopsign:{pid}", plot["dim"], x, y, z, self.shop_sign_text(plot))
                elif v[1]:
                    p.send_message("§cStand inside your shop plot to place the sign.")
            p.send_message(f"§aSaved. §7Your shop is called §f{self.label(plot)}§7.")
        player.send_form(ModalForm(title="Shop name and sign", controls=[
            TextInput("Shop name (shown to shoppers)", "e.g. Steve's Diamonds", plot.get("shop_name") or ""),
            Toggle("Put the floating sign where I'm standing", not plot.get("sign")),
        ], submit_button="Save", on_submit=submit))

    def shop_sign_text(self, plot):
        return f"§6§l{self.label(plot)}\n§r§7by {plot.get('owner_name') or '?'} · tap a chest to shop"

    def toggle_highlight(self, player, pid):
        key = str(player.unique_id)
        if key in self.highlight:
            self.highlight.discard(key)
            player.send_message("§7Plot highlight off.")
        else:
            self.highlight.add(key)
            player.send_message("§aPlot highlight on. §7Your plot's border shows like a world border.")
        self.manage(player, pid)

    def members_menu(self, player, pid):
        plot = self.plots[pid]
        members = plot.get("members") or {}
        form = ActionForm(title="Members", content="§lBuilders§r can build, break and open chests.\n"
                          "§lVisitors§r can use doors, buttons and chests.\nTap a member to change or remove them.")
        form.add_button("§2§lAdd a player", icon="textures/ui/color_plus", on_click=lambda p: self.add_member_form(p, pid))
        for key, m in sorted(members.items()):
            form.add_button(f"{m['name']}\n§8{m['role'].title()}", on_click=lambda p, key=key: self.member_form(p, pid, key))
        form.add_button("§l< Back", on_click=lambda p: self.manage(p, pid))
        player.send_form(form)

    def add_member_form(self, player, pid):
        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            name = " ".join(str(v[0]).split())[:32].lstrip("@")
            if not name:
                return self.members_menu(p, pid)
            if name.lower() == p.name.lower():
                p.send_message("§cThat's you!")
                return self.members_menu(p, pid)
            plot = self.plots[pid]
            plot.setdefault("members", {})[name.lower()] = {"name": name, "role": "builder" if int(v[1]) == 0 else "visitor"}
            self.save(pid)
            p.send_message(f"§aAdded {name} as a {'Builder' if int(v[1]) == 0 else 'Visitor'}. §7Gamertags must match exactly.")
            self.members_menu(p, pid)
        player.send_form(ModalForm(title="Add a player", controls=[
            TextInput("Gamertag", "e.g. Steve", ""),
            Dropdown("Can", ["Builder: build, break and open chests", "Visitor: use doors, buttons and chests"], 0),
        ], submit_button="Add", on_submit=submit))

    def member_form(self, player, pid, key):
        plot = self.plots[pid]
        m = plot["members"][key]
        form = ActionForm(title=m["name"], content=f"{m['name']} is a {m['role'].title()}.")
        other = "visitor" if m["role"] == "builder" else "builder"

        def set_role(p):
            m["role"] = other
            self.save(pid)
            self.members_menu(p, pid)

        def remove(p):
            plot["members"].pop(key, None)
            self.save(pid)
            p.send_message(f"§7Removed {m['name']}.")
            self.members_menu(p, pid)
        form.add_button(f"Make {other.title()}", on_click=set_role)
        form.add_button("§cRemove from plot", on_click=remove)
        form.add_button("§l< Back", on_click=lambda p: self.members_menu(p, pid))
        player.send_form(form)

    def confirm_unclaim(self, player, pid):
        plot = self.plots[pid]
        form = ActionForm(title=f"Unclaim {self.label(plot)}?",
                          content="§c§lEverything in this plot will be deleted§r§c and it goes back to how it was.§r\n"
                                  "This can't be undone. Take your items out first!")
        form.add_button("§c§lYes, unclaim and delete everything", on_click=lambda p: self.unclaim(p, pid))
        form.add_button("No, keep my plot", on_click=lambda p: self.manage(p, pid))
        player.send_form(form)

    def unclaim(self, player, pid, by_admin=False):
        plot = self.plots.get(pid)
        if not plot:
            return
        owner = plot.get("owner")
        el = getattr(self.plugin, "elevators", None)
        if el:
            el.remove_in_plot(plot)
        if plot.get("shop"):
            sc = getattr(self.plugin, "shopchests", None)
            if sc:
                sc.close_plot(pid, owner)
            ft = getattr(self.plugin, "floating", None)
            if ft:
                ft.remove(f"shopsign:{pid}")
            plot.pop("shop_name", None)
            plot.pop("sign", None)
        # "resetting" right away, so nobody can claim it before the reset has finished.
        plot.update({"owner": None, "owner_name": None, "members": {}, "status": "resetting"})
        self.save(pid)
        self.run(self._job_reset(pid))
        if by_admin:
            player.send_message(f"§a{self.label(plot)} is being reset and will be available again.")
            return
        player.send_message(f"§a{self.label(plot)} unclaimed. §7It's being reset and will be available for someone else.")
        if owner == str(player.xuid):
            if not self.owned(player.xuid):
                self.take_tool(player, "manager", every=True)
                self.highlight.discard(str(player.unique_id))
            if not self.has_tool(player, "shovel"):
                self.give_tool(player, "shovel")
                player.send_message("§7You got your Plot Claiming Shovel back.")

    # ---------- admin: editing ----------
    def admin_menu(self, player, pid):
        plot = self.plots[pid]
        owner = plot.get("owner_name") or "nobody"
        info = (f"§l{self.label(plot)}§r ({'Protected area' if plot['kind'] == 'area' else 'Shop plot' if plot.get('shop') else 'Plot'})\n"
                f"{plot['x2'] - plot['x1'] + 1} x {plot['z2'] - plot['z1'] + 1}, height {plot['top'] - plot['y0']}, status {plot.get('status')}\n")
        if plot["kind"] == "plot":
            info += f"Owner: {owner} · Claim: {dict(CLAIM_LEVELS)[plot.get('claim', 'all')]}"
        else:
            on = [label for key, label in AREA_FLAGS if (plot.get('flags') or {}).get(key)]
            info += "Allowed: " + ("; ".join(on) if on else "nothing (fully protected)")
        form = ActionForm(title="Edit plot", content=info)
        form.add_button("§lSettings", on_click=lambda p: self.admin_settings(p, pid))
        if plot.get("owner"):
            form.add_button("§lUnclaim and reset", on_click=lambda p: self.unclaim(p, pid, by_admin=True))
        form.add_button("§c§lDelete this plot", on_click=lambda p: self.admin_delete(p, pid))
        player.send_form(form)

    def admin_settings(self, player, pid):
        plot = self.plots[pid]
        controls = [TextInput("Name (protected areas only)", "e.g. Spawn", plot.get("name") or ""),
                    Dropdown("Who can claim it (plots only)", [n for _, n in CLAIM_LEVELS],
                             next((i for i, (k, _) in enumerate(CLAIM_LEVELS) if k == plot.get("claim")), 0))]
        controls += [Toggle(f"Protected area: {label}", bool((plot.get("flags") or {}).get(key))) for key, label in AREA_FLAGS]

        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            if plot["kind"] == "area":
                plot["name"] = str(v[0]).strip()[:32] or plot.get("name")
                plot["flags"] = {key: bool(on) for (key, _), on in zip(AREA_FLAGS, v[2:2 + len(AREA_FLAGS)])}
            else:
                plot["claim"] = CLAIM_LEVELS[int(v[1])][0]
            self.save(pid)
            p.send_message("§aSaved.")
        player.send_form(ModalForm(title=f"{self.label(plot)} settings", controls=controls, submit_button="Save", on_submit=submit))

    def admin_delete(self, player, pid):
        plot = self.plots[pid]
        form = ActionForm(title=f"Delete {self.label(plot)}?",
                          content="The plot stops existing. Blocks inside are left as they are" +
                                  (f"; {plot.get('owner_name')} loses it." if plot.get("owner") else "."))
        def delete(p):
            if plot.get("shop"):
                sc = getattr(self.plugin, "shopchests", None)
                if sc:
                    sc.close_plot(pid, plot.get("owner"))
                ft = getattr(self.plugin, "floating", None)
                if ft:
                    ft.remove(f"shopsign:{pid}")
            plot["status"] = "deleting"  # nobody can claim it while it's being deleted
            self.save(pid)
            self.run(self._job_delete(pid))
            p.send_message("§aDeleting the plot...")
        form.add_button("§c§lYes, delete it", on_click=delete)
        form.add_button("Cancel")
        player.send_form(form)

    # ---------- highlight and messages ----------
    def draw_highlights(self):
        for p in self.plugin.server.online_players:
            if str(p.unique_id) not in self.highlight:
                continue
            l = p.location
            for plot in self.owned(p.xuid):
                if plot["dim"] != p.dimension.name:
                    continue
                y0 = math.floor(l.y)
                for x, z in self.border_points(plot, l.x, l.z, 24):
                    for dy in (0, 1, 2, 3):
                        p.spawn_particle("minecraft:blue_flame_particle", x, y0 + dy, z)

    @staticmethod
    def border_points(plot, px, pz, radius):
        """Points every block along the plot's outer edge that are near the player."""
        x1, x2, z1, z2 = plot["x1"], plot["x2"] + 1, plot["z1"], plot["z2"] + 1
        out = []
        for x in range(x1, x2 + 1):
            for z in (z1, z2):
                if abs(x - px) <= radius and abs(z - pz) <= radius:
                    out.append((x, z))
        for z in range(z1 + 1, z2):
            for x in (x1, x2):
                if abs(x - px) <= radius and abs(z - pz) <= radius:
                    out.append((x, z))
        return out

    def entering_messages(self):
        for p in self.plugin.server.online_players:
            key = str(p.unique_id)
            plot = self.at_player(p)
            now = plot["id"] if plot else None
            if self.inside.get(key) != now:
                self.inside[key] = now
                if plot is None:
                    continue
                if plot["kind"] == "area":
                    p.send_message(f"§7Entering §f{self.label(plot)}§7 (protected area)")
                elif plot.get("owner") and plot.get("shop"):
                    if plot["owner"] == str(p.xuid):
                        p.send_message("§7Entering §fyour shop§7.")
                    else:
                        p.send_message(f"§6Entering §f{plot.get('owner_name')}'s§6 shop. §7Tap a shop chest to buy or sell.")
                elif plot.get("owner"):
                    if plot["owner"] == str(p.xuid):
                        p.send_message("§7Entering §fyour plot§7.")
                    else:
                        p.send_message(f"§7Entering §f{plot.get('owner_name')}'s§7 plot.")
                else:
                    p.send_message(f"§7Entering §f{self.label(plot)}§7: §aavailable to claim")

    # ---------- website ----------
    def update_extra(self, extra, extra_shop=None):
        if isinstance(extra, dict):
            self.extra = {str(k): int(v) for k, v in extra.items()}
        if isinstance(extra_shop, dict):
            self.extra_shop = {str(k): int(v) for k, v in extra_shop.items()}

    # ---------- /plot ----------
    def command(self, player, args):
        what = " ".join(args).strip().lower()
        if what in ("shovel", "claim"):
            if self.has_tool(player, "shovel"):
                player.send_message("§eYou already have a Plot Claiming Shovel.")
            elif not self.room(player, False) and not self.room(player, True):
                player.send_message(f"§cYou have {len(self.owned(player.xuid, False))}/{self.allowance(player)} plots and "
                                    f"{len(self.owned(player.xuid, True))}/{self.allowance(player, True)} shop plots. "
                                    "§7Get more with an extra plot or Galaxy+/Pro+ (galaxymc.us/store).")
            else:
                self.give_tool(player, "shovel")
                player.send_message("§aHere's a Plot Claiming Shovel.")
        elif what in ("manager", "clock"):
            if not self.owned(player.xuid):
                player.send_message("§eYou don't have a plot yet.")
            elif not self.has_tool(player, "manager"):
                self.give_tool(player, "manager")
                player.send_message("§aHere's your Plot Manager.")
        elif what == "list" and player.is_op:
            lines = [f"§f#{p['id']} {self.label(p)} §7{p['kind']} ({p['x1']},{p['z1']})-({p['x2']},{p['z2']}) "
                     f"{p.get('owner_name') or 'unclaimed'}" for p in self.plots.values()]
            player.send_message("\n".join(lines) or "§7No plots yet.")
        else:
            self.open_manager(player)

    def give_axe(self, player):
        self.give_tool(player, "axe")
        player.send_message("§6You got the Plot Axe. §7Left-click the ground for point 1, right-click for point 2. "
                            "Sneak + right-click a plot to edit it.")
