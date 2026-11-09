"""Anti-grief block logs: who placed or broke every block, the inspector and rollbacks.

/inspect     turns the inspector on or off. While it's on, breaking or tapping a block doesn't change
             it; instead chat shows who placed or broke blocks there and when. Placing a block shows
             the history of the empty spot (useful for blocks that were broken).
/rollback    undoes one player's block changes: choose the player, how far back and how far around you.
             Broken blocks come back and placed blocks disappear. Spots someone else changed later are
             left alone. Rollbacks run a few hundred blocks per tick so the server doesn't lag.

Logs are kept for 14 days. (Chest contents and blocks blown up by TNT or creepers aren't logged.)
"""

import json
import time

from endstone.form import ActionForm, Dropdown, ModalForm, TextInput

KEEP_DAYS = 14
BATCH = 250
SPANS = [(10, "10 minutes"), (60, "1 hour"), (360, "6 hours"), (1440, "1 day"), (4320, "3 days"), (10080, "7 days"), (20160, "14 days")]
RADII = [(20, "20 blocks around me"), (50, "50 blocks around me"), (100, "100 blocks around me"), (None, "Everywhere")]
INSPECT_PERMISSION = "galaxylink.command.inspect"
ROLLBACK_PERMISSION = "galaxylink.command.rollback"
AIR = "minecraft:air"


def nice(block_type):
    return str(block_type or "").replace("minecraft:", "").replace("_", " ")


def ago(t):
    s = max(0, int(time.time() - t))
    if s < 60:
        return f"{s}s ago"
    if s < 3600:
        return f"{s // 60}m ago"
    if s < 86400:
        return f"{s // 3600}h ago"
    return f"{s // 86400}d ago"


def states_of(block_or_state):
    try:
        return dict(block_or_state.data.block_states)
    except Exception:
        return {}


