"""The join screen: every time you join, a full-screen title screen like Minecraft's own.

  Title screen      the GalaxySMP logo over a panning night landscape, a splash line and big buttons:
                    Play, How to Play, Rules, What's New
  Play              a Featured Servers list: GalaxySMP (and any event "servers" staff add on the website), each
                    with a picture, a description, its activities and how many people are online
  How to Play / Rules / What's New    info pages with tabs on the left

Nobody can get hurt while it's open, and closing it brings back the title screen: you start playing by picking a
server. Brand-new players go to spawn; everyone else carries on where they logged off. An event server can send
players to a warp, to spawn, or to the Minigame Center.

The look comes from the resource pack (ui/server_form.json): titles carry a hidden marker that picks the screen.
Without the pack they're normal Minecraft menus with the same text and buttons.

Staff edit the splash line, the servers and the How to Play tabs on the website (Control Panel > Help menu).
The rules come from the Help menu.

Never change walk_speed here: in Bedrock that also zooms the player's view.
"""

import json
import re
from importlib import resources

from endstone.form import ActionForm

MARK = "§g§s§m§p"
TITLE, SERVERS, PAGE = MARK + "§1", MARK + "§2", MARK + "§3"
PRESETS = ("galaxysmp", "event", "bedwars", "parkour", "build")


def default_welcome():
    return json.loads(resources.files("endstone_galaxylink").joinpath("welcome_default.json").read_text("utf-8"))


def bold(text):
    """**words** -> bold in Minecraft."""
    return re.sub(r"\*\*(.+?)\*\*", lambda m: f"§l{m.group(1)}§r", str(text or ""))


def image_of(server):
    img = str(server.get("image") or "galaxysmp")
    if img.startswith("https://"):
        return img
    return f"textures/ui/gsmp_srv_{img if img in PRESETS else 'galaxysmp'}"


