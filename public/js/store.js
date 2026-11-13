// Store page: Subscriptions (monthly plans) and Shop (one-time items), with a checkout window
// that takes promo codes (and tells members about promo codes made just for them).
import { toast, iconEl } from "/js/site.js";
import { rankTag } from "/js/rank-paint.js";
import { moneyDollars } from "/js/money.js";
import { h, openDialog, postJson } from "/js/dialog.js";
import { faceSvg } from "/js/face.js";

const usd = (n) => `$${Number(n).toFixed(2)}`;
let data = null;   // /api/store/plans
let me = { signedIn: false, owned: {}, promos: [] }; // /api/store/mine

// ---------- What can be bought ----------
const itemOnSale = (cat) => (data.onSale || []).includes(cat.id);
const ownedCount = (id) => me.owned?.[id] || 0;
// Wishlist heart (like Discord's): saves the item to your wishlist, which shows on your profile so friends can gift it.
function heart(key, name) {
  const on = () => (me.wishlist || []).includes(key);
  const b = h("button", { class: "wish-btn", type: "button" }, iconEl("heart"));
  const sync = () => { b.classList.toggle("on", on()); b.setAttribute("aria-pressed", String(on())); b.setAttribute("aria-label", on() ? `Remove ${name} from your wishlist` : `Add ${name} to your wishlist`); b.title = on() ? "On your wishlist" : "Add to wishlist"; };
  sync();
  b.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!me.signedIn) return toast("Sign in to make a wishlist.");
    try {
      const r = await postJson("/api/wishlist", { item: key, on: !on() });
      me.wishlist = r.wishlist;
      document.querySelectorAll(`.wish-btn[data-key="${CSS.escape(key)}"]`).forEach((x) => x.dispatchEvent(new Event("wish-sync")));
      toast(r.message);
    } catch (err) { toast(err.message); }
  });
  b.dataset.key = key;
  b.addEventListener("wish-sync", sync);
  return b;
}
const promoFits = (p, tags) => !p.targets?.length || p.targets.some((t) => tags.includes(t));
const priceAfter = (p, price) => {
  let f = price;
  if (p.kindRaw === "percent") f = Math.round(price * (100 - p.value)) / 100;
  else if (p.kindRaw === "amount") f = price - p.value / 100;
  else f = 0;
  f = Math.max(0, f);
  if (f > 0 && f < 0.5) f = 0.5;
  return Math.min(price, f);
};

// Coming from "Gift" in the community (+ menu): the Store opens with that member picked as the gift receiver.
const giftParams = new URLSearchParams(location.search);
const presetGift = giftParams.get("gift") && giftParams.get("giftName") ? { id: Number(giftParams.get("gift")), username: giftParams.get("giftName") } : null;
if (presetGift) {
  setTimeout(() => {
    const note = h("div", { class: "panel gift-note" }, iconEl("gift"), h("span", {}, "Pick something to gift to ", h("b", { text: presetGift.username }), ". It goes to their Minecraft account."));
    (document.getElementById("shop") || document.querySelector("main .container"))?.prepend(note);
  }, 0);
}

