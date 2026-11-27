"""Tests for the GalaxySMP Network plugin (run: PYTHONPATH=src:logo-pack python3 tests/test_partner.py, from endstone-partner/)."""
import io
import json
import tempfile
import time
import types
import zipfile
from pathlib import Path

from endstone_galaxylink_partner import core
import endstone_galaxylink_partner.plugin as pl
import build_logo_pack as BL

NS = types.SimpleNamespace
fails = 0


def ok(cond, label):
    global fails
    fails += 0 if cond else 1
    print(("PASS " if cond else "FAIL ") + label)


TOKEN = "gp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V"
tmp = Path(tempfile.mkdtemp())

# ---------- the setup file ----------
cfg, problem = core.load_config(tmp / "none")
ok(cfg is None and "No setup file" in problem, "no setup file: says where to put it")
folder = tmp / "plug"; folder.mkdir()
(folder / "config.json").write_text("{not json")
ok(core.load_config(folder)[0] is None and "isn't valid" in core.load_config(folder)[1], "broken file refused")
(folder / "config.json").write_text(json.dumps({"token": "gp_short"}))
ok(core.load_config(folder)[0] is None, "a wrong-looking token refused")
(folder / "config.json").write_text("﻿" + json.dumps({"token": TOKEN, "website": "http://galaxymc.us"}))
ok(core.load_config(folder)[0] is None and "https" in core.load_config(folder)[1], "the website must be https (and a Windows BOM is fine)")
(folder / "config.json").write_text(json.dumps({"token": TOKEN, "website": "https://galaxymc.us/", "sync_seconds": 5}))
cfg, problem = core.load_config(folder)
ok(cfg == {"token": TOKEN, "website": "https://galaxymc.us", "sync_seconds": 60} and problem is None, "good file: trailing slash dropped, silly sync time ignored")

# ---------- how ranks look ----------
tag = core.clean_tag({"prefix": "AD§cMIN{x}[", "color": "c", "name": "Admin"})
ok(tag == {"prefix": "ADcMINx", "color": "c", "name": "Admin"}, "prefix is cleaned of color codes and braces: " + str(tag))
ok(core.clean_tag({"prefix": "", "color": "c"}) is None and core.clean_tag("x") is None, "no prefix, no tag")
ok(core.clean_tag({"prefix": "MOD", "color": "zz"})["color"] == "f", "bad color becomes white")
ok(core.chat_format(tag) == "§c[ADcMINx]§r §f{0}§r§7:§r {1}", "chat: [RANK] name: message")
ok("{0}".format("Bob") and core.chat_format(tag).format("Bob", "hi") == "§c[ADcMINx]§r §fBob§r§7:§r hi", "the format really works with name and message")
ok(core.name_tag("Bob", tag) == "§c[ADcMINx]§r\n§fBob", "above the head: tag, then name")

# ---------- operators ----------
add, rem = core.plan_operators({"1", "2"}, set(), {"2"})
ok(add == {"1"} and not rem, "an admin who isn't an operator becomes one; one who already was is left alone")
add, rem = core.plan_operators({"1"}, {"1", "3"}, {"1", "3", "9"})
ok(rem == {"3"} and "9" not in rem, "someone we made an operator who's no longer an admin is removed; the server's own operators never are")
add, rem = core.plan_operators(set(), set(), {"9"})
ok(not add and not rem, "the server's own operators are never touched")

