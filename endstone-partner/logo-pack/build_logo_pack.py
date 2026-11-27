#!/usr/bin/env python3
"""Builds a Network Server's logo pack: a small logo in the top-right corner of every player's screen.

    python3 build_logo_pack.py --name "Retro Realm" [--logo their_logo.png] [--out folder] [--height 10] [--pixel] [--preview mockup.png]

  --name     the server's name (also names the pack; each server gets its own pack id, the same one every time you rebuild)
  --logo     a PNG with a transparent background (a retro games server gets a retro games logo). Without it: the GalaxySMP logo.
  --height   how tall it is on screen, in Minecraft's UI units (default 10: small, like a little corner badge; the hotbar is 22)
  --pixel    the logo is pixel art: scale it up with hard edges instead of smoothing
  --preview  also writes a mockup picture of where it sits (a drawing, not a real screenshot)
Make the logo yourself, or design one for the server's theme and pass it with --logo.
"""
import argparse
import io
import json
import re
import sys
import uuid
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
NAMESPACE = uuid.UUID("5c1b8d3e-7a24-4f0e-9b6a-2d8f4c1e7a90")   # GalaxySMP Network packs
MAX_WIDTH_UNITS = 64
TEXTURE = "textures/ui/gsmp_network_logo"


def slug(name):
    return re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_") or "Server"


def trimmed(image):
    """The logo without its empty transparent border."""
    image = image.convert("RGBA")
    box = image.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    return image.crop(box) if box else image


def sized(image, height_units, pixel):
    """-> (resized image, width units, height units). The picture is 8 pixels per unit, so it stays sharp on big screens."""
    w, h = image.size
    units_h = height_units
    units_w = units_h * w / h
    if units_w > MAX_WIDTH_UNITS:
        units_w, units_h = MAX_WIDTH_UNITS, MAX_WIDTH_UNITS * h / w
    target = (max(1, round(units_w * 8)), max(1, round(units_h * 8)))
    if pixel and target[0] >= w and target[1] >= h:
        k = max(1, min(target[0] // w, target[1] // h))
        out = image.resize((w * k, h * k), Image.NEAREST)
    else:
        out = image.resize(target, Image.LANCZOS)
    return out, round(units_w), round(units_h)


def hud_json(w, h):
    return {
        "namespace": "hud",
        "gsmp_network_logo": {
            "type": "image", "texture": TEXTURE, "size": [w, h],
            "anchor_from": "top_right", "anchor_to": "top_right", "offset": [-3, 3], "layer": 1, "alpha": 0.92,
        },
        "root_panel": {
            "modifications": [{"array_name": "controls", "operation": "insert_back",
                               "value": [{"gsmp_network_logo@hud.gsmp_network_logo": {}}]}],
        },
    }


def manifest(name, version):
    key = slug(name).lower()
    return {
        "format_version": 2,
        "header": {"name": f"{name} Network Logo", "description": f"The GalaxySMP Network logo on {name}",
                   "uuid": str(uuid.uuid5(NAMESPACE, key + "/pack")), "version": version, "min_engine_version": [1, 21, 0]},
        "modules": [{"type": "resources", "uuid": str(uuid.uuid5(NAMESPACE, key + "/module")), "version": version}],
    }


def pack_icon(logo):
    icon = Image.new("RGBA", (128, 128), (10, 12, 27, 255))
    thumb = logo.copy()
    thumb.thumbnail((112, 112), Image.LANCZOS)
    icon.alpha_composite(thumb, ((128 - thumb.width) // 2, (128 - thumb.height) // 2))
    return icon


def png_bytes(image):
    buf = io.BytesIO()
    image.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def mockup(logo, h_units, path, name):
    """A rough drawing of a 16:9 screen with the logo where it will sit (UI scale 3). Not a screenshot."""
    W, H, s = 1280, 720, 3
    img = Image.new("RGBA", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            t = y / H
            px[x, y] = (int(34 + 70 * (1 - t)), int(44 + 90 * (1 - t)), int(80 + 110 * (1 - t)), 255)
    d = ImageDraw.Draw(img)
    d.rectangle([0, int(H * 0.72), W, H], fill=(70, 110, 60, 255))
    hot = 182 * s
    x0 = (W - hot) // 2
    for i in range(9):
        d.rectangle([x0 + i * 20 * s, H - 24 * s, x0 + i * 20 * s + 19 * s, H - 4 * s], fill=(40, 40, 40, 200), outline=(130, 130, 130, 255))
    scaled = logo.resize((round(logo.width * s * h_units / logo.height), h_units * s), Image.LANCZOS)
    img.alpha_composite(scaled, (W - scaled.width - 3 * s, 3 * s))
    d.text((12, 10), f"Mockup, not a real screenshot: {name}", fill=(255, 255, 255, 255))
    img.convert("RGB").save(path)


def build(name, logo_path, out_dir, version, height, pixel, preview):
    if not 2 <= len(name.strip()) <= 40:
        sys.exit("The server name has to be 2 to 40 characters.")
    src = Image.open(logo_path)
    if src.width > 4096 or src.height > 4096:
        sys.exit("The logo is too big. Use a PNG under 4096 pixels.")
    logo = trimmed(src)
    texture, w_units, h_units = sized(logo, height, pixel)
    files = {
        "manifest.json": json.dumps(manifest(name.strip(), version), indent=2).encode(),
        "pack_icon.png": png_bytes(pack_icon(logo)),
        TEXTURE + ".png": png_bytes(texture),
        "ui/hud_screen.json": json.dumps(hud_json(w_units, h_units), indent=2).encode(),
    }
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    pack = out / f"{slug(name)}_Network_Logo.mcpack"
    with zipfile.ZipFile(pack, "w", zipfile.ZIP_DEFLATED) as z:
        for filename, data in files.items():
            z.writestr(filename, data)
    if preview:
        mockup(logo, h_units, preview, name)
    return pack, (w_units, h_units)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", required=True)
    ap.add_argument("--logo", default=str(HERE / "default_logo.png"))
    ap.add_argument("--out", default=str(HERE / "dist"))
    ap.add_argument("--version", default="1.0.0", help="x.y.z; raise it when you change the logo so players download it again")
    ap.add_argument("--height", type=int, default=10)
    ap.add_argument("--pixel", action="store_true")
    ap.add_argument("--preview")
    a = ap.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+", a.version):
        sys.exit("--version looks like 1.0.0")
    if not 6 <= a.height <= 16:
        sys.exit("--height is between 6 and 16")
    pack, size = build(a.name, a.logo, a.out, [int(x) for x in a.version.split(".")], a.height, a.pixel, a.preview)
    print(f"{pack}  (logo {size[0]} x {size[1]} UI units, top-right corner)")
