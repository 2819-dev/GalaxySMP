"""/shop (buy and sell by category) and /sell (menu, hand, all).

Prices come from the website (Staff Tools > Economy) and are saved on the server
too, so the shop keeps working if the website is unreachable. The built-in price
list (shop_default.json) is used until an Admin changes it.
"""

import json
from importlib import resources

from endstone.form import ActionForm, ModalForm, TextInput

from endstone_galaxylink import money

MAX_BUY = 36 * 64  # one full inventory


def default_shop():
    return json.loads(resources.files("endstone_galaxylink").joinpath("shop_default.json").read_text("utf-8"))


class Shop:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.set_shop(self.eco.get_config("shop") or default_shop(), save=False)

    # ---------- prices ----------
    def set_shop(self, shop, save=True):
        cats = []
        for c in (shop or {}).get("categories", []):
            items = []
            for it in c.get("items", []):
                if not it.get("id"):
                    continue
                items.append({
                    "id": it["id"], "name": it.get("name") or money.pretty_id(it["id"]),
                    "buy": money.to_cents(it.get("buy")) if it.get("buy") not in (None, "") else None,
                    "sell": money.to_cents(it.get("sell")) if it.get("sell") not in (None, "") else None,
                    "icon": it.get("icon") or "",
                })
            cats.append({"id": c.get("id"), "name": c.get("name") or "Shop", "icon": c.get("icon") or "", "items": items})
        self.categories = cats
        self.sell_prices = {}
        self.names = {}
        for c in cats:
            for it in c["items"]:
                self.names[it["id"]] = it["name"]
                if it["sell"]:
                    self.sell_prices[it["id"]] = it["sell"]
        if save:
            self.eco.set_config("shop", shop)

    def update_from_website(self, msg):
        if isinstance(msg.get("shop"), dict):
            self.set_shop(msg["shop"])

    # ---------- inventory ----------
    def count(self, player, item):
        inv = player.inventory
        total = 0
        for i in range(inv.size):
            s = inv.get_item(i)
            if s is not None and money.item_id(s) == item and not money.is_special(s):
                total += s.amount
        return total

    def remove(self, player, item, count):
        inv = player.inventory
        removed = 0
        for i in range(inv.size):
            if removed >= count:
                break
            s = inv.get_item(i)
            if s is None or money.item_id(s) != item or money.is_special(s):
                continue
            take = min(s.amount, count - removed)
            if take == s.amount:
                inv.set_item(i, None)
            else:
                s.amount = s.amount - take
                inv.set_item(i, s)
            removed += take
        return removed

    def sellable(self, player):
        """{item id: amount} of everything in the inventory the shop buys."""
        inv = player.inventory
        found = {}
        for i in range(inv.size):
            s = inv.get_item(i)
            if s is None or money.is_special(s):
                continue
            key = money.item_id(s)
            if key in self.sell_prices:
                found[key] = found.get(key, 0) + s.amount
        return found

    # ---------- buying and selling ----------
    def buy(self, player, it, count):
        count = max(1, min(int(count), MAX_BUY))
        if not it["buy"]:
            player.send_message("§cThis item can't be bought.")
            return
        cost = it["buy"] * count
        if not self.eco.charge(player, cost):
            player.send_message(f"§cYou need §e{money.exact(cost)}§c but have §e{self.eco.balance_text(player)}§c.")
            return
        try:
            stacks = money.make_stacks(it["id"], count)
        except Exception:
            if not player.is_op:
                self.eco.credit(player, cost)  # refund
            player.send_message("§cThat item isn't available on this server version.")
            return
        dropped = money.give(player, stacks)
        extra = f" §7({dropped} didn't fit and were dropped at your feet)" if dropped else ""
        player.send_message(f"§aBought §f{count}x {it['name']}§a for §e{money.exact(cost)}§a.{extra}")

    def sell(self, player, item, count=None):
        price = self.sell_prices.get(item)
        if not price:
            player.send_message("§cThe shop doesn't buy that item.")
            return 0
        have = self.count(player, item)
        count = have if count is None else min(count, have)
        if count <= 0:
            player.send_message("§cYou don't have any to sell.")
            return 0
        removed = self.remove(player, item, count)
        earned = removed * price
        self.eco.credit(player, earned)
        self._count_sale(player, earned)
        player.send_message(f"§aSold §f{removed}x {self.names.get(item, money.pretty_id(item))}§a for §e{money.exact(earned)}§a.")
        return earned

    def sell_everything(self, player):
        found = self.sellable(player)
        if not found:
            player.send_message("§cYou have nothing the shop buys. §7Named and enchanted items are never sold.")
            return
        total, items = 0, 0
        for item, n in found.items():
            removed = self.remove(player, item, n)
            total += removed * self.sell_prices[item]
            items += removed
        self.eco.credit(player, total)
        self._count_sale(player, total)
        player.send_message(f"§aSold §f{items} items§a for §e{money.exact(total)}§a.")

    def _count_sale(self, player, cents):
        progress = getattr(self.plugin, "progress", None)
        if progress and cents:
            progress.on_sold(player, cents)

    def sell_hand(self, player):
        s = player.inventory.item_in_main_hand
        if s is None or not s.amount:
            player.send_message("§cHold the item you want to sell.")
            return
        if money.is_special(s):
            player.send_message("§cNamed or enchanted items can't be sold to the shop. Try the Auction House: /ah")
            return
        self.sell(player, money.item_id(s))

    # ---------- menus ----------
    def open(self, player):
        form = ActionForm(title="§lShop", content=f"Balance: §e{self.eco.balance_text(player)}§r\nChoose a category.")
        for c in self.categories:
            form.add_button(f"§l{c['name']}§r\n§8{len(c['items'])} items", icon=c["icon"] or None,
                            on_click=lambda p, c=c: self.open_category(p, c))
        form.add_button("§l§6Sell items§r\n§8Sell what you have", icon="textures/ui/MCoin", on_click=self.open_sell)
        player.send_form(form)

    def open_category(self, player, cat):
        form = ActionForm(title=f"§l{cat['name']}", content=f"Balance: §e{self.eco.balance_text(player)}")
        for it in cat["items"]:
            buy = f"§2Buy {money.fmt(it['buy'])}" if it["buy"] else "§8Can't buy"
            sell = f"§6Sell {money.fmt(it['sell'])}" if it["sell"] else "§8Can't sell"
            form.add_button(f"{it['name']}\n{buy} §8| {sell}", icon=it["icon"] or None,
                            on_click=lambda p, it=it: self.open_item(p, it, cat))
        form.add_button("§l< Back", on_click=self.open)
        player.send_form(form)

    def open_item(self, player, it, cat):
        have = self.count(player, it["id"])
        lines = [f"§l{it['name']}§r", ""]
        lines.append(f"Buy price: §a{money.exact(it['buy'])}§r each" if it["buy"] else "§7This item can't be bought.")
        lines.append(f"Sell price: §6{money.exact(it['sell'])}§r each" if it["sell"] else "§7The shop doesn't buy this item.")
        lines += ["", f"You have: §f{have}", f"Balance: §e{self.eco.balance_text(player)}"]
        form = ActionForm(title=it["name"], content="\n".join(lines))
        try:
            from endstone.inventory import ItemStack
            stack_size = ItemStack(it["id"], 1).max_stack_size
        except Exception:
            stack_size = 64
        again = lambda p: self.open_item(p, it, cat)
        if it["buy"]:
            amounts = [1] if stack_size == 1 else [1, 16, stack_size] if stack_size > 16 else [1, stack_size]
            for n in amounts:
                form.add_button(f"§2Buy {n}§r\n§8{money.fmt(it['buy'] * n)}",
                                on_click=lambda p, n=n: (self.buy(p, it, n), again(p)))
            form.add_button("§2Buy a custom amount", on_click=lambda p: self.custom(p, it, cat, "buy"))
        if it["sell"] and have:
            form.add_button(f"§6Sell 1§r\n§8{money.fmt(it['sell'])}", on_click=lambda p: (self.sell(p, it["id"], 1), again(p)))
            form.add_button(f"§6Sell all ({have})§r\n§8{money.fmt(it['sell'] * have)}",
                            on_click=lambda p: (self.sell(p, it["id"]), again(p)))
        form.add_button("§l< Back", on_click=lambda p: self.open_category(p, cat))
        player.send_form(form)

    def custom(self, player, it, cat, mode):
        def submit(p, data):
            try:
                n = int(float(str(json.loads(data)[0]).replace(",", "")))
            except (ValueError, TypeError, IndexError):
                p.send_message("§cType a number, like 32.")
                return
            if n < 1:
                return
            if mode == "buy":
                self.buy(p, it, n)
            else:
                self.sell(p, it["id"], n)
            self.open_item(p, it, cat)

        player.send_form(ModalForm(
            title=f"Buy {it['name']}",
            controls=[TextInput(f"How many? ({money.exact(it['buy'])} each, up to {MAX_BUY})", "e.g. 32", "64")],
            submit_button="Buy",
            on_submit=submit,
        ))

    def open_sell(self, player):
        found = self.sellable(player)
        if not found:
            form = ActionForm(title="§lSell items", content="You have nothing the shop buys right now.\n\n"
                              "§7Named and enchanted items are never sold here. Sell those on the Auction House (/ah).")
            form.add_button("Open the Shop", on_click=self.open)
            player.send_form(form)
            return
        total = sum(n * self.sell_prices[i] for i, n in found.items())
        form = ActionForm(title="§lSell items", content=f"Balance: §e{self.eco.balance_text(player)}§r\n"
                          "Tap an item to sell all of it.\n§7Shortcuts: /sell hand and /sell all")
        form.add_button(f"§l§6Sell everything§r\n§8{money.fmt(total)}", icon="textures/ui/MCoin",
                        on_click=self.sell_everything)
        icons = {it["id"]: it["icon"] for c in self.categories for it in c["items"]}
        for item, n in sorted(found.items(), key=lambda kv: -kv[1] * self.sell_prices[kv[0]]):
            form.add_button(f"{self.names.get(item, money.pretty_id(item))} x{n}\n§6{money.fmt(n * self.sell_prices[item])}",
                            icon=icons.get(item) or None,
                            on_click=lambda p, item=item: (self.sell(p, item), self.open_sell(p)))
        player.send_form(form)

    def cmd_sell(self, player, args):
        what = " ".join(args).strip().lower()
        if what in ("hand", "h"):
            self.sell_hand(player)
        elif what in ("all", "everything", "inv", "inventory"):
            self.sell_everything(player)
        else:
            self.open_sell(player)
