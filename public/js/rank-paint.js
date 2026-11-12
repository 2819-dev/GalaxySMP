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
  const smooth = rank && rank.gradient ? GRADIENT_HEX[rank.gradient] : null;
  if (smooth) {  // the website can show real smooth gradients (in game: tag pictures)
    const span = document.createElement("span");
    span.className = "rank-tag-smooth";
    span.style.backgroundImage = `linear-gradient(90deg, ${smooth.join(", ")})`;
    const chars = [...text];
    span.append(chars[0] || "");
    if (icon && chars.length > 1) span.append(iconImg(icon));
    span.append(chars.slice(1).join(""));
    return span;
  }
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

// Smooth hex colors for rank tags (same as the plugin's GRADIENT_HEX; in game they're pictures).
export const GRADIENT_HEX = {
  galaxy: ["#4FEBFD", "#3DAAF4", "#2149DD"],
  gold: ["#FFF27A", "#FFD23F", "#FFAA00", "#E07B00"],
  sunset: ["#FFE45C", "#FF9A3D", "#FF5E62", "#D94BFF"],
  fire: ["#FFF35C", "#FFB000", "#FF5A00", "#C80000"],
  ocean: ["#C9FFFF", "#4FE3F0", "#1FA2C8", "#2463B8"],
  forest: ["#C6FF6B", "#5BE35B", "#22A447", "#14806E"],
  royal: ["#FF8AF2", "#C36BFF", "#8A3CFF", "#4F56FF"],
  ice: ["#FFFFFF", "#D6F6FF", "#8EE3FF", "#4FC3E8"],
  shadow: ["#F2F2F2", "#B8B8C8", "#7A7A8C", "#4A4A58"],
  rainbow: ["#FF4D4D", "#FFA53D", "#FFF04D", "#5BFF6B", "#4DE8FF", "#5C6BFF", "#D45CFF"],
  aurora: ["#7CFF8A", "#3DF0C8", "#4DB8FF", "#9A6BFF", "#FF6BE1"],
  cherry: ["#FFFFFF", "#FFC6E3", "#FF7FC4", "#C25CD6"],
  ember: ["#FFE45C", "#FF9A1F", "#FF4A1F", "#B31212"],
};

// Rank badges (same look and math as the in-game badge pictures, plugin badges.py): a rounded pill in
// the rank's colors, made deep enough for white letters, with the rank's icon in white.
const MAX_LUMA = 0.62;
function hls(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, l, 0];
  const d = mx - mn, s = l <= 0.5 ? d / (mx + mn) : d / (2 - mx - mn);
  const rc = (mx - r) / d, gc = (mx - g) / d, bc = (mx - b) / d;
  let h = r === mx ? bc - gc : g === mx ? 2 + rc - bc : 4 + gc - rc;
  h = ((h / 6) % 1 + 1) % 1;
  return [h, l, s];
}
function rgbOf(h, l, s) {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s, m1 = 2 * l - m2;
  const v = (hh) => {
    hh = ((hh % 1) + 1) % 1;
    if (hh < 1 / 6) return m1 + (m2 - m1) * hh * 6;
    if (hh < 0.5) return m2;
    if (hh < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hh) * 6;
    return m1;
  };
  return [v(h + 1 / 3), v(h), v(h - 1 / 3)];
}
export function badgeColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  let [h, l, s] = hls(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  if (s > 0.05) s = Math.max(s, 0.6);
  for (let i = 0; i < 60; i++) {
    const [r, g, b] = rgbOf(h, l, s);
    if (0.299 * r + 0.587 * g + 0.114 * b <= MAX_LUMA || l <= 0.2) break;
    l -= 0.01;
  }
  return "#" + rgbOf(h, l, s).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}
export const badgeStops = (rank) => (rank.gradient && GRADIENT_HEX[rank.gradient] ? GRADIENT_HEX[rank.gradient] : [hexOf(rank.color || "f")]).map(badgeColor);

// The rank badge for a rank (or null).
export function rankTag(rank) {
  if (!rank) return null;
  const stops = badgeStops(rank);
  const tag = document.createElement("span");
  tag.className = "rank-tag";
  tag.style.background = stops.length > 1 ? `linear-gradient(90deg, ${stops.join(", ")})` : stops[0];
  if (rank.icon) {
    const img = document.createElement("img");
    img.className = "rank-tag-icon";
    img.src = ["", "img", "badge", `rank_${rank.icon}.png`].join("/");
    img.alt = "";
    img.width = 14;
    img.height = 14;
    tag.append(img);
  }
  tag.append(rank.prefix || rank.name || "");
  tag.title = rank.name || rank.prefix || "";
  return tag;
}

// CSS gradient for swatches.
export const gradientCss = (key) => `linear-gradient(90deg, ${gradientStops(key).join(", ")})`;

// Discord-style role icon (the rank's icon), shown after a name.
export function roleIcon(rank) {
  if (!rank || !rank.icon) return null;
  const img = iconImg(rank.icon);
  img.className = "role-icon";
  img.alt = rank.name || "";
  img.dataset.role = rank.name || rank.prefix || "";
  img.tabIndex = 0;
  img.setAttribute("role", "button");
  img.setAttribute("aria-label", `Role: ${img.dataset.role}`);
  // Like Discord: tap the icon to see the role's name in a small bubble (hover shows it too on computers).
  const open = (e) => { e.stopPropagation(); e.preventDefault(); showRoleTip(img); };
  img.addEventListener("click", open);
  img.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") open(e); });
  img.addEventListener("mouseenter", () => { if (matchMedia("(hover: hover)").matches) showRoleTip(img); });
  img.addEventListener("mouseleave", () => { if (matchMedia("(hover: hover)").matches) hideRoleTip(); });
  return img;
}

let roleTip = null;
let roleTipTimer = null;
function hideRoleTip() {
  clearTimeout(roleTipTimer);
  roleTip?.remove();
  roleTip = null;
}
function showRoleTip(img) {
  hideRoleTip();
  const tip = document.createElement("div");
  tip.className = "role-tip";
  tip.setAttribute("role", "tooltip");
  const icon = iconImg(img.src.match(/rank_(.+)\.png/)?.[1] || "");
  icon.className = "role-tip-icon";
  tip.append(icon, document.createTextNode(img.dataset.role));
  document.body.append(tip);
  const r = img.getBoundingClientRect();
  const w = tip.offsetWidth;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  const above = r.top - tip.offsetHeight - 8 > 4;
  tip.style.left = `${left}px`;
  tip.style.top = `${above ? r.top - tip.offsetHeight - 8 : r.bottom + 8}px`;
  tip.classList.add(above ? "above" : "below");
  tip.style.setProperty("--arrow-x", `${r.left + r.width / 2 - left}px`);
  roleTip = tip;
  roleTipTimer = setTimeout(hideRoleTip, 2500);
}
document.addEventListener("click", (e) => { if (roleTip && !e.target.closest?.(".role-icon")) hideRoleTip(); });
window.addEventListener("scroll", hideRoleTip, true);

// The rank's color as CSS: a smooth gradient or a single color (for role dots, headers and banners).
export function rankCss(rank) {
  if (!rank) return null;
  const stops = rank.gradient ? GRADIENT_HEX[rank.gradient] : null;
  return stops ? `linear-gradient(90deg, ${stops.join(", ")})` : hexOf(rank.color || "f");
}
