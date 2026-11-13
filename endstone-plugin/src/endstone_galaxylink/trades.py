"""Player trades, started on galaxymc.us.

A seller picks an item from their inventory on the website (they must be online in game), a buyer and a
price. The item is taken out of the seller's inventory and held, so it can't be traded twice:
  - the buyer accepts (website or /trade in game): the buyer pays, the seller is paid, the buyer gets the item;
  - the buyer declines, the seller cancels, or 24 hours pass: the item goes back to the seller.
Anyone offline gets their item the next time they join. Every change is reported to the website.
"""

import json
import time

from endstone.form import ActionForm

from endstone_galaxylink import money


class Trades:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY, seller TEXT, seller_name TEXT, buyer TEXT, buyer_name TEXT,
                item TEXT, label TEXT, amount INTEGER, price INTEGER,
                status TEXT,           -- held, give (buyer gets it on join), back (seller gets it on join), done
                result TEXT,           -- accepted, declined, cancelled, expired
                created REAL
            );
        """)
        self.db.commit()

    # ---------- helpers ----------
    def online(self, xuid):
        return next((p for p in self.plugin.server.online_players if str(p.xuid) == str(xuid)), None)

    def row(self, tid):
        r = self.db.execute("SELECT id, seller, seller_name, buyer, buyer_name, item, label, amount, price, status, result FROM trades WHERE id = ?",
                            (int(tid),)).fetchone()
        if not r:
            return None
        keys = ("id", "seller", "seller_name", "buyer", "buyer_name", "item", "label", "amount", "price", "status", "result")
        return dict(zip(keys, r))

    def report(self, tid, result, by):
        voice = getattr(self.plugin, "_voice", None)
        if voice:
            voice.send_json({"type": "trade_update", "id": int(tid), "result": result, "by": by})

    def tradable(self, stack):
        if stack is None or not stack.amount:
            return False
        plots = getattr(self.plugin, "plots", None)
        if plots is not None and plots.tool_kind(stack):
            return False  # plot tools can't be traded
        return True

    # ---------- asked by the website ----------
    def inventory(self, xuid):
        """The seller's inventory, so they can pick what to offer."""
        p = self.online(xuid)
        if p is None:
            return None
        bw = getattr(self.plugin, "bedwars", None)
        if bw is not None and bw.playing(p):
            return None
        bc = getattr(self.plugin, "buildcontest", None)
        if bc is not None and bc.building(p):
            return None  # Creative items from the Build Contest can't be traded
        inv = p.inventory
        out = []
        for slot in range(min(inv.size, 36)):
            s = inv.get_item(slot)
            if not self.tradable(s):
                continue
            out.append({"slot": slot, "id": money.item_id(s), "label": money.item_label(s), "amount": s.amount,
                        "enchants": money.enchant_lines(s)})
        return out

    def create(self, tid, seller_xuid, slot, expect_id, expect_amount, buyer_xuid, buyer_name, price):
        p = self.online(seller_xuid)
        if p is None:
            return False, "You need to be online in Minecraft to offer an item: it's taken from your inventory."
        if self.row(tid):
            return False, "That trade already exists."
        bc = getattr(self.plugin, "buildcontest", None)
        if bc is not None and bc.building(p):
            return False, "You can't offer items while you're in a Build Contest."
        inv = p.inventory
        stack = inv.get_item(int(slot)) if 0 <= int(slot) < inv.size else None
        if not self.tradable(stack) or money.item_id(stack) != expect_id or stack.amount != int(expect_amount):
            return False, "That item moved in your inventory. Pick it again."
        snap = money.snapshot(stack)
        label = money.item_label(stack)
        inv.set_item(int(slot), None)
        self.db.execute("INSERT INTO trades (id, seller, seller_name, buyer, buyer_name, item, label, amount, price, status, created) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', ?)",
                        (int(tid), str(seller_xuid), p.name, str(buyer_xuid), buyer_name, json.dumps(snap), label, snap["amount"], int(price), time.time()))
        self.db.commit()
        p.send_message(f"§aYou offered §f{snap['amount']}x {label}§a to §f{buyer_name}§a for §e{money.exact(int(price))}§a. "
                       "§7The item is held until they answer (24 hours), then comes back to you.")
        b = self.online(buyer_xuid)
        if b is not None:
            b.send_message(f"§d{p.name} offers you §f{snap['amount']}x {label}§d for §e{money.exact(int(price))}§d. "
                           "§7Type §e/trade§7 to accept or decline (or use galaxymc.us/trades).")
        return True, label

    def accept(self, tid, by_xuid, via="website"):
        t = self.row(tid)
        if not t or t["status"] != "held":
            return False, "This trade is no longer open."
        if str(by_xuid) != t["buyer"]:
            return False, "This trade isn't for you."
        buyer = self.online(t["buyer"])
        if buyer is not None and buyer.is_op:
            paid = True
        else:
            paid = self.eco.take(t["buyer"], t["price"])
        if not paid:
            return False, f"You need {money.exact(t['price'])} to accept this trade."
        self.eco.add(t["seller"], t["seller_name"], t["price"])
        self.db.execute("UPDATE trades SET status = ?, result = 'accepted' WHERE id = ?", ("done" if buyer else "give", t["id"]))
        self.db.commit()
        if buyer is not None:
            dropped = money.give(buyer, money.rebuild(json.loads(t["item"])))
            buyer.send_message(f"§aTrade done: you got §f{t['amount']}x {t['label']}§a for §e{money.exact(t['price'])}§a."
                               + (" §7(Your inventory was full, so it dropped at your feet.)" if dropped else ""))
        seller = self.online(t["seller"])
        if seller is not None:
            seller.send_message(f"§a{t['buyer_name']} accepted your trade: you got §e{money.exact(t['price'])}§a for §f{t['amount']}x {t['label']}§a.")
        if via == "game":
            self.report(t["id"], "accepted", "game")
        return True, f"You bought {t['amount']}x {t['label']} for {money.exact(t['price'])}." + ("" if buyer else " It's waiting for you the next time you join.")

    def give_back(self, tid, result, via="website"):
        """Declined, cancelled or expired: the item goes back to the seller."""
        t = self.row(tid)
        if not t or t["status"] != "held":
            return False, "This trade is no longer open."
        seller = self.online(t["seller"])
        self.db.execute("UPDATE trades SET status = ?, result = ? WHERE id = ?", ("done" if seller else "back", result, t["id"]))
        self.db.commit()
        if seller is not None:
            money.give(seller, money.rebuild(json.loads(t["item"])))
            why = {"declined": f"{t['buyer_name']} declined your trade", "expired": "Nobody answered your trade in 24 hours",
                   "cancelled": "Trade cancelled"}.get(result, "Trade closed")
            seller.send_message(f"§e{why}: §f{t['amount']}x {t['label']}§e is back in your inventory.")
        if via == "game":
            self.report(t["id"], result, "game")
        return True, "Done."

    def on_join(self, player):
        """Items waiting for this player (bought or returned while they were offline)."""
        xuid = str(player.xuid)
        rows = self.db.execute("SELECT id, item, label, amount, status FROM trades WHERE (status = 'give' AND buyer = ?) OR (status = 'back' AND seller = ?)",
                               (xuid, xuid)).fetchall()
        for tid, item, label, amount, status in rows:
            money.give(player, money.rebuild(json.loads(item)))
            self.db.execute("UPDATE trades SET status = 'done' WHERE id = ?", (tid,))
            player.send_message(f"§a{'Your trade arrived' if status == 'give' else 'A trade item came back'}: §f{amount}x {label}§a.")
        if rows:
            self.db.commit()
        n = self.db.execute("SELECT count(*) FROM trades WHERE status = 'held' AND buyer = ?", (xuid,)).fetchone()[0]
        if n:
            player.send_message(f"§dYou have {n} trade offer{'s' if n != 1 else ''} waiting. §7Type §e/trade§7 to see {'them' if n != 1 else 'it'}.")

    def from_website(self, msg):
        """{type: trade, op: inventory|create|accept|decline|cancel|expire, ...} -> answer."""
        op = msg.get("op")
        try:
            if op == "inventory":
                items = self.inventory(msg.get("xuid"))
                ans = {"ok": items is not None, "items": items or [],
                       "message": None if items is not None else "You need to be online in Minecraft (and not in a Bedwars game) to offer an item."}
            elif op == "create":
                ok, text = self.create(msg["id"], msg["seller"], msg["slot"], msg["expectId"], msg["expectAmount"], msg["buyer"], msg["buyerName"], msg["price"])
                ans = {"ok": ok, "message": None if ok else text, "label": text if ok else None}
            elif op == "accept":
                ok, text = self.accept(msg["id"], msg["by"])
                ans = {"ok": ok, "message": text}
            elif op in ("decline", "cancel", "expire"):
                ok, text = self.give_back(msg["id"], {"decline": "declined", "cancel": "cancelled", "expire": "expired"}[op])
                ans = {"ok": ok, "message": text}
            else:
                ans = {"ok": False, "message": "Unknown trade action."}
        except Exception as e:
            self.plugin.logger.warning(f"Trade from the website failed: {e}")
            ans = {"ok": False, "message": "Something went wrong with the trade. Nothing was taken."}
        voice = getattr(self.plugin, "_voice", None)
        if voice:
            voice.send_json({"type": "answer", "req": msg.get("req"), **ans})

    # ---------- /trade in game ----------
    def command(self, player):
        xuid = str(player.xuid)
        incoming = self.db.execute("SELECT id, seller_name, label, amount, price FROM trades WHERE status = 'held' AND buyer = ? ORDER BY id", (xuid,)).fetchall()
        outgoing = self.db.execute("SELECT id, buyer_name, label, amount, price FROM trades WHERE status = 'held' AND seller = ? ORDER BY id", (xuid,)).fetchall()
        if not incoming and not outgoing:
            player.send_message("§7No trades right now. Offer an item to another player at §egalaxymc.us/trades§7 (while you're online in game).")
            return
        form = ActionForm(title="§l§dTrades", content="Offers to you, and your offers waiting for an answer.")
        for tid, seller, label, amount, price in incoming:
            form.add_button(f"§a{amount}x {label}§r\n§8from {seller} · {money.fmt(price)}", on_click=lambda p, t=tid: self.answer_form(p, t))
        for tid, buyer, label, amount, price in outgoing:
            form.add_button(f"§7{amount}x {label}§r\n§8to {buyer} · {money.fmt(price)} · tap to cancel",
                            on_click=lambda p, t=tid: self.give_back(t, "cancelled", via="game"))
        player.send_form(form)

    def answer_form(self, player, tid):
        t = self.row(tid)
        if not t or t["status"] != "held":
            player.send_message("§cThis trade is no longer open.")
            return
        ench = money.enchant_lines(money.rebuild(json.loads(t["item"])))
        form = ActionForm(title=f"Trade from {t['seller_name']}",
                          content=f"§f{t['amount']}x {t['label']}{(' §7(' + ', '.join(ench) + ')') if ench else ''}\n§7Price: §e{money.exact(t['price'])}\n"
                                  f"§7You have {self.eco.balance_text(player)}.")

        def accept(p):
            ok, text = self.accept(tid, p.xuid, via="game")
            if not ok:
                p.send_message("§c" + text)
        form.add_button("§a§lAccept and pay", on_click=accept)
        form.add_button("§c§lDecline", on_click=lambda p: self.give_back(tid, "declined", via="game"))
        form.add_button("Back", on_click=self.command)
        player.send_form(form)
