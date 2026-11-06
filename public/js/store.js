import { toast } from "/js/site.js";

// Asks our server to start checkout. Today it answers "coming soon"; once Stripe is
// set up it returns a payment page URL and we go there. No page changes needed.
async function startCheckout(rankId, button) {
  button.disabled = true;
  try {
    const res = await fetch("/api/store/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rankId }),
    });
    const data = await res.json();
    if (data.ok && data.url) {
      location.href = data.url;
      return;
    }
    toast(data.message || data.error || "The store is coming soon!");
  } catch {
    toast("Couldn't reach the store. Try again later.");
  } finally {
    button.disabled = false;
  }
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-checkout]");
  if (btn) startCheckout(btn.getAttribute("data-checkout"), btn);
});

async function loadRanks() {
  let data;
  try {
    data = await (await fetch("/api/store/ranks")).json();
  } catch {
    return;
  }
  if (!data.ranks || !data.ranks.length) return;
  const wrap = document.getElementById("ranks");
  for (const r of data.ranks) {
    const card = document.createElement("div");
    card.className = "panel";
    const h = document.createElement("h3");
    h.textContent = r.name;
    h.style.color = r.color;
    const price = document.createElement("div");
    price.style.cssText = "font-size:1.6rem;font-weight:800;margin-bottom:10px";
    price.textContent = "$" + r.price;
    const ul = document.createElement("ul");
    ul.className = "text-2";
    for (const p of r.perks) {
      const li = document.createElement("li");
      li.textContent = p;
      ul.appendChild(li);
    }
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.type = "button";
    btn.setAttribute("data-checkout", r.id);
    btn.textContent = data.checkoutEnabled ? "Buy" : "Coming soon";
    card.append(h, price, ul, btn);
    wrap.appendChild(card);
  }
  wrap.hidden = false;
  document.getElementById("coming-soon").hidden = true;
}

loadRanks();
