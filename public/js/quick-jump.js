// Quick jump: press Ctrl+K (Cmd+K on a Mac), or tap the search button in the header, and type a few letters to
// jump to any page, Community channel or player profile.
import { h } from "/js/dialog.js";

const PAGES = [
  ["/", "Home"], ["/community", "Community"], ["/join", "How to Join"], ["/rules", "Rules"], ["/status", "Server Status"],
  ["/leaderboard", "Leaderboards"], ["/map", "Live Map"], ["/store", "Store"], ["/voice", "Voice Chat"], ["/season", "Season Pass"],
  ["/wrapped", "Galaxy Wrapped"], ["/account", "Account settings"], ["/appeal", "Ban appeals"], ["/privacy", "Privacy"],
];
let channels = null;   // loaded once, the first time the box opens
let open = null;

async function loadChannels() {
  if (channels) return channels;
  try {
    const d = await (await fetch("/api/chat/bootstrap")).json();
    channels = (d.channels || []).filter((c) => c.slug).map((c) => ({ slug: c.slug, name: c.name, kind: c.kind }));
  } catch { channels = []; }
  return channels;
}

// how well a name matches what was typed: starts with it > a word starts with it > contains it
function score(name, q) {
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 3;
  if (n.split(/[\s\-_#]+/).some((w) => w.startsWith(q))) return 2;
  return n.includes(q) ? 1 : 0;
}

export function openQuickJump() {
  if (open) return;
  const input = h("input", { class: "input qj-input", type: "search", placeholder: "Jump to a page, channel or player…", "aria-label": "Quick jump", autocomplete: "off", spellcheck: "false" });
  const list = h("div", { class: "qj-list", role: "listbox" });
  const panel = h("div", { class: "qj-panel", role: "dialog", "aria-modal": "true", "aria-label": "Quick jump" },
    input, list, h("p", { class: "qj-hint", text: "↑ ↓ to move · Enter to open · Esc to close" }));
  const back = h("div", { class: "qj-back" }, panel);
  let items = [];
  let sel = 0;
  let timer = null;
  let token = 0;

  const close = () => { back.remove(); document.removeEventListener("keydown", onKey, true); open = null; };
  const go = (it) => { if (!it) return; close(); location.href = it.href; };
  const draw = () => {
    list.replaceChildren(...(items.length ? items.map((it, i) => {
      const row = h("a", { class: `qj-item${i === sel ? " on" : ""}`, href: it.href, role: "option", "aria-selected": String(i === sel) },
        h("span", { class: "qj-kind", text: it.kind }), h("span", { class: "qj-name", text: it.label }), it.extra ? h("span", { class: "qj-extra", text: it.extra }) : null);
      row.addEventListener("mouseenter", () => { sel = i; draw(); });
      row.addEventListener("click", (e) => { e.preventDefault(); go(it); });
      return row;
    }) : [h("p", { class: "text-3 small qj-empty", text: input.value.trim() ? "Nothing found." : "Start typing…" })]));
    list.querySelector(".qj-item.on")?.scrollIntoView({ block: "nearest" });
  };
  const search = async () => {
    const q = input.value.trim().toLowerCase().replace(/^#/, "");
    const mine = ++token;
    const pages = PAGES.map(([href, label]) => ({ kind: "Page", label, href, s: q ? score(label, q) : 1 })).filter((x) => x.s);
    const chans = (await loadChannels()).map((c) => ({ kind: c.kind === "voice" ? "Voice" : "Channel", label: `#${c.name}`, href: `/community#${c.slug}`,
      s: q ? Math.max(score(c.name, q), score(c.slug, q)) : 0 })).filter((x) => x.s);
    let players = [];
    if (q.length >= 2) {
      try {
        const d = await (await fetch(`/api/players/search?q=${encodeURIComponent(q)}`)).json();
        players = (d.players || []).map((p) => ({ kind: "Player", label: p.name, href: `/player/${encodeURIComponent(p.name)}`, extra: p.online ? "Playing now" : "", s: 2.5 }));
      } catch { /* not signed in: pages and channels only */ }
    }
    if (mine !== token) return;   // a newer search started
    items = [...pages, ...chans, ...players].sort((a, b) => b.s - a.s).slice(0, 12);
    sel = 0;
    draw();
  };
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === "Enter" && document.activeElement === input) { e.preventDefault(); go(items[sel]); }
  }
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 150); });
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(back);
  open = back;
  input.focus();
  search();
}
