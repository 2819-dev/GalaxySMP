import { startStatus, statusText } from "/js/site.js";
import { timelineChart, busiestHours, barChart } from "/js/charts.js";

const $ = (id) => document.getElementById(id);
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function render(s) {
  const hero = $("status-hero");
  const word = $("status-word");
  const motd = $("status-motd");
  word.classList.remove("skeleton");
  hero.classList.remove("is-online", "is-offline", "is-maintenance");

  const show = (title, message) => {
    word.textContent = title;
    motd.textContent = message || "";
    motd.hidden = !motd.textContent;
  };

  if (!s || s.reason === "lookup_failed") {
    show("Status unavailable", "Status information is temporarily unavailable. Retrying shortly.");
    return;
  }

  $("st-checked").textContent = time(s.checkedAt);
  $("st-source").textContent = s.source === "plugin"
    ? "Reported by the GalaxySMP server itself."
    : s.configured && !s.manual ? "Checked through our own website, so your device never contacts a third party." : "";

  if (s.manual) {
    hero.classList.add(statusText(s).cls);
    show(s.title, s.message);
    $("st-players").textContent = "–";
    $("st-version").textContent = "–";
    return;
  }

  if (!s.configured) {
    show("Launching soon", "The server address will be published here soon.");
  } else if (s.online) {
    hero.classList.add("is-online");
    const n = s.players && s.players.online;
    show("Online", n === 0 ? "No one is online right now." : s.motd);
  } else {
    hero.classList.add("is-offline");
    show("Offline", "The server may be restarting. Please check back shortly.");
  }

  const p = s.players || {};
  $("st-players").textContent = !s.online ? "0" : p.online == null ? "–" : p.max ? `${p.online} / ${p.max}` : String(p.online);
  $("st-version").textContent = s.online && s.version ? s.version : "–";
}

startStatus(render);

// ---------- Timeline (like a Realm's): uptime, who played when, busiest hours ----------
let tlDays = 7;
async function loadTimeline() {
  const box = $("tl-chart");
  let d;
  try { d = await fetch(`/api/timeline?days=${tlDays}`).then((r) => r.json()); } catch { box.textContent = "The timeline couldn't be loaded."; return; }
  if (!d.ok) { box.textContent = "The timeline couldn't be loaded."; return; }
  const span = d.now - d.from;
  const up = d.uptime.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, d.now) - Math.max(a, d.from)), 0);
  const peak = Math.max(0, ...d.uptime.map((u) => u[2]));
  const fact = (k, v) => { const el = document.createElement("div"); const b = document.createElement("b"); b.textContent = v; const s = document.createElement("span"); s.textContent = k; el.append(b, s); return el; };
  $("tl-sum").replaceChildren(
    fact("online", d.uptime.length ? `${Math.round((up / span) * 100)}%` : "–"),
    fact(d.players.length === 1 ? "player" : "players", String(d.players.length)),
    fact("most at once", String(peak)));
  box.replaceChildren(timelineChart({ data: d, onName: (n) => (d.signedIn ? `/player/${encodeURIComponent(n)}` : "/community") }));
  if (!d.signedIn) {
    const note = document.createElement("p");
    note.className = "text-3 small";
    note.innerHTML = 'Player names are hidden. <a href="/community">Sign in</a> to see who played when.';
    box.append(note);
  }
  const hrs = busiestHours(d);
  const lbl = (h) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" });
  $("tl-hours").replaceChildren(d.players.length ? barChart({ title: "Busiest hours (average players online, your time)", height: 140, width: $("tl-hours").clientWidth || 600,
    days: hrs.map((v, h) => ({ label: lbl(h), value: v, tip: [`${lbl(h)} – ${lbl((h + 1) % 24)}`, `${Math.round(v * 10) / 10} players on average`] })),
    format: (v) => String(Math.round(v * 10) / 10) }) : "");
}
document.querySelectorAll("#tl-range button").forEach((b) => b.addEventListener("click", () => {
  tlDays = Number(b.dataset.days);
  document.querySelectorAll("#tl-range button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  loadTimeline();
}));
loadTimeline();
setInterval(loadTimeline, 120000);

// ---------- Uptime: the last 30 days, one bar per day, and recent outages ----------
async function loadUptime() {
  const bars = $("up-bars");
  if (!bars) return;
  let d;
  try { d = await fetch("/api/uptime").then((r) => r.json()); } catch { return; }
  if (!d.ok) return;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const pct = (v) => (v == null ? "–" : `${v >= 99.95 ? "100" : v.toFixed(1).replace(/\.0$/, "")}%`);
  const fact = (v, k) => { const f = el("div"); f.append(el("b", "", v), el("span", "", k)); return f; };
  $("up-sum").replaceChildren(fact(pct(d.week), "last 7 days"), fact(pct(d.month), "last 30 days"),
    fact(String(d.restartsWeek), d.restartsWeek === 1 ? "unexpected restart this week" : "unexpected restarts this week"));
  const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric" });
  bars.replaceChildren(...d.days.map((x) => {
    const cls = x.pct == null ? "none" : x.pct >= 99 && !x.restarts ? "good" : x.pct >= 90 ? "ok" : "bad";
    const b = el("span", `up-bar ${cls}`);
    b.title = x.pct == null ? `${day(x.day)}: no data` : `${day(x.day)}: online ${pct(x.pct)}${x.restarts ? `, ${x.restarts} unexpected restart${x.restarts > 1 ? "s" : ""}` : ""}`;
    b.setAttribute("aria-label", b.title);
    return b;
  }));
  const when = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const items = [
    ...d.outages.map((o) => ({ t: o.from, text: `Offline for ${o.minutes < 60 ? `${o.minutes} min` : `${Math.round(o.minutes / 6) / 10} h`}`, cls: "bad" })),
    ...d.restarts.map((t) => ({ t, text: "Unexpected restart (back within a few minutes)", cls: "ok" })),
  ].sort((a, b) => b.t - a.t).slice(0, 6);
  const box = $("up-events");
  if (!items.length) { box.replaceChildren(el("p", "text-3 small up-none", "No outages in the last 30 days.")); return; }
  const list = el("ul", "up-list");
  for (const i of items) { const li = el("li"); li.append(el("i", `up-dot ${i.cls}`), el("span", "", i.text), el("time", "text-3", when(i.t))); list.append(li); }
  box.replaceChildren(el("h3", "up-h", "Recent"), list);
}
loadUptime();
