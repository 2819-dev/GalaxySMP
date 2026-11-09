"""Ranks: chat and name-tag prefixes, command permissions, and the /ranks menu.

Ranks are stored on the GalaxySMP website. The website sends the full list over the
voice connection whenever anything changes; edits made in the /ranks menu are sent
to the website, which then sends the updated list back to the server.
"""

import json
import threading

from endstone.form import ActionForm, Dropdown, ModalForm, TextInput, Toggle

COLORS = [
    ("0", "Black"), ("1", "Dark Blue"), ("2", "Dark Green"), ("3", "Dark Aqua"),
    ("4", "Dark Red"), ("5", "Dark Purple"), ("6", "Gold"), ("7", "Gray"),
    ("8", "Dark Gray"), ("9", "Blue"), ("a", "Green"), ("b", "Aqua"),
    ("c", "Red"), ("d", "Light Purple"), ("e", "Yellow"), ("f", "White"),
]
WEB_ROLES = [(None, "None"), (2, "VIP"), (3, "Moderator"), (4, "Admin")]

# Same list as the website (src/routes/ranks.js).
PERMISSIONS = [
    ("minecraft.command.gamemode", "Change game mode (/gamemode)"),
    ("minecraft.command.teleport", "Teleport (/tp)"),
    ("minecraft.command.give", "Give items (/give)"),
    ("minecraft.command.clear", "Clear inventories (/clear)"),
    ("minecraft.command.effect", "Give effects (/effect)"),
    ("minecraft.command.enchant", "Enchant items (/enchant)"),
    ("minecraft.command.xp", "Give XP (/xp)"),
    ("minecraft.command.time", "Change time (/time)"),
    ("minecraft.command.weather", "Change weather (/weather)"),
    ("minecraft.command.summon", "Summon mobs (/summon)"),
    ("minecraft.command.fill", "Fill blocks (/fill)"),
    ("minecraft.command.setblock", "Place blocks (/setblock)"),
    ("minecraft.command.clone", "Copy blocks (/clone)"),
    ("minecraft.command.kick", "Kick players (/kick)"),
    ("endstone.command.ban", "Ban players (/ban)"),
    ("endstone.command.unban", "Unban players (/unban)"),
]


def tag_text(rank):
    return f"§{rank['color']}[{rank['prefix']}]"


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
        rank = self.rank_for(player)
        if not rank:
            return None
        prefix = tag_text(rank).replace("{", "{{").replace("}", "}}")
        return prefix + "§r <{0}> {1}"

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
        r = rank or {"name": "", "prefix": "", "color": "f", "permissions": [], "websiteRole": None}
        color_index = next((i for i, (c, _) in enumerate(COLORS) if c == r["color"]), 15)
        role_index = next((i for i, (v, _) in enumerate(WEB_ROLES) if v == r.get("websiteRole")), 0)
        controls = [
            TextInput("Rank name", "e.g. Builder", r["name"]),
            TextInput("Prefix (shown as [PREFIX])", "e.g. BUILDER", r["prefix"]),
            Dropdown("Color", [n for _, n in COLORS], color_index),
            Dropdown("Website role", [n for _, n in WEB_ROLES], role_index),
        ]
        controls += [Toggle(label, perm in r["permissions"]) for perm, label in PERMISSIONS]
        if rank:
            controls.append(Toggle("§cDelete this rank", False))
        known = {perm for perm, _ in PERMISSIONS}
        extra = [p for p in r["permissions"] if p not in known]

        def submit(p, data):
            try:
                values = json.loads(data)
            except ValueError:
                return
            if rank and values[-1]:
                self.send(p, {"action": "delete", "id": rank["id"]}, f"Deleted the rank {rank['name']}.")
                return
            perms = [perm for (perm, _), on in zip(PERMISSIONS, values[4:4 + len(PERMISSIONS)]) if on] + extra
            body = {
                "action": "update" if rank else "create",
                "id": rank["id"] if rank else None,
                "name": values[0],
                "prefix": values[1],
                "color": COLORS[int(values[2])][0],
                "websiteRole": WEB_ROLES[int(values[3])][0],
                "permissions": perms,
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
