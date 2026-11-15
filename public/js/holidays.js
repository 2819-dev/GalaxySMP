// Jewish holiday decorations: a small gold emblem next to the logo on every page, and a greeting on the home page.
// Dates come from the Hebrew calendar built into the browser, so they're right every year without updates.
// The owner can turn this off in Control Panel > Server control. Preview any holiday with ?holiday=chanukah&night=5.

const GOLD = `<defs>
  <linearGradient id="hg-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8e3a3"/><stop offset=".5" stop-color="#e0b65a"/><stop offset="1" stop-color="#b8862f"/></linearGradient>
  <radialGradient id="hg-flame" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#fff6d6"/><stop offset=".55" stop-color="#ffc24a"/><stop offset="1" stop-color="#f08a24"/></radialGradient>
</defs>`;
const svg = (body, vb = "0 0 48 40") => `<svg viewBox="${vb}" fill="none" stroke="url(#hg-gold)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GOLD}${body}</svg>`;
const flame = (x, y, s = 1) => `<path class="hg-flame" d="M${x} ${y - 5.2 * s}c${1.9 * s} ${2.3 * s} ${2.3 * s} ${4 * s} 0 ${5.2 * s}c${-2.3 * s} ${-1.2 * s} ${-1.9 * s} ${-2.9 * s} 0 ${-5.2 * s}z" fill="url(#hg-flame)" stroke="none"/>`;

// A modern chanukiah: eight candles in a row and the shamash raised in the middle. Candles are added from the
// right each night; `night` of them are lit (plus the shamash).
function menorah(night) {
  const xs = [5, 10, 15, 20, 28, 33, 38, 43];
  let out = '<path d="M4 25h40"/><path d="M24 25v9M17 36h14"/><path d="M24 25V17"/>';
  out += `<rect x="22.6" y="9.5" width="2.8" height="7.5" rx=".7" fill="url(#hg-gold)" stroke="none"/>${flame(24, 8.2, 1.05)}`;
  xs.forEach((x, i) => {
    const lit = i >= 8 - night;
    out += `<path d="M${x} 25v-2.2"/><rect x="${x - 1.15}" y="15.3" width="2.3" height="7" rx=".6" fill="url(#hg-gold)" stroke="none" opacity="${lit ? 1 : 0.55}"/>`;
    if (lit) out += flame(x, 14, 0.85);
  });
  return svg(out);
}