# ---------- the logo pack ----------
pack_dir = tmp / "built"
pack, size = BL.build("Retro Realm", BL.HERE / "default_logo.png", pack_dir, [1, 0, 0], 10, False, None)
root = tmp / "server"; (root / "worlds" / "Bedrock level").mkdir(parents=True)
(root / "server.properties").write_text("level-name=Bedrock level\ntexturepack-required=false\n")
installed = {}
msg, changed = core.install_pack(pack, root, core.level_folder(root), installed)
listing = json.loads((root / "worlds" / "Bedrock level" / "world_resource_packs.json").read_text())
ok(changed and "Installed" in msg and len(listing) == 1 and listing[0]["version"] == [1, 0, 0], "logo pack installed and switched on for the world: " + msg)
ok((root / "resource_packs" / "GalaxyNetwork_Retro_Realm_Network_Logo" / "ui" / "hud_screen.json").is_file(), "its files are in resource_packs/")
msg, changed = core.install_pack(pack, root, core.level_folder(root), installed)
ok(msg is None and not changed, "a restart doesn't install it again")
(root / "worlds" / "Bedrock level" / "world_resource_packs.json").write_text(json.dumps([{"pack_id": "11111111-2222-3333-4444-555555555555", "version": [1, 0, 0]}]))
pack2, _ = BL.build("Retro Realm", BL.HERE / "default_logo.png", pack_dir, [1, 1, 0], 10, False, None)
core.install_pack(pack2, root, core.level_folder(root), installed)
listing = json.loads((root / "worlds" / "Bedrock level" / "world_resource_packs.json").read_text())
ok(len(listing) == 2 and any(e["pack_id"] == "11111111-2222-3333-4444-555555555555" for e in listing) and [e for e in listing if e["pack_id"] != "11111111-2222-3333-4444-555555555555"][0]["version"] == [1, 1, 0],
   "a newer version replaces the old entry and keeps the server's other packs")
