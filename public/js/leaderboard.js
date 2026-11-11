// Leaderboards (stats are sent by the Minecraft server) and the player search.
import { money, moneyExact } from "/js/money.js";
import "/js/site.js";

const $ = (id) => document.getElementById(id);

export { money };
export const hours = (s) => (s >= 3600 ? `${Math.floor(s / 3600).toLocaleString()}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`);
const plural = (v, word) => `${v.toLocaleString()} ${word}${v === 1 ? "" : "s"}`;
const FORMAT = {
  money: money,
  playtime: hours,
  mined: (v) => plural(v, "block"),
  placed: (v) => plural(v, "block"),
  kills: (v) => plural(v, "mob"),
  quests: (v) => plural(v, "quest"),
  streak: (v) => `${v.toLocaleString()} day${v === 1 ? "" : "s"}`,
  achievements: (v) => `${v} badge${v === 1 ? "" : "s"}`,
};
const SHORT = { money: "Money", playtime: "Playtime", mined: "Mining", placed: "Building", kills: "Mobs", quests: "Quests", streak: "Streak", achievements: "Badges" };
export const profileUrl = (name) => `/player/${encodeURIComponent(name)}`;

let board = new URLSearchParams(location.search).get("board") || "money";

function tabs(list) {
  const t = $("lb-tabs");
  t.replaceChildren(...list.map((b) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.setAttribute("role", "tab"); btn.textContent = SHORT[b.key] || b.title;
    btn.setAttribute("aria-selected", String(b.key === board));
    btn.addEventListener("click", () => { board = b.key; history.replaceState(null, "", b.key === "money" ? "/leaderboard" : `/leaderboard?board=${b.key}`); load(); });
    return btn;
  }));
}

async function load() {
  const list = $("lb-list");
  try {
    const res = await fetch(`/api/leaderboards?board=${encodeURIComponent(board)}`);
    const data = await res.json();
    if (!data.ok) throw new Error();
    tabs(data.boards);
    $("lb-players").textContent = data.totals.players.toLocaleString();
    $("lb-online").textContent = data.totals.online.toLocaleString();
    $("lb-total").textContent = money(data.totals.money);
    list.replaceChildren();
    if (!data.players.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Nobody on this leaderboard yet. It fills up as people play.";
      list.append(li);
    }
    const fmt = FORMAT[data.board] || String;
    data.players.forEach((p, i) => {
      const li = document.createElement("li");
      if (i < 3) li.dataset.top = String(i + 1);
      const rank = document.createElement("span"); rank.className = "lb-rank"; rank.textContent = `#${i + 1}`;
      const name = document.createElement("a"); name.className = "lb-name"; name.textContent = p.name; name.href = profileUrl(p.name);
      if (p.online) { const dot = document.createElement("span"); dot.className = "online-dot"; dot.title = "Online now"; name.append(dot); }
      const val = document.createElement("span"); val.className = "lb-money"; val.textContent = fmt(p.value);
      if (data.board === "money") val.title = moneyExact(p.value);
      li.append(rank, name, val);
      list.append(li);
    });
    $("lb-updated").textContent = `${data.title}. Updates about every minute while the server is online.`;
  } catch {
    list.innerHTML = '<li class="empty">The leaderboard couldn\'t be loaded. Please try again later.</li>';
  }
}

// ---------- find a player ----------
export function playerSearch(form, input, box) {
  let timer;
  const show = (players) => {
    box.replaceChildren(...players.map((p) => {
      const a = document.createElement("a"); a.href = profileUrl(p.name); a.textContent = p.name;
      if (p.online) { const dot = document.createElement("span"); dot.className = "online-dot"; a.append(dot); }
      return a;
    }));
    box.hidden = !players.length;
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return show([]);
    timer = setTimeout(async () => {
      try { show((await (await fetch(`/api/players/search?q=${encodeURIComponent(q)}`)).json()).players || []); } catch { show([]); }
    }, 250);
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value.trim(); if (q) location.href = profileUrl(q); });
  document.addEventListener("click", (e) => { if (!form.contains(e.target)) box.hidden = true; });
}

if ($("lb-list")) {
  playerSearch($("player-search"), $("player-q"), $("player-suggest"));
  load();
  setInterval(load, 60_000);
}
