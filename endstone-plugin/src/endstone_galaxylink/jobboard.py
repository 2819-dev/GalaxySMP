"""#Jobs on galaxymc.us (the job board): players pay other players to gather, build or craft for them.
(Not the same as /jobs, the in-game jobs in jobs.py.)

When a job is posted, the website asks the plugin to take the reward from the poster's balance ("hold").
That works even if the poster is offline (money is saved by xuid). Asking twice for the same job only takes
the money once. Paying the worker, and giving the money back when a job is cancelled, go through the
rewards queue (rewards.py).
"""

from endstone_galaxylink import money


class JobBoard:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        # job id -> True (money taken) / False (an operator: nothing taken)
        self.held = {str(k): bool(v) for k, v in (self.eco.get_config("jobboard_held") or {}).items()}

    def save(self):
        if len(self.held) > 3000:
            for k in sorted(self.held, key=int)[:len(self.held) - 3000]:
                del self.held[k]
        self.eco.set_config("jobboard_held", self.held)

    def online(self, xuid):
        return next((p for p in self.plugin.server.online_players if str(p.xuid) == str(xuid)), None)

    def hold(self, jid, xuid, cents):
        """Takes the reward. Returns (ok, charged, message)."""
        jid = str(int(jid))
        if jid in self.held:
            return True, self.held[jid], None
        cents = int(cents)
        xuid = str(xuid)
        if cents <= 0 or not xuid.isdigit():
            return False, False, "That job isn't valid."
        p = self.online(xuid)
        if p is not None and p.is_op:
            charged = False  # operators have infinite money
        else:
            have = self.eco.get(xuid)
            if not self.eco.take(xuid, cents):
                return False, False, f"You need {money.exact(cents)} to post this job. You have {money.exact(have)}."
            charged = True
        self.held[jid] = charged
        self.save()
        if p is not None:
            p.send_message("§aYour job was posted in §e#Jobs§a on galaxymc.us." + (f" §e{money.exact(cents)}§a is held until it's done." if charged else ""))
        return True, charged, None

    def forget(self, jid, xuid, name, cents):
        """The website never managed to post this job: give the money back if it was taken. Returns True if it was."""
        charged = self.held.pop(str(int(jid)), None)
        self.save()
        if charged and str(xuid).isdigit() and int(cents or 0) > 0:
            self.eco.add(str(xuid), str(name or "")[:32], int(cents))
            return True
        return False

    def from_website(self, msg):
        op = msg.get("op")
        try:
            if op == "hold":
                ok, charged, text = self.hold(msg["id"], msg["xuid"], msg["cents"])
                ans = {"ok": ok, "charged": charged, "message": text}
            elif op == "forget":
                ans = {"ok": True, "refunded": self.forget(msg["id"], msg.get("xuid"), msg.get("name"), msg.get("cents"))}
            else:
                ans = {"ok": False, "message": "Unknown job action."}
        except Exception as e:
            self.plugin.logger.warning(f"Job from the website failed: {e}")
            ans = {"ok": False, "message": "Something went wrong. Nothing was taken."}
        voice = getattr(self.plugin, "_voice", None)
        if voice:
            voice.send_json({"type": "answer", "req": msg.get("req"), **ans})
