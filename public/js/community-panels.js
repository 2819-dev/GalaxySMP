// Special community channels: Information, Events, News, Polls, Builds, Auction House, Suggestions and Voice Chat.
// All text goes in with textContent, never as HTML.
import { money } from "/js/money.js";
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { ticketChat, newTicketDialog, onTicketEvent, chip, when, LABELS } from "/js/tickets.js";
import { iconEl } from "/js/site.js";
import { renderMarkdown } from "/js/markdown.js";
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
  const helpers = { toast: (m) => ctx.toast(m), setTimer: (t) => { refreshTimer = t; } };
  const render = {
    info: renderInfo, auction: renderAuction, suggestions: renderSuggestions, support: renderSupport, dms: renderDMs,
    events: (el) => extra.renderEvents(el, helpers), news: (el) => extra.renderNews(el, helpers),
    polls: (el) => extra.renderPolls(el, helpers), builds: (el) => extra.renderBuilds(el, helpers),
    timeline: (el) => renderTimeline(el, helpers), team: (el) => renderTeam(el, helpers), applications: (el) => renderApplications(el, helpers),
    stafflogs: (el) => renderStaffLogs(el, helpers), reports: (el) => renderReports(el, helpers), shifts: (el) => renderShifts(el, helpers),
    jobs: (el) => renderJobs(el, helpers),
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

// ---------- Auction House ----------

const timeLeft = (exp) => {
  const s = Math.max(0, exp - Date.now() / 1000);
  const hrs = Math.floor(s / 3600);
  return hrs ? `${hrs}h ${Math.floor((s % 3600) / 60)}m left` : `${Math.floor(s / 60)}m left`;
};
const TILE_COLORS = ["#2457eb", "#8a4fd8", "#16a36b", "#d4532f", "#c48a12", "#1d8fb3", "#b8336a"];
const tileColor = (id) => TILE_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % TILE_COLORS.length];

