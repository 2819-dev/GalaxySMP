// GalaxySMP community chat (browser side).
// All text is inserted with textContent, never as HTML, so nothing a user types can run as code.
import { attachChannelSuggest } from "/js/channel-suggest.js";
import { badgeRow } from "/js/badges.js";
import { activityBlock } from "/js/activity.js";
import { icon, toast } from "/js/site.js";
import { paint, rankTag, roleIcon, rankCss } from "/js/rank-paint.js";
import { showPanel, hidePanel, dmEvent } from "/js/community-panels.js";
import { ticketEvent } from "/js/tickets.js";
import { renderMarkdown, plainText, setCustomEmoji, customEmoji, emojiNode } from "/js/markdown.js";
import { setupMentions } from "/js/mentions.js";
import { faceSvg } from "/js/face.js";
import { openDialog, h } from "/js/dialog.js";

// A member's current rank (live updates win over what an older message recorded).
const rankFor = (id, fallback) => (state.members.has(id) ? state.members.get(id).rank : fallback) || null;

const $ = (id) => document.getElementById(id);
export const DM_CHANNEL = -1;
export const FRIENDS_CHANNEL = -2;
const DM_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
const FRIENDS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
const HELP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/></svg>';
const LIVE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.5"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/></svg>';
const MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/></svg>';

const state = {
  me: null,
  channels: [],
  categories: [],
  roles: new Map(),
  members: new Map(),
  online: new Set(),
  reactions: [],
  channelId: null,
  typing: new Map(),   // channelId -> Map(userId -> { name, until })
  messages: new Map(), // id -> message (current channel only)
  hasMore: false,
  replyTo: null,
  unread: new Set(),
  counts: new Map(),   // channelId -> { n, mentions } (new messages since you last read the channel)
  screen: "channel",   // phones: "list" (the channel list) or "channel"
  app: false,          // phones: the app layout (bottom tabs, full-screen channel list)
  ws: null,
  wsRetry: 0,
  pingTimer: null,
  stopped: false,
  pending: new Map(), // nonce -> text
  onSignedOut: null,
};

// ---------- Helpers ----------
async function api(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const err = new Error("Please sign in to continue.");
    err.signedOut = true;
    throw err;
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function hueOf(name) {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// Profile picture: the player's Minecraft head (sent by the game server), or their first letter.
// Until the server sends someone's real head: a little Minecraft-style face made from their name.
function letterAvatar(name, small) {
  const img = el("img", "avatar head" + (small ? " sm" : ""));
  img.src = faceSvg(name);
  img.alt = "";
  img.setAttribute("aria-hidden", "true");
  return img;
}
function avatar(name, small, member) {
  const head = member?.head || [...(state.members?.values?.() || [])].find((x) => x.username === name)?.head;
  if (!head) return letterAvatar(name, small);
  const img = el("img", "avatar head" + (small ? " sm" : ""));
  img.src = head;
  img.alt = "";
  img.loading = "lazy";
  img.setAttribute("aria-hidden", "true");
  img.addEventListener("error", () => img.replaceWith(letterAvatar(name, small)), { once: true });
  return img;
}

// ---------- Profile card (click a name or picture, like Discord) ----------
const PLAN_NAMES = { plus: "Galaxy+", pro: "Galaxy Pro+" };
export const profileActionHooks = [];  // staff tools add buttons here
let openCard = null;
function closeProfile() {
  openCard?.remove();
  openCard?._off?.abort();  // stop listening for clicks outside the old card
  openCard = null;
}
function openProfile(member, anchor) {
  closeProfile();
  if (!member) return;
  const rank = member.rank || null;
  const online = state.online?.has(member.id);
  const card = el("div", "profile-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", `${member.username}'s profile`);
  const banner = el("div", "pc-banner");
  banner.style.background = member.color ? `linear-gradient(120deg, ${member.color}, ${member.color}88)` : rankCss(rank) || "linear-gradient(90deg, #4FEBFD, #3DAAF4, #2149DD)";
  if (member.banner) banner.style.background = `url("${member.banner}") center / cover no-repeat`;
  const pic = el("div", "pc-avatar" + (online ? " online" : "") + (member.frame ? ` lf lf-${member.frame}` : ""));
  const big = avatar(member.username, false, member);
  pic.append(big);
  const name = el("div", "pc-name");
  name.append(paint(member.username, rank));
  if (member.bot) name.append(botTag());
  const ri = roleIcon(rank);
  if (ri) name.append(ri);
  const title = member.title ? el("div", "look-title", member.title) : null;
  const status = el("div", "pc-status", member.inGame ? "Playing on GalaxySMP" : online ? "Online" : "Offline");
  status.classList.add(member.inGame ? "playing" : online ? "on" : "off");
  const roles = el("div", "pc-roles");
  const chip = (label, color, iconRank) => {
    const c = el("span", "role-chip");
    const dot = el("span", "dot");
    dot.style.background = color;
    c.append(dot);
    const ic = iconRank ? roleIcon(iconRank) : null;
    if (ic) c.append(ic);
    c.append(label);
    return c;
  };
  if (rank) roles.append(chip(rank.name || rank.prefix, rankCss(rank), rank));
  if (member.plan && !rank?.plan) roles.append(chip(PLAN_NAMES[member.plan] || member.plan, member.plan === "pro" ? "linear-gradient(90deg,#FF8AF2,#8A3CFF,#4F56FF)" : "linear-gradient(90deg,#7CFF8A,#4DB8FF,#9A6BFF)"));
  // Staff powers (Moderator / Admin) are only permissions: they're never shown, only the rank is.
  if (!roles.childNodes.length) roles.append(el("span", "text-3 small", "No roles yet"));
  const body = el("div", "pc-body");
  const user = el("div", "pc-user", member.username);
  if (member.realName) {
    const real = el("span", "pc-realname", member.realName);
    if (member.realNameHidden) real.title = member.id === state.me?.id ? "Only you and staff can see this" : "Hidden from other players";
    user.append(el("span", "pc-dot", " · "), real);
    if (member.realNameHidden) user.append(el("span", "pc-hidden", member.id === state.me?.id ? " (only you and staff see this)" : " (hidden from players)"));
  }
  body.append(name, user);
  if (title) body.append(title);
  if (member.badges?.length) body.append(badgeRow(member.badges, 28));
  body.append(status);
  const actSlot = el("div", "pc-activity");
  body.append(actSlot);
  fetch(`/api/presence/${member.id}`, { credentials: "same-origin" }).then((r) => r.json()).then((d) => {
    if (d.activity && actSlot.isConnected) actSlot.append(activityBlock(d.activity).node);
  }).catch(() => {});
  if (member.bio) body.append(el("div", "pc-label", "About"), el("p", "pc-bio", member.bio));
  if (member.interests?.length) {
    const likes = el("div", "pc-likes");
    for (const t of member.interests) likes.append(el("span", "pc-like", t));
    body.append(el("div", "pc-label", "Likes to play"), likes);
  }
  body.append(el("div", "pc-label", "Roles"), roles);
  if (member.since) {
    body.append(el("div", "pc-label", "Member since"), el("div", "pc-since", new Date(member.since).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })));
  }
  const actions = el("div", "pc-actions");
  const view = el("a", "btn btn-secondary btn-sm", "View full profile");
  view.href = `/player/${encodeURIComponent(member.username)}`;
  actions.append(view);
  if (state.me && member.id !== state.me.id && !member.bot) {
    const dm = el("button", "btn btn-primary btn-sm", "Message");
    dm.type = "button";
    dm.addEventListener("click", () => { closeProfile(); openDM(member.id); });
    actions.prepend(dm);
  }
  for (const hook of profileActionHooks) hook(member, actions, closeProfile);
  body.append(actions);
  const x = el("button", "pc-close");
  x.type = "button";
  x.setAttribute("aria-label", "Close");
  x.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  x.addEventListener("click", (e) => { e.stopPropagation(); closeProfile(); });
  card.append(banner, x, pic, body);
  document.body.append(card);
  // place it next to what was clicked (on phones it's a sheet at the bottom)
  if (window.innerWidth > 700 && anchor) {
    const r = anchor.getBoundingClientRect();
    const w = 300;
    let left = r.right + 10;
    if (left + w > window.innerWidth - 10) left = Math.max(10, r.left - w - 10);
    const top = Math.min(Math.max(10, r.top - 20), window.innerHeight - card.offsetHeight - 10);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  } else {
    card.classList.add("sheet");
  }
  openCard = card;
  // a click outside this card closes it (only this card: clicking another member opens theirs instead)
  const off = new AbortController();
  card._off = off;
  setTimeout(() => {
    if (off.signal.aborted) return;
    document.addEventListener("click", (e) => { if (openCard === card && !card.contains(e.target)) closeProfile(); }, { signal: off.signal });
  }, 0);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeProfile(); });

