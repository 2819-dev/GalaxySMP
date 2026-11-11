// GalaxySMP community chat (browser side).
// All text is inserted with textContent, never as HTML, so nothing a user types can run as code.
import { activityBlock } from "/js/activity.js";
import { icon, toast } from "/js/site.js";
import { paint, rankTag, roleIcon, rankCss } from "/js/rank-paint.js";
import { showPanel, hidePanel, dmEvent } from "/js/community-panels.js";
import { ticketEvent } from "/js/tickets.js";
import { renderMarkdown, plainText } from "/js/markdown.js";
import { setupMentions } from "/js/mentions.js";
import { faceSvg } from "/js/face.js";

// A member's current rank (live updates win over what an older message recorded).
const rankFor = (id, fallback) => (state.members.has(id) ? state.members.get(id).rank : fallback) || null;

const $ = (id) => document.getElementById(id);
export const DM_CHANNEL = -1;
const DM_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
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
  banner.style.background = member.color ? `linear-gradient(120deg, ${member.color}, ${member.color}88)` : rankCss(rank) || "linear-gradient(90deg, #4FEBFD, #3DAAF4, #2149DD)";
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
  body.append(name, user, status);
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
  if (state.me && member.id !== state.me.id) {
    const dm = el("button", "btn btn-primary btn-sm", "Message");
    dm.type = "button";
    dm.addEventListener("click", () => { closeProfile(); openDM(member.id); });
    actions.prepend(dm);
  }
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
      else if (ch.kind === "dms") mark.innerHTML = DM_SVG;
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

// ---------- What's on screen (so you aren't notified about a chat you're already looking at) ----------
function setView(view) {
  state.view = view || null;
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
  state.unread.delete(id);
  state.replyTo = null;
  renderReplyBar();
  const ch = currentChannel();
  $("channel-name").textContent = ch.name;
  $("channel-topic").textContent = ch.topic || "";
  document.querySelector(".chat-top .hash").textContent = ["voice", "support", "dms"].includes(ch.kind) ? "" : "#";
  try { history.replaceState(null, "", "#" + ch.slug); } catch { /* ignore */ }
  renderChannels();
  // Special channels (Information, Auction House, Suggestions, Voice Chat, Events) have their own views.
  const special = ch.kind && ch.kind !== "text";
  $("messages").hidden = special;
  document.querySelector(".composer-wrap").hidden = special;
  $("jump-latest").hidden = true;
  setView(ch.kind === "dms" ? (state.dmWith ? `dm:${state.dmWith}` : "dms") : ch.slug);
  if (special) {
    showPanel(ch, { me: state.me, toast, dmWith: state.dmWith, members: state.members, setView });
    state.dmWith = null;
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
  const text = el("div", "msg-text");
  text.append(renderMarkdown(m.content, mdContext()));
  if (m.editedAt) {
    const ed = el("span", "msg-edited", "(edited)");
    ed.title = `Edited ${new Date(m.editedAt).toLocaleString()}`;
    text.append(ed);
  }
  body.append(head, text);
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
      if (String(data.nonce || "").startsWith("edit-")) { // a message edit didn't go through
        state.editing?.close();
        state.editing = null;
        note(`Not edited: ${data.message}`);
        break;
      }
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
  if (data.onboarding) { location.replace("/welcome"); return; } // finish the welcome steps first
  state.me = data.me;
  state.channels = data.channels;
  if (data.ticketUnread) {
    const support = data.channels.find((c) => c.kind === "support");
    if (support) state.unread.add(support.id);
  }
  // Direct messages show as a channel at the top of the list (its own view, like Support).
  data.channels.unshift({ id: DM_CHANNEL, categoryId: DM_CHANNEL, slug: "messages", name: "Direct Messages", topic: "Private chats with other members (also in game with /dm)", kind: "dms", canPost: false });
  state.categories = [{ id: DM_CHANNEL, name: "Messages" }, ...data.categories];
  if (data.dmUnread) state.unread.add(DM_CHANNEL);
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

// Opens the Direct Messages view on a conversation with this member.
export function openDM(userId) {
  state.dmWith = userId;
  selectChannel(DM_CHANNEL);
  closeDrawers();
}

export { openProfile };
export { state as chatState, api as chatApi, note as chatNote, renderMembers, renderMessages, renderComposer, roleOf };
