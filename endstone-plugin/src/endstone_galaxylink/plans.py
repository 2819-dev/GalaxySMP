"""Subscriptions: Galaxy Free, Galaxy+ and Galaxy Pro+.

The website decides who has which plan (Admins give plans in Staff Tools; paid
checkout comes later) and sends the list here. Each paid plan also costs $1,000
of in-game money every 30 days, taken automatically when the player is online.
If they can't pay, the plan's perks pause until they have the money.
"""

import json
import time
from importlib import resources

from endstone_galaxylink import money

MONTH = 30 * 24 * 3600
CHECK_TICKS = 1200  # once a minute


def plan_defs():
    return json.loads(resources.files("endstone_galaxylink").joinpath("plans.json").read_text("utf-8"))


class Plans:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.execute("CREATE TABLE IF NOT EXISTS plan_billing (xuid TEXT PRIMARY KEY, paid_until REAL, warned REAL)")
        self.db.commit()
        self.defs = plan_defs()
        self.subs = self.eco.get_config("plans") or {}  # xuid -> {"plan": "plus", "expires": epoch seconds or None}
        self._ticks = 0

    # ---------- from the website ----------
    def update_from_website(self, msg):
        subs = msg.get("subscriptions")
        if isinstance(subs, dict):
            self.subs = {str(k): v for k, v in subs.items() if isinstance(v, dict) and v.get("plan") in ("plus", "pro")}
            self.eco.set_config("plans", self.subs)
            plots = getattr(self.plugin, "plots", None)
            if plots:
                plots.update_extra(msg.get("extraPlots"))
            for p in self.plugin.server.online_players:
                self.bill(p)
            self.plugin.refresh_tags()

    # ---------- who has what ----------
    def subscription(self, player):
        sub = self.subs.get(str(player.xuid))
        if not sub:
            return None
        if sub.get("expires") and sub["expires"] < time.time():
            return None
        return sub

    def paid(self, player):
        row = self.db.execute("SELECT paid_until FROM plan_billing WHERE xuid = ?", (str(player.xuid),)).fetchone()
        return bool(row and row[0] and row[0] > time.time())

    def plan_key(self, player):
        sub = self.subscription(player)
        if sub and (player.is_op or self.paid(player)):
            return sub["plan"]
        return "free"

    def plan_for(self, player):
        return self.defs[self.plan_key(player)]

    def tag_for(self, player):
        return self.plan_for(player).get("tag")

    # ---------- the monthly in-game fee ----------
    def bill(self, player):
        sub = self.subscription(player)
        if not sub or self.paid(player):
            return
        plan = self.defs[sub["plan"]]
        cost = int(plan.get("gameCost", 0)) * 100
        if player.is_op or cost <= 0 or self.eco.charge(player, cost):
            self.db.execute("INSERT OR REPLACE INTO plan_billing (xuid, paid_until, warned) VALUES (?, ?, NULL)",
                            (str(player.xuid), time.time() + MONTH))
            self.db.commit()
            if cost and not player.is_op:
                player.send_message(f"§aYour {plan['name']} in-game fee ({money.exact(cost)}) was paid. "
                                    "§7Your perks are active for 30 days.")
            self.plugin.refresh_tags()
            return
        row = self.db.execute("SELECT warned FROM plan_billing WHERE xuid = ?", (str(player.xuid),)).fetchone()
        if not row or not row[0] or time.time() - row[0] > 3600:
            player.send_message(f"§eYour {plan['name']} needs {money.exact(cost)} of in-game money this month. "
                                f"§7Its perks are paused until you have it. You have {self.eco.balance_text(player)}.")
            self.db.execute("INSERT INTO plan_billing (xuid, paid_until, warned) VALUES (?, NULL, ?) "
                            "ON CONFLICT(xuid) DO UPDATE SET warned = excluded.warned", (str(player.xuid), time.time()))
            self.db.commit()

    def tick(self):
        for p in self.plugin.server.online_players:
            try:
                self.bill(p)
            except Exception as e:
                self.plugin.logger.warning(f"Plan billing failed for {p.name}: {e}")

    def describe(self, player):
        sub = self.subscription(player)
        if not sub:
            return "§7You're on §fGalaxy Free§7. Plans: galaxymc.us/store"
        plan = self.defs[sub["plan"]]
        state = "§aactive" if (player.is_op or self.paid(player)) else "§epaused (in-game fee unpaid)"
        until = time.strftime("%b %d, %Y", time.localtime(sub["expires"])) if sub.get("expires") else "no end date"
        return f"§7Your plan: §f{plan['name']}§7, {state}§7. Ends: {until}."
