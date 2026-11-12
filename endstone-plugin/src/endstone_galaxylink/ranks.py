"""Ranks: chat and name-tag prefixes, command permissions, and the /ranks menu.

Ranks are stored on the GalaxySMP website. The website sends the full list over the
voice connection whenever anything changes; edits made in the /ranks menu are sent
to the website, which then sends the updated list back to the server.
"""

import json
import threading

from endstone.form import ActionForm, Dropdown, ModalForm, TextInput, Toggle

# Grouped by shade; codes g-v are Bedrock-only colors.
COLORS = [
    ("f", "White"), ("h", "Quartz"), ("i", "Iron"), ("7", "Gray"),
    ("8", "Dark Gray"), ("j", "Netherite"), ("0", "Black"), ("c", "Red"),
    ("4", "Dark Red"), ("m", "Redstone"), ("v", "Resin"), ("n", "Copper"),
    ("6", "Gold"), ("p", "Deep Gold"), ("g", "Minecoin Gold"), ("e", "Yellow"),
    ("a", "Green"), ("q", "Emerald"), ("2", "Dark Green"), ("b", "Aqua"),
    ("s", "Diamond"), ("3", "Dark Aqua"), ("9", "Blue"), ("1", "Dark Blue"),
    ("t", "Lapis"), ("d", "Light Purple"), ("u", "Amethyst"), ("5", "Dark Purple"),
]
# A rank's staff powers on the website (ranks are the roles in game and on the site).
WEB_ROLES = [(None, "None"), (3, "Moderator"), (4, "Admin")]

# Rank icons drawn by the GalaxySMP Icons resource pack (glyph_F7.png, U+F710 onward; moved from E2 because other add-ons use E2).
ICONS = ["crown", "star", "shield", "sword", "gem", "heart", "hammer", "flame", "bolt", "rocket", "planet", "leaf",
           "pickaxe", "axe", "bow", "potion", "book", "key", "trophy", "medal", "code", "music", "paw", "fish",
           "mushroom", "flower", "moon", "sun", "snowflake", "skull", "ghost", "eye", "coin", "moneybag", "gift", "cake",
           "cookie", "apple", "bell", "lightbulb", "magnet", "compass", "clock", "hourglass", "flag", "anchor", "feather", "droplet",
           "tree", "cactus", "cloud", "rainbow", "cat", "slime", "dice", "gamepad", "redstone", "diamond", "emerald", "netherite",
           "goldingot", "ironingot", "amethyst", "lapis", "shootingstar", "wingeddiamond"]
GLYPHS = {name: chr(0xF710 + i) for i, name in enumerate(ICONS)}

# Typed command names -> permission nodes. Same rules as the website (src/routes/ranks.js).
ENDSTONE_COMMANDS = {"ban", "banip", "banlist", "plugins", "reload", "seed", "status", "unban", "unbanip", "version"}
PLUGIN_COMMANDS = {"link", "ranks", "money", "pay", "baltop", "setmoney", "addmoney", "takemoney", "shop", "sell", "ah", "shopnpc",
                   "guide", "tpa", "tpahere", "tpaccept", "tpdeny", "spawn", "setspawn", "home", "sethome", "delhome", "homes", "back", "plan", "plot", "plotaxe", "minigames", "tpd", "chatfilter", "announce", "report", "mod", "modban", "inspect", "rollback", "daily", "quests", "achievements", "stats", "leaderboard", "jobs", "crates", "givekey", "elevator", "bedwars", "leave"}
ALIASES = {"tp": "teleport", "msg": "tell", "w": "tell", "bal": "money", "balance": "money", "auction": "ah", "menu": "guide", "tpyes": "tpaccept", "plots": "plot", "minigame": "minigames", "mg": "minigames", "tpno": "tpdeny",
           "ban-ip": "banip", "unban-ip": "unbanip", "pardon": "unban"}
PREFIXES = ("minecraft.command.", "endstone.command.", "galaxylink.command.")


def command_permission(name):
    name = str(name).strip().lstrip("/").split(" ")[0].lower()
    name = ALIASES.get(name, name)
    if not name or not all(c.isalnum() or c in "_-" for c in name):
        return None
    if name in ENDSTONE_COMMANDS:
        return "endstone.command." + name
    if name in PLUGIN_COMMANDS:
        return "galaxylink.command." + name
    return "minecraft.command." + name


