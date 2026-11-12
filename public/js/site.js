// Shared code for every page: header, footer, icons, copy buttons and live status.
import config from "/config.js";


const ICONS = {
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 8 2a6 6 0 0 0 3.6-1.2.6.6 0 0 1 .9.5V15a1 1 0 0 1-.4.8A6 6 0 0 1 16 17c-3 0-5-2-8-2a6 6 0 0 0-4 1.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  // premium line icons (used instead of emojis)
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  thumbsUp: '<path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M7 10l4-8a2.5 2.5 0 0 1 3 2.6L13.5 9H19a2 2 0 0 1 2 2.3l-1.3 8A2 2 0 0 1 17.7 21H7"/>',
  thumbsDown: '<path d="M7 14V3H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1z"/><path d="M7 14l4 8a2.5 2.5 0 0 0 3-2.6l-.5-4.4H19a2 2 0 0 0 2-2.3l-1.3-8A2 2 0 0 0 17.7 3H7"/>',
  lifebuoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  filter: '<path d="M4 5h16l-6 8v5l-4 2v-7z"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h9.6a1 1 0 0 0 1-.8L21 7H6.2"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/><path d="M5 19h14"/>',
  bank: '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/><path d="M6 6V5a2 2 0 0 1 2-2h9"/>',
  store: '<path d="M4 10v10h16V10"/><path d="M3 4h18l-1 6H4z"/><path d="M8 4l-1 6M16 4l1 6M12 4v6"/><path d="M10 20v-5h4v5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.2-9.4A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 9.2 4.6C19.5 15.4 12 20 12 20z"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-6.6 0-3.5-2.4-5.6-3.6-8.4-.5 2.2-1.6 3.4-2.9 4C12.8 7.8 11.3 4.6 8.6 2.5 8.8 6.5 5 9 5 15.4 5 19.3 8 22 12 22z"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  soul: '<path d="M12 22c3.6 0 6-2.5 6-5.8 0-3-2-4.8-3-7.2-.6 1.8-1.6 2.6-2.6 3.1.2-2.9-1-5.5-3.2-7.1.2 3.4-3.2 5.6-3.2 11.2 0 3.3 2.4 5.8 6 5.8z"/><path d="M12 22c-1.7 0-3-1.1-3-2.8 0-1.6 1.2-2.6 1.8-3.8.6 1.2 2.2 1.8 2.2 3.6 0 .6.5 1 .9 1.3"/>',
  flower: '<circle cx="12" cy="12" r="2.5"/><path d="M12 9.5C9 7 9.5 3 12 3s3 4 0 6.5zM14.5 12c2.5-3 6.5-2.5 6.5 0s-4 3-6.5 0zM12 14.5c3 2.5 2.5 6.5 0 6.5s-3-4 0-6.5zM9.5 12C7 15 3 14.5 3 12s4-3 6.5 0z"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-25 12 12)"/><circle cx="20" cy="7.5" r="1" fill="currentColor"/>',
  firework: '<path d="M12 12v10"/><path d="M12 2v3M12 12 7 7M12 12l5-5M4 12h3M17 12h3M6.3 17.7 8 16M17.7 17.7 16 16M6.3 6.3 8 8M17.7 6.3 16 8"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2.4-2.5 4"/><path d="M12 17h.01"/>',
  bug: '<rect x="8" y="7" width="8" height="13" rx="4"/><path d="M12 11v9M9 7l-1.5-2.5M15 7l1.5-2.5M4 11h4M16 11h4M4 17h4M16 17h4M4 6l2 2M20 6l-2 2"/>',
  scale: '<path d="M12 3v18M7 21h10M5 6h14"/><path d="M5 6l-3 7a3 3 0 0 0 6 0zM19 6l-3 7a3 3 0 0 0 6 0z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>',
  lock2: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  check2: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pickaxe: '<path d="M16 8 4 20"/><path d="M6.5 5C10.5 2.8 15.5 3 19 5c2 3.5 2.2 8.5 0 12.5"/><path d="M14 4.2 19.8 10"/>',
  gem: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M10 3 8 9l4 12 4-12-2-6"/>',
  bricks: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9.3h18M3 14.6h18M9 4v5.3M15 9.3v5.3M9 14.6V20"/>',
  castle: '<path d="M4 21V9h3V6h2v3h2V6h2v3h2V6h2v3h3v12z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>',
  sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6M16 16l4 4M19 21l2-2"/>',
  skull: '<path d="M12 3a8 8 0 0 0-8 8c0 2.6 1.3 4.5 3 5.6V20h10v-3.4c1.7-1.1 3-3 3-5.6a8 8 0 0 0-8-8z"/><circle cx="9" cy="11.5" r="1.6"/><circle cx="15" cy="11.5" r="1.6"/><path d="M10 20v-2M14 20v-2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  scroll: '<path d="M7 4h11a2 2 0 0 1 2 2v1h-4"/><path d="M16 7v11a3 3 0 0 1-3 3H6a3 3 0 0 0 3-3V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2h4"/><path d="M10.5 11h3M10.5 15h3"/>',
  trophy2: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  handshake: '<path d="m11 17 2 2a1.4 1.4 0 0 0 2-2"/><path d="m14 14 2.5 2.5a1.4 1.4 0 0 0 2-2l-3.9-3.9a2.8 2.8 0 0 0-4 0l-.9.9a1.4 1.4 0 0 1-2-2l2.8-2.8a5 5 0 0 1 5.6-1L18 7h3v8h-2"/><path d="M3 7h3l3 1M3 15h2l5 5a1.4 1.4 0 0 0 2-2"/>',
  gavel: '<path d="m14 13-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="m16 16 6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="M8.5 11.5 5 3h4l3 6 3-6h4l-3.5 8.5"/><path d="m12 13 .9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z"/>',
  portal: '<ellipse cx="12" cy="12" rx="6" ry="9"/><ellipse cx="12" cy="12" rx="2.5" ry="5"/>',
  elevator: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 3v18M8 10l-1.5-2L5 10M8 14l-1.5 2L5 14"/><path d="M15 9.5l1.5-1.5L18 9.5M15 14.5l1.5 1.5L18 14.5"/>',
  homes: '<path d="M2 12 8 7l6 5v8H2z"/><path d="M10 9.5 16 5l6 5v10h-8"/><path d="M6 20v-4h4v4"/>',
  gift2: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13"/><path d="M12 8C10 4 6.5 4 6.5 6.2 6.5 8 9.5 8 12 8zM12 8c2-4 5.5-4 5.5-1.8C17.5 8 14.5 8 12 8z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>',
  bag2: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  comet: '<circle cx="16" cy="8" r="3.5"/><path d="M13.5 10.5 3 21M12 8.5 5 15.5M15.5 12 8.5 19"/>',
  // server features
  always: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M20.5 4.5 21 8h-3.5"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-1.7-2.7-3-6-3"/>',
  gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13"/><path d="M12 8C10 4 6.5 4 6.5 6.2 6.5 8 9.5 8 12 8zM12 8c2-4 5.5-4 5.5-1.8C17.5 8 14.5 8 12 8z"/>',
  // game modes
  survival: '<path d="M16 8 4 20"/><path d="M6.5 5C10.5 2.8 15.5 3 19 5c2 3.5 2.2 8.5 0 12.5"/><path d="M14 4.2 19.8 10"/>',
  minigames: '<path d="M6.5 7h11a4.5 4.5 0 0 1 4.4 5.5l-1 4.5a2.5 2.5 0 0 1-4.3 1.1L14.5 16h-5l-2.1 2.1A2.5 2.5 0 0 1 3.1 17l-1-4.5A4.5 4.5 0 0 1 6.5 7z"/><path d="M8 10v4M6 12h4"/><path d="M15.5 11h.01M18 13h.01"/>',
  skyblock: '<path d="M2 11.5h20l-4.5 5L12 21.5l-5.5-5z"/><path d="M7.5 11.5V8"/><circle cx="7.5" cy="5.8" r="2.6"/><path d="M14.2 7.5h5.3a1.8 1.8 0 0 0 0-3.6h-.2a2.6 2.6 0 0 0-4.9-.4 2 2 0 0 0-.2 4z"/>',
  creative: '<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9.2 12z"/><path d="M8.6 13.4c-2.2 0-3.7 1.6-3.8 3.6-.1 1.4-.8 2.5-2.3 3.2 3.7 1 7.2.3 8.5-1.8a3.2 3.2 0 0 0-2.4-5z"/>',
  cube: '<path d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  tools: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
};

