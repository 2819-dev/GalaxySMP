"""AFK: players who don't move, chat or use a command for 3 minutes are marked AFK (or use /afk to switch it).

While AFK:
  - everyone is told once ("Steve is AFK"), and the player sees a small reminder;
  - the website's "who's online" list shows them as AFK;
  - AFK time doesn't count as playtime, so it doesn't earn playtime quests, achievements or Season Pass XP.
Moving, chatting or using a command brings them back.

Only names (xuids) and positions are kept between checks, never the player objects.
"""

import time

IDLE_SECONDS = 180
CHECK_TICKS = 100  # every 5 seconds


class Afk:
    def __init__(self, plugin):
        self.plugin = plugin
        self.last = {}      # xuid -> (x, y, z, yaw, pitch) last time we looked
        self.active = {}    # xuid -> time of the last activity
        self.afk = set()    # xuids that are AFK right now
        self.manual = set() # xuids that used /afk (they stay AFK until they move away)

    def is_afk(self, player):
        return str(player.xuid) in self.afk

    @staticmethod
    def spot(p):
        loc = p.location
        return (round(loc.x, 1), round(loc.y, 1), round(loc.z, 1), round(loc.yaw), round(loc.pitch))

    def tick(self):
        now = time.time()
        online = set()
        for p in self.plugin.server.online_players:
            x = str(p.xuid)
            online.add(x)
            try:
                here = self.spot(p)
            except Exception:
                continue
            before = self.last.get(x)
            self.last[x] = here
            if before is None:
                self.active[x] = now
                continue
            moved = before[:3] != here[:3] and _dist(before, here) > 0.6 or before[3:] != here[3:]
            if moved:
                if x in self.manual and _dist(before, here) < 3:
                    continue  # small nudges don't cancel /afk
                self.activity(p)
            elif x not in self.afk and now - self.active.get(x, now) >= IDLE_SECONDS:
                self.set_afk(p, True, auto=True)
        for x in list(self.last):
            if x not in online:
                self.last.pop(x, None)
                self.active.pop(x, None)
                self.afk.discard(x)
                self.manual.discard(x)

    def activity(self, player):
        x = str(player.xuid)
        self.active[x] = time.time()
        if x in self.afk:
            self.set_afk(player, False)

    def set_afk(self, player, on, auto=False):
        x = str(player.xuid)
        if on == (x in self.afk):
            return
        if on:
            self.afk.add(x)
            if not auto:
                self.manual.add(x)
            text = f"§7{player.name} is now AFK."
            player.send_message("§7You're AFK" + (" (you haven't moved for 3 minutes)" if auto else "") +
                                ". AFK time doesn't count as playtime. Move, chat or type /afk to come back.")
        else:
            self.afk.discard(x)
            self.manual.discard(x)
            self.active[x] = time.time()
            text = f"§7{player.name} is no longer AFK."
            player.send_message("§aWelcome back! §7You're no longer AFK.")
        for p in self.plugin.server.online_players:
            if p is not player:
                p.send_message(text)

    def command(self, player):
        self.set_afk(player, not self.is_afk(player))


def _dist(a, b):
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5
