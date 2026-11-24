// Little preview cards under chat messages and DMs for links to our own website (galaxymc.us):
// a player profile shows their head, rank and whether they're playing; Store, Map, Leaderboards and the other
// pages show a small card with a button. Links to other websites never get a card.
import { h } from "/js/dialog.js";
import { rankTag } from "/js/rank-paint.js";

const OWN = /\b(?:https?:\/\/)?(?:www\.)?galaxymc\.us(\/[^\s<>"]*[^\s<>".,!?:;)\]])?/gi;
const PAGES = [
  [/^\/store/, "The Store", "Plans, crate keys, gift cards and more", "Open the Store"],
  [/^\/map/, "Live Map", "See the world, plots, warps and who's online", "Open the map"],
  [/^\/leaderboard/, "Leaderboards", "The top players on GalaxySMP", "See the leaderboards"],
  [/^\/status/, "Server Status", "Is the server online, and who's playing", "Check the status"],
  [/^\/rules/, "Rules", "The GalaxySMP rules", "Read the rules"],
  [/^\/appeal/, "Ban appeals", "Ask staff to look at a ban again", "Open appeals"],
  [/^\/community#events/, "Events", "Upcoming events on GalaxySMP", "See the events"],
  [/^\/wrapped/, "Galaxy Wrapped", "Your GalaxySMP story", "Open Wrapped"],
];
const cache = new Map();

function playerCard(name) {
  const card = h("a", { class: "lc-card", href: `/player/${encodeURIComponent(name)}` },
    h("div", { class: "lc-pic" }), h("div", { class: "lc-text" }, h("b", { text: name }), h("span", { class: "text-3 small", text: "Loading…" })));
  const key = `p:${name.toLowerCase()}`;
  const got = cache.get(key) || fetch(`/api/players/${encodeURIComponent(name)}`).then((r) => r.json()).catch(() => null);
  cache.set(key, got);
  got.then((d) => {
    const p = d?.player;
    if (!p) { card.remove(); return; }
    const pic = card.querySelector(".lc-pic");
    if (p.head) pic.append(h("img", { src: p.head, alt: "", width: 40, height: 40, loading: "lazy" }));
    const hours = p.stats?.playtime ? Math.round(p.stats.playtime / 3600) : 0;
    card.querySelector(".lc-text").replaceChildren(
      h("div", { class: "lc-title" }, p.rank ? rankTag(p.rank) : null, h("b", { text: p.name })),
      h("span", { class: `small ${p.online ? "lc-on" : "text-3"}`, text: p.online ? "Playing now" : `${hours.toLocaleString()} h played` }),
      h("span", { class: "lc-btn", text: "View profile" }));
  });
  return card;
}

function pageCard(path) {
  const hit = PAGES.find(([re]) => re.test(path));
  if (!hit) return null;
  const [, title, sub, button] = hit;
  return h("a", { class: "lc-card", href: path },
    h("div", { class: "lc-pic lc-logo" }, h("img", { src: "/img/icon-192.png", alt: "", width: 40, height: 40 })),
    h("div", { class: "lc-text" }, h("b", { text: title }), h("span", { class: "text-3 small", text: sub }), h("span", { class: "lc-btn", text: button })));
}

// Cards for up to 2 of our own links in a message (or null when there are none)
export function linkCards(text) {
  const seen = new Set();
  const cards = [];
  for (const m of String(text || "").matchAll(OWN)) {
    const path = m[1] || "/";
    if (seen.has(path) || cards.length >= 2) continue;
    seen.add(path);
    const player = /^\/player\/([^/?#]{1,32})/.exec(path);
    const card = player ? playerCard(decodeURIComponent(player[1])) : pageCard(path);
    if (card) cards.push(card);
  }
  return cards.length ? h("div", { class: "lc-wrap" }, ...cards) : null;
}
