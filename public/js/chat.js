// GalaxySMP community chat (browser side).
// All text is inserted with textContent, never as HTML, so nothing a user types can run as code.
import { icon, toast } from "/js/site.js";
import { paint, rankTag, roleIcon, rankCss } from "/js/rank-paint.js";
import { showPanel, hidePanel } from "/js/community-panels.js";
import { ticketEvent } from "/js/tickets.js";

// A member's current rank (live updates win over what an older message recorded).
const rankFor = (id, fallback) => (state.members.has(id) ? state.members.get(id).rank : fallback) || null;

const $ = (id) => document.getElementById(id);
const HELP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/></svg>';
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
  messages: new Map(), // id -> message (current channel only)
  hasMore: false,
  replyTo: null,
  unread: new Set(),
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
const SKIN = ["#f2c49b", "#e0a679", "#c68857", "#a36a3f", "#7a4a2a", "#5a3620"];
const HAIR = ["#2b1a10", "#4a2e19", "#7a4b23", "#c58b3a", "#e8c66a", "#1d1d1d", "#8a3a2a", "#c7c7c7", "#3b5bd6", "#b04cd6"];
const EYES = ["#2f6fe0", "#3a8f3a", "#5a3a20", "#2b2b2b", "#7a3ad6", "#1f9e9e"];
function faceSvg(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pick = (arr, k) => arr[(h >>> k) % arr.length];
  const skin = pick(SKIN, 0), hair = pick(HAIR, 4), eyes = pick(EYES, 9), long = (h >>> 13) & 1;
  const px = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let c = skin;
    if (y < 2 || (y === 2 && (x === 0 || x === 7)) || (long && y < 6 && (x === 0 || x === 7))) c = hair;
    if (y === 4 && (x === 1 || x === 5)) c = "#ffffff";
    if (y === 4 && (x === 2 || x === 6)) c = eyes;
    if (y === 6 && (x === 3 || x === 4)) c = "#8a4a3a";
    px.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`);
  }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">${px.join("")}</svg>`)}`;
}
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
  banner.style.background = rankCss(rank) || "linear-gradient(90deg, #4FEBFD, #3DAAF4, #2149DD)";
  const pic = el("div", "pc-avatar" + (online ? " online" : ""));
  const big = avatar(member.username, false, member);
  pic.append(big);
  const name = el("div", "pc-name");
  name.append(paint(member.username, rank));
  const ri = roleIcon(rank);
  if (ri) name.append(ri);
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
  if (member.plan) roles.append(chip(PLAN_NAMES[member.plan] || member.plan, member.plan === "pro" ? "linear-gradient(90deg,#FF8AF2,#8A3CFF,#4F56FF)" : "linear-gradient(90deg,#7CFF8A,#4DB8FF,#9A6BFF)"));
  // Staff powers (Moderator / Admin) are only permissions: they're never shown, only the rank is.
  if (!roles.childNodes.length) roles.append(el("span", "text-3 small", "No roles yet"));
  const body = el("div", "pc-body");
  body.append(name, el("div", "pc-user", member.username), status, el("div", "pc-label", "Roles"), roles);
  if (member.since) {
    body.append(el("div", "pc-label", "Member since"), el("div", "pc-since", new Date(member.since).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })));
  }
  const actions = el("div", "pc-actions");
  const view = el("a", "btn btn-secondary btn-sm", "View full profile");
  view.href = `/player/${encodeURIComponent(member.username)}`;
  actions.append(view);
  for (const hook of profileActionHooks) hook(member, actions, closeProfile);
  body.append(actions);
  card.append(banner, pic, body);
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
  setTimeout(() => document.addEventListener("click", function off(e) {
    if (!card.contains(e.target)) { closeProfile(); document.removeEventListener("click", off); }
  }), 0);
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
      if (state.unread.has(ch.id)) b.classList.add("unread");
      const mark = el("span", "hash");
      if (ch.kind === "voice") mark.innerHTML = MIC_SVG;
      else if (ch.kind === "support") mark.innerHTML = HELP_SVG;
      else mark.textContent = "#";
      b.append(mark, el("span", "", ch.name));
      if (!ch.canPost && ch.kind === "text") {
        const ro = el("span", "ro");
        ro.innerHTML = icon("megaphone");
        ro.title = "Staff only";
        b.append(ro);
      }
      b.addEventListener("click", () => {
        selectChannel(ch.id);
        closeDrawers();
      });
      list.append(b);
    }
  }
}

async function selectChannel(id) {
  state.channelId = id;
  state.unread.delete(id);
  state.replyTo = null;
  renderReplyBar();
  const ch = currentChannel();
  $("channel-name").textContent = ch.name;
  $("channel-topic").textContent = ch.topic || "";
  document.querySelector(".chat-top .hash").textContent = ch.kind === "voice" || ch.kind === "support" ? "" : "#";
  try { history.replaceState(null, "", "#" + ch.slug); } catch { /* ignore */ }
  renderChannels();
  // Special channels (Information, Auction House, Suggestions, Voice Chat, Events) have their own views.
  const special = ch.kind && ch.kind !== "text";
  $("messages").hidden = special;
  document.querySelector(".composer-wrap").hidden = special;
  $("jump-latest").hidden = true;
  if (special) {
    showPanel(ch, { me: state.me, toast });
    return;
  }
  hidePanel();
  renderComposer();
  await loadMessages();
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
}

function isGrouped(m, prev) {
  return prev && prev.author.id === m.author.id && !m.replyTo && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60_000;
}

function renderMessage(m, prev) {
  const grouped = isGrouped(m, prev);
  const row = el("div", "msg" + (grouped ? " grouped" : ""));
  row.dataset.id = m.id;
  const author = state.members.get(m.author.id) || { id: m.author.id, username: m.author.username, role: m.author.role, rank: m.author.rank };
  const pic = avatar(m.author.username, false, author);
  pic.classList.add("clickable");
  pic.addEventListener("click", (e) => { e.stopPropagation(); openProfile(author, pic); });
  row.append(pic);
  if (grouped) {  // the time shows in the left gutter on hover, like Discord
    const gt = el("time", "gutter-time", timeFmt.format(new Date(m.createdAt)));
    gt.dateTime = m.createdAt;
    row.append(gt);
  }
  const me = state.me?.username;
  if (me && new RegExp(`@${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(m.content)) row.classList.add("mention");

  const body = el("div", "msg-body");
  if (m.replyTo) {
    const r = el("div", "msg-reply");
    r.append(el("b", "", "@" + (m.replyTo.username || "unknown")), el("span", "", m.replyTo.content ?? "Original message was deleted"));
    r.addEventListener("click", () => jumpTo(m.replyTo.id));
    body.append(r);
  }
  const head = el("div", "msg-head");
  // Like Discord: the name in the rank's color/gradient, then the rank's icon.
  const rank = rankFor(m.author.id, m.author.rank);
  const name = el("span", "name clickable");
  name.append(paint(m.author.username, rank));
  name.addEventListener("click", (e) => { e.stopPropagation(); openProfile({ ...author, rank }, name); });
  head.append(name);
  const ri = roleIcon(rank);
  if (ri) head.append(ri);
  const t = el("time", "", timeFmt.format(new Date(m.createdAt)));
  t.dateTime = m.createdAt;
  t.title = new Date(m.createdAt).toLocaleString();
  head.append(t);
  body.append(head, el("div", "msg-text", m.content));
  body.append(renderReactions(m));
  row.append(body);

  const actions = el("div", "msg-actions");
  if (currentChannel()?.canPost) actions.append(actionBtn("reply", "Reply", () => startReply(m)));
  actions.append(actionBtn("smile", "Add reaction", (e) => openPicker(row, m, e)));
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