function renderAuction(p) {
  const state = { q: "", sort: "new", data: null };
  const search = h("input", { class: "input", type: "search", placeholder: "Search items", "aria-label": "Search items" });
  const sortNew = h("button", { type: "button", "aria-pressed": "true", text: "Newest" });
  const sortCheap = h("button", { type: "button", "aria-pressed": "false", text: "Cheapest" });
  const status = h("p", { class: "text-3 small", style: "margin:0" });
  const grid = h("div", { class: "ah-grid" });
  const wrap = h("div", { class: "cp-wrap" },
    h("section", { class: "panel", style: "padding:16px" },
      h("p", { class: "text-2", style: "margin:0 0 12px" }, "Buy items from the in-game Auction House with your game money. ",
        h("strong", { text: "You must be online in Minecraft:" }), " the item goes straight into your inventory. Sell items in game with ", h("code", { text: "/ah sell <price>" }), "."),
      h("div", { class: "cp-toolbar" }, search, h("div", { class: "tabs-mini" }, sortNew, sortCheap)), status),
    grid);
  p.append(wrap);

  const draw = () => {
    grid.replaceChildren();
    if (!state.data) return;
    const q = state.q.toLowerCase();
    let list = state.data.listings.filter((l) => !q || l.label.toLowerCase().includes(q) || l.item.toLowerCase().includes(q));
    if (state.sort === "cheap") list = [...list].sort((a, b) => a.price - b.price);
    if (!list.length) grid.append(h("div", { class: "panel empty", text: q ? "Nothing matches that." : "Nothing is for sale right now." }));
    for (const l of list) {
      const tile = h("span", { class: "ah-tile", text: l.label.trim().charAt(0).toUpperCase() || "?" });
      tile.style.background = tileColor(l.item);
      const buy = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Buy" });
      buy.addEventListener("click", () => confirmBuy(l, refresh));
      grid.append(h("article", { class: "panel ah-card" },
        h("div", { class: "ah-top" }, tile, h("div", {}, h("div", { class: "ah-name", text: `${l.amount}x ${l.label}` }),
          h("div", { class: "ah-meta", text: `${l.seller} · ${timeLeft(l.expires)}` }))),
        l.enchants?.length ? h("div", { class: "ah-ench" }, l.enchants.map((e) => h("span", { text: e }))) : null,
        h("div", { class: "ah-buy" }, h("span", { class: "ah-price", text: money(l.price) }), buy)));
    }
  };
  const refresh = async () => {
    try {
      state.data = await getJson("/api/community/auction");
      status.textContent = state.data.updated
        ? `${state.data.listings.length} item${state.data.listings.length === 1 ? "" : "s"} for sale · updated ${new Date(state.data.updated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : "Waiting for the Minecraft server to send its listings.";
      draw();
    } catch (e) { status.textContent = e.message; }
  };
  search.addEventListener("input", () => { state.q = search.value.trim(); draw(); });
  for (const [btn, sort] of [[sortNew, "new"], [sortCheap, "cheap"]]) {
    btn.addEventListener("click", () => {
      state.sort = sort;
      sortNew.setAttribute("aria-pressed", String(sort === "new"));
      sortCheap.setAttribute("aria-pressed", String(sort === "cheap"));
      draw();
    });
  }
  refresh();
  refreshTimer = setInterval(refresh, 20000);
}

function confirmBuy(l, done) {
  openDialog({
    title: `Buy ${l.amount}x ${l.label}?`,
    body: h("div", { class: "form" },
      h("p", { class: "text-2", style: "margin:0" }, "Price: ", h("strong", { text: money(l.price) }), ` · sold by ${l.seller}`),
      l.enchants?.length ? h("p", { class: "text-3 small", style: "margin:0", text: `Enchantments: ${l.enchants.join(", ")}` }) : null,
      h("p", { class: "note small", style: "margin:0", text: "It's paid with your in-game money and goes straight into your inventory, so you must be online in Minecraft." })),
    actions: [{ label: "Cancel" }, {
      label: `Buy for ${money(l.price)}`, kind: "primary",
      onClick: async () => {
        const res = await postJson(`/api/community/auction/${l.id}/buy`, {});
        ctx.toast(res.message || "Bought!");
        done();
      },
    }],
  });
}

// ---------- Suggestions ----------
const STATUS_NAMES = { open: "Open", planned: "Planned", done: "Done", declined: "Declined" };

function renderSuggestions(p) {
  let sort = "top";
  const list = h("div", { class: "stack", style: "gap:10px" });
  const top = h("button", { type: "button", "aria-pressed": "true", text: "Top" });
  const newest = h("button", { type: "button", "aria-pressed": "false", text: "New" });
  const add = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "New suggestion", onclick: () => extra.newSuggestion(load, ctx.toast) });
  p.append(h("div", { class: "cp-wrap" },
    h("section", { class: "panel", style: "padding:16px" },
      h("p", { class: "text-2", style: "margin:0 0 12px", text: "Have an idea for GalaxySMP? Share it, vote and discuss other ideas in the comments. Staff mark ideas as Planned, Done or Declined and can respond." }),
      h("div", { class: "cp-toolbar", style: "justify-content:space-between" }, h("div", { class: "tabs-mini" }, top, newest), add)),
    list));

  async function load() {
    let data;
    try { data = await getJson(`/api/community/suggestions?sort=${sort}`); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    list.replaceChildren();
    if (!data.suggestions.length) list.append(h("div", { class: "panel empty", text: "No suggestions yet. Be the first!" }));
    for (const s of data.suggestions) list.append(extra.suggestionCard(s, data.canModerate, load, ctx.toast));
  }
  for (const [btn, key] of [[top, "top"], [newest, "new"]]) {
    btn.addEventListener("click", () => {
      sort = key;
      top.setAttribute("aria-pressed", String(key === "top"));
      newest.setAttribute("aria-pressed", String(key === "new"));
      load();
    });
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
      text.replaceChildren(renderMarkdown(m.body, { channels: chatState.channels }));
      node.querySelector(".dm-meta").textContent = `${dmTime(m.at)}${m.via === "game" ? " · from the game" : ""}${m.editedAt ? " · edited" : ""}${m.from === meId ? (m.read ? " · Read" : " · Sent") : ""}`;
      node.querySelector(".dm-edit-btn")?.remove();
      if (m.from === meId && !m.read) { // your message they haven't read yet: you can still edit it
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
    // "+": Emojis and Gift (to this person)
    const plusBtn = h("button", { class: "icon-btn composer-plus", type: "button", "aria-label": "More: emojis, gift", title: "Emojis, gift" }, iconEl("plus"));
    plusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPlusMenu(plusBtn, { items: [
        { icon: "smile", label: "Emojis", onClick: () => emojiMenu(plusBtn, input) },
        { icon: "gift", label: "Gift", onClick: () => giftDialog({ id: d.other.id, username: d.other.username, head: d.other.head }) },
      ], photo: null });
    });
    const composer = h("div", { class: "dm-composer" }, plusBtn, input, send);
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
    main.replaceChildren(h("div", { class: "dm-chat" }, head, log, typing, d.blocked ? h("p", { class: "text-3 small dm-start", text: "You blocked this member." }) : composer));
    log.scrollTop = log.scrollHeight;
    async function sendIt() {
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        const r = await postJson(`/api/dm/with/${userId}`, { body: text });
        input.value = "";
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

  const onDm = (m) => { main.onDm?.(m); if (m.type === "dm_read" || m.type === "dm_edit") return; if (!current || ![m.from, m.to].includes(current)) loadList(); };
  dmListeners.add(onDm);
  cleanup = () => dmListeners.delete(onDm);
  loadList();
  if (current) open(current);
  else main.replaceChildren(h("div", { class: "dm-placeholder" }, h("p", { class: "text-3", text: "Pick a conversation, or start a new one. Messages also reach players in game, and they can reply with /dm." })));
}
