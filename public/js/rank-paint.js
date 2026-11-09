// Rank colors and gradients, drawn exactly like in game (same math as the plugin's ranks.py).
// Bedrock text can only use its 28 built-in colors, so a gradient is a chain of those colors.

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

// [key, name, chain of Bedrock color codes]: real Bedrock colors in smooth order (no hex colors exist
// in Bedrock text). Each letter gets its own step along the chain (same math as the plugin's ranks.py).
export const GRADIENTS = [
  ["galaxy", "Galaxy (logo)", ["b", "s", "3", "9", "t"]],
  ["gold", "Gold Rush", ["e", "g", "p", "6", "v", "n"]],
  ["sunset", "Sunset", ["e", "g", "6", "v", "c", "d", "u"]],
  ["fire", "Fire", ["e", "g", "6", "v", "c", "m", "4"]],
  ["ocean", "Ocean", ["f", "b", "s", "3", "9", "t"]],
  ["forest", "Forest", ["e", "a", "q", "2", "s", "3"]],
  ["royal", "Royal", ["f", "d", "u", "5", "9"]],
  ["ice", "Ice", ["f", "h", "i", "b", "s", "3"]],
  ["shadow", "Shadow", ["f", "h", "i", "7", "8"]],
  ["rainbow", "Rainbow", ["c", "v", "6", "g", "e", "a", "q", "b", "s", "9", "u", "d"]],
  ["aurora", "Aurora", ["a", "q", "s", "b", "9", "u", "d"]],
  ["cherry", "Cherry Blossom", ["f", "h", "d", "u", "5"]],
  ["ember", "Ember", ["e", "6", "v", "n", "c", "m", "4"]],
];
const gradientChain = (key) => (GRADIENTS.find((g) => g[0] === key) || [])[2] || null;
export const gradientStops = (key) => (gradientChain(key) || []).map(hexOf);

// The Bedrock color code for letter k of n.
export function gradientCode(chain, k, n) {
  const m = chain.length;
  if (n <= 1 || m === 1) return chain[0];
  if (n <= m) return chain[Math.round((k * (m - 1)) / (n - 1))];
  return chain[Math.min(m - 1, Math.floor((k * m) / n))];
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
  const stops = rank && rank.gradient ? gradientChain(rank.gradient) : null;
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
