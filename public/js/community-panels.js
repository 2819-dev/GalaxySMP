// Special community channels: Information, Events, News, Polls, Builds, Auction House, Suggestions and Voice Chat.
// All text goes in with textContent, never as HTML.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { ticketChat, newTicketDialog, onTicketEvent, chip, when, LABELS } from "/js/tickets.js";
import { iconEl } from "/js/site.js";
import { renderMarkdown } from "/js/markdown.js";
import { linkCards } from "/js/link-cards.js";
import { faceSvg } from "/js/face.js";
import * as extra from "/js/community-extra.js";
import { sendTyping, emojiMenu, chatState, channelChoices } from "/js/chat.js";
import { attachChannelSuggest } from "/js/channel-suggest.js";
import { openPlusMenu, giftDialog } from "/js/plus-menu.js";
import { renderTimeline } from "/js/community-feed.js";
import { helpCenterBlock } from "/js/help-center.js";
import { renderTeam, renderApplications } from "/js/community-team.js";
import { renderStaffLogs, renderReports, renderShifts } from "/js/community-staff.js";
import { renderJobs } from "/js/community-jobs.js";
import { renderFriends } from "/js/community-friends.js";
import { micButton, voicePlayer } from "/js/chat-voice.js";

let dmRights = null;

// ---------- secure forms (the owner sends questions in a DM; only the owner can read the answers) ----------
function formDialog(other, done) {
  const title = h("input", { class: "input", id: "sf-title", maxlength: 80, placeholder: "e.g. Prize delivery details (optional)" });
  const list = h("div", { class: "sf-questions" });
  const addQ = (value = "") => {
    if (list.children.length >= 8) return;
    const q = h("input", { class: "input", maxlength: 120, placeholder: `Question ${list.children.length + 1}, e.g. Full name`, value });
    const row = h("div", { class: "sf-q" }, q, h("button", { class: "icon-btn", type: "button", "aria-label": "Remove question", onclick: () => { if (list.children.length > 1) row.remove(); } }, iconEl("x")));
    list.append(row);
    q.focus();
  };
  addQ();
  openDialog({
    title: `Secure form for ${other.username}`,
    body: h("div", { class: "form" },
      h("p", { class: "text-2", style: "margin:0", text: `${other.username} answers in this conversation. Only you can read the answers (they're encrypted, and even ${other.username} can't see them again). Answering is optional: they can decline.` }),
      field("Title", title), h("div", { class: "field" }, h("span", { class: "field-label", text: "Questions" }), list),
      h("div", {}, h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "+ Add a question", onclick: () => addQ() }))),
    actions: [{ label: "Cancel" }, { label: "Send form", kind: "primary", onClick: async () => {
      const questions = [...list.querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean);
      const r = await postJson("/api/dm/forms", { to: other.id, title: title.value, questions });
      done(r.message);
    } }],
  });
}

