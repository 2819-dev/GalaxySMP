// Draws a Discord-style activity ("Playing Minecraft · On GalaxySMP · 1:20:05 elapsed") for profile cards.
import { iconEl } from "/js/site.js";

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function elapsed(since) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")} elapsed`;
}

function ago(when) {
  const m = Math.round((Date.now() - new Date(when).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

// Returns { node, stop } ; stop() ends the ticking timer.
export function activityBlock(a) {
  const box = el("div", `act act-${a.kind}`);
  const heading = a.kind === "custom" ? (a.label || "Status") : a.kind === "server" ? "Playing a game" : a.kind === "xbox-offline" ? "Xbox Live" : "On Xbox Live";
  box.append(el("div", "pc-label act-heading", heading));
  const row = el("div", "act-row");
  const art = el("div", `act-art act-art-${a.kind}`);
  art.append(iconEl(a.icon || "star"));
  if (a.kind === "server") art.append(el("span", "act-badge", "G"));
  const text = el("div", "act-text");
  const title = a.kind === "xbox-offline" ? a.title : a.kind === "custom" ? a.title : a.label === "Playing" ? a.title : `${a.label} · ${a.title}`;
  text.append(el("b", "act-title", title));
  if (a.details) text.append(el("span", "act-line", a.details));
  if (a.state) text.append(el("span", "act-line", a.state));
  let timer = null;
  if (a.since) {
    const t = el("span", "act-line act-time", elapsed(a.since));
    text.append(t);
    timer = setInterval(() => { if (!t.isConnected) clearInterval(timer); else t.textContent = elapsed(a.since); }, 1000);
  }
  if (a.lastSeen) text.append(el("span", "act-line", `Last seen ${ago(a.lastSeen)}`));
  row.append(art, text);
  box.append(row);
  return { node: box, stop: () => clearInterval(timer) };
}