function roleOf(key) {
  return state.roles.get(key) || { name: "Member", color: "#c9cdfb", power: 10 };
}

const timeFmt = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat([], { weekday: "long", month: "long", day: "numeric" });
function dayLabel(d) {
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return dayFmt.format(d);
}

function currentChannel() {
  return state.channels.find((c) => c.id === state.channelId);
}

// ---------- Channels ----------
function renderChannels() {
  const list = $("channel-list");
  list.replaceChildren();
  for (const cat of state.categories) {
    if (!state.channels.some((c) => c.categoryId === cat.id)) continue; // e.g. categories whose channels are hidden
    list.append(el("div", "channel-cat", cat.name));
    for (const ch of state.channels.filter((c) => c.categoryId === cat.id)) {
      const b = el("button", "channel");
      b.type = "button";
      b.dataset.id = ch.id;
      if (ch.id === state.channelId) b.setAttribute("aria-current", "true");
      const cnt = state.counts.get(ch.id);
      if (state.unread.has(ch.id) || cnt?.n) b.classList.add("unread");
      if (cnt?.n) b.classList.add("has-count");
      const mark = el("span", "hash");
      if (ch.kind === "voice") mark.innerHTML = MIC_SVG;
      else if (ch.kind === "streams") mark.innerHTML = LIVE_SVG;
      else if (ch.kind === "support") mark.innerHTML = HELP_SVG;
      else if (ch.kind === "dms") mark.innerHTML = DM_SVG;
      else if (ch.kind === "friends") mark.innerHTML = FRIENDS_SVG;
      else mark.textContent = "#";
      b.append(mark, el("span", "ch-name", ch.name));
      if (cnt?.mentions) b.append(Object.assign(el("span", "ch-badge ch-at", cnt.mentions > 99 ? "99+" : String(cnt.mentions)), { title: `${cnt.mentions} mention${cnt.mentions === 1 ? "" : "s"}` }));
      else if (cnt?.n) b.append(el("span", "ch-badge", cnt.n > 99 ? "99+" : String(cnt.n)));
      if (!ch.canPost && ch.kind === "text" && !cnt?.n) {
        const ro = el("span", "ro");
        ro.innerHTML = icon("megaphone");
        ro.title = "Staff only";
        b.append(ro);
      }
      b.addEventListener("click", () => {
        closeDrawers();
        go(ch.id);
      });
      list.append(b);
    }
  }
  if ([...state.counts.values()].some((c) => c.n)) {
    const all = el("button", "ch-readall", "Mark all as read");
    all.type = "button";
    all.addEventListener("click", markAllRead);
    list.prepend(all);
  }
  renderTabs();
}

// ---------- What's on screen (so you aren't notified about a chat you're already looking at) ----------
function setView(view) {
  state.view = view || null;
  queueMicrotask(renderTabs);
  reportView();
}
function reportView() {
  const looking = document.visibilityState === "visible" && document.hasFocus();
  const view = looking ? state.view : null;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify({ type: "viewing", view }));
}
document.addEventListener("visibilitychange", reportView);
window.addEventListener("focus", reportView);
window.addEventListener("blur", reportView);
setInterval(reportView, 4 * 60_000); // still looking: say so again now and then

async function selectChannel(id) {
  state.channelId = id;
  state.viewingOld = false;
  renderTyping();
  if (!(state.app && state.screen === "list")) {   // loaded behind the channel list on phones: not read yet
    state.unread.delete(id);
    state.counts.delete(id);
    rememberRecent(id);
  }
  state.replyTo = null;
  renderReplyBar();
  const ch = currentChannel();
  $("channel-name").textContent = ch.name;
  $("channel-topic").textContent = ch.topic || "";
  document.querySelector(".chat-top .hash").textContent = ["voice", "support", "dms", "friends", "streams"].includes(ch.kind) ? "" : "#";
  if (state.screen !== "list") { try { history.replaceState(history.state, "", "#" + ch.slug); } catch { /* ignore */ } }
  renderChannels();
  // Special channels (Information, Auction House, Suggestions, Voice Chat, Events) have their own views.
  const special = ch.kind && ch.kind !== "text";
  // pins, search and slow mode only make sense in normal chat channels
  for (const id of ["open-pins", "open-search", "open-slowmode"]) { const b = document.getElementById(id); if (b) b.hidden = Boolean(special) || (id === "open-slowmode" && b.hidden); }
  $("messages").hidden = special;
  document.querySelector(".composer-wrap").hidden = special;
  $("jump-latest").hidden = true;
  setView(ch.kind === "dms" ? (state.dmWith ? `dm:${state.dmWith}` : "dms") : ch.slug);
  if (special) {
    showPanel(ch, { me: state.me, toast, dmWith: state.dmWith, members: state.members, setView, openDM: (id) => openDM(id), sub: state.sub });
    state.sub = null;
    state.dmWith = null;
    return;
  }
  hidePanel();
  renderComposer();
  const box = $("messages");
  box.classList.remove("cx-fade"); void box.offsetWidth; box.classList.add("cx-fade");
  await loadMessages();
  markRead();
}

// ---------- read / unread ----------
let readTimer = null;
function markRead() {
  clearTimeout(readTimer);
  readTimer = setTimeout(() => {
    const ch = currentChannel();
    if (!ch || ch.kind !== "text" || document.visibilityState !== "visible" || (state.app && state.screen === "list")) return;
    const last = Math.max(0, ...[...state.messages.keys()].map(Number).filter((n) => n > 0));
    if (!last || last <= (state.readUpTo.get(ch.id) || 0)) return;
    state.readUpTo.set(ch.id, last);
    fetch(`/api/chat/channels/${ch.id}/read`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lastId: last }) }).catch(() => {});
  }, 600);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.channelId) markRead(); });