// ---------- Checkout window ----------
function checkout({ id, option, name, price, icon, cat, tags, isPlan }) {
  if (!me.signedIn) {
    location.href = "/community";
    return;
  }
  const mine = (me.promos || []).filter((p) => promoFits(p, tags) && (p.kindRaw !== "first_month" || isPlan));
  let applied = null; // { code, label, final }

  const total = h("span", { class: "co-total-amount" });
  const was = h("s", { class: "co-was text-3" });
  const appliedRow = h("div", { class: "co-applied", hidden: true });
  const codeInput = h("input", { class: "input", id: "co-code", placeholder: "Promo code", maxlength: 32, autocomplete: "off", autocapitalize: "characters" });
  const applyBtn = h("button", { class: "btn btn-secondary", type: "button", text: "Apply" });
  const codeRow = h("div", { class: "co-code-row" }, codeInput, applyBtn);
  const payBtn = h("button", { class: "btn btn-primary co-pay", type: "button" });     // credits (or free)
  const cardBtn = h("button", { class: "btn btn-secondary co-pay", type: "button" }); // card
  const creditNote = h("p", { class: "co-credit-note text-3 small" });
  const err = h("p", { class: "form-error", role: "alert" });
  const have = me.infinite ? Infinity : Number(me.credits || 0);
  // "Gift to someone": pick a member; they get it in game and it counts toward the Gifter badges
  let giftTo = null;
  const giftToggle = h("input", { type: "checkbox", id: "co-gift" });
  const giftBox = h("div", { class: "co-gift-box", hidden: true });
  const giftSearch = h("input", { class: "input", id: "co-gift-to", placeholder: "Who is it for? Type their name", autocomplete: "off", maxlength: 32, autocapitalize: "off", spellcheck: "false" });
  const giftList = h("div", { class: "gift-list", role: "listbox", "aria-label": "Members" });
  const giftPicked = h("div", { class: "gift-picked", hidden: true });
  const gface = (m) => { const img = h("img", { class: "gift-face", alt: "", width: 28, height: 28 }); img.src = m.head || faceSvg(m.username); img.addEventListener("error", () => { img.src = faceSvg(m.username); }, { once: true }); return img; };
  const pickGift = (m) => {
    giftTo = m;
    giftSearch.hidden = true; giftList.replaceChildren();
    giftPicked.replaceChildren(gface(m), h("span", {}, "A gift for ", h("b", { text: m.username })),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Change", onclick: () => { giftTo = null; giftPicked.hidden = true; giftSearch.hidden = false; giftSearch.value = ""; giftSearch.focus(); } }));
    giftPicked.hidden = false;
  };
  let gTimer = null;
  giftSearch.addEventListener("input", () => {
    clearTimeout(gTimer);
    const q = giftSearch.value.trim();
    if (q.length < 2) { giftList.replaceChildren(); return; }
    gTimer = setTimeout(async () => {
      let d;
      try { d = await (await fetch(`/api/store/members?q=${encodeURIComponent(q)}`, { credentials: "same-origin" })).json(); } catch { return; }
      if (giftTo) return;
      giftList.replaceChildren(...(d.members?.length ? d.members.map((m) => h("button", { class: "gift-option", type: "button", role: "option", onclick: () => pickGift(m) }, gface(m), h("span", { text: m.username })))
        : [h("p", { class: "text-3 small gift-hint", text: "No members start with that." })]));
    }, 200);
  });
  giftBox.append(giftSearch, giftPicked, giftList, h("p", { class: "text-3 small", style: "margin:4px 0 0", text: "They get it on their Minecraft account. You pay." }));
  giftToggle.addEventListener("change", () => { giftBox.hidden = !giftToggle.checked; if (!giftToggle.checked) giftTo = null; else giftSearch.focus(); });
  if (presetGift) { giftToggle.checked = true; giftBox.hidden = false; pickGift(presetGift); }

  const draw = () => {
    const final = applied ? applied.final : price;
    total.textContent = final === 0 ? "Free" : usd(final);
    was.textContent = applied ? usd(price) : "";
    was.hidden = !applied;
    appliedRow.hidden = !applied;
    codeRow.hidden = Boolean(applied);
    if (offer) offer.hidden = Boolean(applied);
    if (applied) {
      const remove = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove" });
      remove.addEventListener("click", () => { applied = null; draw(); });
      appliedRow.replaceChildren(iconEl("tag"), h("span", { class: "co-applied-text" }, h("b", { text: applied.code }), ` · ${applied.label}`), remove);
    }
    const enough = have >= final;
    if (final === 0) {
      payBtn.textContent = "Get it free";
      payBtn.disabled = false;
      cardBtn.hidden = true;
      creditNote.textContent = "";
    } else {
      payBtn.textContent = me.infinite ? "Get it (free for the owner)" : enough ? `Pay ${usd(final)} with credits` : "Top up credits";
      payBtn.disabled = false;
      payBtn.dataset.topup = enough ? "" : "1";
      cardBtn.hidden = !me.cards || me.infinite;
      cardBtn.textContent = `Pay ${usd(Math.max(0.5, final))} with card`;
      cardBtn.className = "btn btn-secondary co-pay";
      creditNote.replaceChildren(me.infinite ? "You have unlimited credits as the owner. " : `You have ${usd(have)} of credits. `,
        me.infinite ? "" : enough ? `${usd(have - final)} left after this.` : "Top up once and buy in one tap next time.");
    }
  };

  async function apply(code) {
    err.textContent = "";
    applyBtn.disabled = true;
    try {
      const r = await postJson("/api/store/promo", { code, item: id, option: option() });
      applied = { code: r.promo.code, label: r.promo.label, final: r.final };
      draw();
    } catch (e) {
      err.textContent = e.message;
    } finally {
      applyBtn.disabled = false;
    }
  }
  applyBtn.addEventListener("click", () => apply(codeInput.value));
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(codeInput.value); } });

  const pay = async (method, btn) => {
    err.textContent = "";
    btn.disabled = true;
    try {
      if (giftToggle.checked && !giftTo) throw new Error("Pick who the gift is for, or turn off gifting.");
      const r = await postJson("/api/store/checkout", { item: id, option: option(), code: applied?.code || "", method, giftTo: giftTo?.id || null });
      if (r.url) { location.href = r.url; return; } // Stripe's secure card page
      if (r.done) {
        dlg.close();
        await refreshMine();
        renderAll();
        celebrate(name, r.message, Boolean(giftTo));
        return;
      }
      err.textContent = r.message || "Payments open soon.";
    } catch (e) {
      err.textContent = e.message;
    } finally {
      btn.disabled = false;
      draw();
    }
  };
  payBtn.addEventListener("click", () => {
    if (payBtn.dataset.topup) { dlg.close(); document.getElementById("credits").scrollIntoView({ behavior: "smooth" }); return; }
    pay("credits", payBtn);
  });
  cardBtn.addEventListener("click", () => pay("card", cardBtn));

  // "You have a promo code!" pop-up for promos made just for this member
  const offer = mine[0] ? h("div", { class: "co-offer", role: "status" },
    h("div", { class: "co-offer-icon" }, iconEl("gift")),
    h("div", { class: "co-offer-text" },
      h("b", { text: mine.length > 1 ? `You have ${mine.length} promo codes!` : "You have a promo code!" }),
      h("span", { class: "small", text: `${mine[0].code} · ${mine[0].label}${mine[0].expires ? ` · ends ${new Date(mine[0].expires).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}` })),
    (() => {
      const b = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Use it" });
      b.addEventListener("click", () => apply(mine[0].code));
      return b;
    })()) : null;

  const body = h("div", { class: "co" },
    offer,
    h("div", { class: `co-item cat-${cat}` },
      h("div", { class: "shop-icon" }, iconEl(icon)),
      h("div", { class: "co-item-text" }, h("b", { text: name }), h("span", { class: "text-3 small", text: isPlan ? "30 days (buy again to add more)" : "One-time purchase" }))),
    h("label", { class: "check co-gift" }, giftToggle, iconEl("gift"), "Gift to someone"), giftBox,
    codeRow, appliedRow,
    h("div", { class: "co-total" }, h("span", { class: "text-2", text: "Total" }), h("span", {}, was, " ", total)),
    err,
    h("div", { class: "co-pay-row" }, payBtn, cardBtn),
    creditNote,
    h("p", { class: "co-fine text-3 small" }, iconEl("lock2"), "Card payments are handled securely by Stripe. We never see your card. Under 18? Ask a parent or guardian first."));
  const { dialog: dlg } = openDialog({ title: "Checkout", body, actions: [] });
  dlg.classList.add("co-dialog");
  draw();
}

function celebrate(name, message, gift = false) {
  openDialog({
    title: gift ? "Gift sent." : "It's yours!",
    body: h("div", { class: "co-done" }, h("div", { class: "co-done-icon" }, iconEl("check")), h("p", { class: "text-2", text: message || `${name} is yours!` }),
      h("p", { class: "text-3 small", text: "Pick cosmetics in game with /cosmetics." })),
    actions: [{ label: "Done", kind: "primary" }],
  });
}

// ---------- Ranks (plans) ----------
const usdShort = (n) => (Number(n) % 1 ? usd(n) : `$${Number(n)}`);
// The 4 perks each plan card shows (the full list is in "Compare all plans"). Keep in step with plans.json.
const HIGHLIGHTS = {
  free: ["1 plot, 1 shop plot and 1 home", "Daily rewards, quests and achievements", "Voice chat and community chat", "Season Pass free track"],
  plus: ["GALAXY+ badge in chat and above your head", "3 plots, 2 shop plots and 5 homes", "+25% daily rewards", "Pictures and polls in community chat"],
  pro: ["PRO+ badge in chat and above your head", "Your own profile picture and custom status", "5 plots, 10 homes and your own public warp", "+50% daily rewards and the Pro+ Season Pass track"],
};
// Everything side by side: [feature, Free, Galaxy+, Pro+]. true = included, false = not included.
const COMPARE = [
  ["Looks", [
    ["Rank badge", false, "GALAXY+", "PRO+"],
    ["Particle trails", false, "Sparkle", "Sparkle + Galaxy"],
    ["Firework when you join", false, false, true],
    ["Profile banner", false, true, true],
    ["Your own profile picture", false, false, true],
    ["Custom status on your profile", false, false, true],
  ]],
  ["Land & homes", [
    ["Plots", "1", "3", "5"],
    ["Shop plots", "1", "2", "3"],
    ["Homes", "1", "5", "10"],
    ["Elevators in your plots", false, "2", "4"],
    ["Your own public warp", false, false, true],
  ]],
  ["Money & rewards", [
    ["Auction House listings", "10", "20", "30"],
    ["Daily rewards bonus", false, "+25%", "+50%"],
    ["Season Pass", "Free track", "Free track", "Free + Pro+ tracks"],
  ]],
  ["Community", [
    ["Pictures and polls in community chat", false, true, true],
    ["Host your own events", false, true, true],
    ["Event access", "Standard", "Level 2", "Priority"],
    ["Support", "Standard", "Level 2", "Priority"],
  ]],
];
function buyPlan(plan) {
  checkout({ id: plan.id, option: () => null, name: plan.name, price: plan.price, icon: "star", cat: "plan", tags: ["subs", `plan:${plan.id}`], isPlan: true });
}
// One sideways-scrolling row of cards ("shelf"), with arrow buttons on computers.
function shelf(el, cards) {
  el.replaceChildren(...cards);
  const wrap = el.parentElement;
  if (!wrap?.classList.contains("ap-shelf-wrap") || wrap.querySelector(".ap-arrow")) return;
  const arrow = (dir) => {
    const b = h("button", { class: `ap-arrow ${dir}`, type: "button", "aria-label": dir === "prev" ? "Scroll back" : "Scroll forward" }, iconEl("arrow"));
    b.addEventListener("click", () => el.scrollBy({ left: (dir === "prev" ? -1 : 1) * el.clientWidth * 0.8, behavior: "smooth" }));
    return b;
  };
  wrap.append(arrow("prev"), arrow("next"));
}
const PLAN_ICON = { free: "user", plus: "star", pro: "gem" };
function renderPlans() {
  const sellable = (data.onSale || []).includes("plans");
  const cards = data.plans.map((plan) => {
    const current = me.signedIn && me.linked && (me.plan || "free") === plan.id;
    const card = h("article", { class: `ap-card ap-plan plan-${plan.id}${current ? " is-current" : ""}` });
    if (plan.price) card.append(heart(plan.id, plan.name));
    const kicker = current ? "Your plan" : plan.id === "pro" ? "Best value" : plan.price ? "Popular" : "Included";
    let buy;
    if (!plan.price) buy = h("a", { class: "ap-buy ghost", href: "/join", text: "Get started" });
    else if (!sellable) buy = h("span", { class: "ap-buy soon", text: "Coming soon" });
    else {
      buy = h("button", { class: "ap-buy", type: "button", text: current ? "Renew" : "Buy" });
      buy.addEventListener("click", () => buyPlan(plan));
    }
    card.append(...[
      h("span", { class: `ap-kicker${current ? " current" : ""}`, text: kicker }),
      h("h3", { class: "ap-name", text: plan.name }),
      h("p", { class: "ap-tagline", text: plan.id === "pro" ? "Every perk we offer." : plan.id === "plus" ? "More land, more style." : "Everything you need to play." }),
      stage(plan.id, `plan-${plan.id}`),
      plan.tag ? h("div", { class: "ap-plan-tag" }, rankTag(plan.tag)) : null,
      h("ul", { class: "ap-perks" }, ...(HIGHLIGHTS[plan.id] || []).map((t) => h("li", { text: t }))),
      h("button", { class: "ap-link", type: "button", onclick: () => perksDialog(plan) }, `See all ${(plan.perkGroups || []).reduce((n, g) => n + g.items.length, 0) || ""} perks`.replace("  ", " "), iconEl("arrow")),
      h("div", { class: "ap-foot" },
        h("div", { class: "ap-price" }, h("b", { text: plan.price ? `${usdShort(plan.price)}/mo.` : "Free" }), plan.price ? h("small", { text: `plus ${moneyDollars(plan.gameCost)} in game` }) : null),
        buy)].filter(Boolean));
    return card;
  });
  shelf(document.getElementById("plans"), cards);
  renderCompare();
}

// Every perk of a plan, grouped (from plans.json)
function perksDialog(plan) {
  const groups = plan.perkGroups || [{ name: "Perks", items: plan.perks || [] }];
  openDialog({
    title: plan.name,
    body: h("div", { class: "ap-perks-all" },
      plan.includes ? h("p", { class: "text-2", style: "margin:0 0 6px", text: plan.includes }) : null,
      ...groups.map((g) => h("section", {}, h("h4", { text: g.name }), h("ul", {}, ...g.items.map((t) => h("li", {}, iconEl("check"), h("span", { text: t }))))))),
    actions: [{ label: "Close" }, ...(plan.price && (data.onSale || []).includes("plans") ? [{ label: `Buy ${plan.name.replace(/^Galaxy /, "")}`, kind: "primary", onClick: () => { buyPlan(plan); } }] : [])],
  });
}

function renderCompare() {
  const box = document.getElementById("plan-compare");
  if (!box) return;
  const cell = (v) => (v === true ? h("td", { class: "yes" }, iconEl("check"), h("span", { class: "sr-only", text: "Included" }))
    : v === false ? h("td", { class: "no" }, h("span", { "aria-hidden": "true", text: "–" }), h("span", { class: "sr-only", text: "Not included" }))
      : h("td", { text: v }));
  const names = data.plans.map((p) => p.name.replace(/^Galaxy /, ""));
  const table = h("table", { class: "st-compare" },
    h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "" }), ...names.map((n) => h("th", { scope: "col", text: n })))),
    h("tbody", {},
      h("tr", { class: "price" }, h("th", { scope: "row", text: "Price" }), ...data.plans.map((p) => h("td", { text: p.price ? `${usdShort(p.price)}/mo` : "Free" }))),
      ...COMPARE.flatMap(([group, rows]) => [
        h("tr", { class: "group" }, h("th", { colspan: 4, scope: "colgroup", text: group })),
        ...rows.map(([name, ...vals]) => h("tr", {}, h("th", { scope: "row", text: name }), ...vals.map(cell))),
      ])));
  const det = h("details", { class: "st-compare-box" }, h("summary", {}, h("span", { text: "Compare all plans" }), iconEl("arrow")),
    h("div", { class: "st-compare-scroll" }, table),
    h("p", { class: "text-3 small", style: "margin:10px 0 0", text: "Paid plans also cost $1K of in-game money a month, taken automatically while you play." }));
  box.replaceChildren(det);
}

// ---------- Shop: one shelf per category ----------
let filter = "all";
const CAT_NAMES = { devices: "Galaxy Cube", money: "Money", plots: "Land", effects: "Effects", cosmetics: "Cosmetics" };
const CAT_LINES = {
  devices: "Our first device. Coming soon.",
  money: "Added to your balance instantly.",
  plots: "More room to build. Yours to keep.",
  effects: "Handy boosts that last while you play.",
  cosmetics: "Stand out wherever you go.",
};
const CAT_ICON = { devices: "cube", money: "coins", plots: "homes", effects: "moon", cosmetics: "sparkles" };
// Pixel-art graphics (the same set as the rank badges) for every plan, category and item.
const PIX = {
  free: "tree", plus: "star", pro: "wingeddiamond",
  money_1k: "coin", money_10k: "goldingot", money_100k: "moneybag", money_1m: "crown",
  extra_plot: "tree", extra_shop_plot: "flag", night_vision: "potion",
  trail_hearts: "heart", trail_flames: "flame", trail_notes: "music", trail_stars: "shootingstar", trail_soul: "ghost",
  trail_cherry: "flower", trail_sparkle: "amethyst", trail_galaxy: "planet", join_firework: "rocket", join_sound: "bell", join_message: "book",
  galaxy_cube: "gamepad", credits: "emerald",
  cat_ranks: "wingeddiamond", cat_devices: "gamepad", cat_money: "coin", cat_plots: "tree", cat_effects: "potion", cat_cosmetics: "heart", cat_credits: "emerald",
};
const pix = (key, size = 96, cls = "ap-pix") => {
  const img = h("img", { class: cls, alt: "", width: size, height: size, loading: "lazy", decoding: "async" });
  img.src = ["", "img", "ranks", `rank_${PIX[key] || "gift"}.png`].join("/");
  return img;
};
// The picture area of a card: the pixel art on a soft colored stage
const stage = (key, tone) => h("div", { class: `ap-stage tone-${tone}` }, pix(key), h("span", { class: "ap-floor" }));
function renderFilters() { /* categories are shelves now */ }

// Sticky category bar: always visible while you scroll, and shows which section you're in.
function renderCats() {
  const nav = document.getElementById("ap-cats");
  if (!nav) return;
  const target = (id) => (id === "ranks" ? "subscriptions" : id === "credits" ? "credits" : `shelf-${id}`);
  const items = [["ranks", "Ranks"], ...data.shop.map((c) => [c.id, CAT_NAMES[c.id] || c.name]), ["credits", "Credits"]];
  nav.replaceChildren(...items.map(([id, name]) => h("a", { class: "ap-cat", href: `#${target(id)}`, "data-target": target(id),
    onclick: (e) => { e.preventDefault(); document.getElementById(target(id))?.scrollIntoView({ behavior: "smooth", block: "start" }); } },
    pix(`cat_${id}`, 22, "ap-cat-pix"), h("span", { text: name }))));
  const links = [...nav.querySelectorAll(".ap-cat")];
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      links.forEach((l) => l.classList.toggle("active", l.dataset.target === en.target.id));
      const on = links.find((l) => l.dataset.target === en.target.id);
      if (on) nav.scrollTo({ left: on.offsetLeft - nav.clientWidth / 2 + on.offsetWidth / 2, behavior: "smooth" });  // only the bar, never the page
    }
  }, { rootMargin: "-30% 0px -60% 0px" });
  items.forEach(([id]) => { const el = document.getElementById(target(id)); if (el) io.observe(el); });
}

