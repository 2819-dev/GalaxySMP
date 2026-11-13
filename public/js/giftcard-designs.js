// Gift card designs and amounts (used by the website pages and the server, so they always agree).
// Each design: colors for the card and its gift box, a greeting, and a motif drawn as an SVG.

export const AMOUNTS = [500, 1000, 2500, 5000]; // cents of Galaxy Credits

const svg = (inner) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;

export const DESIGNS = [
  {
    id: "galaxy", name: "Galaxy", group: "Everyday", greeting: "A gift for you",
    bg: "radial-gradient(120% 120% at 85% 10%, #8a5cff 0%, #3b1f8f 35%, #0d0b2a 70%, #05060f 100%)", ink: "#ffffff", accent: "#4febfd",
    box: ["#5b3cc4", "#2a1a6e"], ribbon: "#4febfd", pattern: "stars",
    motif: svg(`<circle cx="32" cy="32" r="14" fill="#b48cff"/><circle cx="27" cy="27" r="5" fill="#fff" opacity=".25"/>
      <ellipse cx="32" cy="34" rx="27" ry="8" fill="none" stroke="#4febfd" stroke-width="3" transform="rotate(-18 32 34)"/>
      <circle cx="10" cy="12" r="1.6" fill="#fff"/><circle cx="54" cy="10" r="1.2" fill="#fff"/><circle cx="52" cy="54" r="1.6" fill="#fff"/>`),
  },
  {
    id: "birthday", name: "Birthday", group: "Everyday", greeting: "Happy Birthday",
    bg: "linear-gradient(135deg, #ff5fa2 0%, #ff8a5c 55%, #ffc94d 100%)", ink: "#ffffff", accent: "#fff3b0",
    box: ["#ff5fa2", "#d63384"], ribbon: "#ffd84f", pattern: "confetti",
    motif: svg(`<rect x="12" y="34" width="40" height="20" rx="4" fill="#fff"/><rect x="12" y="34" width="40" height="7" rx="3" fill="#ffd1e4"/>
      <path d="M12 41c4 4 8-4 13 0s8-4 14 0 9-4 13 0" fill="none" stroke="#ff5fa2" stroke-width="2.5"/>
      <rect x="21" y="22" width="4" height="12" rx="2" fill="#4febfd"/><rect x="30" y="20" width="4" height="14" rx="2" fill="#ffd84f"/><rect x="39" y="22" width="4" height="12" rx="2" fill="#8a5cff"/>
      <path d="M23 16c2 2 0 4 0 4s-2-2 0-4zM32 13c2 2 0 4 0 4s-2-2 0-4zM41 16c2 2 0 4 0 4s-2-2 0-4z" fill="#ff8a3d"/>`),
  },
  {
    id: "thanks", name: "Thank you", group: "Everyday", greeting: "Thank you",
    bg: "linear-gradient(135deg, #ffb347 0%, #ff7a3d 50%, #e2445c 100%)", ink: "#ffffff", accent: "#fff1c9",
    box: ["#ff8a3d", "#d3542a"], ribbon: "#fff1c9", pattern: "dots",
    motif: svg(`<path d="M32 54S10 40 10 25a11 11 0 0 1 22-4 11 11 0 0 1 22 4c0 15-22 29-22 29z" fill="#fff"/>
      <path d="M20 22a6 6 0 0 1 6-5" fill="none" stroke="#ff7a3d" stroke-width="3" stroke-linecap="round" opacity=".6"/>`),
  },
  {
    id: "holiday", name: "Winter holidays", group: "Holidays", greeting: "Happy Holidays",
    bg: "linear-gradient(160deg, #0f6b45 0%, #0b3d2a 55%, #062419 100%)", ink: "#ffffff", accent: "#ff6b6b",
    box: ["#c0392b", "#7d1f17"], ribbon: "#f4f4f4", pattern: "snow",
    motif: svg(`<g stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"><path d="M32 8v48M11 20l42 24M11 44l42-24"/>
      <path d="M26 12l6 6 6-6M26 52l6-6 6 6M12 28l8-1-3-8M52 36l-8 1 3 8M12 36l8 1-3 8M52 28l-8-1 3-8"/></g><circle cx="32" cy="32" r="4" fill="#ff6b6b"/>`),
  },
  {
    id: "chanukah", name: "Chanukah", group: "Jewish holidays", greeting: "Happy Chanukah",
    bg: "linear-gradient(150deg, #1d4fd8 0%, #12307f 55%, #0a1a46 100%)", ink: "#ffffff", accent: "#cfe3ff",
    box: ["#1d4fd8", "#0f2a74"], ribbon: "#dfe7f2", pattern: "dots",
    motif: svg(`<g fill="#e8eef8"><rect x="30" y="16" width="4" height="22" rx="1"/>
      ${[8, 13, 18, 23, 41, 46, 51, 56].map((x) => `<rect x="${x - 1.5}" y="22" width="3" height="16" rx="1"/>`).join("")}
      <path d="M8 38h48c0 8-10 10-24 10S8 46 8 38z"/><rect x="29" y="47" width="6" height="7"/><rect x="20" y="54" width="24" height="4" rx="2"/></g>
      <g fill="#ffd84f">${[8, 13, 18, 23, 32, 41, 46, 51, 56].map((x) => `<path d="M${x} ${x === 32 ? 9 : 15}c2.5 2.5 1.5 5 0 5.5-1.5-.5-2.5-3 0-5.5z"/>`).join("")}</g>`),
  },
  {
    id: "pesach", name: "Pesach", group: "Jewish holidays", greeting: "Chag Pesach Sameach",
    bg: "linear-gradient(150deg, #b8432f 0%, #7a1f2b 60%, #4a1019 100%)", ink: "#fff6ea", accent: "#f3d9a4",
    box: ["#a8322f", "#6a1622"], ribbon: "#f3d9a4", pattern: "matzah",
    motif: svg(`<path d="M18 10h28l-3 18a11 11 0 0 1-22 0z" fill="#f3d9a4"/><path d="M20 14h24l-1.6 10a10 10 0 0 1-20.8 0z" fill="#8e1d2c"/>
      <rect x="30" y="38" width="4" height="12" fill="#f3d9a4"/><path d="M20 54c2-4 22-4 24 0z" fill="#f3d9a4"/>
      <circle cx="26" cy="19" r="1.5" fill="#fff" opacity=".5"/>`),
  },
  {
    id: "rosh", name: "Rosh Hashanah", group: "Jewish holidays", greeting: "Shana Tova",
    bg: "linear-gradient(150deg, #f5b829 0%, #d98c0b 55%, #9a5a06 100%)", ink: "#ffffff", accent: "#fff3c4",
    box: ["#d98c0b", "#8f5306"], ribbon: "#c0392b", pattern: "honey",
    motif: svg(`<path d="M32 20c-6-5-20-3-20 12 0 12 9 22 15 22 2.5 0 3.5-1.5 5-1.5S34.5 54 37 54c6 0 15-10 15-22 0-15-14-17-20-12z" fill="#e53935"/>
      <path d="M32 20c0-5 2-9 6-11" fill="none" stroke="#5d3a1a" stroke-width="3" stroke-linecap="round"/><path d="M34 14c5-4 11-3 12 1-5 3-10 2-12-1z" fill="#5cb85c"/>
      <path d="M22 30a7 7 0 0 1 5-6" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".5"/>`),
  },
  {
    id: "purim", name: "Purim", group: "Jewish holidays", greeting: "Purim Sameach",
    bg: "linear-gradient(135deg, #7c3aed 0%, #c026d3 50%, #f97316 100%)", ink: "#ffffff", accent: "#fde68a",
    box: ["#7c3aed", "#4c1d95"], ribbon: "#fde68a", pattern: "confetti",
    motif: svg(`<path d="M8 26c8-6 16-6 24 0 8-6 16-6 24 0-1 12-8 18-15 18-4 0-7-3-9-6-2 3-5 6-9 6-7 0-14-6-15-18z" fill="#fde68a"/>
      <ellipse cx="21" cy="31" rx="5" ry="3.5" fill="#4c1d95"/><ellipse cx="43" cy="31" rx="5" ry="3.5" fill="#4c1d95"/>
      <path d="M8 26c-2-6 0-12 4-14M56 26c2-6 0-12-4-14" fill="none" stroke="#f472b6" stroke-width="3" stroke-linecap="round"/>`),
  },
];

export const DESIGN = Object.fromEntries(DESIGNS.map((d) => [d.id, d]));
