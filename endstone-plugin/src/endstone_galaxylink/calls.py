"""Calls in game (2.90): private voice calls with friends, up to 4 people.

    /call <player>       call a friend (the owner can call anyone)
    /call accept         answer (the call itself is on galaxymc.us/voice, on your phone or computer)
    /call decline        say no
    /call add <player>   add a friend to the call you're in
    /call hangup         leave the call

The website runs the call (who's in it, ringing, the line it leaves in your DMs); this file sends what players type
and shows what the website says: a ringing title and sound while someone calls, and short lines in chat.
"""
import time

RING_SECONDS = 30
USAGE = ("§b📞 Calls§r §7(friends only, up to 4 people)\n"
         "§e/call <player>§7 call a friend\n"
         "§e/call accept§7 / §e/call decline§7 answer or say no\n"
         "§e/call add <player>§7 add a friend to your call\n"
         "§e/call hangup§7 leave the call\n"
         "§7You talk on §bgalaxymc.us/voice§7 (on your phone or computer).")


class Calls:
    def __init__(self, plugin):
        self.plugin = plugin
        self.ringing = {}   # xuid -> {"from": name, "id": call id, "until": time}

    def send(self, msg):
        voice = getattr(self.plugin, "_voice", None)
        if voice is not None and getattr(voice, "ws", None):
            voice.send_json(msg)
            return True
        return False

    # ---------- /call ----------
    def command(self, player, args):
        args = " ".join(args or []).split()   # "/call add Steve" arrives as one piece of text
        sub = args[0].lower() if args else ""
        x = str(player.xuid)
        if not sub or sub == "help":
            return player.send_message(USAGE)
        ring = self.ringing.get(x)
        if sub in ("accept", "answer", "yes"):
            msg = {"type": "call_accept", "xuid": x, "id": ring["id"] if ring else None}
            self.ringing.pop(x, None)
        elif sub in ("decline", "deny", "no"):
            msg = {"type": "call_decline", "xuid": x, "id": ring["id"] if ring else None}
            self.ringing.pop(x, None)
        elif sub in ("hangup", "leave", "end", "hang"):
            msg = {"type": "call_leave", "xuid": x}
        elif sub == "add":
            if len(args) < 2:
                return player.send_message("§eUsage: /call add <player>")
            msg = {"type": "call_add", "xuid": x, "to": " ".join(args[1:])[:32]}
        else:
            name = " ".join(args)[:32].strip('"')
            if name.lower() == player.name.lower():
                return player.send_message("§7You can't call yourself.")
            msg = {"type": "call_start", "xuid": x, "to": name}
        if not self.send(msg):
            player.send_message("§cCalls need the website, which isn't connected right now. Please try again in a minute.")

    # ---------- from the website ----------
    def player(self, xuid):
        return next((p for p in self.plugin.server.online_players if str(p.xuid) == str(xuid)), None)

    def on_message(self, msg):
        t = msg.get("type")
        x = str(msg.get("toXuid") or "")
        p = self.player(x)
        if t == "call_ring":
            name = str(msg.get("from") or "Someone")[:32]
            self.ringing[x] = {"from": name, "id": str(msg.get("id") or "")[:16], "until": time.time() + RING_SECONDS}
            if p is None:
                return
            try:
                p.send_title("§b§l📞 Incoming call", f"§f{name} §7is calling you", 5, 60, 10)
            except Exception:
                pass
            p.send_message(f"§b📞 §f{name}§b is calling you. §7Type §a/call accept§7 to answer or §c/call decline§7. "
                           "§7You'll talk on §bgalaxymc.us/voice§7.")
            self.ring_sound(p)
        elif t == "call_ring_end":
            self.ringing.pop(x, None)
        elif t == "call_note" and p is not None:
            p.send_message(str(msg.get("text") or "")[:200])

    @staticmethod
    def ring_sound(p):
        try:
            p.play_sound(p.location, "note.pling", 0.9, 1.6)
            p.play_sound(p.location, "note.pling", 0.7, 1.25)
        except Exception:
            pass

    def tick(self):
        """Every 2 seconds: ring again for players someone is calling (with a reminder above the hotbar)."""
        if not self.ringing:
            return
        now = time.time()
        for x, r in list(self.ringing.items()):
            if now > r["until"]:
                self.ringing.pop(x, None)
                continue
            p = self.player(x)
            if p is None:
                continue
            self.ring_sound(p)
            try:
                p.send_tip(f"§b📞 {r['from']} is calling: §a/call accept §7or §c/call decline")
            except Exception:
                pass

    def on_quit(self, player):
        self.ringing.pop(str(player.xuid), None)
