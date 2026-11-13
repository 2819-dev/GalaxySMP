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
    title: gift ? "Gift sent!" : "It's yours!",
    body: h("div", { class: "co-done" }, h("div", { class: "co-done-icon" }, iconEl("check")), h("p", { class: "text-2", text: message || `${name} is yours!` }),
      h("p", { class: "text-3 small", text: "Pick cosmetics in game with /cosmetics." })),
    actions: [{ label: "Done", kind: "primary" }],
  });
}

// ---------- Ranks (plans) ----------
const usdShort = (n) => (Number(n) % 1 ? usd(n) : `$${Number(n)}`);
const PERKS_OPEN = 2;  // perk groups shown before "Show all perks"
const GROUP_ICON = { Looks: "sparkles", "Land & homes": "homes", "Money & rewards": "coins", "Money & trading": "coins", Community: "users",
  "Getting around": "map", Rewards: "gift" };
function buyPlan(plan) {
  checkout({ id: plan.id, option: () => null, name: plan.name, price: plan.price, icon: "star", cat: "plan", tags: ["subs", `plan:${plan.id}`], isPlan: true });
}
function renderPlans() {
  const wrap = document.getElementById("plans");
  wrap.replaceChildren();
  for (const plan of data.plans) {
    const current = me.signedIn && me.linked && (me.plan || "free") === plan.id;
    const card = h("article", { class: `panel plan-card plan-${plan.id}${current ? " is-current" : ""}` });
    if (plan.price) card.append(heart(plan.id, plan.name));
    if (current) card.append(h("span", { class: "plan-badge current", text: "Your plan" }));
    else if (plan.id === "pro") card.append(h("span", { class: "plan-badge", text: "Best value" }));
    card.append(h("div", { class: "plan-top" }, h("h3", { class: "plan-name", text: plan.name }), plan.tag ? h("div", { class: "plan-tag" }, rankTag(plan.tag)) : null));
    const price = h("div", { class: "plan-price" });
    if (plan.price) {
      price.append(h("span", { class: "plan-amount", text: usdShort(plan.price) }), h("span", { class: "plan-per", text: "/month" }));
      card.append(price, h("p", { class: "plan-game", text: `+ ${moneyDollars(plan.gameCost)} in-game money / month` }));
    } else {
      price.append(h("span", { class: "plan-amount", text: "Free" }));
      card.append(price, h("p", { class: "plan-game free", text: "For everyone, always" }));
    }
    if (plan.price) {
      const sellable = (data.onSale || []).includes("plans");
      const btn = h("button", { class: `btn ${sellable ? "btn-primary" : "btn-secondary is-soon"} plan-buy`, type: "button", text: !sellable ? "Coming soon" : current ? "Add 30 days" : "Get 30 days" });
      if (!sellable) btn.setAttribute("aria-disabled", "true");
      else btn.addEventListener("click", () => buyPlan(plan));
      card.append(btn);
    } else {
      card.append(h("a", { class: "btn btn-secondary plan-buy", href: "/join", text: "How to join" }));
    }
    if (plan.includes) card.append(h("p", { class: "plan-includes", text: plan.includes }));
    const groups = plan.perkGroups || [{ name: "Perks", items: plan.perks }];
    const list = h("div", { class: "plan-groups" });
    groups.forEach((g, gi) => list.append(h("div", { class: "plan-group", hidden: gi >= PERKS_OPEN },
      h("h4", { class: "plan-group-name" }, iconEl(GROUP_ICON[g.name] || "check"), g.name),
      h("ul", { class: "plan-perks" }, ...g.items.map((t) => h("li", { text: t }))))));
    card.append(list);
    if (groups.length > PERKS_OPEN) {
      const total = groups.reduce((n, g) => n + g.items.length, 0);
      const more = h("button", { class: "plan-more", type: "button", text: `Show all ${total} perks` });
      more.addEventListener("click", () => {
        const open = more.dataset.open === "1";
        list.querySelectorAll(".plan-group").forEach((el, gi) => { el.hidden = open && gi >= PERKS_OPEN; });
        more.dataset.open = open ? "0" : "1";
        more.textContent = open ? `Show all ${total} perks` : "Show fewer";
      });
      card.append(more);
    }
    wrap.append(card);
  }
}