// Stage D adds staff actions (report, delete) through this hook.
export const messageActionHooks = [];

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
    b.append(el("span", "", r.emoji), el("span", "", String(r.users.length)));
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
  row.append(p);
  setTimeout(() => document.addEventListener("click", () => p.remove(), { once: true }), 0);
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
  if (m.channelId !== state.channelId) {
    if (m.author.id !== state.me.id) {
      state.unread.add(m.channelId);
      renderChannels();
    }
    return;
  }
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
  const left = 500 - t.value.length;
  $("composer-count").textContent = left < 100 ? `${left} characters left` : "";
}

function submit() {
  const input = $("composer-input");
  const text = input.value.trim();
  if (!text) return;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    note("You're offline. Your message will be ready to send when you reconnect.");
    return;
  }
  const nonce = Math.random().toString(36).slice(2);
  state.pending.set(nonce, text);
  send({ type: "send", channelId: state.channelId, content: text, replyTo: state.replyTo?.id || null, nonce });
  input.value = "";
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
    const key = m.rank ? `${String(m.rank.position).padStart(6, "0")}:${m.rank.name}` : "~";
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
  info.append(name);
  if (m.inGame) info.append(el("span", "member-activity", "Playing GalaxySMP"));
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
      renderMembers();
      break;
    case "presence":
      if (data.online) state.online.add(data.userId);
      else state.online.delete(data.userId);
      renderMembers();
      break;
    case "message":
      addMessage(data.message);
      break;
    case "sent":
      state.pending.delete(data.nonce);
      break;
    case "rejected":
    case "error": {
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
function closeDrawers() {
  $("chat-side").classList.remove("open");
  $("chat-members").classList.remove("open");
  $("drawer-scrim").classList.remove("open");
}

function openDrawer(id) {
  closeDrawers();
  $(id).classList.add("open");
  $("drawer-scrim").classList.add("open");
}

let wired = false;
function wireUi() {
  if (wired) return;
  wired = true;
  $("open-channels").addEventListener("click", () => openDrawer("chat-side"));
  $("open-members").addEventListener("click", () => openDrawer("chat-members"));
  $("drawer-scrim").addEventListener("click", closeDrawers);
  $("reply-cancel").addEventListener("click", () => {
    state.replyTo = null;
    renderReplyBar();
  });
  const input = $("composer-input");
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !matchMedia("(pointer: coarse)").matches) {
      e.preventDefault();
      submit();
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
    if (nearBottom()) $("jump-latest").hidden = true;
  });
  $("jump-latest").addEventListener("click", () => {
    $("messages").scrollTop = $("messages").scrollHeight;
    $("jump-latest").hidden = true;
  });
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
  state.me = data.me;
  state.channels = data.channels;
  if (data.ticketUnread) {
    const support = data.channels.find((c) => c.kind === "support");
    if (support) state.unread.add(support.id);
  }
  state.categories = data.categories;
  state.reactions = data.reactions;
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
    const ch = state.channels.find((c) => c.slug === location.hash.slice(1));
    if (ch && ch.id !== state.channelId) selectChannel(ch.id);
  });
  const wanted = location.hash.slice(1);
  const first = state.channels.find((c) => c.slug === wanted) || state.channels.find((c) => c.slug === "chat") || state.channels[0];
  await selectChannel(first.id);
  connect();
  return state;
}

export function stopChat() {
  state.stopped = true;
  clearInterval(state.pingTimer);
  try { state.ws?.close(1000, "bye"); } catch { /* ignore */ }
  state.ws = null;
}

export { openProfile };
export { state as chatState, api as chatApi, note as chatNote, renderMembers, renderMessages, renderComposer, roleOf };
