// Store > Merch: real GalaxySMP products made and shipped by Printify. Pick a size/color, type your address,
// see the real shipping cost, then pay with a card or Galaxy Credits. Your orders (with tracking) show below.
// The owner also sees setup help, items hidden because their price is too low, and every order.
import { toast, iconEl } from "/js/site.js";
import { h, openDialog, postJson } from "/js/dialog.js";
import { addToCart } from "/js/store-cart.js";

const usd = (c) => `$${(Number(c) / 100).toFixed(2)}`;
const STATUS = {
  paid: "Paid", placed: "Order placed", in_production: "Being made", shipped: "Shipped", delivered: "Delivered",
  canceled: "Canceled", failed: "Couldn't be placed", refunded: "Refunded",
};
const US_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

let state = null;

export async function renderMerch({ shelf, signedIn }) {
  const sec = document.getElementById("merch");
  if (!sec) return false;
  try { state = await fetch("/api/store/merch", { credentials: "same-origin" }).then((r) => r.json()); } catch { state = { products: [] }; }
  const products = state.products || [];
  const show = products.length > 0 || state.owner || (state.mine || []).length > 0;
  sec.hidden = !show;
  if (!show) return false;
  const row = h("div", { class: "ap-shelf" });
  const parts = [h("div", { class: "ap-h2-row" }, h("h2", { class: "ap-h2", id: "merch-title" }, h("b", { text: "Merch." }), " ", h("span", { text: "Real GalaxySMP gear, shipped to your door." })))];
  if (products.length) {
    parts.push(h("div", { class: "ap-shelf-wrap" }, row));
    shelf(row, products.map((p) => card(p, signedIn)));
  } else if (!state.owner) {
    parts.push(h("p", { class: "text-3", text: "New merch is coming soon." }));
  }
  if (state.owner) parts.push(ownerBox());
  if ((state.mine || []).length) parts.push(ordersBox("Your merch orders", state.mine, false));
  sec.replaceChildren(...parts);
  return true;
}

function mainImage(p, variantId) {
  return p.images.find((i) => variantId && i.variants.includes(variantId) && i.main)?.src
    || p.images.find((i) => variantId && i.variants.includes(variantId))?.src
    || p.images.find((i) => i.main)?.src || p.images[0]?.src || null;
}

function card(p, signedIn) {
  const buy = h("button", { class: "ap-buy", type: "button", text: "Buy" });
  buy.addEventListener("click", () => {
    if (!signedIn) { location.href = "/community"; return; }
    productDialog(p);
  });
  const src = mainImage(p);
  const allOut = p.variants.every((v) => !v.available);
  return h("article", { class: "ap-card ap-merch" },
    h("span", { class: "ap-kicker", text: "Merch" }),
    h("h3", { class: "ap-name", text: p.title }),
    h("div", { class: "ap-merch-img" }, src ? h("img", { src, alt: p.title, loading: "lazy", decoding: "async", onerror: (e) => e.target.replaceWith(iconEl("bag")) }) : iconEl("bag")),
    h("div", { class: "ap-foot" },
      h("div", { class: "ap-price" }, h("b", { text: `From ${usd(p.from)}` }), h("small", { text: allOut ? "Out of stock" : "Plus shipping" })),
      allOut ? h("span", { class: "ap-buy soon", text: "Sold out" }) : buy));
}

