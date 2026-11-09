"""Auction House (/ah): players sell items to each other.

- /ah sell <price> lists the item in your hand (enchantments and names are kept).
- Listings last 48 hours. A 5% fee is taken from the sale price (it keeps prices
  from inflating). Unsold or cancelled items wait in "My listings" to be collected.
"""

import json
import time

from endstone.form import ActionForm, ModalForm, TextInput

from endstone_galaxylink import money

DURATION = 48 * 3600
FEE_PERCENT = 5
PAGE = 20


def left(seconds):
    seconds = max(0, int(seconds))
    h, m = seconds // 3600, (seconds % 3600) // 60
    return f"{h}h {m}m" if h else f"{m}m"


class AuctionHouse:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db

    # ---------- data ----------
    def expire(self):
        self.db.execute("UPDATE ah SET status = 'expired' WHERE status = 'active' AND expires < ?", (time.time(),))
        self.db.commit()

    def active(self, search="", page=0):
        self.expire()
        q = f"%{search.lower()}%"
        return self.db.execute(
            "SELECT id, seller, seller_name, label, item_id, amount, price, expires FROM ah "
            "WHERE status = 'active' AND (lower(label) LIKE ? OR lower(item_id) LIKE ?) "
            "ORDER BY created DESC LIMIT ? OFFSET ?", (q, q, PAGE + 1, page * PAGE)).fetchall()

    def mine(self, xuid):
        self.expire()
        return self.db.execute(
            "SELECT id, label, amount, price, expires, status FROM ah WHERE seller = ? AND status IN ('active','expired','cancelled') "
            "ORDER BY created DESC LIMIT 60", (str(xuid),)).fetchall()

    def get(self, lid):
        return self.db.execute("SELECT id, seller, seller_name, item, label, item_id, amount, price, expires, status FROM ah WHERE id = ?",
                               (lid,)).fetchone()

    # ---------- actions ----------
    def list_hand(self, player, price_text):
        cents = money.parse(price_text)
        if cents is None or cents < 100:
            player.send_message("§eUsage: /ah sell <price>  §7(for example /ah sell 5k). The lowest price is $1.")
            return
        stack = player.inventory.item_in_main_hand
        if stack is None or not stack.amount:
            player.send_message("§cHold the item you want to sell, then try again.")
            return
        self.expire()
        count = self.db.execute("SELECT count(*) FROM ah WHERE seller = ? AND status = 'active'", (str(player.xuid),)).fetchone()[0]
        plans = getattr(self.plugin, "plans", None)
        limit = plans.plan_for(player)["ahSlots"] if plans else 10
        if count >= limit and not player.is_op:
            player.send_message(f"§cYou can have up to {limit} items listed at once."
                                + ("" if limit >= 30 else " §7More slots come with Galaxy+ and Pro+ (galaxymc.us/store)."))
            return
        snap = money.snapshot(stack)
        label = money.item_label(stack)
        player.inventory.item_in_main_hand = None
        now = time.time()
        self.db.execute(
            "INSERT INTO ah (seller, seller_name, item, label, item_id, amount, price, created, expires, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')",
            (str(player.xuid), player.name, json.dumps(snap), label, snap["id"], stack.amount, cents, now, now + DURATION))
        self.db.commit()
        player.send_message(f"§aListed §f{stack.amount}x {label}§a for §e{money.exact(cents)}§a on the Auction House "
                            f"for 48 hours. §7({FEE_PERCENT}% fee when it sells)")

    def buy(self, player, lid):
        row = self.get(lid)
        if not row or row[9] != "active" or row[8] < time.time():
            player.send_message("§cSorry, that item is no longer for sale.")
            return
        _, seller, seller_name, item, label, item_id, amount, price, _, _ = row
        if seller == str(player.xuid):
            player.send_message("§cThat's your own listing. Cancel it in My listings instead.")
            return
        if not self.eco.charge(player, price):
            player.send_message(f"§cYou need §e{money.exact(price)}§c but have §e{self.eco.balance_text(player)}§c.")
            return
        self.db.execute("UPDATE ah SET status = 'sold', buyer = ? WHERE id = ? AND status = 'active'", (str(player.xuid), lid))
        self.db.commit()
        payout = price - price * FEE_PERCENT // 100
        self.eco.add(seller, seller_name, payout)
        money.give(player, money.rebuild(json.loads(item)))
        player.send_message(f"§aYou bought §f{amount}x {label}§a for §e{money.exact(price)}§a.")
        seller_p = next((p for p in self.plugin.server.online_players if str(p.xuid) == seller), None)
        if seller_p:
            seller_p.send_message(f"§a{player.name} bought your §f{amount}x {label}§a. You got §e{money.exact(payout)}§a.")

    def cancel(self, player, lid):
        self.db.execute("UPDATE ah SET status = 'cancelled' WHERE id = ? AND seller = ? AND status = 'active'", (lid, str(player.xuid)))
        self.db.commit()
        self.collect(player, lid)

    def collect(self, player, lid):
        row = self.get(lid)
        if not row or row[1] != str(player.xuid) or row[9] not in ("expired", "cancelled"):
            return
        self.db.execute("UPDATE ah SET status = 'collected' WHERE id = ?", (lid,))
        self.db.commit()
        money.give(player, money.rebuild(json.loads(row[3])))
        player.send_message(f"§aYou got back §f{row[6]}x {row[4]}§a.")

    # ---------- menus ----------
    def open(self, player, search="", page=0):
        rows = self.active(search, page)
        more = len(rows) > PAGE
        rows = rows[:PAGE]
        head = f"Balance: §e{self.eco.balance_text(player)}§r\n"
        head += f"Results for \"{search}\"" if search else "Newest items first. Sell yours with §e/ah sell <price>§r."
        if not rows:
            head += "\n\n§7Nothing for sale" + (" matches that." if search else " yet.")
        form = ActionForm(title="§lAuction House", content=head)
        form.add_button("§lSearch§r\n§8Find an item", icon="textures/ui/magnifyingGlass", on_click=self.search)
        form.add_button("§lMy listings§r\n§8Cancel or collect items", icon="textures/ui/inventory_icon", on_click=self.open_mine)
        form.add_button("§lSell item in hand§r\n§8Set a price", icon="textures/ui/MCoin", on_click=self.sell_form)
        for lid, seller, seller_name, label, item_id, amount, price, expires in rows:
            form.add_button(f"{amount}x {label} §2{money.fmt(price)}\n§8{seller_name} · {left(expires - time.time())} left",
                            on_click=lambda p, lid=lid: self.open_listing(p, lid, search, page))
        if more:
            form.add_button("§lNext page >", on_click=lambda p: self.open(p, search, page + 1))
        if page:
            form.add_button("§l< Previous page", on_click=lambda p: self.open(p, search, page - 1))
        player.send_form(form)

    def open_listing(self, player, lid, search="", page=0):
        row = self.get(lid)
        if not row or row[9] != "active":
            player.send_message("§cThat item is no longer for sale.")
            return
        _, seller, seller_name, item, label, item_id, amount, price, expires, _ = row
        snap = json.loads(item)
        lines = [f"§l{amount}x {label}§r", f"§8{item_id}"]
        ench = (snap.get("meta") or {}).get("enchants") or {}
        if ench:
            lines.append("§bEnchantments: " + ", ".join(f"{money.pretty_id(k)} {v}" for k, v in ench.items()))
        lore = (snap.get("meta") or {}).get("lore")
        if lore:
            lines.append("§5" + " / ".join(lore))
        lines += ["", f"Price: §e{money.exact(price)}", f"Seller: §f{seller_name}", f"Time left: §f{left(expires - time.time())}",
                  "", f"Your balance: §e{self.eco.balance_text(player)}"]
        form = ActionForm(title="Auction House", content="\n".join(lines))
        if seller == str(player.xuid):
            form.add_button("§cCancel listing", on_click=lambda p: (self.cancel(p, lid), self.open_mine(p)))
        else:
            form.add_button(f"§2§lBuy for {money.fmt(price)}", on_click=lambda p: self.buy(p, lid))
        form.add_button("§l< Back", on_click=lambda p: self.open(p, search, page))
        player.send_form(form)

    def open_mine(self, player):
        rows = self.mine(player.xuid)
        form = ActionForm(title="§lMy listings",
                          content="Items for sale and items to collect.\n§7Unsold items come back here after 48 hours." if rows
                          else "You have no listings.\n§7Hold an item and use /ah sell <price>.")
        for lid, label, amount, price, expires, status in rows:
            if status == "active":
                form.add_button(f"{amount}x {label} §2{money.fmt(price)}\n§8Selling · {left(expires - time.time())} left · tap to cancel",
                                on_click=lambda p, lid=lid: (self.cancel(p, lid), self.open_mine(p)))
            else:
                form.add_button(f"§6{amount}x {label}\n§8{'Expired' if status == 'expired' else 'Cancelled'} · tap to collect",
                                on_click=lambda p, lid=lid: (self.collect(p, lid), self.open_mine(p)))
        form.add_button("§l< Back", on_click=self.open)
        player.send_form(form)

    def search(self, player):
        def submit(p, data):
            try:
                text = str(json.loads(data)[0]).strip()[:32]
            except (ValueError, IndexError):
                return
            self.open(p, text)
        player.send_form(ModalForm(title="Search the Auction House",
                                   controls=[TextInput("Item name", "e.g. diamond sword", "")],
                                   submit_button="Search", on_submit=submit))

    def sell_form(self, player):
        stack = player.inventory.item_in_main_hand
        if stack is None or not stack.amount:
            player.send_message("§cHold the item you want to sell, then open /ah again.")
            return

        def submit(p, data):
            try:
                self.list_hand(p, json.loads(data)[0])
            except (ValueError, IndexError):
                pass
        player.send_form(ModalForm(
            title="Sell on the Auction House",
            controls=[TextInput(f"Price for {stack.amount}x {money.item_label(stack)} (like 500, 2.5k or 1m). "
                                f"{FEE_PERCENT}% fee when it sells.", "e.g. 2.5k", "")],
            submit_button="List it", on_submit=submit))

    def command(self, player, args):
        parts = " ".join(args).split()
        if parts and parts[0].lower() in ("sell", "list"):
            if len(parts) < 2:
                self.sell_form(player)
            else:
                self.list_hand(player, parts[1])
        elif parts and parts[0].lower() in ("mine", "my", "listings", "collect"):
            self.open_mine(player)
        elif parts and parts[0].lower() == "search":
            self.open(player, " ".join(parts[1:]))
        else:
            self.open(player)