// "See all" turns a sideways row into a grid (and back)
function seeAll(row) {
  const b = h("button", { class: "ap-seeall", type: "button", text: "See all" });
  b.addEventListener("click", () => {
    const open = row.classList.toggle("grid");
    row.parentElement.classList.toggle("is-grid", open);
    b.textContent = open ? "Show less" : "See all";
  });
  return b;
}

function itemCard(item, cat, sale) {
  const owned = ownedCount(item.id);
  const maxed = item.limit && owned >= item.limit;
  let option = item.options ? item.options[0].id : null;
  const price = h("div", { class: "ap-price" });
  const setPrice = () => {
    const small = item.priceText ? item.priceNote : item.limit === 1 ? "One per player" : item.limit ? `Up to ${item.limit} per player` : "";
    price.replaceChildren(h("b", { text: item.priceText || usd(item.options ? item.options.find((o) => o.id === option).price : item.price) }), ...(small ? [h("small", { text: small })] : []));
  };
  setPrice();
  let buy;
  if (maxed) buy = h("span", { class: "ap-buy owned" }, iconEl("check"), "Owned");
  else if (!sale) buy = h("span", { class: "ap-buy soon", text: "Coming soon" });
  else {
    buy = h("button", { class: "ap-buy", type: "button", text: "Buy" });
    buy.addEventListener("click", () => {
      const o = item.options?.find((x) => x.id === option);
      checkout({ id: item.id, option: () => option, name: o ? `${item.name} (${o.name})` : item.name, price: o ? o.price : item.price,
        icon: item.icon || "cart", cat: cat.id, tags: ["shop", `cat:${cat.id}`, `item:${item.id}`], isPlan: false });
    });
  }
  let sel = null;
  if (item.options) {
    sel = h("select", { class: "ap-opt", "aria-label": `${item.name}: how long` }, ...item.options.map((o) => h("option", { value: o.id, text: o.name })));
    sel.addEventListener("change", () => { option = sel.value; setPrice(); });
  }
  return h("article", { class: `ap-card ap-item cat-${cat.id}${maxed ? " is-owned" : ""}${cat.id === "devices" ? " wide" : ""}` },
    maxed ? null : heart(item.id, item.name),
    item.badge && !maxed ? h("span", { class: "ap-kicker", text: item.badge }) : h("span", { class: "ap-kicker blank", text: "" }),
    h("h3", { class: "ap-name", text: item.name }),
    h("p", { class: "ap-desc", text: item.description }),
    stage(item.id, cat.id),
    sel,
    h("div", { class: "ap-foot" }, price, buy));
}