async function markAllRead() {
  state.counts.clear();
  for (const id of [...state.unread]) if (id > 0) state.unread.delete(id);
  renderChannels();
  await fetch("/api/chat/read-all", { method: "POST", credentials: "same-origin" }).catch(() => {});
  toast("All caught up.");
}
function isMention(m) {
  const me = state.me?.username;
  if (!me || m.author?.id === state.me?.id) return false;
  return new RegExp(`@${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(m.content || "") || (/@(everyone|here)\b/i.test(m.content || "") && roleOf(m.author.role).power >= 50) ||
    Boolean(m.replyTo && m.replyTo.username === me);
}

// ---------- getting around: history (Back), the phone layout, the quick switcher ----------
const RECENT_KEY = "gx_recent_channels";
function rememberRecent(id) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter((x) => x !== id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...list].slice(0, 6)));
  } catch { /* storage blocked */ }
}
function recentChannels() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}
const depth = () => Number(history.state?.d) || 0;
// Open a channel as a new step, so Back returns to where you were.
function go(id, opts = {}) {
  const ch = state.channels.find((c) => c.id === id);
  if (!ch) return;
  const same = id === state.channelId;
  if (!same || state.screen !== "channel") {
    try { history.pushState({ cx: "ch", d: depth() + 1 }, "", "#" + ch.slug); } catch { /* ignore */ }
  }
  setScreen("channel");
  if (!same || opts.force) selectChannel(id);
}
// Phones: back to the channel list.
function toList() {
  if (!state.app) return;
  if (history.state?.cx === "ch" && depth() > 0) { history.back(); return; }
  try { history.replaceState({ cx: "list", d: 0 }, "", location.pathname); } catch { /* ignore */ }
  setScreen("list");
}
function setScreen(screen) {
  state.screen = screen;
  $("view-chat").dataset.screen = screen;
  if (screen === "list") setView(null);
  else if (state.channelId != null) {
    const ch = currentChannel();
    if (ch?.kind === "text") setView(ch.slug);
    // opening the channel that was already loaded behind the list: now it's read
    if (state.counts.has(state.channelId) || state.unread.has(state.channelId)) {
      state.counts.delete(state.channelId); state.unread.delete(state.channelId); rememberRecent(state.channelId);
      renderChannels(); markRead();
    }
  }
  renderTabs();
}
function onPop() {
  state.popAt = Date.now();
  if (closeOverlays()) return;
  const hash = location.hash.slice(1);
  if (!hash || history.state?.cx === "list") {
    if (state.app) { setScreen("list"); return; }
    const chat = state.channels.find((c) => c.slug === "chat") || state.channels[0];
    if (chat.id !== state.channelId) selectChannel(chat.id);
    return;
  }
  const dm = /^dm-(\d+)$/.exec(hash);
  if (dm) { state.dmWith = Number(dm[1]); setScreen("channel"); selectChannel(DM_CHANNEL); return; }
  const [slug, sub] = hash.split("/");
  const ch = state.channels.find((c) => c.slug === slug);
  if (!ch) return;
  setScreen("channel");
  if (ch.id !== state.channelId || sub) { state.sub = sub || null; selectChannel(ch.id); }
}

// the bottom tabs (phones)
const TABS = [
  { key: "home", label: "Home", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>' },
  { key: "messages", label: "Messages", svg: DM_SVG },
  { key: "friends", label: "Friends", svg: FRIENDS_SVG },
  { key: "alerts", label: "Alerts", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>' },
  { key: "you", label: "You", svg: null },
];
function buildTabs() {
  if ($("cx-tabs")) return;
  const bar = el("nav", "cx-tabs");
  bar.id = "cx-tabs";
  bar.setAttribute("aria-label", "Community");
  for (const t of TABS) {
    const b = el("button", "cx-tab");
    b.type = "button";
    b.dataset.tab = t.key;
    const ic = el("span", "cx-tab-ic");
    if (t.svg) ic.innerHTML = t.svg;   // fixed icons only
    else {
      const meMember = state.members.get(state.me.id);
      const img = el("img", "cx-tab-face");
      img.alt = "";
      img.src = meMember?.head || faceSvg(state.me.username);
      img.addEventListener("error", () => { img.src = faceSvg(state.me.username); }, { once: true });
      ic.append(img);
    }
    ic.append(el("span", "cx-tab-badge"));
    b.append(ic, el("span", "cx-tab-label", t.label));
    // the header's bell and account menu are hidden in the app layout; these tabs open them as sheets
    let wasOpen = false;
    b.addEventListener("pointerdown", () => { wasOpen = Boolean(document.querySelector(t.key === "alerts" ? ".inbox-card" : ".acct-card")); });
    b.addEventListener("click", () => tabClick(t.key, wasOpen));
    bar.append(b);
  }
  $("view-chat").append(bar);
  // keep the Alerts badge in step with the bell's count
  const count = document.querySelector(".inbox-count");
  if (count) new MutationObserver(renderTabs).observe(count, { childList: true, characterData: true, subtree: true, attributes: true });
}
function tabClick(key, wasOpen) {
  if (key === "alerts" || key === "you") {
    if (wasOpen) return;   // a tap outside already closed it
    document.querySelector(key === "alerts" ? ".inbox-btn" : ".acct-btn")?.click();
    return;
  }
  document.querySelector(".inbox-card, .acct-card") && document.body.click();
  if (key === "home") { toList(); return; }
  const id = key === "messages" ? DM_CHANNEL : FRIENDS_CHANNEL;
  if (key === "messages") state.dmWith = null;
  if (state.screen === "channel" && state.channelId === id) { go(id, { force: true }); return; }
  if (state.screen === "list") go(id);
  else { try { history.replaceState({ cx: "ch", d: depth() }, "", "#" + (key === "messages" ? "messages" : "friends")); } catch { /* ignore */ } setScreen("channel"); selectChannel(id); }
}
function renderTabs() {
  const bar = $("cx-tabs");
  if (!bar) return;
  const ch = currentChannel();
  const active = state.screen === "list" ? "home" : ch?.kind === "dms" ? "messages" : ch?.kind === "friends" ? "friends" : "home";
  // the tabs show on the top screens; inside a channel or a conversation, the message box takes the bottom
  const top = state.screen === "list" || (ch?.kind === "friends") || (ch?.kind === "dms" && !String(state.view || "").startsWith("dm:"));
  $("view-chat").dataset.tabs = top ? "on" : "off";
  let mentions = 0;
  for (const c of state.counts.values()) mentions += c.mentions || 0;
  const anyUnread = [...state.counts.values()].some((c) => c.n) || [...state.unread].some((id) => id > 0);
  const inbox = Number(document.querySelector(".inbox-count")?.textContent) || 0;
  const badges = { home: mentions ? String(mentions > 99 ? "99+" : mentions) : anyUnread ? "•" : "", messages: state.unread.has(DM_CHANNEL) ? "•" : "", friends: "", alerts: inbox ? String(inbox > 99 ? "99+" : inbox) : "", you: "" };
  for (const b of bar.querySelectorAll(".cx-tab")) {
    const k = b.dataset.tab;
    b.setAttribute("aria-current", String(k === active));
    const badge = b.querySelector(".cx-tab-badge");
    badge.textContent = badges[k] === "•" ? "" : badges[k];
    badge.hidden = !badges[k];
    badge.classList.toggle("dot", badges[k] === "•");
  }
}

// phones get the app layout: full-screen channel list, bottom tabs, swipes
function applyLayout() {
  const app = matchMedia("(max-width: 760px)").matches;
  if (app === state.app && $("cx-tabs")) return;
  state.app = app;
  document.body.classList.toggle("cx-app", app);
  const back = $("open-channels");
  back.innerHTML = app ? icon("arrow") : icon("sidebar");   // fixed icons only
  back.classList.toggle("cx-back", app);
  back.setAttribute("aria-label", app ? "Back to channels" : "Channels");
  if (app) buildTabs();
  setScreen(app ? state.screen : "channel");
}

// swipes (phones): right = back to the channels, left = members; the channel follows your finger
function wireSwipes() {
  const root = $("view-chat");
  const main = root.querySelector(".chat-main");
  let t = null;
  const scrollsSideways = (node) => {
    for (let n = node; n && n !== root; n = n.parentElement) {
      if (n.matches?.("input, textarea, select, [data-noswipe], .emoji-menu, dialog")) return true;
      if (n.scrollWidth > n.clientWidth + 4) { const ox = getComputedStyle(n).overflowX; if (ox === "auto" || ox === "scroll") return true; }
    }
    return false;
  };
  root.addEventListener("touchstart", (e) => {
    if (!state.app || e.touches.length !== 1) { t = null; return; }
    const p = e.touches[0];
    t = { x: p.clientX, y: p.clientY, at: Date.now(), dir: null, blocked: scrollsSideways(e.target), dx: 0 };
  }, { passive: true });
  root.addEventListener("touchmove", (e) => {
    if (!t || t.blocked) return;
    const p = e.touches[0];
    const dx = p.clientX - t.x, dy = p.clientY - t.y;
    if (!t.dir) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      t.dir = Math.abs(dx) > Math.abs(dy) * 1.3 ? "x" : "y";
    }
    if (t.dir !== "x") return;
    t.dx = dx;
    const membersOpen = $("chat-members").classList.contains("open");
    if (state.screen === "channel" && !membersOpen && dx > 0) {
      main.style.transition = "none";
      main.style.transform = `translateX(${dx}px)`;
      root.style.setProperty("--cx-drag", String(Math.min(1, dx / root.clientWidth)));
    }
  }, { passive: true });
  root.addEventListener("touchend", () => {
    if (!t || t.blocked || t.dir !== "x") { t = null; return; }
    const { dx } = t;
    const fast = Math.abs(dx) / Math.max(1, Date.now() - t.at) > 0.45;
    const membersOpen = $("chat-members").classList.contains("open");
    main.style.transition = ""; main.style.transform = ""; root.style.removeProperty("--cx-drag");
    if (membersOpen) { if (dx > 50) closeDrawers(); }
    else if (state.screen === "channel" && dx > 0 && (dx > root.clientWidth * 0.33 || (fast && dx > 40))) toList();
    else if (state.screen === "channel" && dx < -60) openDrawer("chat-members");
    else if (state.screen === "list" && dx < -60 && state.channelId != null) go(state.channelId);
    t = null;
  });
}

// the quick switcher: jump to any channel or person (Ctrl+K / Cmd+K, or the search button above the channels)
let qs = null;
function quickSwitcher() {
  if (qs) return;
  const box = el("div", "qs");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Jump to a channel or person");
  const card = el("div", "qs-card");
  const input = el("input", "input qs-input");
  input.type = "search";
  input.placeholder = "Where to? Channels or people";
  input.setAttribute("aria-label", "Search channels and people");
  input.autocomplete = "off";
  const list = el("div", "qs-list");
  list.setAttribute("role", "listbox");
  card.append(input, list, el("p", "qs-hint", "↑ ↓ to choose · Enter to open · Esc to close"));
  box.append(card);
  let items = [], sel = 0;
  const close = (fromPop) => {
    if (!qs) return;
    box.remove(); qs = null;
    if (!fromPop && history.state?.cx === "sheet") history.back();
  };
  const choose = (it) => {
    close();
    setTimeout(() => {
      if (it.type === "channel") go(it.id);
      else openDM(it.id);
    }, 30);
  };
  const draw = () => {
    const q = input.value.trim().toLowerCase().replace(/^[#@]/, "");
    const chans = state.channels.filter((c) => !q || c.name.toLowerCase().includes(q) || c.slug.includes(q));
    const recent = recentChannels();
    let ch = q ? chans : [...recent.map((id) => chans.find((c) => c.id === id)).filter(Boolean), ...chans.filter((c) => state.counts.get(c.id)?.n && !recent.includes(c.id))];
    if (!q && !ch.length) ch = chans.slice(0, 8);
    const people = q ? [...state.members.values()].filter((m) => m.id !== state.me.id && !m.bot && m.username.toLowerCase().includes(q)).slice(0, 8) : [];
    items = [...ch.slice(0, 12).map((c) => ({ type: "channel", id: c.id, label: c.name, sub: state.categories.find((k) => k.id === c.categoryId)?.name || "", count: state.counts.get(c.id) })),
      ...people.map((m) => ({ type: "person", id: m.id, label: m.username, sub: state.online.has(m.id) ? "Online · Send a message" : "Send a message", head: m.head }))];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.replaceChildren(
      ...(!q && items.length ? [el("div", "qs-group", "Recent and unread")] : []),
      ...items.map((it, i) => {
        const row = el("button", `qs-row${i === sel ? " on" : ""}`);
        row.type = "button";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(i === sel));
        const ic = el("span", "qs-ic");
        if (it.type === "person") { const img = el("img", "qs-face"); img.alt = ""; img.src = it.head || faceSvg(it.label); ic.append(img); }
        else ic.textContent = "#";
        const text = el("span", "qs-text");
        text.append(el("b", "", it.label), el("small", "", it.sub));
        row.append(ic, text);
        if (it.count?.mentions) row.append(el("span", "ch-badge ch-at", String(it.count.mentions)));
        else if (it.count?.n) row.append(el("span", "ch-badge", String(it.count.n > 99 ? "99+" : it.count.n)));
        row.addEventListener("click", () => choose(it));
        return row;
      }),
      ...(items.length ? [] : [el("p", "qs-empty", "Nothing found.")]));
    list.querySelector(".qs-row.on")?.scrollIntoView({ block: "nearest" });
  };
  input.addEventListener("input", () => { sel = 0; draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[sel]) choose(items[sel]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  qs = { close };
  document.body.append(box);
  try { history.pushState({ cx: "sheet", d: depth() }, "", location.href); } catch { /* ignore */ }
  draw();
  input.focus();
}
// Back closes whatever is open on top (the switcher, the members list, the channel list drawer)
function closeOverlays() {
  if (qs) { qs.close(true); return true; }
  if ($("chat-members").classList.contains("open") || $("chat-side").classList.contains("open")) { closeDrawers(true); return true; }
  return false;
}

// ---------- Messages ----------
async function loadMessages(before) {
  const box = $("messages");
  const channelId = state.channelId;
  const data = await api(`/api/chat/channels/${channelId}/messages${before ? `?before=${before}` : ""}`);
  if (channelId !== state.channelId) return;
  if (!before) state.messages.clear();
  for (const m of data.messages) state.messages.set(m.id, m);
  state.hasMore = data.hasMore;
  const prevHeight = box.scrollHeight;
  const prevTop = box.scrollTop;
  renderMessages();
  if (before) box.scrollTop = box.scrollHeight - prevHeight + prevTop;
  else box.scrollTop = box.scrollHeight;
}

function sortedMessages() {
  return [...state.messages.values()].sort((a, b) => a.id - b.id);
}

function renderMessages() {
  const box = $("messages");
  box.replaceChildren();
  const ch = currentChannel();
  if (state.hasMore) {
    const more = el("button", "btn btn-ghost btn-sm load-older", "Load earlier messages");
    more.type = "button";
    more.addEventListener("click", () => {
      const first = sortedMessages()[0];
      if (first) loadMessages(first.id);
    });
    box.append(more);
  } else {
    const start = el("div", "messages-start");
    start.append(el("h2", "", `Welcome to #${ch.name}`), el("p", "", ch.topic || "This is the start of the channel."));
    box.append(start);
  }
  let prev = null;
  for (const m of sortedMessages()) {
    const d = new Date(m.createdAt);
    if (!prev || new Date(prev.createdAt).toDateString() !== d.toDateString()) {
      box.append(el("div", "day-divider", dayLabel(d)));
      prev = null;
    }
    box.append(renderMessage(m, prev));
    prev = m;
  }
  markSeen();
}

