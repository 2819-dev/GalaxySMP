"""Warps: public teleport points. Galaxy Pro+ members can set one warp (at their shop or build) with
/setwarp <name>; everyone can visit it with /warp <name>, or pick one from the /warp list. /delwarp removes
your own warp; staff can remove anyone's (/delwarp <name>)."""

import json
import re
import time

from endstone.form import ActionForm

from endstone_galaxylink.teleport import where

NAME_RE = re.compile(r"^[A-Za-z0-9_-]{3,16}$")


class Warps:
    def __init__(self, plugin):
        self.plugin = plugin
        self.db = plugin.economy.db
        self.db.execute("CREATE TABLE IF NOT EXISTS warps (owner TEXT PRIMARY KEY, owner_name TEXT, name TEXT UNIQUE COLLATE NOCASE, "
                        "data TEXT, created REAL, visits INTEGER DEFAULT 0)")
        self.db.commit()

    # ---------- reading ----------
    def all(self):
        rows = self.db.execute("SELECT owner, owner_name, name, data, visits FROM warps ORDER BY visits DESC, name").fetchall()
        return [{"owner": r[0], "ownerName": r[1], "name": r[2], "spot": json.loads(r[3]), "visits": r[4]} for r in rows]

    def of(self, xuid):
        r = self.db.execute("SELECT owner, owner_name, name, data, visits FROM warps WHERE owner = ?", (str(xuid),)).fetchone()
        return {"owner": r[0], "ownerName": r[1], "name": r[2], "spot": json.loads(r[3]), "visits": r[4]} if r else None

    def find(self, name):
        r = self.db.execute("SELECT owner, owner_name, name, data, visits FROM warps WHERE name = ?", (str(name),)).fetchone()
        return {"owner": r[0], "ownerName": r[1], "name": r[2], "spot": json.loads(r[3]), "visits": r[4]} if r else None

    def is_pro(self, player):
        plans = getattr(self.plugin, "plans", None)
        return bool(plans and plans.plan_key(player) == "pro")

    # ---------- commands ----------
    def warp(self, player, args):
        name = " ".join(args).strip()
        if not name:
            return self.menu(player)
        w = self.find(name)
        if w is None:
            return player.send_message(f"§cThere's no warp called {name}. §7Type /warp to see them all.")
        self.db.execute("UPDATE warps SET visits = visits + 1 WHERE owner = ?", (w["owner"],))
        self.db.commit()
        self.plugin.teleports.go(player, lambda: (self.find(w["name"]) or {}).get("spot"), f"{w['ownerName']}'s warp {w['name']}")

    def menu(self, player):
        warps = self.all()
        if not warps:
            return player.send_message("§7No warps yet. §dGalaxy Pro+§7 members can make one with §e/setwarp <name>§7.")
        form = ActionForm(title="§lWarps", content="Public places players made. Tap one to teleport there.")
        for w in warps[:60]:
            form.add_button(f"{w['name']}\n§8by {w['ownerName']} · {w['visits']} visit{'s' if w['visits'] != 1 else ''}",
                            on_click=lambda p, n=w["name"]: self.warp(p, [n]))
        player.send_form(form)

    def set_warp(self, player, args):
        if not self.is_pro(player) and not player.is_op:
            return player.send_message("§cWarps are a §dGalaxy Pro+§c perk. §7See galaxymc.us/store.")
        name = "_".join(" ".join(args).split())
        if not NAME_RE.match(name):
            return player.send_message("§cUse /setwarp <name>: 3 to 16 letters, numbers, - or _ (e.g. /setwarp MyShop).")
        bw = getattr(self.plugin, "bedwars", None)
        if bw is not None and bw.playing(player):
            return player.send_message("§cYou can't set a warp in a Bedwars game.")
        taken = self.find(name)
        if taken and taken["owner"] != str(player.xuid):
            return player.send_message(f"§cThe name {name} is already taken. Pick another one.")
        filt = getattr(self.plugin, "chatfilter", None)
        if filt is not None and filt.bad_spans(name.replace("_", " ").replace("-", " ")):
            return player.send_message("§cThat name isn't allowed.")
        old = self.of(player.xuid)
        self.db.execute("INSERT OR REPLACE INTO warps (owner, owner_name, name, data, created, visits) VALUES (?,?,?,?,?,?)",
                        (str(player.xuid), player.name, name, json.dumps(where(player)), time.time(), old["visits"] if old else 0))
        self.db.commit()
        msg = f"moved and renamed to §e{name}" if old and old["name"] != name else ("moved here" if old else f"§e{name}§a is ready")
        player.send_message(f"§aYour warp {msg}. §7Anyone can visit with §e/warp {name}§7.")

    def del_warp(self, player, args):
        name = " ".join(args).strip()
        staff = player.is_op or self.plugin.moderation.is_staff(player)
        w = self.find(name) if name else self.of(player.xuid)
        if w is None:
            return player.send_message("§7You don't have a warp." if not name else f"§cThere's no warp called {name}.")
        if w["owner"] != str(player.xuid) and not staff:
            return player.send_message("§cYou can only delete your own warp.")
        self.db.execute("DELETE FROM warps WHERE owner = ?", (w["owner"],))
        self.db.commit()
        player.send_message(f"§aDeleted the warp {w['name']}" + (f" (by {w['ownerName']})." if w["owner"] != str(player.xuid) else "."))