// ---------- Banner: featured deal and category tiles ----------
function renderFeatured() {
  const box = document.getElementById("store-featured");
  const pro = data.plans.find((p) => p.id === "pro");
  if (!box || !pro) return;
  const sellable = (data.onSale || []).includes("plans");
  const btn = h("button", { class: "btn btn-primary", type: "button", text: sellable ? `Get Pro+ for ${usdShort(pro.price)}` : "See Pro+" });
  btn.addEventListener("click", () => (sellable ? buyPlan(pro) : document.getElementById("subscriptions").scrollIntoView({ behavior: "smooth" })));
  const top = (pro.perkGroups || []).flatMap((g) => g.items).filter((t) => !/^Everything/.test(t)).slice(0, 4);
  box.replaceChildren(
    h("span", { class: "sx-feat-k" }, iconEl("crown"), "Featured"),
    h("div", { class: "sx-feat-tag" }, rankTag(pro.tag)),
    h("b", { class: "sx-feat-name", text: pro.name }),
    h("div", { class: "sx-feat-price" }, h("span", { text: usdShort(pro.price) }), h("small", { text: "/month" })),
    h("ul", { class: "sx-feat-list" }, ...top.map((t) => h("li", { text: t.replace(/ \(.*\)$/, "") }))),
    btn);
}

const CAT_TILES = { money: ["coins", "Money"], plots: ["homes", "Land"], effects: ["moon", "Effects"], cosmetics: ["sparkles", "Cosmetics"] };
function renderCats() {
  const nav = document.getElementById("store-cats");
  if (!nav) return;
  const tile = (icon, name, sub, onClick, cls = "") => {
    const b = h("button", { class: `sx-cat ${cls}`, type: "button" }, h("span", { class: "sx-cat-ic" }, iconEl(icon)), h("b", { text: name }), h("small", { text: sub }));
    b.addEventListener("click", onClick);
    return b;
  };
  const go = (id) => document.getElementById(id).scrollIntoView({ behavior: "smooth" });
  nav.replaceChildren(
    tile("star", "Ranks", "Galaxy+ and Pro+", () => go("subscriptions"), "c-ranks"),
    ...data.shop.map((c) => {
      const [icon, name] = CAT_TILES[c.id] || ["cart", c.name];
      const from = Math.min(...c.items.map((i) => (i.options ? Math.min(...i.options.map((o) => o.price)) : i.price)).filter((x) => x != null));
      return tile(icon, name, Number.isFinite(from) ? `From ${usd(from)}` : "", () => { filter = c.id; renderFilters(); renderShop(); go("shop"); }, `c-${c.id}`);
    }),
    tile("coins", "Credits", "Top up and gift", () => go("credits"), "c-credits"),
    tile("heart", "Donate", "Help the server", () => go("donate"), "c-donate"));
}

// ---------- Shop ----------
let filter = "all";
function renderFilters() {
  const bar = document.getElementById("shop-filters");
  const cats = [{ id: "all", name: "All" }, ...data.shop.map((c) => ({ id: c.id, name: c.name.replace(/^Exclusive (\w)/, (_, l) => l.toUpperCase()) }))];
  bar.replaceChildren(...cats.map((c) => {
    const b = h("button", { class: "shop-filter", type: "button", "aria-pressed": String(filter === c.id), text: c.name });
    b.addEventListener("click", () => { filter = c.id; renderFilters(); renderShop(); });
    return b;
  }));
}

function renderShop() {
  const box = document.getElementById("shop-items");
  box.replaceChildren();
  for (const cat of data.shop) {
    if (filter !== "all" && filter !== cat.id) continue;
    const sale = itemOnSale(cat);
    const sec = h("div", { class: "shop-cat" },
      h("div", { class: "shop-cat-head" },
        h("div", {}, h("h3", { class: "shop-cat-name", text: cat.name }), h("p", { class: "text-3 small shop-cat-blurb", text: cat.blurb })),
        sale ? null : h("span", { class: "soon-pill", text: "Coming soon" })));
    const grid = h("div", { class: "shop-grid" });
    for (const item of cat.items) {
      const owned = ownedCount(item.id);
      const maxed = item.limit && owned >= item.limit;
      const card = h("article", { class: `panel shop-item cat-${cat.id}${maxed ? " is-owned" : ""}${sale ? "" : " is-soon"}` });
      if (!maxed) card.append(heart(item.id, item.name));
      if (maxed) card.append(h("span", { class: "shop-badge owned" }, iconEl("check"), "Owned"));
      else if (item.badge) card.append(h("span", { class: "shop-badge", text: item.badge }));
      card.append(h("div", { class: "shop-icon" }, iconEl(item.icon || "cart")),
        h("h4", { class: "shop-name", text: item.name }), h("p", { class: "text-2 shop-desc", text: item.description }));
      let option = item.options ? item.options[0].id : null;
      const amount = h("span", { class: "shop-price", text: usd(item.options ? item.options[0].price : item.price) });
      if (item.options) {
        const seg = h("div", { class: "shop-seg", role: "radiogroup", "aria-label": `${item.name}: how long` });
        item.options.forEach((o) => {
          const b = h("button", { class: "shop-seg-btn", type: "button", role: "radio", "aria-checked": String(o.id === option), text: o.name });
          b.addEventListener("click", () => {
            option = o.id;
            seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
            amount.textContent = usd(o.price);
          });
          seg.append(b);
        });
        card.append(seg);
      }
      const meta = item.limit === 1 ? "One per player" : item.limit ? `Up to ${item.limit} per player${owned ? ` · you have ${owned}` : ""}` : "";
      if (meta && !maxed) card.append(h("p", { class: "text-3 small shop-limit", text: meta }));
      let btn;
      if (maxed) btn = h("span", { class: "shop-owned-text text-3 small", text: "In your collection" });
      else if (!sale) btn = h("span", { class: "shop-soon-text", text: "Soon" });
      else {
        btn = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Buy" });
        btn.addEventListener("click", () => {
          const o = item.options?.find((x) => x.id === option);
          checkout({ id: item.id, option: () => option, name: o ? `${item.name} (${o.name})` : item.name, price: o ? o.price : item.price,
            icon: item.icon || "cart", cat: cat.id, tags: ["shop", `cat:${cat.id}`, `item:${item.id}`], isPlan: false });
        });
      }
      card.append(h("div", { class: "shop-foot" }, amount, btn));
      grid.append(card);
    }
    sec.append(grid);
    box.append(sec);
  }
}