function renderShop() {
  const box = document.getElementById("shop-items");
  box.replaceChildren(...data.shop.map((cat) => {
    const sale = itemOnSale(cat);
    const row = h("div", { class: "ap-shelf" });
    const wrap = h("div", { class: "ap-shelf-wrap" }, row);
    const sec = h("section", { class: "ap-sub", id: `shelf-${cat.id}` },
      h("div", { class: "ap-h2-row" }, h("h2", { class: "ap-h2" }, h("b", { text: `${CAT_NAMES[cat.id] || cat.name}.` }), " ", h("span", { text: CAT_LINES[cat.id] || cat.blurb })),
        cat.items.length > 2 ? seeAll(row) : null), wrap);
    shelf(row, cat.items.map((i) => itemCard(i, cat, sale)));
    return sec;
  }));
}

// ---------- Member strip: balance, promo codes ----------
function renderStrip() {
  const strip = document.getElementById("store-me");
  if (!me.signedIn) {
    strip.replaceChildren(h("a", { class: "btn btn-secondary btn-sm", href: "/community", text: "Sign in to buy" }));
    strip.hidden = false;
    return;
  }
  const giftBtn = h("button", { class: "btn btn-ghost btn-sm", type: "button" }, iconEl("gift"), "Gift");
  giftBtn.addEventListener("click", giftDialog);
  const bal = h("div", { class: "st-balance" },
    h("span", { class: "st-balance-k", text: "Galaxy Credits" }), h("b", { text: me.infinite ? "Unlimited" : usd(me.credits || 0) }));
  const bits = [h("div", { class: "st-me-row" }, bal, me.infinite ? null : h("a", { class: "btn btn-secondary btn-sm", href: "#credits", text: "Top up" }), giftBtn)];
  if (!me.linked) bits.push(h("p", { class: "text-3 small st-me-note", text: "Type /link in game so we know which player gets what you buy." }));
  if (me.promos?.length) bits.push(h("p", { class: "st-me-note st-promo" }, iconEl("gift"), me.promos.length === 1 ? `Promo code for you: ${me.promos[0].code} (${me.promos[0].label})` : `You have ${me.promos.length} promo codes`));
  strip.replaceChildren(...bits);
  strip.hidden = false;
}