const ART = {
  // a pomegranate with its crown, and a drop of honey
  rosh: () => svg(`<path d="M24 13.5c-7.6 0-12.5 5.4-12.5 11.6 0 6.5 5.3 11.4 12.5 11.4s12.5-4.9 12.5-11.4c0-6.2-4.9-11.6-12.5-11.6z"/>
    <path d="M19.2 14.3 18.4 9l3 2.4L24 7.6l2.6 3.8 3-2.4-.8 5.3"/><path d="M18 24.5c.6-2.6 2.7-4.6 5.4-5" opacity=".7"/>
    <path d="M40.5 23.5c1.6 2 2.2 3.3 2.2 4.4a2.2 2.2 0 0 1-4.4 0c0-1.1.6-2.4 2.2-4.4z" fill="url(#hg-gold)" stroke="none"/>`),
  // the lulav (palm branch with myrtle and willow) and the etrog
  sukkot: () => svg(`<path d="M29 37V4"/><path d="M29 9l-3.2-3.2M29 9l3.2-3.2M29 15l-4-3.6M29 15l4-3.6M29 21l-4.4-3.8M29 21l4.4-3.8"/>
    <path d="M29 27c-3-1-4.7-3.4-5.3-6.2M29 27c3-1 4.7-3.4 5.3-6.2" opacity=".75"/>
    <path d="M10.5 28.5c0-4.2 3.7-7.3 8-7.3 3.6 0 6 2.4 6 5.6 0 4.4-4 7.7-8.4 7.7-3.4 0-5.6-2.5-5.6-6z"/><path d="M24.2 24.4l1.8-1.6"/>`),
  // eight candles and the shamash
  chanukah: (night) => menorah(night),
  // an almond tree in blossom
  tubishvat: () => svg(`<path d="M24 37V22M24 28l-5-4.5M24 25.5l4.5-4"/>
    <path d="M14.5 21.5a6 6 0 0 1 2.2-11.4 7.6 7.6 0 0 1 14.6 0 6 6 0 0 1 2.2 11.4c-2.3 1.4-5.2 1.6-7.7.6-1.1.5-2.4.5-3.6 0-2.5 1-5.4.8-7.7-.6z"/>
    <circle cx="19" cy="15.5" r="1.3" fill="url(#hg-gold)" stroke="none"/><circle cx="27.5" cy="12.5" r="1.3" fill="url(#hg-gold)" stroke="none"/><circle cx="30" cy="18.5" r="1.3" fill="url(#hg-gold)" stroke="none"/><circle cx="23.5" cy="19" r="1" fill="url(#hg-gold)" stroke="none"/>
    <path d="M17 37h14"/>`),
  // a masquerade mask on a stick
  purim: () => svg(`<path d="M7 17.5c4-2.8 11-2.6 17 .6 6-3.2 13-3.4 17-.6 0 6.8-3.6 11.5-9 11.5-3.6 0-6.3-2.2-8-4.6-1.7 2.4-4.4 4.6-8 4.6-5.4 0-9-4.7-9-11.5z"/>
    <path d="M12 20.5c1.4-1.3 4-1.5 6 .2-1.4 2-4.6 2.2-6-.2zM36 20.5c-1.4-1.3-4-1.5-6 .2 1.4 2 4.6 2.2 6-.2z" fill="url(#hg-gold)" stroke="none"/>
    <path d="M41 23.5l3.5 13" /><path d="M20 12.5c1.2-2.4 2.6-3.6 4-3.6s2.8 1.2 4 3.6" opacity=".7"/>`),
  // a kiddush cup and matzah
  pesach: () => svg(`<path d="M5.5 15.5l17-3 3 18.5-17 3z"/><path d="M10 18.5l9.6-1.7M10.8 23.2l9.6-1.7M11.6 27.9l9.6-1.7" stroke-dasharray=".1 2.6" stroke-width="1.9"/>
    <path d="M30 9h12c0 6.2-2.4 10.6-6 11.6V31M31.5 34h9"/><path d="M31 13.5h10" opacity=".6"/>`),
  // a bonfire
  lagbaomer: () => svg(`<path d="M11 35l26-7.5M37 35l-26-7.5"/>
    <path class="hg-fire" d="M24 30c-5.2 0-8-3.4-8-7.2 0-4.8 4.4-7 4.8-12.3 3 2 4.4 4.4 4.6 7 1.2-1.2 1.8-2.8 1.8-4.8 3.4 2.6 4.8 6.2 4.8 10.1 0 4-2.8 7.2-8 7.2z" fill="url(#hg-flame)" stroke="none"/>`),
  // sheaves of wheat
  shavuot: () => svg(`<path d="M24 37V8M17.5 37c0-8 1.6-15 6.5-21M30.5 37c0-8-1.6-15-6.5-21"/><path d="M19.5 28.5h9"/>
    ${[9, 13.5, 18].map((y) => `<path d="M24 ${y}c-2.6-.6-4-2.2-4-4.4 2.6.2 4 1.8 4 4.4zM24 ${y}c2.6-.6 4-2.2 4-4.4-2.6.2-4 1.8-4 4.4z" fill="url(#hg-gold)" stroke="none"/>`).join("")}
    <path d="M24 5.5V3" />`),
};

const HOLIDAYS = {
  rosh: { name: "Rosh Hashanah", greet: "Shanah Tovah", he: "שנה טובה ומתוקה", text: "Wishing everyone on GalaxySMP a sweet and happy new year." },
  sukkot: { name: "Sukkot", greet: "Chag Sukkot Sameach", he: "חג סוכות שמח", text: "Wishing everyone a joyful Sukkot." },
  chanukah: { name: "Chanukah", greet: "Happy Chanukah", he: "חנוכה שמח", text: (n) => `Tonight we light the ${ordinal(n)} candle. Wishing everyone a bright Festival of Lights.` },
  tubishvat: { name: "Tu BiShvat", greet: "Happy Tu BiShvat", he: "ט״ו בשבט שמח", text: "Happy new year to the trees. A great day to plant something in your build." },
  purim: { name: "Purim", greet: "Purim Sameach", he: "פורים שמח", text: "Wishing everyone a fun and happy Purim." },
  pesach: { name: "Pesach", greet: "Chag Pesach Sameach", he: "חג כשר ושמח", text: "Wishing everyone a happy and kosher Pesach." },
  lagbaomer: { name: "Lag BaOmer", greet: "Happy Lag BaOmer", he: "ל״ג בעומר שמח", text: "Wishing everyone a happy Lag BaOmer." },
  shavuot: { name: "Shavuot", greet: "Chag Shavuot Sameach", he: "חג שבועות שמח", text: "Wishing everyone a happy Shavuot." },
};

