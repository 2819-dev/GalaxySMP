"""Server-wide goals made on the website (Control Panel > Server goals), e.g. "Mine 1,000,000 blocks together".
The website counts everyone's progress and sends it here every few minutes; /goal shows it."""

from endstone.form import ActionForm

from endstone_galaxylink import money

UNITS = {"mined": "blocks mined", "placed": "blocks placed", "playtime": "hours played", "kills": "mobs defeated",
         "quests": "quests completed", "bw_wins": "Bedwars wins", "bw_games": "Bedwars games played"}


def bar(pct, width=20):
    filled = max(0, min(width, round(pct / 100 * width)))
    return "§a" + "|" * filled + "§8" + "|" * (width - filled)


class Goals:
    def __init__(self, plugin):
        self.plugin = plugin
        self.goal = plugin.economy.get_config("server_goal")  # the latest one from the website

    def from_website(self, msg):
        self.goal = msg.get("goal") if isinstance(msg.get("goal"), dict) else None
        self.plugin.economy.set_config("server_goal", self.goal)

    def show(self, player):
        g = self.goal
        if not g:
            return player.send_message("§7There's no server goal right now. Watch §egalaxymc.us§7 for the next one!")
        target, done = max(1, int(g.get("target") or 1)), int(g.get("progress") or 0)
        pct = min(100, int(done * 100 / target))
        unit = UNITS.get(g.get("stat"), "")
        lines = [f"§l{g.get('title', 'Server goal')}§r", "", f"{bar(pct)} §f{pct}%",
                 f"§7{done:,} of {target:,} {unit}"]
        if g.get("finished"):
            lines.append("§aDone! Everyone who helped got the reward.")
        elif g.get("endsIn"):
            lines.append(f"§7Time left: §f{g['endsIn']}")
        if int(g.get("rewardCents") or 0):
            lines.append(f"§7Reward for everyone who helps: §e{money.fmt(int(g['rewardCents']))}")
        top = g.get("top") or []
        if top:
            lines += ["", "§lTop helpers§r"] + [f"§7{i + 1}. §f{t.get('name')} §8({int(t.get('value') or 0):,})" for i, t in enumerate(top[:5])]
        lines += ["", "§7See it on galaxymc.us"]
        form = ActionForm(title="§lServer goal", content="\n".join(lines))
        form.add_button("Close")
        player.send_form(form)