// The same icon as an element: <span class="ic">svg</span>
export function iconEl(name, cls = "") {
  const span = document.createElement("span");
  span.className = `ic${cls ? ` ${cls}` : ""}`;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = icon(name); // fixed strings from ICONS, never user text
  return span;
}

export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

const NAV = [
  ["/join", "How to Join", "book"],
  ["/rules", "Rules", "shield"],
  ["/status", "Status", "activity"],
  ["/leaderboard", "Leaderboard", "trophy"],
  ["/map", "Map", "map"],
  ["/store", "Store", "bag"],
  ["/voice", "Voice", "mic"],
];

export const serverAddress = config.bedrockAddress;

function currentPath() {
  const p = location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/");
  return p === "" ? "/" : p;
}

function renderHeader() {
  const slot = document.getElementById("site-header");
  if (!slot) return;
  const here = currentPath();
  const cur = (href) => (href === here ? ' aria-current="page"' : "");
  const links = NAV.map(([href, label]) => `<a href="${href}"${cur(href)}>${label}</a>`).join("");
  const chip = config.hosting === "realm" ? "" : `<button class="ip-chip" type="button" data-copy="${serverAddress}" title="Copy server address">${icon("copy")}<span>${serverAddress}</span><span class="ip-port">${config.bedrockPort}</span></button>`;
  const drawerLinks = [["/", "Home", "home"], ...NAV, ["/community", "Community", "chat"]]
    .map(([href, label, ic]) => `<a href="${href}"${cur(href)}>${icon(ic)}<span>${label}</span></a>`).join("");
  slot.outerHTML = `
  <header class="site-header">
    <div class="container">
      <button class="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="site-drawer">${icon("menu")}</button>
      <a class="brand" href="/" aria-label="${config.serverName} home"><img src="/img/wordmark.png" alt="${config.serverName}" width="150" height="26"></a>
      <nav class="nav" aria-label="Main">
        <div class="nav-links">${links}</div>
        <div class="nav-actions">${chip}<a class="btn btn-primary btn-sm" href="/community">Community</a></div>
      </nav>
      <a class="btn btn-primary btn-sm nav-community" href="/community">Community</a>
      <div class="acct-slot" id="acct-slot"></div>
    </div>
  </header>
  <div class="drawer-backdrop" hidden></div>
  <aside class="drawer" id="site-drawer" aria-label="Menu" aria-hidden="true">
    <div class="drawer-head">
      <img src="/img/wordmark.png" alt="${config.serverName}" width="132" height="23">
      <button class="drawer-close" type="button" aria-label="Close menu">${icon("close")}</button>
    </div>
    <nav class="drawer-links">${drawerLinks}</nav>
    ${config.hosting === "realm" ? "" : `<div class="drawer-card"><span class="eyebrow">Server address</span>
      <button class="ip-chip" type="button" data-copy="${serverAddress}">${icon("copy")}<span>${serverAddress}</span><span class="ip-port">${config.bedrockPort}</span></button>
      <span class="text-3 small">Bedrock Edition · tap to copy</span></div>`}
  </aside>`;
  const toggle = document.querySelector(".nav-toggle");
  const drawer = document.getElementById("site-drawer");
  const backdrop = document.querySelector(".drawer-backdrop");
  const setOpen = (open) => {
    drawer.classList.toggle("open", open);
    drawer.setAttribute("aria-hidden", String(!open));
    backdrop.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("drawer-open", open);
    if (open) {
      drawer.querySelector("a")?.focus();
    }
  };
  toggle.addEventListener("click", () => setOpen(true));
  drawer.querySelector(".drawer-close").addEventListener("click", () => { setOpen(false); toggle.focus(); });
  backdrop.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawer.classList.contains("open")) { setOpen(false); toggle.focus(); } });
}

