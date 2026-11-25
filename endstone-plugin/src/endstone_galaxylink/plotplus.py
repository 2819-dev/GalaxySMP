"""Plots, more: selling, renting and upgrading.

Selling and renting (listed in the Marketplace on galaxymc.us, and from the Plot Manager or /plot sell|rent):
- Sell: the buyer pays the price and the plot becomes theirs (members are cleared).
- Rent: the owner sets a price per day and the most days. The renter pays up front, gets building rights
  (as a Builder) until the time runs out, and then the plot is the owner's again, builds and all.
  One renter at a time.

Upgrades (Plot Manager > Upgrade plot, or /plot upgrade): +8 wider, +8 longer (4 blocks on each side) or +16 taller.
The price doubles with each upgrade of the same plot (staff set the starting price with /plot upgradeprice <amount>).
The new land must be free (no other plot or protected area) and plots stay at most 128 x 128. Before a plot grows,
the land it takes is saved, so a reset (unclaiming) puts it back like it was.
"""

import json
import time

from endstone.form import ActionForm, ModalForm, TextInput

from endstone_galaxylink import money
from endstone_galaxylink.plots import MAX_SIZE, TILE, TOP_LIMIT

DEFAULT_UPGRADE = 500_000     # $5,000 for the first upgrade, then doubling
MAX_RENT_DAYS = 30
STEPS = {"wider": ("x", 4), "longer": ("z", 4), "taller": ("y", 16)}


