// Special community channels: Information, Events, Auction House, Suggestions and Voice Chat.
// All text goes in with textContent, never as HTML.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { ticketChat, newTicketDialog, onTicketEvent, chip, when, LABELS } from "/js/tickets.js";
import { iconEl } from "/js/site.js";

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
  const render = { info: renderInfo, events: renderEvents, auction: renderAuction, suggestions: renderSuggestions, support: renderSupport }[channel.kind];
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

// ---------- Events ----------
const ACCESS_NAMES = { all: "Everyone", plus: "Galaxy+ and Pro+", pro: "Galaxy Pro+ only" };

function renderEvents(p) {
  const list = h("div", { class: "stack", style: "gap:10px" });
  const status = h("p", { class: "text-3 small", style: "margin:8px 0 0" });
  p.append(h("div", { class: "cp-wrap" },
    h("section", { class: "panel", style: "padding:16px" },
      h("h2", { style: "font-size:1.15rem;margin:0 0 6px", text: "Minigames" }),
      h("p", { class: "text-2", style: "margin:0" }, "Minigames hosted by players and run by our Minigame Staff. To join or watch, go to a ",
        h("strong", { text: "Minigame Computer" }), " in the Minigame Center, or type ", h("code", { text: "/minigames" }),
        " in game. Galaxy+ and Pro+ players can host their own."), status),
    list));
  const load = async () => {
    let data;
    try { data = await getJson("/api/community/events"); } catch (e) { status.textContent = e.message; return; }
    list.replaceChildren();
    const now = Date.now() / 1000;
    if (!data.events.length) list.append(h("div", { class: "panel empty", text: "No minigames are running right now. Check back soon!" }));
    for (const e of data.events) {
      const open = e.signupEnds > now;
      const left = Math.max(0, e.signupEnds - now);
      list.append(h("article", { class: "panel ev-card" },
        h("div", { class: "ev-main" },
          h("h3", { class: "sg-title", text: e.game }),
          h("p", { class: "sg-foot", style: "margin:0" }, `Hosted by ${e.host} · ${e.players} player${e.players === 1 ? "" : "s"} · ${ACCESS_NAMES[e.access] || "Everyone"}`)),
        h("span", { class: `sg-status ${open ? "planned" : "done"}`, text: open ? `Sign-ups open · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}` : "In progress" })));
    }
    status.textContent = data.updated ? `Updated ${new Date(data.updated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Waiting for the Minecraft server.";
  };
  load();
  refreshTimer = setInterval(load, 15000);
}

// ---------- Auction House ----------
const money = (cents) => {
  const d = cents / 100;
  if (Math.abs(d) < 10000) return "$" + d.toLocaleString("en-US", { maximumFractionDigits: 2 });
  for (const [size, letter] of [[1e15, "Q"], [1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
    if (Math.abs(d) >= size) return `$${(d / size).toFixed(2).replace(/\.?0+$/, "")}${letter}`;
  }
  return "$" + d;
};
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
  const add = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "New suggestion", onclick: () => newSuggestion(load) });
  p.append(h("div", { class: "cp-wrap" },
    h("section", { class: "panel", style: "padding:16px" },
      h("p", { class: "text-2", style: "margin:0 0 12px", text: "Have an idea for GalaxySMP? Share it, and like or dislike other ideas. Staff mark ideas as Planned, Done or Declined." }),
      h("div", { class: "cp-toolbar", style: "justify-content:space-between" }, h("div", { class: "tabs-mini" }, top, newest), add)),
    list));

  async function load() {
    let data;
    try { data = await getJson(`/api/community/suggestions?sort=${sort}`); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    list.replaceChildren();
    if (!data.suggestions.length) list.append(h("div", { class: "panel empty", text: "No suggestions yet. Be the first!" }));
    for (const s of data.suggestions) list.append(card(s, data.canModerate, load));
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

function card(s, canModerate, reload) {
  const vote = async (value) => {
    try { await postJson(`/api/community/suggestions/${s.id}/vote`, { value: s.myVote === value ? 0 : value }); reload(); } catch (e) { ctx.toast(e.message); }
  };
  const up = h("button", { class: "sg-vote up", type: "button", "aria-pressed": String(s.myVote === 1), "aria-label": `Like (${s.likes})`, onclick: () => vote(1) }, iconEl("thumbsUp"), String(s.likes));
  const down = h("button", { class: "sg-vote down", type: "button", "aria-pressed": String(s.myVote === -1), "aria-label": `Dislike (${s.dislikes})`, onclick: () => vote(-1) }, iconEl("thumbsDown"), String(s.dislikes));
  let who;
  if (!s.anonymous) who = s.author;
  else if (s.author) who = `Anonymous (${s.mine ? "you" : s.author}, only ${s.mine ? "you and the owners" : "owners"} can see this)`;
  else who = "Anonymous";
  const foot = h("div", { class: "sg-foot" },
    h("span", { class: `sg-status ${s.status}`, text: STATUS_NAMES[s.status] }),
    h("span", { text: `${who} · ${new Date(s.createdAt).toLocaleDateString()}` }));
  if (canModerate) {
    const sel = h("select", { class: "input", "aria-label": "Status", style: "width:auto;height:30px;padding:0 8px;font-size:.85rem" });
    for (const [k, n] of Object.entries(STATUS_NAMES)) sel.append(h("option", { value: k, text: n, selected: k === s.status }));
    sel.addEventListener("change", async () => {
      try { await postJson(`/api/community/suggestions/${s.id}/status`, { status: sel.value }); reload(); } catch (e) { ctx.toast(e.message); }
    });
    foot.append(sel);
  }
  if (canModerate || s.mine) {
    foot.append(h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Delete", onclick: () => openDialog({
      title: "Delete this suggestion?",
      body: h("p", { class: "text-2", text: s.title }),
      actions: [{ label: "Cancel" }, { label: "Delete", kind: "danger", onClick: async () => { await postJson(`/api/community/suggestions/${s.id}/delete`, {}); reload(); } }],
    }) }));
  }
  return h("article", { class: "panel sg-card" },
    h("div", { class: "sg-votes" }, up, down),
    h("div", { class: "sg-body" }, h("h3", { class: "sg-title", text: s.title }), s.body ? h("p", { class: "sg-text", text: s.body }) : null, foot));
}

function newSuggestion(done) {
  const title = h("input", { class: "input", id: "sg-title", maxlength: 80, placeholder: "e.g. Add a fishing contest" });
  const body = h("textarea", { class: "input", id: "sg-body", maxlength: 500, rows: 4, placeholder: "Details (optional)" });
  const anon = h("input", { type: "checkbox", id: "sg-anon" });
  openDialog({
    title: "New suggestion",
    body: h("div", { class: "form" },
      field("Title", title),
      field("Details", body),
      h("label", { class: "check" }, anon, "Post anonymously ", h("span", { class: "text-3 small", text: "(other players won't see your name; only the server owners can)" }))),
    actions: [{ label: "Cancel" }, {
      label: "Post", kind: "primary",
      onClick: async () => {
        await postJson("/api/community/suggestions", { title: title.value, body: body.value, anonymous: anon.checked });
        ctx.toast("Suggestion posted!");
        done();
      },
    }],
  });
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
    h("section", { class: "panel tk-hero" },
      h("div", { class: "tk-hero-icon" }, iconEl("lifebuoy")),
      h("div", {},
        h("h2", { text: "Need help?" }),
        h("p", { class: "text-2", text: "Open a ticket to chat privately with the staff team: questions, bugs, lost items, reports or appeals. Only you and staff can see it." }),
        h("div", { class: "cp-toolbar" },
          h("button", { class: "btn btn-primary", type: "button", text: "Contact staff", onclick: () => newTicketDialog(ctx.toast, (id) => renderSupport(p, id)) }),
          staff ? h("a", { class: "btn btn-ghost", href: "/staff#tickets", text: "Answer tickets (staff)" }) : null))),
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