// ---------- Seen (others' messages on screen) and editing your own unseen messages ----------
// Tells the server which messages from others you've now seen: their authors can no longer edit them.
let seenTimer = null;
function markSeen() {
  clearTimeout(seenTimer);
  seenTimer = setTimeout(() => {
    if (document.visibilityState !== "visible" || !state.me || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.seenSent = state.seenSent || new Set();
    const ids = sortedMessages().filter((m) => !m.seen && m.author.id !== state.me.id && !state.seenSent.has(m.id)).map((m) => m.id).slice(-100);
    if (!ids.length) return;
    ids.forEach((id) => state.seenSent.add(id));
    state.ws.send(JSON.stringify({ type: "seen", ids }));
  }, 600);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") markSeen(); });

function rerenderMessage(id) {
  const m = state.messages.get(id);
  const row = document.querySelector(`.msg[data-id="${id}"]`);
  if (!m || !row) return;
  const list = sortedMessages();
  const i = list.findIndex((x) => x.id === id);
  const prev = i > 0 && new Date(list[i - 1].createdAt).toDateString() === new Date(m.createdAt).toDateString() ? list[i - 1] : null;
  row.replaceWith(renderMessage(m, prev));
}

const canEdit = (m) => state.me && m.author.id === state.me.id && !m.seen && currentChannel()?.canPost;

function startEdit(m) {
  const row = document.querySelector(`.msg[data-id="${m.id}"]`);
  const text = row?.querySelector(".msg-text");
  if (!row || !text || row.querySelector(".msg-edit")) return;
  const box = el("textarea", "input msg-edit-input");
  box.value = m.content;
  box.maxLength = state.maxLength || 500;
  box.rows = Math.min(8, m.content.split("\n").length + 1);
  const save = el("button", "btn btn-primary btn-sm", "Save");
  save.type = "button";
  const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
  cancel.type = "button";
  const hint = el("span", "text-3 small", "Enter to save · Esc to cancel");
  const wrap = el("div", "msg-edit");
  const bar = el("div", "msg-edit-bar");
  bar.append(save, cancel, hint);
  wrap.append(box, bar);
  text.hidden = true;
  text.after(wrap);
  const close = () => { wrap.remove(); text.hidden = false; };
  const commit = () => {
    const content = box.value.trim();
    if (!content) return;
    if (content === m.content) return close();
    send({ type: "edit", messageId: m.id, content, nonce: "edit-" + m.id });
    save.disabled = true;
    state.editing = { id: m.id, close };
  };
  save.addEventListener("click", commit);
  cancel.addEventListener("click", close);
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); commit(); }
    if (e.key === "Escape") { e.preventDefault(); close(); $("composer-input").focus(); }
  });
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
}

// Up arrow in an empty message box: edit your last message (if nobody has seen it yet), like Discord.
function editLastMessage() {
  const mine = sortedMessages().filter((m) => m.author.id === state.me?.id);
  const last = mine[mine.length - 1];
  if (last && canEdit(last)) { startEdit(last); return true; }
  return false;
}

// Discord-style formatting and @mentions (markdown.js); mentions open the member's profile.
function mdContext() {
  if (!state.mdMembers || state.mdMembersAt !== state.members.size) {
    state.mdMembers = [...state.members.values()].map((x) => ({ id: x.id, username: x.username }));
    state.mdMembersAt = state.members.size;
  }
  return {
    members: state.mdMembers, meName: state.me?.username,
    onMention: (member, node) => openProfile(state.members.get(member.id) || member, node),
    channels: state.channels, onChannel: (ch) => { selectChannel(ch.id); closeDrawers(); },
  };
}

