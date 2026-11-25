"""Feel & effects (2.88): small sounds and particles that make the good moments feel good.

    fx.teleport(plugin, player)       a soft whoosh and sparkles where you arrive
    fx.purchase(plugin, player)       a coin "ding" and green sparkles when you buy something
    fx.reward(plugin, player)         chime + rising sparkles (daily reward, season pass, goals, crate prizes)
    fx.achievement(plugin, player)    a fanfare and a burst of totem sparkles
    fx.level_up(plugin, player)       level-up sound and sparkles (job levels)
    fx.money(plugin, player)          a quiet coin sound when someone pays you
    fx.error(plugin, player)          a short low "nope" for things that didn't work

Players can switch the particles off in Settings (sounds stay). Everything here is cosmetic and never raises.
"""
import random

_quiet = {}


def _run(plugin, command):
    """Runs a command without printing anything in the console."""
    server = plugin.server
    sender = _quiet.get(id(server))
    if sender is None:
        try:
            from endstone.command import CommandSenderWrapper
            sender = CommandSenderWrapper(server.command_sender, on_message=lambda m: None, on_error=lambda m: None)
        except Exception:
            sender = server.command_sender
        _quiet[id(server)] = sender
    try:
        server.dispatch_command(sender, command)
    except Exception:
        pass


def _sound(player, name, volume=0.8, pitch=1.0):
    try:
        player.play_sound(player.location, name, volume, pitch)
    except Exception:
        pass


def _wants_particles(plugin, player):
    welcome = getattr(plugin, "welcome", None)
    try:
        return welcome is None or welcome.prefs(player).get("fx", True)
    except Exception:
        return True


def _particles(plugin, player, name, count=6, spread=0.6, height=(0.4, 1.8)):
    if not _wants_particles(plugin, player):
        return
    who = player.name.replace('"', "")
    for _ in range(count):
        dx, dz = random.uniform(-spread, spread), random.uniform(-spread, spread)
        dy = random.uniform(*height)
        _run(plugin, f'execute at "{who}" run particle {name} ~{dx:.2f} ~{dy:.2f} ~{dz:.2f}')


def teleport(plugin, player):
    _sound(player, "mob.endermen.portal", 0.5, 1.3)
    _particles(plugin, player, "minecraft:obsidian_glow_dust_particle", 10, 0.7, (0.1, 2.0))


def purchase(plugin, player):
    _sound(player, "random.orb", 0.7, 1.5)
    _sound(player, "note.pling", 0.4, 1.8)
    _particles(plugin, player, "minecraft:villager_happy", 6, 0.5, (0.8, 1.8))


def reward(plugin, player):
    _sound(player, "note.chime", 0.6, 1.2)
    _sound(player, "random.orb", 0.5, 1.0)
    _particles(plugin, player, "minecraft:totem_particle", 8, 0.5, (0.2, 1.6))


def achievement(plugin, player):
    _sound(player, "random.toast", 0.9, 1.0)
    _sound(player, "random.levelup", 0.5, 1.4)
    _particles(plugin, player, "minecraft:totem_particle", 14, 0.7, (0.2, 2.0))


def level_up(plugin, player):
    _sound(player, "random.levelup", 0.7, 1.0)
    _particles(plugin, player, "minecraft:villager_happy", 10, 0.6, (0.3, 2.0))


def money(plugin, player):
    _sound(player, "random.orb", 0.5, 1.2)


def error(plugin, player):
    _sound(player, "note.bass", 0.6, 0.7)