// ---------- Member strip: balance, promo codes ----------
function renderStrip() {
  const strip = document.getElementById("store-me");
  if (!me.signedIn) {
    strip.replaceChildren(h("span", { class: "text-2", text: "Sign in to buy things, top up credits and use promo codes." }), h("a", { class: "btn btn-secondary btn-sm", href: "/community", text: "Sign in" }));
    strip.hidden = false;
    return;
  }
  const bal = h("div", { class: "store-balance" },
    h("span", { class: "store-balance-icon" }, iconEl("coins")),
    h("div", {}, h("span", { class: "text-3 small", text: "Galaxy Credits" }), h("b", { class: "store-balance-amount", text: me.infinite ? "∞ Unlimited" : usd(me.credits || 0) })));
  const top = h("a", { class: "btn btn-primary btn-sm", href: "#credits", text: "Top up" });
  const giftBtn = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Gift credits" });
  giftBtn.addEventListener("click", giftDialog);
  const row = h("div", { class: "store-me-row" }, bal, h("div", { class: "store-me-actions" }, me.infinite ? null : top, giftBtn));
  const bits = [row];
  if (!me.linked) bits.push(h("p", { class: "text-3 small", style: "margin:0", text: "Link your Minecraft account with /link in game so we know who to give things to." }));
  if (me.promos?.length) {
    bits.push(h("span", { class: "store-promo-pill" }, iconEl("gift"), me.promos.length === 1 ? `You have a promo code: ${me.promos[0].code} (${me.promos[0].label})` : `You have ${me.promos.length} promo codes`));
  }
  strip.replaceChildren(...bits);
  strip.hidden = false;
}

// ---------- Credits: top-up packs ----------
function renderCredits() {
  const box = document.getElementById("credit-packs");
  box.replaceChildren(...(me.packs || []).map((p) => {
    const card = h("article", { class: `panel credit-pack${p.badge ? " best" : ""}` });
    if (p.badge) card.append(h("span", { class: "shop-badge", text: p.badge }));
    card.append(
      h("div", { class: "credit-amount", text: usd(p.credit) }),
      h("p", { class: "credit-sub text-2 small", text: p.bonus ? `${usd(p.price)} + ${usd(p.bonus)} bonus` : "Galaxy Credits" }));
    const btn = h("button", { class: "btn btn-primary btn-sm", type: "button", text: `Buy for ${usd(p.price)}` });
    btn.addEventListener("click", async () => {
      if (!me.signedIn) { location.href = "/community"; return; }
      btn.disabled = true;
      try {
        const r = await postJson("/api/store/topup", { pack: p.id });
        if (r.url) { location.href = r.url; return; }
        toast(r.message || "Card payments open soon.");
      } catch (e) {
        toast(e.message);
      } finally {
        btn.disabled = false;
      }
    });
    card.append(btn);
    return card;
  }));
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
  renderFeatured();
  renderCats();
  renderStrip();
  renderCredits();
  renderPlans();
  renderFilters();
  renderShop();
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
  document.querySelectorAll("[data-store-tab]").forEach((t) => t.prepend(iconEl({ shop: "cart", credits: "coins" }[t.dataset.storeTab] || "crown")));
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
