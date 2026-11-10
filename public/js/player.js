// Public player profile: /player/<gamertag>
import "/js/site.js";
import { h } from "/js/dialog.js";
import { rankTag } from "/js/rank-paint.js";
import { money, hours, playerSearch } from "/js/leaderboard.js";

const $ = (id) => document.getElementById(id);
const PLANS = { free: "Galaxy Free", plus: "Galaxy+", pro: "Galaxy Pro+" };
const name = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || new URLSearchParams(location.search).get("name") || "");
const date = (d) => new Date(d).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });

function ago(d) {
  const s = Math.max(0, (Date.now() - new Date(d)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return date(d);
}

function stat(k, v, sub) {
  return h("div", { class: "stat" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub ? h("div", { class: "sub", text: sub }) : null);
}

async function load() {
  const box = $("profile");
  if (!name) { box.replaceChildren(h("div", { class: "panel empty", text: "Search for a player above." })); return; }
  let data;
  try {
    const res = await fetch(`/api/players/${encodeURIComponent(name)}`);
    data = await res.json();
    if (!data.ok) throw new Error(data.error);
  } catch (e) {
    box.replaceChildren(h("div", { class: "panel empty", text: e.message || "This profile couldn't be loaded." }));
    return;
  }
  const p = data.player;
  document.title = `${p.name} · GalaxySMP`;
  const s = p.stats;
  const pos = (k) => (p.positions[k] ? `#${p.positions[k].toLocaleString()} on the server` : null);
  const unlocked = p.achievements.filter((a) => a.unlocked);
  box.replaceChildren(
    h("section", { class: "panel" },
      h("div", { class: "profile-head" },
        p.head ? h("img", { class: "avatar head-big", src: p.head, alt: "", "aria-hidden": "true" })
               : h("div", { class: "avatar", "aria-hidden": "true", text: [...p.name][0].toUpperCase() }),
        h("div", { style: "min-width:0" },
          h("h1", {}, p.name),
          h("div", { class: "profile-tags" },
            rankTag(p.rank),
            h("span", { class: `plan-pill ${p.plan}`, text: PLANS[p.plan] || p.plan }),
            p.online ? h("span", {}, h("span", { class: "online-dot" }), " Online now") : h("span", { text: `Last online ${ago(p.lastOnline)}` }),
          ),
          h("div", { class: "text-3 small", style: "margin-top:6px", text: `Joined ${date(p.firstSeen)}${p.linked ? " · Community member" : ""}` })))),
    h("section", { class: "panel", style: "padding:0;margin-top:16px" },
      h("div", { class: "stat-grid" },
        stat("Money", p.money == null ? "–" : money(p.money), pos("money")),
        stat("Playtime", hours(s.playtime), pos("playtime")),
        stat("Blocks mined", s.mined.toLocaleString(), pos("mined")),
        stat("Blocks placed", s.placed.toLocaleString()),
        stat("Mobs defeated", s.kills.toLocaleString()),
        stat("Deaths", s.deaths.toLocaleString()),
        stat("Quests done", s.quests.toLocaleString()),
        stat("Daily streak", `${s.streak} day${s.streak === 1 ? "" : "s"}`, `Best: ${s.bestStreak}`))),
    h("section", { class: "panel", style: "margin-top:16px" },
      h("h2", { style: "font-size:1.1rem;margin:0 0 12px", text: `Badges (${unlocked.length}/${p.achievements.length})` }),
      p.achievements.length
        ? h("div", { class: "badges" }, [...unlocked, ...p.achievements.filter((a) => !a.unlocked)].map((a) =>
            h("div", { class: `badge${a.unlocked ? "" : " locked"}`, title: a.desc },
              h("span", { class: "e", "aria-hidden": "true", text: a.emoji || "⭐" }),
              h("div", {}, h("b", { text: a.name }), h("span", { text: a.unlocked ? a.desc : `Locked: ${a.desc}` })))))
        : h("p", { class: "text-3", style: "margin:0", text: "Badges appear once the server has sent them." })),
    h("p", { class: "text-3 small", style: "margin-top:12px" }, "Earn badges with ", h("code", { text: "/achievements" }), ", ", h("code", { text: "/quests" }), " and ", h("code", { text: "/daily" }), " in game. ",
      h("a", { href: "/leaderboard", text: "See the leaderboards" }), "."),
  );
}

playerSearch($("player-search"), $("player-q"), $("player-suggest"));
load();
