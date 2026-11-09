# Splits the GalaxySMP wordmark into 6 font glyphs (U+E300 to U+E305) so the logo can be
# shown inside Minecraft menus (the Help menu's Server Information page).
# Usage: python3 draw_logo.py ../public/img/wordmark.png src/font/glyph_E3.png
import sys
from PIL import Image

CELL = 32  # 512x512 sheet = 16x16 cells of 32 pixels (sharper than 16)
src, out = sys.argv[1], sys.argv[2]
logo = Image.open(src).convert("RGBA")
logo = logo.crop(logo.getbbox())
w, h = logo.size
logo = logo.resize((round(w * CELL / h), CELL), Image.NEAREST)
cells = -(-logo.size[0] // CELL)
sheet = Image.new("RGBA", (CELL * 16, CELL * 16))
for i in range(cells):
    part = logo.crop((i * CELL, 0, (i + 1) * CELL, CELL))
    sheet.paste(part, (i * CELL, 0))
sheet.save(out)
print(f"logo: {cells} glyphs, U+E300 to U+{0xE300 + cells - 1:X}")
