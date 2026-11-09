// Store page: shows the subscription plans. Checkout answers "coming soon" until payments open.
import { toast } from "/js/site.js";

const HEX = { 6: "#FFAA00", b: "#55FFFF", 9: "#5555FF", e: "#FFFF55", g: "#DDD605", p: "#DEB12D" };
const GRADIENT_STOPS = { gold: "egp6", galaxy: "bb99" };

async function startCheckout(planId, button) {
  button.disabled = true;
  try {
    const res = await fetch("/api/store/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rankId: planId }),
    });
    const data = await res.json();
    if (data.ok && data.url) {
      location.href = data.url;
      return;
    }
    toast(data.message || data.error || "Payments open soon.");
  } catch {
    toast("The store is unavailable right now. Please try again later.");
  } finally {
    button.disabled = false;
  }
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-checkout]");
  if (btn) startCheckout(btn.getAttribute("data-checkout"), btn);
});

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// [⭐ GALAXY+] painted one color per letter, like in game.
function tagPreview(tag) {
  const span = el("span", "plan-tag");
  const stops = GRADIENT_STOPS[tag.gradient] || tag.color;
  const text = `[${tag.prefix}]`;
  const n = text.length;
  [...text].forEach((ch, i) => {
    if (i === 1 && tag.icon) {
      const img = el("img", "rank-icon");
      img.src = `/img/ranks/rank_${tag.icon}.png`;
      img.alt = "";
      span.append(img);
    }
    const c = el("span", null, ch);
    c.style.color = HEX[stops[Math.round((i * (stops.length - 1)) / (n - 1))]] || "#fff";
    span.append(c);
  });
  return span;
}

async function loadPlans() {
  const wrap = document.getElementById("plans");
  let data;
  try {
    data = await (await fetch("/api/store/plans")).json();
  } catch {
    wrap.replaceChildren(el("p", "text-3", "Plans couldn't be loaded. Please try again later."));
    return;
  }
  wrap.replaceChildren();
  for (const plan of data.plans) {
    const card = el("article", `panel plan-card plan-${plan.id}`);
    if (plan.id === "pro") card.append(el("span", "plan-badge", "Best value"));
    card.append(el("h2", "plan-name", plan.name));
    if (plan.tag) card.append(tagPreview(plan.tag));
    const price = el("div", "plan-price");
    if (plan.price) {
      price.append(el("span", "plan-amount", `$${plan.price.toFixed(2)}`), el("span", "plan-per", "/month"));
      card.append(price, el("p", "plan-game", `+ $${plan.gameCost.toLocaleString("en-US")} in-game money / month`));
    } else {
      price.append(el("span", "plan-amount", "Free"));
      card.append(price, el("p", "plan-game", "For everyone, always"));
    }
    const ul = el("ul", "plan-perks");
    for (const p of plan.perks) {
      ul.append(el("li", null, p));
    }
    card.append(ul);
    if (plan.price) {
      const btn = el("button", "btn btn-primary", data.checkoutEnabled ? "Subscribe" : "Coming soon");
      btn.type = "button";
      btn.setAttribute("data-checkout", plan.id);
      card.append(btn);
    } else {
      const a = el("a", "btn btn-secondary", "How to join");
      a.href = "/join";
      card.append(a);
    }
    wrap.append(card);
  }
}

loadPlans();

// One-time extras (like an extra plot), shown under the plans.
async function loadExtras() {
  let data;
  try { data = await (await fetch("/api/store/plans")).json(); } catch { return; }
  const box = document.getElementById("extras");
  if (!box || !data.extras?.length) return;
  for (const x of data.extras) {
    const row = el("article", "panel extra-card");
    const text = el("div");
    text.append(el("h3", "plan-name", x.name), el("p", "text-2", x.description));
    const right = el("div", "extra-buy");
    right.append(el("span", "plan-amount", `$${x.price.toFixed(2)}`));
    const btn = el("button", "btn btn-primary", data.checkoutEnabled ? "Buy" : "Coming soon");
    btn.type = "button";
    btn.setAttribute("data-checkout", x.id);
    right.append(btn);
    row.append(text, right);
    box.append(row);
  }
  box.hidden = false;
}
loadExtras();
