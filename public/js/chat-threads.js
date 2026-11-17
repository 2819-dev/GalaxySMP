// Threads: "Reply in thread" on any message opens a side panel with the replies, so side conversations don't
// fill up the channel. The original message shows how many replies it has; tap that to open the thread.
// Also slow mode: staff who can delete messages set it from the clock button at the top of a channel.
import { toast, iconEl } from "/js/site.js";
import { h, getJson, postJson, openDialog } from "/js/dialog.js";
import {
  chatState as state, chatSend, renderMessage, rerenderMessage, currentChannel, openAt,
  messageActionHooks, messageBodyHooks, composerHooks, eventHooks,
} from "/js/chat.js";

const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
};

let panel = null;      // { rootId, channelId, el, list, input, replies: Map }
const pending = new Map();

// ---------- the button and the reply count ----------
messageActionHooks.push((m, actions, actionBtn) => {
  if (m.threadRoot || !currentChannel()?.canPost) return;
  actions.append(actionBtn("chat", "Reply in thread", () => openThread(m.id)));
});

messageBodyHooks.push((m, body) => {
  if (!m.thread?.count) return;
  body.append(h("button", { class: "thread-chip", type: "button", onclick: (e) => { e.stopPropagation(); openThread(m.id); } },
    iconEl("chat"), h("b", { text: `${m.thread.count} ${m.thread.count === 1 ? "reply" : "replies"}` }),
    m.thread.lastAt ? h("span", { text: `Last reply ${ago(m.thread.lastAt)}` }) : null));
});

// ---------- the side panel ----------
export async function openThread(rootId) {
  let d;
  try { d = await getJson(`/api/chat/threads/${rootId}`); } catch (e) { toast(e.message); return; }
  closeThread();
  const list = h("div", { class: "thread-list", "aria-live": "polite" });
  const input = h("textarea", { class: "thread-input", rows: 1, maxlength: state.maxLength || 500, placeholder: "Reply in thread", "aria-label": "Reply in thread" });
  const form = h("form", { class: "thread-form" }, input, h("button", { class: "btn btn-primary send", type: "submit", "aria-label": "Send" }, iconEl("send")));
  const canPost = state.channels.find((c) => c.id === d.channelId)?.canPost;
  const el = h("aside", { class: "thread-panel", role: "dialog", "aria-label": "Thread" },
    h("header", { class: "thread-head" },
      h("div", {}, h("b", { text: "Thread" }), h("span", { class: "text-3 small", text: `#${state.channels.find((c) => c.id === d.channelId)?.name || ""}` })),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Close thread", onclick: closeThread }, iconEl("close"))),
    h("div", { class: "thread-scroll" },
      h("div", { class: "thread-root" }, renderMessage(d.root, null, { thread: true })),
      h("div", { class: "thread-divider" }, h("span", { class: "thread-count", text: countText(d.replies.length) })),
      list),
    canPost ? form : h("p", { class: "text-3 small thread-locked", text: "Only staff can reply in this channel." }));
  panel = { rootId, channelId: d.channelId, el, list, input, replies: new Map() };
  for (const r of d.replies) addReply(r, false);
  if (!d.replies.length) list.append(h("p", { class: "text-3 small thread-empty", text: "No replies yet. Start the conversation." }));
  document.querySelector(".chat-main")?.append(el);
  requestAnimationFrame(() => { el.classList.add("open"); scrollDown(); });
  try { history.replaceState(history.state, "", `#thread-${rootId}`); } catch { /* ignore */ }

  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const nonce = `th-${Math.random().toString(36).slice(2)}`;
    pending.set(nonce, text);
    chatSend({ type: "send", channelId: panel.channelId, content: text, threadRoot: panel.rootId, nonce });
    input.value = "";
    input.style.height = "auto";
  });
  if (matchMedia("(min-width: 900px)").matches) input.focus();
}

const countText = (n) => n ? `${n} ${n === 1 ? "reply" : "replies"}` : "Replies";

function closeThread() {
  if (!panel) return;
  const el = panel.el;
  panel = null;
  el.classList.remove("open");
  setTimeout(() => el.remove(), 200);
  const ch = currentChannel();
  if (location.hash.startsWith("#thread-") && ch) { try { history.replaceState(history.state, "", `#${ch.slug}`); } catch { /* ignore */ } }
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panel && !document.querySelector("dialog[open]")) closeThread(); });

