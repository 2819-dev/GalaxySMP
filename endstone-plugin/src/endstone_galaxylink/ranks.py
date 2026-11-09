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
WEB_ROLES = [(None, "None"), (2, "VIP"), (3, "Moderator"), (4, "Admin")]

# Rank icons drawn by the GalaxySMP Icons resource pack (glyph_E2.png, U+E210 onward).
ICONS = ["crown", "star", "shield", "sword", "gem", "heart", "hammer", "flame", "bolt", "rocket", "planet", "leaf",
           "pickaxe", "axe", "bow", "potion", "book", "key", "trophy", "medal", "code", "music", "paw", "fish",
           "mushroom", "flower", "moon", "sun", "snowflake", "skull", "ghost", "eye", "coin", "moneybag", "gift", "cake",
           "cookie", "apple", "bell", "lightbulb", "magnet", "compass", "clock", "hourglass", "flag", "anchor", "feather", "droplet",
           "tree", "cactus", "cloud", "rainbow", "cat", "slime", "dice", "gamepad", "redstone", "diamond", "emerald", "netherite",
           "goldingot", "ironingot", "amethyst", "lapis", "shootingstar", "wingeddiamond"]
GLYPHS = {name: chr(0xE210 + i) for i, name in enumerate(ICONS)}

# Typed command names -> permission nodes. Same rules as the website (src/routes/ranks.js).
ENDSTONE_COMMANDS = {"ban", "banip", "banlist", "plugins", "reload", "seed", "status", "unban", "unbanip", "version"}
PLUGIN_COMMANDS = {"link", "ranks", "money", "pay", "baltop", "setmoney", "addmoney", "takemoney", "shop", "sell", "ah", "shopnpc",
                   "guide", "tpa", "tpahere", "tpaccept", "tpdeny", "spawn", "setspawn", "home", "sethome", "delhome", "homes", "back", "plan"}
