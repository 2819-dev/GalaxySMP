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
const short = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1).replace(/\.0$/, "")}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : v.toLocaleString());
fetch("/api/leaderboards?board=playtime").then((r) => r.json()).then((d) => {
  if (!d.ok) return;
  document.getElementById("hs-players").textContent = short(d.totals.players);
  document.getElementById("hs-hours").textContent = short(Math.round(d.totals.playtime / 3600));
  document.getElementById("hs-blocks").textContent = short(d.totals.mined);
  const online = document.getElementById("hs-online");
  if (online.textContent === "–") online.textContent = d.totals.online.toLocaleString();
}).catch(() => {});
