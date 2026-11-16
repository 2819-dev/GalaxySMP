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
  if (p.bot) { box.replaceChildren(botPage(p)); return; }
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
  actions.append(h("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: () => compareDialog(p) }, iconEl("scale"), "Compare"));
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

  // ---- Daily streak (Duolingo style): this week, freezes ----
  const streakBox = streakSection(p, Boolean(social?.isMe));

  // ---- Build Contest wins (stats) ----
  if (p.contestWins) stats.querySelector(".pp-stats")?.append(stat("trophy2", "Build Contest wins", short(p.contestWins)));

  // ---- Bedwars ----
  const bw = p.bedwars || {};
  const bedwars = bw.games ? section("Bedwars",
    h("div", { class: "pp-stats" },
      stat("trophy2", "Wins", short(bw.wins), `${bw.games} game${bw.games === 1 ? "" : "s"} played`),
      stat("sword", "Kills", short(bw.kills)),
      stat("skull", "Final kills", short(bw.finals)),
      stat("pickaxe", "Beds broken", short(bw.beds))), bwHistory(p.name)) : null;

  // ---- activity over time (charts) ----
  const charts = section("Activity", h("p", { class: "text-3 small", style: "margin:0", text: "Loading…" }));
  loadCharts(p.name, charts);

  // ---- achievements (earned in game) ----
  const total = p.achievements.length;
  const pct = total ? Math.round((unlocked.length / total) * 100) : 0;
  const achievements = section("Achievements",
    h("div", { class: "pp-ach-tools" }, h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => achievementsGuide(p) }, iconEl("book"), "Achievements guide")),
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

  box.replaceChildren(...[hero, showcase].filter(Boolean), h("div", { class: "pp-cols" }, h("div", { class: "pp-col" }, about, streakBox, stats, bedwars, charts), h("div", { class: "pp-col" }, wishlist, achievements)));
}

// Playtime per day (bars) and money over the last 30 days (line), from the daily history.
// GalaxySMP's own page: the official account (no game stats; what it does, and how to join from Xbox).
function botPage(p) {
  const s = p.stats;
  const copy = h("button", { class: "btn btn-primary btn-sm", type: "button" }, iconEl("copy"), "Copy gamertag");
  copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(p.xbox); toast(`Copied ${p.xbox}`); } catch { toast(p.xbox); } });
  const stat = (n, label, icon) => h("div", { class: "bp-stat" }, h("span", { class: "bp-ic" }, iconEl(icon)), h("b", { text: Number(n || 0).toLocaleString() }), h("span", { class: "text-3 small", text: label }));
  const jobs = [
    ["sparkles", "Question of the Day", "Every morning at 6:30 (New York time) in #Chat. Answer in its thread."],
    ["users", "Welcomes new players", "A welcome card with a Wave button the first time someone joins."],
    ["trophy", "Chat levels", "Announces level-ups and answers !level, !top and !help in #Bot Commands."],
    ["megaphone", "Official posts", "Update notes in #Updates and official ideas in #Suggestions."],
  ];
  return h("div", { class: "bp" },
    h("section", { class: "pp-hero panel bp-hero" },
      h("div", { class: "pp-banner bp-banner" }),
      h("div", { class: "pp-hero-body" },
        h("div", { class: "pp-avatar-wrap online" }, h("img", { class: "pp-avatar bp-avatar", src: p.head, alt: "", width: 112, height: 112 }), h("span", { class: "pp-ring", title: "Always online" })),
        h("div", { class: "pp-who" },
          h("h1", { class: "pp-name" }, p.name, h("span", { class: "bot-tag bp-tag" }, iconEl("check"), "BOT")),
          h("div", { class: "pp-sub" }, h("span", { text: "The official GalaxySMP account" })),
          h("div", { class: "pp-tags" }, h("span", { class: "pp-status on" }, h("span", { class: "online-dot" }), "Always online"),
            h("span", { class: "pp-status", text: `Member since ${new Date(p.joined).toLocaleDateString([], { month: "long", year: "numeric" })}` })),
          p.badges?.length ? h("div", { class: "pp-badges" }, badgeRow(p.badges, 40)) : null))),
    p.bio ? h("section", { class: "panel bp-sec" }, h("h2", { text: "About" }), h("p", { class: "text-2", text: p.bio })) : null,
    h("section", { class: "panel bp-sec bp-xbox" },
      h("div", {}, h("h2", { text: "Play from Xbox, PlayStation or Switch" }),
        h("p", { class: "text-2", text: "Add this gamertag as a friend on Xbox. GalaxySMP then shows up under Play → Friends in Minecraft, so you can join with one tap." })),
      h("div", { class: "bp-gt" }, h("code", { text: p.xbox }), copy)),
    h("section", { class: "panel bp-sec" }, h("h2", { text: "By the numbers" }),
      h("div", { class: "bp-stats" },
        stat(s.questions, "questions asked", "sparkles"), stat(s.qotdAnswers, "answers from players", "chat"),
        stat(s.welcomes, "players welcomed", "users"), stat(s.waves, "waves received", "smile"),
        stat(s.levelups, "level-ups announced", "trophy"), stat(s.answers, "commands answered", "bolt"))),
    p.todaysQuestion ? h("section", { class: "panel bp-sec bp-q" }, h("h2", { text: "Latest Question of the Day" }),
      h("p", { class: "bp-qtext", text: p.todaysQuestion.text }),
      h("a", { class: "btn btn-primary btn-sm", href: `/community#thread-${p.todaysQuestion.id}` }, iconEl("chat"), "Answer it")) : null,
    h("section", { class: "panel bp-sec" }, h("h2", { text: "What I do" }),
      h("div", { class: "bp-jobs" }, ...jobs.map(([ic, t, d]) => h("div", { class: "bp-job" }, h("span", { class: "bp-ic" }, iconEl(ic)), h("div", {}, h("b", { text: t }), h("p", { class: "text-3 small", text: d })))))));
}

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

