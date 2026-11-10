"""Player heads for the community website: the 8x8 face (with the hat layer on top) cut out of the
player's skin, sent to galaxymc.us as profile pictures. Only used on the website."""


def face_hex(skin_image):
    """skin_image: numpy array (height, width, 4) of the skin. Returns 8x8 RGBA as hex, or None."""
    try:
        img = skin_image
        h, w = int(img.shape[0]), int(img.shape[1])
        if len(img.shape) == 2:  # flat rows of RGBA bytes
            w //= 4
            img = img.reshape(h, w, 4)
        if w < 64 or h < 32:
            return None
        s = w // 64
        out = bytearray()
        for y in range(8):
            for x in range(8):
                fy, fx = (8 + y) * s, (8 + x) * s
                r, g, b, a = (int(v) for v in img[fy][fx][:4])
                hy, hx = (8 + y) * s, (40 + x) * s
                hr, hg, hb, ha = (int(v) for v in img[hy][hx][:4])
                if ha > 0:  # hat layer over the face
                    k = ha / 255
                    r, g, b = (round(hr * k + r * (1 - k)), round(hg * k + g * (1 - k)), round(hb * k + b * (1 - k)))
                out += bytes((r, g, b, 255 if a or ha else 0))
        if not any(out[3::4]):
            return None
        return out.hex()
    except Exception:
        return None


def send_head(plugin, player):
    voice = getattr(plugin, "_voice", None)
    if not voice or not voice.ws:
        return
    try:
        hexdata = face_hex(player.skin.image)
    except Exception:
        hexdata = None
    if hexdata:
        voice.send_json({"type": "head", "xuid": str(player.xuid), "rgba": hexdata})