async function drawForm(slot, id) {
  let f;
  try { f = (await getJson(`/api/dm/forms/${id}`)).form; } catch { slot.replaceChildren(h("p", { class: "text-3 small", text: "🔒 Secure form" })); return; }
  const head = h("div", { class: "sf-head" }, iconEl("lock"), h("b", { text: f.title || "Secure form" }));
  const kids = [head];
  if (f.mine && f.status === "waiting") {
    const inputs = f.questions.map((q, i) => h("input", { class: "input", id: `sf-${id}-${i}`, maxlength: 500, autocomplete: "off" }));
    const err = h("p", { class: "form-error", role: "alert" });
    const submit = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Send securely" });
    const decline = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Decline" });
    const act = async (action) => {
      submit.disabled = decline.disabled = true;
      try { await postJson(`/api/dm/forms/${id}/${action}`, action === "answer" ? { answers: inputs.map((i) => i.value) } : {}); drawForm(slot, id); }
      catch (e) { err.textContent = e.message; submit.disabled = decline.disabled = false; }
    };
    submit.addEventListener("click", () => act("answer"));
    decline.addEventListener("click", () => act("decline"));
    kids.push(h("p", { class: "text-3 small", style: "margin:0", text: "Only the server owner can see your answers. You don't have to answer: tap Decline if you'd rather not." }),
      ...f.questions.map((q, i) => h("label", { class: "field" }, h("span", { class: "field-label", text: q }), inputs[i])), err, h("div", { class: "sf-actions" }, submit, decline));
  } else if (f.mine) {
    kids.push(h("p", { class: "text-2 small", style: "margin:0", text: f.status === "answered" ? "✓ Sent securely. Only the owner can see your answers." : f.status === "declined" ? "You declined this form." : "This form is closed." }));
  } else if (f.sender) {
    if (f.status === "waiting") kids.push(h("p", { class: "text-3 small", style: "margin:0", text: `Waiting for an answer: ${f.questions.join(", ")}` }));
    else if (f.status === "declined") kids.push(h("p", { class: "text-3 small", style: "margin:0", text: "They declined this form." }));
    else if (f.status === "deleted") kids.push(h("p", { class: "text-3 small", style: "margin:0", text: "You deleted the answers." }));
    else {
      const box = h("div", { class: "sf-answers", hidden: true });
      const show = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Show answers", onclick: () => {
        box.hidden = !box.hidden; show.textContent = box.hidden ? "Show answers" : "Hide answers";
      } });
      if (f.answers) box.append(...f.questions.map((q, i) => h("div", { class: "sf-a" }, h("span", { class: "text-3 small", text: q }), h("b", { text: f.answers[i] || "" }))));
      else box.append(h("p", { class: "text-3 small", text: f.unreadable ? "These answers can't be read any more." : "No answers." }));
      const del = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Delete answers", onclick: async () => {
        if (!confirm("Delete these answers for good?")) return;
        try { await postJson(`/api/dm/forms/${id}/delete`, {}); drawForm(slot, id); } catch (e) { alert(e.message); }
      } });
      kids.push(h("p", { class: "text-3 small", style: "margin:0", text: "✓ Answered. Only you can see the answers." }), h("div", { class: "sf-actions" }, show, del), box);
    }
  }
  slot.replaceChildren(...kids);
}   // what this member may upload (pictures in DMs: Galaxy Pro+ and the owner)

const panel = () => document.getElementById("channel-panel");
const voiceBox = () => document.getElementById("voice-embed");
let refreshTimer = null;
let ctx = null;
let cleanup = null;

function stopViews() {
  clearInterval(refreshTimer);
  cleanup?.();
  cleanup = null;
}

export function hidePanel() {
  stopViews();
  panel().hidden = true;
  voiceBox().hidden = true; // voice keeps running in the background
}

export function showPanel(channel, context) {
  ctx = context;
  stopViews();
  const p = panel();
  p.replaceChildren();
  if (channel.kind === "voice") {
    p.hidden = true;
    showVoice();
    return;
  }
  voiceBox().hidden = true;
  p.hidden = false;
  p.scrollTop = 0;
  const helpers = { toast: (m) => ctx.toast(m), setTimer: (t) => { refreshTimer = t; }, setCleanup: (fn) => { cleanup = fn; }, sub: ctx.sub, me: ctx.me };
  const render = {
    info: renderInfo, suggestions: renderSuggestions, support: renderSupport, dms: renderDMs,
    events: (el) => extra.renderEvents(el, helpers), news: (el) => extra.renderNews(el, helpers),
    polls: (el) => extra.renderPolls(el, helpers), builds: (el) => extra.renderBuilds(el, helpers),
    timeline: (el) => renderTimeline(el, helpers), team: (el) => renderTeam(el, helpers), applications: (el) => renderApplications(el, helpers),
    stafflogs: (el) => renderStaffLogs(el, helpers), reports: (el) => renderReports(el, helpers), shifts: (el) => renderShifts(el, helpers),
    jobs: (el) => renderJobs(el, helpers),
    marketplace: (el) => import("/js/marketplace.js").then((m) => m.renderMarketplace(el, helpers)),
    auction: (el) => import("/js/marketplace.js").then((m) => m.renderMarketplace(el, helpers)),
    streams: (el) => import("/js/streams.js").then((m) => m.renderStreams(el, helpers)),
    friends: (el) => renderFriends(el, { ...helpers, openDM: ctx.openDM }),
  }[channel.kind];
  if (render) render(p);
}

