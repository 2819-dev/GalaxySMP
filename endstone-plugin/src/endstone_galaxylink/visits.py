"""Visit from the website: the Visit button on a public plot or a warp on galaxymc.us/map.

If you're online, you're teleported (with the usual 3-second "don't move" wait). If you're offline, it waits
for you and happens the next time you join. Plots: you land on the ground in front of the plot (Minecraft's
own /spreadplayers finds a safe spot, like /rtp). Warps: the warp's exact spot.
"""

from endstone_galaxylink.teleport import where


class Visits:
    def __init__(self, plugin):
        self.plugin = plugin
        self.pending = plugin.economy.get_config("web_visits") or {}   # xuid -> {kind, id}

    def online(self, xuid):
        return next((p for p in self.plugin.server.online_players if str(p.xuid) == str(xuid)), None)

    def target(self, kind, ref):
        """(label, spot or None, plot or None) for a visit, or None if it's gone / not public."""
        if kind == "warp":
            w = self.plugin.warps.find(str(ref))
            return (f"{w['ownerName']}'s warp {w['name']}", w["spot"], None) if w else None
        p = self.plugin.plots.plots.get(ref) or self.plugin.plots.plots.get(str(ref))
        if p is None:
            try:
                p = self.plugin.plots.plots.get(int(ref))
            except (TypeError, ValueError):
                p = None
        if p is None or p.get("status") not in (None, "ready") or not (p.get("public") or p.get("shop") or p.get("kind") == "area"):
            return None   # only places the map shows everyone: public plots, shops and areas
        return (self.plugin.plots.label(p), None, p)

    def go(self, player, kind, ref):
        t = self.target(kind, ref)
        if t is None:
            return player.send_message("§cThat place isn't public any more.")
        label, spot, plot = t
        bw = getattr(self.plugin, "bedwars", None)
        if bw is not None and bw.playing(player):
            return player.send_message("§cFinish your Bedwars game first, then use Visit on the website again.")
        tp = self.plugin.teleports
        if spot is not None:
            return tp.go(player, lambda: spot, label)
        tp.go(player, lambda: None, label, run=lambda p: self._to_plot(p, plot, label))

    def _to_plot(self, player, plot, label):
        """Land on the ground just in front of the plot (its north edge, in the middle)."""
        server = self.plugin.server
        x = int((plot["x1"] + plot["x2"]) / 2)
        z = int(plot["z1"]) - 2
        name = player.name.replace('"', "")
        if str(player.dimension.name).lower() != str(plot.get("dim", "Overworld")).lower():
            from endstone.level import Location
            player.teleport(Location(server.level.get_dimension(plot.get("dim", "Overworld")), x + 0.5, 200.0, z + 0.5, 0.0, 0.0))
        server.scheduler.run_task(self.plugin, lambda: (server.dispatch_command(server.command_sender, f'spreadplayers {x} {z} 0 1 "{name}"'),
                                                        player.send_message(f"§aTeleported to {label}.") if player.is_valid else None), delay=5)

    # ---------- from the website ----------
    def from_website(self, msg):
        xuid, kind, ref = str(msg.get("xuid")), msg.get("kind"), msg.get("ref")
        try:
            if kind not in ("plot", "warp") or self.target(kind, ref) is None:
                ans = {"ok": False, "message": "That place isn't public any more."}
            else:
                p = self.online(xuid)
                if p is not None:
                    self.go(p, kind, ref)
                    ans = {"ok": True, "now": True, "message": "Teleporting you in game now (stand still for 3 seconds)."}
                else:
                    self.pending[xuid] = {"kind": kind, "ref": ref}
                    self.plugin.economy.set_config("web_visits", self.pending)
                    ans = {"ok": True, "now": False, "message": "You'll be taken there the next time you join the server."}
        except Exception as e:
            self.plugin.logger.warning(f"Visit from the website failed: {e}")
            ans = {"ok": False, "message": "Something went wrong. Try again in a minute."}
        voice = getattr(self.plugin, "_voice", None)
        if voice:
            voice.send_json({"type": "answer", "req": msg.get("req"), **ans})

    def on_join(self, player):
        v = self.pending.pop(str(player.xuid), None)
        if v:
            self.plugin.economy.set_config("web_visits", self.pending)
            player.send_message("§bTaking you to the place you picked on the website…")
            self.go(player, v["kind"], v["ref"])

    # ---------- teleport requests from the Friends list ----------
    def web_tpa(self, msg):
        sender, target = self.online(msg.get("from")), self.online(msg.get("to"))
        if sender is None:
            ans = {"ok": False, "message": "You need to be online in Minecraft to send a teleport request."}
        elif target is None:
            ans = {"ok": False, "message": "They're not online in Minecraft right now."}
        else:
            try:
                self.plugin.teleports.request(sender, [target.name], "here" if msg.get("here") else "to")
                ans = {"ok": True, "message": f"Teleport request sent to {target.name}. They accept with /tpaccept in game."}
            except Exception as e:
                self.plugin.logger.warning(f"Teleport request from the website failed: {e}")
                ans = {"ok": False, "message": "Couldn't send the request. Try /tpa in game."}
        voice = getattr(self.plugin, "_voice", None)
        if voice:
            voice.send_json({"type": "answer", "req": msg.get("req"), **ans})