// Message text with clickable links (only Admins can post links). Text goes in as text nodes, never HTML.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+[^\s<>".,!?:;)\]]/gi;
function linkify(box, text) {
  let last = 0;
  for (const m of String(text).matchAll(URL_RE)) {
    if (m.index > last) box.append(text.slice(last, m.index));
    const href = /^https?:\/\//i.test(m[0]) ? m[0] : `https://${m[0]}`;
    let ok = false;
    try { ok = ["http:", "https:"].includes(new URL(href).protocol); } catch { /* not a link */ }
    if (ok) {
      const a = el("a", "msg-link", m[0]);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow ugc";
      box.append(a);
    } else box.append(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) box.append(text.slice(last));
  return box;
}

function isGrouped(m, prev) {
  return prev && prev.author.id === m.author.id && prev.author.username === m.author.username && !m.bot && !prev.bot && !m.replyTo && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60_000;
}

function renderMessage(m, prev, opts = {}) {
  const grouped = !opts.thread && isGrouped(m, prev);
  const row = el("div", "msg" + (grouped ? " grouped" : ""));
  row.dataset.id = m.id;
  const author = state.members.get(m.author.id) || { id: m.author.id, username: m.author.username, role: m.author.role, rank: m.author.rank };
  let pic;
  if (m.bot) {  // GalaxySMP (Question of the Day, welcome cards, level-ups, posts from the owner)
    pic = el("img", "avatar head bot-avatar");
    pic.src = "/favicon.png";
    pic.alt = "";
    row.classList.add("bot-msg", `kind-${m.kind || "post"}`);
    if (m.author.id) {
      pic.classList.add("clickable");
      pic.addEventListener("click", (e) => { e.stopPropagation(); openProfile(author, pic); });
    }
  } else {
    pic = avatar(m.author.username, false, author);
    pic.classList.add("clickable");
    pic.addEventListener("click", (e) => { e.stopPropagation(); openProfile(author, pic); });
  }
  row.append(pic);
  if (grouped) {  // the time shows in the left gutter on hover, like Discord
    const gt = el("time", "gutter-time", timeFmt.format(new Date(m.createdAt)));
    gt.dateTime = m.createdAt;
    row.append(gt);
  }
  const me = state.me?.username;
  if (me && (new RegExp(`@${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(m.content) || (/@(everyone|here)\b/i.test(m.content) && roleOf(m.author.role).power >= 50) ||
    (m.replyTo && m.replyTo.username === me && m.author.username !== me))) row.classList.add("mention");

  const body = el("div", "msg-body");
  if (m.replyTo) {
    const r = el("div", "msg-reply");
    r.append(el("b", "", "@" + (m.replyTo.username || "unknown")), el("span", "", m.replyTo.content != null ? plainText(m.replyTo.content) : "Original message was deleted"));
    r.addEventListener("click", () => jumpTo(m.replyTo.id));
    body.append(r);
  }
  const head = el("div", "msg-head");
  // Like Discord: the name in the rank's color/gradient, then the rank's icon.
  const rank = rankFor(m.author.id, m.author.rank);
  const teamTag = state.members.get(m.author.id)?.team;
  if (teamTag) head.append(el("span", "team-tag", `[${teamTag}]`));  // always gray, so it never looks like a rank
  const name = el("span", "name clickable");
  name.append(paint(m.author.username, rank));
  name.addEventListener("click", (e) => { e.stopPropagation(); openProfile({ ...author, rank }, name); });
  head.append(name);
  const ri = roleIcon(rank);
  if (ri) head.append(ri);
  for (const hook of messageHeadHooks) hook(m, head);
  const t = el("time", "", timeFmt.format(new Date(m.createdAt)));
  t.dateTime = m.createdAt;
  t.title = new Date(m.createdAt).toLocaleString();
  head.append(t);
  if (m.pinned) {
    const pinTag = el("span", "msg-pinned");
    pinTag.innerHTML = icon("pushpin");
    pinTag.append("Pinned");
    head.append(pinTag);
  }
  const text = el("div", "msg-text");
  text.append(renderMarkdown(m.content, mdContext()));
  if (m.editedAt) {
    const ed = el("span", "msg-edited", "(edited)");
    ed.title = `Edited ${new Date(m.editedAt).toLocaleString()}`;
    text.append(ed);
  }
  body.append(head, text);
  for (const hook of messageBodyHooks) hook(m, body, text);
  if (opts.thread) { row.append(body); return row; }  // inside the thread panel: just the message
  body.append(renderReactions(m));
  row.append(body);

  const actions = el("div", "msg-actions");
  if (currentChannel()?.canPost) actions.append(actionBtn("reply", "Reply", () => startReply(m)));
  actions.append(actionBtn("smile", "Add reaction", (e) => openPicker(row, m, e)));
  if (canEdit(m)) actions.append(actionBtn("pencil", "Edit (until someone reads it)", () => startEdit(m)));
  for (const extra of messageActionHooks) extra(m, actions, actionBtn);
  row.append(actions);

  // On touch screens, tap a message to show its actions.
  row.addEventListener("click", (e) => {
    if (e.target.closest("button, .msg-reply")) return;
    const wasActive = row.classList.contains("active");
    document.querySelectorAll(".msg.active").forEach((x) => x.classList.remove("active"));
    if (!wasActive) row.classList.add("active");
  });
  return row;
}

// Channels for the "#" list (typing # in a message box).
export function channelChoices() {
  const cats = new Map((state.categories || []).map((c) => [c.id, c.name]));
  return (state.channels || []).filter((c) => c.kind !== "dms").map((c) => ({ slug: c.slug, name: c.name, category: cats.get(c.categoryId) || "" }));
}

// Stage D adds staff actions (report, delete) through this hook.
export const messageActionHooks = [];
export const messageHeadHooks = [];  // e.g. the chat level next to a name, the BOT tag
export const messageBodyHooks = [];  // e.g. polls draw themselves inside their message
export const composerHooks = [];     // e.g. the Poll button, when the channel changes

function actionBtn(name, label, onClick) {
  const b = el("button", "icon-btn" + (name === "trash" ? " danger" : ""));
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = icon(name);
  b.addEventListener("click", onClick);
  return b;
}

function renderReactions(m) {
  const wrap = el("div", "reactions");
  for (const r of m.reactions) {
    if (!r.users.length) continue;
    const b = el("button", "reaction" + (r.users.includes(state.me.id) ? " mine" : ""));
    b.type = "button";
    const custom = /^:([a-z0-9_]{2,24}):$/.exec(r.emoji);
    b.append(custom ? (emojiNode(custom[1]) || el("span", "", r.emoji)) : el("span", "", r.emoji), el("span", "", String(r.users.length)));
    b.title = r.users.map((id) => state.members.get(id)?.username || "someone").slice(0, 10).join(", ");
    b.addEventListener("click", () => send({ type: "react", messageId: m.id, emoji: r.emoji }));
    wrap.append(b);
  }
  return wrap;
}

function openPicker(row, m, e) {
  e.stopPropagation();
  document.querySelectorAll(".picker").forEach((p) => p.remove());
  const p = el("div", "picker");
  for (const emoji of state.reactions) {
    const b = el("button", "", emoji);
    b.type = "button";
    b.setAttribute("aria-label", "React " + emoji);
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      send({ type: "react", messageId: m.id, emoji });
      p.remove();
    });
    p.append(b);
  }
  for (const { name } of customEmoji()) {
    const b = el("button", "picker-custom");
    b.type = "button";
    b.setAttribute("aria-label", `React :${name}:`);
    b.append(emojiNode(name));
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      send({ type: "react", messageId: m.id, emoji: `:${name}:` });
      p.remove();
    });
    p.append(b);
  }
  row.append(p);
  setTimeout(() => document.addEventListener("click", () => p.remove(), { once: true }), 0);
}

// Open a channel at one message (from search or pins), loading the messages around it.
export async function openAt(channelId, id) {
  if (state.channelId !== channelId) await selectChannel(channelId);
  if (state.messages.has(id)) return jumpTo(id);
  const data = await api(`/api/chat/channels/${channelId}/messages?around=${id}`);
  if (state.channelId !== channelId) return;
  state.messages.clear();
  for (const m of data.messages) state.messages.set(m.id, m);
  state.hasMore = data.hasMore;
  renderMessages();
  $("jump-latest").hidden = !data.hasNewer;
  state.viewingOld = Boolean(data.hasNewer);
  requestAnimationFrame(() => jumpTo(id));
}

// A grid of the server's custom emoji; picking one types :name: into the box.
export function emojiMenu(anchor, input) {
  document.querySelectorAll(".emoji-menu").forEach((x) => x.remove());
  const list = customEmoji();
  const menu = el("div", "emoji-menu");
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Server emoji");
  if (!list.length) menu.append(el("p", "text-3 small", "No server emoji yet. Admins add them in the Control Panel."));
  for (const { name } of list) {
    const b = el("button", "");
    b.type = "button";
    b.title = `:${name}:`;
    b.setAttribute("aria-label", `:${name}:`);
    b.append(emojiNode(name));
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const at = input.selectionStart ?? input.value.length;
      const before = input.value.slice(0, at), after = input.value.slice(input.selectionEnd ?? at);
      const add = `${before && !/\s$/.test(before) ? " " : ""}:${name}: `;
      input.value = before + add + after;
      input.focus();
      input.selectionStart = input.selectionEnd = before.length + add.length;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      menu.remove();
    });
    menu.append(b);
  }
  (anchor.closest(".composer-wrap, .dm-chat") || document.body).append(menu);
  setTimeout(() => document.addEventListener("click", (ev) => { if (!menu.contains(ev.target)) menu.remove(); }, { once: true }), 0);
}

function messageRow(m, onOpen) {
  const ch = state.channels.find((c) => c.id === m.channelId);
  const b = h("button", { type: "button", class: "found-msg" },
    h("div", { class: "found-head" }, h("b", { text: m.author.username }),
      h("span", { class: "text-3 small", text: `${ch ? `#${ch.name} · ` : ""}${new Date(m.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` })),
    h("div", { class: "found-text", text: plainText(m.content).slice(0, 220) }));
  b.addEventListener("click", onOpen);
  return b;
}

function searchDialog() {
  const q = h("input", { class: "input", id: "search-q", type: "search", placeholder: "Search messages", autocomplete: "off", "aria-label": "Search messages" });
  const from = h("input", { class: "input", id: "search-from", placeholder: "From (optional)", autocomplete: "off", "aria-label": "From a member" });
  const here = h("input", { type: "checkbox", id: "search-here" });
  const ch = currentChannel();
  const list = h("div", { class: "found-list", role: "list" });
  const status = h("p", { class: "text-3 small", style: "margin:0" });
  let t = null, dlg = null;
  const run = async () => {
    if (q.value.trim().length < 2 && !from.value.trim()) { list.replaceChildren(); status.textContent = "Type at least 2 letters."; return; }
    status.textContent = "Searching…";
    const params = new URLSearchParams({ q: q.value.trim() });
    if (from.value.trim()) params.set("from", from.value.trim());
    if (here.checked && ch && ch.kind === "text") params.set("channel", ch.id);
    try {
      const d = await api(`/api/chat/search?${params}`);
      status.textContent = d.messages.length ? `${d.messages.length}${d.messages.length >= 30 ? "+" : ""} result${d.messages.length === 1 ? "" : "s"}` : "No messages found.";
      list.replaceChildren(...d.messages.map((m) => messageRow(m, () => { dlg?.close(); dlg?.remove(); openAt(m.channelId, m.id).catch((e) => toast(e.message)); })));
    } catch (e) { status.textContent = e.message; }
  };
  const later = () => { clearTimeout(t); t = setTimeout(run, 300); };
  [q, from].forEach((x) => x.addEventListener("input", later));
  here.addEventListener("change", run);
  const res = openDialog({
    title: "Search messages",
    body: h("div", { class: "form" }, h("div", { class: "search-row" }, q, from),
      ch && ch.kind === "text" ? h("label", { class: "check" }, here, `Only in #${ch.name}`) : null, status, list),
    actions: [{ label: "Close" }],
  });
  dlg = res?.dialog || document.querySelector("dialog.dialog:last-of-type");
  setTimeout(() => q.focus(), 50);
}

async function pinsDialog() {
  const ch = currentChannel();
  if (!ch || ch.kind !== "text") return toast("Pinned messages are in chat channels.");
  const list = h("div", { class: "found-list" }, h("p", { class: "text-3 small", text: "Loading…" }));
  const res = openDialog({ title: `Pinned in #${ch.name}`, body: list, actions: [{ label: "Close" }] });
  const dlg = res?.dialog || document.querySelector("dialog.dialog:last-of-type");
  try {
    const d = await api(`/api/chat/channels/${ch.id}/pins`);
    list.replaceChildren(...(d.messages.length ? d.messages.map((m) => messageRow(m, () => { dlg?.close(); dlg?.remove(); openAt(m.channelId, m.id).catch((e) => toast(e.message)); }))
      : [h("p", { class: "text-3", style: "margin:0", text: (state.me?.role?.power || 0) >= 50 ? "Nothing pinned yet. Pin a message from its menu." : "Nothing pinned yet." })]));
  } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); }
}

function jumpTo(id) {
  const row = document.querySelector(`.msg[data-id="${id}"]`);
  if (!row) return toast("That message is further back in the channel.");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.remove("flash");
  void row.offsetWidth;
  row.classList.add("flash");
}

function nearBottom() {
  const box = $("messages");
  return box.scrollHeight - box.scrollTop - box.clientHeight < 120;
}

function addMessage(m) {
  if (!state.members.has(m.author.id)) {
    state.members.set(m.author.id, { id: m.author.id, username: m.author.username, role: m.author.role });
    renderMembers();
  }
  if (m.channelId !== state.channelId || (state.app && state.screen === "list")) {
    if (m.author.id !== state.me.id) {
      const c = state.counts.get(m.channelId) || { n: 0, mentions: 0 };
      c.n += 1;
      if (isMention(m)) c.mentions += 1;
      state.counts.set(m.channelId, c);
      if (m.channelId !== state.channelId) { renderChannels(); return; }
      renderChannels();
    } else if (m.channelId !== state.channelId) return;
  } else markRead();
  const stick = nearBottom() || m.author.id === state.me.id;
  const list = sortedMessages();
  const last = list[list.length - 1];
  state.messages.set(m.id, m);
  if (!last || m.id > last.id) {
    // Append just this message, so open menus elsewhere aren't disturbed.
    const box = $("messages");
    const d = new Date(m.createdAt);
    const newDay = !last || new Date(last.createdAt).toDateString() !== d.toDateString();
    if (newDay) box.append(el("div", "day-divider", dayLabel(d)));
    box.append(renderMessage(m, newDay ? null : last));
  } else {
    renderMessages();
  }
  if (stick) $("messages").scrollTop = $("messages").scrollHeight;
  else $("jump-latest").hidden = false;
  markSeen();
}

export function removeMessage(id) {
  if (!state.messages.delete(id)) return;
  for (const m of state.messages.values()) {
    if (m.replyTo && m.replyTo.id === id) m.replyTo.content = null;
  }
  const top = $("messages").scrollTop;
  renderMessages();
  $("messages").scrollTop = top;
}

function updateReactions(messageId, reactions) {
  const m = state.messages.get(messageId);
  if (!m) return;
  m.reactions = reactions;
  const row = document.querySelector(`.msg[data-id="${messageId}"] .reactions`);
  if (row) row.replaceWith(renderReactions(m));
}

// ---------- Composer ----------
function note(text, info) {
  const n = $("composer-note");
  n.textContent = text;
  n.classList.toggle("info", Boolean(info));
  n.hidden = !text;
  clearTimeout(note.timer);
  if (text && !info) note.timer = setTimeout(() => (n.hidden = true), 6000);
}

function renderComposer() {
  const ch = currentChannel();
  const form = $("composer");
  const input = $("composer-input");
  const muted = state.me.mutedUntil && new Date(state.me.mutedUntil) > new Date();
  if (!ch.canPost) {
    form.hidden = true;
    note("Only staff can post in this channel. You can still react to messages.", true);
  } else if (muted) {
    form.hidden = true;
    note(`You are muted until ${new Date(state.me.mutedUntil).toLocaleString()}.`, true);
  } else {
    form.hidden = false;
    note("");
    input.placeholder = `Message #${ch.name}`;
  }
  for (const hook of composerHooks) hook(ch, !form.hidden);
}

function renderReplyBar() {
  $("reply-bar").hidden = !state.replyTo;
  if (state.replyTo) $("reply-name").textContent = state.replyTo.author.username;
}

function startReply(m) {
  state.replyTo = m;
  renderReplyBar();
  $("composer-input").focus();
}

function autosize() {
  const t = $("composer-input");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 160) + "px";
  const left = (state.maxLength || 500) - t.value.length;
  $("composer-count").textContent = left < 100 ? `${left} characters left` : "";
}

function submit() {
  const input = $("composer-input");
  const text = input.value.trim();
  const picture = state.pendingImage;  // a picture added with the picture button (already uploaded)
  if (!text && !picture && !state.pendingAudio) return;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    note("You're offline. Your message will be ready to send when you reconnect.");
    return;
  }
  const nonce = Math.random().toString(36).slice(2);
  state.pending.set(nonce, text);
  send({ type: "send", channelId: state.channelId, content: text, replyTo: state.replyTo?.id || null, nonce, imageId: picture?.id || null, audioId: state.pendingAudio?.id || null });
  state.pendingAudio = null;
  input.value = "";
  if (picture) { state.pendingImage = null; for (const hook of composerHooks) hook(currentChannel(), true); }
  state.replyTo = null;
  renderReplyBar();
  autosize();
}