class PlotPlus:
    def __init__(self, plugin):
        self.plugin = plugin
        self.plots = plugin.plots
        self.eco = plugin.economy

    def online(self, xuid):
        return next((p for p in self.plugin.server.online_players if str(p.xuid) == str(xuid)), None)

    def mine(self, player, pid):
        p = self.plots.plots.get(pid)
        return p if p and p.get("owner") == str(player.xuid) and p.get("kind") == "plot" and p.get("status") == "ready" else None

    def here(self, player):
        p = self.plots.at_player(player)
        return p if p and p.get("owner") == str(player.xuid) else None

    # ---------- /plot sell|rent|unlist|upgrade|upgradeprice ----------
    def command(self, player, what, rest):
        if what == "upgradeprice":
            if not player.is_op:
                return player.send_message("§cOnly staff can change the upgrade price.")
            cents = money.parse(rest)
            if cents is None:
                return player.send_message(f"§eUsage: /plot upgradeprice <amount>  §7(now {money.exact(self.base_price())}, doubling each upgrade)")
            self.eco.set_config("plot_upgrade_price", cents)
            return player.send_message(f"§aPlot upgrades now start at §e{money.exact(cents)}§a (doubling each upgrade).")
        plot = self.here(player)
        if plot is None:
            return player.send_message("§cStand in your own plot first (or use the Plot Manager).")
        if what == "upgrade":
            return self.upgrade_menu(player, plot["id"])
        if what == "unlist":
            return self.unlist(player, plot["id"])
        parts = rest.split()
        cents = money.parse(parts[0]) if parts else None
        if cents is None or cents < 100:
            return player.send_message("§eUsage: /plot sell <price>  or  /plot rent <price per day> [most days]")
        if what == "sell":
            return self.list_plot(player, plot["id"], "sell", cents)
        days = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 7
        self.list_plot(player, plot["id"], "rent", cents, days)

    # ---------- selling and renting ----------
    def listing_menu(self, player, pid):
        plot = self.mine(player, pid)
        if not plot:
            return player.send_message("§cOnly a plot you own (and that isn't a protected area) can be sold or rented.")
        l, r = plot.get("listing"), plot.get("rental")
        lines = [f"§l{self.plots.label(plot)}§r"]
        if r:
            lines.append(f"§eRented by {r['name']} for {self.left(r['until'])} more.")
        if l:
            lines.append(f"Listed: §a{'for sale at ' + money.exact(l['price']) if l['type'] == 'sell' else 'for rent at ' + money.exact(l['price']) + '/day (up to ' + str(l['maxDays']) + ' days)'}")
        else:
            lines.append("§7Not listed. List it and players can buy or rent it in the Marketplace on galaxymc.us.")
        form = ActionForm(title="§lSell or rent", content="\n".join(lines))
        form.add_button("§lSell it§r\n§8Set a price", icon="textures/ui/MCoin", on_click=lambda p: self.price_form(p, pid, "sell"))
        form.add_button("§lRent it out§r\n§8Price per day", icon="textures/ui/timer", on_click=lambda p: self.price_form(p, pid, "rent"))
        if l:
            form.add_button("§c§lStop listing§r", icon="textures/ui/cancel", on_click=lambda p: self.unlist(p, pid))
        form.add_button("§l< Back", on_click=lambda p: self.plots.manage(p, pid))
        player.send_form(form)

    def price_form(self, player, pid, kind):
        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            cents = money.parse(v[0])
            if cents is None or cents < 100:
                return p.send_message("§cEnter a price like 5000, 50k or 1m.")
            days = 7
            if kind == "rent":
                try:
                    days = int(str(v[1]).strip() or 7)
                except ValueError:
                    days = 7
            self.list_plot(p, pid, kind, cents, days)
        controls = [TextInput("Price for the whole plot" if kind == "sell" else "Price per day", "e.g. 50k" if kind == "sell" else "e.g. 2k", "")]
        if kind == "rent":
            controls.append(TextInput(f"The most days someone can rent it (1 to {MAX_RENT_DAYS})", "7", "7"))
        player.send_form(ModalForm(title="Sell your plot" if kind == "sell" else "Rent out your plot", controls=controls,
                                   submit_button="List it", on_submit=submit))

    def list_plot(self, player, pid, kind, cents, days=7):
        plot = self.mine(player, pid)
        if not plot:
            return player.send_message("§cOnly a plot you own can be listed.")
        if kind == "sell" and plot.get("rental"):
            return player.send_message("§cWait until the rental ends before selling this plot.")
        plot["listing"] = {"type": kind, "price": int(cents), "maxDays": max(1, min(MAX_RENT_DAYS, int(days))), "at": time.time()}
        self.plots.save(pid)
        self.push()
        if kind == "sell":
            player.send_message(f"§a{self.plots.label(plot)} is for sale at §e{money.exact(cents)}§a in the Marketplace on galaxymc.us.")
        else:
            player.send_message(f"§a{self.plots.label(plot)} is for rent at §e{money.exact(cents)}/day§a (up to {plot['listing']['maxDays']} days) in the Marketplace.")

    def unlist(self, player, pid):
        plot = self.mine(player, pid)
        if plot and plot.get("listing"):
            plot["listing"] = None
            self.plots.save(pid)
            self.push()
            player.send_message("§7Your plot isn't listed any more.")

    def buy(self, xuid, pid, seen=None):
        """Returns (ok, message). The buyer must be online (they need room for another plot).
        seen: the price the buyer saw on the website (refused if the seller changed it since)."""
        p = self.online(xuid)
        if p is None:
            return False, "You need to be online in Minecraft to buy a plot."
        plot = self.plots.plots.get(pid)
        l = plot and plot.get("listing")
        if not plot or not l or l["type"] != "sell" or not plot.get("owner"):
            return False, "That plot isn't for sale any more."
        if plot["owner"] == str(xuid):
            return False, "That's your own plot."
        if not self.plots.room(p, bool(plot.get("shop"))) and not p.is_op:
            return False, f"You've reached your {self.plots.kind_word(plot)} limit. Get more with Galaxy+ or Pro+ (galaxymc.us/store)."
        price = int(l["price"])
        if seen is not None and int(seen) != price:
            return False, "The seller just changed the price. Check the new price and try again."
        if not self.eco.charge(p, price):
            return False, f"You need {money.exact(price)} for this plot."
        old, old_name = plot["owner"], plot.get("owner_name")
        self.eco.add(old, old_name, price)
        sc = getattr(self.plugin, "shopchests", None)
        if plot.get("shop") and sc is not None:
            sc.close_plot(pid, old)
        plot.update({"owner": str(p.xuid), "owner_name": p.name, "members": {}, "listing": None, "rental": None, "public": False, "claimed_at": time.time()})
        self.plots.save(pid)
        self.push()
        if not self.plots.has_tool(p, "manager"):
            self.plots.give_tool(p, "manager")
        p.send_message(f"§a§lYou bought {self.plots.label(plot)}§r§a for §e{money.exact(price)}§a! Manage it with your Plot Manager (clock).")
        seller = self.online(old)
        if seller is not None:
            seller.send_message(f"§a{p.name} bought your plot {self.plots.label(plot)} for §e{money.exact(price)}§a.")
        market = getattr(self.plugin, "market", None)
        if market is not None:
            market.record_sale("plot", f"{pid}-{int(time.time())}", old, old_name, p.xuid, p.name, self.plots.label(plot), 1, price)
        return True, f"You bought {self.plots.label(plot)} for {money.exact(price)}."

    def rent(self, xuid, pid, days, seen=None):
        p = self.online(xuid)
        if p is None:
            return False, "You need to be online in Minecraft to rent a plot."
        plot = self.plots.plots.get(pid)
        l = plot and plot.get("listing")
        if not plot or not l or l["type"] != "rent" or not plot.get("owner"):
            return False, "That plot isn't for rent any more."
        if plot["owner"] == str(xuid):
            return False, "That's your own plot."
        if plot.get("rental"):
            return False, f"Someone is renting it right now. It's free again in {self.left(plot['rental']['until'])}."
        if seen is not None and int(seen) != int(l["price"]):
            return False, "The owner just changed the daily price. Check the new price and try again."
        days = max(1, min(int(days), int(l["maxDays"])))
        cost = days * int(l["price"])
        if not self.eco.charge(p, cost):
            return False, f"You need {money.exact(cost)} to rent it for {days} day{'s' if days != 1 else ''}."
        self.eco.add(plot["owner"], plot.get("owner_name"), cost)
        members = plot.setdefault("members", {})
        before = members.get(p.name.lower())   # if they were already a member, that comes back when the rental ends
        plot["rental"] = {"xuid": str(p.xuid), "name": p.name, "until": time.time() + days * 86400,
                          "before": before if before and not before.get("rental") else None}
        members[p.name.lower()] = {"name": p.name, "role": "builder", "rental": True}
        self.plots.save(pid)
        self.push()
        p.send_message(f"§aYou rented §f{self.plots.label(plot)}§a for {days} day{'s' if days != 1 else ''} (§e{money.exact(cost)}§a). You can build there until it ends.")
        owner = self.online(plot["owner"])
        if owner is not None:
            owner.send_message(f"§a{p.name} rented your plot {self.plots.label(plot)} for {days} days: §e+{money.exact(cost)}§a.")
        market = getattr(self.plugin, "market", None)
        if market is not None:
            market.record_sale("plot", f"r{pid}-{int(time.time())}", plot["owner"], plot.get("owner_name"), p.xuid, p.name, f"{self.plots.label(plot)} ({days}d rent)", days, cost)
        return True, f"You rented {self.plots.label(plot)} for {days} days."

    def tick(self):
        """Every minute: rentals that ran out."""
        now = time.time()
        changed = False
        for pid, plot in list(self.plots.plots.items()):
            r = plot.get("rental")
            if r and r["until"] <= now:
                m = (plot.get("members") or {}).get(r["name"].lower())
                if m and m.get("rental"):
                    plot["members"].pop(r["name"].lower(), None)
                    if r.get("before"):
                        plot["members"][r["name"].lower()] = r["before"]
                plot["rental"] = None
                self.plots.save(pid)
                changed = True
                renter = self.online(r["xuid"])
                if renter is not None:
                    renter.send_message(f"§7Your rental of {self.plots.label(plot)} has ended. Thanks for renting!")
        if changed:
            self.push()

    @staticmethod
    def left(until):
        s = max(0, until - time.time())
        d, h = int(s // 86400), int((s % 86400) // 3600)
        return f"{d}d {h}h" if d else f"{h}h {int((s % 3600) // 60)}m"

    def payload(self):
        out = []
        for pid, p in self.plots.plots.items():
            l = p.get("listing")
            if not l or not p.get("owner") or p.get("status") != "ready":
                continue
            out.append({"id": pid, "label": self.plots.label(p), "owner": p.get("owner_name"), "ownerXuid": p["owner"], "shop": bool(p.get("shop")),
                        "dim": p["dim"], "x": (p["x1"] + p["x2"]) // 2, "z": (p["z1"] + p["z2"]) // 2,
                        "w": p["x2"] - p["x1"] + 1, "l": p["z2"] - p["z1"] + 1, "h": p["top"] - p["y0"],
                        "type": l["type"], "price": l["price"], "maxDays": l.get("maxDays", 1),
                        "rentedUntil": int(p["rental"]["until"]) if p.get("rental") else None})
        return out

    def push(self):
        voice = getattr(self.plugin, "_voice", None)
        if voice is not None and getattr(voice, "ws", None):
            voice.send_json({"type": "plot_listings", "plots": self.payload()})

    def from_website(self, msg):
        try:
            pid = int(msg.get("id"))
            if msg.get("op") == "buy":
                ok, text = self.buy(msg.get("xuid"), pid, msg.get("price"))
            elif msg.get("op") == "rent":
                ok, text = self.rent(msg.get("xuid"), pid, int(msg.get("days") or 1), msg.get("price"))
            else:
                ok, text = False, "Unknown action."
        except Exception as e:
            self.plugin.logger.warning(f"Plot purchase from the website failed: {e}")
            ok, text = False, "Something went wrong. Nothing was taken."
        voice = getattr(self.plugin, "_voice", None)
        if voice:
            voice.send_json({"type": "answer", "req": msg.get("req"), "ok": ok, "message": text})

    # ---------- upgrades ----------
    def base_price(self):
        v = self.eco.get_config("plot_upgrade_price")
        return int(v) if isinstance(v, (int, float)) and v > 0 else DEFAULT_UPGRADE

    def price(self, plot):
        return self.base_price() * (2 ** int(plot.get("upgrades", 0)))

    def grown(self, plot, kind):
        """The plot's bounds after an upgrade, or (None, reason)."""
        axis, n = STEPS[kind]
        b = {k: plot[k] for k in ("x1", "z1", "x2", "z2", "top")}
        if axis == "y":
            b["top"] += n
            if b["top"] > TOP_LIMIT.get(plot["dim"], 319):
                return None, "It's already as tall as the world allows."
            return b, None
        b[axis + "1"] -= n
        b[axis + "2"] += n
        if b[axis + "2"] - b[axis + "1"] + 1 > MAX_SIZE:
            return None, f"Plots can be at most {MAX_SIZE} blocks across."
        for other in self.plots.plots.values():
            if other is plot or other["dim"] != plot["dim"]:
                continue
            if not (b["x2"] < other["x1"] or b["x1"] > other["x2"] or b["z2"] < other["z1"] or b["z1"] > other["z2"]):
                return None, f"There's no room: it would overlap {self.plots.label(other)}."
        return b, None

    def upgrade_menu(self, player, pid):
        plot = self.mine(player, pid)
        if not plot:
            return player.send_message("§cOnly a plot you own can be upgraded (and not while it's being saved or reset).")
        cost = self.price(plot)
        w, l, h = plot["x2"] - plot["x1"] + 1, plot["z2"] - plot["z1"] + 1, plot["top"] - plot["y0"]
        form = ActionForm(title="§lUpgrade plot", content=f"Now: §f{w} x {l}§r, §f{h}§r tall · {plot.get('upgrades', 0)} upgrades\n"
                          f"Each upgrade costs §e{money.exact(cost)}§r (the price doubles after each one).\nBalance: §e{self.eco.balance_text(player)}")
        for kind, label in (("wider", f"Wider: {w} → {w + 8}"), ("longer", f"Longer: {l} → {l + 8}"), ("taller", f"Taller: {h} → {h + 16} blocks")):
            b, why = self.grown(plot, kind)
            form.add_button(f"§l{label}§r\n§8{money.fmt(cost) if b else why[:40]}", on_click=lambda p, k=kind: self.upgrade(p, pid, k))
        form.add_button("§l< Back", on_click=lambda p: self.plots.manage(p, pid))
        player.send_form(form)

    def upgrade(self, player, pid, kind):
        plot = self.mine(player, pid)
        if not plot:
            return
        b, why = self.grown(plot, kind)
        if b is None:
            return player.send_message("§c" + why)
        cost = self.price(plot)
        if not self.eco.charge(player, cost):
            return player.send_message(f"§cYou need {money.exact(cost)} for this upgrade.")
        player.send_message(f"§aUpgrading {self.plots.label(plot)}... §7(about 5 seconds)")
        self.plots.run(self._job_upgrade(pid, kind, b, cost, player.unique_id))

    def _strips(self, plot, kind, b):
        """The new land an upgrade adds, as boxes (x1, y1, z1, x2, y2, z2) of at most 64 x 64 across."""
        bottom = plot["bottom"]
        boxes = []
        if kind == "taller":
            boxes.append((plot["x1"], plot["top"] + 1, plot["z1"], plot["x2"], b["top"], plot["z2"]))
        elif kind == "wider":
            boxes.append((b["x1"], bottom, b["z1"], plot["x1"] - 1, plot["top"], b["z2"]))
            boxes.append((plot["x2"] + 1, bottom, b["z1"], b["x2"], plot["top"], b["z2"]))
        else:
            boxes.append((b["x1"], bottom, b["z1"], b["x2"], plot["top"], plot["z1"] - 1))
            boxes.append((b["x1"], bottom, plot["z2"] + 1, b["x2"], plot["top"], b["z2"]))
        out = []
        for x1, y1, z1, x2, y2, z2 in boxes:
            for x in range(x1, x2 + 1, TILE):
                for z in range(z1, z2 + 1, TILE):
                    out.append((x, y1, z, min(x + TILE - 1, x2), y2, min(z + TILE - 1, z2)))
        return out

    def _job_upgrade(self, pid, kind, b, cost, uid):
        plot = self.plots.plots[pid]
        plot["status"] = "saving"
        # if the server stops before this finishes, the payment is given back at the next start (Plots.recover)
        plot["pending_upgrade"] = {"cost": cost, "owner": plot.get("owner"), "owner_name": plot.get("owner_name")}
        self.plots.save(pid)
        if not plot.get("orig"):   # the original pieces stay named from the original corner
            plot["orig"] = {k: plot[k] for k in ("x1", "z1", "x2", "z2")}
        grown = dict(plot, **b)
        self.plots._keep_loaded(grown, True)
        try:
            yield 60
            again, why = self.grown(plot, kind)   # the space must still be free (a neighbour may have grown meanwhile)
            if again is None or again != b:
                raise RuntimeError(why or "the space isn't free any more")
            n = len(plot.get("extra_tiles") or [])
            extra = list(plot.get("extra_tiles") or [])
            for i, (x1, y1, z1, x2, y2, z2) in enumerate(self._strips(plot, kind, b)):
                name = f"gsmp_plot_{pid}_up{n + i}"
                self.plots.cmd(f"structure save {name} {x1} {y1} {z1} {x2} {y2} {z2} false disk true", plot)
                extra.append({"name": name, "x": x1, "y": y1, "z": z1})
            yield 10
        except Exception as e:
            # it didn't work: the plot stays as it was and the payment comes back
            plot["status"] = "ready"
            plot.pop("pending_upgrade", None)
            self.plots.save(pid)
            self.plots._keep_loaded(grown, False)
            if plot.get("owner"):
                self.eco.add(plot["owner"], plot.get("owner_name"), cost)
            p = self.plugin.server.get_player(uid)
            if p is not None:
                p.send_message(f"§cThe upgrade couldn't be done ({e}). §7Your {money.exact(cost)} was given back.")
            return
        plot.update(b)
        plot["extra_tiles"] = extra
        plot["upgrades"] = int(plot.get("upgrades", 0)) + 1
        plot["status"] = "ready"
        plot.pop("pending_upgrade", None)
        self.plots.save(pid)
        self.plots._keep_loaded(plot, False)
        self.push()
        p = self.plugin.server.get_player(uid)
        if p is not None:
            p.send_message(f"§a{self.plots.label(plot)} is now §f{plot['x2'] - plot['x1'] + 1} x {plot['z2'] - plot['z1'] + 1}§a, "
                           f"§f{plot['top'] - plot['y0']}§a tall. §7(paid {money.exact(cost)})")
