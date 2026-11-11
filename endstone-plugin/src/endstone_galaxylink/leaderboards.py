"""Floating leaderboards: staff place them in the world (e.g. at spawn) and they update by themselves.

/leaderboard   place a board where you stand (choose what it ranks), remove the nearest one, or list them.

Each board is a floating label (floating.py: the galaxysmp:floating_text entity from the GalaxySMP blocks
pack) showing the top 10. If one goes missing it's put back when someone is nearby.
"""

import json
import math

from endstone.form import ActionForm, Dropdown, ModalForm

TAG = "gsmp_lb"
ENTITY = "galaxysmp:floating_text"
PERMISSION = "galaxylink.command.leaderboard"
NEAR = 48

# (key, title, how to show a value)
BOARDS = [
    ("money", "Richest Players", lambda v: __import__("endstone_galaxylink.money", fromlist=["fmt"]).fmt(v)),
    ("playtime", "Most Playtime", lambda v: f"{v // 3600}h {v % 3600 // 60}m"),
    ("mined", "Top Miners", lambda v: f"{v:,} blocks"),
    ("placed", "Top Builders", lambda v: f"{v:,} blocks"),
    ("kills", "Top Mob Hunters", lambda v: f"{v:,} mobs"),
    ("quests", "Most Quests", lambda v: f"{v:,} quests"),
    ("best_streak", "Longest Daily Streak", lambda v: f"{v:,} days"),
    ("achievements", "Most Achievements", lambda v: f"{v:,}"),
]
BOARD_BY_KEY = {b[0]: b for b in BOARDS}
MEDALS = ["§6", "§7", "§c"]


class Leaderboards:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.boards = self.eco.get_config("leaderboards") or []  # [{id, key, dim, x, y, z}]

    def save(self):
        self.eco.set_config("leaderboards", self.boards)

    def allowed(self, p):
        if getattr(p, "is_op", False):
            return True
        try:
            return bool(p.has_permission(PERMISSION))
        except Exception:
            return False

    # ---------- text ----------
    def text(self, key):
        _, title, fmt = BOARD_BY_KEY.get(key, BOARDS[0])
        rows = self.plugin.progress.leaderboard(key, 10)
        lines = [f"§l§d✦ §b{title} §d✦"]
        if not rows:
            lines.append("§7Nobody yet. Be the first!")
        for i, (name, value) in enumerate(rows):
            color = MEDALS[i] if i < 3 else "§f"
            lines.append(f"{color}§l{i + 1}.§r §f{name} §8- §a{fmt(value)}")
        lines.append("§8galaxymc.us/leaderboard")
        return "\n".join(lines)

    # ---------- labels (floating.py does the entities safely) ----------
    def key(self, board):
        return f"lb:{board['id']}"

    def show(self, board):
        ft = getattr(self.plugin, "floating", None)
        if ft:
            ft.set(self.key(board), board["dim"], board["x"], board["y"], board["z"], self.text(board["key"]))

    def update(self):
        """Every minute: refresh the rankings on every board."""
        try:
            for board in self.boards:
                self.show(board)
        except Exception as e:
            self.plugin.logger.warning(f"Leaderboard update failed: {e}")

    # ---------- /leaderboard ----------
    def menu(self, player):
        if not self.allowed(player):
            return player.send_message("§7See the leaderboards on §bgalaxymc.us/leaderboard§7.")
        form = ActionForm(title="§l§bLeaderboards", content=f"{len(self.boards)} floating leaderboard{'s' if len(self.boards) != 1 else ''} placed."
                                                             " They update every minute.")
        form.add_button("§lPlace one here§r\n§8Where you're standing", icon="textures/ui/color_plus", on_click=self.place_form)
        form.add_button("§lRemove the nearest§r\n§8Within 5 blocks", icon="textures/ui/trash", on_click=self.remove_nearest)
        for b in self.boards:
            form.add_button(f"{BOARD_BY_KEY.get(b['key'], BOARDS[0])[1]}\n§8{b['dim']} {int(b['x'])}, {int(b['y'])}, {int(b['z'])}")
        form.add_button("Close")
        player.send_form(form)

    def place_form(self, player):
        def submit(p, data):
            try:
                key = BOARDS[int(json.loads(data)[0])][0]
            except (ValueError, IndexError):
                return
            self.place(p, key)
        player.send_form(ModalForm(title="Place a leaderboard", controls=[Dropdown("What should it rank?", [b[1] for b in BOARDS], 0)],
                                   submit_button="Place here", on_submit=submit))

    def place(self, player, key):
        l = player.location
        for b in self.boards:
            if b["dim"] == player.dimension.name and math.dist((l.x, l.y + 1.0, l.z), (b["x"], b["y"], b["z"])) < 2:
                return player.send_message("§cThere's already a leaderboard here. Move at least 2 blocks away.")
        bid = max([b["id"] for b in self.boards] + [0]) + 1
        board = {"id": bid, "key": key, "dim": player.dimension.name, "x": round(l.x, 2), "y": round(l.y + 1.0, 2), "z": round(l.z, 2)}
        self.boards.append(board)
        self.save()
        self.show(board)
        player.send_message(f"§aPlaced the {BOARD_BY_KEY[key][1]} leaderboard. §7It updates every minute. Step back to see it.")

    def remove_nearest(self, player):
        l = player.location
        best, dist = None, 5.0
        for b in self.boards:
            if b["dim"] != player.dimension.name:
                continue
            d = math.dist((l.x, l.y, l.z), (b["x"], b["y"], b["z"]))
            if d < dist:
                best, dist = b, d
        if not best:
            return player.send_message("§7No leaderboard within 5 blocks.")
        ft = getattr(self.plugin, "floating", None)
        if ft:
            ft.remove(self.key(best))
        self.boards.remove(best)
        self.save()
        player.send_message(f"§aRemoved the {BOARD_BY_KEY.get(best['key'], BOARDS[0])[1]} leaderboard.")