// ---------- Members ----------
function renderMembers() {
  const playing = [...state.members.values()].filter((m) => m.inGame).length;
  const onSite = state.online?.size || 0;
  const so = document.getElementById("server-online");
  if (so) so.textContent = `${onSite} online${playing ? ` · ${playing} in game` : ""}`;
  const list = $("member-list");
  list.replaceChildren();
  const all = [...state.members.values()];
  const online = all.filter((m) => state.online.has(m.id));
  const offline = all.filter((m) => !state.online.has(m.id));
  // Online members grouped by rank (in the ranks' order), then everyone without a rank.
  const groups = new Map();
  for (const m of online) {
    // sorted by the Rank order: priority first (1 = top), then position (Galaxy+ / Pro+ tags are -1)
    const key = m.rank ? `${String(m.rank.priority ?? 100).padStart(3, "0")}:${String((m.rank.position ?? 0) + 1).padStart(6, "0")}:${m.rank.name}` : "~";
    if (!groups.has(key)) groups.set(key, { rank: m.rank, members: [] });
    groups.get(key).members.push(m);
  }
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key);
    const head = el("div", "member-group");
    if (g.rank) {  // a role header in the role's color, like Discord
      const label = el("span", "group-name", (g.rank.name || g.rank.prefix).toUpperCase());
      const css = rankCss(g.rank);
      if (css.startsWith("linear")) { label.classList.add("smooth"); label.style.backgroundImage = css; } else label.style.color = css;
      head.append(label, ` — ${g.members.length}`);
    } else head.textContent = `Players — ${g.members.length}`;
    list.append(head);
    for (const m of g.members) list.append(memberRow(m, true));
  }
  if (offline.length) {
    list.append(el("div", "member-group", `Offline — ${offline.length}`));
    for (const m of offline) list.append(memberRow(m, false));
  }
}

