"""Floating text labels (leaderboards, shop signs, shop chests, crates, Voting Computers), using the invisible
galaxysmp:floating_text entity from the GalaxySMP blocks pack.

Crash-safe by design. Keeping hold of a label's entity and touching it later (to read or change its name) can
crash the server, so we never do:
  - A label is placed with a targeted /kill at its exact spot (no duplicates) and a /summon. The spawn event
    hands us the new entity, which we name on the next tick and then forget.
  - To change a label's text we simply place it again. Labels are only placed while a player is near
    (the area is loaded), and placed again when someone comes back, and every few minutes as a refresh.
  - We never look through all the entities in the world.
"""

import math
import time

ENTITY = "galaxysmp:floating_text"
NEAR = 32          # blocks: labels are only placed while a player is this close (area loaded)
REFRESH = 600      # seconds: place a label again this often while players are near (in case it went missing)


def dim_cmd(name):
    n = str(name).lower()
    return "nether" if "nether" in n else "the_end" if "end" in n else "overworld"


class FloatingTexts:
    def __init__(self, plugin):
        self.plugin = plugin
        self.eco = plugin.economy
        self.labels = self.eco.get_config("floating_texts") or {}  # key -> {id, dim, x, y, z, text}
        self.placed = {}        # label id -> (text, when) for labels placed while a player was near
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
                if self.near(old):
                    self.summon(old)  # place it again with the new text
                else:
                    self.placed.pop(old["id"], None)
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
        self.placed.pop(lab["id"], None)
        self.kill_at(lab)

    # ---------- entities ----------
    @staticmethod
    def _name(actor, text):
        try:
            actor.name_tag = text
            actor.is_name_tag_always_visible = True
        except Exception:
            pass

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
        self.placed[lab["id"]] = (lab["text"], time.time())
        self.expecting = lab
        try:
            self.run(f"execute in {dim_cmd(lab['dim'])} run summon {ENTITY} {lab['x']} {lab['y']} {lab['z']}")
        finally:
            self.expecting = None

    def on_spawn(self, event):
        """ActorSpawnEvent: the label we're summoning right now. Named on the next tick, then forgotten."""
        lab = self.expecting
        if lab is None:
            return
        try:
            actor = event.actor
            if actor.type != ENTITY:
                return
        except Exception:
            return
        self.expecting = None
        text = lab["text"]
        self.plugin.server.scheduler.run_task(self.plugin, lambda: self._name(actor, text) if getattr(actor, "is_valid", True) else None, delay=1)

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
        """Every minute: place labels where players are (new, changed, just came back, or due a refresh)."""
        try:
            now = time.time()
            for lab in list(self.labels.values()):
                if not self.near(lab):
                    self.placed.pop(lab["id"], None)  # placed again when someone comes back
                    continue
                done = self.placed.get(lab["id"])
                if done is None or done[0] != lab["text"] or now - done[1] > REFRESH:
                    self.summon(lab)
        except Exception as e:  # never let a label problem take anything else down
            self.errors += 1
            if self.errors <= 3:
                self.plugin.logger.warning(f"Floating text update failed: {e}")
