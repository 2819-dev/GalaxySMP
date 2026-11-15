// Badges: special awards drawn as glossy hexagons (Xbox-achievement style), with the icon in the middle.
// The Owner badge is gold with a starry galaxy inside, a crown, a glow and a shimmer.
import { iconEl } from "/js/site.js";
import { h, openDialog } from "/js/dialog.js";

const THEMES = {
  gold: { frame: ["#FFF6C2", "#E7B53A", "#8A5A12"], inner: ["#FFE07A", "#C98A16"], ink: "#4a2d00" },
  silver: { frame: ["#FFFFFF", "#C3CCD6", "#5E6A75"], inner: ["#EEF2F6", "#8794A2"], ink: "#27313b" },
  bronze: { frame: ["#FFDDB8", "#C9803F", "#6B3A16"], inner: ["#EDB07C", "#8E4E20"], ink: "#3a1d07" },
  ruby: { frame: ["#FFE1E6", "#C9CED6", "#6B7280"], inner: ["#FF6B81", "#9E0F2E"], ink: "#fff" },
  emerald: { frame: ["#E3FFF0", "#C9CED6", "#6B7280"], inner: ["#5CF2A6", "#0B7A45"], ink: "#fff" },
  sapphire: { frame: ["#E3F0FF", "#C9CED6", "#6B7280"], inner: ["#6FB6FF", "#1438A8"], ink: "#fff" },
  amethyst: { frame: ["#F1E6FF", "#C9CED6", "#6B7280"], inner: ["#C9A0FF", "#5B1FB8"], ink: "#fff" },
  galaxy: { frame: ["#E6E9FF", "#9AA6D6", "#3B4380"], inner: ["#8A5CFF", "#141A52"], ink: "#fff", stars: true },
  sunset: { frame: ["#FFF0E0", "#E7B53A", "#8A5A12"], inner: ["#FFB36B", "#E0457B"], ink: "#fff" },
  ice: { frame: ["#FFFFFF", "#BFEFFF", "#4A8BA8"], inner: ["#E0FBFF", "#4FC3E8"], ink: "#0b3a4d" },
  rosegold: { frame: ["#FFF1EC", "#E8B4A0", "#8C5446"], inner: ["#F7C9B8", "#B9705E"], ink: "#4a1f15" },
  obsidian: { frame: ["#9AA0B4", "#3A3F52", "#0E1018"], inner: ["#3B3550", "#07060D"], ink: "#C9B8FF" },
  neon: { frame: ["#E9FFF9", "#4BE3C0", "#0E6E5C"], inner: ["#1B1F3A", "#05060F"], ink: "#4BFFD5" },
  mint: { frame: ["#F2FFF8", "#BFE9D2", "#5E8C77"], inner: ["#C8F7DE", "#58C49A"], ink: "#0f3d2a" },
  crimson: { frame: ["#FFE3E3", "#C9CED6", "#6B7280"], inner: ["#E5484D", "#5C0A14"], ink: "#fff" },
  ocean: { frame: ["#E3FAFF", "#9CC9D6", "#3D6B7A"], inner: ["#3FC7E0", "#0B3A78"], ink: "#fff" },
  aurora: { frame: ["#F0FFF6", "#A9E8D0", "#4E7C8C"], inner: ["#7CF5C0", "#5B3FD6"], ink: "#fff", stars: true },
  sakura: { frame: ["#FFF3F7", "#F2C6D6", "#9C5C74"], inner: ["#FFD1E1", "#E77AA5"], ink: "#5a1531" },
  lava: { frame: ["#FFE9D6", "#E07A3A", "#6B2A0E"], inner: ["#FFB547", "#B3200E"], ink: "#fff" },
  midnight: { frame: ["#E6E9FF", "#7F8AC2", "#262C5C"], inner: ["#2C3A8C", "#060A24"], ink: "#FFE08A", stars: true },
  owner: { frame: ["#FFF6C2", "#F2C14E", "#7A4A06"], inner: ["#7B4DFF", "#0D0F3A"], ink: "#FFD866", stars: true, glow: true },
};
const HEX_OUT = "50,3 93,27.5 93,72.5 50,97 7,72.5 7,27.5";
const HEX_IN = "50,13 84.5,32.5 84.5,67.5 50,87 15.5,67.5 15.5,32.5";
let uid = 0;

