"""Mail on the Main Menu: your website DMs and notifications (friend requests, party invites, staff replies, rewards...).

The website keeps them (galaxymc.us); the plugin asks for a player's latest ones in the background and keeps a copy
while they're online. Reply sends a DM like /dm does.
"""

import threading


class Mail:
    def __init__(self, plugin):
        self.plugin = plugin
        self.box = {}   # player uuid -> {"linked", "threads": [...], "notifications": [...], "unread": n}

    def _bg(self, fn, done):
        def run():
            try:
                res = fn()
                if isinstance(res, tuple):   # plugin._request gives (status, data)
                    status, data = res
                    res = data if isinstance(data, dict) and status == 200 else {"ok": False}
            except Exception:
                res = {"ok": False}
            self.plugin.server.scheduler.run_task(self.plugin, lambda: done(res))
        threading.Thread(target=run, daemon=True).start()

    def refresh(self, player, then=None, mark_read=False):
        uid = str(player.unique_id)

        def done(res):
            if res and res.get("ok"):
                self.box[uid] = {"linked": bool(res.get("linked")), "threads": res.get("threads") or [],
                                 "notifications": res.get("notifications") or [], "unread": int(res.get("unread") or 0)}
            if then:
                then()
        self._bg(lambda: self.plugin._request("/api/plugin/mail", {"uuid": uid, "markRead": bool(mark_read)}), done)

    def of(self, player):
        return self.box.get(str(player.unique_id))

    def unread(self, player):
        b = self.of(player)
        return int(b.get("unread") or 0) if b else 0

    def on_join(self, player):
        def redraw():
            social = getattr(self.plugin, "social", None)
            if self.unread(player) and social is not None:
                social.redraw_title(player)   # shows the unread count on the Mail button
        self.refresh(player, then=redraw)

    def on_quit(self, player):
        self.box.pop(str(player.unique_id), None)

    def thread(self, player, thread_id, then):
        """The last messages of one conversation (then(messages)); opening it marks it read."""
        uid = str(player.unique_id)

        def done(res):
            msgs = res.get("messages") if res and res.get("ok") else [{"from": "", "mine": False, "body": "§cCouldn't load this conversation."}]
            b = self.box.get(uid)
            if b:
                for t in b.get("threads") or []:
                    if t.get("id") == thread_id and t.get("unread"):
                        t["unread"] = 0
                        b["unread"] = max(0, int(b.get("unread") or 0) - 1)
            then(msgs or [])
        self._bg(lambda: self.plugin._request("/api/plugin/mail/thread", {"uuid": uid, "id": int(thread_id)}), done)