evil = tmp / "evil.mcpack"
with zipfile.ZipFile(evil, "w") as z:
    z.writestr("manifest.json", json.dumps({"header": {"name": "x", "uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "version": [1, 0, 0]}}))
    z.writestr("../../escaped.txt", "no")
msg, changed = core.install_pack(evil, root, core.level_folder(root), {})
ok(not changed and "wrong place" in msg and not (root.parent / "escaped.txt").exists() and not (tmp / "escaped.txt").exists(), "a pack with a file outside its folder is refused")
(tmp / "junk.mcpack").write_bytes(b"not a zip")
msg, changed = core.install_pack(tmp / "junk.mcpack", root, core.level_folder(root), {})
ok(not changed and "couldn't be installed" in msg, "junk is refused with a message, not a crash")
nowold = tmp / "server2"; nowold.mkdir()
msg, changed = core.install_pack(pack, nowold, core.level_folder(nowold), {})
ok(not changed and "world folder" in msg, "no world folder yet: says so and tries again next time")
z = zipfile.ZipFile(pack)
hud = json.loads(z.read("ui/hud_screen.json"))
ok(hud["gsmp_network_logo"]["anchor_from"] == "top_right" and hud["gsmp_network_logo"]["size"][1] == 10 and hud["gsmp_network_logo"]["size"][0] <= 64, "logo: small, top-right corner")
m1, m2 = json.loads(z.read("manifest.json")), json.loads(zipfile.ZipFile(pack2).read("manifest.json"))
other, _ = BL.build("Other Server", BL.HERE / "default_logo.png", pack_dir, [1, 0, 0], 10, False, None)
ok(m1["header"]["uuid"] == m2["header"]["uuid"] and m1["header"]["uuid"] != json.loads(zipfile.ZipFile(other).read("manifest.json"))["header"]["uuid"], "a server keeps the same pack id on rebuilds; every server has its own")
square = Image = BL.Image.new("RGBA", (40, 40), (255, 0, 0, 255)); sq = tmp / "sq.png"; square.save(sq)
_, (w, h) = BL.build("Square One", sq, pack_dir, [1, 0, 0], 10, True, tmp / "mock.png")
ok((w, h) == (10, 10) and (tmp / "mock.png").exists(), "a square logo stays square (and the mockup is made)")

# ---------- the plugin itself, with a pretend server ----------
class Player:
    def __init__(self, xuid, name, op=False):
        self.xuid, self.name, self.is_op, self.name_tag, self.msgs = xuid, name, op, name, []
    def send_message(self, m): self.msgs.append(m)

cmds, tasks, logs = [], [], []
players = []
data = tmp / "gn"
class Fake(pl.GalaxyNetwork):
    data_folder = str(data)
    server = NS(online_players=players, scheduler=NS(run_task=lambda p, fn, delay=0, period=None: tasks.append(fn)),
                dispatch_command=lambda s, c: cmds.append(c) or True, command_sender="console")
    logger = NS(info=lambda m: logs.append(("i", m)), warning=lambda m: logs.append(("w", m)))
    def register_events(self, obj): pass
import os
os.chdir(root)
g = Fake()
g.on_enable()
ok(any("No setup file" in m for k, m in logs) and (data / "config.example.json").is_file() and TOKEN not in (data / "config.example.json").read_text(), "no setup file: a clear message and an example file; nothing is sent")
ok(not g.link and g.next_sync == 0.0, "...and it doesn't connect")
(data / "config.json").write_text(json.dumps({"token": TOKEN}))
(data / "Retro_Realm_Network_Logo.mcpack").write_bytes(Path(pack).read_bytes())
(root / "resource_packs").mkdir(exist_ok=True)
logs.clear(); g.reload()
ok(g.link and g.link["token"] == TOKEN and g.problem is None and len(g.state["packs"]) == 1 and any("Installed the logo pack" in m for k, m in logs), "reload reads the setup file and installs the logo pack from its folder")
ok(any("texturepack-required" in m for k, m in logs), "reminds them to switch texturepack-required on")
ok(TOKEN not in " ".join(m for k, m in logs), "the token is never written to the log")

admin, mod, plain, own_op = Player("1002", "AdminGal"), Player("1003", "ModGuy"), Player("1005", "Nobody"), Player("7", "TheirOwner", op=True)
players[:] = [admin, mod, plain, own_op]
g._finish(200, {"ok": True, "tags": {"1002": {"prefix": "ADMIN", "color": "c", "name": "Admin"}, "1003": {"prefix": "MOD", "color": "9", "name": "Moderator"}, "7": {"prefix": "OWNER", "color": "6"}},
               "operators": ["1002", "7"]})
ok(admin.name_tag == "§c[ADMIN]§r\n§fAdminGal" and mod.name_tag == "§9[MOD]§r\n§fModGuy" and plain.name_tag == "Nobody", "ranks show above heads")
ok(admin.is_op and 'op "AdminGal"' in cmds and "1002" in g.state["granted"] and any("operator" in m for m in admin.msgs), "the GalaxySMP admin becomes an operator and is told")
ok(not mod.is_op and not plain.is_op, "nobody else does")
ok(own_op.is_op and "7" not in g.state["granted"] and not any("TheirOwner" in c for c in cmds), "the server's own operator who is also on GalaxySMP's list isn't touched")
ev = NS(player=admin, format="x")
g.on_chat(ev); ok(ev.format == "§c[ADMIN]§r §f{0}§r§7:§r {1}", "chat shows [ADMIN] name: message")
ev = NS(player=plain, format="<{0}> {1}")
g.on_chat(ev); ok(ev.format == "<{0}> {1}", "a player without a rank keeps the server's normal chat")
saved = json.loads((data / "state.json").read_text())
ok(saved["granted"] == {"1002": "AdminGal"} and "1002" in saved["wanted"], "what it did is saved (so a restart keeps it)")
g2 = Fake(); g2.on_enable()
ok(g2.wanted == {"1002", "7"} and "1002" in g2.state["granted"], "after a restart it still knows who it made an operator")
late = Player("1002", "AdminGal"); players[:] = [late]
g2.tags = g.tags; g2.refresh(late)
ok(late.is_op is True, "after a restart, a returning admin gets operator again from the saved answer")

# a newcomer joins and is an admin on GalaxySMP already known from the last answer
newcomer = Player("1002", "AdminGal"); players[:] = [newcomer]; cmds.clear()
g.on_join(NS(player=newcomer))
ok(newcomer.is_op and 'op "AdminGal"' in cmds, "an admin who joins is made an operator right away from the last answer")
g.state["granted"]["1002"] = "AdminGal"

# a real round trip over HTTP (a local stand-in for galaxymc.us)
import http.server, threading
seen = {}
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        seen["path"], seen["auth"], seen["ua"] = self.path, self.headers.get("Authorization"), self.headers.get("User-Agent")
        seen["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        out = json.dumps({"ok": True, "server": {"name": "Retro Realm", "opsEnabled": True}, "tags": {"1002": {"name": "Admin", "prefix": "ADMIN", "color": "c"}}, "operators": ["1002"]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
httpd = http.server.HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=httpd.serve_forever, daemon=True).start()
g.link["website"] = f"http://127.0.0.1:{httpd.server_port}"
tasks.clear(); g.busy = True
g._sync_thread([{"xuid": "1002", "name": "AdminGal"}]); tasks.pop()()
ok(seen["path"] == "/api/partner/sync" and seen["auth"] == "Bearer " + TOKEN and seen["ua"].startswith("GalaxyNetwork-Partner/") and seen["body"] == {"version": pl.VERSION, "players": [{"xuid": "1002", "name": "AdminGal"}]},
   "it sends only the version and the gamertags online, with the token in the Authorization header")
ok(g.last_ok and not g.busy and "1002" in g.tags and g.wanted == {"1002"}, "and applies the answer")
httpd.shutdown()

# the exact answer the website's API gives (see partners_test.mjs)
import os as _os
sample = _os.environ.get("SYNC_SAMPLE")
if sample and Path(sample).exists():
    real = json.loads(Path(sample).read_text())
    players[:] = [Player(x, "P" + x) for x in ("1001", "1002", "1003", "1004", "1006")]
    g._finish(200, real)
    ok(len(g.tags) >= 4 and g.wanted == set(real["operators"]) and all(p.name_tag != p.name for p in players if p.xuid in real["tags"]), "the website API's real answer is understood: " + f"{len(real['tags'])} tags, {len(real['operators'])} operators")

# the admin is demoted on GalaxySMP
players[:] = [admin, mod, own_op]; admin.is_op = True; cmds.clear()
g._finish(200, {"ok": True, "tags": {"1003": {"prefix": "MOD", "color": "9"}}, "operators": ["7"]})
ok(not admin.is_op and 'deop "AdminGal"' in cmds and "1002" not in g.state["granted"] and admin.name_tag == "AdminGal", "a demoted admin loses the operator access we gave and the tag")
ok(own_op.is_op, "the server's own operator keeps theirs")

# no connection: everything stays
admin.is_op = True; g.state["granted"]["1002"] = "AdminGal"; g.wanted.add("1002"); g.tags["1002"] = core.clean_tag({"prefix": "ADMIN", "color": "c"})
g._finish(0, {"error": "URLError: timed out"})
ok(admin.is_op and "1002" in g.tags and g.fails == 1 and g.next_sync > time.time() + 100, "website unreachable: nothing changes, it retries later with a pause")
g._finish(500, {})
ok(admin.is_op and g.fails == 2, "an error from the website: same")

# the connection was paused or reset
cmds.clear()
g._finish(401, {"ok": False})
ok(not admin.is_op and 'deop "AdminGal"' in cmds and not g.tags and "1002" not in g.state["granted"], "paused or reset: the operator access we gave is taken back and ranks stop showing")
ok(own_op.is_op, "...but never the server's own operators")
ok("doesn't accept" in g.last_error and any("new setup file" in m for k, m in logs), "and it says why")

# /network
out = []
sender = NS(send_message=out.append)
g._finish(200, {"ok": True, "tags": {}, "operators": []})
g.on_command(sender, NS(name="network"), [])
ok("connected" in out[-1] and TOKEN not in out[-1] and "No menu" in out[-1] or "no menu" in out[-1].lower(), "/network shows the status and never the token")
g.on_command(sender, NS(name="network"), ["reload"]); ok("checked again" in out[-1], "/network reload works")
print("FAILS:", fails)
