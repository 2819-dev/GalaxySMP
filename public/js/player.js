// Full player profile: /player/<gamertag>
// Everyone sees the game side (rank, badges, stats, achievements). Signed-in members also see the social side:
// real name (unless hidden), bio, what they like to play, profile color, activity and a Message button.
import { iconEl, toast } from "/js/site.js";
import { h, reportPlayerDialog, postJson, getJson, openDialog } from "/js/dialog.js";
import { rankTag, paint } from "/js/rank-paint.js";
import { money, hours, playerSearch } from "/js/leaderboard.js";
import { faceSvg } from "/js/face.js";
import { activityBlock } from "/js/activity.js";
import { badgeRow } from "/js/badges.js";
import { barChart, lineChart } from "/js/charts.js";

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
  bw_first_game: "sword", bw_first_win: "trophy2", bw_wins_10: "crown", bw_beds_10: "pickaxe", bw_finals_25: "skull",
};
const achIcon = (id) => ACH_ICONS[id] || "star";

const $ = (id) => document.getElementById(id);
const PLANS = { free: "Galaxy Free", plus: "Galaxy+", pro: "Galaxy Pro+" };
const name = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || new URLSearchParams(location.search).get("name") || "");
const date = (d) => new Date(d).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString());

function ago(d) {
  const s = Math.max(0, (Date.now() - new Date(d)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return date(d);
}

const stat = (icon, k, v, sub) => h("div", { class: "pp-stat" },
  h("span", { class: "pp-stat-icon" }, iconEl(icon)),
  h("div", {}, h("div", { class: "pp-stat-v", text: v }), h("div", { class: "pp-stat-k", text: k }), sub ? h("div", { class: "pp-stat-sub", text: sub }) : null));

const section = (title, ...children) => h("section", { class: "panel pp-sec" }, h("h2", { class: "pp-h2", text: title }), ...children);

async function load() {
  const box = $("profile");
  if (!name) { box.replaceChildren(h("div", { class: "panel empty", text: "Search for a player above." })); return; }
  let data, social = null, signedIn = false;
  try {
    const [res, soc] = await Promise.all([
      fetch(`/api/players/${encodeURIComponent(name)}`).then((r) => r.json()),
      fetch(`/api/players/${encodeURIComponent(name)}/social`, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    data = res;
    if (res.error && /sign in/i.test(res.error)) {
      box.replaceChildren(h("div", { class: "panel empty" }, "Player profiles are for members. ", h("a", { href: "/community", text: "Sign in" }), " to see stats, badges and achievements."));
      return;
    }
    if (!data.ok) throw new Error(data.error);
    social = soc?.member || null;
    signedIn = Boolean(soc?.ok);
  } catch (e) {
    box.replaceChildren(h("div", { class: "panel empty", text: e.message || "This profile couldn't be loaded." }));
    return;
  }
  const p = data.player;
  document.title = `${p.name} · GalaxySMP`;
  const s = p.stats;
  const pos = (k) => (p.positions[k] ? `#${p.positions[k].toLocaleString()} on the server` : null);
  const unlocked = p.achievements.filter((a) => a.unlocked);
  const color = social?.color;

  // ---- hero ----
  const banner = h("div", { class: "pp-banner" });
  banner.style.background = color ? `linear-gradient(120deg, ${color}, ${color}55 70%, transparent)` : "linear-gradient(120deg, #2457eb, #8A5CFF 60%, #4FEBFD)";
  if (social?.banner) { banner.style.background = `url("${social.banner}") center / cover no-repeat`; banner.classList.add("has-pic"); }
  const face = h("img", { class: "pp-avatar", alt: "", width: 112, height: 112 });
  face.src = p.head || faceSvg(p.name);
  face.addEventListener("error", () => { face.src = faceSvg(p.name); }, { once: true });
  const avatarWrap = h("div", { class: `pp-avatar-wrap${p.online ? " online" : ""}${social?.frame ? ` lf lf-${social.frame}` : ""}` }, face, h("span", { class: "pp-ring", title: p.online ? "Playing on GalaxySMP" : "Offline" }));

  const nameEl = h("h1", { class: "pp-name" });
  nameEl.append(paint(p.name, p.rank));
  const sub = h("div", { class: "pp-sub" });
  if (social?.title) sub.append(h("span", { class: "look-title", text: social.title }));
  if (social?.username && social.username !== p.name) sub.append(h("span", { text: social.username }));
  if (social?.realName) sub.append(h("span", { class: "pp-real", text: social.realName }));
  const tags = h("div", { class: "pp-tags" },
    p.rank ? rankTag(p.rank) : null,
    p.plan && p.plan !== "free" ? h("span", { class: `plan-pill ${p.plan}`, text: PLANS[p.plan] }) : null,
    p.online ? h("span", { class: "pp-status on" }, h("span", { class: "online-dot" }), "Playing now") : h("span", { class: "pp-status", text: `Last online ${ago(p.lastOnline)}` }));

  const actions = h("div", { class: "pp-actions" });
  if (social && !social.isMe) actions.append(h("a", { class: "btn btn-primary btn-sm", href: `/community#dm-${social.id}` }, iconEl("message"), "Message"));
  if (social && !social.isMe) actions.append(h("a", { class: "btn btn-secondary btn-sm", href: `/trades?to=${encodeURIComponent(p.name)}` }, iconEl("handshake"), "Trade"));
  if (p.userId && p.friend && p.friend !== "self") actions.append(friendButton(p));
  if (social?.isMe) actions.append(h("a", { class: "btn btn-primary btn-sm", href: "/account" }, iconEl("pencil"), "Edit profile"));
  const share = h("button", { class: "btn btn-secondary btn-sm", type: "button" }, iconEl("share"), "Share");
  share.addEventListener("click", async () => {
    const url = location.href.split("#")[0];
    try {
      if (navigator.share) await navigator.share({ title: `${p.name} on GalaxySMP`, url });
      else { await navigator.clipboard.writeText(url); toast("Profile link copied."); }
    } catch { /* cancelled */ }
  });
  actions.append(share);
  if (signedIn && !social?.isMe) {
    const rep = h("button", { class: "btn btn-ghost btn-sm", type: "button", title: "Report this player to staff" }, iconEl("flag"), "Report");
    rep.addEventListener("click", () => reportPlayerDialog(p.name, { name: p.name }));
    actions.append(rep);
  }

  const activity = h("div", { class: "pp-activity" });
  if (social) {
    fetch(`/api/presence/${social.id}`, { credentials: "same-origin" }).then((r) => r.json()).then((d) => {
      if (d.activity && activity.isConnected) activity.append(activityBlock(d.activity).node);
    }).catch(() => {});
  }

  // Owner only: show this player's Xbox picture or their Minecraft head (their own Pro+ picture comes first)
  let picBox = null;
  if (p.picture) {
    const pic = p.picture;
    picBox = h("div", { class: "pp-pic-pick" }, h("span", { class: "text-3 small", text: "Profile picture" }));
    if (pic.custom) picBox.append(h("span", { class: "text-3 small", text: "· They use their own Galaxy Pro+ picture, which comes first." }));
    else {
      const current = pic.source === "auto" ? (pic.hasHead ? "head" : "xbox") : pic.source;
      const seg = h("div", { class: "seg", role: "radiogroup", "aria-label": "Profile picture" });
      for (const [value, label] of [["xbox", "Xbox picture"], ["head", "Player head"]]) {
        const b = h("button", { type: "button", role: "radio", "aria-checked": String(current === value), text: label });
        b.addEventListener("click", async () => {
          if (b.getAttribute("aria-checked") === "true") return;
          if (value === "head" && !pic.hasHead) { toast("Their Minecraft head hasn't arrived yet. They need to join the server first."); return; }
          try {
            await postJson(`/api/mod/players/${encodeURIComponent(pic.xuid)}/picture`, { source: value });
            for (const x of seg.children) x.setAttribute("aria-checked", String(x === b));
            face.src = `${(p.head || "").split("?")[0]}?v=${Date.now()}`;
            toast(value === "xbox" ? "Now showing their Xbox picture." : "Now showing their player head.");
          } catch (e) { toast(e.message); }
        });
        seg.append(b);
      }
      picBox.append(seg);
    }
  }

  const hero = h("section", { class: "panel pp-hero" }, banner,
    h("div", { class: "pp-hero-body" },
      avatarWrap,
      h("div", { class: "pp-who" }, nameEl, sub.childNodes.length ? sub : null, tags,
        p.badges?.length ? h("div", { class: "pp-badges" }, badgeRow(p.badges, 40)) : null, picBox),
      actions),
    activity);

  // ---- about ----
  const facts = h("div", { class: "pp-facts" },
    h("div", {}, h("span", { class: "pp-k", text: "First joined" }), h("b", { text: date(p.firstSeen) })),
    social?.since ? h("div", {}, h("span", { class: "pp-k", text: "Community member since" }), h("b", { text: date(social.since) })) : null,
    h("div", {}, h("span", { class: "pp-k", text: "Played" }), h("b", { text: hours(s.playtime) })),
);
  const about = social
    ? section("About",
      social.bio ? h("p", { class: "pp-bio", text: social.bio }) : h("p", { class: "text-3", style: "margin:0 0 12px", text: social.isMe ? "Add a short bio in your Account so people know what you're into." : "No bio yet." }),
      social.interests.length ? h("div", {}, h("span", { class: "pp-k", text: "Likes to play" }), h("div", { class: "pp-likes" }, social.interests.map((t) => h("span", { class: "pp-like", text: t })))) : null,
      facts)
    : section("About", facts, h("p", { class: "text-3 small", style: "margin:12px 0 0" }, h("a", { href: "/community", text: "Sign in" }), " to see more about this player."));

  // ---- stats ----
  const stats = section("Stats",
    h("div", { class: "pp-stats" },
      stat("wallet", "Money", p.money == null ? "–" : money(p.money), pos("money")),
      stat("clock", "Playtime", hours(s.playtime), pos("playtime")),
      stat("pickaxe", "Blocks mined", short(s.mined), pos("mined")),
      stat("bricks", "Blocks placed", short(s.placed)),
      stat("sword", "Mobs defeated", short(s.kills)),
      stat("skull", "Deaths", short(s.deaths)),
      stat("scroll", "Quests done", short(s.quests)),
      stat("flame", "Daily streak", `${s.streak} day${s.streak === 1 ? "" : "s"}`, `Best: ${s.bestStreak}`)));

  // ---- Build Contest wins (stats) ----
  if (p.contestWins) stats.querySelector(".pp-stats")?.append(stat("trophy2", "Build Contest wins", short(p.contestWins)));

  // ---- Bedwars ----
  const bw = p.bedwars || {};
  const bedwars = bw.games ? section("Bedwars",
    h("div", { class: "pp-stats" },
      stat("trophy2", "Wins", short(bw.wins), `${bw.games} game${bw.games === 1 ? "" : "s"} played`),
      stat("sword", "Kills", short(bw.kills)),
      stat("skull", "Final kills", short(bw.finals)),
      stat("pickaxe", "Beds broken", short(bw.beds)))) : null;

  // ---- activity over time (charts) ----
  const charts = section("Activity", h("p", { class: "text-3 small", style: "margin:0", text: "Loading…" }));
  loadCharts(p.name, charts);

  // ---- achievements (earned in game) ----
  const total = p.achievements.length;
  const pct = total ? Math.round((unlocked.length / total) * 100) : 0;
  const achievements = section("Achievements",
    total ? h("div", { class: "pp-progress" },
      h("div", { class: "pp-progress-bar" }, h("span", { style: `width:${pct}%` })),
      h("span", { class: "text-3 small", text: `${unlocked.length} of ${total} unlocked` })) : null,
    total
      ? h("div", { class: "badges" }, [...[...unlocked].sort((a, b) => (a.pct ?? 100) - (b.pct ?? 100)), ...p.achievements.filter((a) => !a.unlocked)].map((a) => {
        // rarity: the share of players who have it
        const tier = a.pct == null ? null : a.pct <= 5 ? ["legendary", "Legendary"] : a.pct <= 15 ? ["epic", "Epic"] : a.pct <= 35 ? ["rare", "Rare"] : null;
        return h("div", { class: `badge${a.unlocked ? "" : " locked"}${tier ? ` r-${tier[0]}` : ""}`, title: a.desc },
          h("span", { class: "e" }, iconEl(a.unlocked ? achIcon(a.id) : "lock")),
          h("div", {}, h("b", { text: a.name }), h("span", { text: a.desc }),
            a.pct != null ? h("span", { class: "ach-rarity" }, tier ? h("i", { class: `ach-tier ${tier[0]}`, text: tier[1] }) : null, `${a.pct}% of players`) : null));
      }))
      : h("p", { class: "text-3", style: "margin:0", text: "Achievements appear once the server has sent them." }),
    h("p", { class: "text-3 small", style: "margin:12px 0 0" }, "Earn achievements with ", h("code", { text: "/achievements" }), ", ", h("code", { text: "/quests" }), " and ", h("code", { text: "/daily" }), " in game. ",
      h("a", { href: "/leaderboard", text: "See the leaderboards" }), "."));

  // ---- showcase: up to 3 pinned achievements or builds ----
  let showcase = null;
  if (social?.showcase?.length || social?.isMe) {
    const items = social.showcase || [];
    showcase = h("section", { class: "panel pp-showcase" },
      h("div", { class: "pp-sc-head" }, h("h2", { text: "Showcase" }),
        social.isMe ? h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => editShowcase() }, iconEl("pencil"), items.length ? "Edit" : "Pick") : null),
      items.length ? h("div", { class: "pp-sc-grid" }, ...items.map((it) => it.type === "build"
        ? h("a", { class: "pp-sc-card build", href: "/community#builds" },
          it.image ? h("img", { src: it.image, alt: "", loading: "lazy" }) : h("span", { class: "pp-sc-ic" }, iconEl("castle")),
          h("div", {}, h("span", { class: "pp-sc-kind", text: "Build" }), h("b", { text: it.name })))
        : h("div", { class: "pp-sc-card" }, h("span", { class: "pp-sc-ic" }, iconEl(achIcon(it.id))),
          h("div", {}, h("span", { class: "pp-sc-kind", text: "Achievement" }), h("b", { text: it.name }), it.description ? h("span", { class: "text-3 small", text: it.description }) : null))))
        : h("p", { class: "text-3", style: "margin:0", text: "Pin up to 3 of your achievements or builds here for everyone to see." }));
  }

  // ---- wishlist (like Discord's): Store things they'd like, with a Gift button ----
  let wishlist = null;
  const wl = social?.wishlist;
  if (wl && (wl.length || social.isMe)) {
    const usd = (c) => `$${(c / 100).toFixed(2)}`;
    wishlist = h("section", { class: "panel pp-wishlist" },
      h("div", { class: "pp-sc-head" }, h("h2", {}, iconEl("heart"), " Wishlist"),
        social.isMe ? h("a", { class: "btn btn-ghost btn-sm", href: "/store" }, iconEl("plus"), "Add from the Store") : null),
      wl.length ? h("div", { class: "wl-grid" }, ...wl.map((it) => h("div", { class: `wl-item${it.isPlan ? " plan" : ""}` },
        h("div", { class: "wl-top" }, h("span", { class: "wl-ic" }, iconEl(it.icon)),
          h("div", {}, h("div", { class: "wl-name", text: it.name }), h("div", { class: "wl-price", text: it.priceText || `${it.from ? "from " : ""}${usd(it.price)}${it.per ? ` / ${it.per}` : ""}` }))),
        social.isMe ? null : it.soon ? h("span", { class: "text-3 small", text: "Coming soon" }) : h("a", { class: "btn btn-primary btn-sm", href: `/store?gift=${social.id}&giftName=${encodeURIComponent(social.username)}&item=${encodeURIComponent(it.key)}` }, iconEl("gift"), "Gift this"))))
        : h("p", { class: "text-3", style: "margin:0", text: "Tap the heart on anything in the Store to add it here. Friends can gift you things from your wishlist." }),
      social.isMe ? h("p", { class: "text-3 small", style: "margin:10px 0 0", text: social.wishlistHidden ? "Only you can see your wishlist. Change this in Account settings." : "Everyone signed in can see this. You can hide it in Account settings." }) : null);
  }

  box.replaceChildren(...[hero, showcase].filter(Boolean), h("div", { class: "pp-cols" }, h("div", { class: "pp-col" }, about, stats, bedwars, charts), h("div", { class: "pp-col" }, wishlist, achievements)));
}

// Playtime per day (bars) and money over the last 30 days (line), from the daily history.
async function loadCharts(name, box) {
  const body = box.querySelector("p");
  let d;
  try { d = await fetch(`/api/players/${encodeURIComponent(name)}/history`).then((r) => r.json()); } catch { body.textContent = "Charts couldn't be loaded."; return; }
  const rows = (d.days || []).slice(-31);
  if (rows.length < 2) { body.textContent = "Charts appear after a couple of days of playing."; return; }
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const days = [];
  const start = new Date(`${rows[0].day}T12:00:00`);
  for (let t = start; t <= new Date(`${rows[rows.length - 1].day}T12:00:00`); t = new Date(t.getTime() + 864e5)) days.push(t.toISOString().slice(0, 10));
  let prev = null, lastMoney = rows[0].money;
  const label = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
  const play = [], cash = [];
  for (const iso of days) {
    const r = byDay.get(iso);
    const secs = r && prev != null ? Math.max(0, r.playtime - prev) : 0;
    if (r) { prev = r.playtime; lastMoney = r.money; }
    if (iso !== days[0]) play.push({ label: label(iso), value: secs / 3600, tip: [label(iso), secs ? `Played ${hours(secs)}` : "Didn't play"] });
    cash.push({ label: label(iso), value: lastMoney, tip: [label(iso), money(lastMoney)] });
  }
  const total = play.reduce((n, x) => n + x.value, 0);
  const width = body.clientWidth || 600;
  box.replaceChildren(h("h2", { class: "pp-h2", text: "Activity" }),
    h("p", { class: "text-3 small", style: "margin:0 0 10px", text: `${hours(Math.round(total * 3600))} played in the last ${play.length} days.` }),
    barChart({ title: "Playtime per day", width, days: play, format: (v) => (v ? `${Math.round(v * 10) / 10}h` : "0") }),
    lineChart({ title: "Money", width, points: cash, format: (v) => money(v) }));
}

playerSearch($("player-search"), $("player-q"), $("player-suggest"));
load();

// Pick up to 3 achievements or builds for the showcase.
async function editShowcase() {
  let d;
  try { d = await getJson("/api/showcase/options"); } catch (e) { toast(e.message); return; }
  const chosen = d.chosen.map((c) => `${c.type}:${c.id}`);
  const count = h("p", { class: "text-3 small", style: "margin:0" });
  const boxes = [];
  const row = (it) => {
    const cb = h("input", { type: "checkbox", value: `${it.type}:${it.id}`, checked: chosen.includes(`${it.type}:${it.id}`) });
    boxes.push(cb);
    cb.addEventListener("change", () => {
      const n = boxes.filter((b) => b.checked).length;
      if (n > d.max) { cb.checked = false; toast(`You can pick up to ${d.max}.`); }
      count.textContent = `${boxes.filter((b) => b.checked).length} of ${d.max} picked`;
    });
    return h("label", { class: "check pp-sc-pick" }, cb, h("span", {}, h("b", { text: it.name }), it.description ? h("span", { class: "text-3 small", text: ` · ${it.description}` }) : null));
  };
  count.textContent = `${chosen.length} of ${d.max} picked`;
  openDialog({
    title: "Your showcase",
    body: h("div", { class: "form pp-sc-form" }, count,
      h("div", { class: "field-label", text: "Achievements" }),
      d.achievements.length ? h("div", { class: "stack", style: "gap:4px" }, ...d.achievements.map(row)) : h("p", { class: "text-3 small", text: "No achievements yet. Earn them in game with /achievements." }),
      h("div", { class: "field-label", text: "Builds" }),
      d.builds.length ? h("div", { class: "stack", style: "gap:4px" }, ...d.builds.map(row)) : h("p", { class: "text-3 small", text: "No builds yet. Share one in Community > #Builds." })),
    actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => {
      const items = boxes.filter((b) => b.checked).map((b) => { const [type, ...id] = b.value.split(":"); return { type, id: id.join(":") }; });
      await postJson("/api/showcase", { items });
      toast("Showcase saved.");
      location.reload();
    } }],
  });
}

// Add friend / Request sent / Accept / Friends, on someone else's profile.
function friendButton(p) {
  const btn = h("button", { class: "btn btn-secondary btn-sm", type: "button" });
  const LABELS = { none: ["userPlus", "Add friend"], outgoing: ["clock", "Request sent"], incoming: ["userPlus", "Accept friend request"], friends: ["users", "Friends"] };
  const draw = () => {
    const [icon, text] = LABELS[p.friend] || LABELS.none;
    btn.replaceChildren(iconEl(icon), text);
    btn.className = `btn btn-sm ${p.friend === "incoming" ? "btn-primary" : "btn-secondary"}`;
    btn.title = p.friend === "outgoing" ? "Tap to cancel the request" : p.friend === "friends" ? "Tap to remove this friend" : "";
  };
  const send = async (action) => {
    btn.disabled = true;
    try { p.friend = (await postJson("/api/friends", { action, userId: p.userId })).state; draw(); } catch (e) { toast(e.message); }
    btn.disabled = false;
  };
  btn.addEventListener("click", () => {
    if (p.friend === "none") return send("request");
    if (p.friend === "incoming") return send("accept");
    const remove = p.friend === "friends";
    openDialog({
      title: remove ? `Remove ${p.name} as a friend?` : "Cancel your friend request?",
      body: h("p", { text: remove ? "You'll stop seeing each other in your Friends lists." : `${p.name} won't see your request any more.` }),
      actions: [{ label: "Keep" }, { label: remove ? "Remove friend" : "Cancel request", kind: "danger", onClick: () => send(remove ? "remove" : "cancel") }],
    });
  });
  draw();
  return btn;
}
