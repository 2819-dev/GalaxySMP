"""Small helpers that keep the server from crashing: only touch blocks in loaded chunks, and never keep
using a player object after that player left."""

import time

_cache = {}   # dimension name -> (time, {(cx, cz)})


def loaded_chunks(dim, max_age=2.0):
    """{(cx, cz)} of the chunks this dimension has loaded (remembered for a couple of seconds)."""
    key = dim.name
    hit = _cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < max_age:
        return hit[1]
    out = set()
    for c in dim.loaded_chunks:
        try:
            out.add((c.x, c.z))
        except Exception:
            continue
    _cache[key] = (now, out)
    return out


def area_loaded(dim, x1, z1, x2, z2, max_age=2.0):
    """True when every chunk of this box is loaded (so its blocks can be read or changed safely)."""
    have = loaded_chunks(dim, max_age)
    for cx in range(int(min(x1, x2)) >> 4, (int(max(x1, x2)) >> 4) + 1):
        for cz in range(int(min(z1, z2)) >> 4, (int(max(z1, z2)) >> 4) + 1):
            if (cx, cz) not in have:
                return False
    return True


def alive(plugin, player_or_uid):
    """The online player (fresh object) for a player or a unique id, or None if they left."""
    try:
        uid = getattr(player_or_uid, "unique_id", player_or_uid)
        p = plugin.server.get_player(uid)
        return p if p is not None and getattr(p, "is_valid", True) else None
    except Exception:
        return None


def later(plugin, player, fn, delay):
    """Runs fn(player) after `delay` ticks, with a fresh player object, only if they're still online."""
    uid = player.unique_id

    def run():
        p = alive(plugin, uid)
        if p is not None:
            fn(p)
    plugin.server.scheduler.run_task(plugin, run, delay=delay)


_quiet_senders = {}


def run_cmd(plugin, line):
    """Runs a console command. Clean-up commands (kill @e[...]) often match nothing, which Minecraft reports as an
    error ("No targets matched selector"); those run quietly so they don't fill the console and the error log."""
    server = plugin.server
    sender = server.command_sender
    if " kill @e" in f" {line}" or line.startswith("kill @e"):
        sender = _quiet_senders.get(id(server))
        if sender is None:
            try:
                from endstone.command import CommandSenderWrapper
                sender = CommandSenderWrapper(server.command_sender, on_message=lambda m: None, on_error=lambda m: None)
            except Exception:
                sender = server.command_sender
            _quiet_senders[id(server)] = sender
    return server.dispatch_command(sender, line)
