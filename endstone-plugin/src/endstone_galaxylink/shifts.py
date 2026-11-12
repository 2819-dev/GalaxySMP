"""/shift: staff clock in and out from in game (same shifts as Community > #Shifts on galaxymc.us)."""

ACTIONS = {"on": "start", "start": "start", "in": "start", "break": "break", "pause": "break", "back": "resume", "resume": "resume",
           "off": "end", "end": "end", "out": "end", "status": "status", "": "status"}


class Shifts:
    def __init__(self, plugin):
        self.plugin = plugin

    def command(self, player, args):
        what = (args[0] if args else "").lower()
        action = ACTIONS.get(what)
        if action is None:
            return player.send_message("§7Use §e/shift on§7, §e/shift break§7, §e/shift back§7, §e/shift off§7 or §e/shift status§7.")

        def done(ok, data):
            msg = str((data or {}).get("message") or ("Done." if ok else "The website couldn't be reached. Try again in a moment."))
            player.send_message(("§a" if ok else "§c") + msg)
        self.plugin.moderation.web("/api/plugin/shift", {"xuid": str(player.xuid), "action": action}, done)
