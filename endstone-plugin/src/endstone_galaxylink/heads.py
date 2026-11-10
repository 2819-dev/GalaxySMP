"""Player heads for the community website: the 8x8 face (with the hat layer on top) cut out of the
player's skin, sent to galaxymc.us as profile pictures. Only used on the website."""

SIZES = [(64, 64), (64, 32), (128, 128), (128, 64), (256, 256), (256, 128), (512, 512), (512, 256), (1024, 1024)]


def _pixels(skin_image):
    """Any skin image (numpy array of any shape, or raw bytes) -> (width, height, flat RGBA bytes)."""
    shape = tuple(int(x) for x in getattr(skin_image, "shape", ()) or ())
    try:
        import numpy as np
        flat = bytes(np.asarray(skin_image, dtype=np.uint8).reshape(-1))
    except Exception:
        flat = bytes(skin_image)
    n = len(flat)
    # Use the array's own shape when it makes sense: (h, w, 4), (h, w*4) or (h, w, 3)
    if len(shape) == 3 and shape[2] in (3, 4):
        h, w, ch = shape
        if ch == 3:  # no alpha channel: add one (and mark it, so the hat layer isn't drawn over the face)
            flat = b"".join(flat[i:i + 3] + b"\xfe" for i in range(0, n, 3))
        return w, h, flat
    if len(shape) == 2 and shape[1] % 4 == 0 and shape[0] * shape[1] == n:
        return shape[1] // 4, shape[0], flat
    for w, h in SIZES:  # a flat list of pixels: work out the size
        if w * h * 4 == n:
            return w, h, flat
    return None, None, flat


def face_hex(skin_image):
    """Returns the 8x8 face (+ hat layer) as RGBA hex, or (None, reason)."""
    try:
        w, h, flat = _pixels(skin_image)
    except Exception as e:
        return None, f"couldn't read the skin ({e})"
    if not w or w < 64 or h < 32:
        return None, f"unusual skin size ({len(flat)} bytes)"
    s = w // 64

    def px(x, y):
        i = ((y * s) * w + x * s) * 4
        return flat[i], flat[i + 1], flat[i + 2], flat[i + 3]

    out = bytearray()
    for y in range(8):
        for x in range(8):
            r, g, b, a = px(8 + x, 8 + y)
            hr, hg, hb, ha = px(40 + x, 8 + y)
            if ha == 254:  # skin without transparency: no hat layer
                ha = 0
            if ha > 0:  # hat layer over the face
                k = ha / 255
                r, g, b = (round(hr * k + r * (1 - k)), round(hg * k + g * (1 - k)), round(hb * k + b * (1 - k)))
            out += bytes((r, g, b, 255 if a or ha else 0))
    if not any(out[3::4]):
        return None, f"the face area of this {w}x{h} skin is empty (probably a Character Creator skin)"
    return out.hex(), None


_reported = set()


def send_head(plugin, player):
    voice = getattr(plugin, "_voice", None)
    if not voice or not voice.ws:
        return
    try:
        hexdata, why = face_hex(player.skin.image)
    except Exception as e:
        hexdata, why = None, f"couldn't get the skin ({e})"
    if hexdata:
        voice.send_json({"type": "head", "xuid": str(player.xuid), "rgba": hexdata})
        if str(player.xuid) not in _reported:
            _reported.add(str(player.xuid))
            plugin.logger.info(f"Sent {player.name}'s head to the website (community profile picture).")
    elif str(player.xuid) not in _reported:
        _reported.add(str(player.xuid))
        plugin.logger.warning(f"No community head for {player.name}: {why}.")