class BlockLog:
    def __init__(self, plugin):
        self.plugin = plugin
        self.db = plugin.economy.db
        self.db.execute("""CREATE TABLE IF NOT EXISTS block_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, t REAL, xuid TEXT, name TEXT, action TEXT, dim TEXT, x INTEGER, y INTEGER, z INTEGER,
            old_type TEXT, old_states TEXT, new_type TEXT, new_states TEXT, undone INTEGER DEFAULT 0)""")
        self.db.execute("CREATE INDEX IF NOT EXISTS block_log_pos ON block_log (dim, x, y, z)")
        self.db.execute("CREATE INDEX IF NOT EXISTS block_log_player ON block_log (xuid, t)")
        self.db.commit()
        self.buffer = []
        self.inspecting = set()
        self.last_tap = {}
        self.running = None      # the rollback in progress
        self.last_prune = 0
        self.prune()

    # ---------- permissions ----------
    @staticmethod
    def allowed(p, perm):
        """Operators, players given the permission, and (for the inspector) anyone who can use /mod."""
        if getattr(p, "is_op", False):
            return True
        try:
            return bool(p.has_permission(perm)) or (perm == INSPECT_PERMISSION and bool(p.has_permission("galaxylink.command.mod")))
        except Exception:
            return False

    # ---------- logging ----------
    def flush(self):
        if self.buffer:
            self.db.executemany("""INSERT INTO block_log (t, xuid, name, action, dim, x, y, z, old_type, old_states, new_type, new_states)
                                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", self.buffer)
            self.db.commit()
            self.buffer = []

    def prune(self):
        self.flush()
        self.db.execute("DELETE FROM block_log WHERE t < ?", (time.time() - KEEP_DAYS * 86400,))
        self.db.commit()
        self.last_prune = time.time()

    def tick(self):
        """Every second: save logged changes; once a day, forget old ones."""
        self.flush()
        if time.time() - self.last_prune > 86400:
            self.prune()

    def _add(self, player, action, block, old_type, old_states, new_type, new_states):
        self.buffer.append((time.time(), str(player.xuid), player.name, action, block.dimension.name, block.x, block.y, block.z,
                            old_type, json.dumps(old_states), new_type, json.dumps(new_states)))
        if len(self.buffer) >= 500:
            self.flush()

    def log_break(self, event):
        if event.cancelled:
            return
        b = event.block
        if b.type == AIR:
            return
        self._add(event.player, "break", b, b.type, states_of(b), AIR, {})

    def log_place(self, event):
        if event.cancelled:
            return
        new = event.block_placed_state
        old = event.block_replaced
        self._add(event.player, "place", event.block, old.type, states_of(old), new.type, states_of(new))

    # ---------- inspector ----------
    def toggle(self, player):
        if not self.allowed(player, INSPECT_PERMISSION):
            return player.send_message("§cOnly staff can use the inspector.")
        key = str(player.unique_id)
        if key in self.inspecting:
            self.inspecting.discard(key)
            player.send_message("§7Inspector §coff§7. Blocks work normally again.")
        else:
            self.inspecting.add(key)
            player.send_message("§7Inspector §aon§7. Break or tap a block to see who changed it. Place a block to check an empty spot. "
                                "§e/inspect§7 again to turn it off.")

    def is_inspecting(self, player):
        return str(player.unique_id) in self.inspecting

    def history_at(self, dim, x, y, z, limit=8):
        self.flush()
        return self.db.execute("""SELECT name, action, old_type, new_type, t, undone FROM block_log
                                  WHERE dim = ? AND x = ? AND y = ? AND z = ? ORDER BY t DESC LIMIT ?""", (dim, x, y, z, limit)).fetchall()

    def show(self, player, block):
        rows = self.history_at(block.dimension.name, block.x, block.y, block.z)
        player.send_message(f"§6--- Block history at {block.x}, {block.y}, {block.z} ---")
        if not rows:
            return player.send_message("§7Nobody has changed this block (in the last 14 days).")
        for name, action, old_type, new_type, t, undone in rows:
            what = f"§cbroke§7 {nice(old_type)}" if action == "break" else f"§aplaced§7 {nice(new_type)}"
            player.send_message(f"§f{name} {what} §8({ago(t)}){' §d[rolled back]' if undone else ''}")

    def on_break(self, event):
        """Returns True when the inspector handled it (the block isn't broken)."""
        if self.is_inspecting(event.player):
            event.cancel()
            self.show(event.player, event.block)
            return True
        return False

    def on_place(self, event):
        if self.is_inspecting(event.player):
            event.cancel()
            self.show(event.player, event.block)
            return True
        return False

    def on_interact(self, event):
        p = event.player
        if not self.is_inspecting(p) or not getattr(event, "has_block", False):
            return False
        event.cancel()
        now = time.time()
        if now - self.last_tap.get(str(p.unique_id), 0) > 0.6:  # one tap shows it once
            self.last_tap[str(p.unique_id)] = now
            self.show(p, event.block)
        return True

    # ---------- staff menu ----------
    def menu(self, player):
        form = ActionForm(title="§lBlock logs", content="Find out who placed or broke blocks, and undo griefing.")
        on = self.is_inspecting(player)
        form.add_button(f"§lInspector: {'§aON' if on else '§cOFF'}§r\n§8Tap blocks to see who changed them", icon="textures/ui/magnifying_glass",
                        on_click=lambda p: (self.toggle(p), None)[1])
        if self.allowed(player, ROLLBACK_PERMISSION):
            form.add_button("§lRoll back a player§r\n§8Undo their block changes", icon="textures/ui/refresh_light", on_click=lambda p: self.rollback_form(p))
        mod = getattr(self.plugin, "moderation", None)
        if mod:
            form.add_button("§l< Back", on_click=mod.panel)
        player.send_form(form)

    def player_changes(self, player, xuid, name):
        self.flush()
        rows = self.db.execute("""SELECT action, old_type, new_type, dim, x, y, z, t, undone FROM block_log WHERE xuid = ?
                                  ORDER BY t DESC LIMIT 20""", (str(xuid),)).fetchall()
        lines = [f"{'§cbroke' if a == 'break' else '§aplaced'}§r {nice(o if a == 'break' else n)} at {x}, {y}, {z}"
                 f"{'' if d == 'Overworld' else f' ({d})'} §8{ago(t)}{' [rolled back]' if u else ''}"
                 for a, o, n, d, x, y, z, t, u in rows]
        form = ActionForm(title=f"Block changes: {name}", content="\n".join(lines) if lines else "No block changes in the last 14 days.")
        if rows and self.allowed(player, ROLLBACK_PERMISSION):
            form.add_button("§lRoll back this player", icon="textures/ui/refresh_light", on_click=lambda p: self.rollback_form(p, name))
        mod = getattr(self.plugin, "moderation", None)
        if mod:
            form.add_button("§l< Back", on_click=lambda p: mod.player_menu(p, xuid, name))
        player.send_form(form)

    # ---------- rollback ----------
    def rollback_command(self, player, args):
        self.rollback_form(player, " ".join(args).strip())

    def rollback_form(self, player, name=""):
        if not self.allowed(player, ROLLBACK_PERMISSION):
            return player.send_message("§cYou don't have permission to roll back.")
        if self.running:
            return player.send_message("§eA rollback is already running. Wait for it to finish.")

        def submit(p, data):
            try:
                v = json.loads(data)
            except ValueError:
                return
            self.preview(p, " ".join(str(v[0]).split()), SPANS[int(v[1])], RADII[int(v[2])])
        player.send_form(ModalForm(title="§lRoll back a player", controls=[
            TextInput("Player's gamertag", "e.g. Griefer123", name),
            Dropdown("Undo their changes from the last", [s[1] for s in SPANS], 1),
            Dropdown("Where", [r[1] for r in RADII], 1),
        ], submit_button="Next", on_submit=submit))

    def plan(self, xuid, since, dim=None, center=None, radius=None):
        """What a rollback would do: [(dim, x, y, z, old_type, old_states)] plus the log ids it undoes."""
        self.flush()
        where, args = "xuid = ? AND t >= ? AND undone = 0", [str(xuid), since]
        if radius is not None:
            cx, cz = int(center[0]), int(center[1])
            where += " AND dim = ? AND x BETWEEN ? AND ? AND z BETWEEN ? AND ?"
            args += [dim, cx - radius, cx + radius, cz - radius, cz + radius]
        rows = self.db.execute(f"SELECT id, dim, x, y, z, old_type, old_states, t FROM block_log WHERE {where} ORDER BY t ASC", args).fetchall()
        first, last, by_key, ids = {}, {}, {}, []
        for rid, d, x, y, z, ot, os_, t in rows:
            key = (d, x, y, z)
            first.setdefault(key, (ot, os_))
            last[key] = t
            by_key.setdefault(key, []).append(rid)
        changes = []
        for key, (ot, os_) in first.items():
            later = self.db.execute("SELECT 1 FROM block_log WHERE dim = ? AND x = ? AND y = ? AND z = ? AND xuid <> ? AND t > ? AND undone = 0 LIMIT 1",
                                    (*key, str(xuid), last[key])).fetchone()
            if not later:
                changes.append((*key, ot, json.loads(os_ or "{}")))
                ids += by_key[key]
        return changes, ids

    def preview(self, player, name, span, radius):
        row = self.db.execute("SELECT xuid, name FROM block_log WHERE lower(name) = ? ORDER BY t DESC LIMIT 1", (name.lower().lstrip("."),)).fetchone()
        if not row:
            return player.send_message(f"§c{name or 'That player'} has no logged block changes.")
        xuid, name = row
        center = (player.location.x, player.location.z)
        changes, ids = self.plan(xuid, time.time() - span[0] * 60, player.dimension.name, center, radius[0])
        if not changes:
            return player.send_message(f"§7Nothing to roll back for {name} in the last {span[1]} {radius[1].replace('around me', 'around you').lower()}.")
        form = ActionForm(title="§lConfirm rollback",
                          content=f"Undo §l{len(changes)}§r block change{'s' if len(changes) != 1 else ''} by §l{name}§r from the last {span[1]}"
                                  f" ({radius[1].replace('around me', 'around you').lower()})?\n\n§7Broken blocks come back and placed blocks disappear. "
                                  "Spots other players changed afterwards are left alone. Chest contents can't be restored.")
        form.add_button("§c§lRoll back", on_click=lambda p: self.start(p, xuid, name, changes, ids, span[1]))
        form.add_button("Cancel")
        player.send_form(form)

    def start(self, player, xuid, name, changes, ids, span_label):
        if self.running:
            return player.send_message("§eA rollback is already running.")
        self.running = {"todo": list(changes), "ids": ids, "done": 0, "failed": 0, "by": player, "name": name, "xuid": xuid, "span": span_label}
        player.send_message(f"§eRolling back {len(changes)} blocks by {name}...")
        self._step()

    def restore(self, d, x, y, z, block_type, states):
        dim = self.plugin.server.level.get_dimension(d)
        block = dim.get_block_at(x, y, z)
        block.set_type(block_type, False)
        if states:
            try:
                block.set_data(self.plugin.server.create_block_data(block_type, states), False)
            except Exception:
                pass

    def _step(self):
        r = self.running
        if not r:
            return
        batch, r["todo"] = r["todo"][:BATCH], r["todo"][BATCH:]
        for d, x, y, z, block_type, states in batch:
            try:
                self.restore(d, x, y, z, block_type, states)
                r["done"] += 1
            except Exception:
                r["failed"] += 1
        if r["todo"]:
            self.plugin.server.scheduler.run_task(self.plugin, self._step, delay=1)
            return
        self.db.executemany("UPDATE block_log SET undone = 1 WHERE id = ?", [(i,) for i in r["ids"]])
        self.db.commit()
        self.running = None
        by = r["by"]
        msg = f"§aRollback done: {r['done']} blocks restored for {r['name']}."
        if r["failed"]:
            msg += f" §e{r['failed']} couldn't be changed (probably too far away, in unloaded chunks). Go closer and run it again."
        try:
            by.send_message(msg)
        except Exception:
            pass
        mod = getattr(self.plugin, "moderation", None)
        if mod:
            mod.send("/api/plugin/punish", {"kind": "rollback", "name": r["name"], "xuid": r["xuid"], "blocks": r["done"], "span": r["span"],
                                            "by": getattr(by, "name", "Console"), "byXuid": str(getattr(by, "xuid", "") or "")})
