"""The GalaxySMP Main Menu: a full-screen title screen every time you join (and from /menu, the menu compass in the last
hotbar slot, or Main Menu in /guide).

  Title screen       a wallpaper (a different one each join), the GalaxySMP logo, a random splash line, your character,
                     Play, Settings, Tutorial & Commands and Help; Social in the top-right corner, Mail and Profile in the
                     bottom-left corner. Minecraft's menu music plays while it's open.
  Play               tabs Homes (your /sethome homes: teleport, delete, rename, move), Warps (My / Featured / All Warps;
                     the owner features warps with the star) and Servers (the Featured Servers: picture, ping and
                     players, PLAY, description and activities)
  Joining            the server's block (grass, diamond, lava...) shakes, cracks and bursts, then its name glows in
  Tutorial & Commands    Tutorial, your commands, Rules, What's New and the Store
  Mail / Profile / Help  website messages and notifications (mail.py), your card, a message to staff
  Settings           Coming Soon...

Nobody can get hurt while it's open; closing it (Back) goes back to the title screen. Brand-new players start at spawn,
everyone else carries on where they logged off. Event servers send players to a warp, spawn or the Minigame Center.

The look comes from the resource pack (ui/server_form.json): hidden codes in the title pick the screen (§1-§4), the
background scene (§o§N) and the joining block (§m§N). Without the pack these are normal Minecraft menus.

Staff edit the splash lines, the servers (name, picture, activities, joining block, name shown while joining) and the
How to Play tabs on the website (Control Panel > Help menu > Join screen). Never change walk_speed here: in Bedrock that
also zooms the player's view.
"""

import datetime
import json
import random
import re
import time
from importlib import resources

from endstone.form import ActionForm

MARK = "§g§s§m§p"
TITLE, SERVERS, PAGE, JOINING = MARK + "§1", MARK + "§2", MARK + "§3", MARK + "§4"
SCENES = ["wilderness", "copper", "sift", "chaos"]   # the background wallpapers (resource pack textures/ui/gsmp_bg_*)
THEMES = ["grass", "diamond", "gold", "emerald", "netherite", "amethyst", "lava", "ice", "galaxy", "ender", "rainbow"]
THEME_CODE = "0123456789a"
THEME_COLOR = {"grass": "§a", "diamond": "§b", "gold": "§6", "emerald": "§a", "netherite": "§d", "amethyst": "§d", "lava": "§6",
               "ice": "§b", "galaxy": "§5", "ender": "§3", "rainbow": "§e"}
PRESETS = ("galaxysmp", "event", "bedwars", "parkour", "build")
MENU_ITEM = "galaxysmp:menu"
HOLIDAY_CODES = {"rosh": "1", "sukkot": "2", "chanukah": "3", "tubishvat": "4", "purim": "5", "pesach": "6", "lagbaomer": "7", "shavuot": "8",
                 "newyear": "9", "spring": "a", "summer": "b", "autumn": "c", "winter": "d"}
JOIN_TICKS = 50          # the joining animation (about 2.5 seconds)
# Home icons (Play > Homes): name and the picture shown in the list
HOME_ICONS = [("House", "textures/ui/gsmp_icon_home"), ("Bed", "textures/items/bed_red"), ("Diamond", "textures/items/diamond"),
              ("Farm", "textures/items/wheat"), ("Mine", "textures/items/iron_pickaxe"), ("Shop", "textures/items/emerald"),
              ("Base", "textures/items/diamond_sword"), ("Food", "textures/items/apple"), ("Library", "textures/items/book_normal"),
              ("Gold", "textures/items/gold_ingot"), ("Door", "textures/items/door_wood")]
SCENE_NAMES = ["Wilderness", "Copper", "The Sift", "Chaos"]

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


ACT_PICS = ("survival", "pvp", "bedwars", "build", "event", "parkour", "plots", "shop", "pets", "adventure")
ACT_GUESS = [("surviv", "survival"), ("pvp", "pvp"), ("fight", "pvp"), ("combat", "pvp"), ("bedwar", "bedwars"), ("minigame", "bedwars"),
             ("build", "build"), ("creative", "build"), ("event", "event"), ("parkour", "parkour"), ("plot", "plots"), ("job", "shop"),
             ("econom", "shop"), ("shop", "shop"), ("trad", "shop"), ("pet", "pets"), ("mob", "pets"), ("adventure", "adventure"), ("explor", "adventure")]


def activities_of(server):
    """A server's activities: [{title, subtitle, text, pic}]. Older settings only have "tags" (Survival · Plots), so
    those become activities with a matching picture."""
    acts = [a for a in (server.get("activities") or []) if isinstance(a, dict) and str(a.get("title") or "").strip()]
    if not acts:
        for t in [x.strip() for x in re.split(r"[·,|/]", server.get("tags") or "") if x.strip()]:
            n = t.lower()
            acts.append({"title": t, "pic": next((pic for key, pic in ACT_GUESS if key in n), "event")})
    return acts[:6]