// ---------- Credits: top-up packs ----------
function renderCredits() {
  const cards = (me.packs || []).map((p) => {
    const btn = h("button", { class: "ap-buy", type: "button", text: "Buy" });
    btn.addEventListener("click", async () => {
      if (!me.signedIn) { location.href = "/community"; return; }
      btn.disabled = true;
      try {
        const r = await postJson("/api/store/topup", { pack: p.id });
        if (r.url) { location.href = r.url; return; }
        toast(r.message || "Card payments are opening soon.");
      } catch (e) {
        toast(e.message);
      } finally {
        btn.disabled = false;
      }
    });
    return h("article", { class: "ap-card ap-pack" },
      h("span", { class: "ap-kicker", text: p.badge || (p.bonus ? "Bonus included" : "Galaxy Credits") }),
      h("h3", { class: "ap-name", text: `${usd(p.credit)} in credits` }),
      h("p", { class: "ap-desc", text: p.bonus ? `Includes ${usd(p.bonus)} of bonus credit.` : "Spend on anything in the Store, or gift to a friend." }),
      stage("credits", "credits"),
      h("div", { class: "ap-foot" }, h("div", { class: "ap-price" }, h("b", { text: usd(p.price) })), btn));
  });
  shelf(document.getElementById("credit-packs"), cards);
}

