// Store cart: "Add to cart" on any Store item (ranks, Shop items, packs, bundles and merch), then check out
// everything at once with one promo code and one payment (card or Galaxy Credits). "Buy now" still buys a single
// item straight away (and is how gifts are sent). The cart is kept on this device only (localStorage).
import { toast, iconEl } from "/js/site.js";
import { h, openDialog, postJson } from "/js/dialog.js";

const KEY = "gsmp-store-cart";
const usd = (n) => `$${Number(n).toFixed(2)}`;
const cents = (c) => usd(Number(c) / 100);

function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function save(lines) {
  try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* private mode: the cart lasts until the page closes */ }
  memory = lines;
  document.dispatchEvent(new CustomEvent("cart-changed"));
}
let memory = null;
export const clearCart = () => save([]);
export const cartLines = () => memory || (memory = load());
export const cartCount = () => cartLines().reduce((n, l) => n + (l.qty || 1), 0);
const same = (a, b) => a.type === b.type && (a.type === "merch" ? a.productId === b.productId && a.variantId === b.variantId : a.item === b.item && (a.option || null) === (b.option || null));

// line: { type: "item", item, option, name, price (dollars), icon, max } or { type: "merch", productId, variantId, qty, name, price, image, max }
export function addToCart(line) {
  const lines = cartLines().slice();
  const max = line.max || 10;
  if (line.type === "item" && line.plan && lines.some((l) => l.plan && l.item !== line.item)) {
    toast("You can only have one rank in your cart. Remove the other one first.");
    return;
  }
  const have = lines.find((l) => same(l, line));
  if (have) {
    if ((have.qty || 1) >= max) { toast(max === 1 ? `${line.name} is already in your cart.` : `You can have up to ${max} of ${line.name}.`); return; }
    have.qty = Math.min(max, (have.qty || 1) + (line.qty || 1));
  } else {
    lines.push({ ...line, qty: Math.min(max, line.qty || 1) });
  }
  save(lines);
  toast(`Added to cart: ${line.name}`);
}

// The cart button for the Store's sticky category bar.
export function cartButton() {
  const count = h("span", { class: "ap-cart-n" });
  const b = h("button", { class: "ap-cartbtn", type: "button", "aria-label": "Cart", onclick: openCart }, iconEl("cart"), h("span", { class: "ap-cart-label", text: "Cart" }), count);
  const draw = () => {
    const n = cartCount();
    count.textContent = n ? String(n) : "";
    count.hidden = !n;
    b.classList.toggle("has", n > 0);
    b.setAttribute("aria-label", n ? `Cart, ${n} item${n === 1 ? "" : "s"}` : "Cart (empty)");
  };
  document.addEventListener("cart-changed", draw);
  draw();
  return b;
}

const toServer = (lines) => lines.map((l) => (l.type === "merch"
  ? { type: "merch", productId: l.productId, variantId: l.variantId, qty: l.qty || 1 }
  : { type: "item", item: l.item, option: l.option || null, qty: l.qty || 1 }));

let ctx = { signedIn: false, countries: undefined, addressForm: null, onDone: null };
export function setupCart(opts) { ctx = { ...ctx, ...opts }; }

export function openCart() {
  const lines = cartLines();
  if (!lines.length) {
    openDialog({ title: "Your cart", body: h("p", { class: "text-2", text: "Your cart is empty. Tap \"Add to cart\" on anything in the Store." }), actions: [{ label: "Close" }] });
    return;
  }
  const list = h("div", { class: "ct-list" });
  const sum = h("b");
  const draw = () => {
    const cur = cartLines();
    list.replaceChildren(...cur.map((l, i) => {
      const max = l.max || 10;
      const qty = h("span", { class: "ct-qty", text: String(l.qty || 1) });
      const step = (d) => {
        const next = cartLines().slice();
        const n = (next[i].qty || 1) + d;
        if (n <= 0) next.splice(i, 1); else next[i] = { ...next[i], qty: Math.min(max, n) };
        save(next);
        if (!next.length) { dlg.close(); openCart(); return; }
        draw();
      };
      return h("div", { class: "ct-line" },
        l.image ? h("img", { class: "ct-img", src: l.image, alt: "", loading: "lazy", onerror: (e) => e.target.replaceWith(h("span", { class: "ct-ic" }, iconEl("bag"))) })
          : h("span", { class: "ct-ic" }, iconEl(l.icon || (l.type === "merch" ? "bag" : "cart"))),
        h("div", { class: "ct-main" }, h("b", { text: l.name }), h("small", { class: "text-3", text: l.type === "merch" ? "Merch · shipped to you" : l.plan ? "Rank · 30 days" : "Delivered in game" })),
        max > 1 ? h("div", { class: "ct-step" },
          h("button", { type: "button", class: "icon-btn", "aria-label": "One less", onclick: () => step(-1) }, "−"), qty,
          h("button", { type: "button", class: "icon-btn", "aria-label": "One more", onclick: () => step(1), disabled: (l.qty || 1) >= max }, "+"))
          : h("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Remove", onclick: () => step(-1) }),
        h("b", { class: "ct-price", text: usd(l.price * (l.qty || 1)) }));
    }));
    sum.textContent = usd(cur.reduce((s, l) => s + l.price * (l.qty || 1), 0));
  };
  draw();
  const code = h("input", { class: "input", id: "ct-code", placeholder: "Promo code (optional)", maxlength: 32, autocomplete: "off", autocapitalize: "characters" });
  const hasMerch = lines.some((l) => l.type === "merch");
  const dlg = openDialog({
    title: "Your cart",
    body: h("div", { class: "ct-body" }, list,
      h("div", { class: "mx-line sum" }, h("span", { text: hasMerch ? "Items (before shipping)" : "Items" }), sum),
      h("label", { class: "field" }, h("span", { text: "Promo code" }), code),
      hasMerch ? h("p", { class: "text-3 small", style: "margin:0", text: "Promo codes work on game items, not merch. You'll see shipping for merch on the next step." }) : null),
    actions: [{ label: "Keep shopping" }, { label: hasMerch ? "Next: shipping" : "Check out", kind: "primary", onClick: async () => {
      if (!ctx.signedIn) { location.href = "/community"; return; }
      const body = { lines: toServer(cartLines()), code: code.value.trim() || undefined };
      if (cartLines().some((l) => l.type === "merch")) {
        await postJson("/api/store/cart/quote", body);  // check the cart (and the code) before asking for an address
        addressStep(body);
      } else {
        totalStep(body, await postJson("/api/store/cart/quote", body));
      }
    } }],
  });
  dlg.dialog.classList.add("ct-dialog");
}

