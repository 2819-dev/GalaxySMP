"""Parkour courses: start plate, checkpoints in order, finish plate, best times.

Staff (operators) build a course with pressure plates and stand on each one to set it up:
  /parkour create <name>       the plate you're on is the START
  /parkour checkpoint <name>   the plate you're on is the next checkpoint (in order)
  /parkour finish <name>       the plate you're on is the FINISH
  /parkour reward <name> <$>   money for finishing the course for the first time (0 = none)
  /parkour delete <name>
Players:
  /parkour                     the courses, your best times and the records (tap one to go to its start)
  /parkour back                back to your last checkpoint
  /parkour leave               stop your run

Stepping on the start starts the timer (shown above the hotbar). Checkpoints count only in order; the finish
counts once every checkpoint is done. Best times go to the website's Leaderboards (Parkour). Plates are checked a
few times a second, like command plates (Endstone has no "stepped on a pressure plate" event).
"""

import math
import time

from endstone.form import ActionForm

from endstone_galaxylink import money
from endstone_galaxylink.plates import key_of

MAX_RUN = 30 * 60      # a run longer than 30 minutes is dropped


def clock(sec):
    m, s = divmod(max(0.0, sec), 60)
    return f"{int(m)}:{s:04.1f}"


class Parkour:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.db = self.eco.db
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS parkour_times (course TEXT, xuid TEXT, name TEXT, best REAL, finishes INTEGER DEFAULT 0,
                                                      at REAL, PRIMARY KEY (course, xuid));
        """)
        self.db.commit()
        self.courses = self.eco.get_config("parkour") or {}   # name -> {start, checkpoints: [], finish, reward, spawn: [dim,x,y,z]}
        self.index = {}
        self.reindex()
        self.runs = {}     # uid -> {course, t0, next, back: (dim, x, y, z), xuid}
        self.on = {}       # uid -> plate key (fires once per step)

    # ---------- setup ----------
    def save(self):
        self.eco.set_config("parkour", self.courses)
        self.reindex()
        self.push()

    def reindex(self):
        self.index = {}
        for name, c in self.courses.items():
            if c.get("start"):
                self.index[c["start"]] = (name, "start", 0)
            for i, k in enumerate(c.get("checkpoints") or []):
                self.index[k] = (name, "cp", i)
            if c.get("finish"):
                self.index[c["finish"]] = (name, "finish", 0)

    @staticmethod
    def feet(p):
        l = p.location
        return p.dimension.name, math.floor(l.x), math.floor(l.y), math.floor(l.z)

    def find(self, name):
        name = (name or "").strip().lower()
        return next((n for n in self.courses if n.lower() == name), None)

    def on_plate(self, p):
        dim, x, y, z = self.feet(p)
        try:
            ok = "pressure_plate" in str(p.dimension.get_block_at(x, y, z).type)
        except Exception:
            ok = False
        return key_of(dim, x, y, z) if ok else None

    def admin(self, p, action, args):
        if not p.is_op:
            return p.send_message("§cOnly staff can set up parkour courses.")
        if action == "create":
            name = " ".join(args).strip()[:24]
            if not name:
                return p.send_message("§eUsage: /parkour create <name>  §7(stand on the start pressure plate)")
            if self.find(name):
                return p.send_message("§cThere's already a course with that name.")
            key = self.on_plate(p)
            if not key:
                return p.send_message("§cStand on a pressure plate first: it becomes the start.")
            if key in self.index:
                return p.send_message("§cThat plate is already part of a course.")
            self.courses[name] = {"start": key, "checkpoints": [], "finish": None, "reward": 0, "by": p.name,
                                  "spawn": [p.dimension.name, round(p.location.x, 1), round(p.location.y, 1), round(p.location.z, 1), round(p.location.yaw)]}
            self.save()
            self.on[str(p.unique_id)] = key
            return p.send_message(f"§aCourse §f{name}§a created. §7Now stand on each checkpoint plate (in order) and type §e/parkour checkpoint {name}§7, then §e/parkour finish {name}§7 on the last plate.")
        name = self.find(args[0] if args else "")
        if not name and action != "list":
            return p.send_message(f"§cNo course called {args[0] if args else '?'}. §7/parkour list shows them.")
        c = self.courses.get(name)
        if action in ("checkpoint", "finish"):
            key = self.on_plate(p)
            if not key:
                return p.send_message("§cStand on a pressure plate first.")
            if key in self.index:
                return p.send_message("§cThat plate is already part of a course.")
            if action == "checkpoint":
                c["checkpoints"].append(key)
                msg = f"§aCheckpoint {len(c['checkpoints'])} added to §f{name}§a."
            else:
                c["finish"] = key
                msg = f"§aFinish set for §f{name}§a. The course is ready! §7(Optional: /parkour reward {name} <amount>)"
            self.save()
            self.on[str(p.unique_id)] = key
            return p.send_message(msg)
        if action == "reward":
            cents = money.parse(args[1]) if len(args) > 1 else None
            if cents is None:
                return p.send_message(f"§eUsage: /parkour reward {name} <amount>  §7(0 for none)")
            c["reward"] = cents
            self.save()
            return p.send_message(f"§aFinishing §f{name}§a for the first time now pays §e{money.exact(cents)}§a.")
        if action == "delete":
            self.courses.pop(name, None)
            self.db.execute("DELETE FROM parkour_times WHERE course = ?", (name,))
            self.db.commit()
            self.save()
            return p.send_message(f"§7Course §f{name}§7 deleted.")
        if action == "list":
            if not self.courses:
                return p.send_message("§7No parkour courses yet. Stand on a pressure plate and type §e/parkour create <name>§7.")
            return p.send_message("§bParkour courses:\n" + "\n".join(
                f"§f{n}§7: {len(c.get('checkpoints') or [])} checkpoints, {'finish set' if c.get('finish') else '§cno finish yet§7'}, reward {money.exact(c.get('reward') or 0)}"
                for n, c in self.courses.items()))

    # ---------- /parkour ----------
    def command(self, p, args):
        action = args[0].lower() if args else ""
        if action in ("create", "checkpoint", "finish", "reward", "delete", "list"):
            return self.admin(p, action, args[1:])
        if action == "leave":
            return p.send_message("§7Parkour run stopped." if self.runs.pop(str(p.unique_id), None) else "§7You're not doing a parkour course.")
        if action == "back":
            return self.back(p)
        self.menu(p)

    def ready(self):
        return {n: c for n, c in self.courses.items() if c.get("start") and c.get("finish")}

    def top(self, course, n=5):
        return self.db.execute("SELECT name, best FROM parkour_times WHERE course = ? ORDER BY best LIMIT ?", (course, n)).fetchall()

    def mine(self, course, xuid):
        r = self.db.execute("SELECT best FROM parkour_times WHERE course = ? AND xuid = ?", (course, str(xuid))).fetchone()
        return r[0] if r else None

    def menu(self, p):
        courses = self.ready()
        form = ActionForm(title="§lParkour", content="Step on a course's start plate to begin. Hit every checkpoint in order, then the finish.\n"
                          "§7/parkour back: last checkpoint · /parkour leave: stop\n" + ("" if courses else "\n§7No courses yet."))
        for name, c in courses.items():
            rec = self.top(name, 1)
            best = self.mine(name, p.xuid)
            sub = (f"Record {clock(rec[0][1])} by {rec[0][0]}" if rec else "No record yet") + (f" · You: {clock(best)}" if best else "")
            form.add_button(f"§l{name}§r\n§8{sub}", on_click=lambda pl, name=name: self.course_menu(pl, name))
        p.send_form(form)

    def course_menu(self, p, name):
        c = self.courses.get(name)
        if not c:
            return
        rows = self.top(name, 10)
        lines = [f"§l{name}§r", f"§7{len(c.get('checkpoints') or [])} checkpoints" + (f" · first finish pays §e{money.exact(c['reward'])}" if c.get("reward") else ""), ""]
        lines += [f"§e#{i + 1} §f{n} §7{clock(t)}" for i, (n, t) in enumerate(rows)] or ["§7Nobody has finished yet. Be the first!"]
        best = self.mine(name, p.xuid)
        if best:
            lines += ["", f"Your best: §b{clock(best)}"]
        form = ActionForm(title="§lParkour", content="\n".join(lines))
        form.add_button("§lGo to the start§r\n§8Teleport there", icon="textures/ui/arrow_right", on_click=lambda pl: self.go_start(pl, name))
        form.add_button("§l< Back", on_click=self.menu)
        p.send_form(form)

    def teleport(self, p, spot):
        from endstone.level import Location
        dim, x, y, z = spot[:4]
        yaw = spot[4] if len(spot) > 4 else p.location.yaw
        p.teleport(Location(self.plugin.server.level.get_dimension(dim), float(x), float(y), float(z), 0.0, float(yaw)))

    def go_start(self, p, name):
        c = self.courses.get(name)
        if c and c.get("spawn"):
            self.runs.pop(str(p.unique_id), None)
            self.teleport(p, c["spawn"])
            p.send_message(f"§bStep on the start plate to begin §f{name}§b.")

    def back(self, p):
        run = self.runs.get(str(p.unique_id))
        if not run:
            return p.send_message("§7You're not doing a parkour course.")
        run["last"] = None   # this jump is allowed
        self.teleport(p, run["back"])
        p.send_message("§7Back to your last checkpoint. §8(the timer keeps going)")

    # ---------- stepping on plates ----------
    def tick(self):
        if not self.index and not self.runs:
            return
        now = time.time()
        bw = getattr(self.plugin, "bedwars", None)
        for p in self.plugin.server.online_players:
            try:
                uid = str(p.unique_id)
                dim, x, y, z = self.feet(p)
            except Exception:
                continue
            run = self.runs.get(uid)
            if run:
                if now - run["t0"] > MAX_RUN:
                    self.runs.pop(uid, None)
                    p.send_message("§7Parkour run stopped (over 30 minutes).")
                    run = None
                else:
                    # a sudden jump (teleport, /tpa, ender pearl) ends the run: courses must be done on foot
                    last = run.get("last")
                    run["last"] = (dim, x, z)
                    if last is not None and (last[0] != dim or math.hypot(x - last[1], z - last[2]) > 10):
                        self.runs.pop(uid, None)
                        p.send_message("§cParkour run stopped because you teleported.")
                        run = None
                if run:
                    try:
                        p.send_tip(f"§b{run['course']} §f{clock(now - run['t0'])} §7· {run['next']}/{run['cps']} checkpoints")
                    except Exception:
                        pass
            key = key_of(dim, x, y, z)
            if self.on.get(uid) == key:
                continue
            self.on[uid] = key
            hit = self.index.get(key)
            if not hit or (bw is not None and bw.playing(p)):
                continue
            name, kind, i = hit
            c = self.courses.get(name)
            if not c or not c.get("finish"):
                continue
            spot = (dim, x + 0.5, y, z + 0.5, p.location.yaw)
            if kind == "start":
                self.runs[uid] = {"course": name, "t0": now, "next": 0, "cps": len(c.get("checkpoints") or []), "back": spot, "last": (dim, x, z)}
                p.send_message(f"§bGo! §f{name}§7: {len(c.get('checkpoints') or [])} checkpoints. §8(/parkour back · /parkour leave)")
                self.sound(p, 1.6)
            elif run and run["course"] == name and kind == "cp":
                if i == run["next"]:
                    run["next"] += 1
                    run["back"] = spot
                    p.send_message(f"§aCheckpoint {run['next']}/{run['cps']} §7{clock(now - run['t0'])}")
                    self.sound(p, 1.2)
                elif i > run["next"]:
                    p.send_message(f"§cYou missed checkpoint {run['next'] + 1}.")
            elif run and run["course"] == name and kind == "finish":
                if run["next"] < run["cps"]:
                    p.send_message(f"§cHit all {run['cps']} checkpoints first ({run['next']} so far). §7/parkour back")
                else:
                    self.runs.pop(uid, None)
                    self.finished(p, name, now - run["t0"])

    @staticmethod
    def sound(p, pitch):
        try:
            p.play_sound(p.location, "note.pling", 1.0, pitch)
        except Exception:
            pass

    def finished(self, p, name, secs):
        secs = round(secs, 2)
        xuid = str(p.xuid)
        prev = self.mine(name, xuid)
        record = self.top(name, 1)
        first = prev is None
        best = secs if first else min(prev, secs)
        self.db.execute("INSERT INTO parkour_times (course, xuid, name, best, finishes, at) VALUES (?, ?, ?, ?, 1, ?) "
                        "ON CONFLICT(course, xuid) DO UPDATE SET best = ?, finishes = finishes + 1, name = ?, at = ?",
                        (name, xuid, p.name, best, time.time(), best, p.name, time.time()))
        self.db.commit()
        new_record = not record or secs < record[0][1]
        text = f"§a§lFinished {name}§r§a in §f{clock(secs)}§a!"
        if not first and secs < prev:
            text += f" §bNew personal best (was {clock(prev)})."
        elif not first:
            text += f" §7Your best is {clock(prev)}."
        p.send_message(text)
        self.sound(p, 2.0)
        prog = getattr(self.plugin, "progress", None)
        c = self.courses.get(name) or {}
        if first:
            if c.get("reward"):
                self.eco.credit(p, int(c["reward"]))
                p.send_message(f"§aFirst finish reward: §e{money.exact(int(c['reward']))}§a.")
            if prog:
                prog.bump(xuid, "parkour_courses", 1, name=p.name)
        if new_record:
            for o in self.plugin.server.online_players:
                o.send_message(f"§6§l[Parkour]§r §f{p.name}§e set a new record on §f{name}§e: §f{clock(secs)}")
            if prog:
                prog.bump(xuid, "parkour_records", 1, name=p.name)
        if prog:
            try:
                prog.check_achievements(p)
            except Exception:
                pass
        voice = getattr(self.plugin, "_voice", None)
        if voice is not None and getattr(voice, "ws", None):
            voice.send_json({"type": "parkour_time", "course": name, "xuid": xuid, "name": p.name, "ms": int(secs * 1000)})

    def on_quit(self, player):
        uid = str(player.unique_id)
        self.runs.pop(uid, None)
        self.on.pop(uid, None)

    def on_break(self, event):
        """Breaking a course plate takes it out of the course (staff are told)."""
        try:
            b = event.block
            key = key_of(b.dimension.name, b.x, b.y, b.z)
        except Exception:
            return
        hit = self.index.get(key)
        if hit and not event.player.is_op:
            event.is_cancelled = True
            return
        if not hit:
            return
        name, kind, i = hit
        c = self.courses.get(name) or {}
        if kind == "start":
            self.courses.pop(name, None)
            msg = f"§7That was the start of parkour course §f{name}§7: the course is removed."
        elif kind == "cp":
            c["checkpoints"].pop(i)
            msg = f"§7Checkpoint {i + 1} of §f{name}§7 removed."
        else:
            c["finish"] = None
            msg = f"§7The finish of §f{name}§7 removed: set a new one with /parkour finish {name}."
        self.save()
        try:
            event.player.send_message(msg)
        except Exception:
            pass

    def push(self):
        voice = getattr(self.plugin, "_voice", None)
        if voice is not None and getattr(voice, "ws", None):
            voice.send_json({"type": "parkour_courses", "courses": [
                {"name": n, "checkpoints": len(c.get("checkpoints") or []), "reward": int(c.get("reward") or 0)} for n, c in self.ready().items()]})
