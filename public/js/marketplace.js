// #Marketplace: everything you can buy, sell and earn, organized like an app store.
//   Discover       shelves you swipe sideways: great deals, new in the Auction House, player shops, open jobs
//   Auction House  every listing, sort, price history, price alerts
//   Shops          players' shop chests, bought right here
//   Trades         offers to you, your offers, new offer
//   Jobs           post a job or do one for money
// One search box searches the Auction House and the shops. Tapping an item opens its page as a sheet.
// All text goes in with textContent, never as HTML.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { money, moneyExact } from "/js/money.js";
import { iconEl } from "/js/site.js";

const TABS = [["discover", "Discover"], ["auction", "Auction House"], ["shops", "Shops"], ["trades", "Trades"], ["jobs", "Jobs"]];
const TILE_COLORS = ["#2457eb", "#8a4fd8", "#16a36b", "#d4532f", "#c48a12", "#1d8fb3", "#b8336a"];
const tileColor = (id) => TILE_COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % TILE_COLORS.length];
const eachOf = (l) => l.price / Math.max(1, l.amount);
const dimName = (d) => ({ overworld: "Overworld", nether: "Nether", theend: "The End", the_end: "The End" })[String(d).toLowerCase()] || d || "Overworld";
const timeLeft = (exp) => {
  const s = Math.max(0, exp - Date.now() / 1000);
  const hrs = Math.floor(s / 3600);
  return hrs ? `${hrs}h ${Math.floor((s % 3600) / 60)}m left` : `${Math.floor(s / 60)}m left`;
};
const isDeal = (l) => l.market?.unit && eachOf(l) <= l.market.unit * 0.9;

let toast = () => {};

