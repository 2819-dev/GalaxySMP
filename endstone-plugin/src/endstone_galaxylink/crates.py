"""Crates: Common, Rare and Galaxy crates with keys and a spinning opening animation.

Players: tap a crate (at spawn) to see what's inside and the chances. With a key, open it: the prizes spin
         on screen, slow down and stop on what you won.
Keys:    Common from finishing all 3 daily quests or buying one in the Shop; Rare from day 7 of /daily;
         Galaxy from events and staff (and a small chance inside other crates).
Staff:   /crates  place or remove crates (tap the block), edit what's inside and the chances, give keys,
         set the Common key price. /givekey <player> <crate> [amount] also works from the console.
"""

import json
import random

from endstone.event import PlayerInteractEvent
from endstone.form import ActionForm, Dropdown, ModalForm, TextInput

from endstone_galaxylink import money

TYPES = [("common", "Common Crate", "§a"), ("rare", "Rare Crate", "§9"), ("galaxy", "Galaxy Crate", "§d")]
TYPE_BY_KEY = {t[0]: t for t in TYPES}
PERMISSION = "galaxylink.command.crates"
DEFAULT_KEY_PRICE = 50000  # $500
SPIN = [2, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7, 9, 11, 14]  # ticks between frames: fast, then slowing down


def m(cents, w):
    return {"kind": "money", "cents": cents, "weight": w}


def it(item, count, w):
    return {"kind": "item", "item": item, "count": count, "weight": w}


def key(kind, count, w):
    return {"kind": "key", "key": kind, "count": count, "weight": w}


DEFAULT_REWARDS = {
    "common": [m(2500, 30), m(5000, 20), it("minecraft:iron_ingot", 16, 15), it("minecraft:bread", 32, 12),
               it("minecraft:gold_ingot", 8, 10), it("minecraft:diamond", 2, 8), key("rare", 1, 5)],
    "rare": [m(15000, 25), m(30000, 12), m(75000, 6), it("minecraft:diamond", 5, 15), it("minecraft:golden_apple", 3, 12),
             it("minecraft:emerald", 16, 12), it("minecraft:experience_bottle", 32, 12), key("galaxy", 1, 4)],
    "galaxy": [m(75000, 20), m(150000, 10), m(500000, 4), it("minecraft:diamond_block", 3, 15), it("minecraft:netherite_ingot", 1, 12),
               it("minecraft:enchanted_golden_apple", 1, 10), it("minecraft:totem_of_undying", 1, 10), it("minecraft:elytra", 1, 3),
               key("rare", 2, 16)],
}


def reward_name(r):
    if r["kind"] == "money":
        return f"§a{money.exact(r['cents'])}"
    if r["kind"] == "key":
        name, color = TYPE_BY_KEY[r["key"]][1].replace(" Crate", ""), TYPE_BY_KEY[r["key"]][2]
        return f"{color}{r['count']} {name} key{'s' if r['count'] != 1 else ''}"
    return f"§f{r['count']}x {r.get('name') or money.pretty_id(r['item'])}"


