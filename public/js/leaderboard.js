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
  pvp_rating: (v) => `${v.toLocaleString()} · ${tierName(v)}`,
  pvp_wins: (v) => plural(v, "win"),
  pvp_kills: (v) => plural(v, "kill"),
};
// PvP ranked tiers (the same as in game)
export const tierName = (r) => (r >= 1700 ? "Galaxy" : r >= 1500 ? "Diamond" : r >= 1300 ? "Platinum" : r >= 1100 ? "Gold" : r >= 900 ? "Silver" : "Bronze");
const SHORT = { money: "Money", mined: "Mining", placed: "Building", playtime: "Playtime", streak: "Daily streak", achievements: "Achievements", bw_wins: "Wins", bw_finals: "Final kills", bw_beds: "Beds broken",
                pvp_rating: "Ranked rating", pvp_wins: "Duel wins", pvp_kills: "Kills" };
// The leaderboards in 4 groups: pick a group, then one of its boards.
const GROUPS = [
  { key: "economy", name: "Economy", boards: ["money"] },
  { key: "survival", name: "Survival", boards: ["mined", "placed"] },
  { key: "activity", name: "Activity", boards: ["playtime", "streak", "achievements"] },
  { key: "bedwars", name: "Bedwars", boards: ["bw_wins", "bw_finals", "bw_beds"] },
  { key: "pvp", name: "PvP", boards: ["pvp_rating", "pvp_wins", "pvp_kills"] },
  { key: "parkour", name: "Parkour", boards: ["parkour"] },
];
SHORT.parkour = "Parkour";
let course = new URLSearchParams(location.search).get("course") || null;   // Parkour: which course
const pkClock = (ms) => { const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`; };
const groupOf = (key) => GROUPS.find((g) => g.boards.includes(key)) || GROUPS[0];
export const profileUrl = (name) => `/player/${encodeURIComponent(name)}`;

let board = new URLSearchParams(location.search).get("board") || (location.hash === "#bedwars" ? "bw_wins" : location.hash === "#pvp" ? "pvp_rating" : "money");
let bwRange = "all";  // Bedwars: all time, this week or this month
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
  let range = document.getElementById("lb-range");
  if (group.key === "bedwars" || (group.key === "pvp" && board !== "pvp_rating")) {
    if (!range) {
      range = document.createElement("div");
      range.className = "lb-subtabs lb-range";
      range.id = "lb-range";
      range.setAttribute("role", "tablist");
      range.setAttribute("aria-label", "Time range");
      sub.after(range);
    }
    range.hidden = false;
    tabRow(range, [["all", "All time"], ["week", "This week"], ["month", "This month"]], bwRange, (k) => { bwRange = k; load(); });
  } else if (range) range.hidden = true;
  bwLive(group.key === "bedwars");
}

// ---------- Bedwars: the game running right now ----------
let liveTimer = null;
async function bwLive(show) {
  let card = document.getElementById("bw-live");
  clearTimeout(liveTimer);
  if (!show) { if (card) card.hidden = true; return; }
  if (!card) {
    card = document.createElement("section");
    card.id = "bw-live";
    card.className = "panel bw-live";
    $("lb-list").closest("section, .panel, div").before(card);
  }
  let d = null;
  try { d = (await (await fetch("/api/bedwars/live")).json()).live; } catch { d = null; }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  if (!d) {
    card.hidden = false;
    card.replaceChildren(el("div", "bw-live-head", null));
    card.firstChild.append(el("b", "", "No Bedwars game right now"), el("span", "text-3 small", "Join from a Minigame Computer or /bedwars. Turn on \"Bedwars games\" in Account settings > Notifications to hear when players are waiting."));
    liveTimer = setTimeout(() => bwLive(true), 30_000);
    return;
  }
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const head = el("div", "bw-live-head");
  head.append(el("span", "bw-live-dot"), el("b", "", `Live ${d.mode || "Bedwars"} game`), el("span", "text-3 small", `${mmss(d.elapsed)}${d.next ? ` · ${d.next.label} in ${mmss(Math.max(0, d.next.in))}` : ""}`));
  const teams = el("div", "bw-live-teams");
  for (const t of d.teams) {
    const box = el("div", `bw-team ${t.key}${t.alive ? "" : " out"}`);
    box.append(el("b", "", `${t.name} ${t.bed ? "· bed ✔" : t.alive ? `· ${t.alive} left` : "· out"}`));
    for (const p of t.players) box.append(el("span", p.alive ? "" : "text-3", `${p.name} — ${p.kills}K ${p.finals}F ${p.beds}B`));
    teams.append(box);
  }
  const feed = el("ul", "bw-feed");
  for (const f of d.feed || []) feed.append(el("li", "", `${mmss(f.t)}  ${f.text}`));
  card.hidden = false;
  card.replaceChildren(head, teams, d.feed?.length ? feed : el("p", "text-3 small", "No kills yet."));
  liveTimer = setTimeout(() => bwLive(true), 10_000);
}

// ---------- Parkour: best times per course ----------
async function loadParkour() {
  const list = $("lb-list");
  tabs();
  $("lb-players").closest("section").hidden = true;   // server totals don't belong to a parkour course
  let d;
  try { d = await (await fetch("/api/leaderboards/parkour")).json(); } catch { d = null; }
  const sub = $("lb-subtabs");
  if (!d?.ok) { list.innerHTML = '<li class="empty">The parkour times couldn\'t be loaded. Please try again later.</li>'; return; }
  if (!d.courses.length) {
    sub.hidden = true;
    list.innerHTML = '<li class="empty">No parkour courses yet. Staff build them in game with /parkour create.</li>';
    $("lb-updated").textContent = "Parkour: best time on each course. Play with /parkour in game.";
    return;
  }
  if (!d.courses.some((c) => c.name === course)) course = d.courses[0].name;
  sub.hidden = d.courses.length < 2;
  tabRow(sub, d.courses.map((c) => [c.name, c.name]), course, (k) => { course = k; history.replaceState(null, "", `/leaderboard?board=parkour&course=${encodeURIComponent(k)}`); loadParkour(); });
  const c = d.courses.find((x) => x.name === course);
  list.replaceChildren();
  if (!c.top.length) {
    const li = document.createElement("li"); li.className = "empty"; li.textContent = "Nobody has finished this course yet. Be the first!"; list.append(li);
  }
  c.top.forEach((p, i) => {
    const li = document.createElement("li");
    if (i < 3) li.dataset.top = String(i + 1);
    const rank = document.createElement("span"); rank.className = "lb-rank"; rank.textContent = `#${i + 1}`;
    const name = document.createElement(d.signedIn ? "a" : "span"); name.className = "lb-name"; name.textContent = p.name;
    if (d.signedIn) name.href = profileUrl(p.name);
    const val = document.createElement("span"); val.className = "lb-money"; val.textContent = pkClock(p.ms);
    val.title = `${p.finishes} finish${p.finishes === 1 ? "" : "es"}`;
    li.append(rank, name, val);
    list.append(li);
  });
  $("lb-updated").textContent = `${c.name}: ${c.checkpoints} checkpoint${c.checkpoints === 1 ? "" : "s"}${c.reward ? ` · first finish pays ${money(c.reward)}` : ""}. Best time per player. Play with /parkour in game.`;
}