ALIASES = {"tp": "teleport", "msg": "tell", "w": "tell", "bal": "money", "balance": "money", "auction": "ah", "menu": "guide", "tpyes": "tpaccept", "tpno": "tpdeny",
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


# Gradients: one color per letter, stretched across the text. Same list as the website.
GRADIENTS = {
    "galaxy": ("Galaxy (logo)", "bb99"),
    "gold": ("Gold Rush", "egp6"),
    "sunset": ("Sunset", "e6vcd"),
    "fire": ("Fire", "e6vc4"),
    "ocean": ("Ocean", "bs3t"),
    "forest": ("Forest", "aq2"),
    "royal": ("Royal", "du5"),
    "ice": ("Ice", "fhbs"),
    "shadow": ("Shadow", "78j"),
    "rainbow": ("Rainbow", "c6eab9d"),
}


def paint(text, rank, bold=False):
    """Colors text with the rank's color, or one gradient color per letter."""
    b = "§l" if bold else ""
    grad = GRADIENTS.get((rank or {}).get("gradient") or "")
    if not grad:
        return f"§{rank['color'] if rank else 'f'}{b}{text}"
    stops = grad[1]
    icon = lambda ch: 0xE000 <= ord(ch) <= 0xF8FF
    letters = [i for i, ch in enumerate(text) if not ch.isspace() and not icon(ch)]
    n = len(letters)
    out = []
    for pos, ch in enumerate(text):
        if ch.isspace() or icon(ch):  # spaces and icons keep their own look
            out.append(ch)
            continue
        k = letters.index(pos)
        code = stops[int(k * (len(stops) - 1) / (n - 1) + 0.5)] if n > 1 else stops[0]  # rounds like the website
        out.append(f"§{code}{b}{ch}")
    return "".join(out)


def tag_text(rank):
    """[👑 OWNER] in the rank's color or gradient (the icon goes inside the brackets)."""
    glyph = GLYPHS.get(rank.get("icon") or "")
    if glyph:
        text = paint(f"[{glyph} {rank['prefix']}]", rank)
        return text
    return paint(f"[{rank['prefix']}]", rank)


def name_text(player_name, rank, bold=False):
    return paint(player_name, rank, bold)


class RankManager:
    def __init__(self, plugin):
        self.plugin = plugin
        self.ranks = {}        # id -> rank
        self.assign = {}       # xuid -> rank id
        self.attachments = {}  # player uuid -> PermissionAttachment

    # ---------- state from the website ----------
    def update(self, msg):
        self.ranks = {r["id"]: r for r in msg.get("ranks", [])}
        self.assign = {str(k): v for k, v in (msg.get("assignments") or {}).items()}
        self.plugin.server.scheduler.run_task(self.plugin, self.apply_all)

    def rank_for(self, player):
        return self.ranks.get(self.assign.get(str(player.xuid)))

    def ordered(self):
        return sorted(self.ranks.values(), key=lambda r: (r.get("position", 0), r["name"].lower()))

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
        rank = self.rank_for(player)
        if rank and rank.get("permissions"):
            att = player.add_attachment(self.plugin)
            for perm in rank["permissions"]:
                att.set_permission(perm, True)
            self.attachments[key] = att
        try:
            player.recalculate_permissions()
            player.update_commands()
        except Exception:
            pass

    def forget(self, player):
        self.attachments.pop(str(player.unique_id), None)

    def chat_format(self, player):
        """[👑 OWNER] **player1** → message  (rank color on the tag and name, never on the message)"""
        rank = self.rank_for(player)
        plans = getattr(self.plugin, "plans", None)
        plan_tag = plans.tag_for(player) if plans else None
        tags = [tag_text(t) for t in (rank, plan_tag) if t]
        prefix = "§r ".join(tags) + "§r " if tags else ""
        style = rank or plan_tag  # the name takes the rank's color, or the plan's
        if style and style.get("gradient") in GRADIENTS:
            name = name_text(player.name, style, bold=True)  # each letter its own color
        else:
            name = name_text("\x00", style, bold=True)  # placeholder for {0}
        fmt = (prefix + name).replace("{", "{{").replace("}", "}}").replace("\x00", "{0}")
        return fmt + "§r §7→§r {1}"

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

    def menu_give(self, player):
        if not self.ranks:
            player.send_message("§eThere are no ranks yet. Create one first.")
            return
        form = ActionForm(title="Give a rank", content="Choose a player.")
        for target in self.plugin.server.online_players:
            rank = self.rank_for(target)
            label = f"{target.name}\n§8{rank['name'] if rank else 'No rank'}"
            form.add_button(label, on_click=lambda p, t=(str(target.xuid), target.name): self.menu_pick_rank(p, t))
        player.send_form(form)

    def menu_pick_rank(self, player, target):
        xuid, name = target
        form = ActionForm(title=f"Rank for {name}", content="Choose a rank.")
        for rank in self.ordered():
            form.add_button(f"{tag_text(rank)}§r {rank['name']}",
                            on_click=lambda p, r=rank: self.send(p, {"action": "assign", "xuid": xuid, "rankId": r["id"]},
                                                                 f"Gave {name} the rank {r['name']}."))
        player.send_form(form)

    def menu_remove(self, player):
        holders = [t for t in self.plugin.server.online_players if self.rank_for(t)]
        if not holders:
            player.send_message("§eNo online players have a rank. Use the website to manage offline players.")
            return
        form = ActionForm(title="Remove a rank", content="Choose a player.")
        for target in holders:
            rank = self.rank_for(target)
            form.add_button(f"{target.name}\n§8{rank['name']}",
                            on_click=lambda p, t=(str(target.xuid), target.name): self.send(
                                p, {"action": "assign", "xuid": t[0], "rankId": None}, f"Removed the rank from {t[1]}."))
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
        controls = [
            TextInput("Rank name", "e.g. Builder", r["name"]),
            TextInput("Prefix (shown as [PREFIX])", "e.g. BUILDER", r["prefix"]),
            Dropdown("Color", [f"§{c}{n}" for c, n in COLORS], color_index),
            Dropdown("Gradient (overrides the color)", ["None"] + [paint(label, {"gradient": key}) for key, (label, _) in GRADIENTS.items()],
                     gradient_index),
            Dropdown("Icon", ["None"] + [f"{GLYPHS[n]} {n.title()}" for n in ICONS], icon_index),
            Dropdown("Website role", [n for _, n in WEB_ROLES], role_index),
            TextInput("Commands this rank can use, separated by spaces. /time also allows /time set day.",
                      "e.g. time weather gamemode", " ".join(cmds)),
            TextInput("Advanced: other permission nodes (optional)", "e.g. someplugin.fly", " ".join(other)),
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
