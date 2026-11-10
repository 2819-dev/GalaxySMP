// Public player profile: /player/<gamertag>
import { iconEl } from "/js/site.js";

// A line icon for each achievement (instead of the emojis the game uses).
const ACH_ICONS = {
  welcome: "orbit", play_1h: "clock", play_10h: "clock", play_100h: "medal", play_500h: "comet",
  mine_1k: "pickaxe", mine_10k: "pickaxe", mine_100k: "gem", diamonds: "gem", diamonds_100: "gem",
  build_1k: "bricks", build_10k: "bricks", build_100k: "castle", hunt_100: "sword", hunt_1k: "sword", hunt_10k: "sword",
  first_death: "skull", deaths_100: "skull", streak_7: "flame", streak_30: "calendar", streak_100: "flame", dailies_50: "gift2",
  quests_10: "scroll", quests_100: "trophy2", quests_500: "trophy2", seller: "coins", seller_10k: "scale",
  landowner: "home", landlord: "homes", rich_1k: "wallet", rich_10k: "coins", rich_100k: "crown", rich_1m: "crown",
  crate_1: "dice", crate_50: "gift2", shopkeeper: "store", shop_tycoon: "store", customer: "bag2", auctioneer: "gavel",
  generous: "handshake", job_10: "wrench", job_21: "medal", traveler: "portal", engineer: "elevator",
};
const achIcon = (id) => ACH_ICONS[id] || "star";
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
              h("span", { class: "e" }, iconEl(achIcon(a.id))),
              h("div", {}, h("b", { text: a.name }), h("span", { text: a.unlocked ? a.desc : `Locked: ${a.desc}` })))))
        : h("p", { class: "text-3", style: "margin:0", text: "Badges appear once the server has sent them." })),
    h("p", { class: "text-3 small", style: "margin-top:12px" }, "Earn badges with ", h("code", { text: "/achievements" }), ", ", h("code", { text: "/quests" }), " and ", h("code", { text: "/daily" }), " in game. ",
      h("a", { href: "/leaderboard", text: "See the leaderboards" }), "."),
  );
}

playerSearch($("player-search"), $("player-q"), $("player-suggest"));
load();