// ---------- Voice Chat: the voice page, kept running while you use other channels ----------
function showVoice() {
  const box = voiceBox();
  box.hidden = false;
  if (!box.querySelector("iframe")) {
    const frame = h("iframe", { src: "/voice?embed=1", title: "Voice chat", allow: "microphone; autoplay" });
    box.append(frame);
  }
}

// ---------- Information ----------
function richLine(text) {
  const p = h("p");
  String(text).split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (part.startsWith("**") && part.endsWith("**")) p.append(h("strong", { text: part.slice(2, -2) }));
    else if (part) p.append(part);
  });
  return p;
}

async function renderInfo(p) {
  const wrap = h("div", { class: "cp-wrap" });
  p.append(wrap);
  let data;
  try { data = await getJson("/api/help"); } catch { wrap.append(h("p", { class: "text-3", text: "Couldn't load the server information." })); return; }
  const info = h("section", { class: "panel cp-info" },
    h("img", { class: "cp-logo", src: "/img/wordmark.png", alt: "GalaxySMP", width: 320, height: 56 }));
  for (const line of String(data.info || "").split("\n")) {
    if (line.trim()) info.append(richLine(line));
  }
  info.append(h("p", {}, "Join from Minecraft Bedrock: ", h("a", { href: "/join", text: "How to join" }), " · ",
    h("a", { href: "/status", text: "Server status" }), " · ", h("a", { href: "/store", text: "Store" })));
  const rules = h("section", { class: "panel cp-rules" }, h("h2", { style: "font-size:1.15rem;margin:0", text: "Rules" }));
  for (const section of data.rules || []) {
    rules.append(h("h3", { text: section.title }));
    const ul = h("ul");
    for (const item of section.items || []) {
      const li = richLine(item);
      ul.append(h("li", {}, ...li.childNodes));
    }
    rules.append(ul);
  }
  rules.append(h("p", { class: "text-3 small", style: "margin:12px 0 0" }, "Full rules: ", h("a", { href: "/rules", text: "galaxymc.us/rules" })));
  wrap.append(info, rules);
}

// ---------- Suggestions ----------
// #Suggestions, organized: status tabs with counts, category chips, search, Top/New. Duplicates are merged by staff.
const SG_TABS = [["open", "Open"], ["planned", "Planned"], ["progress", "In progress"], ["done", "Done"], ["declined", "Declined"]];

