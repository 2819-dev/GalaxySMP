"""Floating text labels (shop signs, shop chests, crates), using the invisible galaxysmp:floating_text entity
from the GalaxySMP blocks pack. Labels are saved, come back if they go missing (when someone is nearby),
and can be changed or removed by key.
"""

import math

ENTITY = "galaxysmp:floating_text"
TAG = "gsmp_ft"
NEAR = 48


class FloatingTexts:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.labels = self.eco.get_config("floating_texts") or {}  # key -> {id, dim, x, y, z, text}
        self.actors = {}
        self.waiting = {}   # id -> updates waited after summoning

    def save(self):
        self.eco.set_config("floating_texts", self.labels)

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
                a = self.find(old)
                if a is not None:
                    self._name(a, text)
            return
        lid = max([v["id"] for v in self.labels.values()] + [0]) + 1
        lab = {"id": lid, "dim": dim, "x": x, "y": y, "z": z, "text": text}
        self.labels[key] = lab
        self.save()
        self.summon(lab)

    def remove(self, key):
        lab = self.labels.pop(key, None)
        if not lab:
            return
        self.save()
        a = self.find(lab)
        if a is not None:
            try:
                a.remove()
            except Exception:
                pass
        self.actors.pop(lab["id"], None)

    # ---------- entities ----------
    @staticmethod
    def _name(actor, text):
        try:
            actor.name_tag = text
            actor.is_name_tag_always_visible = True
        except Exception:
            pass

    def find(self, lab):
        a = self.actors.get(lab["id"])
        try:
            if a is not None and a.is_valid:
                return a
        except Exception:
            pass
        want = f"{TAG}_{lab['id']}"
        for actor in self.plugin.server.level.actors:
            try:
                if actor.type == ENTITY and want in actor.scoreboard_tags:
                    self.actors[lab["id"]] = actor
                    return actor
            except Exception:
                continue
        return None

    def summon(self, lab):
        d = lab["dim"].lower()
        dim = "nether" if "nether" in d else "the_end" if "end" in d else "overworld"
        self.plugin.server.dispatch_command(self.plugin.server.command_sender,
                                            f"execute in {dim} run summon {ENTITY} {lab['x']} {lab['y']} {lab['z']}")
        self.waiting[lab["id"]] = 0
        self.plugin.server.scheduler.run_task(self.plugin, lambda: self.adopt(lab), delay=10)

    def adopt(self, lab):
        if lab not in self.labels.values():
            return None
        for actor in self.plugin.server.level.actors:
            try:
                if actor.type != ENTITY or any(t.startswith("gsmp_") for t in actor.scoreboard_tags):
                    continue
                l = actor.location
                if actor.dimension.name == lab["dim"] and math.dist((l.x, l.y, l.z), (lab["x"], lab["y"], lab["z"])) < 1.0:
                    actor.add_scoreboard_tag(TAG)
                    actor.add_scoreboard_tag(f"{TAG}_{lab['id']}")
                    self._name(actor, lab["text"])
                    self.actors[lab["id"]] = actor
                    self.waiting.pop(lab["id"], None)
                    return actor
            except Exception:
                continue
        return None

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
        """Every minute: remove stray labels, put back missing ones near players."""
        ids = {v["id"] for v in self.labels.values()}
        for actor in list(self.plugin.server.level.actors):
            try:
                if actor.type == ENTITY:
                    tags = [t for t in actor.scoreboard_tags if t.startswith(TAG + "_")]
                    if tags and int(tags[0][len(TAG) + 1:]) not in ids:
                        actor.remove()
            except Exception:
                continue
        for lab in self.labels.values():
            a = self.find(lab)
            if a is not None:
                if a.name_tag != lab["text"]:
                    self._name(a, lab["text"])
                continue
            w = self.waiting.get(lab["id"])
            if w is not None and w < 5:
                self.waiting[lab["id"]] = w + 1
                self.adopt(lab)
            elif self.near(lab):
                self.summon(lab)
