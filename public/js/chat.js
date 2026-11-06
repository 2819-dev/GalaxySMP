// GalaxySMP community chat (browser side).
// All text is inserted with textContent, never as HTML, so nothing a user types can run as code.
import { icon, toast } from "/js/site.js";

const $ = (id) => document.getElementById(id);

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

function avatar(name, small) {
  const a = el("div", "avatar" + (small ? " sm" : ""), (name.replace(/^[^A-Za-z0-9]+/, "")[0] || "?").toUpperCase());
  a.style.background = `hsl(${hueOf(name)} 45% 42%)`;
  a.setAttribute("aria-hidden", "true");
  return a;
}

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
    list.append(el("div", "channel-cat", cat.name));
    for (const ch of state.channels.filter((c) => c.categoryId === cat.id)) {
      const b = el("button", "channel");
      b.type = "button";
      b.dataset.id = ch.id;
      if (ch.id === state.channelId) b.setAttribute("aria-current", "true");
      if (state.unread.has(ch.id)) b.classList.add("unread");
      b.append(el("span", "hash", "#"), el("span", "", ch.name));
      if (!ch.canPost) {
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
  try { history.replaceState(null, "", "#" + ch.slug); } catch { /* ignore */ }
  renderChannels();
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
  const row = el("div", "msg" + (isGrouped(m, prev) ? " grouped" : ""));
  row.dataset.id = m.id;
  row.append(avatar(m.author.username));

  const body = el("div", "msg-body");
  if (m.replyTo) {
    const r = el("div", "msg-reply");
    r.append(el("b", "", "@" + (m.replyTo.username || "unknown")), el("span", "", m.replyTo.content ?? "Original message was deleted"));
    r.addEventListener("click", () => jumpTo(m.replyTo.id));
    body.append(r);
  }
  const head = el("div", "msg-head");
  const role = roleOf(m.author.role);
  const name = el("span", "name", m.author.username);
  name.style.color = m.author.color || role.color;
  head.append(name);
  if (role.power >= 20) {
    const tag = el("span", "role-tag", role.name);
    tag.style.color = role.color;
    head.append(tag);
  }
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
  const list = $("member-list");
  list.replaceChildren();
  const all = [...state.members.values()];
  const online = all.filter((m) => state.online.has(m.id));
  const offline = all.filter((m) => !state.online.has(m.id));
  const roles = [...state.roles.values()].sort((a, b) => b.power - a.power);
  for (const role of roles) {
    const group = online.filter((m) => m.role === role.key);
    if (!group.length) continue;
    list.append(el("div", "member-group", `${role.name} — ${group.length}`));
    for (const m of group) list.append(memberRow(m, role, true));
  }
  if (offline.length) {
    list.append(el("div", "member-group", `Offline — ${offline.length}`));
    for (const m of offline) list.append(memberRow(m, roleOf(m.role), false));
  }
}

function memberRow(m, role, isOnline) {
  const row = el("div", "member" + (isOnline ? "" : " offline"));
  const wrap = el("div", "av-wrap");
  wrap.append(avatar(m.username, true));
  const name = el("span", "name", m.username);
  name.style.color = role.color;
  row.append(wrap, name);
  row.dataset.id = m.id;
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
  state.categories = data.categories;
  state.reactions = data.reactions;
  state.roles = new Map(data.roles.map((r) => [r.key, r]));
  state.members = new Map(data.members.map((m) => [m.id, m]));

  const role = roleOf(state.me.role.key);
  $("me-avatar").replaceWith(Object.assign(avatar(state.me.username, true), { id: "me-avatar" }));
  $("me-name").textContent = state.me.username;
  $("me-role").textContent = role.name;
  $("me-role").style.color = role.color;

  wireUi();
  renderMembers();
  const wanted = location.hash.slice(1);
  const first = state.channels.find((c) => c.slug === wanted) || state.channels.find((c) => c.slug === "general") || state.channels[0];
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

export { state as chatState, api as chatApi, note as chatNote, renderMembers, renderMessages, renderComposer, roleOf };
