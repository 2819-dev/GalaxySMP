import { config, icon, startStatus } from "/js/site.js";

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
  const potw = document.getElementById("home-potw");
  if (d.potw && potw) {  // Player of the Week spotlight
    potw.href = `/player/${encodeURIComponent(d.potw.name)}`;
    const img = document.createElement("img");
    img.className = "potw-face"; img.alt = ""; img.width = 56; img.height = 56;
    img.src = d.potw.head || "/favicon.png";
    const txt = document.createElement("div");
    const k = document.createElement("span"); k.className = "potw-k"; k.textContent = "⭐ Player of the Week";
    const n = document.createElement("b"); n.className = "potw-name"; n.textContent = d.potw.name;
    const sub = document.createElement("span"); sub.className = "potw-sub"; sub.textContent = `${Math.round(d.potw.secs / 3600)} hours played last week`;
    txt.append(k, n, sub);
    potw.replaceChildren(img, txt);
    potw.hidden = false;
  }
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