// ---------- buying ----------
function productDialog(p) {
  const chosen = {};  // option index -> value id
  const first = p.variants.find((v) => v.available) || p.variants[0];
  p.options.forEach((o, i) => { chosen[i] = first.options.find((id) => o.values.some((v) => v.id === id)) ?? o.values[0]?.id; });
  const img = h("img", { class: "mx-img", alt: p.title });
  const price = h("b", { class: "mx-price" });
  const stock = h("small", { class: "text-3" });
  const qty = h("select", { class: "input mx-qty", "aria-label": "How many" }, ...[1, 2, 3, 4, 5].map((n) => h("option", { value: n, text: String(n) })));
  const variant = () => p.variants.find((v) => p.options.every((o, i) => v.options.includes(chosen[i])));
  const pickers = p.options.map((o, i) => {
    const wrap = h("div", { class: "mx-opts", role: "radiogroup", "aria-label": o.name });
    const draw = () => wrap.replaceChildren(...o.values.map((val) => {
      const test = { ...chosen, [i]: val.id };
      const v = p.variants.find((x) => p.options.every((oo, j) => x.options.includes(test[j])));
      const b = h("button", { type: "button", class: `mx-chip${chosen[i] === val.id ? " on" : ""}${!v || !v.available ? " off" : ""}`, role: "radio", "aria-checked": String(chosen[i] === val.id),
        title: val.title, onclick: () => { chosen[i] = val.id; update(); } });
      if (o.type === "color" && val.colors?.[0]) b.append(h("span", { class: "mx-swatch", style: `background:${val.colors[0]}` }));
      b.append(h("span", { text: val.title }));
      return b;
    }));
    return { o, draw, el: h("div", { class: "field" }, h("span", { text: o.name }), wrap) };
  });
  function update() {
    pickers.forEach((x) => x.draw());
    const v = variant();
    const src = mainImage(p, v?.id);
    if (src) img.src = src;
    price.textContent = v ? usd(v.price) : "Not available";
    stock.textContent = !v ? "Choose another option." : v.available ? `or ${usd(v.credits)} in credits · plus shipping` : "Out of stock in this option.";
  }
  update();
  const dlg = openDialog({
    title: p.title,
    body: h("div", { class: "mx-body" },
      h("div", { class: "mx-pic" }, img),
      h("div", { class: "mx-info" },
        h("div", { class: "mx-price-row" }, price, stock),
        p.description ? h("p", { class: "text-2 mx-desc", text: p.description }) : null,
        ...pickers.map((x) => x.el),
        h("label", { class: "field" }, h("span", { text: "How many" }), qty))),
    actions: [{ label: "Add to cart", onClick: () => {
      const v = variant();
      if (!v || !v.available) throw new Error("That option isn't available. Choose another one.");
      addToCart({ type: "merch", productId: p.id, variantId: v.id, qty: Number(qty.value), name: `${p.title} (${v.title})`, price: v.price / 100, image: mainImage(p, v.id), max: 5 });
    } }, { label: "Buy now", kind: "primary", onClick: () => {
      const v = variant();
      if (!v || !v.available) throw new Error("That option isn't available. Choose another one.");
      addressDialog(p, v, Number(qty.value));
    } }],
  });
  dlg.dialog.classList.add("mx-dialog");
}

