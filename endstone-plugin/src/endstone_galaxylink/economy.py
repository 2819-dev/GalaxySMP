"""Economy: balances, the money display, /money /pay /baltop and the operator money commands.

Balances live in economy.db in the plugin's data folder (on the server), so they
work even if the website is down. The plugin sends balances to the website for
the money leaderboard, and the website's admin panel can change them.
"""

import json
import sqlite3
import time

from endstone.form import ActionForm

from endstone_galaxylink import money

START_CENTS = 1000 * 100     # every new player gets $1,000
HUD_TICKS = 20               # money display refresh (once a second)
SYNC_TICKS = 200             # balances to the website every 10 seconds (only changed ones)

HUD = "§1§lMoney:§r §e{}§r"


class Economy:
    def __init__(self, plugin):
        self.plugin = plugin
        folder = plugin.data_folder
        folder.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(folder / "economy.db"), check_same_thread=False)
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS balances (xuid TEXT PRIMARY KEY, name TEXT, cents INTEGER NOT NULL, updated REAL);
            CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS ah (
                id INTEGER PRIMARY KEY AUTOINCREMENT, seller TEXT, seller_name TEXT, item TEXT, label TEXT,
                item_id TEXT, amount INTEGER, price INTEGER, created REAL, expires REAL,
                status TEXT DEFAULT 'active', buyer TEXT);
            CREATE INDEX IF NOT EXISTS ah_status ON ah(status, expires);
            CREATE TABLE IF NOT EXISTS npcs (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT);
        """)
        self.db.commit()
        self.dirty = set()
        self.shown = {}  # player uuid -> score tag text
        self._ticks = 0

    # ---------- config ----------
    def get_config(self, key):
        row = self.db.execute("SELECT value FROM config WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def set_config(self, key, value):
        self.db.execute("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", (key, json.dumps(value)))
        self.db.commit()

    # ---------- balances ----------
    def get(self, xuid):
        row = self.db.execute("SELECT cents FROM balances WHERE xuid = ?", (str(xuid),)).fetchone()
        return row[0] if row else 0

    def balance_text(self, player):
        return money.fmt(self.get(player.xuid), player.is_op)

    def _write(self, xuid, name, cents):
        cents = max(0, min(int(cents), money.MAX_CENTS))
        self.db.execute(
            "INSERT INTO balances (xuid, name, cents, updated) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(xuid) DO UPDATE SET cents = excluded.cents, name = coalesce(excluded.name, balances.name), "
            "updated = excluded.updated",
            (str(xuid), name, cents, time.time()))
        self.db.commit()
        self.dirty.add(str(xuid))
        return cents

    def set(self, xuid, name, cents):
        return self._write(xuid, name, cents)

    def add(self, xuid, name, cents):
        return self._write(xuid, name, self.get(xuid) + cents)

    def take(self, xuid, cents):
        have = self.get(xuid)
        if have < cents:
            return False
        self._write(xuid, None, have - cents)
        return True

    def charge(self, player, cents):
        """Takes money from a player for a purchase. Operators have infinite money."""
        if player.is_op:
            return True
        return self.take(player.xuid, cents)

    def credit(self, player, cents):
        self.add(player.xuid, player.name, cents)

    def ensure(self, player):
        """New players get their starting money. Returns True the first time."""
        row = self.db.execute("SELECT 1 FROM balances WHERE xuid = ?", (str(player.xuid),)).fetchone()
        if row:
            self.db.execute("UPDATE balances SET name = ? WHERE xuid = ?", (player.name, str(player.xuid)))
            self.db.commit()
            return False
        self._write(player.xuid, player.name, START_CENTS)
        return True

    def top(self, limit=10):
        ops = {str(p.xuid) for p in self.plugin.server.online_players if p.is_op}
        rows = self.db.execute("SELECT xuid, name, cents FROM balances ORDER BY cents DESC LIMIT ?",
                               (limit + len(ops) + 50,)).fetchall()
        known_ops = set(self.get_config("ops") or []) | ops
        return [r for r in rows if r[0] not in known_ops][:limit]

    # ---------- display ----------
    def tick(self):
        self._ticks += 1
        if self._ticks % (SYNC_TICKS // HUD_TICKS) == 0:
            self.sync()
        ops = []
        for p in self.plugin.server.online_players:
            text = HUD.format(self.balance_text(p))
            try:
                p.send_tip(text)
                key = str(p.unique_id)
                if self.shown.get(key) != text:
                    p.score_tag = text
                    self.shown[key] = text
            except Exception:
                pass
            if p.is_op:
                ops.append(str(p.xuid))
        if ops:
            known = set(self.get_config("ops") or [])
            if not set(ops) <= known:
                self.set_config("ops", sorted(known | set(ops)))

    def on_join(self, player):
        self.shown.pop(str(player.unique_id), None)
        if self.ensure(player):
            player.send_message(f"§aWelcome to GalaxySMP! You got §e{money.exact(START_CENTS)}§a to start. "
                                "§7Try /shop, /sell and /ah.")

    # ---------- website sync ----------
    def sync(self, everything=False):
        voice = self.plugin._voice
        if not voice or not voice.ws:
            return
        if everything:
            rows = self.db.execute("SELECT xuid, name, cents FROM balances ORDER BY cents DESC LIMIT 2000").fetchall()
        elif self.dirty:
            ids = list(self.dirty)[:500]
            marks = ",".join("?" * len(ids))
            rows = self.db.execute(f"SELECT xuid, name, cents FROM balances WHERE xuid IN ({marks})", ids).fetchall()
        else:
            return
        self.dirty.clear()
        ops = set(self.get_config("ops") or []) | {str(p.xuid) for p in self.plugin.server.online_players if p.is_op}
        voice.send_json({"type": "balances", "players": [
            {"xuid": x, "name": n, "cents": c, "op": x in ops} for x, n, c in rows]})

    def from_website(self, msg):
        """Money changes made on the website (Staff Tools > Economy)."""
        xuid = str(msg.get("xuid") or "")
        cents = int(msg.get("cents") or 0)
        name = msg.get("name")
        action = msg.get("action")
        if not xuid.isdigit() or cents < 0:
            return
        if action == "set":
            self.set(xuid, name, cents)
        elif action == "add":
            self.add(xuid, name, cents)
        elif action == "take":
            self._write(xuid, name, max(0, self.get(xuid) - cents))
        else:
            return
        target = next((p for p in self.plugin.server.online_players if str(p.xuid) == xuid), None)
        if target:
            target.send_message(f"§7Your balance is now §e{self.balance_text(target)}§7 (changed by staff on the website).")
        self.plugin.logger.info(f"Website ({msg.get('by', 'staff')}) {action} money for {name}: {money.exact(cents)}")

    # ---------- commands ----------
    def find_player(self, sender, name):
        name = str(name or "").strip().strip('"').strip()
        if name in ("@s", "") and hasattr(sender, "xuid"):
            return sender
        online = list(self.plugin.server.online_players)
        low = name.lower()
        for p in online:
            if p.name.lower() == low:
                return p
        matches = [p for p in online if p.name.lower().startswith(low)]
        return matches[0] if len(matches) == 1 else None

    @staticmethod
    def split_target(args):
        """('Chat', 'Bob', '100') -> ('Chat Bob', '100'): gamertags can have spaces."""
        parts = " ".join(args).replace('"', " ").split()
        if len(parts) < 2:
            return None, None
        return " ".join(parts[:-1]), parts[-1]

    def cmd_money(self, sender, args):
        if args and " ".join(args).strip():
            target = self.find_player(sender, " ".join(args))
            if not target:
                sender.send_message("§cThat player isn't online.")
                return
            sender.send_message(f"§e{target.name}§7 has §e{self.balance_text(target)}")
            return
        if not hasattr(sender, "xuid"):
            sender.send_message("Usage: /money <player>")
            return
        sender.send_message(f"§7Your balance: §e{self.balance_text(sender)}")

    def cmd_pay(self, sender, args):
        if not hasattr(sender, "xuid"):
            sender.send_message("Only players can use /pay.")
            return
        name, amount = self.split_target(args)
        cents = money.parse(amount)
        if not name or cents is None:
            sender.send_message("§eUsage: /pay <player> <amount>  §7(for example /pay Steve 2.5k)")
            return
        target = self.find_player(sender, name)
        if not target:
            sender.send_message("§cThat player isn't online.")
            return
        if target.unique_id == sender.unique_id:
            sender.send_message("§cYou can't pay yourself.")
            return
        if cents < 100:
            sender.send_message("§cThe smallest payment is $1.")
            return
        if not self.charge(sender, cents):
            sender.send_message(f"§cYou don't have enough money. You have §e{self.balance_text(sender)}§c.")
            return
        self.credit(target, cents)
        progress = getattr(self.plugin, "progress", None)
        if progress:
            progress.add(sender, "paid", cents)
        sender.send_message(f"§aYou paid §e{target.name} {money.exact(cents)}§a.")
        target.send_message(f"§e{sender.name}§a paid you §e{money.exact(cents)}§a.")

    def cmd_admin(self, sender, label, args):
        name, amount = self.split_target(args)
        cents = money.parse(amount)
        if label == "setmoney" and amount in ("0", "$0"):
            cents = 0
        if not name or cents is None:
            sender.send_message(f"§eUsage: /{label} <player> <amount>")
            return
        target = self.find_player(sender, name)
        if not target:
            sender.send_message("§cThat player isn't online. Offline players can be changed on galaxymc.us (Staff Tools > Economy).")
            return
        if label == "setmoney":
            self.set(target.xuid, target.name, cents)
        elif label == "addmoney":
            self.add(target.xuid, target.name, cents)
        else:
            self._write(target.xuid, target.name, max(0, self.get(target.xuid) - cents))
        new = money.exact(self.get(target.xuid))
        sender.send_message(f"§a{target.name} now has §e{new}§a.")
        if target is not sender:
            target.send_message(f"§7Your balance is now §e{new}§7.")

    def open_top(self, player):
        rows = self.top(10)
        lines = []
        for i, (xuid, name, cents) in enumerate(rows, 1):
            medal = {1: "§6", 2: "§7", 3: "§c"}.get(i, "§f")
            lines.append(f"{medal}#{i} §f{name} §8- §e{money.fmt(cents)}")
        if not lines:
            lines.append("§7No one has any money yet.")
        lines.append("")
        lines.append(f"§7You: §e{self.balance_text(player)}")
        lines.append("§8Full list: galaxymc.us/leaderboard")
        form = ActionForm(title="§lMoney Leaderboard", content="\n".join(lines))
        form.add_button("Close")
        player.send_form(form)