function tile(id, label, big) {
  const t = h("span", { class: `mk-icon${big ? " big" : ""}`, "aria-hidden": "true", text: String(label).replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?" });
  t.style.background = `linear-gradient(145deg, ${tileColor(id)}, color-mix(in srgb, ${tileColor(id)} 55%, #0a0c1b))`;
  return t;
}
const pill = (text, onClick, disabled) => h("button", { class: "mk-pill", type: "button", text, disabled, onclick: (e) => { e.stopPropagation(); onClick(); } });

// ---------- the data (loaded once, refreshed every 30 seconds) ----------
const data = { ah: null, shops: null, jobs: null, trades: null, alerts: null };
async function loadAll() {
  const [ah, shops, jobs, trades] = await Promise.all([
    getJson("/api/community/auction").catch(() => null), getJson("/api/shops").catch(() => null),
    getJson("/api/jobs").catch(() => null), getJson("/api/trades").catch(() => null)]);
  Object.assign(data, { ah, shops, jobs, trades });
}

// ---------- item pages (sheets) ----------
function ahSheet(l, refresh) {
  const each = eachOf(l);
  const facts = h("div", { class: "mk-facts" },
    fact("Price", money(l.price)), fact("Each", money(each)), fact("Seller", l.seller), fact("Time left", timeLeft(l.expires).replace(" left", "")));
  const market = h("p", { class: "text-2 small", style: "margin:0" });
  if (l.market?.unit) {
    const r = each / l.market.unit;
    market.append(h("span", { class: `ah-deal ${r <= 0.9 ? "good" : r >= 1.15 ? "high" : "fair"}`, text: r <= 0.9 ? "Good price" : r >= 1.15 ? "Above average" : "Fair price" }),
      ` Usually ${money(l.market.unit)} each (last 30 days).`);
  } else market.textContent = "No recent sales of this item to compare with.";
  openDialog({
    title: `${l.amount}x ${l.label}`,
    body: h("div", { class: "form mk-sheet" },
      h("div", { class: "mk-sheet-top" }, tile(l.item, l.label, true), h("div", {}, h("b", { text: l.label }), h("span", { class: "text-3 small", text: "Auction House" }))),
      facts, l.enchants?.length ? h("p", { class: "text-2 small", style: "margin:0", text: `Enchantments: ${l.enchants.join(", ")}` }) : null, market,
      h("div", { class: "mk-links" },
        h("button", { class: "ah-hist", type: "button", text: "Price history", onclick: () => historyDialog(l) }),
        h("button", { class: "ah-hist", type: "button", text: "Alert me when cheaper", onclick: () => alertsDialog(l) })),
      h("p", { class: "note small", style: "margin:0", text: "Paid with your in-game money. It goes straight into your inventory, so you must be online in Minecraft." })),
    actions: [{ label: "Close" }, {
      label: `Buy for ${money(l.price)}`, kind: "primary",
      onClick: async () => { const r = await postJson(`/api/community/auction/${l.id}/buy`, {}); toast(r.message || "Bought."); refresh(); },
    }],
  });
}
const fact = (k, v) => h("div", {}, h("span", { text: k }), h("b", { text: v }));

function shopSheet(s, refresh) {
  const me = data.shops?.me;
  if (!me?.linked) { toast("Link your Minecraft account first (Account > Link)."); return; }
  const max = Math.min(1000, Math.floor(s.stock / s.amount));
  const times = h("input", { class: "input", id: "mk-times", type: "number", min: 1, max, value: 1, inputmode: "numeric" });
  const total = h("p", { class: "sh-total" });
  const update = () => {
    const n = Math.max(1, Math.min(max, Math.floor(Number(times.value) || 1)));
    total.replaceChildren("You get ", h("b", { text: `${(n * s.amount).toLocaleString()}x ${s.name}` }), " for ", h("b", { text: moneyExact(n * s.price) }),
      me.balance != null && n * s.price > me.balance ? h("span", { class: "sh-warn", text: ` You have ${money(me.balance)}.` }) : "");
  };
  times.addEventListener("input", update);
  update();
  openDialog({
    title: s.name,
    body: h("div", { class: "form mk-sheet" },
      h("div", { class: "mk-sheet-top" }, tile(s.item, s.name, true), h("div", {}, h("b", { text: s.name }), h("span", { class: "text-3 small", text: `${s.shop} by ${s.owner}` }))),
      h("div", { class: "mk-facts" }, fact("Price", moneyExact(s.price)), fact("You get", `${s.amount}`), fact("In stock", s.stock.toLocaleString()),
        fact("Where", `${dimName(s.where.dim)} ${s.where.x}, ${s.where.z}`)),
      field(`How many times? (up to ${max})`, times), total,
      h("p", { class: "text-3 small", style: "margin:0", text: "Paid from your in-game balance. The items go into your inventory (if you're offline, the next time you join)." })),
    actions: [{ label: "Close" }, {
      label: "Buy", kind: "primary",
      onClick: async () => {
        const n = Math.max(1, Math.min(max, Math.floor(Number(times.value) || 1)));
        const r = await postJson(`/api/shops/${s.id}/buy`, { times: n, price: s.price, amount: s.amount });
        toast(r.message || "Bought."); refresh();
      },
    }],
  });
}

async function historyDialog(l) {
  let d;
  try { d = await getJson(`/api/community/auction/history?item=${encodeURIComponent(l.item)}`); } catch (e) { toast(e.message); return; }
  const { lineChart } = await import("/js/charts.js");
  const body = h("div", { class: "ah-history" });
  if (!d.summary) body.append(h("p", { class: "text-2", style: "margin:0", text: "This item hasn't sold in the last 30 days, so there's no price history yet." }));
  else {
    body.append(h("div", { class: "ah-hist-stats" },
      h("div", {}, h("span", { text: "Average" }), h("b", { text: money(d.summary.avg) })),
      h("div", {}, h("span", { text: "Lowest" }), h("b", { text: money(d.summary.low) })),
      h("div", {}, h("span", { text: "Highest" }), h("b", { text: money(d.summary.high) })),
      h("div", {}, h("span", { text: "Sales" }), h("b", { text: String(d.summary.sales) }))));
    if (d.days.length > 1) body.append(lineChart({ title: "Average price each, last 30 days", points: d.days.map((x) => ({ label: x.day.slice(5), value: x.unit / 100, tip: [x.day, `${money(x.unit)} each · ${x.sales} sale${x.sales === 1 ? "" : "s"}`] })), format: (v) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` }));
    body.append(h("p", { class: "text-3 small", style: "margin:8px 0 0", text: `This listing: ${money(eachOf(l))} each.` }));
  }
  openDialog({ title: `${l.label}: price history`, body, actions: [{ label: "Close" }] });
}

// Price alerts: a notification (website + in game) when an item is listed at or below your price (each).
const toCents = (v) => Math.round(Number(String(v).replace(/[$,\s]/g, "").replace(/k$/i, "e3").replace(/m$/i, "e6")) * 100);
async function alertsDialog(prefill = null) {
  let d;
  try { d = await getJson("/api/community/auction/alerts"); } catch (e) { toast(e.message); return; }
  if (!d.linked) {
    openDialog({ title: "Price alerts", body: h("p", { class: "text-2", style: "margin:0", text: "Join the server once first, so we know which Minecraft player you are." }), actions: [{ label: "Close" }] });
    return;
  }
  const list = h("div", { class: "ah-alerts" });
  const drawList = (alerts) => {
    data.alerts = alerts;
    list.replaceChildren(...(alerts.length ? alerts.map((a) => h("div", { class: "ah-alert" },
      h("div", {}, h("b", { text: a.label }), h("span", { class: "text-3 small", text: ` · ${money(a.maxEach)} each or less` })),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove", onclick: async () => {
        try { drawList((await postJson("/api/community/auction/alerts", { remove: a.id })).alerts); } catch (e) { toast(e.message); }
      } })))
      : [h("p", { class: "text-3 small", style: "margin:0", text: "No price alerts yet." })]));
  };
  drawList(d.alerts);
  const known = new Map(d.items.map((x) => [x.item, x.label]));
  for (const l of data.ah?.listings || []) if (!known.has(l.item)) known.set(l.item, l.label);
  if (prefill) known.set(prefill.item, prefill.label);
  const options = h("datalist", { id: "ah-alert-items" }, [...known].map(([, label]) => h("option", { value: label })));
  const item = h("input", { class: "input", id: "ah-alert-item", list: "ah-alert-items", maxlength: 80, placeholder: "e.g. Diamond Sword", value: prefill?.label || "" });
  const price = h("input", { class: "input", id: "ah-alert-price", inputmode: "decimal", maxlength: 14, placeholder: "e.g. 500 or 2.5k",
    value: prefill ? String(Math.floor(eachOf(prefill)) / 100) : "" });
  openDialog({
    title: "Price alerts",
    body: h("div", { class: "form" },
      h("p", { class: "text-2", style: "margin:0", text: "Pick an item and the most you'd pay for each one. When someone lists it at or below that price, you get a notification here and in game." }),
      list, options,
      field("Item", item), field("Most you'd pay (each)", price, `Up to ${d.max} alerts. Setting an item again changes its price.`)),
    actions: [{ label: "Close" }, {
      label: "Add alert", kind: "primary",
      onClick: async () => {
        const name = item.value.trim().toLowerCase();
        const hit = [...known].find(([id, label]) => label.toLowerCase() === name || id === name || id === `minecraft:${name.replace(/ /g, "_")}`);
        const id = hit ? hit[0] : `minecraft:${name.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
        const cents = toCents(price.value);
        if (!name) throw new Error("Choose an item.");
        if (!(cents > 0)) throw new Error("Enter the most you'd pay for each one, like 500 or 2.5k.");
        const r = await postJson("/api/community/auction/alerts", { item: id, label: hit ? hit[1] : item.value.trim(), maxEach: cents });
        drawList(r.alerts);
        toast(r.forSale ? `Alert saved. ${r.forSale} already for sale at that price.` : "Alert saved. We'll let you know.");
        item.value = ""; price.value = "";
        return false;
      },
    }],
  });
}

// ---------- building blocks ----------
// A shelf: title, "See all", and cards you swipe sideways.
function shelf(title, sub, cards, seeAll) {
  if (!cards.length) return null;
  return h("section", { class: "mk-shelf" },
    h("div", { class: "mk-shelf-head" }, h("div", {}, h("h2", { text: title }), sub ? h("p", { text: sub }) : null),
      seeAll ? h("button", { class: "mk-see", type: "button", text: "See all", onclick: seeAll }) : null),
    h("div", { class: "mk-row", role: "list" }, cards));
}
function card({ id, label, title, sub, price, badge, onOpen, onBuy, buyText = "Buy", off }) {
  return h("article", { class: `mk-card${off ? " off" : ""}`, role: "listitem", tabindex: 0, onclick: onOpen,
    onkeydown: (e) => { if (e.key === "Enter") onOpen(); } },
    h("div", { class: "mk-card-top" }, tile(id, label, true), badge ? h("span", { class: `mk-badge ${badge[0]}`, text: badge[1] }) : null),
    h("b", { class: "mk-card-title", text: title }), h("span", { class: "mk-card-sub", text: sub }),
    h("div", { class: "mk-card-foot" }, h("span", { class: "mk-price", text: price }), onBuy ? pill(buyText, onBuy, off) : null));
}
// A row in a list (like an App Store search result).
function row({ id, label, title, sub, meta, price, onOpen, buyText = "Buy", off }) {
  return h("article", { class: `mk-item${off ? " off" : ""}`, tabindex: 0, onclick: onOpen, onkeydown: (e) => { if (e.key === "Enter") onOpen(); } },
    tile(id, label), h("div", { class: "mk-item-main" }, h("b", { text: title }), h("span", { text: sub }), meta || null),
    h("div", { class: "mk-item-end" }, h("span", { class: "mk-price", text: price }), pill(buyText, onOpen, off)));
}

// ---------- the Marketplace ----------
export function renderMarketplace(root, helpers) {
  toast = helpers.toast;
  const st = { tab: TABS.some(([k]) => k === helpers.sub) ? helpers.sub : "discover", q: "", ahSort: "new", shopSort: "name" };
  const balance = h("span", { class: "mk-balance" });
  const search = h("input", { class: "input mk-search", type: "search", placeholder: "Search items, shops and players", "aria-label": "Search the Marketplace", maxlength: 60 });
  const seg = h("div", { class: "mk-seg", role: "tablist", "aria-label": "Marketplace" });
  const body = h("div", { class: "mk-body" });
  const wrap = h("div", { class: "mk" },
    h("header", { class: "mk-head" }, h("div", {}, h("p", { class: "mk-eyebrow", text: "GalaxySMP" }), h("h1", { text: "Marketplace" })), balance),
    h("div", { class: "mk-searchbar" }, iconEl("search"), search), seg, body);
  root.append(wrap);

  let jobsTimer = null, tradesRefresh = null, drawn = null;
  const go = (tab) => {
    st.tab = tab;
    try { history.replaceState(history.state, "", `#marketplace${tab === "discover" ? "" : `/${tab}`}`); } catch { /* ignore */ }
    draw(true);
    root.scrollTop = 0;
  };
  for (const [k, label] of TABS) seg.append(h("button", { type: "button", role: "tab", "data-k": k, text: label, onclick: () => go(k) }));

  const refresh = async () => { await loadAll(); draw(false); };

  function draw(force) {
    seg.querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.k === st.tab));
      if (b.dataset.k === st.tab && seg.scrollWidth > seg.clientWidth) seg.scrollTo({ left: b.offsetLeft - (seg.clientWidth - b.offsetWidth) / 2, behavior: "smooth" });
    });
    const bal = data.shops?.me?.balance;
    balance.textContent = bal != null ? money(bal) : "";
    balance.hidden = bal == null;
    balance.title = "Your in-game balance";
    search.closest(".mk-searchbar").hidden = st.tab === "trades" || st.tab === "jobs";
    // Trades and Jobs keep their own state, so they're only built when you open the tab.
    if (!force && (st.tab === "trades" || st.tab === "jobs") && drawn === st.tab) return;
    if (jobsTimer) { clearInterval(jobsTimer); jobsTimer = null; }
    tradesRefresh = null;
    drawn = st.tab;
    body.replaceChildren();
    if (st.tab === "trades") {
      import("/js/trades.js").then((m) => { tradesRefresh = m.mountTrades(body, { toast, start: helpers.tradeTab }); });
    } else if (st.tab === "jobs") {
      import("/js/community-jobs.js").then((m) => m.renderJobs(body, { toast, setTimer: (t) => { jobsTimer = t; } }));
    } else if (st.q && st.tab === "discover") body.append(results());
    else body.append(({ discover, auction: auctionTab, shops: shopsTab })[st.tab]());
  }

  // Search results across the Auction House and the shops
  function results() {
    const q = st.q.toLowerCase();
    const ah = (data.ah?.listings || []).filter((l) => `${l.label} ${l.item} ${l.seller}`.toLowerCase().includes(q));
    const sh = (data.shops?.shops || []).filter((s) => `${s.name} ${s.item} ${s.owner} ${s.shop}`.toLowerCase().includes(q));
    const box = h("div", { class: "mk-results" });
    if (!ah.length && !sh.length) box.append(h("div", { class: "panel empty", text: "Nothing matches that. Try another name, or set a price alert in the Auction House." }));
    if (ah.length) box.append(h("h2", { class: "mk-h2", text: "Auction House" }), h("div", { class: "mk-list" }, ah.map(ahRow)));
    if (sh.length) box.append(h("h2", { class: "mk-h2", text: "Shops" }), h("div", { class: "mk-list" }, sh.map(shopRow)));
    return box;
  }
  const ahRow = (l) => row({ id: l.item, label: l.label, title: `${l.amount}x ${l.label}`, sub: `${l.seller} · ${timeLeft(l.expires)}`,
    meta: isDeal(l) ? h("span", { class: "ah-deal good", text: "Good price" }) : l.enchants?.length ? h("span", { class: "mk-ench", text: l.enchants.join(", ") }) : null,
    price: money(l.price), onOpen: () => ahSheet(l, refresh) });
  const shopRow = (s) => {
    const out = s.stock < s.amount;
    return row({ id: s.item, label: s.name, title: s.name, sub: `${s.amount} for ${moneyExact(s.price)} · ${s.shop} by ${s.owner}`,
      meta: h("span", { class: `mk-stock${out ? " none" : ""}`, text: out ? "Out of stock" : `${s.stock.toLocaleString()} in stock` }),
      price: money(s.price), buyText: s.mine ? "Yours" : out ? "Sold out" : "Buy", off: out || s.mine, onOpen: () => (out || s.mine ? null : shopSheet(s, refresh)) });
  };

  function discover() {
    const box = h("div", { class: "mk-discover" });
    if (!data.ah && !data.shops) { box.append(h("div", { class: "panel empty", text: "Loading the Marketplace…" })); return box; }
    // For you: things waiting on you
    const waiting = (data.trades?.trades || []).filter((t) => t.incoming && t.status === "pending").length;
    const myJobs = (data.jobs?.jobs || []).filter((j) => j.posterId === data.jobs.userId && j.status === "submitted").length;
    const chips = [
      waiting ? h("button", { class: "mk-chip hot", type: "button", onclick: () => go("trades") }, iconEl("handshake"), `${waiting} trade offer${waiting === 1 ? "" : "s"} for you`) : null,
      myJobs ? h("button", { class: "mk-chip hot", type: "button", onclick: () => go("jobs") }, iconEl("briefcase"), `${myJobs} job${myJobs === 1 ? "" : "s"} to check`) : null,
      h("button", { class: "mk-chip", type: "button", onclick: () => alertsDialog() }, iconEl("bell"), "Price alerts"),
      h("button", { class: "mk-chip", type: "button", onclick: () => { helpers.tradeTab = "new"; go("trades"); } }, iconEl("handshake"), "Offer a trade"),
    ].filter(Boolean);
    box.append(h("div", { class: "mk-chips" }, chips));

    const listings = data.ah?.listings || [];
    const deals = listings.filter(isDeal).sort((a, b) => eachOf(a) / a.market.unit - eachOf(b) / b.market.unit).slice(0, 12);
    const ahCard = (l) => card({ id: l.item, label: l.label, title: `${l.amount}x ${l.label}`, sub: l.seller, price: money(l.price),
      badge: isDeal(l) ? ["good", `${Math.round((1 - eachOf(l) / l.market.unit) * 100)}% off`] : null, onOpen: () => ahSheet(l, refresh), onBuy: () => ahSheet(l, refresh) });
    const shopItems = (data.shops?.shops || []).filter((s) => s.stock >= s.amount && !s.mine).slice(0, 12);
    const openJobs = (data.jobs?.jobs || []).filter((j) => j.status === "open" && j.posterId !== data.jobs.userId).slice(0, 10);

    box.append(
      ...[shelf("Great deals", "Listed below what it usually sells for.", deals.map(ahCard), () => { st.ahSort = "deals"; go("auction"); }),
        shelf("New in the Auction House", `${listings.length} item${listings.length === 1 ? "" : "s"} for sale`, listings.slice(0, 12).map(ahCard), () => go("auction")),
        shelf("From player shops", "Buy from shop chests without walking to the Shop District.", shopItems.map((s) => card({ id: s.item, label: s.name, title: s.name,
          sub: `${s.amount} · ${s.owner}`, price: moneyExact(s.price), onOpen: () => shopSheet(s, refresh), onBuy: () => shopSheet(s, refresh) })), () => go("shops")),
        shelf("Jobs you can take", "Help another player and get paid.", openJobs.map((j) => card({ id: `job${j.id}`, label: j.title, title: j.title,
          sub: `Posted by ${j.poster}`, price: moneyExact(j.reward), onOpen: () => go("jobs"), onBuy: () => go("jobs"), buyText: "View" })), () => go("jobs"))].filter(Boolean),
      h("section", { class: "mk-hero", onclick: () => { helpers.tradeTab = "new"; go("trades"); } },
        h("div", {}, h("p", { class: "mk-eyebrow", text: "Trades" }), h("h2", { text: "Sell straight to a friend" }),
          h("p", { text: "Pick an item from your inventory, name your price, and they accept on the website or in game." })),
        h("span", { class: "mk-pill light", text: "New offer" })));
    if (!listings.length && !shopItems.length && !openJobs.length) {
      box.append(h("div", { class: "panel empty", text: "Nothing for sale yet. Sell something in game with /ah sell <price>, or open a shop chest in the Shop District." }));
    }
    return box;
  }

  function auctionTab() {
    const box = h("div", { class: "mk-tab" });
    const sorts = [["new", "Newest"], ["cheap", "Cheapest"], ["deals", "Best deals"]];
    const sortSeg = h("div", { class: "seg mk-subseg", role: "group", "aria-label": "Sort" },
      sorts.map(([k, label]) => h("button", { type: "button", "aria-pressed": String(st.ahSort === k), text: label, onclick: () => { st.ahSort = k; draw(true); } })));
    const alerts = h("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: () => alertsDialog() }, iconEl("bell"), "Price alerts");
    const q = st.q.toLowerCase();
    let list = (data.ah?.listings || []).filter((l) => !q || `${l.label} ${l.item} ${l.seller}`.toLowerCase().includes(q));
    if (st.ahSort === "cheap") list = [...list].sort((a, b) => a.price - b.price);
    if (st.ahSort === "deals") list = [...list].sort((a, b) => (a.market?.unit ? eachOf(a) / a.market.unit : 9) - (b.market?.unit ? eachOf(b) / b.market.unit : 9));
    box.append(h("div", { class: "mk-toolbar" }, sortSeg, alerts),
      h("p", { class: "text-3 small mk-lead", text: data.ah?.updated ? `${list.length} item${list.length === 1 ? "" : "s"} · sell yours in game with /ah sell <price>` : "Waiting for the Minecraft server to send its listings." }),
      list.length ? h("div", { class: "mk-list" }, list.map(ahRow)) : h("div", { class: "panel empty", text: q ? "Nothing matches that." : "Nothing is for sale right now." }));
    return box;
  }

  function shopsTab() {
    const box = h("div", { class: "mk-tab" });
    if (data.shops === null) { box.append(h("div", { class: "panel empty", text: "Shops couldn't be loaded." })); return box; }
    const sorts = [["name", "A to Z"], ["cheap", "Cheapest"], ["stock", "Most in stock"]];
    const sortSeg = h("div", { class: "seg mk-subseg", role: "group", "aria-label": "Sort" },
      sorts.map(([k, label]) => h("button", { type: "button", "aria-pressed": String(st.shopSort === k), text: label, onclick: () => { st.shopSort = k; draw(true); } })));
    const q = st.q.toLowerCase();
    let list = data.shops.shops.filter((s) => !q || `${s.name} ${s.item} ${s.owner} ${s.shop}`.toLowerCase().includes(q));
    if (st.shopSort === "cheap") list = [...list].sort((a, b) => a.price / a.amount - b.price / b.amount);
    if (st.shopSort === "stock") list = [...list].sort((a, b) => b.stock - a.stock);
    box.append(h("div", { class: "mk-toolbar" }, sortSeg),
      h("p", { class: "text-3 small mk-lead", text: "Shop chests from Galaxy+ and Galaxy Pro+ members. Every one is still open in game in the Shop District." }),
      list.length ? h("div", { class: "mk-list" }, list.map(shopRow))
        : h("div", { class: "panel empty", text: data.shops.shops.length ? "No shops match that." : "No shops are listed right now. Check back soon, or visit the Shop District in game." }));
    return box;
  }

  let typing = null;
  search.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => { st.q = search.value.trim(); draw(true); }, 120);
  });

  draw(true);
  refresh().then(() => draw(true));
  const timer = setInterval(() => {
    if (document.hidden || document.querySelector("dialog[open]")) return;
    if (st.tab === "trades") tradesRefresh?.();
    else if (st.tab !== "jobs") refresh();
  }, 30000);
  helpers.setCleanup?.(() => { clearInterval(timer); if (jobsTimer) clearInterval(jobsTimer); });
}
