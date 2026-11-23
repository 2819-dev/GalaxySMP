"""The welcome screen: a full-screen menu every time you join.

It shows the GalaxySMP logo, the website, some live info (players online, your money, the latest news and the next
event) and tabs that explain the basics. Players can't move or get hurt until they press Continue. Brand-new players
then go to spawn; everyone else carries on where they logged off.

The look comes from the resource pack (ui/server_form.json): a menu whose title has the hidden marker §g§s§m§p fills
the whole screen. Without the pack it's a normal Minecraft menu with the same text.

Admins edit the text on the website (Control Panel > Help menu > Welcome screen).
"""

import json
import re
from importlib import resources

from endstone.form import ActionForm

MARKER = "§g§s§m§p"       # tells the resource pack to draw the full-screen welcome screen
FROZEN_SPEED = 0.0


def default_welcome():
    return json.loads(resources.files("endstone_galaxylink").joinpath("welcome_default.json").read_text("utf-8"))


def bold(text):
    """**words** -> bold in Minecraft."""
    return re.sub(r"\*\*(.+?)\*\*", lambda m: f"§l{m.group(1)}§r", text)


class Welcome:
    def __init__(self, plugin):
        self.plugin = plugin
        self.data = plugin.economy.get_config("welcome") or default_welcome()
        self.news = {}            # from the website: {"title": ..., "event": ..., "when": ...}
        self.open = {}            # player uuid -> {"tab": int, "new": bool, "closes": int}

    # ---------- from the website ----------
    def update_from_website(self, msg):
        if isinstance(msg.get("welcome"), dict):
            self.data = msg["welcome"]
            self.plugin.economy.set_config("welcome", self.data)
        if isinstance(msg.get("news"), dict):
            self.news = msg["news"]

    # ---------- join ----------
    def enabled(self):
        return bool(self.data.get("enabled", True))

    def waiting(self, player):
        return str(player.unique_id) in self.open

    def on_join(self, player, brand_new):
        if not self.enabled():
            return False
        bw = getattr(self.plugin, "bedwars", None)
        try:
            if bw is not None and bw.playing(player):   # back into a Bedwars game: no welcome screen
                return False
        except Exception:
            pass
        self.open[str(player.unique_id)] = {"tab": 0, "new": bool(brand_new), "closes": 0}
        self.freeze(player)
        return True

    def freeze(self, player):
        try:
            player.walk_speed = FROZEN_SPEED
        except Exception:
            pass

    def on_quit(self, player):
        self.open.pop(str(player.unique_id), None)

    # ---------- the screen ----------
    def tabs(self):
        return [t for t in (self.data.get("tabs") or []) if t.get("title")][:8]

    def live(self, player):
        server = self.plugin.server
        lines = []
        try:
            lines.append(f"§a● §f{len(server.online_players)}§7/{int(server.max_players)} online")
        except Exception:
            pass
        try:
            lines.append(f"§eMoney: §f{self.plugin.economy.balance_text(player)}")
        except Exception:
            pass
        if self.news.get("title"):
            lines.append(f"§dNews: §f{self.news['title']}")
        if self.news.get("event"):
            lines.append(f"§bNext event: §f{self.news['event']}" + (f" §7({self.news['when']})" if self.news.get("when") else ""))
        return "   ".join(lines[:2]) + ("\n" + "\n".join(lines[2:]) if len(lines) > 2 else "")

    def show(self, player):
        st = self.open.get(str(player.unique_id))
        if st is None:
            return
        tabs = self.tabs()
        tab = st["tab"]
        name = player.name
        if tab == 0:
            body = f"§l§fWelcome, {name}!§r\n\n{bold(self.data.get('intro') or '')}"
        else:
            t = tabs[tab - 1]
            body = f"§l§b{t['title']}§r\n\n{bold(t.get('text') or '')}"
        content = f"{self.live(player)}\n\n§r{body}"
        form = ActionForm(title=f"{MARKER}§lWelcome to GalaxySMP", content=content)
        labels = ["Welcome"] + [t["title"] for t in tabs]
        for i, label in enumerate(labels):
            text = f"§b§l> {label}" if i == tab else f"§f{label}"
            form.add_button(text, on_click=lambda p, i=i: self.go_tab(p, i))
        form.add_button("§a§lContinue", on_click=self.done)
        form.on_close = self.closed
        player.send_form(form)

    def go_tab(self, player, i):
        st = self.open.get(str(player.unique_id))
        if st is not None:
            st["tab"] = i
            self.show(player)

    def closed(self, player):
        """Closed without Continue (back button, or the game was still loading): show it again shortly."""
        st = self.open.get(str(player.unique_id))
        if st is None:
            return
        st["closes"] += 1
        from endstone_galaxylink.safety import later
        later(self.plugin, player, self.show, 20 if st["closes"] < 5 else 60)

    def done(self, player):
        st = self.open.pop(str(player.unique_id), None)
        if st is None:
            return
        pg = getattr(self.plugin, "penguins", None)
        try:
            if pg is not None:
                pg.apply_body(player, pg.perks(player))   # normal speed again (or a chip power's speed)
            else:
                player.walk_speed = 0.1
        except Exception:
            pass
        if st["new"]:
            tp = getattr(self.plugin, "teleports", None)
            spot = self.plugin.economy.get_config("spawn")
            if tp is not None and spot:
                try:
                    player.teleport(tp.location(spot))
                except Exception as e:
                    self.plugin.logger.warning(f"Welcome: couldn't send {player.name} to spawn: {e}")
        try:
            player.play_sound(player.location, "random.levelup", 0.6, 1.2)
        except Exception:
            pass
        player.send_message("§d✦ §fHave fun on GalaxySMP! §7Type §e/guide§7 any time for help.")
        for fn in st.get("after", []):
            try:
                fn(player)
            except Exception as e:
                self.plugin.logger.warning(f"Welcome: after-join step failed: {e}")

    def after(self, player, fn):
        """Runs fn(player) once they press Continue (or right away when there's no welcome screen)."""
        st = self.open.get(str(player.unique_id))
        if st is None:
            fn(player)
        else:
            st.setdefault("after", []).append(fn)

    # ---------- while it's open ----------
    def on_damage(self, event):
        """Nobody gets hurt while the welcome screen is open."""
        try:
            if str(event.actor.unique_id) in self.open:
                event.is_cancelled = True
                return True
        except Exception:
            pass
        return False

    def keep_frozen(self, player):
        """Called by the chip powers' speed code: the welcome screen keeps you still."""
        return str(player.unique_id) in self.open
