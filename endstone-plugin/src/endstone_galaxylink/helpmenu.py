"""The Help menu (/guide): Server Information, Rules and Commands.

The text is edited on the website (Staff Tools > Help menu) and sent to the server;
a copy is saved on the server so the menu works even when the website is down.
"""

import json
import re
from importlib import resources

from endstone.form import ActionForm

# The GalaxySMP logo, drawn by the GalaxySMP Icons resource pack (font/glyph_E3.png).
LOGO = "".join(chr(0xE300 + i) for i in range(6))

INFO_ICON = "textures/ui/infobulb"
RULES_ICON = "textures/ui/book_edit_default"
COMMANDS_ICON = "textures/ui/chat_send"


def default_help():
    return json.loads(resources.files("endstone_galaxylink").joinpath("help_default.json").read_text("utf-8"))


def bold(text):
    """**words** -> bold in Minecraft."""
    return re.sub(r"\*\*(.+?)\*\*", lambda m: f"§l{m.group(1)}§r", text)


class HelpMenu:
    def __init__(self, plugin):
        self.plugin = plugin
        self.data = plugin.economy.get_config("help") or default_help()

    def update_from_website(self, msg):
        if isinstance(msg.get("help"), dict):
            self.data = msg["help"]
            self.plugin.economy.set_config("help", self.data)

    # ---------- main menu ----------
    def open(self, player):
        form = ActionForm(title="§lGalaxySMP Help", content="What would you like to see?")
        form.add_button("§lServer Information§r\n§8About GalaxySMP and the website", icon=INFO_ICON, on_click=self.open_info)
        form.add_button("§lRules§r\n§8How we keep GalaxySMP fun and safe", icon=RULES_ICON, on_click=self.open_rules)
        form.add_button("§lCommands§r\n§8What you can type and how", icon=COMMANDS_ICON, on_click=self.open_commands)
        player.send_form(form)

    def back_button(self, form):
        form.add_button("§l< Back", on_click=self.open)

    # ---------- pages ----------
    def open_info(self, player):
        text = bold(self.data.get("info") or "")
        form = ActionForm(title="Server Information", content=f"§r{LOGO}\n\n{text}")
        self.back_button(form)
        player.send_form(form)

    def open_rules(self, player):
        lines = []
        for section in self.data.get("rules") or []:
            lines.append(f"§l§6{section.get('title', '')}§r")
            for item in section.get("items") or []:
                lines.append(f"§7•§r {bold(item)}")
            lines.append("")
        lines.append("§7Full rules: galaxymc.us/rules")
        form = ActionForm(title="Rules", content="\n".join(lines))
        self.back_button(form)
        player.send_form(form)

    def visible_commands(self, player):
        cmds = self.data.get("commands") or []
        return [c for c in cmds if player.is_op or not c.get("staff")]

    def open_commands(self, player):
        cmds = self.visible_commands(player)
        form = ActionForm(title="Commands", content="Tap a command to see an example.")
        for i, c in enumerate(cmds):
            staff = " §c(staff)" if c.get("staff") else ""
            form.add_button(f"§l{c['command']}{staff} §r§8»\n§8{c.get('description', '')}",
                            on_click=lambda p, i=i: self.open_command(p, i))
        self.back_button(form)
        player.send_form(form)

    def open_command(self, player, index):
        cmds = self.visible_commands(player)
        if index >= len(cmds):
            return self.open_commands(player)
        c = cmds[index]
        content = f"§l{c['command']}§r\n{c.get('description', '')}"
        if c.get("example"):
            content += f"\n\n§7Example:§r\n§e{c['example']}"
        form = ActionForm(title=c["command"].split(" ")[0], content=content)
        form.add_button("§l< All commands", on_click=self.open_commands)
        player.send_form(form)
