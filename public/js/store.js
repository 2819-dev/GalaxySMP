// Store page: Subscriptions (monthly plans) and Shop (one-time items), with a checkout window
// that takes promo codes (and tells members about promo codes made just for them).
import { toast, iconEl } from "/js/site.js";
import { rankTag } from "/js/rank-paint.js";
import { moneyDollars } from "/js/money.js";
import { h, openDialog, postJson } from "/js/dialog.js";

const usd = (n) => `$${Number(n).toFixed(2)}`;
const PERKS_SHOWN = 6;
let data = null;   // /api/store/plans
let me = { signedIn: false, owned: {}, promos: [] }; // /api/store/mine

// ---------- What can be bought ----------
const itemOnSale = (cat) => data.checkoutEnabled && (data.onSale || []).includes(cat.id);
const ownedCount = (id) => me.owned?.[id] || 0;
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
  const payBtn = h("button", { class: "btn btn-primary co-pay", type: "button" });
  const err = h("p", { class: "form-error", role: "alert" });

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
    payBtn.textContent = final === 0 ? "Get it free" : `Pay ${usd(final)}${isPlan ? " a month" : ""}`;
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

  payBtn.addEventListener("click", async () => {
    err.textContent = "";
    payBtn.disabled = true;
    try {
      const r = await postJson("/api/store/checkout", { item: id, option: option(), code: applied?.code || "" });
      if (r.url) { location.href = r.url; return; }
      if (r.free) {
        dlg.close();
        me.owned[id] = (me.owned[id] || 0) + 1;
        me.promos = me.promos.filter((p) => p.code !== applied?.code || p.kindRaw === "percent");
        refreshMine().then(renderAll);
        celebrate(name, r.message);
        return;
      }
      err.textContent = r.message || "Payments open soon.";
    } catch (e) {
      err.textContent = e.message;
    } finally {
      payBtn.disabled = false;
    }
  });

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
      h("div", { class: "co-item-text" }, h("b", { text: name }), h("span", { class: "text-3 small", text: isPlan ? "Monthly subscription" : "One-time purchase" }))),
    codeRow, appliedRow,
    h("div", { class: "co-total" }, h("span", { class: "text-2", text: "Total" }), h("span", {}, was, " ", total)),
    err,
    payBtn,
    h("p", { class: "co-fine text-3 small" }, iconEl("lock2"), "Card payments are handled securely by Stripe. We never see your card. Under 18? Ask a parent or guardian first."));
  const { dialog: dlg } = openDialog({ title: "Checkout", body, actions: [] });
  dlg.classList.add("co-dialog");
  draw();
}

function celebrate(name, message) {
  openDialog({
    title: "It's yours!",
    body: h("div", { class: "co-done" }, h("div", { class: "co-done-icon" }, iconEl("check")), h("p", { class: "text-2", text: message || `${name} is yours!` }),
      h("p", { class: "text-3 small", text: "Pick cosmetics in game with /cosmetics." })),
    actions: [{ label: "Nice!", kind: "primary" }],
  });
}

// ---------- Subscriptions ----------
function renderPlans() {
  const wrap = document.getElementById("plans");
  wrap.replaceChildren();
  for (const plan of data.plans) {
    const current = me.signedIn && me.linked && (me.plan || "free") === plan.id;
    const card = h("article", { class: `panel plan-card plan-${plan.id}${current ? " is-current" : ""}` });
    if (current) card.append(h("span", { class: "plan-badge current", text: "Your plan" }));
    else if (plan.id === "pro") card.append(h("span", { class: "plan-badge", text: "Best value" }));
    card.append(h("h3", { class: "plan-name", text: plan.name }));
    if (plan.tag) card.append(h("div", { class: "plan-tag" }, rankTag(plan.tag)));
    const price = h("div", { class: "plan-price" });
    if (plan.price) {
      price.append(h("span", { class: "plan-amount", text: usd(plan.price) }), h("span", { class: "plan-per", text: "/month" }));
      card.append(price, h("p", { class: "plan-game", text: `+ ${moneyDollars(plan.gameCost)} in-game money / month` }));
    } else {
      price.append(h("span", { class: "plan-amount", text: "Free" }));
      card.append(price, h("p", { class: "plan-game", text: "For everyone, always" }));
    }
    const ul = h("ul", { class: "plan-perks" });
    plan.perks.forEach((p, i) => ul.append(h("li", { text: p, hidden: i >= PERKS_SHOWN })));
    card.append(ul);
    if (plan.perks.length > PERKS_SHOWN) {
      const more = h("button", { class: "plan-more", type: "button", text: `Show all ${plan.perks.length} perks` });
      more.addEventListener("click", () => {
        const open = more.dataset.open === "1";
        ul.querySelectorAll("li").forEach((li, i) => { li.hidden = open && i >= PERKS_SHOWN; });
        more.dataset.open = open ? "0" : "1";
        more.textContent = open ? `Show all ${plan.perks.length} perks` : "Show fewer";
      });
      card.append(more);
    }
    if (plan.price) {
      const sellable = false; // subscriptions: coming soon
      const btn = h("button", { class: `btn ${sellable ? "btn-primary" : "btn-secondary is-soon"}`, type: "button", text: current ? "Your plan" : sellable ? "Subscribe" : "Coming soon" });
      if (!sellable || current) btn.setAttribute("aria-disabled", "true");
      else btn.addEventListener("click", () => checkout({ id: plan.id, option: () => null, name: plan.name, price: plan.price, icon: "star", cat: "plan", tags: ["subs", `plan:${plan.id}`], isPlan: true }));
      card.append(btn);
    } else {
      card.append(h("a", { class: "btn btn-secondary", href: "/join", text: "How to join" }));
    }
    wrap.append(card);
  }
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

// ---------- Member strip (signed in, promo codes) ----------
function renderStrip() {
  const strip = document.getElementById("store-me");
  if (!me.signedIn) {
    strip.replaceChildren(h("span", { class: "text-2", text: "Sign in to buy things and use promo codes." }), h("a", { class: "btn btn-secondary btn-sm", href: "/community", text: "Sign in" }));
    strip.hidden = false;
    return;
  }
  const bits = [h("span", { class: "text-2" }, "Signed in as ", h("b", { text: me.username }))];
  if (!me.linked) bits.push(h("span", { class: "text-3 small", text: "· Link your Minecraft account with /link in game to buy." }));
  if (me.promos?.length) {
    bits.push(h("span", { class: "store-promo-pill" }, iconEl("gift"), me.promos.length === 1 ? `You have a promo code: ${me.promos[0].code} (${me.promos[0].label})` : `You have ${me.promos.length} promo codes`));
  }
  strip.replaceChildren(...bits);
  strip.hidden = false;
}

function renderAll() {
  renderStrip();
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
  set(location.hash === "#shop" ? "shop" : "subscriptions");
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
  document.querySelectorAll("[data-store-tab]").forEach((t) => t.prepend(iconEl(t.dataset.storeTab === "shop" ? "cart" : "star")));
  watchTabs();
  if (location.hash === "#shop") document.getElementById("shop").scrollIntoView();
  const params = new URLSearchParams(location.search);
  if (params.get("paid")) { toast("Thanks for your purchase! It's on its way to you in game."); history.replaceState(null, "", "/store"); }
})();