function renderFooter() {
  const slot = document.getElementById("site-footer");
  if (!slot) return;
  slot.outerHTML = `
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <a class="brand" href="/" aria-label="${config.serverName} home"><img src="/img/wordmark.png" alt="${config.serverName}" width="150" height="26"></a>
          <p>A family-friendly Minecraft Bedrock server.</p>
        </div>
        <div><h4>Play</h4><ul><li><a href="/join">How to Join</a></li><li><a href="/status">Server Status</a></li><li><a href="/leaderboard">Leaderboards</a></li><li><a href="/map">Server Map</a></li><li><a href="/store">Store</a></li><li><a href="/store#donate">Donate</a></li></ul></div>
        <div><h4>Community</h4><ul><li><a href="/community">Community Chat</a></li><li><a href="/voice">Voice Chat</a></li><li><a href="/rules">Rules</a></li><li><a href="/appeal">Ban appeals</a></li></ul></div>
        <div><h4>Account</h4><ul><li><a href="/account">Account settings</a></li><li><a href="/account#notifications">Notifications</a></li><li><a href="/privacy">Privacy Policy</a></li></ul></div>
      </div>
    </div>
    <div class="footer-bottom">
      <div class="container">© ${new Date().getFullYear()} ${config.serverName}. NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.</div>
    </div>
  </footer>`;
}

