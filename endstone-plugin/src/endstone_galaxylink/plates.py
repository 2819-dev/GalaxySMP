"""Command plates: a pressure plate that runs a command for whoever steps on it (e.g. /guide or /spawn).

Staff (operators) stand on a pressure plate and type:
  /plate guide          -> stepping on this plate opens /guide for that player
  /plate spawn          -> ...runs /spawn as that player (any command works, without the /)
  /plate remove         -> this plate goes back to normal
  /plate list           -> every command plate

The command runs as the player who stepped on it, with their own permissions, once per step.
Endstone has no "stepped on a pressure plate" event, so a few times a second the plugin checks where online
players are standing (cheap: it only compares positions with the saved plates). Breaking the plate removes it.
"""

import math
import time

CHECK_TICKS = 4          # 5 times a second
COOLDOWN = 2.0           # seconds before the same player can trigger the same plate again


def key_of(dim, x, y, z):
    return f"{dim}:{x}:{y}:{z}"


class Plates:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.plates = self.eco.get_config("command_plates") or {}   # key -> {"cmd": "guide", "by": name}
        self.on = {}      # player uuid -> plate key they're standing on (so it runs once per step)
        self.last = {}    # (uuid, key) -> when it last ran

    def save(self):
        self.eco.set_config("command_plates", self.plates)

    @staticmethod
    def feet(player):
        l = player.location
        return player.dimension.name, math.floor(l.x), math.floor(l.y), math.floor(l.z)

    # ---------- /plate ----------
    def command(self, player, args):
        if not args or args[0].lower() == "list" and len(args) == 1:
            if not self.plates:
                player.send_message("§7No command plates yet. Stand on a pressure plate and type §e/plate guide§7 (or any command).")
                return
            lines = [f"§e/{v['cmd']} §7at {k.split(':', 1)[1].replace(':', ' ')} ({k.split(':')[0]})" for k, v in self.plates.items()]
            player.send_message("§bCommand plates:\n" + "\n".join(lines[:30]))
            return
        dim, x, y, z = self.feet(player)
        key = key_of(dim, x, y, z)
        if args[0].lower() == "remove":
            if self.plates.pop(key, None) is None:
                player.send_message("§cThe plate you're standing on isn't a command plate.")
                return
            self.save()
            player.send_message("§aThis pressure plate is back to normal.")
            return
        try:
            block = player.dimension.get_block_at(x, y, z)
            is_plate = "pressure_plate" in str(block.type)
        except Exception:
            is_plate = False
        if not is_plate:
            player.send_message("§cStand on a pressure plate first, then type §e/plate <command>§c, for example §e/plate guide§c.")
            return
        cmd = " ".join(args).strip().lstrip("/")[:200]
        if cmd.split(" ")[0].lower() in ("plate", "op", "deop", "stop", "reload"):
            player.send_message("§cThat command can't go on a plate.")
            return
        self.plates[key] = {"cmd": cmd, "by": player.name}
        self.save()
        self.on[str(player.unique_id)] = key   # don't fire for you right away
        player.send_message(f"§aDone! Stepping on this pressure plate now runs §e/{cmd}§a for that player. §7(/plate remove to undo)")

    # ---------- stepping on one ----------
    def tick(self):
        if not self.plates:
            return
        now = time.time()
        for p in self.plugin.server.online_players:
            try:
                uid = str(p.unique_id)
                key = key_of(*self.feet(p))
            except Exception:
                continue
            if self.on.get(uid) == key:
                continue   # still standing on it: once per step
            self.on[uid] = key
            plate = self.plates.get(key)
            if plate is None or now - self.last.get((uid, key), 0) < COOLDOWN:
                continue
            self.last[(uid, key)] = now
            tp = getattr(self.plugin, "teleports", None)
            if tp is not None:   # teleports from a plate skip the 3-second "don't move" wait
                if not hasattr(tp, "plate_at"):
                    tp.plate_at = {}
                tp.plate_at[uid] = now
            try:
                p.perform_command(plate["cmd"])
            except Exception as e:
                self.plugin.logger.warning(f"Command plate /{plate['cmd']} failed for {p.name}: {e}")

    def on_quit(self, player):
        uid = str(player.unique_id)
        self.on.pop(uid, None)
        self.last = {k: v for k, v in self.last.items() if k[0] != uid}

    def on_break(self, event):
        """Breaking a command plate removes it."""
        try:
            b = event.block
            key = key_of(b.dimension.name, b.x, b.y, b.z)
        except Exception:
            return
        if key in self.plates and not event.player.is_op:
            event.is_cancelled = True
            return
        if key in self.plates:
            self.plates.pop(key, None)
            self.save()
            try:
                event.player.send_message("§7That was a command plate; it's removed now.")
            except Exception:
                pass
