// Gift card parts. A card is built from four parts the buyer picks: background, artwork, foil (color + pattern)
// and greeting. Templates fill in all four at once as a quick start. Used by the website pages and the server.

export const AMOUNTS = [500, 1000, 2500, 5000]; // cents of Galaxy Credits
export const GREETING_MAX = 22;   // characters in a custom greeting (so it always fits on the card)
export const MESSAGE_MAX = 160;   // characters in the personal message

// ---------- backgrounds ----------
export const BACKGROUNDS = [
  { id: "midnight", name: "Midnight", bg: "linear-gradient(140deg, #0e0b2e 0%, #1c1259 45%, #05060f 100%)", g1: "#7a4dff", g2: "#1fb6ff", ink: "#ffffff", accent: "#7ff3ff", box: ["#4a2fb8", "#1d1259"] },
  { id: "graphite", name: "Graphite", bg: "linear-gradient(140deg, #2b2d33 0%, #16171b 60%, #0b0b0d 100%)", g1: "#6b7280", g2: "#9ca3af", ink: "#ffffff", accent: "#e5e7eb", box: ["#3a3c42", "#16171b"] },
  { id: "ocean", name: "Ocean", bg: "linear-gradient(150deg, #0ea5c6 0%, #0b5c9e 55%, #062a52 100%)", g1: "#38e0ff", g2: "#3b5bff", ink: "#ffffff", accent: "#bff6ff", box: ["#0b6fae", "#073a6b"] },
  { id: "royal", name: "Royal", bg: "linear-gradient(150deg, #1d4fd8 0%, #10297a 55%, #070f33 100%)", g1: "#5b8cff", g2: "#ffd25e", ink: "#ffffff", accent: "#ffe08a", box: ["#1d4fd8", "#0f2a74"] },
  { id: "violet", name: "Violet", bg: "linear-gradient(135deg, #6d28d9 0%, #a21caf 55%, #4c1d95 100%)", g1: "#f472b6", g2: "#8b5cf6", ink: "#ffffff", accent: "#fde68a", box: ["#7c3aed", "#4c1d95"] },
  { id: "rose", name: "Rose", bg: "linear-gradient(135deg, #ff4f8b 0%, #ff7a8a 55%, #ffb3a7 100%)", g1: "#ff2e7e", g2: "#ffd1dc", ink: "#ffffff", accent: "#fff6c9", box: ["#ff4f8b", "#c52a66"] },
  { id: "sunset", name: "Sunset", bg: "linear-gradient(135deg, #ff5f6d 0%, #ff8a3d 50%, #ffc94d 100%)", g1: "#ffd84f", g2: "#ff2e63", ink: "#ffffff", accent: "#fff3c4", box: ["#ff6a3d", "#c2401f"] },
  { id: "wine", name: "Wine", bg: "linear-gradient(150deg, #b8432f 0%, #7a1f2b 60%, #3f0c15 100%)", g1: "#ff8a9a", g2: "#ffcf8a", ink: "#fff6ea", accent: "#f6dcaa", box: ["#a8322f", "#6a1622"] },
  { id: "emerald", name: "Emerald", bg: "linear-gradient(160deg, #10a36a 0%, #0a5c3c 55%, #04261b 100%)", g1: "#5af0b0", g2: "#e8454a", ink: "#ffffff", accent: "#ffd84f", box: ["#0f7a4f", "#063a26"] },
  { id: "gold", name: "Honey", bg: "linear-gradient(150deg, #f7c242 0%, #db8f10 55%, #8f5306 100%)", g1: "#fff0b3", g2: "#e0262f", ink: "#ffffff", accent: "#fff3c4", box: ["#d98c0b", "#8f5306"] },
  { id: "pearl", name: "Pearl", bg: "linear-gradient(140deg, #fdfcfb 0%, #ece8f5 50%, #d9e4f5 100%)", g1: "#c4b5fd", g2: "#93c5fd", ink: "#1e1b4b", accent: "#6d28d9", box: ["#e9e4f5", "#b9b0d6"] },
];