// ---------- Toast + copy ----------
let toastTimer;
export function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(`Copied to clipboard`);
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy]");
  if (btn) copyText(btn.getAttribute("data-copy"));
});

// ---------- Fill in server info from config.js ----------
// Show only the parts of a page that match where we're hosted (data-hosting="realm" or "server").
function applyHosting() {
  document.querySelectorAll("[data-hosting]").forEach((el) => {
    el.hidden = el.getAttribute("data-hosting") !== config.hosting;
  });
}

function fillConfig() {
  const values = {
    serverName: config.serverName,
    bedrockAddress: config.bedrockAddress,
    bedrockPort: String(config.bedrockPort),
    minecraftVersion: config.minecraftVersion,
  };
  document.querySelectorAll("[data-config]").forEach((el) => {
    const v = values[el.getAttribute("data-config")];
    if (v !== undefined) el.textContent = v;
  });
  document.querySelectorAll("[data-copy-config]").forEach((el) => {
    const v = values[el.getAttribute("data-copy-config")];
    if (v !== undefined) el.setAttribute("data-copy", v);
  });
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.getAttribute("data-icon"));
  });
}

// ---------- Live status ----------
export async function fetchStatus() {
  const res = await fetch("/api/status", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("status unavailable");
  return res.json();
}

export function statusText(s) {
  if (s && s.manual) {
    const cls = { green: "is-online", amber: "is-maintenance", red: "is-offline" }[s.color] || (s.online ? "is-online" : "is-offline");
    return { cls, text: s.title };
  }
  if (!s || !s.configured) return { cls: "", text: "Launching soon" };
  if (s.reason === "lookup_failed") return { cls: "", text: "Status unavailable" };
  if (!s.online) return { cls: "is-offline", text: "Offline" };
  const n = s.players && s.players.online;
  if (n == null) return { cls: "is-online", text: "Online" };
  return { cls: "is-online", text: `Online · ${n} player${n === 1 ? "" : "s"}` };
}

// Updates every [data-status] element, refreshing once a minute while the page is visible.
export function startStatus(onData) {
  const els = document.querySelectorAll("[data-status]");
  const update = async () => {
    let s = null;
    try { s = await fetchStatus(); } catch { /* shown as unavailable */ }
    const { cls, text } = s ? statusText(s) : { cls: "", text: "Status unavailable" };
    els.forEach((el) => {
      el.classList.remove("is-online", "is-offline", "is-maintenance");
      if (cls) el.classList.add(cls);
      const label = el.querySelector("[data-status-text]");
      if (label) label.textContent = text;
    });
    document.querySelectorAll("[data-status-message]").forEach((el) => {
      el.textContent = s && s.manual ? (s.message || s.title) : text;
    });
    if (onData) onData(s);
  };
  update();
  setInterval(() => { if (document.visibilityState === "visible") update(); }, 60_000);
}

// Pages shown inside the community (e.g. Voice Chat) hide the site header and footer.
const EMBED = new URLSearchParams(location.search).has("embed") && window.top !== window;
if (EMBED) document.documentElement.classList.add("embedded");
else {
  renderHeader();
  renderFooter();
  if (!EMBED) import("/js/account-menu.js").then((m) => m.renderAccountButton(document.getElementById("acct-slot"))).catch(() => {});
}
fillConfig();
applyHosting();

// ---------- The GalaxySMP app (PWA): install it / Add to Home Screen ----------
export const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let installEvent = null;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

if ("serviceWorker" in navigator && !EMBED) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

export async function installApp() {
  if (installEvent) {
    installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    installEvent = null;
    document.querySelector(".install-banner")?.remove();
    return choice?.outcome === "accepted";
  }
  showIosSteps();
  return false;
}

function showIosSteps() {
  document.querySelector(".install-sheet")?.remove();
  const sheet = document.createElement("div");
  sheet.className = "install-sheet";
  sheet.innerHTML = `
    <div class="install-sheet-card" role="dialog" aria-label="Add GalaxySMP to your Home Screen">
      <img src="/img/icon-192.png" alt="" width="56" height="56">
      <h3>Add GalaxySMP to your Home Screen</h3>
      <ol>
        <li>Tap the <b>Share</b> button <span class="share-glyph" aria-hidden="true">${icon("share")}</span> at the bottom (or top) of Safari.</li>
        <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
        <li>Tap <b>Add</b>. Open GalaxySMP from your Home Screen.</li>
      </ol>
      <p class="text-3 small">The app opens full screen, and voice chat keeps working while you switch to Minecraft.</p>
      <button class="btn btn-primary btn-block" type="button">Got it</button>
    </div>`;
  sheet.addEventListener("click", (e) => { if (e.target === sheet || e.target.tagName === "BUTTON") sheet.remove(); });
  document.body.append(sheet);
}

export function installBanner(force) {
  if (EMBED || isInstalled() || document.querySelector(".install-banner")) return;
  const snoozed = Number(store.get("gsmp-install-later") || 0);
  if (!force && Date.now() - snoozed < 7 * 86400_000) return;
  if (!installEvent && !isIos()) return;  // nothing to offer on this browser
  const bar = document.createElement("div");
  bar.className = "install-banner";
  bar.innerHTML = `
    <img src="/img/icon-192.png" alt="" width="40" height="40">
    <div class="install-text"><strong>Get the GalaxySMP app</strong><span>Chat and voice that keep working while you play.</span></div>
    <button class="btn btn-primary btn-sm" type="button" data-install>${isIos() && !installEvent ? "How to add" : "Install"}</button>
    <button class="install-close" type="button" aria-label="Not now">×</button>`;
  bar.querySelector("[data-install]").addEventListener("click", () => installApp());
  bar.querySelector(".install-close").addEventListener("click", () => { store.set("gsmp-install-later", String(Date.now())); bar.remove(); });
  // In Community, sit above the message box instead of floating over the newest messages.
  const host = document.querySelector(".composer-wrap");
  if (host) { bar.classList.add("inline"); host.prepend(bar); } else document.body.append(bar);
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();  // show our own nicer banner instead of the browser's
  installEvent = e;
  installBanner();
  document.dispatchEvent(new Event("gsmp-installable"));
});
window.addEventListener("appinstalled", () => { document.querySelector(".install-banner")?.remove(); toast("GalaxySMP app installed!"); });
// iPhone / iPad: voice chat only works in the installed GalaxySMP app (in Safari it stops as soon as you switch
// to Minecraft). Apple doesn't let sites install themselves, so the voice page shows the steps until it's opened
// from the Home Screen. The rest of the website works normally in Safari.
const inAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|Discord|Snapchat|TikTok|musical_ly|GSA\/|Twitter|LinkedInApp|Pinterest/i.test(navigator.userAgent);
const installedTop = () => { try { return isInstalled() || window.top.navigator.standalone === true || window.top.matchMedia("(display-mode: standalone)").matches; } catch { return isInstalled(); } };
function forceInstallScreen() {
  // voice page only (also when it's shown inside the Community page's Voice Chat channel)
  if (!location.pathname.startsWith("/voice") || installedTop() || !isIos()) return;
  const ua = navigator.userAgent;
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  let steps;
  if (inAppBrowser()) {
    steps = `<ol>
      <li>This app's browser can't install GalaxySMP. Tap <b>Copy link</b> below.</li>
      <li>Open <b>Safari</b>, paste the link and go.</li>
      <li>Then tap <b>Share</b> <span class="share-glyph" aria-hidden="true">${icon("share")}</span> → <b>Add to Home Screen</b> → <b>Add</b>.</li></ol>
      <button class="btn btn-secondary btn-block" type="button" data-copy-link>Copy link</button>`;
  } else if (otherBrowser) {
    steps = `<ol>
      <li>Tap the <b>Share</b> button <span class="share-glyph" aria-hidden="true">${icon("share")}</span> (in the address bar or the ••• menu).</li>
      <li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
      <li>Open <b>GalaxySMP</b> from your Home Screen.</li></ol>
      <p class="text-3 small">Don't see it? Open galaxymc.us in Safari and do it there.</p>`;
  } else {
    steps = `<ol>
      <li>Tap the <b>Share</b> button <span class="share-glyph" aria-hidden="true">${icon("share")}</span> at the bottom of Safari (top on iPad).</li>
      <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
      <li>Open <b>GalaxySMP</b> from your Home Screen.</li></ol>`;
  }
  const wall = document.createElement("div");
  wall.className = "install-wall";
  wall.setAttribute("role", "dialog");
  wall.setAttribute("aria-modal", "true");
  wall.setAttribute("aria-label", "Install the GalaxySMP app");
  wall.innerHTML = `
    <div class="install-wall-card">
      <img src="/img/icon-192.png" alt="" width="84" height="84" class="install-wall-icon">
      <h1>Voice chat needs the <span class="grad-text">GalaxySMP</span> app</h1>
      <p class="text-2">On iPhone and iPad, voice chat only keeps working while you play Minecraft in the GalaxySMP app on your Home Screen. It's free and takes 10 seconds.</p>
      <div class="install-wall-steps">${steps}</div>
      <p class="text-3 small" style="margin-top:14px">Free, no App Store needed. <a href="/" target="_top">Back to the website</a></p>
    </div>`;
  wall.querySelector("[data-copy-link]")?.addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText("https://galaxymc.us" + location.pathname); e.target.textContent = "Link copied!"; }
    catch { e.target.textContent = "galaxymc.us"; }
  });
  document.documentElement.classList.add("install-locked");
  document.body.append(wall);
}
forceInstallScreen();
if (isIos() && !EMBED && !location.pathname.startsWith("/voice")) setTimeout(() => installBanner(), 1500);  // optional elsewhere

export { config };
