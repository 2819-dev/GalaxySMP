"""The plain logic of the GalaxySMP Network plugin (no Minecraft in here, so it can be tested anywhere).

What this plugin does on a Network Server, and what it never does:
  * Every minute it tells galaxymc.us which players are online (gamertags only) and gets back their GalaxySMP ranks and
    who on GalaxySMP's admin team should be an operator here.
  * It shows those ranks in chat and above players' heads, and gives the admin team operator (only them, and only people
    who weren't operators already, so the server's own operators are never touched).
  * It never sends chat, items, locations or anything else. It adds no menu and does not share chat.
"""
import json
import re
import time
import zipfile
from pathlib import Path

WEBSITE = "https://galaxymc.us"
SYNC_SECONDS = 60
MAX_PACK_BYTES = 25 * 1024 * 1024
MAX_PACK_FILES = 400


# ---------- the setup file (config.json) ----------
def load_config(folder):
    """-> (config dict or None, problem text or None). The setup file comes from GalaxySMP."""
    path = Path(folder) / "config.json"
    if not path.is_file():
        return None, f"No setup file yet. Put the config.json GalaxySMP sent you in: {folder}"
    try:
        raw = json.loads(path.read_text("utf-8-sig"))
    except Exception:
        return None, f"{path} isn't valid. Copy the setup file text from GalaxySMP exactly as it was sent."
    token = str(raw.get("token", "")).strip() if isinstance(raw, dict) else ""
    if not re.fullmatch(r"gp_[A-Za-z0-9_-]{30,64}", token):
        return None, f"The token in {path} doesn't look right. Copy the setup file text from GalaxySMP exactly as it was sent."
    website = str(raw.get("website") or WEBSITE).strip().rstrip("/")
    if not website.startswith("https://"):
        return None, "The website in the setup file has to start with https://"
    seconds = raw.get("sync_seconds", SYNC_SECONDS)
    seconds = seconds if isinstance(seconds, int) and 30 <= seconds <= 600 else SYNC_SECONDS
    return {"token": token, "website": website, "sync_seconds": seconds}, None


# ---------- ranks: how they look ----------
def clean_prefix(prefix):
    """A rank's prefix, safe to put in chat and name tags (no color codes or format braces of its own)."""
    return re.sub(r"[§{}\[\]\x00-\x1f]", "", str(prefix or "")).strip()[:16]


def clean_tag(tag):
    """One tag from the website -> {"prefix", "color", "name"} or None."""
    if not isinstance(tag, dict):
        return None
    prefix = clean_prefix(tag.get("prefix"))
    if not prefix:
        return None
    color = str(tag.get("color") or "f").lower()
    return {"prefix": prefix, "color": color if re.fullmatch(r"[0-9a-f]", color) else "f", "name": re.sub(r"[§\x00-\x1f]", "", str(tag.get("name") or prefix))[:24]}


def chat_format(tag):
    """The chat line for a ranked player: [RANK] name: message ({0} is the name, {1} the message)."""
    return f"§{tag['color']}[{tag['prefix']}]§r §f{{0}}§r§7:§r {{1}}"


def name_tag(player_name, tag):
    """The name above a ranked player's head."""
    return f"§{tag['color']}[{tag['prefix']}]§r\n§f{player_name}"


# ---------- operators ----------
def plan_operators(wanted, granted, currently_op):
    """Who to make an operator and who to stop being one.

    wanted      xuids GalaxySMP says should be operators here
    granted     xuids this plugin made operators earlier (only these can ever be removed again)
    currently_op  xuids that are operators right now (the server's own operators included)
    -> (to_add, to_remove): to_add were not operators and become ones; to_remove were made operators by us and aren't wanted any more.
    Someone who was already an operator is never added to `granted`, so the server's own operators are never removed."""
    wanted, granted, currently_op = set(map(str, wanted)), set(map(str, granted)), set(map(str, currently_op))
    to_add = {x for x in wanted if x not in currently_op}
    to_remove = {x for x in granted if x not in wanted}
    return to_add, to_remove


# ---------- the logo pack ----------
def install_pack(mcpack_path, root, world_folder, installed):
    """Installs a .mcpack (a zip) as a resource pack for the world.

    root           the server's folder (resource_packs/ lives in it)
    world_folder   worlds/<level-name>
    installed      {pack uuid: version string} already done, so a restart doesn't redo it
    -> (message or None, changed). Never raises: a pack that can't be installed returns a message and leaves things as they were."""
    path = Path(mcpack_path)
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            if len(names) > MAX_PACK_FILES or sum(i.file_size for i in z.infolist()) > MAX_PACK_BYTES:
                return f"{path.name} is too big to be a logo pack, so it was skipped.", False
            manifest = json.loads(z.read("manifest.json").decode("utf-8-sig"))
            uuid = str(manifest["header"]["uuid"])
            version = [int(x) for x in manifest["header"]["version"]]
            if not re.fullmatch(r"[0-9a-fA-F-]{36}", uuid):
                return f"{path.name} has a pack id that doesn't look right.", False
            key = ".".join(map(str, version))
            if installed.get(uuid) == key:
                return None, False
            folder = Path(root) / "resource_packs" / ("GalaxyNetwork_" + re.sub(r"[^A-Za-z0-9_-]", "_", str(manifest["header"].get("name", "logo")))[:40])
            folder_resolved = folder.resolve()
            folder.mkdir(parents=True, exist_ok=True)
            for info in z.infolist():
                target = (folder / info.filename).resolve()
                if folder_resolved != target and folder_resolved not in target.parents:   # never write outside the pack folder
                    return f"{path.name} contains a file in a wrong place, so it was skipped.", False
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(z.read(info))
    except Exception as e:
        return f"{path.name} couldn't be installed ({type(e).__name__}: {e}).", False
    listing = Path(world_folder) / "world_resource_packs.json"
    try:
        try:
            listed = json.loads(listing.read_text("utf-8"))
            listed = listed if isinstance(listed, list) else []
        except Exception:
            listed = []
        listed = [e for e in listed if not (isinstance(e, dict) and str(e.get("pack_id", "")).lower() == uuid.lower())]
        listed.append({"pack_id": uuid, "version": version})
        if not Path(world_folder).is_dir():
            return f"{path.name} was unpacked, but the world folder {world_folder} wasn't found, so it isn't switched on yet.", False
        listing.write_text(json.dumps(listed, indent=2), "utf-8")
    except Exception as e:
        return f"{path.name} was unpacked, but switching it on failed ({e}).", False
    installed[uuid] = key
    return f"Installed the logo pack {manifest['header'].get('name', path.name)} (version {key}). Restart the server once so players get it.", True


def server_property(root, key, default=None):
    try:
        for line in (Path(root) / "server.properties").read_text("utf-8", "ignore").splitlines():
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return default


def level_folder(root):
    return Path(root) / "worlds" / (server_property(root, "level-name", "Bedrock level") or "Bedrock level")


def ago(seconds):
    s = int(max(0, seconds))
    return f"{s}s ago" if s < 90 else f"{s // 60} min ago" if s < 5400 else f"{s // 3600} h ago"


def now():
    return time.time()
