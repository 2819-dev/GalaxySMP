"""Shop chests: players sell to (or buy from) each other in their Shop District plots.

Owner:   hold the item, sneak + tap a chest in your shop plot -> choose Sell or Buy, how many per trade and the price.
         Tap your shop chest to add or take out stock, change the price, or remove it.
Buyers:  tap a shop chest to buy (or sell, for Buy shops). Money goes to the owner even when they're offline.

The stock is kept inside the shop itself (not in the chest), so it can't be stolen. A floating label shows the
item, price and stock above every shop chest. Removing a shop chest, unclaiming or losing the plot gives the
stock back to the owner (the next time they join, if they're offline).
Named and enchanted items can't be sold in shop chests (use the Auction House).
"""

import json
import time

from endstone.event import PlayerInteractEvent
from endstone.form import ActionForm, Dropdown, ModalForm, TextInput, Toggle

from endstone_galaxylink import money

MAX_PRICE = 100_000_000   # $1,000,000 per trade
MAX_STOCK = 100_000


def is_chest(block_type):
    t = str(block_type).split(":")[-1]
    return t in ("chest", "trapped_chest", "barrel")


class ShopChests:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.execute("CREATE TABLE IF NOT EXISTS shop_chests (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT)")
        self.db.commit()
        self.shops = {sid: json.loads(d) for sid, d in self.db.execute("SELECT id, data FROM shop_chests").fetchall()}
        self.returns = self.eco.get_config("shop_returns") or {}   # owner xuid -> [[item, count]]
        self.last_tap = {}

    # ---------- storage ----------
    def save(self, sid):
        self.db.execute("UPDATE shop_chests SET data = ? WHERE id = ?", (json.dumps(self.shops[sid]), sid))
        self.db.commit()
        self.label(sid)

    def at(self, block):
        for sid, s in self.shops.items():
            if (s["dim"], s["x"], s["y"], s["z"]) == (block.dimension.name, block.x, block.y, block.z):
                return sid
        return None

    def item_name(self, s):
        return s.get("name") or money.pretty_id(s["item"])

    def deal(self, s):
        return f"{s['amount']}x {self.item_name(s)} for {money.exact(s['price'])}"

    def label(self, sid):
        ft = getattr(self.plugin, "floating", None)
        s = self.shops.get(sid)
        if not ft or not s:
            return
        verb = "§aSelling" if s["mode"] == "sell" else "§bBuying"
        stock = (f"§8Stock: {s['stock']:,}" if s["stock"] >= s["amount"] else "§cOut of stock") if s["mode"] == "sell" else \
                (f"§8Wants {max(0, s.get('limit', 640) - s['stock']):,} more" if s["stock"] < s.get("limit", 640) else "§cNot buying now")
        ft.set(f"shopchest:{sid}", s["dim"], s["x"] + 0.5, s["y"] + 1.2, s["z"] + 0.5,
               f"§f§l{self.item_name(s)}\n{verb} {s['amount']} for {money.exact(s['price'])}\n{stock}")

    def give_back(self, xuid, item, count, player=None):
        if count <= 0:
            return
        if player is not None:
            money.give(player, money.make_stacks(item, count))
            return
        self.returns.setdefault(str(xuid), []).append([item, count])
        self.eco.set_config("shop_returns", self.returns)

    def on_join(self, player):
        items = self.returns.pop(str(player.xuid), None)
        if items:
            self.eco.set_config("shop_returns", self.returns)
            for item, count in items:
                money.give(player, money.make_stacks(item, count))
            player.send_message("§6Items from your closed shop chests were given back to you.")

    def remove_shop(self, sid, player=None):
        s = self.shops.pop(sid, None)
        if not s:
            return
        self.db.execute("DELETE FROM shop_chests WHERE id = ?", (sid,))
        self.db.commit()
        ft = getattr(self.plugin, "floating", None)
        if ft:
            ft.remove(f"shopchest:{sid}")
        owner_here = player if player is not None and str(player.xuid) == s["owner"] else None
        if owner_here is None:
            owner_here = next((p for p in self.plugin.server.online_players if str(p.xuid) == s["owner"]), None)
        self.give_back(s["owner"], s["item"], s["stock"], owner_here)

    def close_plot(self, pid, owner):
        """The shop plot was unclaimed or deleted: close its shop chests and give the stock back."""
        for sid in [sid for sid, s in self.shops.items() if s["plot"] == pid]:
            self.remove_shop(sid)

    # ---------- events ----------
    def on_interact(self, event):
        """Returns True when a shop chest handled the tap."""
        if event.action != PlayerInteractEvent.Action.RIGHT_CLICK_BLOCK or not getattr(event, "has_block", False):
            return False
        block = event.block
        if not is_chest(block.type):
            return False
        p = event.player
        sid = self.at(block)
        if sid is not None:
            event.cancel()
            if not self._debounce(p):
                return True
            if self.shops[sid]["owner"] == str(p.xuid):
                self.manage(p, sid)
            else:
                self.trade(p, sid)
            return True
        if not p.is_sneaking:
            return False
        plots = self.plugin.plots
        plot = plots.at_block(block)
        if not plot or not plot.get("shop") or plot.get("owner") != str(p.xuid):
            return False
        event.cancel()
        if self._debounce(p):
            self.setup(p, block, plot)
        return True

    def _debounce(self, p):
        now = time.time()
        if now - self.last_tap.get(str(p.unique_id), 0) < 0.7:
            return False
        self.last_tap[str(p.unique_id)] = now
        return True

    def on_break(self, event):
        sid = self.at(event.block)
        if sid is None:
            return
        p = event.player
        s = self.shops[sid]
        if s["owner"] != str(p.xuid) and not p.is_op:
            event.cancel()
            return
        self.remove_shop(sid, p)
        p.send_message("§7Shop chest removed. The stock went back to its owner.")

    # ---------- owner: setting up ----------
    def setup(self, player, block, plot):
        hand = player.inventory.item_in_main_hand
        if hand is None or not hand.amount:
            return player.send_message("§eHold the item you want to sell or buy, then sneak + tap the chest.")
        if money.is_special(hand):
            return player.send_message("§cNamed or enchanted items can't go in shop chests. Use the Auction House: /ah")
        item = money.item_id(hand)
        name = money.item_label(hand)
        have = self.plugin.shop.count(player, item)

        def submit(p, data):
            try:
                v = json.loads(data)
                amount = max(1, min(64, int(float(v[1]))))
                price = money.parse(str(v[2]))
            except (ValueError, IndexError, TypeError):
                return p.send_message("§cThat price isn't valid. Try something like 15 or 2.50")
            if price is None or price <= 0 or price > MAX_PRICE:
                return p.send_message("§cThe price must be more than $0.")
            if self.at(block) is not None:
                return
            s = {"plot": plot["id"], "dim": block.dimension.name, "x": block.x, "y": block.y, "z": block.z,
                 "owner": str(p.xuid), "owner_name": p.name, "item": item, "name": name,
                 "mode": "sell" if int(v[0]) == 0 else "buy", "amount": amount, "price": price, "stock": 0, "limit": 640}
            if s["mode"] == "sell" and v[3]:
                s["stock"] = self.plugin.shop.remove(p, item, have)
            cur = self.db.execute("INSERT INTO shop_chests (data) VALUES (?)", (json.dumps(s),))
            self.db.commit()
            sid = cur.lastrowid
            self.shops[sid] = s
            self.label(sid)
            p.send_message(f"§aShop chest ready: {'selling' if s['mode'] == 'sell' else 'buying'} {self.deal(s)}."
                           + (f" §7Stock: {s['stock']}." if s["mode"] == "sell" else " §7Make sure you have money to pay sellers."))

        player.send_form(ModalForm(title="§lNew shop chest", controls=[
            Dropdown(f"What should this chest do with {name}?", ["Sell it to players", "Buy it from players"], 0),
            TextInput("Items per trade (1-64)", "1", "1"),
            TextInput("Price per trade ($)", "e.g. 15", ""),
            Toggle(f"Sell shops: put all {have} {name} from my inventory in stock", True),
        ], submit_button="Create", on_submit=submit))

    def manage(self, player, sid):
        s = self.shops.get(sid)
        if not s:
            return
        verb = "Selling" if s["mode"] == "sell" else "Buying"
        form = ActionForm(title="§lYour shop chest", content=f"{verb} §l{self.deal(s)}§r\nStock: {s['stock']:,} {self.item_name(s)}"
                          + (f"\n§7Buying until stock reaches {s.get('limit', 640):,}." if s["mode"] == "buy" else ""))
        have = self.plugin.shop.count(player, s["item"])
        form.add_button(f"§lAdd stock§r\n§8You have {have:,} {self.item_name(s)}", icon="textures/ui/color_plus",
                        on_click=lambda p: self.add_stock(p, sid))
        form.add_button(f"§lTake out stock§r\n§8{s['stock']:,} in the shop", icon="textures/ui/arrow_dark_left_stretch",
                        on_click=lambda p: self.take_stock(p, sid))
        form.add_button("§lChange price or amount", icon="textures/ui/settings_glyph_color_2x", on_click=lambda p: self.edit(p, sid))
        form.add_button("§c§lRemove shop chest§r\n§8Stock goes back to you", icon="textures/ui/trash",
                        on_click=lambda p: (self.remove_shop(sid, p), p.send_message("§7Shop chest removed. You got the stock back.")))
        form.add_button("Close")
        player.send_form(form)

    def add_stock(self, player, sid):
        s = self.shops.get(sid)
        if not s:
            return
        room = MAX_STOCK - s["stock"]
        n = self.plugin.shop.remove(player, s["item"], min(room, self.plugin.shop.count(player, s["item"])))
        if not n:
            return player.send_message(f"§eYou don't have any {self.item_name(s)} to add.")
        s["stock"] += n
        self.save(sid)
        player.send_message(f"§aAdded {n:,} {self.item_name(s)}. §7Stock: {s['stock']:,}.")

    def take_stock(self, player, sid):
        s = self.shops.get(sid)
        if not s or not s["stock"]:
            return player.send_message("§7The shop is empty.")
        n = min(s["stock"], 36 * 64)
        s["stock"] -= n
        self.save(sid)
        dropped = money.give(player, money.make_stacks(s["item"], n))
        player.send_message(f"§aTook out {n:,} {self.item_name(s)}." + (" §7Some didn't fit and dropped at your feet." if dropped else ""))

    def edit(self, player, sid):
        s = self.shops.get(sid)
        if not s:
            return

        def submit(p, data):
            try:
                v = json.loads(data)
                amount = max(1, min(64, int(float(v[1]))))
                price = money.parse(str(v[2]))
                limit = max(1, min(MAX_STOCK, int(float(v[3]))))
            except (ValueError, IndexError, TypeError):
                return p.send_message("§cThose values aren't valid.")
            if price is None or price <= 0 or price > MAX_PRICE:
                return p.send_message("§cThe price must be more than $0.")
            s.update({"mode": "sell" if int(v[0]) == 0 else "buy", "amount": amount, "price": price, "limit": limit})
            self.save(sid)
            p.send_message(f"§aSaved: {'selling' if s['mode'] == 'sell' else 'buying'} {self.deal(s)}.")
        player.send_form(ModalForm(title="Change shop chest", controls=[
            Dropdown("Mode", ["Sell to players", "Buy from players"], 0 if s["mode"] == "sell" else 1),
            TextInput("Items per trade (1-64)", "1", str(s["amount"])),
            TextInput("Price per trade ($)", "e.g. 15", f"{s['price'] / 100:g}"),
            TextInput("Buy shops: stop buying when stock reaches", "640", str(s.get("limit", 640))),
        ], submit_button="Save", on_submit=submit))

    # ---------- shoppers ----------
    def trade(self, player, sid):
        s = self.shops.get(sid)
        if not s:
            return
        plot = self.plugin.plots.plots.get(s["plot"])
        shop_name = self.plugin.plots.label(plot) if plot else "Shop"
        if s["mode"] == "sell":
            can = s["stock"] // s["amount"]
            body = (f"§l{shop_name}§r by {s['owner_name']}\n\nSelling §l{self.deal(s)}§r\n"
                    f"In stock: {s['stock']:,} ({can:,} trade{'s' if can != 1 else ''})\nYour balance: {self.eco.balance_text(player)}")
            form = ActionForm(title=f"§l{self.item_name(s)}", content=body)
            for times in (1, 4, 16):
                if can >= times:
                    form.add_button(f"§2§lBuy {times * s['amount']}x§r\n§8{money.exact(times * s['price'])}",
                                    on_click=lambda p, t=times: self.buy(p, sid, t))
            if can:
                form.add_button("§lBuy a different amount", on_click=lambda p: self.amount_form(p, sid))
            else:
                form.add_button("§cOut of stock")
        else:
            have = self.plugin.shop.count(player, s["item"])
            body = (f"§l{shop_name}§r by {s['owner_name']}\n\nBuying §l{self.deal(s)}§r\n"
                    f"You have {have:,} {self.item_name(s)}.")
            form = ActionForm(title=f"§l{self.item_name(s)}", content=body)
            for times in (1, 4, 16):
                if have >= times * s["amount"]:
                    form.add_button(f"§6§lSell {times * s['amount']}x§r\n§8Get {money.exact(times * s['price'])}",
                                    on_click=lambda p, t=times: self.sell(p, sid, t))
            if have >= s["amount"]:
                form.add_button("§lSell a different amount", on_click=lambda p: self.amount_form(p, sid))
        form.add_button("Close")
        player.send_form(form)

    def amount_form(self, player, sid):
        s = self.shops.get(sid)
        if not s:
            return

        def submit(p, data):
            try:
                times = max(1, int(float(json.loads(data)[0])))
            except (ValueError, IndexError, TypeError):
                return
            (self.buy if s["mode"] == "sell" else self.sell)(p, sid, times)
        player.send_form(ModalForm(title="How many trades?", controls=[
            TextInput(f"Number of trades ({s['amount']} items for {money.exact(s['price'])} each)", "1", "1")],
            submit_button="OK", on_submit=submit))

    def buy(self, player, sid, times):
        s = self.shops.get(sid)
        if not s:
            return
        times = min(times, s["stock"] // s["amount"])
        if times <= 0:
            return player.send_message("§cThis shop is out of stock.")
        cost = times * s["price"]
        if not self.eco.charge(player, cost):
            return player.send_message(f"§cYou need {money.exact(cost)} for that.")
        n = times * s["amount"]
        s["stock"] -= n
        self.save(sid)
        self.eco.add(s["owner"], s["owner_name"], cost)
        self.plugin.progress.add(player, "shop_buys")
        self.plugin.progress.bump(s["owner"], "shop_earned", cost, name=s["owner_name"])
        dropped = money.give(player, money.make_stacks(s["item"], n))
        player.send_message(f"§aBought {n}x {self.item_name(s)} for {money.exact(cost)}." + (" §7Some dropped at your feet." if dropped else ""))
        self.tell_owner(s, f"§a{player.name} bought {n}x {self.item_name(s)} from your shop for {money.exact(cost)}.")

    def sell(self, player, sid, times):
        s = self.shops.get(sid)
        if not s:
            return
        room = max(0, s.get("limit", 640) - s["stock"]) // s["amount"]
        times = min(times, self.plugin.shop.count(player, s["item"]) // s["amount"], room)
        if times <= 0:
            return player.send_message("§cThis shop isn't buying right now, or you don't have enough.")
        cost = times * s["price"]
        if not self.eco.take(s["owner"], cost):
            return player.send_message("§cThe shop owner doesn't have enough money to buy that right now.")
        n = self.plugin.shop.remove(player, s["item"], times * s["amount"])
        s["stock"] += n
        self.save(sid)
        self.eco.credit(player, cost)
        player.send_message(f"§aSold {n}x {self.item_name(s)} for {money.exact(cost)}.")
        self.tell_owner(s, f"§a{player.name} sold you {n}x {self.item_name(s)} for {money.exact(cost)}. §7Take it out at your shop chest.")

    def tell_owner(self, s, text):
        for p in self.plugin.server.online_players:
            if str(p.xuid) == s["owner"]:
                p.send_message(text)