function memberRow(m, isOnline) {
  const row = el("div", "member" + (isOnline ? "" : " offline") + (m.inGame ? " in-game" : ""));
  const wrap = el("div", "av-wrap");
  wrap.append(avatar(m.username, true, m));
  const info = el("div", "member-info");
  const name = el("span", "name");
  name.append(paint(m.username, m.rank));
  const ri = roleIcon(m.rank);
  if (ri) name.append(ri);
  if (m.bot) name.append(botTag());
  info.append(name);
  if (m.status) info.append(el("span", "member-activity status", m.status));
  else if (m.inGame) info.append(el("span", "member-activity", "Playing GalaxySMP"));
  row.append(wrap, info);
  row.dataset.id = m.id;
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.addEventListener("click", () => openProfile(m, row));
  row.addEventListener("keydown", (e) => { if (e.key === "Enter") openProfile(m, row); });
  for (const hook of memberHooks) hook(m, row);
  return row;
}

// Stage D adds staff tools to member rows through this hook.
export const memberHooks = [];

// The BOT tag with a verified check, for the GalaxySMP account.
export function botTag() {
  const t = el("span", "bot-tag");
  t.title = "The official GalaxySMP account";
  t.innerHTML = icon("check");
  t.append("BOT");
  return t;
}

// ---------- "player1 is typing…" ----------
const typingSent = new Map();
// target: { channelId } or { dm: userId }. Sent at most every 3 seconds while typing.
export function sendTyping(target) {
  const key = target.dm != null ? `dm:${target.dm}` : `ch:${target.channelId}`;
  const now = Date.now();
  if (now - (typingSent.get(key) || 0) < 3000) return;
  typingSent.set(key, now);
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: "typing", ...target }));
}
export function typingText(names) {
  if (!names.length) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing…`;
  return "Several people are typing…";
}
function renderTyping() {
  const el = $("typing-line");
  if (!el) return;
  const now = Date.now();
  const here = state.typing.get(state.channelId);
  const names = [];
  if (here) for (const [id, t] of here) { if (t.until > now) names.push(t.name); else here.delete(id); }
  el.replaceChildren();
  if (names.length) {
    const dots = document.createElement("span");
    dots.className = "typing-dots";
    dots.setAttribute("aria-hidden", "true");
    dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
    const b = document.createElement("span");
    b.textContent = typingText(names);
    el.append(dots, b);
  }
  el.classList.toggle("on", names.length > 0);
}
setInterval(renderTyping, 1000);

// ---------- Live connection ----------
function send(data) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(data));
  else toast("You're offline. Reconnecting…");
}

function connect() {
  if (state.stopped) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/api/chat/connect`);
  state.ws = ws;

  ws.addEventListener("open", () => {
    const reconnecting = state.wsRetry > 0;
    state.wsRetry = 0;
    $("conn-state").hidden = true;
    clearInterval(state.pingTimer);
    state.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
    if (reconnecting) loadMessages().catch(() => {});
    reportView();
  });

  ws.addEventListener("message", (e) => {
    if (e.data === "pong") return;
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    handleEvent(data);
  });

  ws.addEventListener("close", (e) => {
    clearInterval(state.pingTimer);
    if (state.stopped) return;
    if (e.code === 4001) return;
    $("conn-state").hidden = false;
    const delay = Math.min(30_000, 1000 * 2 ** state.wsRetry++);
    setTimeout(async () => {
      // If the session ended (signed out elsewhere, banned), go back to sign-in.
      try {
        const res = await fetch("/api/me", { credentials: "same-origin" });
        const { user } = await res.json();
        if (!user) return signedOut("You've been signed out.");
      } catch { /* offline: just retry */ }
      connect();
    }, delay);
  });
}

function signedOut(message) {
  stopChat();
  if (message) toast(message);
  state.onSignedOut?.();
}

export const eventHooks = [];

function handleEvent(data) {
  switch (data.type) {
    case "hello":
      state.online = new Set(data.online);
      for (const mem of state.members?.values?.() || []) if (mem.bot) state.online.add(mem.id);  // GalaxySMP is always online
      renderMembers();
      break;
    case "presence":
      if (data.online) state.online.add(data.userId);
      else state.online.delete(data.userId);
      renderMembers();
      break;
    case "message":
      state.typing.get(data.message.channelId)?.delete(data.message.author.id);
      if (data.message.threadRoot) { for (const hook of eventHooks) hook({ type: "thread_message", message: data.message }, state); renderTyping(); break; }
      addMessage(data.message);
      renderTyping();
      break;
    case "typing":
      if (data.dm != null) { dmEvent(data); break; }
      if (!state.typing.has(data.channelId)) state.typing.set(data.channelId, new Map());
      state.typing.get(data.channelId).set(data.userId, { name: data.username, until: Date.now() + 6000 });
      renderTyping();
      break;
    case "sent":
      state.pending.delete(data.nonce);
      break;
    case "rejected":
    case "error": {
      if (String(data.nonce || "").startsWith("edit-")) { // a message edit didn't go through
        state.editing?.close();
        state.editing = null;
        note(`Not edited: ${data.message}`);
        break;
      }
      if (String(data.nonce || "").startsWith("th-")) { for (const hook of eventHooks) hook({ type: "thread_rejected", nonce: data.nonce, message: data.message }, state); break; }
      const text = state.pending.get(data.nonce);
      state.pending.delete(data.nonce);
      const input = $("composer-input");
      if (text && !input.value) {
        input.value = text;
        autosize();
      }
      note(`Not sent: ${data.message}`);
      break;
    }
    case "reactions":
      updateReactions(data.messageId, data.reactions);
      break;
    case "message_deleted":
      removeMessage(data.messageId);
      break;
    case "seen":
      for (const id of data.ids || []) {
        const m = state.messages.get(id);
        if (!m || m.seen) continue;
        m.seen = true;
        if (m.author.id === state.me?.id) {
          if (state.editing?.id === id) { state.editing.close(); state.editing = null; note("Someone just read your message, so it can't be edited any more."); }
          rerenderMessage(id); // the Edit button goes away
        }
      }
      break;
    case "message_updated":
      if (state.messages.has(data.message.id)) {
        state.messages.set(data.message.id, data.message);
        if (state.editing?.id === data.message.id) state.editing = null;
        rerenderMessage(data.message.id);
      }
      break;
    case "edited":
      state.editing = null;
      break;
    case "voice_invite":
      toast(`${data.from} invited you to the voice group "${data.group}". Open Voice Chat to join.`);
      break;
    case "dm_read":
    case "dm_edit":
      dmEvent(data);
      break;
    case "dm": {
      dmEvent(data);
      if (state.channelId !== DM_CHANNEL && Number(data.to) === Number(state.me?.id)) {
        state.unread.add(DM_CHANNEL);
        renderChannels();
      }
      break;
    }
    case "ticket": {
      ticketEvent(data);
      const support = state.channels?.find?.((c) => c.kind === "support");
      if (support && Number(data.ownerId) === Number(state.me?.id) && state.channelId !== support.id && data.status === "waiting") {
        state.unread.add(support.id);
        renderChannels();
      }
      break;
    }
    case "kicked":
      signedOut(data.reason || "You've been removed from the community.");
      break;
    default:
      for (const hook of eventHooks) hook(data, state);
  }
}