function giftDialog() {
  let chosen = null; // { id, username, head }
  const search = h("input", { class: "input", id: "gift-to", placeholder: "Type the first letters of their name", autocomplete: "off", maxlength: 32, autocapitalize: "off", spellcheck: "false" });
  const list = h("div", { class: "gift-list", role: "listbox", "aria-label": "Members" });
  const picked = h("div", { class: "gift-picked", hidden: true });
  const amount = h("input", { class: "input", id: "gift-amount", type: "number", min: 1, step: "0.01", value: "1.00", inputmode: "decimal" });
  const face = (m) => {
    const img = h("img", { class: "gift-face", alt: "", width: 28, height: 28 });
    img.src = m.head || faceSvg(m.username);
    img.addEventListener("error", () => { img.src = faceSvg(m.username); }, { once: true });
    return img;
  };
  const pick = (m) => {
    chosen = m;
    search.hidden = true;
    list.replaceChildren();
    const change = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Change" });
    change.addEventListener("click", () => { chosen = null; picked.hidden = true; search.hidden = false; search.value = ""; search.focus(); });
    picked.replaceChildren(face(m), h("b", { text: m.username }), change);
    picked.hidden = false;
    amount.focus();
  };
  let timer = null;
  let asked = "";
  search.addEventListener("input", () => {
    clearTimeout(timer);
    const q = search.value.trim();
    if (q.length < 2) {
      list.replaceChildren(q ? h("p", { class: "text-3 small gift-hint", text: "Keep typing…" }) : "");
      return;
    }
    timer = setTimeout(async () => {
      asked = q;
      let d;
      try { d = await (await fetch(`/api/store/members?q=${encodeURIComponent(q)}`, { credentials: "same-origin" })).json(); } catch { return; }
      if (asked !== q || chosen) return;
      list.replaceChildren(...(d.members?.length
        ? d.members.map((m) => {
          const b = h("button", { class: "gift-option", type: "button", role: "option" }, face(m), h("span", { text: m.username }));
          b.addEventListener("click", () => pick(m));
          return b;
        })
        : [h("p", { class: "text-3 small gift-hint", text: "No members start with that." })]));
    }, 200);
  });
  openDialog({
    title: "Gift credits",
    body: h("div", {},
      h("p", { class: "text-2", style: "margin-top:0", text: me.infinite ? "As the owner your credits are unlimited, so gifts don't cost you anything. They aren't real money." : `You have ${usd(me.credits || 0)} of credits. Gifts can't be undone, so check the name. Up to $50 a day.` }),
      h("div", { class: "field" }, h("label", { class: "field-label", for: "gift-to", text: "Send to" }), search, picked, list),
      h("div", { class: "field" }, h("label", { class: "field-label", for: "gift-amount", text: "Amount ($)" }), amount)),
    actions: [{ label: "Cancel" }, {
      label: "Send gift", kind: "primary", onClick: async () => {
        if (!chosen) throw new Error("Pick who to send it to from the list.");
        const r = await postJson("/api/store/gift", { toId: chosen.id, amount: amount.value });
        toast(r.message);
        await refreshMine();
        renderStrip();
      },
    }],
  });
  setTimeout(() => search.focus(), 50);
}