function renderSuggestions(p) {
  const st = { sort: "top", status: "open", category: null, q: "", one: /^\d+$/.test(ctx.sub || "") ? Number(ctx.sub) : null };
  const list = h("div", { class: "stack", style: "gap:10px" });
  const tabs = h("div", { class: "sg-tabs", role: "tablist", "aria-label": "Suggestion status" });
  const cats = h("div", { class: "sg-cats", role: "group", "aria-label": "Categories" });
  const search = h("input", { class: "input sg-search", id: "sg-search", type: "search", maxlength: 60, placeholder: "Search ideas", "aria-label": "Search suggestions" });
  const top = h("button", { type: "button", "aria-pressed": "true", text: "Top" });
  const newest = h("button", { type: "button", "aria-pressed": "false", text: "New" });
  const add = h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => extra.newSuggestion(load, ctx.toast) }, iconEl("plus"), "New suggestion");
  const banner = h("div", { hidden: true });
  p.append(h("div", { class: "cp-wrap" },
    h("section", { class: "panel sg-head" },
      h("div", { class: "sg-head-top" },
        h("p", { class: "text-2", style: "margin:0", text: "Have an idea for GalaxySMP? Share it, vote, and discuss in the comments. Staff move ideas along from Open to Planned, In progress and Done. Ideas that already exist are marked Already implemented (in Done)." }),
        add),
      tabs,
      h("div", { class: "sg-tools" }, search, h("div", { class: "tabs-mini" }, top, newest)),
      cats),
    banner, list));

  let timer = null;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { st.q = search.value.trim(); st.one = null; load(); }, 300); });
  for (const [btn, key] of [[top, "top"], [newest, "new"]]) {
    btn.addEventListener("click", () => { st.sort = key; top.setAttribute("aria-pressed", String(key === "top")); newest.setAttribute("aria-pressed", String(key === "new")); load(); });
  }
  // "Similar ideas" in the New suggestion dialog, and notifications, open one suggestion
  const openOne = (e) => { st.one = Number(e.detail); load(); };
  window.addEventListener("sg-open", openOne);
  cleanup = () => window.removeEventListener("sg-open", openOne);

  function drawTabs(counts) {
    tabs.replaceChildren(...SG_TABS.map(([key, name]) => h("button", { class: `sg-tab sg-tab-${key}`, type: "button", role: "tab", "aria-selected": String(!st.one && st.status === key),
      onclick: () => { st.status = key; st.one = null; load(); } }, name, h("span", { class: "sg-tab-n", text: String(counts[key] || 0) }))));
  }
  function drawCats(categories) {
    const chip = (key, name) => h("button", { class: "sg-cat", type: "button", "aria-pressed": String(st.category === key), onclick: () => { st.category = key; st.one = null; load(); } }, name);
    cats.replaceChildren(chip(null, "All"), ...Object.entries(categories).map(([k, n]) => chip(k, n)));
  }

  async function load() {
    const qs = new URLSearchParams({ sort: st.sort, status: st.status });
    if (st.category) qs.set("category", st.category);
    if (st.q) qs.set("q", st.q);
    if (st.one) qs.set("id", String(st.one));
    let data;
    try { data = await getJson(`/api/community/suggestions?${qs}`); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    extra.setSuggestionCategories(data.categories);
    drawTabs(data.counts); drawCats(data.categories);
    banner.hidden = !st.one;
    banner.replaceChildren(h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { st.one = null; try { history.replaceState(history.state, "", "#suggestions"); } catch { /* ignore */ } load(); } }, iconEl("arrow", "flip"), "All suggestions"));
    list.replaceChildren();
    if (!data.suggestions.length) {
      const name = SG_TABS.find(([k]) => k === st.status)[1];
      list.append(h("div", { class: "panel empty", text: st.q ? `No ${name.toLowerCase()} ideas match "${st.q}".` : st.status === "open" ? "No open suggestions yet. Share the first one." : `Nothing is ${name.toLowerCase()} yet.` }));
    }
    for (const s of data.suggestions) list.append(extra.suggestionCard(s, data.canModerate, load, ctx.toast));
  }
  load();
}

