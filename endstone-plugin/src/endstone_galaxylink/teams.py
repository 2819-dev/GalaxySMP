"""Teams (made and managed on galaxymc.us: Community > Friends > Team).

The website sends the teams (name, tag, organizer, members by Minecraft id). In game:
  - the team tag shows before your name in chat, always gray ([GLXY]) so it's never mixed up with ranks;
  - /tc <message> talks only to your team (also shown in the team chat on the website, and the other way round);
  - teammates can build on each other's plots (like a plot Builder).
"""

ALLOWED_TAG = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")


class Teams:
    def __init__(self, plugin):
        self.plugin = plugin
        saved = plugin.economy.get_config("teams_cache") or {}
        self.load(saved.get("teams") or [])

    def load(self, teams):
        self.teams = {}
        self.by_xuid = {}
        for t in teams[:500]:
            try:
                tid = int(t["id"])
            except (KeyError, TypeError, ValueError):
                continue
            tag = "".join(c for c in str(t.get("tag") or "") if c in ALLOWED_TAG or c == " ").strip()[:32]  # the Owner can have a longer tag
            team = {"id": tid, "name": str(t.get("name") or "")[:32], "tag": tag,
                    "members": [str(x) for x in (t.get("members") or [])][:8]}
            self.teams[tid] = team
            for x in team["members"]:
                self.by_xuid[x] = team

    def update(self, msg):
        teams = msg.get("teams") or []
        self.load(teams)
        self.plugin.economy.set_config("teams_cache", {"teams": teams})

    def team_of(self, xuid):
        return self.by_xuid.get(str(xuid))

    def same_team(self, a, b):
        t = self.team_of(a)
        return t is not None and str(b) in t["members"]

    def chat_tag(self, xuid):
        """'§7[TAG]§r ' (always gray) or ''."""
        t = self.team_of(xuid)
        return f"§7[{t['tag']}]§r " if t and t["tag"] else ""

    def online_members(self, team):
        return [p for p in self.plugin.server.online_players if str(p.xuid) in team["members"]]

    # ---------- /tc ----------
    def command(self, player, args):
        t = self.team_of(player.xuid)
        if t is None:
            player.send_message("§7You're not in a team. §eMake or join one on galaxymc.us (Community > Friends > Team).")
            return
        text = " ".join(args).strip()
        if not text:
            names = ", ".join(sorted(p.name for p in self.online_members(t))) or "nobody"
            player.send_message(f"§7Team §f{t['name']} §7[{t['tag']}] · online: §f{names}§7. Type §e/tc <message>§7 to talk to your team.")
            return
        moderation = getattr(self.plugin, "moderation", None)
        if moderation is not None and moderation.muted(player):
            player.send_message("§cYou can't send messages while you're muted.")
            return
        filt = getattr(self.plugin, "chatfilter", None)
        if filt is not None and hasattr(filt, "clean"):
            try:
                text = filt.clean(text)
            except Exception:
                pass
        text = text[:300]
        self.deliver(t, player.name, text)
        voice = getattr(self.plugin, "_voice", None)
        if voice is not None and getattr(voice, "ws", None):
            voice.send_json({"type": "teamchat", "teamId": t["id"], "xuid": str(player.xuid), "name": player.name, "text": text})

    def deliver(self, team, name, text, web=False):
        line = f"§7[{team['tag']}] §8» §f{name}{' §8(web)' if web else ''}§7: §f{text}"
        for p in self.online_members(team):
            p.send_message(line)

    def from_website(self, msg):
        """A message written in the team chat on the website."""
        try:
            t = self.teams.get(int(msg.get("teamId")))
        except (TypeError, ValueError):
            return
        if t is not None:
            self.deliver(t, str(msg.get("name") or "?")[:32], str(msg.get("text") or "")[:300], web=True)