class Welcome:
    def __init__(self, plugin):
        self.plugin = plugin
        self.data = self.fill(plugin.economy.get_config("welcome"))
        self.news = {}            # from the website: {"title": ..., "event": ..., "when": ...}
        self.open = {}            # player uuid -> {"screen": ..., "tab": int, "new": bool, "closes": int, "after": [...]}

    @staticmethod
    def fill(data):
        """Saved settings, with anything missing (from an older version) taken from the built-in ones."""
        base = default_welcome()
        if isinstance(data, dict):
            base.update({k: v for k, v in data.items() if v is not None})
        return base

    # ---------- from the website ----------
    def update_from_website(self, msg):
        if isinstance(msg.get("welcome"), dict):
            self.data = self.fill(msg["welcome"])
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
            if bw is not None and bw.playing(player):   # back into a Bedwars game: no join screen
                return False
        except Exception:
            pass
        self.open[str(player.unique_id)] = {"screen": "title", "tab": 0, "new": bool(brand_new), "closes": 0, "after": []}
        return True

    def on_quit(self, player):
        self.open.pop(str(player.unique_id), None)

    def state(self, player):
        return self.open.get(str(player.unique_id))

    # ---------- screens ----------
    def show(self, player):
        st = self.state(player)
        if st is None:
            return
        {"servers": self.show_servers, "howto": self.show_howto, "rules": self.show_rules, "news": self.show_news}.get(
            st["screen"], self.show_title)(player)

    def go(self, player, screen, tab=0):
        st = self.state(player)
        if st is not None:
            st["screen"], st["tab"] = screen, tab
            self.show(player)

    def send(self, player, form):
        form.on_close = self.closed
        player.send_form(form)

    def show_title(self, player):
        form = ActionForm(title=f"{TITLE}§lGalaxySMP", content=self.data.get("splash") or "")
        form.add_button("§lPlay", on_click=lambda p: self.go(p, "servers"))
        form.add_button("How to Play", on_click=lambda p: self.go(p, "howto"))
        form.add_button("Rules", on_click=lambda p: self.go(p, "rules"))
        form.add_button("What's New", on_click=lambda p: self.go(p, "news"))
        self.send(player, form)

    def servers(self):
        return [s for s in (self.data.get("servers") or []) if s.get("name") and s.get("enabled", True)][:10]

    def server_text(self, s):
        server = self.plugin.server
        if s.get("action") == "soon":
            status = "§eComing soon"
        elif s.get("action", "play") == "play":
            try:
                status = f"§a● {len(server.online_players)}/{int(server.max_players)} online"
            except Exception:
                status = "§a● Online"
        else:
            status = "§d● Event"
        tags = f" §8· §b{s['tags']}" if s.get("tags") else ""
        return f"§l{s['name']}§r\n§7{s.get('description') or ''}\n{status}{tags}"

    def show_servers(self, player):
        form = ActionForm(title=f"{SERVERS}§lFeatured Servers", content="§7Pick a server to start playing.")
        for i, s in enumerate(self.servers()):
            form.add_button(self.server_text(s), icon=image_of(s), on_click=lambda p, i=i: self.pick(p, i))
        if not self.servers():
            form.add_button("§lGalaxySMP§r\n§7Survival\n§a● Online", icon=image_of({}), on_click=self.done)
        self.send(player, form)

    def page(self, player, title, tabs, tab, body):
        form = ActionForm(title=f"{PAGE}§l{title}", content=body)
        for i, label in enumerate(tabs):
            form.add_button(f"§e§l{label}" if i == tab else label,
                            on_click=lambda p, i=i, scr=self.state(player)["screen"]: self.go(p, scr, i))
        self.send(player, form)

    def show_howto(self, player):
        st = self.state(player)
        tabs = [t for t in (self.data.get("tabs") or []) if t.get("title")][:8]
        labels = ["Overview"] + [t["title"] for t in tabs]
        tab = min(st["tab"], len(labels) - 1)
        if tab == 0:
            body = f"§l§fWelcome, {player.name}!§r\n\n{bold(self.data.get('intro'))}"
        else:
            body = f"§l§b{tabs[tab - 1]['title']}§r\n\n{bold(tabs[tab - 1].get('text'))}"
        self.page(player, "How to Play", labels, tab, body)

    def show_rules(self, player):
        st = self.state(player)
        help_data = getattr(getattr(self.plugin, "help", None), "data", None) or {}
        sections = [s for s in (help_data.get("rules") or []) if s.get("title")][:10]
        if not sections:
            return self.page(player, "Rules", ["Rules"], 0, "§7Full rules: §bgalaxymc.us/rules")
        tab = min(st["tab"], len(sections) - 1)
        sec = sections[tab]
        lines = [f"§l§6{sec['title']}§r", ""] + [f"§7•§r {bold(x)}" for x in sec.get("items") or []]
        lines += ["", "§7Full rules: §bgalaxymc.us/rules"]
        self.page(player, "Rules", [re.sub(r"^\d+\.\s*", "", s["title"]) for s in sections], tab, "\n".join(lines))

    def show_news(self, player):
        server = self.plugin.server
        lines = ["§l§dWhat's New§r", ""]
        if self.news.get("title"):
            lines.append(f"§fLatest update: §l{self.news['title']}")
        if self.news.get("event"):
            lines.append(f"§fNext event: §b{self.news['event']}" + (f" §7({self.news['when']})" if self.news.get("when") else ""))
        if len(lines) == 2:
            lines.append("§7No news right now.")
        try:
            lines += ["", f"§a● {len(server.online_players)}§7/{int(server.max_players)} players online"]
        except Exception:
            pass
        try:
            lines.append(f"§eYour money: §f{self.plugin.economy.balance_text(player)}")
        except Exception:
            pass
        lines += ["", "§7Read everything on §bgalaxymc.us§7: news, events, chat and voice."]
        self.page(player, "What's New", ["What's New"], 0, "\n".join(lines))

    def closed(self, player):
        """Closed (Back, or the game was still loading): back to the title screen."""
        st = self.state(player)
        if st is None:
            return
        st["closes"] += 1
        delay = 2 if st["screen"] != "title" else (20 if st["closes"] < 5 else 60)
        st["screen"], st["tab"] = "title", 0
        from endstone_galaxylink.safety import later
        later(self.plugin, player, self.show, delay)

    # ---------- playing ----------
    def pick(self, player, i):
        servers = self.servers()
        if i >= len(servers):
            return self.done(player)
        s = servers[i]
        action = s.get("action") or "play"
        if action == "soon":
            try:
                player.send_toast("§eComing soon", f"{s['name']} isn't open yet.")
            except Exception:
                pass
            return self.show_servers(player)
        if action == "warp":
            warps = getattr(self.plugin, "warps", None)
            w = warps.find(s.get("warp") or "") if warps is not None else None
            if w is None:
                try:
                    player.send_toast("§cNot available", f"{s['name']} isn't open right now.")
                except Exception:
                    pass
                return self.show_servers(player)
            self.done(player, spot=w["spot"], label=s["name"])
        elif action == "spawn":
            self.done(player, spot=self.plugin.economy.get_config("spawn"), label=s["name"])
        elif action == "minigames":
            self.done(player, label=s["name"])
            mg = getattr(self.plugin, "minigames", None)
            if mg is not None:
                from endstone_galaxylink.safety import later
                later(self.plugin, player, mg.open, 10)
        else:
            self.done(player)

    def done(self, player, spot=None, label=None):
        st = self.open.pop(str(player.unique_id), None)
        if st is None:
            return
        if spot is None and st["new"]:
            spot = self.plugin.economy.get_config("spawn")   # brand-new players start at spawn
        tp = getattr(self.plugin, "teleports", None)
        if spot and tp is not None:
            try:
                player.teleport(tp.location(spot))
            except Exception as e:
                self.plugin.logger.warning(f"Join screen: couldn't move {player.name}: {e}")
        try:
            player.play_sound(player.location, "random.levelup", 0.6, 1.2)
        except Exception:
            pass
        player.send_message(f"§d✦ §fWelcome to {label or 'GalaxySMP'}! §7Type §e/guide§7 any time for help.")
        for fn in st.get("after", []):
            try:
                fn(player)
            except Exception as e:
                self.plugin.logger.warning(f"Join screen: after-join step failed: {e}")

    def after(self, player, fn):
        """Runs fn(player) once they start playing (or right away when there's no join screen)."""
        st = self.state(player)
        if st is None:
            fn(player)
        else:
            st["after"].append(fn)

    # ---------- while it's open ----------
    def on_damage(self, event):
        """Nobody gets hurt while the join screen is open."""
        try:
            if str(event.actor.unique_id) in self.open:
                event.is_cancelled = True
                return True
        except Exception:
            pass
        return False

    def keep_frozen(self, player):
        return False   # menus already stop players from moving; walk_speed is never touched