// ---------- artwork (abstract shapes, drawn in the background's glow colors) ----------
const dots = (pts, fill, op = 0.7) => pts.map(([x, y, r = 2.2]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" opacity="${op}"/>`).join("");
export const ARTWORK = [
  { id: "none", name: "None", draw: () => "" },
  { id: "glow", name: "Glow", draw: (c) => `<circle cx="250" cy="40" r="95" fill="${c.g1}" filter="url(#B)" opacity=".75"/><circle cx="60" cy="190" r="85" fill="${c.g2}" filter="url(#B)" opacity=".55"/>` },
  { id: "orbit", name: "Orbit", draw: (c) => `<circle cx="250" cy="40" r="90" fill="${c.g1}" filter="url(#B)" opacity=".7"/>
      ${[46, 70, 96].map((r, i) => `<circle cx="250" cy="40" r="${r}" fill="none" stroke="#fff" stroke-width="${1.2 - i * .2}" opacity="${.5 - i * .14}"/>`).join("")}
      <circle cx="250" cy="40" r="22" fill="#fff" filter="url(#S)" opacity=".75"/>` },
  { id: "bubbles", name: "Bubbles", draw: (c) => `<circle cx="270" cy="20" r="80" fill="${c.g1}" filter="url(#B)" opacity=".55"/>
      ${[[232, 66, 30, .18], [276, 104, 20, .22], [198, 34, 13, .28], [300, 52, 9, .45], [250, 140, 7, .35], [170, 90, 6, .3]].map(([x, y, r, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`).join("")}` },
  { id: "waves", name: "Waves", draw: (c) => `<path d="M-10 120 C60 60 120 170 200 110 S300 40 330 80 L330 140 C300 100 240 170 200 160 S70 130 -10 180Z" fill="#fff" opacity=".18"/>
      <path d="M-10 150 C80 110 150 190 240 140 S320 120 330 130 L330 202 L-10 202Z" fill="${c.g2}" opacity=".35"/>
      <circle cx="60" cy="40" r="60" fill="${c.g1}" filter="url(#B)" opacity=".45"/>` },
  { id: "rays", name: "Rays", draw: (c) => `<circle cx="260" cy="30" r="70" fill="${c.g1}" filter="url(#B)" opacity=".6"/>
      ${Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI; const x = 260 + Math.cos(a + Math.PI / 2) * 260, y = 30 + Math.sin(a + Math.PI / 2) * 260; return `<path d="M260 30 L${x.toFixed(0)} ${y.toFixed(0)}" stroke="#fff" stroke-width="${i % 2 ? 6 : 14}" opacity=".07"/>`; }).join("")}` },
  { id: "confetti", name: "Confetti", draw: (c) => `<circle cx="60" cy="40" r="60" fill="${c.g1}" filter="url(#B)" opacity=".45"/>
      ${[[220, 30, 0], [270, 60, 30], [300, 20, 60], [180, 70, 15], [250, 110, 45], [140, 30, 70], [300, 140, 20], [200, 130, 35]].map(([x, y, r], i) =>
        `<rect x="${x}" y="${y}" width="${i % 2 ? 11 : 15}" height="${i % 2 ? 11 : 6}" rx="2" transform="rotate(${r} ${x} ${y})" fill="${["#fff", c.accent, c.g2, c.g1][i % 4]}" opacity=".8"/>`).join("")}` },
  { id: "ornaments", name: "Ornaments", draw: (c) => `<circle cx="260" cy="50" r="90" fill="${c.g1}" filter="url(#B)" opacity=".45"/>
      <circle cx="235" cy="70" r="34" fill="${c.g2}" opacity=".85"/><circle cx="226" cy="60" r="10" fill="#fff" opacity=".35" filter="url(#S)"/>
      <circle cx="285" cy="112" r="20" fill="#f4f4f4" opacity=".85"/><circle cx="292" cy="40" r="12" fill="${c.accent}" opacity=".85"/>
      ${dots([[30, 30], [120, 18], [180, 60], [60, 90], [150, 120], [300, 170], [110, 170]], "#fff")}` },
  { id: "candles", name: "Candles", draw: (c) => `<circle cx="240" cy="60" r="100" fill="${c.g2}" filter="url(#B)" opacity=".28"/>
      <defs><linearGradient id="CG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.accent}"/><stop offset=".45" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity=".15"/></linearGradient></defs>
      ${[176, 192, 208, 224, 240, 256, 272, 288, 304].map((x, i) => `<rect x="${x - 5}" y="${i === 4 ? 10 : 30}" width="10" height="${i === 4 ? 92 : 64}" rx="5" fill="url(#CG)" opacity=".95"/>`).join("")}` },
  { id: "parting", name: "Parting sea", draw: (c) => `<circle cx="190" cy="60" r="90" fill="${c.accent}" filter="url(#B)" opacity=".3"/>
      <path d="M150 0 C190 60 190 140 150 202 L0 202 L0 0Z" fill="${c.g1}" opacity=".4"/>
      <path d="M150 0 C190 60 190 140 150 202 L126 202 C166 140 166 60 126 0Z" fill="#fff" opacity=".18"/>
      <path d="M320 0 L262 0 C222 60 222 140 262 202 L320 202Z" fill="${c.g1}" opacity=".4"/>
      <path d="M262 0 C222 60 222 140 262 202 L286 202 C246 140 246 60 286 0Z" fill="#fff" opacity=".18"/>` },
  { id: "orb", name: "Orb", draw: (c) => `<circle cx="240" cy="78" r="96" fill="${c.g1}" filter="url(#B)" opacity=".35"/>
      <circle cx="244" cy="82" r="52" fill="${c.g2}" opacity=".92"/><circle cx="226" cy="64" r="16" fill="#fff" opacity=".28" filter="url(#S)"/>
      <circle cx="244" cy="82" r="70" fill="none" stroke="#fff" stroke-width="1.2" opacity=".4"/>` },
  { id: "hearts", name: "Warmth", draw: (c) => `<circle cx="215" cy="70" r="74" fill="${c.g1}" opacity=".45" filter="url(#S)"/>
      <circle cx="265" cy="70" r="74" fill="${c.g2}" opacity=".42" filter="url(#S)"/><circle cx="240" cy="110" r="90" fill="${c.g1}" filter="url(#B)" opacity=".4"/>` },
  { id: "stars", name: "Stars", draw: (c) => `<circle cx="80" cy="50" r="90" fill="${c.g1}" filter="url(#B)" opacity=".35"/>
      ${dots([[20, 20, 1.4], [70, 60, 1], [140, 24, 1.8], [200, 80, 1.2], [260, 30, 1.6], [300, 90, 1], [230, 150, 1.4], [120, 140, 1], [40, 120, 1.6], [290, 180, 1.2], [180, 180, 1]], "#fff", .85)}
      <path d="M250 40 l3 9 9 3 -9 3 -3 9 -3 -9 -9 -3 9 -3z" fill="#fff" opacity=".9"/>` },
];

// ---------- foil (metallic lines) ----------
export const FOILS = [
  { id: "none", name: "None" },
  { id: "gold", name: "Gold", stops: ["#7a5410", "#f7d77a", "#fff4c8", "#c99a2e", "#8a6114"], ribbon: "#f2c94c" },
  { id: "silver", name: "Silver", stops: ["#5d6470", "#e8ecf2", "#ffffff", "#aab2bf", "#6b7280"], ribbon: "#e5e7eb" },
  { id: "rose", name: "Rose gold", stops: ["#8a4b3e", "#f6c1b0", "#fff0ea", "#d48b78", "#8f4f42"], ribbon: "#f4b8a6" },
  { id: "holo", name: "Holographic", stops: ["#7ff3ff", "#c4b5fd", "#ffb3e6", "#fff3a3", "#8fffc4"], ribbon: "#c4b5fd" },
];
export const PATTERNS = [
  { id: "frame", name: "Frame", draw: () => `<rect x="9" y="9" width="302" height="184" rx="12" fill="none" stroke="url(#F)" stroke-width="1.6"/><rect x="14" y="14" width="292" height="174" rx="9" fill="none" stroke="url(#F)" stroke-width=".7" opacity=".8"/>` },
  { id: "pinstripe", name: "Pinstripes", draw: () => Array.from({ length: 16 }, (_, i) => `<path d="M${160 + i * 14} -10 L${100 + i * 14} 212" stroke="url(#F)" stroke-width="${i % 4 ? .7 : 1.6}" opacity=".85"/>`).join("") },
  { id: "flow", name: "Flow", draw: () => Array.from({ length: 6 }, (_, i) => `<path d="M-10 ${120 + i * 9} C80 ${70 + i * 9} 150 ${190 + i * 7} 330 ${90 + i * 10}" fill="none" stroke="url(#F)" stroke-width="${i === 2 ? 1.8 : .8}"/>`).join("") },
  { id: "arcs", name: "Arcs", draw: () => [40, 64, 88, 112, 136].map((r, i) => `<circle cx="320" cy="0" r="${r}" fill="none" stroke="url(#F)" stroke-width="${i === 1 ? 1.8 : .8}"/>`).join("") },
  { id: "deco", name: "Art deco", draw: () => `${Array.from({ length: 9 }, (_, i) => { const a = Math.PI + (i / 8) * Math.PI; return `<path d="M160 214 L${(160 + Math.cos(a) * 240).toFixed(0)} ${(214 + Math.sin(a) * 240).toFixed(0)}" stroke="url(#F)" stroke-width=".8"/>`; }).join("")}
      ${[60, 90].map((r) => `<path d="M${160 - r} 214 A${r} ${r} 0 0 1 ${160 + r} 214" fill="none" stroke="url(#F)" stroke-width="1.4"/>`).join("")}` },
  { id: "constellation", name: "Constellation", draw: () => { const p = [[200, 30], [236, 52], [262, 34], [290, 70], [252, 96], [214, 84]]; return `<path d="M${p.map((q) => q.join(" ")).join(" L")}" fill="none" stroke="url(#F)" stroke-width=".9"/>${p.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="url(#F)"/>`).join("")}`; } },
];

