"""Pet names, babies, Blub shoulder rides and Dumpling bounces.

- Taming a Penguin, Dumpling or Blub asks "What would you like to name your Dumpling?" (no anvil or name tag needed).
- Two tamed pets of the same kind make a baby (feed them their food). The baby belongs to the same owner, who is
  asked to name it. Babies grow up in 20 minutes; baby Dumplings mix their parents' colors (done by the add-on).
- Crouch + tap your own Blub: it hops onto your shoulder (tap again to put it down).
- Jump on a Dumpling: boing! It bounces you up high, with no fall damage when you land.
"""

import re
import time
import uuid

from endstone_galaxylink.penguins import OWNABLE, OWNER_TAG, NAME_TAG, owner_of, type_of
from endstone_galaxylink.floating import dim_cmd

NAME_MAX = 20
BOUNCE_COOLDOWN = 1.2   # seconds between bounces for one player
SAFE_LANDING = 4.0      # seconds without fall damage after a bounce
LIFT_TAG = "gsmp_lift"
PID_TAG = "gsmp_pid_"   # + a short id, so the same pet keeps its entry in My Pets


def clean_name(text):
    """Letters, numbers, spaces and a little punctuation; no color codes."""
    text = re.sub(r"§.", "", str(text or ""))
    text = re.sub(r"[^\w '\-!.?&]", "", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()[:NAME_MAX]


def quote(name):
    return '"' + str(name).replace("\\", "").replace('"', "") + '"'


class Pets:
    def __init__(self, plugin):
        self.plugin = plugin
        self.bounced = {}    # player uuid -> last bounce time
        self.no_dumplings_until = 0   # no dumplings anywhere: skip the bounce check until then
        self.landing = {}    # player uuid -> no fall damage until
        self.on_shoulder = {}  # player uuid -> blub actor id
        self.waiting = []    # pets that just spawned: (time, actor) checked for babies
        self.db = plugin.economy.db
        self.db.execute("CREATE TABLE IF NOT EXISTS pet_book (pet_id TEXT PRIMARY KEY, xuid TEXT, kind TEXT, name TEXT, tamed REAL)")
        self.db.commit()

    # ---------- My Pets (in game on the Profile page, and on galaxymc.us profiles) ----------
    @staticmethod
    def pet_id(actor):
        try:
            for t in actor.scoreboard_tags:
                if str(t).startswith(PID_TAG):
                    return str(t)[len(PID_TAG):]
            pid = uuid.uuid4().hex[:12]
            actor.add_scoreboard_tag(PID_TAG + pid)
            return pid
        except Exception:
            return None

    def remember(self, actor, xuid, what, name=None):
        """A pet was tamed, born or named: keep it in the owner's pet list."""
        pid = self.pet_id(actor)
        if not pid or not xuid:
            return
        kind = str(what).lower()
        row = self.db.execute("SELECT name, tamed FROM pet_book WHERE pet_id = ?", (pid,)).fetchone()
        self.db.execute("INSERT OR REPLACE INTO pet_book (pet_id, xuid, kind, name, tamed) VALUES (?,?,?,?,?)",
                        (pid, str(xuid), kind, name if name is not None else (row[0] if row else None), row[1] if row else time.time()))
        self.db.commit()
        self.sync(xuid)

    def on_death(self, actor):
        """A remembered pet died: it leaves its owner's pet list (in game and on the website)."""
        try:
            pid = next((str(t)[len(PID_TAG):] for t in actor.scoreboard_tags if str(t).startswith(PID_TAG)), None)
        except Exception:
            return
        if not pid:
            return
        row = self.db.execute("SELECT xuid FROM pet_book WHERE pet_id = ?", (pid,)).fetchone()
        if not row:
            return
        self.db.execute("DELETE FROM pet_book WHERE pet_id = ?", (pid,))
        self.db.commit()
        self.sync(row[0])

    def of(self, xuid):
        rows = self.db.execute("SELECT pet_id, kind, name, tamed FROM pet_book WHERE xuid = ? ORDER BY tamed", (str(xuid),)).fetchall()
        return [{"id": r[0], "kind": r[1], "name": r[2] or "", "tamed": r[3]} for r in rows]

    def sync(self, xuid):
        voice = getattr(self.plugin, "_voice", None)
        try:
            if voice is not None and getattr(voice, "ws", None):
                voice.send_json({"type": "pets", "xuid": str(xuid), "pets": self.of(xuid)[:60]})
        except Exception:
            pass

    # ---------- names ----------
    def ask_name(self, player, actor, what, baby=False):
        """A popup to name the pet. Closing it keeps the pet nameless (you can name it later with a name tag)."""
        def show():
            if not player.is_valid or not getattr(actor, "is_valid", True):
                return
            from endstone.form import ModalForm, TextInput
            label = f"What would you like to name your {'baby ' if baby else ''}{what}?"

            def submit(p, data):
                try:
                    import json
                    raw = json.loads(data)[0] if isinstance(data, str) else data[0]
                except Exception:
                    raw = ""
                self.set_name(p, actor, what, raw)
            try:
                player.send_form(ModalForm(title=f"Name your {'baby ' if baby else ''}{what}",
                                           controls=[TextInput(label, f"e.g. {self.example(what)}", "")],
                                           submit_button="Done", on_submit=submit))
            except Exception as e:
                self.plugin.logger.warning(f"Pet name popup failed: {e}")
        # a moment later, so the taming hearts show first
        self.plugin.server.scheduler.run_task(self.plugin, show, delay=12)

    @staticmethod
    def example(what):
        return {"Dumpling": "Bao", "Blub": "Bubbles", "Penguin": "Pebble"}.get(what, "Buddy")

    def set_name(self, player, actor, what, raw):
        name = clean_name(raw)
        if not name:
            return
        filt = getattr(self.plugin, "chatfilter", None)
        try:
            if filt is not None and filt.bad_spans(name):
                player.send_message("§cPlease pick a different name.")
                return self.ask_name(player, actor, what)
        except Exception:
            pass
        try:
            if not actor.is_valid:
                return
            actor.name_tag = name
        except Exception:
            return
        self.remember(actor, player.xuid, what, name)
        player.send_message(f"§aSay hi to §f{name}§a, your {what.lower()}!")

    # ---------- babies ----------
    def on_spawn(self, event):
        """A pet just appeared: if it's next to two pets with the same owner, it's their baby."""
        try:
            if type_of(event.actor) in OWNABLE:
                self.waiting.append((time.time(), event.actor))
        except Exception:
            pass

    def check_babies(self):
        if not self.waiting:
            return
        now = time.time()
        ready, self.waiting = [a for t, a in self.waiting if now - t >= 0.4], [(t, a) for t, a in self.waiting if now - t < 0.4]
        for baby in ready:
            try:
                if not baby.is_valid or owner_of(baby)[0]:
                    continue
                kind = type_of(baby)
                b = baby.location
                owners = {}
                for a in baby.dimension.actors:
                    if a is baby or type_of(a) != kind:
                        continue
                    l = a.location
                    if (l.x - b.x) ** 2 + (l.y - b.y) ** 2 + (l.z - b.z) ** 2 > 36:
                        continue
                    xuid, name = owner_of(a)
                    if xuid:
                        owners.setdefault(xuid, []).append(name)
                for xuid, names in owners.items():
                    if len(names) >= 2:
                        baby.add_scoreboard_tag(OWNER_TAG + xuid)
                        baby.add_scoreboard_tag(NAME_TAG + (names[0] or "").replace(" ", "_"))
                        self.plugin.penguins.hearts(baby)
                        self.remember(baby, xuid, OWNABLE[kind][0])
                        owner = next((p for p in self.plugin.server.online_players if str(p.xuid) == xuid), None)
                        if owner is not None:
                            what = OWNABLE[kind][0]
                            owner.send_message(f"§dYour {what.lower()}s had a baby!")
                            self.ask_name(owner, baby, what, baby=True)
                        break
            except Exception:
                continue

    # ---------- your own pet: crouch + tap ----------
    def on_owner_tap(self, player, actor, kind):
        """Crouch + tap your Blub: on or off your shoulder. Returns True when it handled the tap."""
        if kind != "galaxysmp:blub" or not player.is_sneaking:
            return False
        uid = str(player.unique_id)
        server = self.plugin.server
        sender = server.command_sender
        try:
            actor.add_scoreboard_tag(LIFT_TAG)
            if self.on_shoulder.get(uid) == actor.id:
                server.dispatch_command(sender, f"ride @e[tag={LIFT_TAG}] stop_riding")
                self.on_shoulder.pop(uid, None)
                player.send_message("§bYour blub hops down.")
            else:
                server.dispatch_command(sender, f"ride @e[tag={LIFT_TAG}] start_riding {quote(player.name)} teleport_rider")
                self.on_shoulder[uid] = actor.id
                player.send_message("§bYour blub hops onto your shoulder! Crouch + tap it again to put it down.")
        except Exception:
            pass
        finally:
            try:
                actor.remove_scoreboard_tag(LIFT_TAG)
            except Exception:
                pass
        return True

    def on_quit(self, player):
        uid = str(player.unique_id)
        for d in (self.bounced, self.landing, self.on_shoulder):
            d.pop(uid, None)

    # ---------- dumpling bounce ----------
    def tick(self):
        """Every few ticks: players standing on a dumpling get bounced up (boing!)."""
        self.check_babies()
        now = time.time()
        if now < self.no_dumplings_until:   # none anywhere last time: look again in a couple of seconds
            return
        server = self.plugin.server
        players = [p for p in list(server.online_players) if now - self.bounced.get(str(p.unique_id), 0) >= BOUNCE_COOLDOWN]
        if not players:
            return
        # each world's dumplings are found once per check (not once per player): looking through every entity is slow
        spots = {}
        for p in players:
            try:
                dim = p.dimension
                if dim.name not in spots:
                    spots[dim.name] = [a.location for a in dim.actors if type_of(a) == "galaxysmp:dumpling"]
                l = p.location
                for d in spots[dim.name]:
                    dy = l.y - d.y
                    if abs(l.x - d.x) < 0.55 and abs(l.z - d.z) < 0.55 and 0.25 < dy < 0.9:
                        self.bounce(p, d)
                        break
            except Exception:
                continue
        if not any(spots.values()):
            self.no_dumplings_until = now + 2

    def bounce(self, p, where):
        uid = str(p.unique_id)
        now = time.time()
        self.bounced[uid] = now
        self.landing[uid] = now + SAFE_LANDING
        server = self.plugin.server
        sender = server.command_sender
        name = quote(p.name)
        try:
            server.dispatch_command(sender, f"effect {name} levitation 1 28 true")
            server.dispatch_command(sender, f"execute as {name} at @s run playsound mob.slime.jump @s ~ ~ ~ 1 0.7")
            server.dispatch_command(sender, f"execute in {dim_cmd(p.dimension.name)} run particle minecraft:villager_happy {where.x:.2f} {where.y + 0.6:.2f} {where.z:.2f}")
        except Exception:
            return
        # a short hop of levitation is the "boing"; then it's switched off so you fall back down
        server.scheduler.run_task(self.plugin, lambda: server.dispatch_command(sender, f"effect {name} levitation 0") if p.is_valid else None, delay=5)

    def on_damage(self, event):
        """No fall damage after a dumpling bounce. Returns True when it cancelled the damage."""
        try:
            victim = event.actor
            if not hasattr(victim, "xuid"):
                return False
            if "fall" in str(event.damage_source.type).lower() and self.landing.get(str(victim.unique_id), 0) > time.time():
                event.is_cancelled = True
                return True
        except Exception:
            pass
        return False