def split_permissions(perms):
    """-> (command names, other permission nodes)"""
    cmds, other = [], []
    for p in perms:
        for pre in PREFIXES:
            if p.startswith(pre):
                cmds.append(p[len(pre):])
                break
        else:
            other.append(p)
    return cmds, other


# Hex values of the Bedrock colors (for gradients). Same as the website (public/js/rank-paint.js).
HEX = {
    "f": "#FFFFFF", "h": "#E3D4D1", "i": "#CECACA", "7": "#AAAAAA", "8": "#555555", "j": "#443A3B", "0": "#000000",
    "c": "#FF5555", "4": "#AA0000", "m": "#971607", "v": "#EB7114", "n": "#B4684D", "6": "#FFAA00", "p": "#DEB12D",
    "g": "#DDD605", "e": "#FFFF55", "a": "#55FF55", "q": "#47A036", "2": "#00AA00", "b": "#55FFFF", "s": "#2CBAA8",
    "3": "#00AAAA", "9": "#5555FF", "1": "#0000AA", "t": "#21497B", "d": "#FF55FF", "u": "#9A5CC6", "5": "#AA00AA",
}
PALETTE_ORDER = [c for c, _ in COLORS]  # same order as the website, so ties pick the same color

# Gradients: a hand-picked chain of real Bedrock colors in smooth order (Bedrock has no hex colors,
# only these 28). Each letter gets its own step along the chain, so a name shows as many different
# colors as it has letters (up to the chain's length), from the first color to the last.
GRADIENTS = {
    "galaxy": ("Galaxy (logo)", ["b", "s", "3", "9", "t"]),
    "gold": ("Gold Rush", ["e", "g", "p", "6", "v", "n"]),
    "sunset": ("Sunset", ["e", "g", "6", "v", "c", "d", "u"]),
    "fire": ("Fire", ["e", "g", "6", "v", "c", "m", "4"]),
    "ocean": ("Ocean", ["f", "b", "s", "3", "9", "t"]),
    "forest": ("Forest", ["e", "a", "q", "2", "s", "3"]),
    "royal": ("Royal", ["f", "d", "u", "5", "9"]),
    "ice": ("Ice", ["f", "h", "i", "b", "s", "3"]),
    "shadow": ("Shadow", ["f", "h", "i", "7", "8"]),
    "rainbow": ("Rainbow", ["c", "v", "6", "g", "e", "a", "q", "b", "s", "9", "u", "d"]),
    "aurora": ("Aurora", ["a", "q", "s", "b", "9", "u", "d"]),
    "cherry": ("Cherry Blossom", ["f", "h", "d", "u", "5"]),
    "ember": ("Ember", ["e", "6", "v", "n", "c", "m", "4"]),
}


# Smooth hex colors for each gradient, used for rank tag pictures (ranktags.py) and on the website.
GRADIENT_HEX = {
    "galaxy": ["#4FEBFD", "#3DAAF4", "#2149DD"],
    "gold": ["#FFF27A", "#FFD23F", "#FFAA00", "#E07B00"],
    "sunset": ["#FFE45C", "#FF9A3D", "#FF5E62", "#D94BFF"],
    "fire": ["#FFF35C", "#FFB000", "#FF5A00", "#C80000"],
    "ocean": ["#C9FFFF", "#4FE3F0", "#1FA2C8", "#2463B8"],
    "forest": ["#C6FF6B", "#5BE35B", "#22A447", "#14806E"],
    "royal": ["#FF8AF2", "#C36BFF", "#8A3CFF", "#4F56FF"],
    "ice": ["#FFFFFF", "#D6F6FF", "#8EE3FF", "#4FC3E8"],
    "shadow": ["#F2F2F2", "#B8B8C8", "#7A7A8C", "#4A4A58"],
    "rainbow": ["#FF4D4D", "#FFA53D", "#FFF04D", "#5BFF6B", "#4DE8FF", "#5C6BFF", "#D45CFF"],
    "aurora": ["#7CFF8A", "#3DF0C8", "#4DB8FF", "#9A6BFF", "#FF6BE1"],
    "cherry": ["#FFFFFF", "#FFC6E3", "#FF7FC4", "#C25CD6"],
    "ember": ["#FFE45C", "#FF9A1F", "#FF4A1F", "#B31212"],
}
PICTURES = None  # set by the plugin: ranktags.RankTags (smooth gradient tags as pictures)