// The daily streak: a flame with the count, the last 7 days (played, saved by a freeze, missed) and Streak Freezes.
function streakSection(p, isMe) {
  const st = p.stats || {};
  const info = p.streakInfo || {};
  const etDay = (offset) => { const d = new Date(Date.now() - 5 * 3600e3 - offset * 864e5); return d.toISOString().slice(0, 10); };
  const today = etDay(0);
  const alive = info.lastDaily === today || info.lastDaily === etDay(1) || (info.lastDaily && info.freezes > 0);
  const streak = alive ? Number(st.streak || 0) : 0;
  if (!streak && !st.bestStreak && !isMe) return null;
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = etDay(i);
    const kind = (info.log || {})[d] || (d === today ? "today" : "missed");
    const label = new Date(`${d}T12:00:00Z`).toLocaleDateString([], { weekday: "narrow" });
    days.push(h("div", { class: `sk-day sk-${kind}`, title: `${d}: ${kind === "played" ? "played" : kind === "frozen" ? "saved by a Streak Freeze" : kind === "today" ? "today" : "missed"}` },
      h("span", { class: "sk-dot" }, kind === "played" ? iconEl("flame") : kind === "frozen" ? iconEl("snowflake") : kind === "today" ? h("span", { class: "sk-ring" }) : null),
      h("span", { class: "sk-label", text: label })));
  }
  const claimedToday = info.lastDaily === today;
  const hint = isMe
    ? (claimedToday ? "You're done for today. See you tomorrow!" : streak ? "Type /daily in game today to keep your streak going." : "Type /daily in game to start a streak.")
    : null;
  return h("section", { class: "panel pp-sec sk-card" },
    h("div", { class: "sk-top" },
      h("div", { class: `sk-flame${streak ? " on" : ""}` }, iconEl("flame"), h("b", { text: String(streak) })),
      h("div", { class: "sk-text" },
        h("h2", { class: "pp-h2", style: "margin:0", text: streak === 1 ? "1-day streak" : `${streak}-day streak` }),
        h("span", { class: "text-3 small", text: `Best: ${st.bestStreak || 0} day${st.bestStreak === 1 ? "" : "s"}` })),
      h("div", { class: "sk-freezes", title: "Streak Freezes save the streak by themselves if a day is missed" }, iconEl("snowflake"), h("b", { text: String(info.freezes || 0) }))),
    h("div", { class: "sk-week" }, ...days),
    hint ? h("p", { class: "text-3 small", style: "margin:10px 0 0", text: hint }) : null,
    isMe ? h("div", { class: "sk-actions" },
      h("span", { class: "text-3 small", text: "You earn a freeze every 7 days of streak (up to 2). Galaxy Pro+ gets one each month." }),
      h("a", { class: "btn btn-secondary btn-sm", href: "/store#streak" }, iconEl("snowflake"), "Get Streak Freezes")) : null);
}

