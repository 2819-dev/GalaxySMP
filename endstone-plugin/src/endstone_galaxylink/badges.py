"""Rank badges: a rounded pill in the rank's colors with the rank's icon and name in white, drawn as
pictures for the rank tag pack (ranktags.py). Pure Python (no image libraries on the server).

Badges are drawn at text size (Bedrock shows 1 picture pixel as 1 text pixel; bigger pictures just
show bigger): 10 pixels tall, the Minecraft-style letters (7 tall) in white, and the rank's icon in
color, shrunk to 8x8.
"""

import base64
import colorsys
import zlib

SCALE = 1           # picture pixels per text pixel
HEIGHT = 10         # badge height
RADIUS = 2          # rounded corners
TEXT_TOP = 1        # first row of the letters (rows 1-7)
ICON = 8            # icon size
ICON_TOP = 1        # icon rows 1-8
PAD = 2             # space inside the left and right edge
GAP = 2             # between the icon and the name
MAX_LUMA = 0.62     # badge colors are kept this dark or darker so white letters always read well
WHITE = (255, 255, 255)
OUTLINE = (24, 24, 32)  # the icons' dark outline color (left out inside badges)

_icons = {}


def _hex(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def badge_color(h):
    """A rank color made deep enough for white letters (same math as the website's badgeColor):
    lighter colors are darkened (same hue) until their brightness is at most MAX_LUMA."""
    r, g, b = (v / 255 for v in _hex(h))
    hue, light, sat = colorsys.rgb_to_hls(r, g, b)
    if sat > 0.05:
        sat = max(sat, 0.6)
    for _ in range(60):
        rgb = colorsys.hls_to_rgb(hue, light, sat)
        if 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] <= MAX_LUMA or light <= 0.2:
            break
        light -= 0.01
    return tuple(int(round(v * 255)) for v in colorsys.hls_to_rgb(hue, light, sat))


def _mix(a, b, t):
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(a, b))


def _along(stops, t):
    if len(stops) == 1:
        return stops[0]
    pos = max(0.0, min(1.0, t)) * (len(stops) - 1)
    i = min(int(pos), len(stops) - 2)
    return _mix(stops[i], stops[i + 1], pos - i)


def icon_pixels(name):
    """The rank icon as a white picture: {(x, y): (r, g, b, a)} in a 16x16 box, or None.
    The icon's own shading is kept as soft white-to-light-gray, and its dark outline is left out."""
    if name in _icons:
        return _icons[name]
    from endstone_galaxylink.badge_icons import ICONS
    data = ICONS.get(name or "")
    if not data:
        _icons[name] = None
        return None
    raw = zlib.decompress(base64.b64decode(data))
    px = {}
    lum = {}
    for i in range(256):
        r, g, b, a = raw[i * 4:i * 4 + 4]
        if a < 128 or (r, g, b) == OUTLINE:
            continue
        lum[(i % 16, i // 16)] = 0.299 * r + 0.587 * g + 0.114 * b
    if lum:
        lo, hi = min(lum.values()), max(lum.values())
        for xy, l in lum.items():
            t = (l - lo) / (hi - lo) if hi > lo else 1.0
            v = int(round(205 + 50 * t))  # darkest part light gray, brightest pure white
            px[xy] = (v, v, min(255, v + 6), 255)
    _icons[name] = px
    return px


def icon8_pixels(name):
    """The rank icon in color at 8x8 (for badges at text size): {(x, y): (r, g, b, a)}, or None."""
    key = ("8", name)
    if key in _icons:
        return _icons[key]
    from endstone_galaxylink.badge_icons import ICONS8
    data = ICONS8.get(name or "")
    px = None
    if data:
        raw = zlib.decompress(base64.b64decode(data))
        px = {(i % ICON, i // ICON): tuple(raw[i * 4:i * 4 + 4]) for i in range(ICON * ICON) if raw[i * 4 + 3] >= 128}
    _icons[key] = px
    return px


def _inside(x, y, w, h, r):
    """Is (x, y) inside a w x h rounded rectangle with corner radius r?"""
    cx = r - 0.5 if x < r else (w - r - 0.5 if x >= w - r else x)
    cy = r - 0.5 if y < r else (h - r - 0.5 if y >= h - r else y)
    return (x - cx) ** 2 + (y - cy) ** 2 <= (r - 0.1) ** 2 + 0.6


def text_width(text, font_char):
    x = 0
    for ch in text:
        g = font_char(ch)
        x += (len(g[0]) + 1) if g else 3
    return max(0, x - 1) * SCALE


def render_badge(prefix, stops_hex, icon, font_char):
    """Draws a badge. Returns (pixels {(x, y): rgba}, width, height)."""
    stops = [badge_color(h) for h in (stops_hex or ["#7A7A8C"])]
    ipx = icon8_pixels(icon) if icon else None
    tw = text_width(prefix, font_char)
    width = PAD + (ICON + GAP if ipx else 0) + tw + PAD + 1
    pixels = {}
    for y in range(HEIGHT):
        for x in range(width):
            if not _inside(x, y, width, HEIGHT, RADIUS):
                continue
            base = _along(stops, x / max(1, width - 1))
            # soft top light and bottom shade, like the glossy pill in the reference
            if y == 1:
                c = _mix(base, WHITE, 0.18)
            elif y == HEIGHT - 2:
                c = _mix(base, (0, 0, 0), 0.12)
            else:
                c = base
            edge = not all(_inside(x + dx, y + dy, width, HEIGHT, RADIUS) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if edge:
                c = _mix(base, (0, 0, 0), 0.38)
            pixels[(x, y)] = (*c, 255)

    # icon and letters: {(x, y): color}; shadows first so nothing gets covered by a neighbour's shadow
    marks = {}
    x0 = PAD
    if ipx:
        for (ix, iy), c in ipx.items():
            marks[(x0 + ix, ICON_TOP + iy)] = c[:3]
        x0 += ICON + GAP
    for ch in prefix:
        g = font_char(ch)
        if g is None:
            x0 += 3 * SCALE
            continue
        for row, line in enumerate(g):
            for col, c in enumerate(line):
                if c == "#":
                    for dx in range(SCALE):
                        for dy in range(SCALE):
                            marks[(x0 + col * SCALE + dx, TEXT_TOP + row * SCALE + dy)] = WHITE
        x0 += (len(g[0]) + 1) * SCALE
    for x, y in marks:
        s = (x + 1, y + 1)
        if s in pixels and s not in marks:
            bg = _along(stops, s[0] / max(1, width - 1))
            pixels[s] = (*_mix(bg, (0, 0, 0), 0.35), 255)
    for xy, c in marks.items():
        if xy in pixels:
            pixels[xy] = (*c, 255)
    return pixels, width, HEIGHT
