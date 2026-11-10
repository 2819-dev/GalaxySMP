// Store page: Subscriptions (monthly plans) and Shop (one-time items).
// Checkout answers "coming soon" until payments open.
import { toast, iconEl } from "/js/site.js";
import { rankTag } from "/js/rank-paint.js";

async function startCheckout(id, option, button) {
  button.disabled = true;
  try {
    const res = await fetch("/api/store/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rankId: id, option }),
    });
    const data = await res.json();
    if (data.ok && data.url) { location.href = data.url; return; }
    toast(data.message || data.error || "Payments open soon.");
  } catch {
    toast("The store is unavailable right now. Please try again later.");
  } finally {
    button.disabled = false;
  }
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const usd = (n) => `$${Number(n).toFixed(2)}`;

function renderPlans(data) {
  const wrap = document.getElementById("plans");
  wrap.replaceChildren();
  for (const plan of data.plans) {
    const card = el("article", `panel plan-card plan-${plan.id}`);
    if (plan.id === "pro") card.append(el("span", "plan-badge", "Best value"));
    card.append(el("h3", "plan-name", plan.name));
    if (plan.tag) {
      const t = el("div", "plan-tag");
      t.append(rankTag(plan.tag));
      card.append(t);
    }
    const price = el("div", "plan-price");
    if (plan.price) {
      price.append(el("span", "plan-amount", usd(plan.price)), el("span", "plan-per", "/month"));
      card.append(price, el("p", "plan-game", `+ $${plan.gameCost.toLocaleString("en-US")} in-game money / month`));
    } else {
      price.append(el("span", "plan-amount", "Free"));
      card.append(price, el("p", "plan-game", "For everyone, always"));
    }
    const ul = el("ul", "plan-perks");
    for (const p of plan.perks) ul.append(el("li", null, p));
    card.append(ul);
    if (plan.price) {
      const btn = el("button", "btn btn-primary", data.checkoutEnabled ? "Subscribe" : "Coming soon");
      btn.type = "button";
      btn.addEventListener("click", () => startCheckout(plan.id, null, btn));
      card.append(btn);
    } else {
      const a = el("a", "btn btn-secondary", "How to join");
      a.href = "/join";
      card.append(a);
    }
    wrap.append(card);
  }
}

function renderShop(data) {
  const box = document.getElementById("shop-items");
  box.replaceChildren();
  for (const cat of data.shop || []) {
    const sec = el("div", "shop-cat");
    sec.append(el("h3", "shop-cat-name", cat.name), el("p", "text-3 small shop-cat-blurb", cat.blurb));
    const grid = el("div", "shop-grid");
    for (const item of cat.items) {
      const card = el("article", `panel shop-item cat-${cat.id}`);
      if (item.badge) card.append(el("span", "plan-badge", item.badge));
      const ico = el("div", "shop-icon");
      ico.append(iconEl(item.icon || "cart"));
      card.append(ico, el("h4", "shop-name", item.name), el("p", "text-2 shop-desc", item.description));
      let option = null;
      const amount = el("span", "shop-price", usd(item.options ? item.options[0].price : item.price));
      if (item.options) {
        const sel = el("select", "input shop-select");
        sel.setAttribute("aria-label", `${item.name}: how long`);
        for (const o of item.options) {
          const opt = el("option", null, `${o.name} · ${usd(o.price)}`);
          opt.value = o.id;
          sel.append(opt);
        }
        option = item.options[0].id;
        sel.addEventListener("change", () => {
          option = sel.value;
          amount.textContent = usd(item.options.find((o) => o.id === option).price);
        });
        card.append(sel);
      }
      if (item.limit) card.append(el("p", "text-3 small shop-limit", item.limit === 1 ? "One per player" : `Up to ${item.limit} per player`));
      const foot = el("div", "shop-foot");
      const btn = el("button", "btn btn-primary btn-sm", data.checkoutEnabled ? "Buy" : "Coming soon");
      btn.type = "button";
      btn.addEventListener("click", () => startCheckout(item.id, option, btn));
      foot.append(amount, btn);
      card.append(foot);
      grid.append(card);
    }
    sec.append(grid);
    box.append(sec);
  }
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
  let data;
  try {
    data = await (await fetch("/api/store/plans")).json();
  } catch {
    document.getElementById("plans").replaceChildren(el("p", "text-3", "The store couldn't be loaded. Please try again later."));
    return;
  }
  renderPlans(data);
  renderShop(data);
  document.querySelectorAll("[data-store-tab]").forEach((t) => t.prepend(iconEl(t.dataset.storeTab === "shop" ? "cart" : "star")));
  watchTabs();
  if (location.hash === "#shop") document.getElementById("shop").scrollIntoView();
})();
