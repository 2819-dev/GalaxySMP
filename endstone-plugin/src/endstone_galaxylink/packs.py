"""Item packs: bundles of useful items given as rewards (daily reward, quests, achievements, the Season Pass,
Friend Streaks...) and sold in the Store. The list lives in packs.json (the website reads the same file).

Packs for a player who isn't online are saved and given the next time they join.
"""

import json
import os

from endstone_galaxylink import money

with open(os.path.join(os.path.dirname(__file__), "packs.json"), encoding="utf-8") as f:
    PACKS = json.load(f)


def name(pack_id, n=1):
    p = PACKS.get(pack_id)
    label = p["name"] if p else pack_id
    return f"{n} × {label}" if n > 1 else label


class Packs:
    def __init__(self, plugin):
        self.plugin = plugin
        self.owed = dict(plugin.economy.get_config("packs_owed") or {})  # xuid -> {pack: count}

    def save(self):
        self.plugin.economy.set_config("packs_owed", self.owed)

    def online(self, xuid):
        return next((p for p in self.plugin.server.online_players if str(p.xuid) == str(xuid)), None)

    def give(self, xuid, packs):
        """Give packs ({id: count}) now if the player is online, otherwise when they next join."""
        packs = {k: max(0, min(20, int(v or 0))) for k, v in (packs or {}).items() if k in PACKS}
        packs = {k: v for k, v in packs.items() if v}
        if not packs:
            return
        player = self.online(xuid)
        if player is None:
            mine = self.owed.setdefault(str(xuid), {})
            for k, v in packs.items():
                mine[k] = min(50, mine.get(k, 0) + v)
            self.save()
            return
        self.hand_over(player, packs)

    def hand_over(self, player, packs):
        dropped = 0
        for pack_id, n in packs.items():
            for _ in range(n):
                for item, count in PACKS[pack_id]["items"]:
                    try:
                        dropped += money.give(player, money.make_stacks(item, count))
                    except Exception as e:
                        self.plugin.logger.warning(f"Pack item {item} couldn't be given: {e}")
        player.send_message("§6§lPack opened: §r§f" + "§7, §f".join(name(k, n) for k, n in packs.items()) + "§7 (check your inventory)."
                            + ("§e Your inventory was full, so some items are on the ground next to you." if dropped else ""))
        try:
            player.play_sound(player.location, "random.levelup", 0.7, 1.4)
        except Exception:
            pass

    def on_join(self, player):
        mine = self.owed.pop(str(player.xuid), None)
        if not mine:
            return
        self.save()
        xuid = str(player.xuid)  # look the player up again later: never keep the player object across ticks

        def later():
            p = self.online(xuid)
            if p is None:
                self.give(xuid, mine)  # left already: keep them for next time
            else:
                self.hand_over(p, mine)
        self.plugin.server.scheduler.run_task(self.plugin, later, delay=60)
