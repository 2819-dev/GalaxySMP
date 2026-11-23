"""The GalaxySMP Main Menu: a full-screen title screen every time you join (and from /menu, the menu compass in the last
hotbar slot, or Main Menu in /guide).

  Title screen       a 3D scene (a different one each join), the GalaxySMP logo, a random splash line, your character,
                     and Play, How to Play, Rules, What's New and Store. Minecraft's menu music plays while it's open.
  Featured Servers   the server list on the left; the selected server (the first one to start with) in a sidebar:
                     its banner, ping and players next to a Join Server button, then its name, description and activities
  Joining            the server's block (grass, diamond, lava...) shakes, cracks and bursts, then its name glows in
  How to Play / Rules / What's New / Store    pages with tabs

Nobody can get hurt while it's open; closing it (Back) goes back to the title screen. Brand-new players start at spawn,
everyone else carries on where they logged off. Event servers send players to a warp, spawn or the Minigame Center.

The look comes from the resource pack (ui/server_form.json): hidden codes in the title pick the screen (§1-§4), the
background scene (§o§N) and the joining block (§m§N). Without the pack these are normal Minecraft menus.

Staff edit the splash lines, the servers (name, picture, activities, joining block, name shown while joining) and the
How to Play tabs on the website (Control Panel > Help menu > Join screen). Never change walk_speed here: in Bedrock that
also zooms the player's view.
"""

import json
import random
import re
from importlib import resources

from endstone.form import ActionForm

MARK = "§g§s§m§p"
TITLE, SERVERS, PAGE, JOINING = MARK + "§1", MARK + "§2", MARK + "§3", MARK + "§4"
SCENES = ["valley", "trials", "deepdark", "lush", "nether", "end", "sift"]
THEMES = ["grass", "diamond", "gold", "emerald", "netherite", "amethyst", "lava", "ice", "galaxy", "ender", "rainbow"]
THEME_CODE = "0123456789a"
THEME_COLOR = {"grass": "§a", "diamond": "§b", "gold": "§6", "emerald": "§a", "netherite": "§d", "amethyst": "§d", "lava": "§6",
               "ice": "§b", "galaxy": "§5", "ender": "§3", "rainbow": "§e"}
PRESETS = ("galaxysmp", "event", "bedwars", "parkour", "build")
MENU_ITEM = "galaxysmp:menu"
JOIN_TICKS = 50          # the joining animation (about 2.5 seconds)

# small icons from the resource pack (glyph_F7.png)
PING = ["", "", "", ""]
PLAYERS = ""
ACTIVITY_ICONS = [("surviv", ""), ("pvp", ""), ("fight", ""), ("combat", ""), ("bedwar", ""),
                  ("minigame", ""), ("build", ""), ("creative", ""), ("event", ""), ("parkour", ""),
                  ("plot", ""), ("job", ""), ("econom", ""), ("shop", ""), ("trad", "")]


def default_welcome():
    return json.loads(resources.files("endstone_galaxylink").joinpath("welcome_default.json").read_text("utf-8"))


def plans_info():
    try:
        return json.loads(resources.files("endstone_galaxylink").joinpath("plans.json").read_text("utf-8"))
    except Exception:
        return {}


def bold(text):
    """**words** -> bold in Minecraft."""
    return re.sub(r"\*\*(.+?)\*\*", lambda m: f"§l{m.group(1)}§r", str(text or ""))


def image_of(server):
    img = str(server.get("image") or "galaxysmp")
    if img.startswith("https://"):
        return img
    return f"textures/ui/gsmp_srv_{img if img in PRESETS else 'galaxysmp'}"


def activity_icon(name):
    n = name.lower()
    return next((ic for key, ic in ACTIVITY_ICONS if key in n), "")


def ping_icon(ms):
    return PING[0 if ms < 80 else 1 if ms < 150 else 2 if ms < 250 else 3]


def roll_theme(rnd=random):
    """The website's odds: Mythic 0.1%, Super rare 0.15% each, Rare 0.3% each, otherwise None (the server's own block)."""
    r = rnd.random()
    if r < 0.001:
        return "rainbow"
    if r < 0.004:
        return ("galaxy", "ender")[int((r - 0.001) / 0.0015) % 2]
    if r < 0.025:
        return ("diamond", "gold", "emerald", "netherite", "amethyst", "lava", "ice")[int((r - 0.004) / 0.003) % 7]
    return None


