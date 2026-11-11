"""Direct messages with the GalaxySMP community website.

/dm <player> <message>   sends a DM to a community member (they see it on galaxymc.us, and in game
                         if they're playing). DMs from the website show here in chat.
/r <message>             replies to the last person who sent you a DM.
"""

PREFIX = "§d§l[DM]§r"


class DirectMessages:
    def __init__(self, plugin):
        self.plugin = plugin
        self.last = {}  # player xuid -> name of the last person who DMed them (for /r)

    def online(self, xuid):
        return next((p for p in self.plugin.server.online_players if str(p.xuid) == str(xuid)), None)

    # ---------- from the website ----------
    def deliver(self, msg):
        p = self.online(msg.get("toXuid"))
        if p is None:
            return
        sender = str(msg.get("from") or "someone")[:32]
        text = str(msg.get("text") or "")[:500].replace("§", "")
        self.last[str(p.xuid)] = sender
        p.send_message(f"{PREFIX} §f{sender}§7 (website): §f{text}\n§7Reply with §e/r <message>§7 or §e/dm {sender} <message>")
        try:
            p.play_sound(p.location, "random.orb", 0.6, 1.4)
        except Exception:
            pass

    # ---------- /dm and /r ----------
    def command(self, sender, args):
        if not hasattr(sender, "xuid"):
            return sender.send_message("Only players can send DMs.")
        parts = " ".join(args).strip().split(" ", 1)
        if len(parts) < 2 or not parts[1].strip():
            return sender.send_message("§eUsage: /dm <player> <message>  §7(they see it on galaxymc.us and in game)")
        self.send(sender, parts[0], parts[1].strip())

    def reply(self, sender, args):
        if not hasattr(sender, "xuid"):
            return
        to = self.last.get(str(sender.xuid))
        if not to:
            return sender.send_message("§7Nobody has sent you a DM yet. Use §e/dm <player> <message>§7.")
        text = " ".join(args).strip()
        if not text:
            return sender.send_message(f"§eUsage: /r <message>  §7(replies to {to})")
        self.send(sender, to, text)

    def send(self, sender, to, text):
        mod = getattr(self.plugin, "moderation", None)
        if mod and mod.muted(sender):
            return sender.send_message("§cYou can't send messages while you're muted.")
        body = {"fromXuid": str(sender.xuid), "to": to, "text": text[:500]}

        def done(ok, data):
            if not data.get("ok"):
                return sender.send_message(f"§c{data.get('message') or 'Your message could not be sent. Try again later.'}")
            name = data.get("to") or to
            sender.send_message(f"{PREFIX} §7to §f{name}§7: §f{data.get('text') or text}")
            target = self.online(data.get("toXuid")) if data.get("toXuid") else None
            if target is not None and target is not sender:
                self.last[str(target.xuid)] = sender.name
                target.send_message(f"{PREFIX} §f{sender.name}§7: §f{data.get('text') or text}\n§7Reply with §e/r <message>")
                try:
                    target.play_sound(target.location, "random.orb", 0.6, 1.4)
                except Exception:
                    pass

        if mod:
            mod.web("/api/plugin/dm", body, done)