def tag_spec(tag):
    """What the rank tag pictures need: the prefix and the gradient's hex colors."""
    return {"prefix": tag.get("prefix", ""), "stops": GRADIENT_HEX.get(tag.get("gradient") or "")}


def _rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


_PALETTE = [(c, _rgb(HEX[c])) for c in PALETTE_ORDER]


def _nearest(r, g, b):
    best, best_d = None, float("inf")
    for code, (R, G, B) in _PALETTE:
        rm = (r + R) / 2
        d = (2 + rm / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - rm) / 256) * (b - B) ** 2
        if d < best_d:
            best, best_d = code, d
    return best


def gradient_code(chain, k, n):
    """The Bedrock color code for letter k of n: spread over the whole chain, every letter a new color
    while there are colors left, then even blocks of each color for long names."""
    m = len(chain)
    if n <= 1 or m == 1:
        return chain[0]
    if n <= m:
        return chain[int(k * (m - 1) / (n - 1) + 0.5)]  # rounds halves up, like the website
    return chain[min(m - 1, k * m // n)]


def paint(text, rank, bold=False):
    """Colors text with the rank's color, or one gradient color per letter."""
    b = "§l" if bold else ""
    grad = GRADIENTS.get((rank or {}).get("gradient") or "")
    if not grad:
        return f"§{rank['color'] if rank else 'f'}{b}{text}"
    icon = lambda ch: 0xE000 <= ord(ch) <= 0xF8FF
    n = sum(1 for ch in text if not ch.isspace() and not icon(ch))
    out, k = [], 0
    for ch in text:
        if ch.isspace() or icon(ch):  # spaces and icons keep their own look
            out.append(ch)
            continue
        out.append(f"§{gradient_code(grad[1], k, n)}{b}{ch}")
        k += 1
    return "".join(out)


MINIGAME_STAFF = "galaxylink.minigames.staff"


def solid(tag):
    """A tag without its gradient: one Minecraft color (the middle of the gradient, or the tag's color)."""
    if not tag:
        return None
    grad = GRADIENTS.get(tag.get("gradient") or "")
    if not grad:
        return tag
    chain = grad[1]
    return {**tag, "gradient": None, "color": chain[len(chain) // 2]}


def tag_text(rank):
    """[👑 OWNER] in the rank's color or gradient (the icon goes inside the brackets).
    Gradient tags are smooth hex-gradient pictures once the rank tag pack is installed."""
    glyph = GLYPHS.get(rank.get("icon") or "")
    pics = PICTURES.glyphs_for(tag_spec(rank)) if PICTURES is not None and rank.get("gradient") else None
    if pics:  # pics = ["[" pictures, "PREFIX]" pictures]; the icon goes in between
        return "§f" + (pics[0] + glyph + " " + pics[1] if glyph else pics[0] + pics[1])
    if glyph:
        text = paint(f"[{glyph} {rank['prefix']}]", rank)
        return text
    return paint(f"[{rank['prefix']}]", rank)


def name_text(player_name, rank, bold=False):
    """A player's name in their rank's color or gradient (smooth pictures once installed)."""
    if PICTURES is not None and rank and rank.get("gradient"):
        pics = PICTURES.glyphs_for_text(player_name, GRADIENT_HEX.get(rank["gradient"]))
        if pics:
            return "§f" + pics
    return paint(player_name, rank, bold)


class RankManager:
    def __init__(self, plugin):
        self.plugin = plugin
        self.ranks = {}        # id -> rank
        self.assign = {}       # xuid -> [rank ids], top of the Rank order first
        self.attachments = {}  # player uuid -> PermissionAttachment
        self.plan_priority = {"pro": 50, "plus": 60}  # Galaxy+ / Pro+ tags on the same 1-255 scale as ranks

    # ---------- state from the website ----------
    def update(self, msg):
        self.received = True  # gradient pictures are only built once the real ranks are here
        self.ranks = {r["id"]: r for r in msg.get("ranks", [])}
        if isinstance(msg.get("planPriority"), dict):
            self.plan_priority = {k: int(v) for k, v in msg["planPriority"].items()}
        sets = msg.get("rankSets")
        if isinstance(sets, dict):  # several ranks per player (website 2.25+)
            self.assign = {str(k): [i for i in v if i is not None] for k, v in sets.items() if isinstance(v, list)}
        else:
            self.assign = {str(k): [v] for k, v in (msg.get("assignments") or {}).items() if v is not None}
        self.plugin.server.scheduler.run_task(self.plugin, self.apply_all)
        self.plugin.server.scheduler.run_task(self.plugin, self.refresh_pictures)

    def all_tags(self):
        """Every gradient tag on the server: ranks and the Galaxy+ / Pro+ plan tags."""
        tags = [r for r in self.ranks.values() if r.get("gradient")]
        plans = getattr(self.plugin, "plans", None)
        if plans:
            try:
                from endstone_galaxylink.plans import plan_defs
                tags += [p["tag"] for p in plan_defs().values() if p.get("tag") and p["tag"].get("gradient")]
            except Exception:
                pass
        return [tag_spec(t) for t in tags] + self.all_names()

    def all_names(self):
        """Names that show in a gradient: players with a gradient rank, or Galaxy+/Pro+ players without a rank."""
        names = {}
        db = self.plugin.economy.db
        lookup = lambda x: (db.execute("SELECT name FROM balances WHERE xuid = ?", (str(x),)).fetchone() or [None])[0]
        for p in self.plugin.server.online_players:
            names[str(p.xuid)] = p.name
        out = []
        for xuid in self.assign:
            r = self.top_rank(xuid)
            name = names.get(xuid) or lookup(xuid)
            if r and r.get("gradient") and name:
                out.append({"text": name, "stops": GRADIENT_HEX.get(r["gradient"])})
        plans = getattr(self.plugin, "plans", None)
        if plans:
            for xuid, sub in (plans.subs or {}).items():
                if xuid in self.assign:
                    continue
                tag = (plans.defs.get(sub.get("plan")) or {}).get("tag") or {}
                name = names.get(xuid) or lookup(xuid)
                if tag.get("gradient") and name:
                    out.append({"text": name, "stops": GRADIENT_HEX.get(tag["gradient"])})
        return out

    def refresh_pictures(self):
        pics = getattr(self.plugin, "ranktags", None)
        if pics and getattr(self, "received", False):
            try:
                pics.refresh(self.all_tags())
            except Exception as e:
                self.plugin.logger.warning(f"Couldn't build the rank tag pictures: {e}")

    def ranks_of(self, xuid):
        """Every rank a player has, top of the Rank order first."""
        mine = [self.ranks[i] for i in self.assign.get(str(xuid), []) if i in self.ranks]
        return sorted(mine, key=lambda r: (r.get("priority", 100), r.get("position", 0), r["name"].lower()))

    def top_rank(self, xuid):
        mine = self.ranks_of(xuid)
        return mine[0] if mine else None

    def rank_for(self, player):
        """The one rank that shows (tag, name color): the highest in the Rank order."""
        return self.top_rank(player.xuid)

    def ordered(self):
        return sorted(self.ranks.values(), key=lambda r: (r.get("priority", 100), r.get("position", 0), r["name"].lower()))

    def display_tag(self, player):
        """The ONE tag a player shows: their rank or their plan's tag (Galaxy+ / Pro+), whichever has the
        better priority (1 = highest, 255 = lowest). Owner (1) with Pro+ (50) shows OWNER."""
        rank = self.rank_for(player)
        plans = getattr(self.plugin, "plans", None)
        plan_tag = plans.tag_for(player) if plans else None
        if not plan_tag:
            return rank
        if not rank:
            return plan_tag
        plan_pri = self.plan_priority.get(plans.plan_key(player), 100)
        return plan_tag if plan_pri < int(rank.get("priority", 100)) else rank

    # ---------- effects in game ----------
    def apply_all(self):
        for p in self.plugin.server.online_players:
            self.apply_permissions(p)
        self.plugin.refresh_tags()

    def apply_permissions(self, player):
        key = str(player.unique_id)
        old = self.attachments.pop(key, None)
        if old is not None:
            try:
                old.remove()
            except Exception:
                pass
        perms = {perm for rank in self.ranks_of(player.xuid) for perm in rank.get("permissions") or []}
        if perms:  # commands from every rank the player has
            att = player.add_attachment(self.plugin)
            for perm in sorted(perms):
                att.set_permission(perm, True)
            self.attachments[key] = att
        try:
            player.recalculate_permissions()
            player.update_commands()
        except Exception:
            pass

    def forget(self, player):
        self.attachments.pop(str(player.unique_id), None)

    def chat_header(self, player):
        """Discord-style chat: the name line, with the smooth gradient pictures and rank icon:
            [👑 OWNER] VisionDevs
        The message itself goes on its own line in plain text, so Bedrock keeps the normal Minecraft font
        (it uses a small fallback font for a whole message as soon as it contains any picture)."""
        style = self.display_tag(player)
        tags = [tag_text(style)] if style else []
        name = name_text(player.name, style, bold=True) if style else f"§f§l{player.name}"
        return ("§r ".join(tags) + "§r " if tags else "") + name + "§r"

    def chat_format(self, player):
        """[OWNER] **player1**: message  (rank color on the tag and name, never on the message)

        Bedrock draws a whole chat line in its small fallback font as soon as the line has ANY special
        character (icon or gradient pictures, arrows, emoji). So by default chat uses only normal
        characters and color codes: the message always stays in the normal Minecraft font.
        (Pictures still show above heads. /ranktags chat on puts them in chat too.)"""
        # Chat has no gradients (those are only above heads): the tag and name are one solid color,
        # and only the one tag with the best priority shows.
        style = solid(self.display_tag(player))
        prefix = paint(f"[{style['prefix']}]", style) + "§r " if style else ""
        name = paint("\x00", style, True) if style else "§f§l\x00"  # placeholder for {0}
        fmt = (prefix + name).replace("{", "{{").replace("}", "}}").replace("\x00", "{0}")
        return fmt + "§r§7:§r {1}"

    # ---------- /ranks menu ----------
    def open_menu(self, player):
        form = ActionForm(
            title="GalaxySMP Ranks",
            content=f"{len(self.ranks)} rank(s). Changes also show on galaxymc.us (Staff Tools > Ranks).",
        )
        form.add_button("Give a rank", on_click=self.menu_give)
        form.add_button("Remove a rank", on_click=self.menu_remove)
        form.add_button("Edit a rank", on_click=self.menu_edit)
        form.add_button("Create a rank", on_click=lambda p: self.rank_form(p, None))
        player.send_form(form)

    def rank_names(self, xuid):
        mine = self.ranks_of(xuid)
        return ", ".join(r["name"] for r in mine) if mine else "No rank"

    def menu_give(self, player):
        if not self.ranks:
            player.send_message("§eThere are no ranks yet. Create one first.")
            return
        form = ActionForm(title="Give a rank", content="Choose a player. Players can have several ranks: they get the commands of all of them, and only the highest one shows.")
        for target in self.plugin.server.online_players:
            form.add_button(f"{target.name}\n§8{self.rank_names(target.xuid)}",
                            on_click=lambda p, t=(str(target.xuid), target.name): self.menu_pick_rank(p, t))
        player.send_form(form)

    def menu_pick_rank(self, player, target):
        xuid, name = target
        have = set(self.assign.get(xuid, []))
        choices = [r for r in self.ordered() if r["id"] not in have]
        if not choices:
            player.send_message(f"§e{name} already has every rank.")
            return
        form = ActionForm(title=f"Give {name} a rank", content=f"{name} has: {self.rank_names(xuid)}")
        for rank in choices:
            form.add_button(f"{tag_text(rank)}§r {rank['name']}",
                            on_click=lambda p, r=rank: self.send(p, {"action": "give", "xuid": xuid, "rankId": r["id"]},
                                                                 f"Gave {name} the rank {r['name']}."))
        player.send_form(form)

    def menu_remove(self, player):
        holders = [t for t in self.plugin.server.online_players if self.ranks_of(t.xuid)]
        if not holders:
            player.send_message("§eNo online players have a rank. Use the website to manage offline players.")
            return
        form = ActionForm(title="Remove a rank", content="Choose a player.")
        for target in holders:
            form.add_button(f"{target.name}\n§8{self.rank_names(target.xuid)}",
                            on_click=lambda p, t=(str(target.xuid), target.name): self.menu_pick_remove(p, t))
        player.send_form(form)

    def menu_pick_remove(self, player, target):
        xuid, name = target
        mine = self.ranks_of(xuid)
        form = ActionForm(title=f"Remove a rank from {name}", content="Choose the rank to take away.")
        for rank in mine:
            form.add_button(f"{tag_text(rank)}§r {rank['name']}",
                            on_click=lambda p, r=rank: self.send(p, {"action": "take", "xuid": xuid, "rankId": r["id"]},
                                                                 f"Removed the rank {r['name']} from {name}."))
        if len(mine) > 1:
            form.add_button("§cRemove all ranks", on_click=lambda p: self.send(p, {"action": "take", "xuid": xuid, "rankId": None},
                                                                               f"Removed all ranks from {name}."))
        player.send_form(form)

    def menu_edit(self, player):
        if not self.ranks:
            player.send_message("§eThere are no ranks yet. Create one first.")
            return
        form = ActionForm(title="Edit a rank", content="Choose a rank.")
        for rank in self.ordered():
            form.add_button(f"{tag_text(rank)}§r {rank['name']}", on_click=lambda p, r=rank: self.rank_form(p, r))
        player.send_form(form)

    def rank_form(self, player, rank):
        r = rank or {"name": "", "prefix": "", "color": "f", "icon": None, "permissions": [], "websiteRole": None}
        color_index = next((i for i, (c, _) in enumerate(COLORS) if c == r["color"]), 0)
        role_index = next((i for i, (v, _) in enumerate(WEB_ROLES) if v == r.get("websiteRole")), 0)
        icon_index = ICONS.index(r["icon"]) + 1 if r.get("icon") in ICONS else 0
        grad_keys = list(GRADIENTS)
        gradient_index = grad_keys.index(r["gradient"]) + 1 if r.get("gradient") in GRADIENTS else 0
        cmds, other = split_permissions(r["permissions"])
        mg_staff = MINIGAME_STAFF in other
        other = [x for x in other if x != MINIGAME_STAFF]
        controls = [
            TextInput("Rank name", "e.g. Builder", r["name"]),
            TextInput("Prefix (shown as [PREFIX])", "e.g. BUILDER", r["prefix"]),
            Dropdown("Color", [f"§{c}{n}" for c, n in COLORS], color_index),
            Dropdown("Gradient (overrides the color)", ["None"] + [paint(label, {"gradient": key}) for key, (label, _) in GRADIENTS.items()],
                     gradient_index),
            Dropdown("Icon", ["None"] + [f"{GLYPHS[n]} {n.title()}" for n in ICONS], icon_index),
            Dropdown("Staff powers on the website", [n for _, n in WEB_ROLES], role_index),
            TextInput("Commands this rank can use, separated by spaces. /time also allows /time set day.",
                      "e.g. time weather gamemode", " ".join(cmds)),
            TextInput("Advanced: other permission nodes (optional)", "e.g. someplugin.fly", " ".join(other)),
            Toggle("Minigame Staff (accepts minigame host requests)", mg_staff),
        ]
        if rank:
            controls.append(Toggle("§cDelete this rank", False))

        def submit(p, data):
            try:
                values = json.loads(data)
            except ValueError:
                return
            if rank and values[-1]:
                self.send(p, {"action": "delete", "id": rank["id"]}, f"Deleted the rank {rank['name']}.")
                return
            perms = [command_permission(c) for c in str(values[6]).replace(",", " ").split()]
            perms = [x for x in perms if x] + [x.lower() for x in str(values[7]).replace(",", " ").split()]
            perms = [x for x in perms if x != MINIGAME_STAFF] + ([MINIGAME_STAFF] if len(values) > 8 and values[8] is True else [])
            body = {
                "action": "update" if rank else "create",
                "id": rank["id"] if rank else None,
                "name": values[0],
                "prefix": values[1],
                "color": COLORS[int(values[2])][0],
                "gradient": grad_keys[int(values[3]) - 1] if int(values[3]) > 0 else None,
                "icon": ICONS[int(values[4]) - 1] if int(values[4]) > 0 else None,
                "websiteRole": WEB_ROLES[int(values[5])][0],
                "permissions": list(dict.fromkeys(perms)),
            }
            self.send(p, body, "Rank saved." if rank else "Rank created.")

        player.send_form(ModalForm(
            title=f"Edit {rank['name']}" if rank else "Create a rank",
            controls=controls,
            submit_button="Save",
            on_submit=submit,
        ))

    # ---------- talk to the website ----------
    def send(self, player, body, success):
        body["by"] = {"name": player.name, "xuid": str(player.xuid)}
        uid = player.unique_id

        def work():
            try:
                status, data = self.plugin._request("/api/plugin/ranks", body)
                ok = status == 200 and data.get("ok")
                msg = success if ok else (data.get("message") or data.get("error") or "Couldn't save.")
            except Exception:
                ok, msg = False, "The website could not be reached. Please try again."

            def reply():
                p = self.plugin.server.get_player(uid)
                if p is not None:
                    p.send_message(("§a" if ok else "§c") + msg)
            self.plugin.server.scheduler.run_task(self.plugin, reply)

        threading.Thread(target=work, daemon=True).start()
