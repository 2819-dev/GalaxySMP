"""Rewards from the website (referrals, the season pass, server goals): money and crate keys.

The website keeps sending a reward until the plugin says it gave it ("rewards_done"). The plugin remembers
the ids it already gave, so a reward is never given twice, even if the confirmation got lost.
Works for offline players too: money and keys are saved by Minecraft id (xuid).
"""

from endstone_galaxylink import money

KEY_NAMES = {"common": "Common", "rare": "Rare", "galaxy": "Galaxy"}


class Rewards:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.given = list(self.eco.get_config("rewards_given") or [])  # the last few thousand reward ids

    def from_website(self, msg):
        done, seen = [], set(self.given)
        for r in (msg.get("list") or [])[:200]:
            try:
                rid = int(r.get("id"))
            except (TypeError, ValueError):
                continue
            if rid in seen:
                done.append(rid)  # already given: just confirm again
                continue
            xuid, name = str(r.get("xuid") or ""), str(r.get("name") or "")[:32]
            if not xuid.isdigit():
                continue
            if isinstance(r.get("stats"), dict) and r["stats"]:  # leaderboard stats set by the owner
                self.plugin.progress.set_stats(xuid, name, r["stats"])
            cents = max(0, int(r.get("cents") or 0))
            keys = {k: max(0, min(100, int(v or 0))) for k, v in (r.get("keys") or {}).items() if k in KEY_NAMES}
            if cents:
                self.eco.add(xuid, name, cents)
            for kind, n in keys.items():
                if n:
                    self.plugin.progress.add_keys(xuid, name, kind, n)
            seen.add(rid)
            self.given.append(rid)
            done.append(rid)
            if cents or any(keys.values()):
                self.tell(xuid, cents, keys, str(r.get("reason") or "")[:120])
        self.given = self.given[-3000:]
        self.eco.set_config("rewards_given", self.given)
        if done:
            voice = getattr(self.plugin, "_voice", None)
            if voice is not None:
                voice.send_json({"type": "rewards_done", "ids": done})

    def tell(self, xuid, cents, keys, reason):
        p = next((x for x in self.plugin.server.online_players if str(x.xuid) == xuid), None)
        if p is None:
            return
        parts = [f"§e{money.fmt(cents)}"] if cents else []
        parts += [f"§d{n} {KEY_NAMES[k]} key{'s' if n != 1 else ''}" for k, n in keys.items() if n]
        if parts:
            p.send_message(f"§aReward: {'§7, '.join(parts)}§7 ({reason}).")