class Welcome:
    def __init__(self, plugin):
        self.plugin = plugin
        self.data = self.fill(plugin.economy.get_config("welcome"))
        self.news = {}            # from the website: {"title": ..., "event": ..., "when": ...}
        self.open = {}            # player uuid -> state while the menu is open
        self.joined = {}          # player uuid -> name of the server they picked (players count for event servers)

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

    # ---------- opening ----------
    def enabled(self):
        return bool(self.data.get("enabled", True))

    def waiting(self, player):
        return str(player.unique_id) in self.open

    def in_minigame(self, player):
        try:
            bw = getattr(self.plugin, "bedwars", None)
            bc = getattr(self.plugin, "buildcontest", None)
            return (bw is not None and bw.playing(player)) or (bc is not None and bc.building(player))
        except Exception:
            return False

    def new_state(self, brand_new, reopened=False):
        return {"screen": "title", "tab": 0, "sel": 0, "new": bool(brand_new), "reopened": reopened, "closes": 0, "after": [],
                "scene": random.randrange(len(SCENES)), "splash": self.pick_splash(), "music": False}

    def on_join(self, player, brand_new):
        if not self.enabled() or self.in_minigame(player):
            return False
        self.open[str(player.unique_id)] = self.new_state(brand_new)
        return True

    def open_menu(self, player):
        """/menu, the menu compass, or Main Menu in /guide."""
        if self.in_minigame(player):
            return player.send_message("§cThe Main Menu isn't available during a minigame.")
        if not self.waiting(player):
            self.open[str(player.unique_id)] = self.new_state(False, reopened=True)
        self.show(player)

    def on_quit(self, player):
        self.open.pop(str(player.unique_id), None)
        self.joined.pop(str(player.unique_id), None)

    def state(self, player):
        return self.open.get(str(player.unique_id))

    def pick_splash(self):
        lines = [s.strip() for s in (self.data.get("splashes") or []) if str(s).strip()]
        if not lines and self.data.get("splash"):
            lines = [self.data["splash"]]
        return random.choice(lines) if lines else ""

    def codes(self, st):
        return f"§o§{st['scene']}" if st["scene"] else ""

    # ---------- screens ----------
    def show(self, player):
        st = self.state(player)
        if st is None:
            return
        {"servers": self.show_servers, "howto": self.show_howto, "rules": self.show_rules, "news": self.show_news,
         "store": self.show_store}.get(st["screen"], self.show_title)(player)

    def go(self, player, screen, tab=0):
        st = self.state(player)
        if st is not None:
            st["screen"], st["tab"] = screen, tab
            self.show(player)

    def send(self, player, form):
        form.on_close = self.closed
        player.send_form(form)

    def music(self, player, on):
        st = self.state(player)
        name = player.name.replace('"', "")
        server = self.plugin.server
        try:
            if on and st is not None and not st["music"]:
                st["music"] = True
                server.dispatch_command(server.command_sender, f'playsound music.menu "{name}" ~ ~ ~ 0.6')
            elif not on:
                server.dispatch_command(server.command_sender, f'stopsound "{name}" music.menu')
        except Exception:
            pass

    def show_title(self, player):
        st = self.state(player)
        form = ActionForm(title=f"{TITLE}{self.codes(st)}§lGalaxySMP", content=st["splash"])
        form.add_button("§lPlay", on_click=lambda p: self.go(p, "servers"))
        form.add_button("How to Play", on_click=lambda p: self.go(p, "howto"))
        form.add_button("Rules", on_click=lambda p: self.go(p, "rules"))
        form.add_button("What's New", on_click=lambda p: self.go(p, "news"))
        form.add_button("Store", on_click=lambda p: self.go(p, "store"))
        self.send(player, form)
        self.music(player, True)

    # ---------- Featured Servers ----------
    def servers(self):
        return [s for s in (self.data.get("servers") or []) if s.get("name") and s.get("enabled", True)][:10]

    def players_on(self, s):
        server = self.plugin.server
        if (s.get("action") or "play") == "play":
            return len(server.online_players)
        online = {str(p.unique_id) for p in server.online_players}
        return sum(1 for uid, name in self.joined.items() if name == s["name"] and uid in online)

    def stats_line(self, player, s):
        try:
            ms = int(player.ping)
        except Exception:
            ms = 0
        if s.get("action") == "soon":
            return f"{ping_icon(ms)} §f{ms}ms   §eComing soon"
        n = self.players_on(s)
        return f"{ping_icon(ms)} §f{ms}ms   {PLAYERS} §f{n} §7{'player' if n == 1 else 'players'}"

    def details(self, s):
        lines = [f"§l§f{s['name']}§r", f"§7{s.get('description') or ''}"]
        acts = [a.strip() for a in re.split(r"[·,|/]", s.get("tags") or "") if a.strip()]
        if acts:
            lines += ["", "§fActivities"] + [f"{activity_icon(a)} §b{a}" for a in acts]
        return "\n".join(lines)

    def show_servers(self, player):
        st = self.state(player)
        servers = self.servers() or [{"name": "GalaxySMP", "description": "Survival", "action": "play", "image": "galaxysmp"}]
        sel = min(st["sel"], len(servers) - 1)
        s = servers[sel]
        form = ActionForm(title=f"{SERVERS}{self.codes(st)}§lFeatured Servers", content=self.details(s))
        # 0: the sidebar's Join Server button (with the banner), 1: the ping and players line, then the list
        form.add_button("§j§nJoin Server", icon=image_of(s), on_click=lambda p, i=sel: self.join(p, i))
        form.add_button("§j§i" + self.stats_line(player, s), on_click=lambda p: self.show_servers(p))
        for i, v in enumerate(servers):
            mark = "§q§s" if i == sel else ""
            status = "§eComing soon" if v.get("action") == "soon" else f"§a● §7{self.players_on(v)} playing"
            form.add_button(f"{mark}§l{v['name']}§r\n{status}", icon=image_of(v), on_click=lambda p, i=i: self.select(p, i))
        self.send(player, form)

    def select(self, player, i):
        st = self.state(player)
        if st is not None:
            st["sel"] = i
            self.show_servers(player)

    # ---------- pages ----------
    def page(self, player, title, tabs, tab, body):
        st = self.state(player)
        form = ActionForm(title=f"{PAGE}{self.codes(st)}§l{title}", content=body)
        for i, label in enumerate(tabs):
            form.add_button(f"§e§l{label}" if i == tab else label, on_click=lambda p, i=i, scr=st["screen"]: self.go(p, scr, i))
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
            lines += ["", f"{PLAYERS} §f{len(server.online_players)}§7/{int(server.max_players)} players online"]
        except Exception:
            pass
        try:
            lines.append(f"§eYour money: §f{self.plugin.economy.balance_text(player)}")
        except Exception:
            pass
        lines += ["", "§7Read everything on §bgalaxymc.us§7: news, events, chat and voice."]
        self.page(player, "What's New", ["What's New"], 0, "\n".join(lines))

    def show_store(self, player):
        st = self.state(player)
        info = plans_info()
        keys = [k for k in ("free", "plus", "pro") if k in info]
        if not keys:
            return self.page(player, "Store", ["Store"], 0, "§7Plans, crate keys and more: §bgalaxymc.us/store")
        tab = min(st["tab"], len(keys) - 1)
        plan = info[keys[tab]]
        mine = None
        try:
            mine = self.plugin.plans.plan_key(player)
        except Exception:
            pass
        price = plan.get("price") or 0
        lines = [f"§l§d{plan.get('name', keys[tab])}§r  " + ("§aFree" if not price else f"§f${price}§7/month")]
        if (mine or "free") == keys[tab]:
            lines.append("§a✔ Your plan")
        lines.append("")
        lines += [f"§7•§r {p}" for p in (plan.get("perks") or [])[:12]]
        lines += ["", "§7Get it on §bgalaxymc.us/store§7 (plans, crate keys, gift cards and more)."]
        self.page(player, "Store", [info[k].get("name", k) for k in keys], tab, "\n".join(lines))

    def closed(self, player):
        """Closed (Back, or the game was still loading): back to the title screen."""
        st = self.state(player)
        if st is None or st["screen"] == "joining":
            return
        st["closes"] += 1
        delay = 2 if st["screen"] != "title" else (20 if st["closes"] < 5 else 60)
        if st["screen"] == "title" and st.get("reopened"):
            # a menu opened later (from /menu) can simply be closed
            self.open.pop(str(player.unique_id), None)
            self.music(player, False)
            return
        st["screen"], st["tab"] = "title", 0
        from endstone_galaxylink.safety import later
        later(self.plugin, player, self.show, delay)

    # ---------- joining ----------
    def join(self, player, i):
        st = self.state(player)
        servers = self.servers() or [{"name": "GalaxySMP", "action": "play"}]
        if st is None or i >= len(servers):
            return
        s = servers[i]
        action = s.get("action") or "play"
        if action == "soon":
            try:
                player.send_toast("§eComing soon", f"{s['name']} isn't open yet.")
            except Exception:
                pass
            return self.show_servers(player)
        spot = None
        if action == "warp":
            warps = getattr(self.plugin, "warps", None)
            w = warps.find(s.get("warp") or "") if warps is not None else None
            if w is None:
                try:
                    player.send_toast("§cNot available", f"{s['name']} isn't open right now.")
                except Exception:
                    pass
                return self.show_servers(player)
            spot = w["spot"]
        elif action == "spawn":
            spot = self.plugin.economy.get_config("spawn")
        theme = s.get("anim") if s.get("anim") in THEMES else "grass"
        if s.get("odds"):
            theme = roll_theme() or theme
        shown = (s.get("joinName") or s["name"]).strip()
        st["screen"] = "joining"
        self.joined[str(player.unique_id)] = s["name"]
        code = f"§m§{THEME_CODE[THEMES.index(theme)]}" if theme != "grass" else ""
        form = ActionForm(title=f"{JOINING}{self.codes(st)}{code}§lJoining", content=f"{THEME_COLOR.get(theme, '§b')}§l{shown}")
        form.on_close = self.closed
        player.send_form(form)
        self.music(player, False)
        try:
            player.play_sound(player.location, "random.orb", 0.7, 0.8)
        except Exception:
            pass
        from endstone_galaxylink.safety import later

        def finish(p):
            self.done(p, spot=spot, label=shown, action=action)
            try:
                p.close_form()
            except Exception:
                pass
        later(self.plugin, player, finish, JOIN_TICKS)

    def done(self, player, spot=None, label=None, action="play"):
        st = self.open.pop(str(player.unique_id), None)
        if st is None:
            return
        self.music(player, False)
        if spot is None and st["new"]:
            spot = self.plugin.economy.get_config("spawn")   # brand-new players start at spawn
        tp = getattr(self.plugin, "teleports", None)
        if spot and tp is not None:
            try:
                player.teleport(tp.location(spot))
            except Exception as e:
                self.plugin.logger.warning(f"Main Menu: couldn't move {player.name}: {e}")
        try:
            player.play_sound(player.location, "random.levelup", 0.6, 1.2)
        except Exception:
            pass
        if not st.get("reopened"):
            player.send_message(f"§d✦ §fWelcome to {label or 'GalaxySMP'}! §7Type §e/menu§7 for the Main Menu, §e/guide§7 for help.")
        if action == "minigames":
            mg = getattr(self.plugin, "minigames", None)
            if mg is not None:
                from endstone_galaxylink.safety import later
                later(self.plugin, player, mg.open, 10)
        self.give_compass(player)
        for fn in st.get("after", []):
            try:
                fn(player)
            except Exception as e:
                self.plugin.logger.warning(f"Main Menu: after-join step failed: {e}")

    def after(self, player, fn):
        """Runs fn(player) once they start playing (or right away when there's no menu open)."""
        st = self.state(player)
        if st is None:
            fn(player)
        else:
            st["after"].append(fn)

    # ---------- the menu compass (last hotbar slot) ----------
    def give_compass(self, player):
        """Keeps the GalaxySMP Menu compass in hotbar slot 9: locked there, kept on death. An item already in that
        slot is moved to a free slot first (or the compass isn't given when the inventory is full)."""
        if self.in_minigame(player):
            return
        try:
            inv = player.inventory
            cur = inv.get_item(8)
            if cur is not None and str(getattr(cur.type, "id", cur.type)) == MENU_ITEM:
                return
            if cur is not None:
                free = inv.first_empty()
                if free is None or free < 0:
                    return player.send_message("§7Your inventory is full, so the Menu compass wasn't added. Type §e/menu§7 any time.")
                inv.set_item(free, cur)
                inv.set_item(8, None)
            server = self.plugin.server
            name = player.name.replace('"', "")
            server.dispatch_command(server.command_sender,
                f'replaceitem entity "{name}" slot.hotbar 8 {MENU_ITEM} 1 0 '
                '{"minecraft:item_lock":{"mode":"lock_in_slot"},"minecraft:keep_on_death":{}}')
        except Exception as e:
            self.plugin.logger.warning(f"Menu compass: {e}")

    def on_use(self, event):
        """Using the GalaxySMP Menu compass opens the Main Menu. Returns True when it handled the event."""
        try:
            item = event.item
            if item is None or str(getattr(item.type, "id", item.type)) != MENU_ITEM:
                return False
        except Exception:
            return False
        event.is_cancelled = True
        self.open_menu(event.player)
        return True

    # ---------- while it's open ----------
    def on_damage(self, event):
        """Nobody gets hurt while the menu is open on join."""
        try:
            st = self.open.get(str(event.actor.unique_id))
            if st is not None and not st.get("reopened"):
                event.is_cancelled = True
                return True
        except Exception:
            pass
        return False

    def keep_frozen(self, player):
        return False   # menus already stop players from moving; walk_speed is never touched