// The shipping address fields (also used by the Store cart). Returns { el, value }.
export function addressForm(countries = state?.countries) {
  const f = (name, label, attrs = {}) => {
    const input = h("input", { class: "input", name, autocomplete: attrs.ac || "off", maxlength: attrs.max || 100, ...(attrs.type ? { type: attrs.type } : {}) });
    return { input, el: h("label", { class: `field${attrs.half ? " half" : ""}` }, h("span", { text: label }), input) };
  };
  const first = f("first_name", "First name", { ac: "given-name", max: 40, half: true });
  const last = f("last_name", "Last name", { ac: "family-name", max: 40, half: true });
  const email = f("email", "Email (for shipping updates)", { ac: "email", type: "email", max: 120 });
  const country = h("select", { class: "input", name: "country", autocomplete: "country" }, ...(countries || [["US", "United States"]]).map(([c, n]) => h("option", { value: c, text: n })));
  const a1 = f("address1", "Street address", { ac: "address-line1" });
  const a2 = f("address2", "Apartment, suite (optional)", { ac: "address-line2" });
  const city = f("city", "City", { ac: "address-level2", max: 60, half: true });
  const regionInput = h("input", { class: "input", name: "region", autocomplete: "address-level1", maxlength: 40 });
  const regionSelect = h("select", { class: "input", name: "region-us", autocomplete: "address-level1" }, h("option", { value: "", text: "Choose" }), ...US_STATES.map((s) => h("option", { value: s, text: s })));
  const regionLabel = h("span", { text: "State" });
  const region = h("label", { class: "field half" }, regionLabel, regionSelect, regionInput);
  const zip = f("zip", "ZIP / postal code", { ac: "postal-code", max: 16, half: true });
  const phone = f("phone", "Phone (optional, for the delivery driver)", { ac: "tel", type: "tel", max: 30 });
  const syncRegion = () => {
    const us = country.value === "US";
    regionSelect.hidden = !us; regionInput.hidden = us;
    regionLabel.textContent = us ? "State" : "State / province / region";
  };
  country.addEventListener("change", syncRegion);
  syncRegion();
  const address = () => ({
    first_name: first.input.value, last_name: last.input.value, email: email.input.value, phone: phone.input.value, country: country.value,
    region: country.value === "US" ? regionSelect.value : regionInput.value, address1: a1.input.value, address2: a2.input.value, city: city.input.value, zip: zip.input.value,
  });
  const el = h("div", { class: "mx-grid" }, first.el, last.el, email.el, h("label", { class: "field" }, h("span", { text: "Country" }), country), a1.el, a2.el, city.el, region, zip.el, phone.el);
  return { el, value: address };
}

function addressDialog(p, v, qty) {
  const { el: grid, value: address } = addressForm();
  openDialog({
    title: "Where should we send it?",
    body: h("div", { class: "form mx-form" },
      h("p", { class: "text-3 small", style: "margin:0", text: `${qty > 1 ? `${qty} × ` : ""}${p.title} (${v.title}). Under 18? Ask a parent before ordering.` }),
      grid,
      h("p", { class: "text-3 small", style: "margin:0", text: "Your address is only used to ship this order. It's shared with Printify, who makes and ships it." })),
    actions: [{ label: "Back", onClick: () => productDialog(p) }, { label: "See total", kind: "primary", onClick: async () => {
      const items = [{ productId: p.id, variantId: v.id, qty }];
      const q = await postJson("/api/store/merch/quote", { items, address: address() });
      totalDialog(p, v, qty, items, address(), q);
    } }],
  });
}

function totalDialog(p, v, qty, items, address, q) {
  const enough = q.balance >= q.credits;
  const row = (a, b, cls = "") => h("div", { class: `mx-line ${cls}` }, h("span", { text: a }), h("b", { text: b }));
  const pay = async (method) => {
    const r = await postJson("/api/store/merch/checkout", { items, address, method });
    if (r.url) { location.href = r.url; return; }
    if (!r.ok) throw new Error(r.message || "That didn't work.");
    toast(r.message);
    done();
  };
  const actions = [{ label: "Back", onClick: () => addressDialog(p, v, qty) }];
  actions.push({ label: `Pay ${usd(q.credits)} in credits`, kind: q.cards ? "secondary" : "primary", onClick: async () => {
    if (!enough) throw new Error(`You have ${usd(q.balance)} in credits. Top up first, or pay with a card.`);
    await pay("credits");
  } });
  if (q.cards) actions.push({ label: `Pay ${usd(q.total)} with card`, kind: "primary", onClick: () => pay("card").then(() => false) });
  openDialog({
    title: "Your total",
    body: h("div", { class: "mx-total" },
      row(`${qty > 1 ? `${qty} × ` : ""}${p.title} (${v.title})`, usd(q.subtotal)),
      row(`Shipping to ${address.city}`, usd(q.shipping)),
      row("Total", usd(q.total), "sum"),
      h("p", { class: "text-3 small", text: `Paying with Galaxy Credits costs ${usd(q.credits)}, because credit packs include bonus credit. You have ${usd(q.balance)} in credits.` }),
      h("p", { class: "text-3 small", text: "Made to order, usually shipped in 3 to 7 days. We'll notify you with tracking when it ships." })),
    actions,
  });
}

