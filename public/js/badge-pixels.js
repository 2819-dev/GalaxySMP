// The in-game rank badge, drawn pixel for pixel like the plugin draws it (badges.py render_badge):
// a rounded pill in the rank's colors, the rank's icon at 8x8 and its name in the Minecraft-style letters.
// Used for the "In game" preview in Control Panel > Ranks.
import { C, FONT, ICONS8 } from "/js/badge-pixels-data.js";

const WHITE = [255, 255, 255];

// Python's round(): halves go to the even number (so the colors match the game exactly)
function pyRound(x) {
  const f = Math.floor(x), d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
const hex = (h) => { h = String(h).replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };

// Python's colorsys.rgb_to_hls / hls_to_rgb
function rgbToHls(r, g, b) {
  const maxc = Math.max(r, g, b), minc = Math.min(r, g, b), sumc = maxc + minc, rangec = maxc - minc;
  const l = sumc / 2;
  if (minc === maxc) return [0, l, 0];
  const s = l <= 0.5 ? rangec / sumc : rangec / (2 - maxc - minc);
  const rc = (maxc - r) / rangec, gc = (maxc - g) / rangec, bc = (maxc - b) / rangec;
  let h;
  if (r === maxc) h = bc - gc;
  else if (g === maxc) h = 2 + rc - bc;
  else h = 4 + gc - rc;
  h = ((h / 6) % 1 + 1) % 1;
  return [h, l, s];
}
function v(m1, m2, hue) {
  hue = ((hue % 1) + 1) % 1;
  if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6;
  if (hue < 0.5) return m2;
  if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
  return m1;
}
function hlsToRgb(h, l, s) {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s, m1 = 2 * l - m2;
  return [v(m1, m2, h + 1 / 3), v(m1, m2, h), v(m1, m2, h - 1 / 3)];
}

function badgeColor(h) {
  const [r, g, b] = hex(h).map((x) => x / 255);
  let [hue, light, sat] = rgbToHls(r, g, b);
  if (sat > 0.05) sat = Math.max(sat, 0.6);
  for (let i = 0; i < 60; i++) {
    const c = hlsToRgb(hue, light, sat);
    if (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] <= C.MAX_LUMA || light <= 0.2) break;
    light -= 0.01;
  }
  return hlsToRgb(hue, light, sat).map((x) => pyRound(x * 255));
}
const mix = (a, b, t) => a.map((x, i) => pyRound(x + (b[i] - x) * t));
function along(stops, t) {
  if (stops.length === 1) return stops[0];
  const pos = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(pos), stops.length - 2);
  return mix(stops[i], stops[i + 1], pos - i);
}
function inside(x, y, w, h, r) {
  const cx = x < r ? r - 0.5 : (x >= w - r ? w - r - 0.5 : x);
  const cy = y < r ? r - 0.5 : (y >= h - r ? h - r - 0.5 : y);
  return (x - cx) ** 2 + (y - cy) ** 2 <= (r - 0.1) ** 2 + 0.6;
}
const glyph = (ch) => FONT[ch] || FONT[ch.toUpperCase()] || null;

// Returns { width, height, pixels: Map("x,y" -> [r, g, b]) }
export function badgePixels(prefix, stopsHex, icon) {
  const { HEIGHT, RADIUS, TEXT_TOP, ICON, ICON_TOP, PAD, GAP, SCALE } = C;
  const stops = (stopsHex && stopsHex.length ? stopsHex : ["#7A7A8C"]).map(badgeColor);
  const ipx = icon && ICONS8[icon] ? ICONS8[icon] : null;
  let tw = 0;
  for (const ch of prefix) { const g = glyph(ch); tw += g ? g[0].length + 1 : 3; }
  tw = Math.max(0, tw - 1) * SCALE;
  const width = PAD + (ipx ? ICON + GAP : 0) + tw + PAD + 1;
  const pixels = new Map();
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y, width, HEIGHT, RADIUS)) continue;
      const base = along(stops, x / Math.max(1, width - 1));
      let c = y === 1 ? mix(base, WHITE, 0.18) : y === HEIGHT - 2 ? mix(base, [0, 0, 0], 0.12) : base;
      const edge = ![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => inside(x + dx, y + dy, width, HEIGHT, RADIUS));
      if (edge) c = mix(base, [0, 0, 0], 0.38);
      pixels.set(`${x},${y}`, c);
    }
  }
  const marks = new Map();
  let x0 = PAD;
  if (ipx) {
    ipx.forEach((c, i) => { if (c) marks.set(`${x0 + (i % ICON)},${ICON_TOP + Math.floor(i / ICON)}`, hex(c)); });
    x0 += ICON + GAP;
  }
  for (const ch of prefix) {
    const g = glyph(ch);
    if (!g) { x0 += 3 * SCALE; continue; }
    g.forEach((line, row) => [...line].forEach((c, col) => {
      if (c !== "#") return;
      for (let dx = 0; dx < SCALE; dx++) for (let dy = 0; dy < SCALE; dy++) marks.set(`${x0 + col * SCALE + dx},${TEXT_TOP + row * SCALE + dy}`, WHITE);
    }));
    x0 += (g[0].length + 1) * SCALE;
  }
  for (const key of marks.keys()) {
    const [x, y] = key.split(",").map(Number);
    const s = `${x + 1},${y + 1}`;
    if (pixels.has(s) && !marks.has(s)) pixels.set(s, mix(along(stops, (x + 1) / Math.max(1, width - 1)), [0, 0, 0], 0.35));
  }
  for (const [key, c] of marks) if (pixels.has(key)) pixels.set(key, c);
  return { width, height: HEIGHT, pixels };
}

// A <canvas> with the badge, each badge pixel drawn as `zoom` x `zoom` screen pixels (crisp, no blur).
export function badgeCanvas(prefix, stopsHex, icon, zoom = 4) {
  const { width, height, pixels } = badgePixels(String(prefix || ""), stopsHex, icon);
  const cv = document.createElement("canvas");
  cv.width = width * zoom; cv.height = height * zoom;
  cv.style.imageRendering = "pixelated";
  cv.style.width = `${width * zoom}px`; cv.style.height = `${height * zoom}px`;
  const g = cv.getContext("2d");
  for (const [key, c] of pixels) {
    const [x, y] = key.split(",").map(Number);
    g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    g.fillRect(x * zoom, y * zoom, zoom, zoom);
  }
  return cv;
}