// ---------- Achievements guide (a dialog on the profile, not a page) ----------
function achievementsGuide(p) {
  const mine = new Set(p.viewer?.achievements || []);
  const all = [...p.achievements].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  let filter = "all";
  const list = h("div", { class: "ag-list" });
  const tabs = h("div", { class: "fr-tabs" });
  const draw = () => {
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.f === filter)));
    const shown = all.filter((a) => filter === "all" || (filter === "todo" ? !mine.has(a.id) : mine.has(a.id)));
    list.replaceChildren(...(shown.length ? shown.map((a) => {
      const have = mine.has(a.id);
      const tier = a.pct == null ? null : a.pct <= 5 ? "Legendary" : a.pct <= 15 ? "Epic" : a.pct <= 35 ? "Rare" : null;
      return h("div", { class: `ag-row${have ? " have" : ""}` },
        h("span", { class: "ag-ic" }, iconEl(have ? "check" : achIcon(a.id))),
        h("div", { class: "ag-text" }, h("b", { text: a.name }), h("span", { class: "text-2 small", text: a.desc })),
        h("div", { class: "ag-pct" }, h("b", { text: a.pct == null ? "–" : `${a.pct}%` }), h("span", { class: "text-3 small", text: tier || "of players" })));
    }) : [h("p", { class: "text-3", style: "margin:0", text: filter === "todo" ? "You have every achievement. Amazing!" : "None yet." })]));
  };
  for (const [f, label] of [["all", "All"], ["todo", "Still to get"], ["have", "Unlocked"]]) {
    if (f !== "all" && !p.viewer) continue;
    const b = h("button", { class: "fr-tab", type: "button", "data-f": f, text: label });
    b.addEventListener("click", () => { filter = f; draw(); });
    tabs.append(b);
  }
  draw();
  openDialog({
    title: "Achievements guide",
    body: h("div", { class: "ag" },
      h("p", { class: "text-3 small", style: "margin:0", text: `Every achievement on GalaxySMP, how to get it, and how many players have it.${p.viewer ? " Your own are ticked." : ""}` }),
      tabs, list),
    actions: [{ label: "Close", kind: "primary" }],
  });
}

// ---------- Compare players (a dialog on the profile) ----------
async function compareDialog(p) {
  const other = p.viewer && p.viewer.name.toLowerCase() !== p.name.toLowerCase() ? p.viewer.name : "";
  const input = h("input", { class: "input", id: "cmp-name", maxlength: 32, placeholder: "Another player's name", value: other });
  input.value = other;
  const out = h("div", { class: "cmp-out" });
  const run = async () => {
    const name = input.value.trim().replace(/^\./, "");
    if (!name) { out.replaceChildren(h("p", { class: "text-3", style: "margin:0", text: "Type a player's name to compare." })); return; }
    out.replaceChildren(h("p", { class: "text-3", style: "margin:0", text: "Loading…" }));
    let q;
    try { q = (await getJson(`/api/players/${encodeURIComponent(name)}`)).player; } catch (e) { out.replaceChildren(h("p", { class: "form-error", text: e.message })); return; }
    const A = p, B = q;
    const unlocked = (x) => x.achievements.filter((a) => a.unlocked).length;
    const rows = [
      ["Playtime", (x) => Number(x.stats.playtime || 0), (v) => hours(v)],
      ["Money", (x) => Number(x.money || 0), (v) => money(v)],
      ["Blocks mined", (x) => Number(x.stats.mined || 0), short],
      ["Blocks placed", (x) => Number(x.stats.placed || 0), short],
      ["Mobs defeated", (x) => Number(x.stats.kills || 0), short],
      ["Quests done", (x) => Number(x.stats.quests || 0), short],
      ["Best daily streak", (x) => Number(x.stats.bestStreak || 0), (v) => `${v} day${v === 1 ? "" : "s"}`],
      ["Achievements", unlocked, (v) => String(v)],
      ["Bedwars wins", (x) => Number(x.bedwars?.wins || 0), short],
      ["Build Contest wins", (x) => Number(x.contestWins || 0), short],
    ];
    let wa = 0, wb = 0;
    const body = rows.map(([label, get, fmt]) => {
      const a = get(A), b = get(B);
      if (a > b) wa++; else if (b > a) wb++;
      return h("div", { class: "cmp-row" },
        h("span", { class: `cmp-v${a > b ? " win" : ""}`, text: fmt(a) }), h("span", { class: "cmp-l text-3 small", text: label }), h("span", { class: `cmp-v r${b > a ? " win" : ""}`, text: fmt(b) }));
    });
    // achievements one has and the other doesn't
    const has = (x) => new Set(x.achievements.filter((a) => a.unlocked).map((a) => a.id || a.name));
    const ha = has(A), hb = has(B);
    const onlyA = A.achievements.filter((a) => a.unlocked && !hb.has(a.id || a.name));
    const onlyB = B.achievements.filter((a) => a.unlocked && !ha.has(a.id || a.name));
    const both = [...ha].filter((k) => hb.has(k)).length;
    const achList = (list) => list.length
      ? h("ul", { class: "cmp-ach" }, ...list.slice(0, 12).map((a) => h("li", { title: a.description || "" }, iconEl(achIcon(a.id)), h("span", { text: a.name }))),
        list.length > 12 ? h("li", { class: "text-3 small", text: `+${list.length - 12} more` }) : null)
      : h("p", { class: "text-3 small", style: "margin:0", text: "None." });
    const ach = h("div", { class: "cmp-ach-wrap" },
      h("h4", { class: "cmp-ach-h", text: `Achievements: ${both} in common` }),
      h("div", { class: "cmp-ach-cols" },
        h("div", {}, h("b", { class: "small", text: `Only ${A.name} has (${onlyA.length})` }), achList(onlyA)),
        h("div", {}, h("b", { class: "small", text: `Only ${B.name} has (${onlyB.length})` }), achList(onlyB))));
    out.replaceChildren(
      h("div", { class: "cmp-head" }, h("b", { text: A.name }), h("span", { class: "text-3 small", text: `${wa} – ${wb}` }), h("b", { class: "r", text: B.name })),
      ...body, ach);
  };
  const form = h("form", { class: "fr-add" }, input, h("button", { class: "btn btn-primary", type: "submit", text: "Compare" }));
  form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
  openDialog({ title: `Compare ${p.name}`, body: h("div", { class: "cmp" }, form, out), actions: [{ label: "Close", kind: "primary" }] });
  run();
}


