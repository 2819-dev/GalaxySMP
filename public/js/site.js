// Shared code for every public page: header, footer, copy buttons and live status.
import config from "/config.js";

export const LOGO_SVG = `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id="gp" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#c4b1ff"/><stop offset=".55" stop-color="#8b5cf6"/><stop offset="1" stop-color="#3b2a9e"/>
    </linearGradient>
  </defs>
  <ellipse cx="32" cy="34" rx="29" ry="9" fill="none" stroke="#a98bff" stroke-opacity=".45" stroke-width="3" transform="rotate(-18 32 34)"/>
  <circle cx="32" cy="32" r="17" fill="url(#gp)"/>
  <path d="M5.6 42.6C12 47 26 46 40 41s23-12 22-18" fill="none" stroke="#d9ccff" stroke-width="3" stroke-linecap="round" transform="rotate(-2 32 34)"/>
  <circle cx="51" cy="12" r="2" fill="#fff"/><circle cx="12" cy="14" r="1.3" fill="#fff" opacity=".7"/>
</svg>`;

const NAV = [
  ["/", "Home"],
  ["/join", "How to Join"],
  ["/rules", "Rules"],
  ["/status", "Status"],
  ["/store", "Store"],
];

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
      <a class="brand" href="/">${LOGO_SVG}<span>${config.serverName}</span></a>
      <button class="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="site-nav">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <nav class="nav" id="site-nav" aria-label="Main">
        ${links}
        <a class="btn btn-primary btn-sm" href="/community">Community</a>
      </nav>
    </div>
  </header>`;
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });
}

function renderFooter() {
  const slot = document.getElementById("site-footer");
  if (!slot) return;
  slot.outerHTML = `
  <footer class="site-footer">
    <div class="container">
      <nav aria-label="Footer">
        <a href="/join">How to Join</a><a href="/rules">Rules</a><a href="/status">Status</a>
        <a href="/store">Store</a><a href="/community">Community</a><a href="/privacy">Privacy</a>
      </nav>
      <div class="fine">© ${new Date().getFullYear()} ${config.serverName}. Not affiliated with Mojang or Microsoft.</div>
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
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("Copied!");
}

function wireCopyButtons() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy]");
    if (btn) copyText(btn.getAttribute("data-copy"));
  });
}

// ---------- Fill in server info from config.js ----------
function fillConfig() {
  const values = {
    serverName: config.serverName,
    tagline: config.tagline,
    description: config.description,
    javaAddress: config.javaAddress,
    javaPort: String(config.javaPort),
    bedrockAddress: config.bedrockAddress,
    bedrockPort: String(config.bedrockPort),
    minecraftVersion: config.minecraftVersion,
    javaFull: Number(config.javaPort) === 25565 ? config.javaAddress : `${config.javaAddress}:${config.javaPort}`,
  };
  document.querySelectorAll("[data-config]").forEach((el) => {
    const v = values[el.getAttribute("data-config")];
    if (v !== undefined) el.textContent = v;
  });
  document.querySelectorAll("[data-copy-config]").forEach((el) => {
    const v = values[el.getAttribute("data-copy-config")];
    if (v !== undefined) el.setAttribute("data-copy", v);
  });
}

// ---------- Live status ----------
export async function fetchStatus() {
  const res = await fetch("/api/status", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("status unavailable");
  return res.json();
}

export function statusText(s) {
  if (!s || !s.configured) return { cls: "", text: "Server address coming soon" };
  if (s.reason === "lookup_failed") return { cls: "", text: "Status unavailable right now" };
  if (!s.online) return { cls: "is-offline", text: "Server offline" };
  const n = s.players.online;
  return { cls: "is-online", text: `${n} player${n === 1 ? "" : "s"} online` };
}

// Updates every [data-status-pill] on the page, refreshing once a minute while visible.
export function startStatusPills(onData) {
  const pills = document.querySelectorAll("[data-status-pill]");
  if (!pills.length && !onData) return;
  const update = async () => {
    let s = null;
    try { s = await fetchStatus(); } catch { /* show unavailable */ }
    const { cls, text } = s ? statusText(s) : { cls: "", text: "Status unavailable right now" };
    pills.forEach((p) => {
      p.classList.remove("is-online", "is-offline");
      if (cls) p.classList.add(cls);
      const label = p.querySelector("[data-status-text]");
      if (label) label.textContent = text;
    });
    if (onData) onData(s);
  };
  update();
  setInterval(() => { if (document.visibilityState === "visible") update(); }, 60_000);
}

renderHeader();
renderFooter();
fillConfig();
wireCopyButtons();

export { config };
