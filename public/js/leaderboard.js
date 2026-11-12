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
  streak: (v) => `${v.toLocaleString()} day${v === 1 ? "" : "s"}`,
  achievements: (v) => `${v} achievement${v === 1 ? "" : "s"}`,
  bw_wins: (v) => plural(v, "win"),
  bw_finals: (v) => plural(v, "final kill"),
  bw_beds: (v) => plural(v, "bed") + " broken",
};
const SHORT = { money: "Money", mined: "Mining", placed: "Building", playtime: "Playtime", streak: "Daily streak", achievements: "Achievements", bw_wins: "Wins", bw_finals: "Final kills", bw_beds: "Beds broken" };
// The leaderboards in 4 groups: pick a group, then one of its boards.
const GROUPS = [
  { key: "economy", name: "Economy", boards: ["money"] },
  { key: "survival", name: "Survival", boards: ["mined", "placed"] },
  { key: "activity", name: "Activity", boards: ["playtime", "streak", "achievements"] },
  { key: "bedwars", name: "Bedwars", boards: ["bw_wins", "bw_finals", "bw_beds"] },
];
const groupOf = (key) => GROUPS.find((g) => g.boards.includes(key)) || GROUPS[0];
export const profileUrl = (name) => `/player/${encodeURIComponent(name)}`;

let board = new URLSearchParams(location.search).get("board") || "money";
if (!GROUPS.some((g) => g.boards.includes(board))) board = "money";

function pick(key) {
  board = key;
  history.replaceState(null, "", key === "money" ? "/leaderboard" : `/leaderboard?board=${key}`);
  load();
}

function tabRow(el, items, selected, onPick) {
  el.replaceChildren(...items.map(([key, label]) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.setAttribute("role", "tab"); btn.textContent = label;
    btn.setAttribute("aria-selected", String(key === selected));
    btn.addEventListener("click", () => onPick(key));
    return btn;
  }));
}

function tabs() {
  const group = groupOf(board);
  tabRow($("lb-tabs"), GROUPS.map((g) => [g.key, g.name]), group.key, (k) => pick(GROUPS.find((g) => g.key === k).boards[0]));
  const sub = $("lb-subtabs");
  sub.hidden = group.boards.length < 2;
  tabRow(sub, group.boards.map((b) => [b, SHORT[b]]), board, pick);
}

async function load() {
  const list = $("lb-list");
  try {
    const res = await fetch(`/api/leaderboards?board=${encodeURIComponent(board)}`);
    const data = await res.json();
    if (!data.ok) throw new Error();
    tabs();
    $("lb-players").textContent = data.totals.players.toLocaleString();
    $("lb-online").textContent = data.totals.online.toLocaleString();
    $("lb-total").textContent = money(data.totals.money);
    list.replaceChildren();
    if (!data.signedIn) {  // names and positions are for signed-in members
      const li = document.createElement("li");
      li.className = "empty";
      li.innerHTML = 'Sign in to see who\'s on top. <a href="/community">Sign in</a>';
      list.append(li);
      return;
    }
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
