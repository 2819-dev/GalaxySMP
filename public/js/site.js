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
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

const NAV = [
  ["/join", "How to Join"],
  ["/rules", "Rules"],
  ["/status", "Status"],
  ["/store", "Store"],
];

export const javaFull = Number(config.javaPort) === 25565 ? config.javaAddress : `${config.javaAddress}:${config.javaPort}`;

function currentPath() {
  const p = location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/");
  return p === "" ? "/" : p;
}

function renderHeader() {
  const slot = document.getElementById("site-header");
  if (!slot) return;
  const here = currentPath();
  const links = NAV.map(
    ([href, label]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ""}>${label}</a>`
  ).join("");
  slot.outerHTML = `
  <header class="site-header">
    <div class="container">
      <a class="brand" href="/" aria-label="${config.serverName} home"><img src="/img/wordmark.png" alt="${config.serverName}" width="150" height="26"></a>
      <button class="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="site-nav">${icon("menu")}</button>
      <nav class="nav" id="site-nav" aria-label="Main">
        <div class="nav-links">${links}</div>
        <div class="nav-actions">
          ${config.hosting === "realm" ? "" : `<button class="ip-chip" type="button" data-copy="${javaFull}" title="Copy server address">${icon("copy")}<span>${javaFull}</span></button>`}
          <a class="btn btn-primary btn-sm" href="/community">Community</a>
        </div>
      </nav>
    </div>
  </header>`;
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    toggle.innerHTML = icon(open ? "close" : "menu");
  });
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
          <p>A family-friendly Minecraft server for Java and Bedrock players.</p>
        </div>
        <div><h4>Play</h4><ul><li><a href="/join">How to Join</a></li><li><a href="/status">Server Status</a></li><li><a href="/store">Store</a></li></ul></div>
        <div><h4>Community</h4><ul><li><a href="/community">Community Chat</a></li><li><a href="/rules">Rules</a></li></ul></div>
        <div><h4>Legal</h4><ul><li><a href="/privacy">Privacy Policy</a></li></ul></div>
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
    javaAddress: config.javaAddress,
    javaPort: String(config.javaPort),
    bedrockAddress: config.bedrockAddress,
    bedrockPort: String(config.bedrockPort),
    minecraftVersion: config.minecraftVersion,
    javaFull,
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
  const n = s.players.online;
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

renderHeader();
renderFooter();
fillConfig();
applyHosting();

export { config };