// ---- Bedwars match history (recent games; tap one for the full recap) ----
const TEAM_NAMES = { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow" };
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
function bwHistory(name) {
  const box = h("div", { class: "bwh" }, h("p", { class: "text-3 small", style: "margin:10px 0 0", text: "Loading recent games…" }));
  getJson(`/api/bedwars/history?name=${encodeURIComponent(name)}`).then((d) => {
    if (!d.matches?.length) { box.replaceChildren(); return; }
    box.replaceChildren(h("h3", { class: "pp-sub", style: "margin:14px 0 6px;font-size:.95rem", text: "Recent games" }),
      h("ul", { class: "bwh-list" }, ...d.matches.map((m) => h("li", {}, h("button", { type: "button", onclick: () => bwRecap(m.id) },
        h("span", { class: `bwh-res ${m.won ? "win" : "loss"}`, text: m.won ? "Win" : "Loss" }),
        h("span", { class: "bwh-stats" }, `${m.mode || "Bedwars"} · ${TEAM_NAMES[m.team] || m.team} team · ${m.kills} kills, ${m.finals} finals, ${m.beds} beds`),
        h("span", { class: "text-3 small", text: new Date(m.startedAt).toLocaleDateString([], { month: "short", day: "numeric" }) }))))));
  }).catch(() => box.replaceChildren());
  return box;
}

async function bwRecap(id) {
  let d;
  try { d = await getJson(`/api/bedwars/match/${id}`); } catch (e) { toast(e.message); return; }
  const m = d.match;
  const teams = {};
  for (const p of m.players) (teams[p.team] ||= []).push(p);
  openDialog({
    title: `${m.mode || "Bedwars"} game · ${new Date(m.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
    body: h("div", { class: "stack", style: "gap:12px" },
      h("p", { class: "text-2", style: "margin:0", text: `${m.winner ? `${TEAM_NAMES[m.winner]} team won` : "No winner"} after ${mmss(m.seconds)}.` }),
      h("div", { class: "bw-live-teams" }, ...Object.entries(teams).map(([t, ps]) => h("div", { class: `bw-team ${t}` },
        h("b", { text: `${TEAM_NAMES[t]}${t === m.winner ? " · winners" : ""}` }),
        ...ps.map((p) => h("span", { text: `${p.name}: ${p.kills} kills, ${p.finals} finals, ${p.beds} beds` }))))),
      m.feed?.length ? h("ul", { class: "bw-feed" }, ...m.feed.map((f) => h("li", { text: `${mmss(f.t)}  ${f.text}` }))) : null),
    actions: [{ label: "Close", kind: "primary" }],
  });
}