function addressStep(body) {
  if (!ctx.addressForm) return toast("Merch isn't available right now.");
  const { el, value } = ctx.addressForm(ctx.countries);
  openDialog({
    title: "Where should we send your merch?",
    body: h("div", { class: "form mx-form" }, el,
      h("p", { class: "text-3 small", style: "margin:0", text: "Your address is only used to ship this order. It's shared with Printify, who makes and ships it. Under 18? Ask a parent before ordering." })),
    actions: [{ label: "Back", onClick: () => openCart() }, { label: "See total", kind: "primary", onClick: async () => {
      const full = { ...body, address: value() };
      totalStep(full, await postJson("/api/store/cart/quote", full));
    } }],
  });
}

function totalStep(body, q) {
  const row = (a, b, cls = "") => h("div", { class: `mx-line ${cls}` }, h("span", { text: a }), h("b", { text: b }));
  const pay = async (method) => {
    const r = await postJson("/api/store/cart/checkout", { ...body, method });
    if (r.url) { location.href = r.url; return false; }
    if (!r.ok) throw new Error(r.message || "That didn't work.");
    save([]);
    openDialog({
      title: "Thank you!",
      body: h("div", { class: "co-done" }, h("div", { class: "co-done-icon" }, iconEl("check")), h("p", { class: "text-2", text: r.message })),
      actions: [{ label: "Done", kind: "primary", onClick: () => ctx.onDone?.() }],
    });
  };
  const enough = q.owner || (q.balance ?? 0) >= q.credits;
  const actions = [{ label: "Back", onClick: () => openCart() }];
  if (q.total === 0) actions.push({ label: "Get it free", kind: "primary", onClick: () => pay("credits") });
  else {
    actions.push({ label: q.credits === 0 ? "Get it (owner)" : `Pay ${cents(q.credits)} in credits`, kind: q.cards ? "secondary" : "primary", onClick: async () => {
      if (!enough) throw new Error(`You have ${cents(q.balance)} in credits. Top up first, or pay with a card.`);
      await pay("credits");
    } });
    if (q.cards) actions.push({ label: `Pay ${cents(q.total)} with card`, kind: "primary", onClick: () => pay("card") });
  }
  openDialog({
    title: "Your total",
    body: h("div", { class: "mx-total" },
      ...q.lines.map((l) => row(`${l.qty > 1 ? `${l.qty} × ` : ""}${l.name}`, cents(l.total), l.discounted ? "disc" : "")),
      q.discount ? row(`Promo ${q.promo?.code || ""}`, `−${cents(q.discount)}`, "disc") : null,
      q.merch?.shipping != null ? row("Shipping", cents(q.merch.shipping)) : null,
      row("Total", cents(q.total), "sum"),
      q.owner ? null : h("p", { class: "text-3 small", text: `In Galaxy Credits: ${cents(q.credits)}${q.merch ? " (merch costs a bit more in credits, because credit packs include bonus credit)" : ""}. You have ${cents(q.balance)}.` }),
      q.merch ? h("p", { class: "text-3 small", text: "Merch is made to order and usually ships in 3 to 7 days. Game items arrive in game right away (or next time you join)." }) : null),
    actions,
  });
}
