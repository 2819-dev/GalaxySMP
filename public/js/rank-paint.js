// Rank colors and gradients, drawn exactly like in game (same math as the plugin's ranks.py).
// Bedrock text can only use its 28 built-in colors, so a gradient is a smooth line between
// real colors, and each letter gets the closest Bedrock color to its point on that line.

// Grouped by shade. Codes g-v only exist on Bedrock.
export const MC_COLORS = [
  ["f", "White", "#FFFFFF"], ["h", "Quartz", "#E3D4D1"], ["i", "Iron", "#CECACA"], ["7", "Gray", "#AAAAAA"],
  ["8", "Dark Gray", "#555555"], ["j", "Netherite", "#443A3B"], ["0", "Black", "#000000"], ["c", "Red", "#FF5555"],
  ["4", "Dark Red", "#AA0000"], ["m", "Redstone", "#971607"], ["v", "Resin", "#EB7114"], ["n", "Copper", "#B4684D"],
  ["6", "Gold", "#FFAA00"], ["p", "Deep Gold", "#DEB12D"], ["g", "Minecoin Gold", "#DDD605"], ["e", "Yellow", "#FFFF55"],
  ["a", "Green", "#55FF55"], ["q", "Emerald", "#47A036"], ["2", "Dark Green", "#00AA00"], ["b", "Aqua", "#55FFFF"],
  ["s", "Diamond", "#2CBAA8"], ["3", "Dark Aqua", "#00AAAA"], ["9", "Blue", "#5555FF"], ["1", "Dark Blue", "#0000AA"],
  ["t", "Lapis", "#21497B"], ["d", "Light Purple", "#FF55FF"], ["u", "Amethyst", "#9A5CC6"], ["5", "Dark Purple", "#AA00AA"],
];
export const hexOf = (c) => (MC_COLORS.find((x) => x[0] === c) || MC_COLORS[0])[2];

// [key, name, colors along the gradient]
export const GRADIENTS = [
  ["galaxy", "Galaxy (logo)", ["#4FEBFD", "#3DAAF4", "#2149DD"]],
  ["gold", "Gold Rush", ["#FFFF55", "#DDD605", "#DEB12D", "#FFAA00"]],
  ["sunset", "Sunset", ["#FFFF55", "#FFAA00", "#EB7114", "#FF5555", "#FF55FF"]],
  ["fire", "Fire", ["#FFFF55", "#FFAA00", "#EB7114", "#FF5555", "#AA0000"]],
  ["ocean", "Ocean", ["#55FFFF", "#2CBAA8", "#00AAAA", "#21497B"]],
  ["forest", "Forest", ["#55FF55", "#47A036", "#00AA00"]],
  ["royal", "Royal", ["#FF55FF", "#9A5CC6", "#AA00AA"]],
  ["ice", "Ice", ["#FFFFFF", "#E3D4D1", "#55FFFF", "#2CBAA8"]],
  ["shadow", "Shadow", ["#AAAAAA", "#555555", "#443A3B"]],
  ["rainbow", "Rainbow", ["#FF5555", "#FFAA00", "#FFFF55", "#55FF55", "#55FFFF", "#5555FF", "#FF55FF"]],
];
export const gradientStops = (key) => (GRADIENTS.find((g) => g[0] === key) || [])[2] || null;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const PALETTE = MC_COLORS.map(([code, , hex]) => [code, rgb(hex)]);

function nearest([r, g, b]) {
  let best = null;
  let bestD = Infinity;
  for (const [code, [R, G, B]] of PALETTE) {
    const rm = (r + R) / 2;
    const d = (2 + rm / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - rm) / 256) * (b - B) ** 2;
    if (d < bestD) { bestD = d; best = code; }
  }
  return best;
}

// The Bedrock color code for letter k of n.
export function gradientCode(stops, k, n) {
  const t = n > 1 ? k / (n - 1) : 0;
  const pos = t * (stops.length - 1);
  const i = Math.min(Math.floor(pos), stops.length - 2);
  const f = stops.length > 1 ? pos - i : 0;
  const a = rgb(stops[i]);
  const b = rgb(stops[Math.min(i + 1, stops.length - 1)]);
  return nearest(a.map((v, j) => Math.round(v + (b[j] - v) * f)));
}

const iconImg = (icon) => {
  const img = document.createElement("img");
  img.className = "rank-icon";
  img.src = `/img/ranks/rank_${icon}.png`;
  img.alt = "";
  img.width = 18;
  img.height = 18;
  return img;
};

// Text in a rank's color, or one gradient color per letter. `icon` goes after the first character ("[").
export function paint(text, rank, icon) {
  const span = document.createElement("span");
  const stops = rank && rank.gradient ? gradientStops(rank.gradient) : null;
  const n = [...text].filter((ch) => ch.trim()).length;
  let k = 0;
  [...text].forEach((ch, i) => {
    if (icon && i === 1) span.append(iconImg(icon));
    if (!ch.trim()) { span.append(ch); return; }
    const code = stops ? gradientCode(stops, k, n) : (rank ? rank.color : "f");
    k++;
    const part = document.createElement("span");
    part.textContent = ch;
    part.style.color = hexOf(code);
    span.append(part);
  });
  return span;
}

// [👑 OWNER] for a rank (or null).
export function rankTag(rank) {
  if (!rank) return null;
  const tag = paint(`[${rank.prefix}]`, rank, rank.icon);
  tag.className = "rank-tag";
  return tag;
}

// CSS gradient for swatches.
export const gradientCss = (key) => `linear-gradient(90deg, ${gradientStops(key).join(", ")})`;
