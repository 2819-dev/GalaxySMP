"""#Chat on galaxymc.us and Minecraft chat are one conversation.

Game -> website: every chat message players send in game is passed to the website, which shows it in #Chat.
Website -> game: messages members write in #Chat arrive here and are shown to everyone online, formatted
exactly like normal game chat (rank tag and name color). The website's chat filter has already checked them.
"""

import re
import time


class _Member:
    """A website member who may not be online: enough of a player for the rank and plan lookups."""

    def __init__(self, xuid, name):
        self.xuid = str(xuid or "")
        self.name = name
        self.is_op = False
        self.unique_id = None


class GameChat:
    def __init__(self, plugin):
        self.plugin = plugin

    def to_website(self, player, text):
        voice = getattr(self.plugin, "_voice", None)
        text = str(text or "").strip()
        if voice is None or not text:
            return
        voice.send_json({"type": "gamechat", "xuid": str(player.xuid), "name": player.name, "text": text[:500]})

    def lines(self, name, xuid, text):
        """The chat line(s) for a website message, in the same style as game chat."""
        ranks = self.plugin.ranks
        who = _Member(xuid, name)
        try:
            from endstone_galaxylink.ranks import tag_spec
            style = ranks.display_tag(who) if xuid else None
            pics = getattr(self.plugin, "ranktags", None)
            badge = pics.glyphs_for(tag_spec(style)) if pics is not None and pics.chat_pictures and style else None
            if badge:
                now = time.time()
                last = getattr(self.plugin, "_last_chat", None)
                out = []
                key = who.xuid or f"web:{name}"
                if not last or last[0] != key or now - last[1] > 120:
                    out.append(ranks.chat_header(who))
                self.plugin._last_chat = (key, now)
                return out + [f"§f{text}"]
            return [ranks.chat_format(who).format(name, text)]
        except Exception as e:
            self.plugin.logger.warning(f"Website chat format failed: {e}")
            return [f"§f§l{name}§r§7:§r {text}"]

    def from_website(self, msg):
        name = re.sub("§.?", "", str(msg.get("name") or ""))[:32]
        text = re.sub("§.?", "", str(msg.get("text") or "")).strip()[:500]  # no color codes from the website
        if not name or not text:
            return
        lines = self.lines(name, msg.get("xuid"), text)
        for p in self.plugin.server.online_players:
            for line in lines:
                try:
                    p.send_message(line)
                except Exception:
                    pass
        self.plugin.logger.info(f"<{name}> {text}")