def activity_pic(a):
    pic = str(a.get("pic") or "")
    if pic.startswith("https://"):
        return pic
    return f"textures/ui/gsmp_act_{pic if pic in ACT_PICS else 'event'}"


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
        self.db = plugin.economy.db
        self.db.execute("CREATE TABLE IF NOT EXISTS menu_prefs (xuid TEXT PRIMARY KEY, music INTEGER DEFAULT 1, scene INTEGER DEFAULT -1, skip INTEGER DEFAULT 0)")
        try:   # 2.88: sparkles on/off (teleports, rewards, purchases)
            self.db.execute("ALTER TABLE menu_prefs ADD COLUMN fx INTEGER DEFAULT 1")
        except Exception:
            pass
        self.db.commit()

    # ---------- Settings (per player) ----------
    def prefs(self, player):
        try:
            r = self.db.execute("SELECT music, scene, skip, fx FROM menu_prefs WHERE xuid = ?", (str(player.xuid),)).fetchone()
        except Exception:
            r = None
        return {"music": bool(r[0]) if r else True, "scene": int(r[1]) if r else -1, "skip": bool(r[2]) if r else False,
                "fx": bool(r[3]) if r and r[3] is not None else True}

    def set_pref(self, player, **kw):
        p = dict(self.prefs(player), **kw)
        self.db.execute("INSERT OR REPLACE INTO menu_prefs (xuid, music, scene, skip, fx) VALUES (?,?,?,?,?)",
                        (str(player.xuid), int(p["music"]), int(p["scene"]), int(p["skip"]), int(p["fx"])))
        self.db.commit()

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

    def new_state(self, brand_new, reopened=False, player=None):
        scene = random.randrange(len(SCENES))
        if player is not None:
            fav = self.prefs(player)["scene"]
            if 0 <= fav < len(SCENES):
                scene = fav
        return {"screen": "title", "tab": 0, "sel": 0, "new": bool(brand_new), "reopened": reopened, "closes": 0, "after": [],
                "scene": scene, "splash": self.pick_splash(), "music": False}

    def lock(self, player, on):
        """Stops walking and looking around while the Main Menu is on its way (no walk_speed: that zooms the view)."""
        server = self.plugin.server
        name = player.name.replace('"', "")
        for what in ("movement", "camera"):
            try:
                server.dispatch_command(server.command_sender, f'inputpermission set "{name}" {what} {"disabled" if on else "enabled"}')
            except Exception:
                pass

    def on_join(self, player, brand_new):
        self.lock(player, False)   # in case they left while locked
        if not self.enabled() or self.in_minigame(player):
            return False
        if not brand_new and self.prefs(player)["skip"]:
            return False   # Settings: "Show the Main Menu when I join" is off (/menu still opens it)
        self.open[str(player.unique_id)] = self.new_state(brand_new, player=player)
        self.open[str(player.unique_id)]["seen"] = time.time()
        self.lock(player, True)
        from endstone_galaxylink.safety import later
        later(self.plugin, player, self.time_out, 20 * 180)   # never stuck for more than 3 minutes
        return True

    def time_out(self, player):
        """3 minutes after joining: movement comes back. If the menu isn't being used any more (no screen shown for
        2 minutes, e.g. a pop-up was closed), the menu ends so they can play normally (and can be hurt again)."""
        self.lock(player, False)
        st = self.state(player)
        if st is None or st.get("reopened"):
            return
        if time.time() - st.get("seen", 0) > 120:
            self.done(player, greet=False)
        else:
            from endstone_galaxylink.safety import later
            later(self.plugin, player, self.time_out, 20 * 60)

    def open_menu(self, player):
        """/menu, the menu compass, or Main Menu in /guide."""
        if self.in_minigame(player):
            return player.send_message("§cThe Main Menu isn't available during a minigame.")
        if not self.waiting(player):
            self.open[str(player.unique_id)] = self.new_state(False, reopened=True, player=player)
        self.show(player)

    def travel(self, player, name):
        """Walking into a portal: the joining animation for that Featured Server, then off you go."""
        servers = list(self.servers() or [])
        i = next((k for k, s in enumerate(servers) if str(s.get("name", "")).lower() == str(name).lower()), None)
        if i is None and str(name).lower() == "the sift":
            servers.append({"name": "The Sift", "action": "sift", "anim": "amethyst"})
            i = len(servers) - 1
        if i is None or self.in_minigame(player):
            return False
        st = self.new_state(False, reopened=True)
        st["portal"] = True
        self.open[str(player.unique_id)] = st
        self.join(player, i, servers)
        return True

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
        st["seen"] = time.time()
        if st["screen"] == "servers":   # (older name) the Servers tab of Play
            st["screen"], st["tab"] = "play", 2
        {"play": self.show_play, "guide": self.show_guide, "settings": self.show_settings,
         "mail": self.show_mail, "profile": self.show_profile, "social": self.show_social,
         "link": self.show_link}.get(st["screen"], self.show_title)(player)

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
            if on and st is not None and not st["music"] and self.prefs(player)["music"]:
                st["music"] = True
                server.dispatch_command(server.command_sender, f'execute as "{name}" at @s run playsound music.menu @s ~ ~ ~ 0.6 1 0.6')
            elif not on:
                server.dispatch_command(server.command_sender, f'stopsound "{name}" music.menu')
        except Exception:
            pass

    def holiday_codes(self):
        h = self.news.get("holiday") or {}
        code = HOLIDAY_CODES.get(h.get("id"))
        if not code:
            return ""
        night = f"§n§{int(h['night'])}" if h.get("id") == "chanukah" and h.get("night") else ""
        return f"§h§{code}{night}"

    def restart_line(self):
        sc = getattr(self.plugin, "servercontrol", None)
        r = getattr(sc, "restart", None) if sc is not None else None
        try:
            left = float(r["at"]) - time.time() if r else -1
        except Exception:
            left = -1
        if left <= 0:
            return ""
        mins = int(left // 60)
        when = f"{mins // 60}h {mins % 60}m" if mins >= 60 else (f"{mins} min" if mins >= 1 else "less than a minute")
        return f"§6⚠ Server restart in {when}" + (f" §7({r['reason']})" if r.get("reason") else "")

    def friends_line(self, player):
        social = getattr(self.plugin, "social", None)
        if social is None:
            return "§lSocial"
        if not social.linked(player):
            return "§b§lSocial§r\n§7Link your account to add friends"
        online = social.online_friends(player)
        reqs = len((social.state.get(str(player.unique_id)) or {}).get("incoming") or [])
        top = f"§b§lFriends online: §a{len(online)}" + (f"  §e{reqs} request{'s' if reqs != 1 else ''}" if reqs else "")
        names = ", ".join(p.name for f, p in online[:3]) + (f" +{len(online) - 3}" if len(online) > 3 else "")
        return f"{top}§r\n§7{names or 'Tap to see your friends and party'}"

    def social_label(self, player):
        social = getattr(self.plugin, "social", None)
        if social is None or not social.linked(player):
            return "§lSocial"
        online = len(social.online_friends(player))
        reqs = len((social.state.get(str(player.unique_id)) or {}).get("incoming") or [])
        return "§lSocial" + (f" §e({reqs})" if reqs else f" §a({online})" if online else "")

    def mail_label(self, player):
        mail = getattr(self.plugin, "mail", None)
        n = mail.unread(player) if mail is not None else 0
        return "§lMail" + (f" §c({n})" if n else "")

    def show_title(self, player):
        st = self.state(player)
        splash = st["splash"]
        h = self.news.get("holiday") or {}
        if h.get("greet"):
            splash = h["greet"]
        form = ActionForm(title=f"{TITLE}{self.codes(st)}{self.holiday_codes()}§lGalaxySMP", content=splash)
        st["shown"] = True
        # 0-2: the corner buttons (Social top right; Mail and Profile bottom left), 3: the restart notice, 4+: the main buttons
        form.add_button("§j§c§f" + self.social_label(player), on_click=lambda p: self.go(p, "social"))
        form.add_button("§j§c§f" + self.mail_label(player), on_click=lambda p: self.go(p, "mail"))
        form.add_button("§j§c§f§lProfile", on_click=lambda p: self.go(p, "profile"))
        form.add_button("§j§r" + self.restart_line(), on_click=lambda p: self.show(p))
        form.add_button("§p§f§lPlay", on_click=lambda p: self.go(p, "play", st.get("ptab", 2)))
        form.add_button("Settings", on_click=lambda p: self.go(p, "settings"))
        form.add_button("Tutorial & Commands", on_click=lambda p: self.go(p, "guide"))
        form.add_button("Help", on_click=lambda p: self.ask_help(p))
        # after the main buttons: the live info tiles under them (friends online, daily reward, next event, players)
        for text, icon, click in self.live_tiles(player):
            form.add_button(text, icon=icon, on_click=click)
        self.send(player, form)
        self.music(player, True)

    def live_tiles(self, player):
        """The small live tiles on the Main Menu: [(text, icon, on_click)]. "§j§i§N" picks the tile's caption in the
        resource pack (1 Friends, 2 Daily, 3 Event, 4 Playing); the rest is the big value."""
        tiles = []
        pic = lambda n: f"textures/ui/gsmp_live_{n}"
        social = getattr(self.plugin, "social", None)
        if social is not None:
            if social.linked(player):
                n = len(social.online_friends(player))
                tiles.append((f"§j§i§1{'§a' if n else '§7'}{n} online", pic("friends"), lambda p: self.go(p, "social")))
            else:
                tiles.append(("§j§i§1§bLink", pic("friends"), lambda p: self.go(p, "link")))
        prog = getattr(self.plugin, "progress", None)
        if prog is not None:
            try:
                can, day, streak = prog.daily_state(player)
                if can:
                    tiles.append(("§j§i§2§6Ready!", pic("daily"), lambda p: self.claim_daily(p)))
                else:
                    from endstone_galaxylink.progress import TZ as PTZ   # the daily reward's day starts at midnight there
                    now = datetime.datetime.now(PTZ)
                    left = (datetime.datetime.combine(now.date() + datetime.timedelta(days=1), datetime.time(), PTZ) - now).total_seconds()
                    tiles.append((f"§j§i§2§7in {self.short_time(left)}", pic("daily"), lambda p: self.go(p, "title")))
            except Exception:
                pass
        ev = self.event_value()
        if ev:
            tiles.append((f"§j§i§3{ev}", pic("event"), lambda p: self.go(p, "guide", 3)))
        try:
            server = self.plugin.server
            tiles.append((f"§j§i§4§f{len(server.online_players)}§7/{int(server.max_players)}", pic("online"),
                          lambda p: self.go(p, "play", 2)))
        except Exception:
            pass
        return tiles

    @staticmethod
    def short_time(seconds):
        m = max(0, int(seconds // 60))
        if m >= 48 * 60:
            return f"{m // 1440}d"
        if m >= 60:
            return f"{m // 60}h {m % 60}m" if m < 600 else f"{m // 60}h"
        return f"{max(1, m)}m"

    def event_value(self):
        """The next event's countdown for its tile ("2h 15m", "Now!"), or None when there's no upcoming event."""
        if not self.news.get("event"):
            return None
        try:
            at = float(self.news.get("at") or 0) / 1000
        except Exception:
            at = 0
        if not at:
            return "§bSoon"
        left = at - time.time()
        if left <= 0:
            return "§aNow!" if left > -3 * 3600 else None
        return f"§b{self.short_time(left)}"

    def claim_daily(self, player):
        prog = getattr(self.plugin, "progress", None)
        if prog is not None:
            try:
                prog.claim_daily(player)
            except Exception as e:
                self.plugin.logger.warning(f"Main Menu daily reward: {e}")
        self.go(player, "title")

    # ---------- Link Account ----------
    def show_link(self, player):
        st = self.state(player)
        social = getattr(self.plugin, "social", None)
        uid = str(player.unique_id)
        if social is not None and social.linked(player):
            return self.page(player, "Link Account", ["Done"], 0, "§aYour account is linked.§r\n\nYou can chat, use voice chat and add friends on §bgalaxymc.us§r.",
                             go_to=[("title", 0)])
        info = social.links.get(uid) if social is not None else None
        if not info:
            if social is not None and not st.get("link_asked"):
                st["link_asked"] = True
                social.link_info(player, then=lambda: self.show(player) if self.state(player) and self.state(player)["screen"] == "link" else None)
            st["link_asked"] = False   # Refresh asks the website again (in case the first try failed)
            return self.page(player, "Link Account", ["Refresh"], 0, "§7Getting your code...")
        body = (f"§l§fLink your account§r\n\n"
                f"§71.§r Scan the QR code with your phone's camera,\n§7   or go to §bgalaxymc.us/community§r and enter:\n\n"
                f"§l§e   {info['code']}§r\n\n"
                f"§72.§r Pick a password. That's it!\n\n"
                f"§7Linked players can chat and use voice chat on the website, add friends, and see their stats.\n"
                f"§8The code works for 30 minutes.")
        form = ActionForm(title=f"{PAGE}{self.codes(st)}§lLink Account", content=body)
        form.add_button("§j§q", icon=info.get("qr") or "", on_click=lambda p: self.show(p))
        form.add_button("§e§lI've linked it", on_click=lambda p: self.check_linked(p))
        self.send(player, form)

    def check_linked(self, player):
        social = getattr(self.plugin, "social", None)
        if social is None:
            return
        social.link_info(player, then=lambda: (social.refresh([player], then=lambda: self.go(player, "title")) if social.linked(player)
                                               else self.show(player)))

    # ---------- Social ----------
    SOCIAL_TABS = ["Friends", "Requests", "Party", "Recent", "My Card"]

    def social_tabs(self, player, tab):
        social = self.plugin.social
        reqs = len((social.state.get(str(player.unique_id)) or {}).get("incoming") or [])
        party = social.party_of(str(player.unique_id))
        labels = ["Friends", f"Requests ({reqs})" if reqs else "Requests", f"Party ({len(party)})" if party else "Party", "Recent", "My Card"]
        return labels

    def show_social(self, player):
        st = self.state(player)
        social = getattr(self.plugin, "social", None)
        if social is None:
            return self.show_title(player)
        if not st.get("social_loaded"):
            st["social_loaded"] = True
            social.refresh([player], then=lambda: self.show(player) if self.state(player) and self.state(player)["screen"] == "social" else None)
        tab = st["tab"]
        labels = self.social_tabs(player, tab)
        form = ActionForm(title=f"{PAGE}{self.codes(st)}§lSocial", content="")
        for i, label in enumerate(labels):
            form.add_button(f"§e§l{label}" if i == tab else label, on_click=lambda p, i=i: self.go(p, "social", i))
        lines = []
        uid = str(player.unique_id)
        linked = social.linked(player)
        if tab in (0, 1) and not linked:
            lines = ["§l§fFriends§r", "", "§7Link your account to add friends. Friends work in game and on galaxymc.us."]
            form.add_button("§bLink Account", on_click=lambda p: self.go(p, "link"))
        elif tab == 0:
            friends = social.friends(player)
            online = {f["xuid"]: p for f, p in social.online_friends(player)}
            lines = [f"§l§fFriends §r§7({len(friends)})", ""]
            if not friends:
                lines.append("§7No friends yet. Add someone by name, or from Recent players.")
            for f in sorted(friends, key=lambda f: (f.get("xuid") not in online, f["name"].lower()))[:40]:
                p = online.get(f.get("xuid"))
                status = f"§a● §7{social.where(p)}" if p else "§8○ Offline"
                lines.append(f"§f{f['name']}  {status}")
                form.add_button(f"{'§a● ' if p else '§8○ '}§f{f['name']}", on_click=lambda pl, f=f: self.friend_menu(pl, f))
            form.add_button("§a+ Add Friend", on_click=lambda p: social.ask_name(p, "Add Friend", "Their gamertag",
                            lambda pl, name: social.act(pl, "request", then=lambda: self.go(pl, "social", 0), username=name),
                            back=lambda pl: self.go(pl, "social", 0)))
        elif tab == 1:
            data = social.state.get(uid) or {}
            inc, out = data.get("incoming") or [], data.get("outgoing") or []
            lines = ["§l§fFriend requests§r", ""]
            if not inc and not out:
                lines.append("§7No requests right now.")
            for f in inc:
                lines.append(f"§e{f['name']} §7wants to be friends")
                form.add_button(f"§aAccept §f{f['name']}", on_click=lambda p, f=f: social.act(p, "accept", then=lambda: self.go(p, "social", 1), userId=f["id"]))
                form.add_button(f"§cDecline §f{f['name']}", on_click=lambda p, f=f: social.act(p, "decline", then=lambda: self.go(p, "social", 1), userId=f["id"]))
            for f in out:
                lines.append(f"§7Waiting for §f{f['name']}")
                form.add_button(f"§7Cancel §f{f['name']}", on_click=lambda p, f=f: social.act(p, "cancel", then=lambda: self.go(p, "social", 1), userId=f["id"]))
        elif tab == 2:
            party = social.party_of(uid)
            lines = ["§l§fParty§r §7(up to 4 players)", ""]
            bw = social.bw()
            inv = bw.invites.get(uid) if bw is not None else None
            if party:
                for m in party:
                    mp = social.online(m)
                    lines.append(f"§f{mp.name if mp else 'Offline player'}{' §e(leader)' if m == party[0] else ''}")
                lines += ["", "§7When the leader joins a server from the Main Menu, the party comes along. Type §e/p <message>§7 for party chat."]
            else:
                lines.append("§7Make a party to play together: join servers and minigames as a group, with party chat.")
            if inv and not party and time.time() - inv[1] < 300:
                lp = social.online(inv[0])
                if lp is not None:
                    form.add_button(f"§aJoin {lp.name}'s party", on_click=lambda p: (social.accept(p), self.go(p, "social", 2)))
            if not party or party[0] == uid:
                form.add_button("§a+ Invite", on_click=self.party_invite_menu)
            if party and party[0] == uid:
                for m in party[1:]:
                    mp = social.online(m)
                    form.add_button(f"§cRemove §f{mp.name if mp else 'player'}", on_click=lambda p, m=m: (social.kick(p, m), self.go(p, "social", 2)))
            if party:
                form.add_button("§cLeave Party", on_click=lambda p: (social.leave_party(p), self.go(p, "social", 2)))
        elif tab == 3:
            rows = social.recent(player)
            lines = ["§l§fRecent players§r", "", "§7People you played near lately." if rows else "§7Nobody yet. Play near other players and they show up here."]
            friend_x = {f.get("xuid") for f in social.friends(player)}
            for other, name, at in rows[:20]:
                ago = int((time.time() - at) // 60)
                when = "just now" if ago < 2 else (f"{ago} min ago" if ago < 60 else (f"{ago // 60} h ago" if ago < 1440 else f"{ago // 1440} d ago"))
                lines.append(f"§f{name} §7· {when}" + (" §a(friend)" if other in friend_x else ""))
                if other not in friend_x and linked:
                    form.add_button(f"§a+ Add §f{name}", on_click=lambda p, n=name: social.act(p, "request", then=lambda: self.go(p, "social", 3), username=n))
        else:
            hidden = social.card_hidden(player.xuid)
            lines = [social.card_text(str(player.xuid), player.name, player), "", "§7Friends " + ("§ccan't see§7" if hidden else "§acan see§7") + " your card."]
            form.add_button("Show my card to friends" if hidden else "Hide my card from friends",
                            on_click=lambda p: (social.set_card_hidden(p, not hidden), self.go(p, "social", 4)))
        form.content = "\n".join(lines)
        self.send(player, form)

    def friend_menu(self, player, f):
        st = self.state(player)
        social = self.plugin.social
        online = {x["xuid"]: p for x, p in social.online_friends(player)}
        p_on = online.get(f.get("xuid"))
        if p_on is not None and not social.card_hidden(f.get("xuid")):
            body = social.card_text(f["xuid"], f["name"], p_on)
        elif f.get("xuid") and not social.card_hidden(f["xuid"]):
            body = social.card_text(f["xuid"], f["name"]) + "\n§8○ Offline"
        else:
            body = f"§l§f{f['name']}§r\n\n§7{'Online' if p_on else 'Offline'}"
        form = ActionForm(title=f"{PAGE}{self.codes(st)}§l{f['name']}", content=body)
        form.add_button("§l< Friends", on_click=lambda p: self.go(p, "social", 0))
        if p_on is not None:
            form.add_button("Teleport request", on_click=lambda p: self.friend_tpa(p, p_on.name))
            if str(p_on.unique_id) not in social.party_of(str(player.unique_id)):
                form.add_button("Invite to party", on_click=lambda p: (social.invite(p, p_on), self.go(p, "social", 2)))
        form.add_button("Message", on_click=lambda p: social.ask_message(p, f["name"], then=lambda pl: self.go(pl, "social", 0)))
        if getattr(self.plugin, "calls", None) is not None:   # a voice call (talk on galaxymc.us/voice)
            form.add_button("📞 Call", on_click=lambda p: (self.plugin.calls.command(p, [f["name"]]), self.go(p, "social", 0)))
        form.add_button("§cRemove friend", on_click=lambda p: social.act(p, "remove", then=lambda: self.go(p, "social", 0), userId=f["id"]))
        self.send(player, form)

    def friend_tpa(self, player, name):
        tp = getattr(self.plugin, "teleports", None)
        if tp is None:
            return
        st = self.state(player)
        if st is not None and not st.get("reopened"):
            # finish the join first (they'd otherwise be teleported while still on the Main Menu)
            self.done(player)
            try:
                player.close_form()
            except Exception:
                pass
        else:
            self.open.pop(str(player.unique_id), None)
            try:
                player.close_form()
            except Exception:
                pass
        tp.request(player, [name], "to")

    def party_invite_menu(self, player):
        st = self.state(player)
        social = self.plugin.social
        uid = str(player.unique_id)
        party = social.party_of(uid)
        friend_x = {f.get("xuid") for f in social.friends(player)}
        others = [p for p in self.plugin.server.online_players if str(p.unique_id) != uid and str(p.unique_id) not in party]
        others.sort(key=lambda p: (str(p.xuid) not in friend_x, p.name.lower()))
        form = ActionForm(title=f"{PAGE}{self.codes(st)}§lInvite to Party", content="§7Who should play with you?" if others else "§7Nobody else is online right now.")
        form.add_button("§l< Party", on_click=lambda p: self.go(p, "social", 2))
        for o in others[:40]:
            form.add_button(f"{'§a★ ' if str(o.xuid) in friend_x else ''}§f{o.name}", on_click=lambda p, o=o: (social.invite(p, o), self.go(p, "social", 2)))
        self.send(player, form)

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
        lines = ["§l§fDescription§r", f"§7{s.get('description') or ''}"]
        if activities_of(s):
            lines += ["", "§l§fActivities§r"]   # the picture cards follow (activity buttons, see show_play)
        return "\n".join(lines)

    # ---------- Play: Homes / Warps / Servers ----------
    # The layout (resource pack): 0-2 the tabs, 3 the big green button (its icon is the big picture), 4 the dark strip
    # under the picture, 5 the name, 6-8 small icon buttons, 9+ the list on the left. "§j§-" hides a slot, "§j§h" list
    # items are section headers, "§q§s" marks the chosen tab.
    PLAY_TABS = ("homes", "warps", "servers")
    HIDE = "§j§-"

    def homes_of(self, player):
        tp = getattr(self.plugin, "teleports", None)
        if tp is None:
            return []
        try:
            rows = tp.db.execute("SELECT name, data FROM homes WHERE xuid = ? ORDER BY name", (str(player.xuid),)).fetchall()
        except Exception:
            return []
        out = []
        for name, data in rows:
            try:
                spot = json.loads(data)
                out.append({"name": name, "spot": spot, "icon": self.home_icon(spot.get("icon"))})
            except Exception:
                pass
        return out

    @staticmethod
    def home_icon(key):
        return next((tex for n, tex in HOME_ICONS if n == key), HOME_ICONS[0][1])

    def set_home_icon(self, player, name, icon):
        tp = getattr(self.plugin, "teleports", None)
        r = tp.db.execute("SELECT data FROM homes WHERE xuid = ? AND name = ?", (str(player.xuid), name)).fetchone() if tp else None
        if not r:
            return
        spot = json.loads(r[0])
        spot["icon"] = icon
        tp.db.execute("UPDATE homes SET data = ? WHERE xuid = ? AND name = ?", (json.dumps(spot), str(player.xuid), name))
        tp.db.commit()

    def icon_key_of(self, player, name):
        tp = getattr(self.plugin, "teleports", None)
        r = tp.db.execute("SELECT data FROM homes WHERE xuid = ? AND name = ?", (str(player.xuid), name)).fetchone() if tp else None
        try:
            return json.loads(r[0]).get("icon") or HOME_ICONS[0][0]
        except Exception:
            return HOME_ICONS[0][0]

    def featured(self):
        return [str(n) for n in (self.plugin.economy.get_config("featured_warps") or []) if n]

    def warp_rows(self, player):
        """The Warps list: My Warps, Featured Warps (set by the owner with the star) and All Warps."""
        warps = getattr(self.plugin, "warps", None)
        if warps is None:
            return []
        every = warps.all()
        mine = [w for w in every if w["owner"] == str(player.xuid)]
        feat = [w for n in self.featured() for w in every if w["name"].lower() == n.lower()]
        rows = [("head", "My Warps")] + [("warp", w) for w in mine]
        if not mine:
            rows.append(("setwarp", None))
        rows += [("head", "Featured Warps")] + ([("warp", w) for w in feat] or [("none", "No featured warps yet")])
        rows += [("head", "All Warps")] + ([("warp", w) for w in every[:40]] or [("none", "No warps yet")])
        return rows

    @staticmethod
    def spot_line(spot):
        dim = {"Overworld": "Overworld", "Nether": "Nether", "TheEnd": "The End"}.get(str(spot.get("dim")), str(spot.get("dim") or ""))
        return f"§f{int(spot.get('x', 0))} {int(spot.get('y', 0))} {int(spot.get('z', 0))}  §7{dim}"

    def can_feature(self, player):
        return bool(player.is_op)

    def show_play(self, player):
        st = self.state(player)
        tab = max(0, min(int(st.get("tab") or 0), 2))
        st["ptab"] = tab
        sel = st.setdefault("psel", {}).get(tab, 0)
        homes = self.homes_of(player)
        tp = getattr(self.plugin, "teleports", None)
        try:
            limit = tp.max_homes(player)
        except Exception:
            limit = 1
        tabs = [f"Homes ({len(homes)})", "Warps", "Servers"]
        bg = f"textures/ui/gsmp_bg_{SCENES[st['scene']]}"
        # what's shown on the right: picture, strip, name, green button, small buttons, description
        view = {"pic": bg, "strip": "", "name": "", "go": None, "go_text": "", "acts": [], "text": ""}
        items = []   # (button text, icon, on_click)
        extra = []   # after the list: activity cards
        if tab == 0:
            items.append(("§l+ Set a home here§r\n§7" + (f"{len(homes)}/{limit} homes" if homes else "Save this spot"), "textures/ui/gsmp_icon_add",
                          lambda p: self.home_name_form(p)))
            for i, h in enumerate(homes):
                mark = "§e» " if i == sel else ""
                items.append((f"{mark}§l{h['name']}§r\n{self.spot_line(h['spot'])}", h["icon"],
                              lambda p, i=i: self.play_select(p, i)))
            if homes:
                h = homes[min(sel, len(homes) - 1)]
                view.update(name=f"§l{h['name']}", strip=self.spot_line(h["spot"]), go_text="TELEPORT",
                            go=lambda p, h=h: self.leave_to(p, h["spot"], f"Home {h['name']}"),
                            acts=[("textures/ui/gsmp_icon_trash", lambda p, n=h["name"]: self.confirm_delete_home(p, n)),
                                  ("textures/ui/gsmp_icon_rename", lambda p, n=h["name"]: self.home_name_form(p, rename=n)),
                                  ("textures/ui/gsmp_icon_move", lambda p, n=h["name"]: self.move_home(p, n))],
                            text=(f"§l§fHome: {h['name']}§r\n\n§7Teleport takes you straight there.\n\n"
                                  f"§c■§7 Delete  §e■§7 Rename  §b■§7 Move it to where you are now\n\n"
                                  f"§7You have §f{len(homes)}/{limit}§7 homes. §8You can also use /home {h['name']}."))
            else:
                view.update(name="§lNo homes yet", strip="§7Tap §a+ Set a home here§7 or type /sethome",
                            text=f"§l§fHomes§r\n\n§7Save the places you like and come back any time.\n\nYou can have §f{limit}§7 home"
                                 f"{'s' if limit != 1 else ''}." + ("" if limit >= 10 else " §7More come with §dGalaxy+§7 and §dPro+§7."))
        elif tab == 1:
            rows = self.warp_rows(player)
            warps_list = [r[1] for r in rows if r[0] == "warp"]
            try:
                hot = self.plugin.warps.popular()
            except Exception:
                hot = {}
            k = 0
            chosen = None
            for kind, v in rows:
                if kind == "head":
                    items.append((f"§j§h§l{v}", "", lambda p: self.show(p)))
                elif kind == "none":
                    items.append((f"§7{v}", "", lambda p: self.show(p)))
                elif kind == "setwarp":
                    items.append(("§l+ Set your warp here§r\n§7Galaxy Pro+", "textures/ui/gsmp_icon_add", lambda p: self.warp_name_form(p)))
                else:
                    if k == sel:
                        chosen = v
                    mark = "§e» " if k == sel else ""
                    star = "§e★ " if v["name"].lower() in [n.lower() for n in self.featured()] else ""
                    pop = "  §6Popular this week" if v["owner"] in hot else ""
                    items.append((f"{mark}{star}§l{v['name']}§r\n§7by {v['ownerName']} · {v['visits']} visit{'s' if v['visits'] != 1 else ''}{pop}",
                                  "textures/ui/gsmp_icon_warp", lambda p, k=k: self.play_select(p, k)))
                    k += 1
            if chosen is None and warps_list:
                chosen = warps_list[0]
            if chosen is not None:
                w = chosen
                staff = player.is_op or self.plugin.moderation.is_staff(player)
                acts = []
                if self.can_feature(player):
                    acts.append(("textures/ui/gsmp_icon_star", lambda p, n=w["name"]: self.toggle_featured(p, n)))
                if w["owner"] == str(player.xuid) or staff:
                    acts.append(("textures/ui/gsmp_icon_trash", lambda p, n=w["name"]: self.confirm_delete_warp(p, n)))
                if w["owner"] == str(player.xuid):
                    acts.append(("textures/ui/gsmp_icon_move", lambda p, n=w["name"]: self.move_warp(p, n)))
                featured = w["name"].lower() in [n.lower() for n in self.featured()]
                view.update(pic="textures/ui/gsmp_bg_copper", name=f"§l{w['name']}", go_text="WARP",
                            strip=f"§7by §f{w['ownerName']}  §7{w['visits']} visit{'s' if w['visits'] != 1 else ''}" + ("  §e★ Featured" if featured else "")
                                  + (f"  §6Popular: {hot[w['owner']]} this week" if w["owner"] in hot else ""),
                            go=lambda p, n=w["name"]: self.warp_to(p, n), acts=acts,
                            text=(f"§l§f{w['name']}§r\n§7A warp by §f{w['ownerName']}§7.\n\n§7Anyone can visit with §e/warp {w['name']}§7."
                                  + ("\n\n§e★§7 Tap the star to feature it (or take it off Featured)." if self.can_feature(player) else "")))
            else:
                view.update(name="§lNo warps yet", strip="§dGalaxy Pro+§7 members can make one",
                            text="§l§fWarps§r\n\n§7Warps are public places players made: shops, builds, farms.\n\n"
                                 "§dGalaxy Pro+§7 members can set one with §e/setwarp <name>§7.")
        else:
            servers = self.servers() or [{"name": "GalaxySMP", "description": "Survival", "action": "play", "image": "galaxysmp"}]
            sel = min(sel, len(servers) - 1)
            s = servers[sel]
            for i, v in enumerate(servers):
                status = "§eComing soon" if v.get("action") == "soon" else f"§a● §7{self.players_on(v)} playing"
                mark = "§e» " if i == sel else ""
                items.append((f"{mark}§l{v['name']}§r\n{status}", image_of(v), lambda p, i=i: self.play_select(p, i, join=True)))
            soon = s.get("action") == "soon"
            view.update(pic=image_of(s), strip=self.stats_line(player, s), name=f"§l{s['name']}", go_text="SOON" if soon else "PLAY",
                        go=(lambda p, i=sel: self.join(p, i)), text=self.details(s))
            for a in activities_of(s):   # big picture cards under the description (hidden from the list)
                lines = [f"§j§v§l§f{a['title']}§r"]
                if a.get("subtitle"):
                    lines.append(f"§7{a['subtitle']}")
                if a.get("text"):
                    lines.append(f"§f{a['text']}")
                extra.append(("\n".join(lines), activity_pic(a), lambda p: self.show(p)))
        form = ActionForm(title=f"{SERVERS}{self.codes(st)}§lPlay", content=view["text"])
        for i, label in enumerate(tabs):
            form.add_button(f"§j§t{'§q§s' if i == tab else ''}§f{label}", on_click=lambda p, i=i: self.go(p, "play", i))
        go = view["go"]
        form.add_button(f"§j§g§f§l{view['go_text']}" if go else f"{self.HIDE}", icon=view["pic"],
                        on_click=go or (lambda p: self.show(p)))
        form.add_button(f"§j§i{view['strip']}", on_click=lambda p: self.show(p))
        form.add_button(f"§j§n§f{view['name']}", on_click=lambda p: self.show(p))
        acts = view["acts"][:3]
        for k in range(3):
            if k < len(acts):
                form.add_button("§j§a", icon=acts[k][0], on_click=acts[k][1])
            else:
                form.add_button(self.HIDE, on_click=lambda p: self.show(p))
        for text, icon, click in items + extra:
            if icon:
                form.add_button(text, icon=icon, on_click=click)
            else:
                form.add_button(text, on_click=click)
        self.send(player, form)

    def play_select(self, player, i, join=False):
        """Tap an item to see it on the right; tap a server again to join it."""
        st = self.state(player)
        if st is None:
            return
        tab = st.get("ptab", 2)
        if join and st.setdefault("psel", {}).get(tab, 0) == i:
            return self.join(player, i)
        st.setdefault("psel", {})[tab] = i
        st["screen"], st["tab"] = "play", tab
        self.show_play(player)

    def leave_to(self, player, spot, label):
        """Close the menu and go to a home or warp."""
        st = self.state(player)
        if st is None:
            return
        if self.in_minigame(player):
            return player.send_message("§cYou can't teleport during a minigame.")
        tp = getattr(self.plugin, "teleports", None)
        if st.get("reopened") and tp is not None:
            # opened with /menu or the compass during play: the usual teleport (3-second wait, /back works)
            self.open.pop(str(player.unique_id), None)
            self.music(player, False)
            try:
                player.close_form()
            except Exception:
                pass
            return tp.go(player, lambda: spot, label)
        self.done(player, spot=spot, label=label, greet=False)
        try:
            player.close_form()
        except Exception:
            pass

    def subform(self, player, form):
        """A popup on top of the menu (name a home, confirm a delete...): closing it goes back to the menu."""
        form.on_close = lambda p: self.show(p)
        player.send_form(form)

    def home_name_form(self, player, rename=None):
        from endstone.form import ModalForm, TextInput
        tp = getattr(self.plugin, "teleports", None)
        if tp is None:
            return
        homes = [h["name"] for h in self.homes_of(player)]
        if rename is None and len(homes) >= tp.max_homes(player):
            limit = tp.max_homes(player)
            player.send_message(f"§cYou can have up to {limit} home{'s' if limit != 1 else ''}. §7Delete one first (the trash can).")
            return self.show(player)
        default = rename or ("home" if "home" not in homes else next(f"home{n}" for n in range(2, 1000) if f"home{n}" not in homes))

        cur_icon = self.icon_key_of(player, rename) if rename else HOME_ICONS[0][0]
        icon_names = [n for n, _ in HOME_ICONS]

        def submit(p, data):
            try:
                vals = json.loads(data)
            except Exception:
                vals = [default, 0]
            name = tp.home_name([str(vals[0] or "")]) if vals else default
            try:
                icon = icon_names[int(vals[1])]
            except Exception:
                icon = cur_icon
            final = name
            if rename is None:
                if name in [h["name"] for h in self.homes_of(p)]:
                    # a new home never replaces one you already have (that's what the move button is for)
                    p.send_message(f"§cYou already have a home called {name}. §7Pick another name, or use the move button.")
                    return self.show(p)
                tp.set_home(p, [name])
            elif name != rename:
                if name in [h["name"] for h in self.homes_of(p)]:
                    p.send_message(f"§cYou already have a home called {name}.")
                    final = rename
                else:
                    tp.db.execute("UPDATE homes SET name = ? WHERE xuid = ? AND name = ?", (name, str(p.xuid), rename))
                    tp.db.commit()
                    p.send_message(f"§aRenamed your home to §f{name}§a.")
            self.set_home_icon(p, final, icon)
            self.show(p)
        from endstone.form import Dropdown
        self.subform(player, ModalForm(title="§lEdit home" if rename else "§lNew home",
                                       controls=[TextInput("Home name (letters and numbers)", "e.g. base", default),
                                                 Dropdown("Icon", icon_names, icon_names.index(cur_icon) if cur_icon in icon_names else 0)],
                                       submit_button="Save", on_submit=submit))

    def confirm(self, player, title, text, yes, then):
        from endstone.form import MessageForm

        def answer(p, choice):
            if choice == 0:
                then(p)
            self.show(p)
        self.subform(player, MessageForm(title=title, content=text, button1=yes, button2="Cancel", on_submit=answer))

    def confirm_delete_home(self, player, name):
        tp = self.plugin.teleports
        self.confirm(player, "§lDelete home?", f"Delete your home §f{name}§r? This can't be undone.", "§cDelete",
                     lambda p: (tp.del_home(p, [name]), self.state(p) and self.state(p).setdefault("psel", {}).update({0: 0})))

    def move_home(self, player, name):
        icon = self.icon_key_of(player, name)
        self.confirm(player, "§lMove home?", f"Move your home §f{name}§r to where you are standing now?", "§aMove it",
                     lambda p: (self.plugin.teleports.set_home(p, [name]), self.set_home_icon(p, name, icon)))

    def warp_to(self, player, name):
        warps = getattr(self.plugin, "warps", None)
        w = warps.find(name) if warps is not None else None
        if w is None:
            player.send_message("§cThat warp doesn't exist any more.")
            return self.show(player)
        warps.log_visit(w["owner"])
        self.leave_to(player, w["spot"], f"{w['ownerName']}'s warp {w['name']}")

    def warp_name_form(self, player):
        from endstone.form import ModalForm, TextInput
        warps = self.plugin.warps
        if not warps.is_pro(player) and not player.is_op:
            player.send_message("§cWarps are a §dGalaxy Pro+§c perk. §7See galaxymc.us/store.")
            return self.show(player)

        def submit(p, data):
            try:
                name = str(json.loads(data)[0] or "")
            except Exception:
                name = ""
            warps.set_warp(p, [name])
            self.show(p)
        self.subform(player, ModalForm(title="§lYour warp", controls=[TextInput("Warp name (3-16 letters, numbers, - or _)", "e.g. MyShop", player.name[:16])],
                                       submit_button="Save", on_submit=submit))

    def move_warp(self, player, name):
        self.confirm(player, "§lMove warp?", f"Move your warp §f{name}§r to where you are standing now?", "§aMove it",
                     lambda p: self.plugin.warps.set_warp(p, [name]))

    def confirm_delete_warp(self, player, name):
        def gone(p):
            self.plugin.warps.del_warp(p, [name])
            self.plugin.economy.set_config("featured_warps", [n for n in self.featured() if n.lower() != name.lower()])
            st = self.state(p)
            if st is not None:
                st.setdefault("psel", {})[1] = 0
        self.confirm(player, "§lDelete warp?", f"Delete the warp §f{name}§r? This can't be undone.", "§cDelete", gone)

    def toggle_featured(self, player, name):
        if not self.can_feature(player):
            return self.show(player)
        cur = self.featured()
        if name.lower() in [n.lower() for n in cur]:
            cur = [n for n in cur if n.lower() != name.lower()]
            player.send_message(f"§7Took §f{name}§7 off Featured Warps.")
        elif len(cur) >= 12:
            player.send_message("§cThere are already 12 Featured Warps. §7Take one off first.")
        else:
            cur.append(name)
            player.send_message(f"§e★ §f{name}§a is now a Featured Warp.")
        self.plugin.economy.set_config("featured_warps", cur[:12])
        self.show(player)

    # ---------- pages ----------
    def page(self, player, title, tabs, tab, body, go_to=None):
        """go_to: optional [(screen, tab)] per button, for buttons that lead somewhere else (e.g. < Back)."""
        st = self.state(player)
        form = ActionForm(title=f"{PAGE}{self.codes(st)}§l{title}", content=body)
        for i, label in enumerate(tabs):
            scr, t = go_to[i] if go_to and i < len(go_to) else (st["screen"], i)
            form.add_button(f"§e§l{label}" if i == tab else label, on_click=lambda p, scr=scr, t=t: self.go(p, scr, t))
        self.send(player, form)

    def show_settings(self, player):
        st = self.state(player)
        pr = self.prefs(player)
        scene = SCENE_NAMES[pr["scene"]] if 0 <= pr["scene"] < len(SCENE_NAMES) else "Random"
        body = ("§l§fSettings§r\n\n"
                f"§fMenu music: {'§aOn' if pr['music'] else '§cOff'}\n§7The music that plays while the Main Menu is open.\n\n"
                f"§fWallpaper: §b{scene}\n§7The picture behind the Main Menu. Random picks a new one every time.\n\n"
                f"§fMain Menu when I join: {'§cSkip' if pr['skip'] else '§aShow'}\n§7Skip it to go straight into the game. "
                "§e/menu§7 and the menu compass still open it.\n\n"
                f"§fSparkles: {'§aOn' if pr['fx'] else '§cOff'}\n§7Little sparkles when you teleport, buy something or get a reward "
                "(the sounds stay on).\n\n§7Tap a button on the left to change a setting.")
        form = ActionForm(title=f"{PAGE}{self.codes(st)}§lSettings", content=body)

        def music(p):
            on = not self.prefs(p)["music"]
            self.set_pref(p, music=on)
            if not on:
                self.music(p, False)
                s = self.state(p)
                if s is not None:
                    s["music"] = False
            self.show(p)

        def wallpaper(p):
            cur = self.prefs(p)["scene"]
            nxt = cur + 1 if cur + 1 < len(SCENES) else -1
            self.set_pref(p, scene=nxt)
            s = self.state(p)
            if s is not None:
                s["scene"] = nxt if nxt >= 0 else random.randrange(len(SCENES))
            self.show(p)

        form.add_button(f"§e§lMenu music: {'On' if pr['music'] else 'Off'}", on_click=music)
        form.add_button(f"Wallpaper: {scene}", on_click=wallpaper)
        form.add_button(f"On join: {'Skip menu' if pr['skip'] else 'Show menu'}",
                        on_click=lambda p: (self.set_pref(p, skip=not self.prefs(p)["skip"]), self.show(p)))
        form.add_button(f"Sparkles: {'On' if pr['fx'] else 'Off'}",
                        on_click=lambda p: (self.set_pref(p, fx=not self.prefs(p)["fx"]), self.show(p)))
        self.send(player, form)

    GUIDE_TABS = ["Tutorial", "Commands", "Rules", "What's New", "Store"]

    def show_guide(self, player):
        """Tutorial & Commands: the tutorial (How to Play), your commands, the rules, what's new and the Store."""
        st = self.state(player)
        tab = max(0, min(int(st.get("tab") or 0), len(self.GUIDE_TABS) - 1))
        body = [self.tutorial_text, self.commands_text, self.rules_text, self.news_text, self.store_text][tab](player)
        self.page(player, "Tutorial & Commands", self.GUIDE_TABS, tab, body)

    def tutorial_text(self, player):
        lines = [f"§l§fWelcome, {player.name}!§r", "", bold(self.data.get("intro"))]
        for t in [t for t in (self.data.get("tabs") or []) if t.get("title")][:8]:
            lines += ["", f"§l§b{t['title']}§r", bold(t.get("text"))]
        return "\n".join(lines)

    def commands_text(self, player):
        cmds = getattr(self.plugin, "commands", None) or {}
        rows = []
        for name in sorted(cmds):
            c = cmds[name]
            perm = (c.get("permissions") or [None])[0]
            try:
                if perm and not player.has_permission(perm):
                    continue
            except Exception:
                continue
            usage = (c.get("usages") or [f"/{name}"])[0]
            usage = re.sub(r"<(\w+): \w+>", r"<\1>", usage)
            usage = re.sub(r"\[(\w+): \w+\]", r"[\1]", usage)
            rows.append(f"§e{usage}§r\n§7{c.get('description') or ''}")
        head = "§l§fYour commands§r\n§7Type them in chat. <these> are needed, [these] are optional.\n"
        return head + "\n" + ("\n".join(rows) if rows else "§7No commands.")

    def rules_text(self, player):
        help_data = getattr(getattr(self.plugin, "help", None), "data", None) or {}
        sections = [s for s in (help_data.get("rules") or []) if s.get("title")][:10]
        lines = []
        for sec in sections:
            lines += [f"§l§6{sec['title']}§r"] + [f"§7•§r {bold(x)}" for x in sec.get("items") or []] + [""]
        lines.append("§7Full rules: §bgalaxymc.us/rules")
        return "\n".join(lines)

    def news_text(self, player):
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
        return "\n".join(lines)

    def store_text(self, player):
        info = plans_info()
        keys = [k for k in ("free", "plus", "pro") if k in info]
        mine = None
        try:
            mine = self.plugin.plans.plan_key(player)
        except Exception:
            pass
        lines = []
        for k in keys:
            plan = info[k]
            price = plan.get("price") or 0
            lines.append(f"§l§d{plan.get('name', k)}§r  " + ("§aFree" if not price else f"§f${price}§7/month")
                         + ("  §a✔ Your plan" if (mine or "free") == k else ""))
            lines += [f"§7•§r {p}" for p in (plan.get("perks") or [])[:12]] + [""]
        lines.append("§7Get it on §bgalaxymc.us/store§7 (plans, crate keys, gift cards and more).")
        return "\n".join(lines)

    # ---------- Help: message the staff ----------
    def ask_help(self, player):
        from endstone.form import ModalForm, TextInput
        support = getattr(self.plugin, "support", None)
        if support is None:
            return self.show(player)

        def submit(p, data):
            try:
                text = str(json.loads(data)[0] or "").strip()[:500]
            except Exception:
                text = ""
            if text:
                support.send(p, text)
            self.show(p)
        self.subform(player, ModalForm(title="§l§bAsk staff for help",
                                       controls=[TextInput("Tell staff what you need. They'll see it on the website and in game, and reply to you.",
                                                           "e.g. My items disappeared after I died", "")],
                                       submit_button="Send to staff", on_submit=submit))

    # ---------- Mail: your website messages and notifications ----------
    def show_mail(self, player):
        st = self.state(player)
        mail = getattr(self.plugin, "mail", None)
        social = getattr(self.plugin, "social", None)
        if mail is None:
            return self.show_title(player)
        if social is not None and not social.linked(player):
            form = ActionForm(title=f"{PAGE}{self.codes(st)}§lMail", content=(
                "§l§fMail§r\n\n§7Your messages and notifications from §bgalaxymc.us§7 show up here.\n\n"
                "Link your account first. It only takes a minute."))
            form.add_button("§e§lMail", on_click=lambda p: self.show(p))
            form.add_button("Link Account", on_click=lambda p: self.go(p, "link"))
            return self.send(player, form)
        if not st.get("mail_loaded"):
            st["mail_loaded"] = True
            mail.refresh(player, then=lambda: self.show(player) if self.state(player) and self.state(player)["screen"] == "mail" else None)
        box = mail.of(player) or {"threads": [], "notifications": []}
        threads, notes = box.get("threads") or [], box.get("notifications") or []
        tab = int(st.get("tab") or 0)   # 0 messages, 1 notifications, 2+ a conversation
        unread_notes = sum(1 for n in notes if n.get("unread"))
        form = ActionForm(title=f"{PAGE}{self.codes(st)}§lMail", content="")
        labels = [f"Messages ({sum(1 for t in threads if t.get('unread'))})" if any(t.get("unread") for t in threads) else "Messages",
                  f"Notifications ({unread_notes})" if unread_notes else "Notifications"]
        for i, label in enumerate(labels):
            form.add_button(f"§e§l{label}" if i == tab else label, on_click=lambda p, i=i: self.go(p, "mail", i))
        if tab == 0:
            body = ["§l§fMessages§r", ""]
            for t in threads:
                body.append(f"{'§c● ' if t.get('unread') else ''}§l§f{t['with']}§r\n§7{'You: ' if t.get('mine') else ''}{t.get('last') or ''}")
                body.append("")
            if not threads:
                body.append("§7No messages yet. Tap §fWrite a message§7 to start one.")
            form.content = "\n".join(body)
            form.add_button("§a+ Write a message", on_click=lambda p: self.write_mail(p))
            for k, t in enumerate(threads):
                form.add_button(f"{'§c● ' if t.get('unread') else ''}{t['with']}",
                                on_click=lambda p, k=k, tid=t["id"]: self.open_thread(p, k, tid))
        elif tab == 1:
            body = ["§l§fNotifications§r", ""]
            for n in notes:
                body.append(f"{'§c● ' if n.get('unread') else ''}§l§f{n.get('title') or ''}§r\n§7{n.get('body') or ''}")
                body.append("")
            if not notes:
                body.append("§7Nothing new.")
            form.content = "\n".join(body)
            if unread_notes:
                form.add_button("Mark all as read", on_click=lambda p: mail.refresh(p, then=lambda: self.go(p, "mail", 1), mark_read=True))
        else:
            tid = st.get("mail_tid")
            k = next((i for i, x in enumerate(threads) if x.get("id") == tid), tab - 2) if tid is not None else tab - 2
            if k >= len(threads):
                return self.go(player, "mail", 0)
            t = threads[k]
            msgs = st.setdefault("mail_thread", {}).get(t["id"])
            if msgs is None:
                st["mail_thread"][t["id"]] = []
                mail.thread(player, t["id"], then=lambda m: (st["mail_thread"].update({t["id"]: m}),
                                                            self.show(player) if self.state(player) and self.state(player)["screen"] == "mail" else None))
                msgs = []
                body = [f"§l§f{t['with']}§r", "", "§7Loading..."]
            else:
                body = [f"§l§f{t['with']}§r", ""] + [f"{'§b' if m.get('mine') else '§e'}{'You' if m.get('mine') else m.get('from')}§7: §f{m.get('body')}"
                                                       for m in msgs]
            form.content = "\n".join(body)
            form.add_button(f"§a§lReply to {t['with']}", on_click=lambda p, t=t: self.write_mail(p, to=t["with"], back=tab))
        self.send(player, form)

    def open_thread(self, player, k, tid):
        st = self.state(player)
        if st is not None:
            st["mail_tid"] = tid
        self.go(player, "mail", 2 + k)

    def write_mail(self, player, to=None, back=0):
        from endstone.form import ModalForm, TextInput
        dms = getattr(self.plugin, "dms", None)
        if dms is None:
            return self.show(player)
        controls = ([] if to else [TextInput("To (their name)", "e.g. Steve", "")]) + [TextInput("Message", "Say hi!", "")]

        def submit(p, data):
            try:
                vals = [str(v or "").strip() for v in json.loads(data)]
            except Exception:
                vals = []
            who, text = (to, vals[0] if vals else "") if to else ((vals + ["", ""])[0], (vals + ["", ""])[1])
            st = self.state(p)
            if who and text:
                dms.send(p, who, text[:500])
                if st is not None:
                    st.pop("mail_thread", None)
                    st["mail_loaded"] = False
            if st is not None:
                st["screen"], st["tab"] = "mail", back
            from endstone_galaxylink.safety import later
            later(self.plugin, p, self.show, 20)   # after the message has gone
        self.subform(player, ModalForm(title=f"§lMessage {to}" if to else "§lNew message", controls=controls,
                                       submit_button="Send", on_submit=submit))

    # ---------- Profile ----------
    def show_profile(self, player):
        st = self.state(player)
        social = getattr(self.plugin, "social", None)
        linked = social is not None and social.linked(player)
        try:
            card = social.card_text(str(player.xuid), player.name, player) if social is not None else f"§l{player.name}"
        except Exception:
            card = f"§l{player.name}"
        hidden = social.card_hidden(player.xuid) if social is not None else False
        try:
            money = self.plugin.economy.balance_text(player)
        except Exception:
            money = ""
        lines = [card, ""]
        ranks = getattr(self.plugin, "ranks", None)
        try:
            rank = ranks.rank_names(player.xuid) if ranks is not None else ""
        except Exception:
            rank = ""
        if rank and rank != "No rank":
            lines.append(f"§dRank: §f{rank}")
        if money:
            lines.append(f"§eMoney: §f{money}")
        try:   # the 3 best achievements they have (the biggest rewards)
            from endstone_galaxylink.progress import ACHIEVEMENTS
            got = set(self.plugin.progress.stats(player).get("achievements") or [])
            best = sorted([a for a in ACHIEVEMENTS if a[0] in got], key=lambda a: -a[4])[:3]
            lines += ["", f"§l§fTop achievements§r §7({len(got)}/{len(ACHIEVEMENTS)})"] + ([f"§6★ §f{a[1]}§7: {a[2]}" for a in best] or ["§7None yet. Type /achievements to see them."])
        except Exception:
            pass
        pets = getattr(self.plugin, "pets", None)
        try:
            mine = pets.of(player.xuid) if pets is not None else []
        except Exception:
            mine = []
        lines += ["", f"§l§fMy Pets§r §7({len(mine)})"] + ([f"§b• §f{p['name'] or 'Unnamed'} §7({p['kind'].title()})" for p in mine[:8]]
                                                         + ([f"§7and {len(mine) - 8} more"] if len(mine) > 8 else [])
                                                         or ["§7No pets yet. Tame a Dumpling or Blub in the Sift, or a Penguin."])
        lines.append("")
        lines += ["§7Friends " + ("§ccan't see§7" if hidden else "§acan see§7") + " your card.",
                  "§aYour account is linked." if linked else "§7Link your account to chat, add friends and see your stats on §bgalaxymc.us§7."]
        form = ActionForm(title=f"{PAGE}{self.codes(st)}§lProfile", content="\n".join(lines))
        form.add_button("§e§lProfile", on_click=lambda p: self.show(p))
        if social is not None:
            form.add_button("Show my card to friends" if hidden else "Hide my card from friends",
                            on_click=lambda p: (social.set_card_hidden(p, not hidden), self.show(p)))
        if not linked:
            form.add_button("Link Account", on_click=lambda p: self.go(p, "link"))
        self.send(player, form)

    def closed(self, player):
        """Closed (Back, or the game was still loading): back to the title screen."""
        st = self.state(player)
        if st is None or st["screen"] == "joining":
            return
        st["closes"] += 1
        delay = 2 if st["screen"] != "title" else 10   # the game was still loading: try again in half a second
        if st["screen"] == "title" and st.get("reopened"):
            # a menu opened later (from /menu) can simply be closed
            self.open.pop(str(player.unique_id), None)
            self.music(player, False)
            return
        st["screen"], st["tab"] = "title", 0
        from endstone_galaxylink.safety import later
        later(self.plugin, player, self.show, delay)

    # ---------- joining ----------
    def join(self, player, i, servers=None):
        st = self.state(player)
        servers = servers or self.servers() or [{"name": "GalaxySMP", "action": "play"}]
        if st is None or i >= len(servers):
            return
        s = servers[i]
        action = s.get("action") or "play"
        if action == "soon":
            try:
                player.send_toast("§eComing soon", f"{s['name']} isn't open yet.")
            except Exception:
                pass
            return self.show_play(player)
        spot = None
        if action == "warp":
            warps = getattr(self.plugin, "warps", None)
            w = warps.find(s.get("warp") or "") if warps is not None else None
            if w is None:
                try:
                    player.send_toast("§cNot available", f"{s['name']} isn't open right now.")
                except Exception:
                    pass
                return self.show_play(player)
            spot = w["spot"]
        elif action == "spawn":
            spot = self.plugin.economy.get_config("spawn")
        elif action == "sift":
            sift = getattr(self.plugin, "sift", None)
            if sift is None or not sift.built():
                if st.get("portal"):
                    self.open.pop(str(player.unique_id), None)
                    return player.send_message("§bThe Sift is coming soon! §7It isn't open yet.")
                from endstone_galaxylink import sift as SF
                done = len(self.plugin.economy.get_config(SF.PIECES) or []) if sift is not None else 0
                total = len(SF.TILES)
                st["screen"], st["tab"] = "play", 2
                return self.page(player, "The Sift", ["< Back"], 0,
                                 f"§l§bComing soon!§r\n\nThe Sift is still being made ({min(done, total)}/{total} pieces).\n§7Keep an eye on #Updates.",
                                 go_to=[("play", 2)])
            spot = sift.spot()
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
            social = getattr(self.plugin, "social", None)
            if social is not None and action != "soon":
                social.follow_leader(p, spot=spot, label=shown)
            try:
                p.close_form()
            except Exception:
                pass
        later(self.plugin, player, finish, JOIN_TICKS)

    def done(self, player, spot=None, label=None, action="play", greet=True):
        st = self.open.pop(str(player.unique_id), None)
        if st is None:
            return
        self.lock(player, False)
        self.music(player, False)
        if spot is None and st["new"]:
            spot = self.plugin.economy.get_config("spawn")   # brand-new players start at spawn
        tp = getattr(self.plugin, "teleports", None)
        if spot and tp is not None:
            try:
                player.teleport(tp.location(spot))
            except Exception as e:
                self.plugin.logger.warning(f"Main Menu: couldn't move {player.name}: {e}")
                player.send_message(f"§cSorry, we couldn't take you to {label or 'that server'}. §7Please tell staff.")
        try:
            player.play_sound(player.location, "random.levelup", 0.6, 1.2)
        except Exception:
            pass
        try:
            player.send_title(f"§b§l{label or 'GalaxySMP'}", "§7Have fun!" if greet else "", 5, 40, 15)
        except Exception:
            pass
        if not st.get("reopened") and greet:
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
                free = inv.first_empty() if callable(inv.first_empty) else inv.first_empty
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
            if st is not None and not st.get("reopened") and not self.in_minigame(event.actor):
                event.is_cancelled = True
                return True
        except Exception:
            pass
        return False

    def keep_frozen(self, player):
        return False   # menus already stop players from moving; walk_speed is never touched