// Opens checkout for one item (from "Gift" on someone's wishlist: /store?gift=<id>&giftName=<name>&item=<key>).
function openItem(key) {
  const plan = data.plans.find((p) => p.id === key && p.price);
  if (plan) {
    if (!(data.onSale || []).includes("plans")) return;
    return buyPlan(plan);
  }
  for (const cat of data.shop) {
    const item = cat.items.find((i) => i.id === key);
    if (!item || !itemOnSale(cat)) continue;
    const o = item.options?.[0];
    document.getElementById("shop")?.scrollIntoView();
    return checkout({ id: item.id, option: () => o?.id || null, name: o ? `${item.name} (${o.name})` : item.name, price: o ? o.price : item.price,
      icon: item.icon || "cart", cat: cat.id, tags: ["shop", `cat:${cat.id}`, `item:${item.id}`], isPlan: false });
  }
}

function renderAll() {
  renderStrip();
  renderCredits();
  renderPlans();
  renderFilters();
  renderShop();
  renderCats();  // after the shelves exist, so the bar can follow them
}

async function refreshMine() {
  try { me = { owned: {}, promos: [], ...(await (await fetch("/api/store/mine", { credentials: "same-origin" })).json()) }; } catch { /* signed out view */ }
}

// Highlight the tab of the section on screen.
function watchTabs() {
  const tabs = [...document.querySelectorAll("[data-store-tab]")];
  const set = (id) => tabs.forEach((t) => t.classList.toggle("active", t.dataset.storeTab === id));
  set(["#shop", "#credits"].includes(location.hash) ? location.hash.slice(1) : "subscriptions");
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) set(e.target.id);
  }, { rootMargin: "-45% 0px -50% 0px" });
  document.querySelectorAll(".store-section").forEach((s) => io.observe(s));
}

(async () => {
  try {
    [data] = await Promise.all([fetch("/api/store/plans").then((r) => r.json()), refreshMine()]);
  } catch {
    document.getElementById("plans").replaceChildren(h("p", { class: "text-3", text: "The store couldn't be loaded. Please try again later." }));
    return;
  }
  renderAll();
  watchTabs();
  if (["#shop", "#credits", "#donate"].includes(location.hash)) document.querySelector(location.hash).scrollIntoView();
  const params = new URLSearchParams(location.search);
  if (params.get("item")) openItem(params.get("item"));
  const paid = params.get("paid");
  if (paid) {
    history.replaceState(null, "", "/store");
    // Stripe tells us about the payment a moment later: check the balance again shortly
    setTimeout(async () => { await refreshMine(); renderAll(); }, 3000);
    openDialog({
      title: "Thank you!",
      body: h("div", { class: "co-done" }, h("div", { class: "co-done-icon" }, iconEl("check")),
        h("p", { class: "text-2", text: paid === "credits" ? "Your credits are on their way. They show up in a few seconds." : "Your payment went through. Your item is on its way to you in game." })),
      actions: [{ label: "Done", kind: "primary" }],
    });
  }
})();