function hexSvg(t) {
  const id = `bg${++uid}`;
  const stars = t.stars ? [[34, 34, 1.4], [64, 30, 1], [70, 58, 1.6], [30, 62, 1], [52, 74, 1.2], [44, 24, .8], [76, 44, .9]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".85"/>`).join("") : "";
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <linearGradient id="${id}f" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${t.frame[0]}"/><stop offset=".45" stop-color="${t.frame[1]}"/><stop offset="1" stop-color="${t.frame[2]}"/></linearGradient>
      <radialGradient id="${id}i" cx=".35" cy=".25" r="1"><stop offset="0" stop-color="${t.inner[0]}"/><stop offset="1" stop-color="${t.inner[1]}"/></radialGradient>
      <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    </defs>
    <polygon points="${HEX_OUT}" fill="url(#${id}f)" stroke="rgba(0,0,0,.35)" stroke-width="1.5" stroke-linejoin="round"/>
    <polygon points="${HEX_IN}" fill="url(#${id}i)" stroke="rgba(0,0,0,.25)" stroke-width="1.2" stroke-linejoin="round"/>
    ${stars}
    <polygon points="50,13 84.5,32.5 84.5,46 15.5,46 15.5,32.5" fill="url(#${id}s)"/>
  </svg>`;
}

// One hexagon badge. size in px.
// Finishes (animated): holo (rainbow sheen), glow (pulsing light in the badge's color), sparkle (twinkling stars).
export const FINISHES = { none: "None", holo: "Holographic", glow: "Glow", sparkle: "Sparkle" };

export function hexBadge(b, size = 44) {
  const t = THEMES[b.style] || THEMES.gold;
  const finish = FINISHES[b.finish] && b.finish !== "none" ? b.finish : null;
  const el = h("span", { class: `hexb hexb-${b.style}${t.glow ? " hexb-glow" : ""}${finish ? ` hexb-f-${finish}` : ""}`, style: `--s:${size}px;--ink:${t.ink};--glowc:${t.inner[0]}` });
  el.innerHTML = hexSvg(t); // fixed drawing only (no user text)
  if (finish === "holo") el.append(h("span", { class: "hexb-holo" }));
  const ic = iconEl(b.icon || "star", "hexb-icon");
  el.append(ic);
  if (b.style === "owner" || finish === "holo") el.append(h("span", { class: "hexb-shine" }));
  if (finish === "sparkle") for (let i = 0; i < 4; i++) el.append(h("span", { class: `hexb-spark hexb-spark${i}` }));
  return el;
}

// A row of badges; tapping one shows its name and description.
export function badgeRow(badges, size = 30) {
  const row = h("div", { class: "hexb-row" });
  for (const b of badges || []) {
    const btn = h("button", { class: "hexb-btn", type: "button", title: b.name, "aria-label": `Badge: ${b.name}` }, hexBadge(b, size));
    btn.addEventListener("click", (e) => { e.stopPropagation(); showBadge(b); });
    row.append(btn);
  }
  return row;
}

export function showBadge(b) {
  openDialog({
    title: "Badge",
    body: h("div", { class: "hexb-detail" }, hexBadge(b, 120),
      h("h3", { text: b.name }),
      b.description ? h("p", { class: "text-2", text: b.description }) : null,
      b.builtIn ? h("p", { class: "text-3 small", text: "A special badge only the owner has." })
        : b.awardedAt ? h("p", { class: "text-3 small", text: `Awarded ${new Date(b.awardedAt).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}` }) : null),
    actions: [{ label: "Close", kind: "primary" }],
  });
}

export const BADGE_THEMES = Object.keys(THEMES).filter((k) => k !== "owner");