const ordinal = (n) => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"][n] || `${n}th`;

const fmt = (() => { try { return new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long" }); } catch { return null; } })();
function hebrew(d) {
  const parts = fmt.formatToParts(d);
  return { day: Number(parts.find((p) => p.type === "day")?.value), month: parts.find((p) => p.type === "month")?.value || "" };
}
const is = (h, month, from, to = from) => h.month === month && h.day >= from && h.day <= to;

// Which holiday it is today (the day before counts too: Jewish holidays start the evening before).
export function todaysHoliday(now = new Date()) {
  const q = new URLSearchParams(location.search);
  if (q.get("holiday") && HOLIDAYS[q.get("holiday")]) return { id: q.get("holiday"), night: Math.max(1, Math.min(8, Number(q.get("night")) || 3)) };
  if (!fmt) return null;
  const h = hebrew(now);
  if (!h.month) return null;
  if (is(h, "Elul", 29) || is(h, "Tishri", 1, 2)) return { id: "rosh" };
  if (is(h, "Tishri", 14, 23)) return { id: "sukkot" };
  for (let k = 0; k < 8; k++) {  // the first candle is lit on the evening of Kislev 24
    const back = hebrew(new Date(now.getTime() - k * 864e5));
    if (back.month === "Kislev" && back.day === 24) return { id: "chanukah", night: k + 1 };
  }
  if (is(h, "Shevat", 14, 15)) return { id: "tubishvat" };
  if (is(h, "Adar", 13, 15) || is(h, "Adar II", 13, 15)) return { id: "purim" };
  if (is(h, "Nisan", 14, 22)) return { id: "pesach" };
  if (is(h, "Iyar", 17, 18)) return { id: "lagbaomer" };
  if (is(h, "Sivan", 5, 7)) return { id: "shavuot" };
  return null;
}

let uid = 0;  // every copy gets its own gradient ids, so a hidden copy never blanks a visible one
export function emblemSvg(id, night) { const n = ++uid; return (ART[id]?.(night) || "").replace(/hg-(gold|flame)/g, `hg-$1-${n}`); }

let done = false;
export function decorate() {
  if (done) return;
  const t = todaysHoliday();
  if (!t) return;
  done = true;
  const hol = HOLIDAYS[t.id];
  const label = t.id === "chanukah" ? `${hol.greet}: night ${t.night}` : hol.greet;
  document.documentElement.dataset.holiday = t.id;
  for (const brand of document.querySelectorAll(".site-header .brand, .drawer .brand, .site-drawer .brand")) {
    if (brand.querySelector(".holiday-emblem")) continue;
    const e = document.createElement("span");
    e.className = "holiday-emblem";
    e.title = label;
    e.innerHTML = emblemSvg(t.id, t.night);
    brand.append(e);
  }
  // the greeting on the home page
  const hero = document.querySelector(".hero-wordmark");
  let dismissed = false;
  try { dismissed = localStorage.getItem("gx_holiday_hide") === `${t.id}-${new Date().getFullYear()}`; } catch { /* ignore */ }
  if (!hero || dismissed || document.querySelector(".holiday-greeting")) return;
  const card = document.createElement("div");
  card.className = "holiday-greeting";
  card.setAttribute("role", "note");
  const art = document.createElement("span");
  art.className = "hg-art";
  art.innerHTML = emblemSvg(t.id, t.night);
  const words = document.createElement("div");
  words.className = "hg-words";
  const top = document.createElement("div");
  top.className = "hg-top";
  const b = document.createElement("b");
  b.textContent = hol.greet;
  const he = document.createElement("span");
  he.className = "hg-he";
  he.lang = "he";
  he.dir = "rtl";
  he.textContent = hol.he;
  top.append(b, he);
  const p = document.createElement("p");
  p.textContent = typeof hol.text === "function" ? hol.text(t.night) : hol.text;
  words.append(top, p);
  const x = document.createElement("button");
  x.type = "button";
  x.className = "hg-close";
  x.setAttribute("aria-label", "Hide greeting");
  x.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  x.addEventListener("click", () => {
    card.remove();
    try { localStorage.setItem("gx_holiday_hide", `${t.id}-${new Date().getFullYear()}`); } catch { /* ignore */ }
  });
  card.append(art, words, x);
  hero.after(card);
}