// ---------- Support: private live chat with staff ----------
function renderSupport(p, openId) {
  const wrap = h("div", { class: "cp-wrap" });
  p.replaceChildren(wrap);
  cleanup?.();
  cleanup = null;
  if (openId) {
    cleanup = ticketChat(wrap, openId, { staff: false, toast: ctx.toast, onBack: () => renderSupport(p) });
    return;
  }
  const staff = (ctx.me?.role?.power || 0) >= 50;
  const list = h("div", { class: "stack", style: "gap:10px" });
  wrap.append(
    helpCenterBlock({ toast: ctx.toast, onAsk: (qk) => newTicketDialog(ctx.toast, (id) => renderSupport(p, id), qk) }),
    staff ? h("div", { class: "cp-toolbar", style: "margin:10px 0" }, h("a", { class: "btn btn-ghost btn-sm", href: "/staff#tickets", text: "Answer tickets (staff)" })) : null,
    h("h3", { class: "tk-list-title", text: "Your tickets" }),
    list);

  async function load() {
    let data;
    try { data = await getJson("/api/support/tickets"); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    list.replaceChildren();
    if (!data.tickets.length) list.append(h("div", { class: "panel empty", text: "You haven't opened any tickets yet." }));
    for (const t of data.tickets) {
      list.append(h("button", { class: `panel tk-row${t.userUnread ? " unread" : ""}`, type: "button", onclick: () => renderSupport(p, t.id) },
        h("span", { class: "tk-row-icon" }, iconEl((LABELS[t.label] || LABELS.other).icon)),
        h("span", { class: "tk-row-main" },
          h("span", { class: "tk-row-subject", text: t.subject }),
          h("span", { class: "tk-row-preview", text: t.preview || "" })),
        h("span", { class: "tk-row-side" }, chip("status", t.status, false), h("span", { class: "text-3 small", text: when(t.lastMessageAt) }),
          t.userUnread ? h("span", { class: "tk-unread", text: `${t.userUnread} new` }) : null)));
    }
  }
  cleanup = onTicketEvent((d) => { if (Number(d.ownerId) === Number(ctx.me?.id)) load(); });
  load();
}

// ---------- Direct messages ----------
const dmListeners = new Set();
export function dmEvent(data) {
  if (data.type === "typing") { // someone typing to you: the open conversation shows it
    document.getElementById("channel-panel")?.querySelector(".dm-main")?.onDmTyping?.(data);
    return;
  }
  for (const fn of dmListeners) fn(data);
}
const dmTime = (at) => {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};
function dmFace(src, name) {
  const img = h("img", { class: "dm-face", alt: "", width: 36, height: 36, loading: "lazy" });
  img.src = src || faceSvg(name || "?");
  img.addEventListener("error", () => { img.src = faceSvg(name || "?"); }, { once: true });
  img.title = name || "";
  return img;
}

function renderDMs(p) {
  const wrap = h("div", { class: "dm-wrap" });
  const side = h("div", { class: "dm-side" });
  const main = h("div", { class: "dm-main" });
  wrap.append(side, main);
  p.replaceChildren(wrap);
  let current = ctx.dmWith || null;
  let threads = [];

  const newBtn = h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: pickMember }, "New message");
  async function loadList() {
    let d;
    try { d = await getJson("/api/dm/threads"); } catch (e) { side.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    threads = d.threads;
    side.replaceChildren(h("div", { class: "dm-side-head" }, h("b", { text: "Messages" }), newBtn));
    if (!threads.length) side.append(h("p", { class: "text-3 small dm-empty", text: "No conversations yet. Tap a member's name and choose Message, or start one here." }));
    for (const t of threads) {
      side.append(h("button", { class: `dm-row${t.other.id === current ? " active" : ""}${t.unread ? " unread" : ""}`, type: "button", onclick: () => open(t.other.id) },
        dmFace(t.other.head, t.other.username),
        h("span", { class: "dm-row-main" },
          h("span", { class: "dm-row-name" }, t.other.username, t.other.inGame ? h("span", { class: "dm-ingame", title: "Playing now" }) : null),
          h("span", { class: "dm-row-preview", text: `${t.mine ? "You: " : ""}${t.preview || ""}` })),
        h("span", { class: "dm-row-side" }, h("span", { class: "text-3 small", text: dmTime(t.at) }), t.unread ? h("span", { class: "tk-unread", text: String(t.unread) }) : null)));
    }
    wrap.classList.toggle("has-open", Boolean(current));
  }

  async function open(userId) {
    current = userId;
    ctx.setView?.(`dm:${userId}`);
    wrap.classList.add("has-open");
    side.querySelectorAll(".dm-row").forEach((r) => r.classList.remove("active"));
    let d;
    try { d = await getJson(`/api/dm/with/${userId}`); } catch (e) { main.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    if (current !== userId) return;
    const log = h("div", { class: "dm-log", role: "log", "aria-live": "polite" });
    const input = h("textarea", { class: "input dm-input", rows: 1, maxlength: chatState.maxLength || 500, placeholder: `Message ${d.other.username}`, "aria-label": "Message" });
    attachChannelSuggest(input, channelChoices);
    const send = h("button", { class: "btn btn-primary", type: "button", text: "Send" });
    const blockBtn = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: d.blocked ? "Unblock" : "Block" });
    blockBtn.addEventListener("click", () => openDialog({
      title: d.blocked ? `Unblock ${d.other.username}?` : `Block ${d.other.username}?`,
      body: h("p", { class: "text-2", text: d.blocked ? "They'll be able to message you again." : "They won't be able to message you, and you won't be able to message them." }),
      actions: [{ label: "Cancel" }, { label: d.blocked ? "Unblock" : "Block", kind: d.blocked ? "primary" : "danger", onClick: async () => {
        await postJson(`/api/dm/block/${userId}`, { blocked: !d.blocked }); open(userId);
      } }],
    }));
    const head = h("div", { class: "dm-head" },
      h("button", { class: "btn btn-ghost btn-sm dm-back", type: "button", text: "← Back", onclick: () => { current = null; ctx.setView?.("dms"); wrap.classList.remove("has-open"); loadList(); } }),
      dmFace(d.other.head, d.other.username),
      h("div", { class: "dm-head-main" }, h("b", { text: d.other.username }),
        h("span", { class: "text-3 small", text: d.other.inGame ? "Playing on GalaxySMP: they'll see this in game" : "Not in game right now" })),
      blockBtn);
    const meId = ctx.me?.id;
    const fill = (node, m) => {
      const text = node.querySelector(".dm-text");
      const sender = chatState.members.get(m.from);
      const admin = (chatState.roles.get(sender?.role)?.power || 0) >= 100;   // headings and -# small text: Admins only
      text.replaceChildren(renderMarkdown(m.body || "", { channels: chatState.channels, noHeadings: !admin }));
      const cards = linkCards(m.body);
      if (cards) text.append(cards);
      text.hidden = (!m.body && Boolean(m.audio || m.image)) || Boolean(m.form);
      if (m.form && !node.querySelector(".dm-form")) {
        const slot = h("div", { class: "dm-form" }, h("p", { class: "text-3 small", text: "Loading the secure form…" }));
        text.before(slot);
        drawForm(slot, m.form.id);
      }
      if (m.image && !node.querySelector(".dm-pic-link")) {
        const ratio = m.image.w && m.image.h ? m.image.h / m.image.w : 0.6;
        const width = Math.min(280, m.image.w || 280);
        text.before(h("a", { class: "dm-pic-link msg-pic-link", href: `/api/chat/images/${m.image.id}`, target: "_blank", rel: "noopener" },
          h("img", { class: "msg-pic dm-pic", src: `/api/chat/images/${m.image.id}`, alt: "Picture", loading: "lazy", width, height: Math.round(width * ratio) })));
      }
      if (m.audio && !node.querySelector(".vp")) text.before(voicePlayer({ src: `/api/chat/voice/${m.audio.id}`, ms: m.audio.ms, seed: m.audio.id }));
      node.querySelector(".dm-meta").textContent = `${dmTime(m.at)}${m.via === "game" ? " · from the game" : ""}${m.editedAt ? " · edited" : ""}${m.from === meId ? (m.read ? " · Read" : " · Sent") : ""}`;
      node.querySelector(".dm-edit-btn")?.remove();
      if (m.from === meId && !m.read && m.body) { // your message they haven't read yet: you can still edit it
        const b = h("button", { class: "dm-edit-btn", type: "button", "aria-label": "Edit message", title: "Edit (until they read it)" }, iconEl("pencil"), "Edit");
        b.addEventListener("click", () => editDm(node, m));
        node.querySelector(".dm-meta").append(b);
      }
    };
    const msgs = new Map();
    const add = (m) => {
      const mine = m.from === meId;
      const node = h("div", { class: `dm-msg${mine ? " mine" : ""}` },
        h("div", { class: "dm-bubble" }, h("div", { class: "dm-text msg-text" }), h("div", { class: "dm-meta" })));
      node.dataset.id = m.id;
      msgs.set(m.id, { m, node });
      fill(node, m);
      log.append(node);
    };
    const editDm = (node, m) => {
      if (node.querySelector(".dm-edit")) return;
      const box = h("textarea", { class: "input dm-edit", rows: 2, maxlength: chatState.maxLength || 500 });
      box.value = m.body;
      const save = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Save" });
      const cancel = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Cancel" });
      const wrap = h("div", { class: "dm-edit-wrap" }, box, h("div", { class: "msg-edit-bar" }, save, cancel));
      const text = node.querySelector(".dm-text");
      text.hidden = true;
      text.after(wrap);
      const close = () => { wrap.remove(); text.hidden = false; };
      cancel.addEventListener("click", close);
      const commit = async () => {
        const body = box.value.trim();
        if (!body || body === m.body) return close();
        save.disabled = true;
        try {
          const r = await postJson(`/api/dm/messages/${m.id}/edit`, { body });
          m.body = r.body;
          m.editedAt = r.editedAt;
          close();
          fill(node, m);
        } catch (e) { ctx.toast(e.message); save.disabled = false; if (/read/.test(e.message)) { m.read = true; close(); fill(node, m); } }
      };
      save.addEventListener("click", commit);
      box.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(hover: hover)").matches) { e.preventDefault(); commit(); }
        if (e.key === "Escape") close();
      });
      box.focus();
    };
    if (!d.messages.length) log.append(h("p", { class: "text-3 small dm-start", text: `This is the start of your messages with ${d.other.username}. Be kind, and never share passwords or personal information.` }));
    d.messages.forEach(add);
    const grow = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight + 2, 140) + "px"; };
    input.addEventListener("input", grow);
    // "+": Emojis, Gift (to this person) and, for Galaxy Pro+ (and the owner), Choose a photo
    let pendingPic = null;   // { id, preview } uploaded and waiting to be sent
    const picFile = h("input", { type: "file", accept: "image/*", hidden: true });
    const picBar = h("div", { class: "pic-pending dm-pic-pending", hidden: true });
    const drawPic = () => {
      picBar.hidden = !pendingPic;
      if (pendingPic) picBar.replaceChildren(h("img", { src: pendingPic.preview, alt: "" }), h("span", { text: "Picture ready. Add a message or press Send." }),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove", onclick: () => { pendingPic = null; drawPic(); } }));
    };
    picFile.addEventListener("change", async () => {
      const f = picFile.files[0];
      picFile.value = "";
      if (!f) return;
      try {
        const img = await extra.shrink(f);
        const r = await postJson("/api/chat/images", { mime: img.mime, data: img.data, width: img.width, height: img.height });
        pendingPic = { id: r.id, preview: img.preview };
        drawPic();
        input.focus();
      } catch (e) { ctx.toast(e.message); }
    });
    const pickPhoto = async () => {
      let r = dmRights;
      if (!r) { try { r = dmRights = await getJson("/api/uploads/rights"); } catch { r = {}; } }
      if (r.blocked) return ctx.toast("Staff turned off picture uploads for your account.");
      if (!r.dm) {
        openDialog({ title: "Pictures in DMs are a Galaxy Pro+ perk",
          body: h("p", { class: "text-2", text: "Galaxy Pro+ members can send pictures in direct messages." }),
          actions: [{ label: "Close" }, { label: "See Galaxy Pro+", kind: "primary", onClick: () => { location.href = "/store"; } }] });
        return;
      }
      picFile.click();
    };
    const plusBtn = h("button", { class: "icon-btn composer-plus", type: "button", "aria-label": "More: emojis, gift, photo", title: "Emojis, gift, photo" }, iconEl("plus"));
    plusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPlusMenu(plusBtn, { items: [
        { icon: "smile", label: "Emojis", onClick: () => emojiMenu(plusBtn, input) },
        { icon: "gift", label: "Gift", onClick: () => giftDialog({ id: d.other.id, username: d.other.username, head: d.other.head }) },
        ...(chatState.me?.owner ? [{ icon: "lock", label: "Secure form", onClick: () => formDialog(d.other, (msg) => {
          if (!log.querySelector(`[data-id="${msg.id}"]`)) add(msg);
          log.querySelector(".dm-start")?.remove();
          log.scrollTop = log.scrollHeight;
          loadList();
        }) }] : []),
      ], photo: pickPhoto });
    });
    const composer = h("div", { class: "dm-composer" }, plusBtn, input, picFile);
    composer.append(micButton(composer, async (audioId) => {
      const r = await postJson(`/api/dm/with/${userId}`, { body: "", audioId });
      if (!log.querySelector(`[data-id="${r.message.id}"]`)) add(r.message);
      log.querySelector(".dm-start")?.remove();
      log.scrollTop = log.scrollHeight;
      loadList();
    }), send);
    // "player1 is typing…"
    const typing = h("div", { class: "typing-line dm-typing", "aria-live": "polite" });
    let typingTimer = null;
    const stopTyping = () => { clearTimeout(typingTimer); typing.replaceChildren(); typing.classList.remove("on"); };
    main.onDmTyping = (t) => {
      if (t.dm !== userId) return;
      typing.replaceChildren(h("span", { class: "typing-dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")), h("span", { text: `${d.other.username} is typing…` }));
      typing.classList.add("on");
      clearTimeout(typingTimer);
      typingTimer = setTimeout(stopTyping, 6000);
    };
    input.addEventListener("input", () => { if (input.value.trim()) sendTyping({ dm: userId }); });
    main.replaceChildren(h("div", { class: "dm-chat" }, head, log, typing, picBar, d.blocked ? h("p", { class: "text-3 small dm-start", text: "You blocked this member." }) : composer));
    log.scrollTop = log.scrollHeight;
    async function sendIt() {
      const text = input.value.trim();
      if (!text && !pendingPic) return;
      send.disabled = true;
      try {
        const r = await postJson(`/api/dm/with/${userId}`, { body: text, imageId: pendingPic?.id || null });
        input.value = "";
        pendingPic = null;
        drawPic();
        grow();
        if (!log.querySelector(`[data-id="${r.message.id}"]`)) add(r.message);
        log.querySelector(".dm-start")?.remove();
        log.scrollTop = log.scrollHeight;
        loadList();
      } catch (e) { ctx.toast(e.message); }
      send.disabled = false;
      input.focus();
    }
    send.addEventListener("click", sendIt);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(hover: hover)").matches) { e.preventDefault(); sendIt(); }
    });
    // live: new messages in this conversation
    main.onDm = (m) => {
      if (![m.from, m.to].includes(userId)) return;
      if (m.type === "dm_read") { // they read your messages: no more editing those
        for (const id of m.ids || []) { const x = msgs.get(id); if (x && !x.m.read) { x.m.read = true; x.node.querySelector(".dm-edit-wrap")?.remove(); x.node.querySelector(".dm-text").hidden = false; fill(x.node, x.m); } }
        return;
      }
      if (m.type === "dm_form") {   // a secure form was answered, declined or its answers deleted
        for (const x of msgs.values()) if (x.m.form?.id === m.id) { x.node.querySelector(".dm-form")?.remove(); fill(x.node, x.m); }
        return;
      }
      if (m.type === "dm_edit") {
        const x = msgs.get(m.id);
        if (x) { x.m.body = m.body; x.m.editedAt = m.editedAt; fill(x.node, x.m); }
        return;
      }
      if (log.querySelector(`[data-id="${m.id}"]`)) return;
      if (m.from === userId) stopTyping();
      add(m);
      log.querySelector(".dm-start")?.remove();
      log.scrollTop = log.scrollHeight;
      if (m.from === userId) getJson(`/api/dm/with/${userId}`).catch(() => {}); // marks it read
    };
    loadList();
    if (window.matchMedia("(hover: hover)").matches) input.focus();
  }

  function pickMember() {
    const members = [...(ctx.members?.values?.() || [])].filter((m) => m.id !== ctx.me?.id).sort((a, b) => a.username.localeCompare(b.username));
    const search = h("input", { class: "input", id: "dm-search", placeholder: "Search members", autocomplete: "off" });
    const list = h("div", { class: "dm-pick" });
    let dlg;
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      list.replaceChildren(...members.filter((m) => !q || m.username.toLowerCase().includes(q)).slice(0, 50).map((m) =>
        h("button", { class: "dm-row", type: "button", onclick: () => { dlg.close(); open(m.id); } }, dmFace(m.head, m.username), h("span", { class: "dm-row-name", text: m.username }))));
    };
    search.addEventListener("input", draw);
    draw();
    dlg = openDialog({ title: "New message", body: h("div", { class: "form" }, search, list), actions: [{ label: "Cancel" }] });
    setTimeout(() => search.focus(), 50);
  }

  const onDm = (m) => { main.onDm?.(m); if (m.type === "dm_read" || m.type === "dm_edit" || m.type === "dm_form") return; if (!current || ![m.from, m.to].includes(current)) loadList(); };
  dmListeners.add(onDm);
  cleanup = () => dmListeners.delete(onDm);
  loadList();
  if (current) open(current);
  else main.replaceChildren(h("div", { class: "dm-placeholder" }, h("p", { class: "text-3", text: "Pick a conversation, or start a new one. Messages also reach players in game, and they can reply with /dm." })));
}
