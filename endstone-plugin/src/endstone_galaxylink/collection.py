"""Item collection book: every kind of item a player has ever had in their inventory.

Once a minute the inventories of online players are checked; new item types are saved here and sent to the
website, which shows the collection on the player's profile (how many of all the items in the game, and which).
Achievements: collect 100, 250 and 500 different items.
"""

from endstone_galaxylink import money

SCAN_TICKS = 20 * 60


class Collection:
    def __init__(self, plugin):
        self.plugin = plugin
        self.db = plugin.economy.db
        self.db.execute("CREATE TABLE IF NOT EXISTS collection (xuid TEXT, item TEXT, at REAL, PRIMARY KEY (xuid, item))")
        self.db.commit()
        self.seen = {}   # xuid -> set of item ids (online players only)

    def load(self, xuid):
        s = self.seen.get(xuid)
        if s is None:
            s = {r[0] for r in self.db.execute("SELECT item FROM collection WHERE xuid = ?", (xuid,)).fetchall()}
            self.seen[xuid] = s
        return s

    def scan(self):
        import time
        bw = getattr(self.plugin, "bedwars", None)
        bc = getattr(self.plugin, "buildcontest", None)
        voice = getattr(self.plugin, "_voice", None)
        prog = getattr(self.plugin, "progress", None)
        for p in self.plugin.server.online_players:
            try:
                if (bw is not None and bw.playing(p)) or (bc is not None and bc.building(p)) or p.game_mode.name.lower() == "creative":
                    continue   # Bedwars kits, Build Contest and Creative items don't count
                xuid = str(p.xuid)
                have = self.load(xuid)
                inv = p.inventory
                new = set()
                for i in range(inv.size):
                    s = inv.get_item(i)
                    if s is not None and s.amount:
                        iid = money.item_id(s)
                        if iid not in have:
                            new.add(iid)
            except Exception:
                continue
            if not new:
                continue
            now = time.time()
            self.db.executemany("INSERT OR IGNORE INTO collection (xuid, item, at) VALUES (?, ?, ?)", [(xuid, it, now) for it in new])
            self.db.commit()
            have |= new
            if prog is not None:
                prog.bump(xuid, "collection", len(have), most=True, name=p.name)
                try:
                    prog.check_achievements(p)
                except Exception:
                    pass
            if voice is not None and getattr(voice, "ws", None):
                voice.send_json({"type": "collection", "xuid": xuid, "items": sorted(new)[:200]})

    def on_quit(self, player):
        self.seen.pop(str(player.xuid), None)

    def resend(self, voice):
        """After the website connection comes back: send everything collected (the website ignores what it has)."""
        rows = self.db.execute("SELECT xuid, item FROM collection").fetchall()
        by = {}
        for x, it in rows:
            by.setdefault(x, []).append(it)
        for x, items in by.items():
            for i in range(0, len(items), 200):
                voice.send_json({"type": "collection", "xuid": x, "items": items[i:i + 200]})
