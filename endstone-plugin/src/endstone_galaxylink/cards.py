"""Player cards: crouch (sneak) and tap another player, or type /whois <name>, to see their rank, plan,
playtime, money and more. Players can also open their own with /whois."""

import time

from endstone.form import ActionForm

from endstone_galaxylink.progress import ACHIEVEMENTS, dollars


class PlayerCards:
    def __init__(self, plugin):
        self.plugin = plugin
        self.last = {}  # viewer uuid -> time of the last card (a tap can fire twice)

    def on_interact(self, event):
        """Crouching and tapping a player shows their card. Returns True when it did."""
        viewer = event.player
        if not viewer.is_sneaking:
            return False
        actor = event.actor
        aid = getattr(actor, "unique_id", None) if actor is not None else None
        target = next((p for p in self.plugin.server.online_players if aid is not None and p.unique_id == aid), None)
        if target is None or target.unique_id == viewer.unique_id:
            return False
        bw = getattr(self.plugin, "bedwars", None)
        if bw is not None and bw.playing(viewer):
            return False  # not during Bedwars
        now = time.monotonic()
        if now - self.last.get(str(viewer.unique_id), 0) < 1.0:
            event.is_cancelled = True
            return True
        self.last[str(viewer.unique_id)] = now
        event.is_cancelled = True
        self.show(viewer, target)
        return True

    def command(self, sender, args):
        name = " ".join(args).strip().lower()
        target = sender
        if name:
            online = list(self.plugin.server.online_players)
            target = next((p for p in online if p.name.lower() == name), None) or next((p for p in online if p.name.lower().startswith(name)), None)
            if target is None:
                return sender.send_message(f"§7{name} isn't online. See everyone on §egalaxymc.us/leaderboard§7.")
        self.show(sender, target)

    def show(self, viewer, target):
        from endstone_galaxylink.ranks import tag_text, name_text
        ranks = self.plugin.ranks
        style = ranks.display_tag(target)
        tag = tag_text(style) + "§r " if style else ""
        plans = getattr(self.plugin, "plans", None)
        plan_key = plans.plan_key(target) if plans else "free"
        plan_name = {"plus": "§bGalaxy+", "pro": "§dGalaxy Pro+"}.get(plan_key, "§7Galaxy Free")
        s = self.plugin.progress.stats(target)
        h, m = s["playtime"] // 3600, s["playtime"] % 3600 // 60
        lines = [
            f"{tag}{name_text(target.name, style, True)}§r",
            "",
            f"§lPlan:§r {plan_name}§r",
            f"§lPlaytime:§r {h}h {m}m",
            f"§lMoney:§r {dollars(self.plugin.economy.get(target.xuid))}",
            f"§lAchievements:§r {len(s['achievements'])}/{len(ACHIEVEMENTS)}",
            f"§lDaily streak:§r {s['streak']} (best {s['best_streak']})",
            f"§lBlocks mined:§r {s['mined']:,}",
            f"§lBedwars wins:§r {int(s.get('bw_wins', 0)):,}",
        ]
        warp = self.plugin.warps.of(str(target.xuid)) if getattr(self.plugin, "warps", None) else None
        if warp:
            lines.append(f"§lWarp:§r §e/warp {warp['name']}")
        lines += ["", f"§7Full profile: galaxymc.us/player/{target.name.replace(' ', '%20')}"]
        form = ActionForm(title=f"§l{target.name}", content="\n".join(lines))
        actions = []
        if target is not viewer and str(target.xuid) != str(viewer.xuid):
            actions.append(("Ask to teleport to them", lambda p: self.plugin.teleports.request(p, [target.name], "to")))
            if warp:
                actions.append((f"Visit their warp ({warp['name']})", lambda p: self.plugin.warps.warp(p, [warp["name"]])))
        for label, fn in actions:
            form.add_button(label, on_click=fn)
        form.add_button("Close")
        viewer.send_form(form)