// ---------- greetings ----------
export const GREETINGS = ["A gift for you", "Happy Birthday", "Thank you", "Congratulations", "Mazel Tov", "Happy Holidays",
  "Happy Chanukah", "Chag Pesach Sameach", "Shana Tova", "Purim Sameach", "Chag Sameach", "Just because"];

// ---------- quick starts (fill in every part) ----------
export const TEMPLATES = [
  { id: "galaxy", name: "Galaxy", group: "Everyday", style: { bg: "midnight", art: "orbit", foil: "silver", pattern: "constellation", greeting: "A gift for you" } },
  { id: "birthday", name: "Birthday", group: "Everyday", style: { bg: "rose", art: "bubbles", foil: "gold", pattern: "frame", greeting: "Happy Birthday" } },
  { id: "thanks", name: "Thank you", group: "Everyday", style: { bg: "sunset", art: "hearts", foil: "rose", pattern: "flow", greeting: "Thank you" } },
  { id: "luxe", name: "Luxe", group: "Everyday", style: { bg: "graphite", art: "glow", foil: "gold", pattern: "deco", greeting: "A gift for you" } },
  { id: "holiday", name: "Winter holidays", group: "Holidays", style: { bg: "emerald", art: "ornaments", foil: "gold", pattern: "frame", greeting: "Happy Holidays" } },
  { id: "chanukah", name: "Chanukah", group: "Jewish holidays", style: { bg: "royal", art: "candles", foil: "silver", pattern: "arcs", greeting: "Happy Chanukah" } },
  { id: "pesach", name: "Pesach", group: "Jewish holidays", style: { bg: "wine", art: "parting", foil: "gold", pattern: "frame", greeting: "Chag Pesach Sameach" } },
  { id: "rosh", name: "Rosh Hashanah", group: "Jewish holidays", style: { bg: "gold", art: "orb", foil: "rose", pattern: "arcs", greeting: "Shana Tova" } },
  { id: "purim", name: "Purim", group: "Jewish holidays", style: { bg: "violet", art: "confetti", foil: "holo", pattern: "flow", greeting: "Purim Sameach" } },
];
export const TEMPLATE = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
// (kept for older code: the old design names are the templates)
export const DESIGNS = TEMPLATES;
export const DESIGN = TEMPLATE;