async function load() {
  if (board === "parkour") return loadParkour();
  $("lb-players").closest("section").hidden = false;
  const list = $("lb-list");
  try {
    const res = await fetch(`/api/leaderboards?board=${encodeURIComponent(board)}`);
    const data = await res.json();
    if (!data.ok) throw new Error();
    if (groupOf(board).key === "pvp" && board !== "pvp_rating" && bwRange !== "all") {  // PvP this week / this month
      const top = await (await fetch(`/api/pvp/top?range=${bwRange}`)).json();
      const field = { pvp_wins: "wins", pvp_kills: "kills" }[board];
      data.players = (top.players || []).map((p) => ({ name: p.name, value: p[field] || 0 })).filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
      data.title = `PvP ${SHORT[board].toLowerCase()} ${bwRange === "week" ? "this week" : "this month"} (duels, ranked, party fights and events)`;
    }
    if (groupOf(board).key === "bedwars" && bwRange !== "all") {  // this week / this month, from the match history
      const top = await (await fetch(`/api/bedwars/top?range=${bwRange}`)).json();
      const field = { bw_wins: "wins", bw_finals: "finals", bw_beds: "beds" }[board];
      data.players = (top.players || []).map((p) => ({ name: p.name, value: p[field] || 0 })).filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
      data.title = `${SHORT[board]} ${bwRange === "week" ? "this week" : "this month"}${bwRange === "week" ? " (the weekly #1 in wins gets $1,000, a Rare Pack, a Rare key and a badge)" : ""}`;
    }
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
