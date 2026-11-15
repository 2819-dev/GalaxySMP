import { config, icon, startStatus } from "/js/site.js";
import { faceSvg } from "/js/face.js";

const worlds = document.getElementById("worlds");
for (const m of config.gameModes) {
  const el = document.createElement("div");
  el.className = `world world-${m.tone || "x"}`;
  el.innerHTML = `<div class="ico">${icon(m.icon)}</div><h3></h3><p></p>`;
  el.querySelector("h3").textContent = m.name;
  el.querySelector("p").textContent = m.text;
  worlds.appendChild(el);
}

startStatus((st) => {
  const n = st && typeof st.players === "object" ? st.players.online : st?.online;
  if (Number.isFinite(n)) document.getElementById("hs-online").textContent = n.toLocaleString();
});

// Live numbers for the stats strip
const short = (v) => {
  const one = (x) => x.toFixed(1).replace(/\.0$/, "");
  if (v >= 999.95e9) return `${one(v / 1e12)}T`;
  if (v >= 999.95e6) return `${one(v / 1e9)}B`;
  if (v >= 999.5e3) return `${one(v / 1e6)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}K`;
  return v.toLocaleString();
};
fetch("/api/leaderboards?board=playtime").then((r) => r.json()).then((d) => {
  if (!d.ok) return;
  document.getElementById("hs-players").textContent = short(d.totals.players);
  document.getElementById("hs-hours").textContent = short(Math.round(d.totals.playtime / 3600));
  document.getElementById("hs-blocks").textContent = short(d.totals.mined);
  const online = document.getElementById("hs-online");
  if (online.textContent === "–") online.textContent = d.totals.online.toLocaleString();
}).catch(() => {});

// The server-wide goal (Control Panel > Server control), with a progress bar.
fetch("/api/goals/current", { credentials: "same-origin" }).then((r) => r.json()).then((d) => {
  const g = d.goal;
  const box = document.getElementById("home-goal");
  if (!g || !box) return;
  const pct = Math.min(100, Math.floor((g.progress / g.target) * 100));
  const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
  const head = el("div", "goal-head");
  head.append(el("span", "goal-k", g.finished ? "Goal reached!" : g.closed ? "Last goal" : "Server goal"), el("b", "goal-title", g.title));
  const bar = el("div", "goal-bar");
  const fill = el("span");
  fill.style.width = `${pct}%`;
  bar.append(fill);
  const info = el("div", "goal-info");
  info.append(el("span", "", `${g.progress.toLocaleString()} of ${g.target.toLocaleString()} ${g.unit} · ${pct}%`),
    el("span", "", g.finished ? "Thanks, everyone!" : g.closed ? "Time ran out" : `${g.endsIn} left${g.rewardCents ? ` · $${Math.round(g.rewardCents / 100).toLocaleString()} for each helper` : ""}`));
  box.replaceChildren(head, bar, info);
  if (g.top?.length) box.append(el("p", "goal-top", `Top helpers: ${g.top.slice(0, 3).map((t) => t.name).join(", ")}`));
  box.hidden = false;
}).catch(() => {});

// New members: the Getting started checklist, right under the top section
import("/js/checklist.js").then(async ({ checklistCard }) => {
  const card = await checklistCard();
  if (!card) return;
  const hero = document.querySelector("main .hero");
  const wrap = document.createElement("div");
  wrap.className = "container ck-wrap";
  wrap.append(card);
  hero?.after(wrap);
}).catch(() => {});

// ---------- Online now: who's in game and what they're doing (names for signed-in members) ----------
async function onlineNow() {
  const box = document.getElementById("home-online");
  if (!box) return;
  let d;
  try { d = await (await fetch("/api/online", { credentials: "same-origin" })).json(); } catch { return; }
  if (!d.ok || !d.up || !d.count) { box.hidden = true; return; }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const head = el("div", "online-head");
  head.append(el("span", "online-pulse"), el("b", "", `${d.count} playing now`));
  const list = el("div", "online-list");
  if (d.signedIn) {
    for (const p of d.players) {
      const a = el("a", "online-p");
      a.href = `/player/${encodeURIComponent(p.name)}`;
      const img = el("img");
      img.src = p.head; img.alt = ""; img.width = 36; img.height = 36; img.loading = "lazy";
      img.onerror = () => { img.onerror = null; img.src = faceSvg(p.name); };
      const t = el("span", "online-t");
      t.append(el("b", "", p.name), el("span", "", p.doing || "Playing"));
      a.append(img, t);
      list.append(a);
    }
  } else {
    for (let i = 0; i < Math.min(d.count, 8); i++) list.append(el("span", "online-blank"));
    const note = el("a", "online-sign", "Sign in to see who's playing");
    note.href = "/community";
    list.append(note);
  }
  box.replaceChildren(head, list);
  box.hidden = false;
}
onlineNow();
setInterval(onlineNow, 60_000);