class Crates:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        cfg = self.eco.get_config("crates") or {}
        self.rewards = cfg.get("rewards") or json.loads(json.dumps(DEFAULT_REWARDS))
        self.blocks = cfg.get("blocks") or []          # [{id, type, dim, x, y, z}]
        self.key_price = cfg.get("key_price", DEFAULT_KEY_PRICE)
        self.opening = set()
        self.pending = {}  # staff uuid -> ("place", type) or ("remove", None)

    def save(self):
        self.eco.set_config("crates", {"rewards": self.rewards, "blocks": self.blocks, "key_price": self.key_price})

    def allowed(self, p):
        if getattr(p, "is_op", False):
            return True
        try:
            return bool(p.has_permission(PERMISSION))
        except Exception:
            return False

    def label(self, c):
        ft = getattr(self.plugin, "floating", None)
        if ft:
            _, name, color = TYPE_BY_KEY[c["type"]]
            ft.set(f"crate:{c['id']}", c["dim"], c["x"] + 0.5, c["y"] + 1.3, c["z"] + 0.5,
                   f"{color}§l✦ {name} ✦\n§r§7Tap to open with a {name.replace(' Crate', '')} key")

    def at(self, block):
        for c in self.blocks:
            if (c["dim"], c["x"], c["y"], c["z"]) == (block.dimension.name, block.x, block.y, block.z):
                return c
        return None

    # ---------- taps ----------
    def on_interact(self, event):
        if event.action != PlayerInteractEvent.Action.RIGHT_CLICK_BLOCK or not getattr(event, "has_block", False):
            return False
        p = event.player
        job = self.pending.get(str(p.unique_id))
        block = event.block
        if job:
            event.cancel()
            self.pending.pop(str(p.unique_id), None)
            what, kind = job
            existing = self.at(block)
            if what == "place":
                if existing:
                    return p.send_message("§cThat block is already a crate.") or True
                cid = max([c["id"] for c in self.blocks] + [0]) + 1
                c = {"id": cid, "type": kind, "dim": block.dimension.name, "x": block.x, "y": block.y, "z": block.z}
                self.blocks.append(c)
                self.save()
                self.label(c)
                p.send_message(f"§aThat block is now a {TYPE_BY_KEY[kind][1]}.")
            else:
                if not existing:
                    return p.send_message("§cThat block isn't a crate.") or True
                self.blocks.remove(existing)
                self.save()
                ft = getattr(self.plugin, "floating", None)
                if ft:
                    ft.remove(f"crate:{existing['id']}")
                p.send_message("§aCrate removed.")
            return True
        c = self.at(block)
        if not c:
            return False
        event.cancel()
        self.crate_menu(p, c["type"])
        return True

    def on_break(self, event):
        if self.at(event.block):
            event.cancel()
            if event.player.is_op:
                event.player.send_message("§7That's a crate. Remove it with /crates first.")
            return True
        return False

    # ---------- players ----------
    def crate_menu(self, player, kind):
        _, name, color = TYPE_BY_KEY[kind]
        rewards = self.rewards.get(kind) or []
        total = sum(r["weight"] for r in rewards) or 1
        lines = [f"{reward_name(r)} §8({r['weight'] * 100 / total:.1f}%)" for r in sorted(rewards, key=lambda r: -r["weight"])]
        keys = self.plugin.progress.keys(player).get(kind, 0)
        form = ActionForm(title=f"{color}§l{name}", content=f"Your {name.replace(' Crate', '')} keys: §l{keys}§r\n\n§lPrizes:§r\n" + "\n".join(lines))
        if keys:
            form.add_button(f"{color}§lOpen (uses 1 key)", icon="textures/ui/gift_square", on_click=lambda p: self.open(p, kind))
        if kind == "common":
            form.add_button(f"§lBuy a Common key§r\n§8{money.exact(self.key_price)}", icon="textures/ui/MCoin", on_click=self.buy_key)
        if not keys:
            form.add_button("§7How do I get keys?", on_click=lambda p: p.send_message(
                "§7Common keys: finish all 3 /quests in a day, or buy one in the /shop. Rare keys: day 7 of /daily. "
                "Galaxy keys: events, staff, or a lucky prize in another crate."))
        form.add_button("Close")
        player.send_form(form)

    def buy_key(self, player):
        if not self.eco.charge(player, self.key_price):
            return player.send_message(f"§cA Common key costs {money.exact(self.key_price)}. You don't have enough.")
        n = self.plugin.progress.add_keys(player.xuid, player.name, "common", 1)
        player.send_message(f"§aBought a Common crate key for {money.exact(self.key_price)}. §7You have {n}. Open it at the Common Crate at spawn.")

    def pick(self, kind):
        rewards = [r for r in self.rewards.get(kind) or [] if r["weight"] > 0]
        return random.choices(rewards, weights=[r["weight"] for r in rewards])[0] if rewards else None

    def open(self, player, kind):
        uid = str(player.unique_id)
        if uid in self.opening:
            return
        keys = self.plugin.progress.keys(player)
        if keys.get(kind, 0) <= 0:
            return player.send_message("§cYou don't have a key for this crate.")
        prize = self.pick(kind)
        if prize is None:
            return player.send_message("§cThis crate is empty. Tell staff!")
        keys[kind] -= 1
        self.plugin.progress.touch(player)
        self.opening.add(uid)
        rewards = self.rewards[kind]
        _, name, color = TYPE_BY_KEY[kind]
        delay = 0
        for i, wait in enumerate(SPIN):
            delay += wait
            show = random.choice(rewards)
            self.plugin.server.scheduler.run_task(self.plugin, lambda r=show: self._frame(uid, name, color, r), delay=delay)
        xuid, pname = player.xuid, player.name
        self.plugin.server.scheduler.run_task(self.plugin, lambda: self._finish(uid, kind, prize, xuid, pname), delay=delay + 16)

    def _player(self, uid):
        return next((p for p in self.plugin.server.online_players if str(p.unique_id) == uid), None)

    def _frame(self, uid, name, color, r):
        p = self._player(uid)
        if p is None:
            return
        try:
            p.send_title(f"{color}§l{name}", f"§7» {reward_name(r)} §7«", 0, 20, 0)
            p.play_sound(p.location, "note.hat", 0.8, 1.6)
        except Exception:
            pass

    def _finish(self, uid, kind, prize, xuid=None, pname=None):
        self.opening.discard(uid)
        p = self._player(uid)
        if p is None:  # left during the animation: give the key back
            if xuid is not None:
                self.plugin.progress.add_keys(xuid, pname, kind, 1)
            return
        self.give(p, prize)
        _, name, color = TYPE_BY_KEY[kind]
        try:
            p.send_title("§6§lYou won!", reward_name(prize), 0, 50, 15)
            p.play_sound(p.location, "random.levelup", 1.0, 1.0)
            p.play_sound(p.location, "firework.twinkle", 1.0, 1.0)
        except Exception:
            pass
        p.send_message(f"{color}§l{name}: §r§fyou won {reward_name(prize)}§f!")
        if kind == "galaxy" or prize.get("weight", 100) <= 5:
            for x in self.plugin.server.online_players:
                if x is not p:
                    x.send_message(f"§d✦ {p.name} won {reward_name(prize)} §dfrom a {name}! ✦")

    def give(self, player, r):
        if r["kind"] == "money":
            self.eco.credit(player, r["cents"])
        elif r["kind"] == "key":
            self.plugin.progress.add_keys(player.xuid, player.name, r["key"], r["count"])
        else:
            if r.get("snap"):
                stack = money.rebuild(r["snap"])
                if stack is not None:
                    money.give(player, stack)
                    return
            money.give(player, money.make_stacks(r["item"], r["count"]))

    # ---------- staff ----------
    def admin_menu(self, player):
        if not self.allowed(player):
            return player.send_message("§7Find the crates at spawn. Keys: /quests, /daily and the /shop.")
        form = ActionForm(title="§l§dCrates", content=f"{len(self.blocks)} crate{'s' if len(self.blocks) != 1 else ''} placed. "
                                                     f"Common key price: {money.exact(self.key_price)}.")
        for kind, name, color in TYPES:
            form.add_button(f"{color}§lEdit {name}§r\n§8{len(self.rewards.get(kind) or [])} prizes", on_click=lambda p, k=kind: self.edit_menu(p, k))
        form.add_button("§lPlace a crate§r\n§8Then tap the block to turn into a crate", icon="textures/ui/color_plus", on_click=self.place_form)
        form.add_button("§lRemove a crate§r\n§8Then tap the crate", icon="textures/ui/trash", on_click=self.remove_mode)
        form.add_button("§lGive keys", icon="textures/ui/gift_square", on_click=self.give_form)
        form.add_button("§lCommon key price", icon="textures/ui/MCoin", on_click=self.price_form)
        form.add_button("Close")
        player.send_form(form)

    def place_form(self, player):
        def submit(p, data):
            try:
                kind = TYPES[int(json.loads(data)[0])][0]
            except (ValueError, IndexError):
                return
            self.pending[str(p.unique_id)] = ("place", kind)
            p.send_message(f"§eNow tap the block that should be the {TYPE_BY_KEY[kind][1]} (a chest or ender chest looks great).")
        player.send_form(ModalForm(title="Place a crate", controls=[Dropdown("Which crate?", [t[1] for t in TYPES], 0)],
                                   submit_button="Next", on_submit=submit))

    def remove_mode(self, player):
        self.pending[str(player.unique_id)] = ("remove", None)
        player.send_message("§eNow tap the crate you want to remove.")

    def edit_menu(self, player, kind):
        _, name, color = TYPE_BY_KEY[kind]
        rewards = self.rewards.setdefault(kind, [])
        total = sum(r["weight"] for r in rewards) or 1
        form = ActionForm(title=f"{color}§lEdit {name}", content="Tap a prize to change its chance or remove it. "
                                                                 "Chances are weights: a prize with 20 is twice as likely as one with 10.")
        form.add_button("§l+ Add the item in my hand", icon="textures/ui/color_plus", on_click=lambda p: self.add_item(p, kind))
        form.add_button("§l+ Add a money prize", icon="textures/ui/MCoin", on_click=lambda p: self.add_money(p, kind))
        for i, r in enumerate(rewards):
            form.add_button(f"{reward_name(r)}\n§8weight {r['weight']} ({r['weight'] * 100 / total:.1f}%)", on_click=lambda p, i=i: self.edit_reward(p, kind, i))
        form.add_button("§7Reset to the default prizes", on_click=lambda p: self.reset(p, kind))
        form.add_button("§l< Back", on_click=self.admin_menu)
        player.send_form(form)

    def add_item(self, player, kind):
        hand = player.inventory.item_in_main_hand
        if hand is None or not hand.amount:
            return player.send_message("§eHold the item (and amount) you want to add, then try again.")

        def submit(p, data):
            try:
                w = max(1, int(float(json.loads(data)[0])))
            except (ValueError, IndexError, TypeError):
                return
            r = it(money.item_id(hand), hand.amount, w)
            r["name"] = money.item_label(hand)
            if money.is_special(hand):
                r["snap"] = money.snapshot(hand)  # keeps names and enchantments
            self.rewards[kind].append(r)
            self.save()
            p.send_message(f"§aAdded {reward_name(r)} §ato the {TYPE_BY_KEY[kind][1]}.")
            self.edit_menu(p, kind)
        player.send_form(ModalForm(title="Add item prize", controls=[TextInput(f"Chance weight for {hand.amount}x {money.item_label(hand)}", "10", "10")],
                                   submit_button="Add", on_submit=submit))

    def add_money(self, player, kind):
        def submit(p, data):
            try:
                v = json.loads(data)
                cents = money.parse(str(v[0]))
                w = max(1, int(float(v[1])))
            except (ValueError, IndexError, TypeError):
                return
            if not cents:
                return p.send_message("§cThat amount isn't valid.")
            self.rewards[kind].append(m(cents, w))
            self.save()
            self.edit_menu(p, kind)
        player.send_form(ModalForm(title="Add money prize", controls=[TextInput("Amount ($)", "e.g. 250", ""), TextInput("Chance weight", "10", "10")],
                                   submit_button="Add", on_submit=submit))

    def edit_reward(self, player, kind, i):
        rewards = self.rewards[kind]
        if i >= len(rewards):
            return self.edit_menu(player, kind)
        r = rewards[i]

        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            if int(v[1]) == 1:
                rewards.pop(i)
                p.send_message("§7Prize removed.")
            else:
                try:
                    r["weight"] = max(1, int(float(v[0])))
                except (ValueError, TypeError):
                    return
            self.save()
            self.edit_menu(p, kind)
        player.send_form(ModalForm(title=reward_name(r), controls=[TextInput("Chance weight", "10", str(r["weight"])),
                                                                  Dropdown("Action", ["Save", "Remove this prize"], 0)],
                                   submit_button="OK", on_submit=submit))

    def reset(self, player, kind):
        self.rewards[kind] = json.loads(json.dumps(DEFAULT_REWARDS[kind]))
        self.save()
        player.send_message(f"§aThe {TYPE_BY_KEY[kind][1]} has its default prizes again.")
        self.edit_menu(player, kind)

    def price_form(self, player):
        def submit(p, data):
            try:
                cents = money.parse(str(json.loads(data)[0]))
            except (ValueError, IndexError):
                return
            if not cents:
                return p.send_message("§cThat price isn't valid.")
            self.key_price = cents
            self.save()
            p.send_message(f"§aCommon keys now cost {money.exact(cents)} in the Shop.")
        player.send_form(ModalForm(title="Common key price", controls=[TextInput("Price ($)", "500", f"{self.key_price / 100:g}")],
                                   submit_button="Save", on_submit=submit))

    def give_form(self, player):
        def submit(p, data):
            try:
                v = json.loads(data)
                n = max(1, min(1000, int(float(v[2]))))
            except (ValueError, IndexError, TypeError):
                return
            self.give_keys(p, str(v[0]), TYPES[int(v[1])][0], n)
        player.send_form(ModalForm(title="Give keys", controls=[TextInput("Player (online or not)", "Gamertag", ""),
                                                                Dropdown("Key", [t[1].replace(" Crate", "") for t in TYPES], 0),
                                                                TextInput("How many", "1", "1")],
                                   submit_button="Give", on_submit=submit))

    def give_keys(self, sender, name, kind, n):
        found = self.plugin.moderation.known(name) if getattr(self.plugin, "moderation", None) else None
        if not found:
            return sender.send_message(f"§cNo player called {name} has been on the server.")
        xuid, exact = found
        total = self.plugin.progress.add_keys(xuid, exact, kind, n)
        label = TYPE_BY_KEY[kind][1].replace(" Crate", "")
        sender.send_message(f"§aGave {exact} {n} {label} key{'s' if n != 1 else ''}. §7They have {total}.")
        for p in self.plugin.server.online_players:
            if str(p.xuid) == str(xuid):
                p.send_message(f"§dYou got {n} {label} crate key{'s' if n != 1 else ''}! §7Open them at the crates at spawn.")

    def givekey_command(self, sender, args):
        if hasattr(sender, "xuid") and not self.allowed(sender):
            return sender.send_message("§cOnly staff can give keys.")
        if len(args) < 2:
            return sender.send_message("Usage: /givekey <player> <common|rare|galaxy> [amount]")
        parts = list(args)
        n = 1
        if parts[-1].isdigit():
            n = max(1, min(1000, int(parts.pop())))
        kind = parts.pop().lower()
        if kind not in TYPE_BY_KEY:
            return sender.send_message("§cThe crate must be common, rare or galaxy.")
        self.give_keys(sender, " ".join(parts), kind, n)