const find = (list, id, fallback) => list.find((x) => x.id === id) || list.find((x) => x.id === fallback);

// A full, valid style from anything (a template id, an old design id, or a partial style)
export function styleOf(v) {
  const base = TEMPLATE[typeof v === "string" ? v : v?.template] || TEMPLATES[0];
  const s = typeof v === "object" && v ? v : {};
  return {
    bg: find(BACKGROUNDS, s.bg, base.style.bg).id,
    art: find(ARTWORK, s.art, base.style.art).id,
    foil: find(FOILS, s.foil, base.style.foil).id,
    pattern: find(PATTERNS, s.pattern, base.style.pattern).id,
    greeting: String(s.greeting ?? base.style.greeting).replace(/\s+/g, " ").trim().slice(0, GREETING_MAX) || base.style.greeting,
  };
}

let uid = 0;
// Everything needed to draw a style: colors and the artwork + foil SVG (320 x 202)
export function renderParts(style) {
  const st = styleOf(style);
  const b = find(BACKGROUNDS, st.bg);
  const f = find(FOILS, st.foil);
  const foilDefs = f.stops ? `<linearGradient id="F" x1="0" y1="0" x2="1" y2="1">${f.stops.map((c, i) => `<stop offset="${i / (f.stops.length - 1)}" stop-color="${c}"/>`).join("")}</linearGradient>` : "";
  const svg = `<svg viewBox="0 0 320 202" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>
    <filter id="B" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="S" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>${foilDefs}</defs>
    ${find(ARTWORK, st.art).draw(b)}${f.stops ? find(PATTERNS, st.pattern).draw() : ""}</svg>`;
  // every drawing gets its own ids, so several cards on one page don't borrow each other's colors
  const u = `c${++uid}`;
  const own = svg.replace(/id="(B|S|F|CG)"/g, `id="$1-${u}"`).replace(/url\(#(B|S|F|CG)\)/g, `url(#$1-${u})`);
  return { style: st, bg: b, foil: f, svg: own, ribbon: f.ribbon || b.accent };
}
