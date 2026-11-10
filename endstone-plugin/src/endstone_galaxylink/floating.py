"""Floating text labels (leaderboards, shop signs, shop chests, crates), using the invisible
galaxysmp:floating_text entity from the GalaxySMP blocks pack.

Safe by design: this never looks through all the entities in the world (that crashed some servers).
  - When we summon a label, the spawn event hands us that exact entity and we keep it.
  - If we don't have a label's entity (after a restart, or it disappeared), we remove any old copy at that
    exact spot with a targeted /kill and summon a fresh one, only when a player is nearby (area loaded).
"""

import math

ENTITY = "galaxysmp:floating_text"
NEAR = 48


def dim_cmd(name):
    n = str(name).lower()
    return "nether" if "nether" in n else "the_end" if "end" in n else "overworld"


class FloatingTexts:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.labels = self.eco.get_config("floating_texts") or {}  # key -> {id, dim, x, y, z, text}
        self.actors = {}        # label id -> Actor we summoned
        self.expecting = None   # the label being summoned right now
        self.errors = 0

    def save(self):
        self.eco.set_config("floating_texts", self.labels)

    # ---------- public ----------
    def set(self, key, dim, x, y, z, text):
        """Adds or updates a label."""
        old = self.labels.get(key)
        if old and (old["dim"], old["x"], old["y"], old["z"]) != (dim, x, y, z):
            self.remove(key)
            old = None
        if old:
            if old["text"] != text:
                old["text"] = text
                self.save()
                a = self.live(old)
                if a is not None:
                    self._name(a, text)
            return
        lid = max([v["id"] for v in self.labels.values()] + [0]) + 1
        lab = {"id": lid, "dim": dim, "x": x, "y": y, "z": z, "text": text}
        self.labels[key] = lab
        self.save()
        if self.near(lab):
            self.summon(lab)

    def remove(self, key):
        lab = self.labels.pop(key, None)
        if not lab:
            return
        self.save()
        a = self.actors.pop(lab["id"], None)
        try:
            if a is not None and a.is_valid:
                a.remove()
                return
        except Exception:
            pass
        self.kill_at(lab)

    # ---------- entities ----------
    @staticmethod
    def _name(actor, text):
        try:
            actor.name_tag = text
            actor.is_name_tag_always_visible = True
        except Exception:
            pass

    def live(self, lab):
        a = self.actors.get(lab["id"])
        try:
            if a is not None and a.is_valid:
                return a
        except Exception:
            pass
        self.actors.pop(lab["id"], None)
        return None

    def run(self, line):
        self.plugin.server.dispatch_command(self.plugin.server.command_sender, line)

    def kill_at(self, lab):
        """Removes floating text entities at exactly this label's spot (nothing else is touched)."""
        self.run(f"execute in {dim_cmd(lab['dim'])} run kill @e[type={ENTITY},x={lab['x']},y={lab['y']},z={lab['z']},r=0.75]")

    def crowded(self, lab):
        """Another label right on this spot? (then /kill there would remove it too)"""
        return any(o is not lab and o["dim"] == lab["dim"] and math.dist((o["x"], o["y"], o["z"]), (lab["x"], lab["y"], lab["z"])) < 1.0
                   for o in self.labels.values())

    def summon(self, lab):
        if not self.crowded(lab):
            self.kill_at(lab)  # no duplicates: clear any old copy at this spot first
        self.expecting = lab
        try:
            self.run(f"execute in {dim_cmd(lab['dim'])} run summon {ENTITY} {lab['x']} {lab['y']} {lab['z']}")
        finally:
            self.expecting = None

    def on_spawn(self, event):
        """ActorSpawnEvent: the label we're summoning right now."""
        lab = self.expecting
        if lab is None:
            return
        try:
            actor = event.actor
            if actor.type != ENTITY:
                return
        except Exception:
            return
        self.actors[lab["id"]] = actor
        self.expecting = None
        # name it on the next tick, once it's fully in the world
        self.plugin.server.scheduler.run_task(self.plugin, lambda: self._name(actor, lab["text"]), delay=1)

    def near(self, lab):
        for p in self.plugin.server.online_players:
            try:
                l = p.location
                if p.dimension.name == lab["dim"] and math.dist((l.x, l.z), (lab["x"], lab["z"])) < NEAR:
                    return True
            except Exception:
                continue
        return False

    def update(self):
        """Every minute: refresh texts and put back missing labels where players are."""
        try:
            for lab in list(self.labels.values()):
                a = self.live(lab)
                if a is not None:
                    if a.name_tag != lab["text"]:
                        self._name(a, lab["text"])
                elif self.near(lab):
                    self.summon(lab)
        except Exception as e:  # never let a label problem take anything else down
            self.errors += 1
            if self.errors <= 3:
                self.plugin.logger.warning(f"Floating text update failed: {e}")