// ---------- Drawers (phones) ----------
function closeDrawers(fromPop) {
  const was = $("chat-side").classList.contains("open") || $("chat-members").classList.contains("open");
  $("chat-side").classList.remove("open");
  $("chat-members").classList.remove("open");
  $("drawer-scrim").classList.remove("open");
  if (was && !fromPop && history.state?.cx === "sheet") history.back();
}

function openDrawer(id) {
  const was = $("chat-side").classList.contains("open") || $("chat-members").classList.contains("open");
  $("chat-side").classList.remove("open");
  $("chat-members").classList.remove("open");
  $(id).classList.add("open");
  $("drawer-scrim").classList.add("open");
  // on phones and tablets Back closes it
  if (!was && matchMedia("(max-width: 1100px)").matches) { try { history.pushState({ cx: "sheet", d: depth() }, "", location.href); } catch { /* ignore */ } }
}

let wired = false;
function wireUi() {
  if (wired) return;
  wired = true;
  $("open-channels").addEventListener("click", () => (state.app ? toList() : openDrawer("chat-side")));
  // the quick switcher: a search button above the channels, and Ctrl+K / Cmd+K
  const find = el("button", "qs-open");
  find.type = "button";
  find.innerHTML = icon("search");   // fixed icon only
  find.append(el("span", "", "Find a channel or person"), el("kbd", "", /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"));
  find.addEventListener("click", () => { closeDrawers(); quickSwitcher(); });
  $("chat-side").insertBefore(find, $("channel-list"));
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !$("view-chat").hidden) { e.preventDefault(); qs ? qs.close() : quickSwitcher(); }
  });
  window.addEventListener("popstate", onPop);
  matchMedia("(max-width: 760px)").addEventListener("change", applyLayout);
  wireSwipes();
  $("open-members").addEventListener("click", () => openDrawer("chat-members"));
  $("drawer-scrim").addEventListener("click", closeDrawers);
  $("reply-cancel").addEventListener("click", () => {
    state.replyTo = null;
    renderReplyBar();
  });
  const input = $("composer-input");
  input.addEventListener("input", autosize);
  input.addEventListener("input", () => { if (input.value.trim() && state.channelId) sendTyping({ channelId: state.channelId }); });
  setupMentions(input, () => [...state.members.values()].filter((m) => m.id !== state.me?.id).map((m) => ({ id: m.id, username: m.username, head: m.head, online: state.online.has(m.id) })),
    () => (state.me?.role?.power || 0) >= 50);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !matchMedia("(pointer: coarse)").matches) {
      e.preventDefault();
      submit();
    }
    if (e.key === "ArrowUp" && !input.value && editLastMessage()) {
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && state.replyTo) {
      state.replyTo = null;
      renderReplyBar();
    }
  });
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  $("messages").addEventListener("scroll", () => {
    if (nearBottom() && !state.viewingOld) $("jump-latest").hidden = true;
  });
  $("jump-latest").addEventListener("click", () => {
    $("jump-latest").hidden = true;
    if (state.viewingOld) { state.viewingOld = false; loadMessages(); return; }  // was looking at an older part of the channel
    $("messages").scrollTop = $("messages").scrollHeight;
  });
  $("open-search").addEventListener("click", searchDialog);
  $("composer-emoji").addEventListener("click", (e) => emojiMenu(e.currentTarget, $("composer-input")));
  attachChannelSuggest($("composer-input"), channelChoices);
  $("open-pins").addEventListener("click", pinsDialog);
}

// ---------- Start / stop ----------
export async function startChat({ onSignedOut }) {
  state.stopped = false;
  state.onSignedOut = onSignedOut;
  let data;
  try {
    data = await api("/api/chat/bootstrap");
  } catch (e) {
    if (e.signedOut) return signedOut();
    throw e;
  }
  if (data.onboarding) { location.replace("/welcome"); return; } // finish the welcome steps first
  state.me = data.me;
  state.channels = data.channels;
  if (data.ticketUnread) {
    const support = data.channels.find((c) => c.kind === "support");
    if (support) state.unread.add(support.id);
  }
  // Direct messages show as a channel at the top of the list (its own view, like Support).
  data.channels.unshift({ id: DM_CHANNEL, categoryId: DM_CHANNEL, slug: "messages", name: "Direct Messages", topic: "Private chats with other members (also in game with /dm)", kind: "dms", canPost: false },
    { id: FRIENDS_CHANNEL, categoryId: DM_CHANNEL, slug: "friends", name: "Friends", topic: "Your friends, your team and who's in game", kind: "friends", canPost: false });
  state.categories = [{ id: DM_CHANNEL, name: "Messages" }, ...data.categories];
  if (data.dmUnread) state.unread.add(DM_CHANNEL);
  state.counts = new Map(Object.entries(data.unread || {}).map(([k, v]) => [Number(k), v]));
  state.readUpTo = new Map();
  state.reactions = data.reactions;
  state.maxLength = data.maxLength || 500;  // staff can write longer messages
  $("composer-input").maxLength = state.maxLength;
  try { setCustomEmoji((await api("/api/emoji")).emoji); } catch { /* no custom emoji */ }
  state.roles = new Map(data.roles.map((r) => [r.key, r]));
  state.members = new Map(data.members.map((m) => [m.id, m]));

  const myRank = state.members.get(state.me.id)?.rank || null;
  const meMember = state.members.get(state.me.id);
  $("me-avatar").replaceWith(Object.assign(avatar(state.me.username, true, meMember), { id: "me-avatar" }));
  $("me-avatar").classList.add("clickable");
  $("me-avatar").addEventListener("click", (e) => { e.stopPropagation(); openProfile(meMember, $("me-avatar")); });
  $("me-name").replaceChildren(paint(state.me.username, myRank));
  $("me-role").replaceChildren(myRank ? rankTag(myRank) : document.createTextNode("No rank"));

  wireUi();
  renderMembers();
  // Links like /community#suggestions switch channels, even while the page is open.
  window.addEventListener("hashchange", () => {
    if (Date.now() - (state.popAt || 0) < 400) return;      // Back/Forward: already handled
    const [slug, sub] = location.hash.slice(1).split("/");  // e.g. #streams/12 opens stream 12
    const ch = state.channels.find((c) => c.slug === slug);
    if (ch && (ch.id !== state.channelId || sub || state.screen !== "channel")) { state.sub = sub || null; setScreen("channel"); selectChannel(ch.id); }
  });
  const wanted = location.hash.slice(1);
  // Phones open on the channel list (like an app). A link to a channel opens it, with the list one Back away.
  const phone = matchMedia("(max-width: 760px)").matches;
  try {
    if (phone) {
      history.replaceState({ cx: "list", d: 0 }, "", location.pathname);
      if (wanted) history.pushState({ cx: "ch", d: 1 }, "", "#" + wanted);
    } else history.replaceState({ cx: "ch", d: 0 }, "", location.href);
  } catch { /* ignore */ }
  state.screen = phone && !wanted ? "list" : "channel";
  applyLayout();
  const dmWith = /^dm-(\d+)$/.exec(wanted);
  if (dmWith && state.members.has(Number(dmWith[1]))) {
    state.dmWith = Number(dmWith[1]); // "Message" on a full profile
    await selectChannel(DM_CHANNEL);
  } else {
    const [slug, sub] = wanted.split("/");
    state.sub = sub || null;
    const first = state.channels.find((c) => c.slug === slug) || state.channels.find((c) => c.slug === "chat") || state.channels[0];
    await selectChannel(first.id);
  }
  connect();
  return state;
}

export function stopChat() {
  state.stopped = true;
  clearInterval(state.pingTimer);
  try { state.ws?.close(1000, "bye"); } catch { /* ignore */ }
  state.ws = null;
}

// Opens the Direct Messages view on a conversation with this member.
export function openDM(userId) {
  state.dmWith = userId;
  closeDrawers();
  go(DM_CHANNEL, { force: true });
}

export { openProfile };
export { send as chatSend, renderMessage, rerenderMessage, currentChannel, state as chatState, api as chatApi, note as chatNote, renderMembers, renderMessages, renderComposer, roleOf };