function scrollDown() {
  const s = panel?.el.querySelector(".thread-scroll");
  if (s) s.scrollTop = s.scrollHeight;
}

function addReply(m, live = true) {
  if (!panel || panel.replies.has(m.id)) return;
  panel.list.querySelector(".thread-empty")?.remove();
  panel.replies.set(m.id, m);
  const prev = [...panel.replies.values()].at(-2);
  const row = renderMessage(m, null, { thread: true });
  if (prev && prev.author.id === m.author.id && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60_000) row.classList.add("grouped");
  panel.list.append(row);
  panel.el.querySelector(".thread-count").textContent = countText(panel.replies.size);
  if (live) scrollDown();
}

// ---------- live updates ----------
eventHooks.push((data) => {
  if (data.type === "thread_message") {
    if (panel && Number(data.message.threadRoot) === Number(panel.rootId)) addReply(data.message);
  } else if (data.type === "thread_update") {
    const m = state.messages.get(data.rootId);
    if (m) { m.thread = data.thread; rerenderMessage(data.rootId); }
  } else if (data.type === "thread_rejected") {
    const text = pending.get(data.nonce);
    pending.delete(data.nonce);
    if (panel && text && !panel.input.value) panel.input.value = text;
    toast(`Not sent: ${data.message}`);
  } else if (data.type === "slowmode") {
    const ch = state.channels.find((c) => c.id === data.channelId);
    if (ch) ch.slow = data.seconds;
    if (state.channelId === data.channelId) drawSlow(ch);
  }
});

// A link to a thread (from a notification): /community#thread-123
let firstOpen = true;
composerHooks.push((ch) => {
  if (panel && ch && panel.channelId !== ch.id) closeThread();
  drawSlow(ch);
  if (!firstOpen) return;
  firstOpen = false;
  const m = /^#thread-(\d+)$/.exec(location.hash);
  if (!m) return;
  const id = Number(m[1]);
  getJson(`/api/chat/threads/${id}`).then(async (d) => {
    await openAt(d.channelId, id).catch(() => {});
    openThread(id);
  }).catch((e) => toast(e.message));
});

// ---------- slow mode ----------
const canSlow = () => Boolean(state.me && (state.me.owner || (state.me.perms || []).includes("delete_messages")));
const slowLabel = (s) => s < 60 ? `${s} seconds` : s < 3600 ? `${s / 60} minute${s === 60 ? "" : "s"}` : "1 hour";

function drawSlow(ch) {
  let btn = document.getElementById("open-slowmode");
  const show = ch && (!ch.kind || ch.kind === "text") && canSlow();
  if (!btn && show) {
    btn = h("button", { class: "icon-btn", type: "button", id: "open-slowmode", "aria-label": "Slow mode", title: "Slow mode", onclick: slowDialog }, iconEl("hourglass"));
    document.getElementById("open-pins")?.before(btn);
  }
  if (btn) { btn.hidden = !show; btn.classList.toggle("on", Boolean(ch?.slow)); }
  const tag = document.getElementById("slow-note");
  if (ch?.slow && (!ch.kind || ch.kind === "text") && ch.canPost) {
    const text = canSlow() ? `Slow mode: ${slowLabel(ch.slow)} between messages (staff aren't limited)` : `Slow mode is on: one message every ${slowLabel(ch.slow)}`;
    if (tag) tag.lastChild.textContent = text;
    else document.querySelector(".composer-meta")?.prepend(h("span", { class: "slow-note", id: "slow-note" }, iconEl("hourglass"), h("span", { text })));
  } else tag?.remove();
}

function slowDialog() {
  const ch = currentChannel();
  if (!ch) return;
  const choices = [0, 5, 10, 30, 60, 300, 900, 1200, 3600];
  const sel = h("select", { class: "input", id: "slow-seconds" }, ...choices.map((s) => h("option", { value: s, text: s ? slowLabel(s) : "Off", selected: Number(ch.slow || 0) === s })));
  openDialog({
    title: `Slow mode in #${ch.name}`,
    body: h("div", { class: "form" },
      h("p", { class: "text-2", style: "margin:0", text: "Members can send one message per chosen time. Staff who can delete messages aren't limited." }),
      h("label", { class: "field" }, h("span", { text: "Time between messages" }), sel)),
    actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => {
      try { const r = await postJson(`/api/chat/channels/${ch.id}/slowmode`, { seconds: Number(sel.value) }); toast(r.message); } catch (e) { toast(e.message); }
    } }],
  });
}
