// Gift card designs and amounts (used by the website pages and the server, so they always agree).
// Each design is abstract: soft overlapping shapes in rich gradients (drawn as an SVG that fills the card),
// with the occasion hinted at by the shapes rather than a picture. Plus colors for its gift box.

export const AMOUNTS = [500, 1000, 2500, 5000]; // cents of Galaxy Credits

// The artwork fills a 320 x 202 card. Blurred shapes give the soft, glowing look.
const art = (id, inner) => `<svg viewBox="0 0 320 202" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs><filter id="b1-${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="b2-${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>${inner}</svg>`;

export const DESIGNS = [
  {
    id: "galaxy", name: "Galaxy", group: "Everyday", greeting: "A gift for you",
    bg: "linear-gradient(140deg, #0e0b2e 0%, #1c1259 45%, #05060f 100%)", ink: "#ffffff", accent: "#7ff3ff",
    box: ["#4a2fb8", "#1d1259"], ribbon: "#7ff3ff",
    art: art("galaxy", `<circle cx="250" cy="40" r="90" fill="#7a4dff" filter="url(#b1-galaxy)" opacity=".85"/>
      <circle cx="70" cy="190" r="80" fill="#1fb6ff" filter="url(#b1-galaxy)" opacity=".6"/>
      <circle cx="250" cy="40" r="46" fill="none" stroke="#b9a2ff" stroke-width="1.2" opacity=".55"/>
      <circle cx="250" cy="40" r="70" fill="none" stroke="#7ff3ff" stroke-width="1" opacity=".35"/>
      <circle cx="250" cy="40" r="96" fill="none" stroke="#ffffff" stroke-width=".8" opacity=".2"/>
      <circle cx="250" cy="40" r="22" fill="#d9ccff" filter="url(#b2-galaxy)" opacity=".9"/>`),
  },
  {
    id: "birthday", name: "Birthday", group: "Everyday", greeting: "Happy Birthday",
    bg: "linear-gradient(135deg, #ff4f8b 0%, #ff7a59 55%, #ffb648 100%)", ink: "#ffffff", accent: "#fff6c9",
    box: ["#ff4f8b", "#c52a66"], ribbon: "#ffd84f",
    art: art("birthday", `<circle cx="270" cy="20" r="80" fill="#ffd84f" filter="url(#b1-birthday)" opacity=".7"/>
      <circle cx="40" cy="30" r="70" fill="#ff2e7e" filter="url(#b1-birthday)" opacity=".55"/>
      <circle cx="232" cy="66" r="30" fill="#ffffff" opacity=".18"/><circle cx="276" cy="104" r="20" fill="#ffffff" opacity=".22"/>
      <circle cx="198" cy="34" r="13" fill="#ffffff" opacity=".28"/><circle cx="300" cy="52" r="9" fill="#fff6c9" opacity=".5"/>
      <circle cx="250" cy="140" r="7" fill="#ffffff" opacity=".35"/>`),
  },
  {
    id: "thanks", name: "Thank you", group: "Everyday", greeting: "Thank you",
    bg: "linear-gradient(140deg, #ffb347 0%, #ff7240 50%, #d93a5a 100%)", ink: "#ffffff", accent: "#fff2cf",
    box: ["#ff7a3d", "#c24624"], ribbon: "#fff2cf",
    art: art("thanks", `<circle cx="215" cy="70" r="74" fill="#ffd27a" opacity=".45" filter="url(#b2-thanks)"/>
      <circle cx="265" cy="70" r="74" fill="#ff5a7a" opacity=".42" filter="url(#b2-thanks)"/>
      <circle cx="240" cy="110" r="90" fill="#ff8a3d" filter="url(#b1-thanks)" opacity=".5"/>
      <path d="M0 170 C80 140 160 200 320 150 L320 202 L0 202Z" fill="#7a1f3d" opacity=".25"/>`),
  },
  {
    id: "holiday", name: "Winter holidays", group: "Holidays", greeting: "Happy Holidays",
    bg: "linear-gradient(160deg, #0f6b48 0%, #0a3d2b 55%, #04201a 100%)", ink: "#ffffff", accent: "#ff8a8a",
    box: ["#c0392b", "#7d1f17"], ribbon: "#f4f4f4",
    art: art("holiday", `<circle cx="260" cy="50" r="90" fill="#2fbf7a" filter="url(#b1-holiday)" opacity=".5"/>
      <circle cx="235" cy="70" r="34" fill="#e8454a" opacity=".85"/><circle cx="226" cy="60" r="10" fill="#ffffff" opacity=".35" filter="url(#b2-holiday)"/>
      <circle cx="285" cy="112" r="20" fill="#f4f4f4" opacity=".85"/><circle cx="279" cy="106" r="6" fill="#ffffff" opacity=".6"/>
      <circle cx="292" cy="40" r="12" fill="#ffd84f" opacity=".85"/>
      ${[[30, 30], [120, 18], [180, 60], [60, 90], [150, 120], [300, 170], [110, 170]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" fill="#fff" opacity=".7"/>`).join("")}`),
  },
  {
    id: "chanukah", name: "Chanukah", group: "Jewish holidays", greeting: "Happy Chanukah",
    bg: "linear-gradient(150deg, #1d4fd8 0%, #10297a 55%, #070f33 100%)", ink: "#ffffff", accent: "#ffe08a",
    box: ["#1d4fd8", "#0f2a74"], ribbon: "#dfe7f2",
    art: art("chanukah", `<circle cx="240" cy="60" r="100" fill="#ffd25e" filter="url(#b1-chanukah)" opacity=".28"/>
      ${[176, 192, 208, 224, 240, 256, 272, 288, 304].map((x, i) => {
        const tall = i === 4 ? 92 : 64 + Math.abs(4 - i) * 0;
        const y = i === 4 ? 10 : 30;
        return `<rect x="${x - 5}" y="${y}" width="10" height="${tall}" rx="5" fill="url(#g-chanukah)" opacity=".95"/>`;
      }).join("")}
      <defs><linearGradient id="g-chanukah" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset=".45" stop-color="#ffffff" stop-opacity=".9"/><stop offset="1" stop-color="#9fb8ff" stop-opacity=".25"/></linearGradient></defs>
      <path d="M150 128 Q240 150 320 128" fill="none" stroke="#cfe0ff" stroke-width="2" opacity=".45"/>`),
  },
  {
    id: "pesach", name: "Pesach", group: "Jewish holidays", greeting: "Chag Pesach Sameach",
    bg: "linear-gradient(150deg, #b8432f 0%, #7a1f2b 60%, #3f0c15 100%)", ink: "#fff6ea", accent: "#f6dcaa",
    box: ["#a8322f", "#6a1622"], ribbon: "#f3d9a4",
    art: art("pesach", `<circle cx="190" cy="60" r="90" fill="#ffcf8a" filter="url(#b1-pesach)" opacity=".35"/>
      <path d="M150 0 C190 60 190 140 150 202 L0 202 L0 0Z" fill="#e0566a" opacity=".45"/>
      <path d="M150 0 C190 60 190 140 150 202 L126 202 C166 140 166 60 126 0Z" fill="#ff9aa8" opacity=".35"/>
      <path d="M320 0 L262 0 C222 60 222 140 262 202 L320 202Z" fill="#e0566a" opacity=".45"/>
      <path d="M262 0 C222 60 222 140 262 202 L286 202 C246 140 246 60 286 0Z" fill="#ff9aa8" opacity=".35"/>
      <path d="M206 0 L206 202" stroke="#f6dcaa" stroke-width="18" opacity=".22" filter="url(#b2-pesach)"/>`),
  },
  {
    id: "rosh", name: "Rosh Hashanah", group: "Jewish holidays", greeting: "Shana Tova",
    bg: "linear-gradient(150deg, #f7c242 0%, #db8f10 55%, #8f5306 100%)", ink: "#ffffff", accent: "#fff3c4",
    box: ["#d98c0b", "#8f5306"], ribbon: "#c0392b",
    art: art("rosh", `<circle cx="240" cy="78" r="96" fill="#fff0b3" filter="url(#b1-rosh)" opacity=".35"/>
      <circle cx="244" cy="82" r="52" fill="#e0262f" opacity=".92"/>
      <circle cx="226" cy="64" r="16" fill="#ffffff" opacity=".28" filter="url(#b2-rosh)"/>
      <circle cx="244" cy="82" r="70" fill="none" stroke="#fff3c4" stroke-width="1.2" opacity=".45"/>
      <circle cx="244" cy="82" r="88" fill="none" stroke="#fff3c4" stroke-width=".8" opacity=".25"/>
      <path d="M0 180 C70 160 120 200 200 178 S300 170 320 182 L320 202 L0 202Z" fill="#7a3d05" opacity=".25"/>`),
  },
  {
    id: "purim", name: "Purim", group: "Jewish holidays", greeting: "Purim Sameach",
    bg: "linear-gradient(135deg, #6d28d9 0%, #c026d3 50%, #f97316 100%)", ink: "#ffffff", accent: "#fde68a",
    box: ["#7c3aed", "#4c1d95"], ribbon: "#fde68a",
    art: art("purim", `<path d="M-10 120 C60 60 120 170 200 110 S300 40 330 80 L330 140 C300 100 240 170 200 160 S70 130 -10 180Z" fill="#fde68a" opacity=".3"/>
      ${[[220, 30, 0], [270, 60, 30], [300, 20, 60], [180, 70, 15], [250, 110, 45], [140, 30, 70], [300, 140, 20]].map(([x, y, r], i) =>
        `<rect x="${x}" y="${y}" width="${i % 2 ? 12 : 16}" height="${i % 2 ? 12 : 16}" rx="3" transform="rotate(${r} ${x} ${y})" fill="${["#fde68a", "#ffffff", "#22d3ee", "#f472b6"][i % 4]}" opacity=".75"/>`).join("")}
      <circle cx="60" cy="40" r="60" fill="#f472b6" filter="url(#b1-purim)" opacity=".45"/>`),
  },
];

export const DESIGN = Object.fromEntries(DESIGNS.map((d) => [d.id, d]));
