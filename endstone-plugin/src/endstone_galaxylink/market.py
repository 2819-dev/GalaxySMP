"""The Marketplace on galaxymc.us, game side: selling from the website, and buy orders.

Selling from the website (you must be online in game, because the item comes out of your inventory):
- the website asks for your inventory (with what the server Shop pays for each item),
- then either lists the stack you picked on the Auction House, or sells it to the server Shop right away.

Buy orders: "I'll buy 64 diamonds at $90 each". The money for the whole order is taken when it's posted (it works
offline: money is saved by xuid) and held. Anyone with the item fills it, in game (/ah > Buy orders) or on the
website, and is paid straight away. The buyer gets the items in their inventory, or the next time they join.
Cancelling (or 7 days passing) refunds whatever wasn't filled.
"""

import time

from endstone.form import ActionForm, ModalForm, TextInput

from endstone_galaxylink import money

ORDER_DAYS = 7
MAX_ORDERS = 10          # open orders per player
MAX_WANT = 10_000        # items per order


class Market:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT, buyer TEXT, buyer_name TEXT, item_id TEXT, label TEXT,
                want INTEGER, filled INTEGER DEFAULT 0, owed INTEGER DEFAULT 0, each INTEGER, created REAL,
                status TEXT DEFAULT 'open');
            CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
        """)
        self.db.commit()

    def record_sale(self, kind, ref, seller_xuid, seller_name, buyer_xuid, buyer_name, label, amount, price):
        """Tells the website about a sale, so the buyer can rate the seller (Marketplace seller ratings)."""
        if str(seller_xuid) == str(buyer_xuid):
            return
        voice = getattr(self.plugin, "_voice", None)
        if voice is not None and getattr(voice, "ws", None):
            voice.send_json({"type": "market_sale", "kind": kind, "ref": str(ref), "sellerXuid": str(seller_xuid), "sellerName": seller_name,
                             "buyerXuid": str(buyer_xuid), "buyerName": buyer_name, "label": str(label)[:80], "amount": int(amount), "price": int(price)})

    def online(self, xuid):
        return next((p for p in self.plugin.server.online_players if str(p.xuid) == str(xuid)), None)

    @staticmethod
    def plain(stack):
        """Plain items only (no names or enchantments) can fill orders or be sold to the Shop."""
        return stack is not None and stack.amount and not money.is_special(stack)

    def blocked(self, p):
        bw = getattr(self.plugin, "bedwars", None)
        bc = getattr(self.plugin, "buildcontest", None)
        return (bw is not None and bw.playing(p)) or (bc is not None and bc.building(p))

    # ---------- selling from the website ----------
    def inventory(self, xuid):
        p = self.online(xuid)
        if p is None or self.blocked(p):
            return None
        trades = getattr(self.plugin, "trades", None)
        prices = getattr(getattr(self.plugin, "shop", None), "sell_prices", {}) or {}
        inv = p.inventory
        out = []
        for slot in range(min(inv.size, 36)):
            s = inv.get_item(slot)
            if s is None or not s.amount or (trades is not None and not trades.tradable(s)):
                continue
            iid = money.item_id(s)
            out.append({"slot": slot, "id": iid, "label": money.item_label(s), "amount": s.amount,
                        "enchants": money.enchant_lines(s), "shopEach": prices.get(iid) if self.plain(s) else None})
        return out

    def take_slot(self, p, slot, expect_id, expect_amount):
        inv = p.inventory
        slot = int(slot)
        s = inv.get_item(slot) if 0 <= slot < inv.size else None
        if s is None or money.item_id(s) != expect_id or s.amount != int(expect_amount):
            return None
        return s

    def ah_list(self, xuid, slot, expect_id, expect_amount, cents):
        p = self.online(xuid)
        if p is None or self.blocked(p):
            return False, "You need to be online in Minecraft (and not in a game) to sell: the item comes out of your inventory."
        cents = int(cents)
        if cents < 100:
            return False, "The lowest price is $1."
        s = self.take_slot(p, slot, expect_id, expect_amount)
        if s is None or not self.plugin.trades.tradable(s):
            return False, "That item moved in your inventory. Pick it again."
        return self.plugin.auction.list_stack(p, s, cents, lambda: p.inventory.set_item(int(slot), None))

    def shop_sell(self, xuid, slot, expect_id, expect_amount):
        p = self.online(xuid)
        if p is None or self.blocked(p):
            return False, "You need to be online in Minecraft (and not in a game) to sell: the item comes out of your inventory."
        shop = self.plugin.shop
        each = shop.sell_prices.get(expect_id)
        if not each:
            return False, "The server Shop doesn't buy that item."
        s = self.take_slot(p, slot, expect_id, expect_amount)
        if not self.plain(s):
            return False, "That item moved in your inventory (or it's named or enchanted, which the Shop doesn't buy)."
        n = s.amount
        p.inventory.set_item(int(slot), None)
        earned = n * each
        self.eco.credit(p, earned)
        try:
            shop._count_sale(p, earned)
        except Exception:
            pass
        label = money.item_label(s)
        p.send_message(f"§aSold §f{n}x {label}§a to the Shop for §e{money.exact(earned)}§a (on the website).")
        return True, f"Sold {n}x {label} to the Shop for {money.exact(earned)}."

    # ---------- buy orders ----------
    def expire(self):
        rows = self.db.execute("SELECT id FROM orders WHERE status = 'open' AND created < ?", (time.time() - ORDER_DAYS * 86400,)).fetchall()
        for (oid,) in rows:
            self.close(oid, "expired")

    def get(self, oid):
        return self.db.execute("SELECT id, buyer, buyer_name, item_id, label, want, filled, owed, each, created, status FROM orders WHERE id = ?",
                               (int(oid),)).fetchone()

    def open_orders(self):
        self.expire()
        return self.db.execute("SELECT id, buyer, buyer_name, item_id, label, want, filled, owed, each, created, status FROM orders "
                               "WHERE status = 'open' ORDER BY each * 1.0 DESC, id LIMIT 300").fetchall()

    def create(self, xuid, name, item_id, label, want, each):
        """Returns (ok, message)."""
        want, each = int(want), int(each)
        xuid = str(xuid)
        if not (1 <= want <= MAX_WANT) or each < 1:
            return False, f"Ask for 1 to {MAX_WANT:,} items, at least $0.01 each."
        try:
            money.make_stacks(item_id, 1)
        except Exception:
            return False, "That isn't an item on this server. Check the name."
        n = self.db.execute("SELECT count(*) FROM orders WHERE buyer = ? AND status = 'open'", (xuid,)).fetchone()[0]
        if n >= MAX_ORDERS:
            return False, f"You can have up to {MAX_ORDERS} open buy orders."
        total = want * each
        p = self.online(xuid)
        if not (p is not None and p.is_op) and not self.eco.take(xuid, total):
            return False, f"You need {money.exact(total)} for this order (it's held until the order is filled or cancelled)."
        self.db.execute("INSERT INTO orders (buyer, buyer_name, item_id, label, want, each, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (xuid, name, item_id, label or money.pretty_id(item_id), want, each, time.time()))
        self.db.commit()
        self.push()
        return True, f"Buy order posted: {want:,}x {label} at {money.exact(each)} each. {money.exact(total)} is held until it's filled."

    def fill(self, xuid, oid, max_count=None):
        """A seller hands over items from their inventory. Returns (ok, message)."""
        p = self.online(xuid)
        if p is None or self.blocked(p):
            return False, "You need to be online in Minecraft (and not in a game) to fill an order: the items come out of your inventory."
        row = self.get(oid)
        if not row or row[10] != "open":
            return False, "That buy order is closed."
        oid, buyer, buyer_name, item_id, label, want, filled, owed, each, _, _ = row
        if buyer == str(p.xuid):
            return False, "That's your own buy order."
        need = want - filled
        if max_count:
            need = min(need, int(max_count))
        inv = p.inventory
        taken = 0
        for slot in range(inv.size):
            if taken >= need:
                break
            s = inv.get_item(slot)
            if not self.plain(s) or money.item_id(s) != item_id:
                continue
            n = min(s.amount, need - taken)
            if n == s.amount:
                inv.set_item(slot, None)
            else:
                s.amount -= n
                inv.set_item(slot, s)
            taken += n
        if not taken:
            return False, f"You don't have any plain {label} to give (named or enchanted ones don't count)."
        pay = taken * each
        self.eco.add(str(p.xuid), p.name, pay)
        filled += taken
        self.db.execute("UPDATE orders SET filled = ?, owed = owed + ?, status = ? WHERE id = ?",
                        (filled, taken, "done" if filled >= want else "open", oid))
        self.db.commit()
        self.deliver(buyer)
        b = self.online(buyer)
        if b is not None:
            b.send_message(f"§a{p.name} filled §f{taken}x {label}§a of your buy order ({filled:,}/{want:,}).")
        p.send_message(f"§aYou sold §f{taken}x {label}§a to {buyer_name}'s buy order for §e{money.exact(pay)}§a.")
        self.record_sale("order", f"{oid}-{int(time.time())}", p.xuid, p.name, buyer, buyer_name, label, taken, pay)
        self.push()
        return True, f"You sold {taken}x {label} for {money.exact(pay)}."

    def close(self, oid, why="cancelled"):
        row = self.get(oid)
        if not row or row[10] != "open":
            return False
        oid, buyer, buyer_name, _, label, want, filled, _, each, _, _ = row
        refund = (want - filled) * each
        self.db.execute("UPDATE orders SET status = ? WHERE id = ?", (why, oid))
        self.db.commit()
        if refund:
            self.eco.add(buyer, buyer_name, refund)
        b = self.online(buyer)
        if b is not None:
            b.send_message(f"§7Your buy order for §f{label}§7 was {why}. §a{money.exact(refund)}§7 is back in your balance.")
        self.push()
        return True

    def cancel(self, xuid, oid):
        row = self.get(oid)
        if not row or row[1] != str(xuid):
            return False, "That isn't your buy order."
        return (True, "Buy order cancelled. The rest of the money is back in your balance.") if self.close(oid) else (False, "That buy order is already closed.")

    def deliver(self, xuid):
        """Gives a buyer the items their orders got (if they're online)."""
        p = self.online(xuid)
        if p is None:
            return
        rows = self.db.execute("SELECT id, item_id, label, owed FROM orders WHERE buyer = ? AND owed > 0", (str(xuid),)).fetchall()
        for oid, item_id, label, owed in rows:
            try:
                dropped = money.give(p, money.make_stacks(item_id, owed))
            except Exception as e:
                self.plugin.logger.warning(f"Buy order {oid}: couldn't give {item_id}: {e}")
                continue
            self.db.execute("UPDATE orders SET owed = 0 WHERE id = ?", (oid,))
            p.send_message(f"§aYour buy order delivered §f{owed}x {label}§a." + (" §7(Some dropped at your feet: your inventory was full.)" if dropped else ""))
        if rows:
            self.db.commit()

    def on_join(self, player):
        self.deliver(str(player.xuid))

    def payload(self):
        return [{"id": oid, "buyer": bn, "buyerXuid": str(b), "item": iid, "label": label, "want": want, "filled": filled, "each": each,
                 "expires": int(created + ORDER_DAYS * 86400)}
                for oid, b, bn, iid, label, want, filled, owed, each, created, status in self.open_orders()]

    def push(self):
        voice = getattr(self.plugin, "_voice", None)
        if voice is not None and getattr(voice, "ws", None):
            voice.send_json({"type": "buy_orders", "orders": self.payload()})

    # ---------- the website asks ----------
    def from_website(self, msg):
        op = msg.get("op")
        try:
            if op == "inventory":
                items = self.inventory(msg.get("xuid"))
                ans = {"ok": items is not None, "items": items or [],
                       "message": None if items is not None else "You need to be online in Minecraft (and not in a game) to sell from the website."}
            elif op == "ah_list":
                ok, text = self.ah_list(msg["xuid"], msg["slot"], msg["expectId"], msg["expectAmount"], msg["price"])
                ans = {"ok": ok, "message": text}
            elif op == "shop_sell":
                ok, text = self.shop_sell(msg["xuid"], msg["slot"], msg["expectId"], msg["expectAmount"])
                ans = {"ok": ok, "message": text}
            elif op == "order_create":
                ok, text = self.create(msg["xuid"], str(msg.get("name") or "")[:32], str(msg["item"])[:80], str(msg.get("label") or "")[:80], msg["want"], msg["each"])
                ans = {"ok": ok, "message": text}
            elif op == "order_fill":
                ok, text = self.fill(msg["xuid"], msg["id"], msg.get("count"))
                ans = {"ok": ok, "message": text}
            elif op == "order_cancel":
                ok, text = self.cancel(msg["xuid"], msg["id"])
                ans = {"ok": ok, "message": text}
            else:
                ans = {"ok": False, "message": "Unknown Marketplace action."}
        except Exception as e:
            self.plugin.logger.warning(f"Marketplace action from the website failed: {e}")
            ans = {"ok": False, "message": "Something went wrong. Nothing was taken."}
        voice = getattr(self.plugin, "_voice", None)
        if voice:
            voice.send_json({"type": "answer", "req": msg.get("req"), **ans})

    # ---------- /ah > Buy orders in game ----------
    def menu(self, player):
        orders = self.payload()
        mine = [o for o in orders if o["buyerXuid"] == str(player.xuid)]
        form = ActionForm(title="§lBuy orders",
                          content="Players who want to buy items. Tap one to sell yours to it: you're paid right away.\n"
                                  "§7Want something? Post your own order: the money is held until it's filled.")
        form.add_button("§lPost a buy order§r\n§8For the item in your hand", icon="textures/ui/color_plus", on_click=self.create_form)
        for o in mine:
            form.add_button(f"§6Yours: {o['label']} §2{money.fmt(o['each'])} each\n§8{o['filled']:,}/{o['want']:,} filled · tap to cancel",
                            on_click=lambda p, o=o: p.send_message(("§a" if self.cancel(p.xuid, o["id"])[0] else "§c") + "Buy order cancelled."))
        for o in [o for o in orders if o["buyerXuid"] != str(player.xuid)][:40]:
            form.add_button(f"{o['label']} §2{money.fmt(o['each'])} each\n§8{o['buyer']} wants {o['want'] - o['filled']:,} more",
                            on_click=lambda p, o=o: self.fill_confirm(p, o))
        form.add_button("§l< Back", on_click=self.plugin.auction.open)
        player.send_form(form)

    def fill_confirm(self, player, o):
        have = 0
        inv = player.inventory
        for i in range(inv.size):
            s = inv.get_item(i)
            if self.plain(s) and money.item_id(s) == o["item"]:
                have += s.amount
        n = min(have, o["want"] - o["filled"])
        if not n:
            return player.send_message(f"§cYou don't have any plain {o['label']} to sell to this order.")
        form = ActionForm(title="§lSell to buy order",
                          content=f"Sell §f{n}x {o['label']}§r to {o['buyer']} for §e{money.exact(n * o['each'])}§r ({money.fmt(o['each'])} each)?")
        form.add_button(f"§2§lSell {n} for {money.fmt(n * o['each'])}", on_click=lambda p: self.fill(p.xuid, o["id"], n))
        form.add_button("§l< Back", on_click=self.menu)
        player.send_form(form)

    def create_form(self, player):
        stack = player.inventory.item_in_main_hand
        if stack is None or not stack.amount:
            return player.send_message("§cHold one of the item you want to buy, then try again.")
        iid, label = money.item_id(stack), money.pretty_id(money.item_id(stack))

        def submit(p, data):
            import json
            try:
                v = json.loads(data)
                want = int(str(v[0]).replace(",", "").strip())
                each = money.parse(v[1])
            except (ValueError, IndexError, TypeError):
                return p.send_message("§cEnter how many you want and a price, like 64 and 90.")
            if each is None:
                return p.send_message("§cEnter a price like 90, 2.5k or 1m.")
            ok, text = self.create(p.xuid, p.name, iid, label, want, each)
            p.send_message(("§a" if ok else "§c") + text)
        player.send_form(ModalForm(
            title=f"Buy order: {label}",
            controls=[TextInput("How many do you want?", "e.g. 64", "64"),
                      TextInput("Price for each one (like 90, 2.5k or 1m). The full amount is held until the order is filled.", "e.g. 90", "")],
            submit_button="Post buy order", on_submit=submit))