function done() {
  openDialog({
    title: "Order placed!",
    body: h("div", { class: "co-done" }, h("div", { class: "co-done-icon" }, iconEl("check")),
      h("p", { class: "text-2", text: "Your merch is being made. You'll get a notification with tracking when it ships." })),
    actions: [{ label: "Done", kind: "primary", onClick: () => { location.hash = "#merch"; location.reload(); } }],
  });
}

// ---------- orders ----------
function ordersBox(title, orders, owner) {
  return h("div", { class: "panel mx-orders" }, h("h3", { class: "fr-h", text: title }),
    ...orders.map((o) => h("div", { class: "mx-order" },
      h("div", { class: "mx-order-main" },
        h("b", { text: `#${o.id} · ${o.items.map((i) => `${i.qty > 1 ? `${i.qty} × ` : ""}${i.title} (${i.variant})`).join(", ")}` }),
        h("small", { class: "text-3", text: [owner ? o.username : null, new Date(o.createdAt).toLocaleDateString(), o.method === "credits" ? `${usd(o.credits)} in credits` : usd(o.total), owner ? o.shipTo : null].filter(Boolean).join(" · ") }),
        owner && o.error ? h("small", { class: "mx-err", text: o.error }) : null),
      h("div", { class: "mx-order-side" },
        h("span", { class: `mx-status s-${o.status}`, text: STATUS[o.status] || o.status }),
        o.tracking?.url ? h("a", { class: "btn btn-sm btn-secondary", href: o.tracking.url, target: "_blank", rel: "noopener noreferrer", text: "Track" }) : null))));
}

function ownerBox() {
  const box = h("div", { class: "panel mx-owner" }, h("h3", { class: "fr-h" }, iconEl("crown"), " Merch setup (only you see this)"));
  const line = (ok, text) => h("p", { class: `mx-check${ok ? " ok" : ""}` }, iconEl(ok ? "check" : "alert"), h("span", { text }));
  if (!state.ready) {
    box.append(line(false, "Printify isn't connected yet. In Cloudflare, add your Printify API key as a secret named PRINTIFY_API_KEY."));
    return box;
  }
  if (state.error) box.append(line(false, state.error));
  else box.append(line(true, `Printify is connected: ${state.total || 0} product${state.total === 1 ? "" : "s"}, ${state.products.length} for sale.`));
  if (!state.error && !state.total) box.append(line(false, "Add products in Printify (Products > Add product). They show here by themselves within 5 minutes."));
  box.append(line(state.webhooks, state.webhooks ? "Shipping updates are on." : "Turn on shipping updates so players get tracking automatically."));
  const btn = h("button", { class: "btn btn-sm btn-primary", type: "button", text: state.webhooks ? "Reconnect shipping updates" : "Turn on shipping updates" });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try { const r = await postJson("/api/store/merch/connect", {}); toast(r.message); state.webhooks = true; } catch (e) { toast(e.message); }
    btn.disabled = false;
  });
  box.append(btn);
  if (state.hidden?.length) {
    box.append(h("p", { class: "text-2 small", style: "margin:12px 0 4px", text: "Hidden because the price is too low to make money (raise the price in Printify):" }),
      h("ul", { class: "mx-hidden" }, ...state.hidden.map((x) => h("li", { text: `${x.product} (${x.variant}): ${usd(x.price)}, needs at least ${usd(x.needs)}` }))));
  }
  box.append(h("p", { class: "text-3 small", style: "margin:10px 0 0", text: `Players pay your Printify price plus the real shipping cost. In credits, merch costs ${Math.round((state.creditRate - 1) * 100)}% more, which covers the bonus credit from big packs, so you never lose money.` }));
  if (state.orders?.length) box.append(ordersBox("All merch orders", state.orders, true));
  return box;
}
