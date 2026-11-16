// Merch: real GalaxySMP products (stickers, t-shirts, hoodies...) made and shipped by Printify.
// The owner creates the products (design, sizes, colors, price) in Printify; the Store shows them by itself.
// A player picks one, types their address, sees the real shipping cost, and pays with a card (Stripe) or
// Galaxy Credits. Once paid, the order goes to Printify, which prints and ships it. Printify tells us when it
// ships (with tracking), and the player gets a notification.
//
// Money safety (so the owner never loses money):
//   - A size/color only shows if its price covers Printify's cost + card fees + a little for sales tax.
//   - Shipping is charged at Printify's real cost (plus the card fee on it).
//   - Credits: bigger credit packs give bonus credit (up to 20%), so merch costs that much more in credits.
//     That way every credit spent on merch was paid for with real money.
// The API key lives only in Cloudflare (PRINTIFY_API_KEY). Optional: PRINTIFY_SHOP_ID.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser, getUser } from "../lib/auth.js";
import { isOwner } from "../lib/names.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { createCheckout, stripe } from "../lib/stripe.js";
import { change, balance, PACKS } from "../store/credits.js";
import { notify } from "./notify.js";

const API = "https://api.printify.com/v1";
const MAX_QTY = 5;
const CACHE_MS = 5 * 60e3;
const usd = (c) => `$${(Number(c) / 100).toFixed(2)}`;
// The most credit a dollar can buy (the biggest pack's bonus): merch in credits costs this much more.
export const CREDIT_RATE = Math.max(...PACKS.map((p) => p.credit / p.price));
export const creditsFor = (cents) => Math.ceil(cents * CREDIT_RATE);
// The lowest price that still makes money: cost + ~10% for sales tax Printify may add + the card fee (2.9% + 30c).
export const minPrice = (cost) => Math.ceil((Number(cost) * 1.10 + 30) / 0.971);
// Shipping with the card fee on top.
export const shippingPrice = (cost) => Math.ceil(Number(cost) / 0.971);

export const COUNTRIES = [
  ["US", "United States"], ["CA", "Canada"], ["GB", "United Kingdom"], ["AU", "Australia"], ["NZ", "New Zealand"],
  ["IE", "Ireland"], ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"], ["BE", "Belgium"], ["ES", "Spain"],
  ["IT", "Italy"], ["SE", "Sweden"], ["NO", "Norway"], ["DK", "Denmark"], ["FI", "Finland"], ["AT", "Austria"],
  ["CH", "Switzerland"], ["PL", "Poland"], ["IL", "Israel"],
];
const COUNTRY = new Set(COUNTRIES.map((c) => c[0]));

export const merchReady = (env) => Boolean(env.PRINTIFY_API_KEY);
const stripeReadyEnv = (env) => Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
const ownerOf = (env, u) => Boolean(u && isOwner(env, u.username, u.platform === "bedrock"));

// ---------- Printify ----------
export async function printify(env, method, path, body) {
  const res = await (env.__fetch || fetch)(`${env.PRINTIFY_API_BASE || API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.PRINTIFY_API_KEY}`, "User-Agent": "GalaxySMP", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.errors?.reason || data?.message || data?.error || `Printify error ${res.status}`;
    console.error("printify error", res.status, path, JSON.stringify(data).slice(0, 300));
    throw new Error(typeof msg === "string" ? msg : `Printify error ${res.status}`);
  }
  return data;
}

let shopCache = null;
async function shopId(env) {
  if (env.PRINTIFY_SHOP_ID) return String(env.PRINTIFY_SHOP_ID);
  if (shopCache) return shopCache;
  const shops = await printify(env, "GET", "/shops.json");
  const list = Array.isArray(shops) ? shops : shops.data || [];
  const pick = list.find((s) => /custom|api/i.test(String(s.sales_channel || ""))) || list[0];
  if (!pick) throw new Error("No Printify store found. In Printify, add a store and choose \"API\" as its sales channel.");
  shopCache = String(pick.id);
  return shopCache;
}

const strip = (html) => String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|div)>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .replace(/\n{3,}/g, "\n\n").trim();

// The catalog, as the Store shows it. Cached for a few minutes. Each variant knows if it's safe to sell.
let catalogCache = { at: 0, list: null };
export async function catalog(env, { fresh = false } = {}) {
  if (!fresh && catalogCache.list && Date.now() - catalogCache.at < CACHE_MS) return catalogCache.list;
  const shop = await shopId(env);
  const out = [];
  for (let page = 1; page <= 4; page++) {
    const r = await printify(env, "GET", `/shops/${shop}/products.json?limit=50&page=${page}`);
    const items = r.data || [];
    for (const p of items) {
      if (p.visible === false) continue;
      const optionNames = (p.options || []).map((o) => ({ name: String(o.name || ""), type: o.type, values: (o.values || []).map((v) => ({ id: v.id, title: String(v.title || ""), colors: v.colors || null })) }));
      const variants = (p.variants || []).filter((v) => v.is_enabled !== false).map((v) => {
        const price = Math.round(Number(v.price) || 0), cost = Math.round(Number(v.cost) || 0);
        return { id: Number(v.id), title: String(v.title || ""), options: v.options || [], price, cost, available: v.is_available !== false,
          safe: price > 0 && price >= minPrice(cost) };
      });
      const images = (p.images || []).map((i) => ({ src: String(i.src || ""), variants: (i.variant_ids || []).map(Number), main: Boolean(i.is_default) }))
        .filter((i) => /^https:\/\//.test(i.src)).slice(0, 40);
      out.push({ id: String(p.id), title: String(p.title || "Merch").slice(0, 80), description: strip(p.description).slice(0, 600), options: optionNames, variants, images });
    }
    if (!r.last_page || page >= Number(r.last_page)) break;
  }
  catalogCache = { at: Date.now(), list: out };
  return out;
}

// What players see: only safe, in-stock variants, without Printify's cost.
function publicProduct(p) {
  const variants = p.variants.filter((v) => v.safe).map((v) => ({ id: v.id, title: v.title, options: v.options, price: v.price, credits: creditsFor(v.price), available: v.available }));
  if (!variants.length) return null;
  const used = new Set(variants.flatMap((v) => v.options));
  return {
    id: p.id, title: p.title, description: p.description,
    options: p.options.map((o) => ({ ...o, values: o.values.filter((v) => used.has(v.id)) })).filter((o) => o.values.length),
    variants, images: p.images, from: Math.min(...variants.map((v) => v.price)),
  };
}

// GET /api/store/merch: the products (anyone can look), the member's own orders, and for the owner: setup + all orders.
export async function list(request, env) {
  const user = await getUser(request, env).catch(() => null);
  const owner = ownerOf(env, user);
  const sql = getDb(env);
  const out = { ok: true, ready: merchReady(env), cards: stripeReadyEnv(env), countries: COUNTRIES, creditRate: CREDIT_RATE, products: [] };
  if (merchReady(env)) {
    try {
      const all = await catalog(env);
      out.products = all.map(publicProduct).filter(Boolean);
      if (owner) {
        out.hidden = all.flatMap((p) => p.variants.filter((v) => !v.safe).map((v) => ({ product: p.title, variant: v.title, price: v.price, cost: v.cost, needs: minPrice(v.cost) }))).slice(0, 50);
        out.total = all.length;
      }
    } catch (e) {
      out.error = owner ? `Printify: ${e.message}` : "Merch couldn't be loaded right now.";
    }
  }
  if (user) {
    out.mine = (await sql`SELECT * FROM merch_orders WHERE user_id = ${user.id} AND status <> 'awaiting_payment' ORDER BY id DESC LIMIT 20`).map(orderOut);
    out.balance = await balance(sql, user.id);
  }
  if (owner) {
    out.owner = true;
    out.orders = (await sql`SELECT m.*, u.username FROM merch_orders m JOIN users u ON u.id = m.user_id
                             WHERE m.status <> 'awaiting_payment' ORDER BY m.id DESC LIMIT 50`).map((o) => ({ ...orderOut(o), username: o.username, error: o.error }));
    const [hook] = await sql`SELECT value FROM economy_config WHERE key = 'printify_webhooks'`;
    out.webhooks = Boolean(hook);
  }
  return json(out, 200, { "Cache-Control": "no-store" });
}

function orderOut(o) {
  return {
    id: Number(o.id), status: o.status, method: o.method, items: o.items, total: Number(o.total_cents), shipping: Number(o.shipping_cents),
    credits: Number(o.credits_cents || 0), createdAt: o.created_at, tracking: o.tracking || null,
    shipTo: o.address ? `${o.address.first_name} ${o.address.last_name}, ${o.address.city}` : null,
  };
}

// ---------- the order ----------
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
function cleanAddress(a = {}) {
  const ad = {
    first_name: clip(a.first_name, 40), last_name: clip(a.last_name, 40), email: clip(a.email, 120), phone: clip(a.phone, 30),
    country: clip(a.country, 2).toUpperCase(), region: clip(a.region, 40), address1: clip(a.address1, 100), address2: clip(a.address2, 100),
    city: clip(a.city, 60), zip: clip(a.zip, 16),
  };
  if (!ad.first_name || !ad.last_name) throw new HttpError(400, "Type the name of the person it's going to.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ad.email)) throw new HttpError(400, "Type an email address for shipping updates.");
  if (!COUNTRY.has(ad.country)) throw new HttpError(400, "Choose a country.");
  if (!ad.address1 || !ad.city || !ad.zip) throw new HttpError(400, "Fill in the street address, city and ZIP / postal code.");
  if (["US", "CA", "AU"].includes(ad.country) && !ad.region) throw new HttpError(400, ad.country === "US" ? "Choose the state." : "Type the state or province.");
  return ad;
}

// Checks the items against the live catalog and works out the price (never trusts prices from the browser).
async function priced(env, rawItems) {
  const items = (Array.isArray(rawItems) ? rawItems : []).slice(0, 10);
  if (!items.length) throw new HttpError(400, "Choose something to buy.");
  const all = await catalog(env);
  const lines = [];
  for (const it of items) {
    const p = all.find((x) => x.id === String(it.productId));
    const v = p?.variants.find((x) => x.id === Number(it.variantId));
    if (!p || !v || !v.safe) throw new HttpError(409, "That item isn't available anymore. Refresh the Store and try again.");
    if (!v.available) throw new HttpError(409, `${p.title} (${v.title}) is out of stock right now.`);
    const qty = Math.max(1, Math.min(MAX_QTY, Math.round(Number(it.qty) || 1)));
    const img = p.images.find((i) => i.variants.includes(v.id))?.src || p.images[0]?.src || null;
    lines.push({ productId: p.id, variantId: v.id, qty, title: p.title, variant: v.title, price: v.price, image: img });
  }
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  return { lines, subtotal };
}

async function shippingCost(env, lines, address) {
  const shop = await shopId(env);
  const r = await printify(env, "POST", `/shops/${shop}/orders/shipping.json`, {
    line_items: lines.map((l) => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.qty })),
    address_to: address,
  });
  const cost = Number(r.standard);
  if (!Number.isFinite(cost) || cost < 0) throw new HttpError(409, "Printify can't ship that to this address. Check the address, or try another country.");
  return cost;
}

async function quoteFor(env, body) {
  if (!merchReady(env)) throw new HttpError(409, "Merch isn't available yet.");
  const address = cleanAddress(body.address);
  const { lines, subtotal } = await priced(env, body.items);
  let shipCost;
  try { shipCost = await shippingCost(env, lines, address); } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(409, "We couldn't work out shipping to that address. Check it and try again.");
  }
  const shipping = shippingPrice(shipCost);
  const total = subtotal + shipping;
  return { address, lines, subtotal, shipping, shipCost, total, credits: creditsFor(total) };
}

// POST /api/store/merch/quote { items: [{ productId, variantId, qty }], address }
export async function quote(request, env) {
  const user = await requireUser(request, env);
  await rateLimit(env, "AUTH_LIMITER", `merchq:${user.id}`);
  const q = await quoteFor(env, await readJson(request));
  const sql = getDb(env);
  return json({ ok: true, subtotal: q.subtotal, shipping: q.shipping, total: q.total, credits: q.credits, balance: await balance(sql, user.id), cards: stripeReadyEnv(env) });
}

// POST /api/store/merch/checkout { items, address, method: "card" | "credits" }
export async function checkout(request, env) {
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  await rateLimit(env, "AUTH_LIMITER", `merchc:${user.id}`);
  const body = await readJson(request);
  const q = await quoteFor(env, body);
  const sql = getDb(env);
  const method = body.method === "credits" ? "credits" : "card";
  const [order] = await sql`
    INSERT INTO merch_orders (user_id, status, method, items, address, subtotal_cents, shipping_cents, ship_cost_cents, total_cents, credits_cents)
    VALUES (${user.id}, 'awaiting_payment', ${method}, ${JSON.stringify(q.lines)}::jsonb, ${JSON.stringify(q.address)}::jsonb,
            ${q.subtotal}, ${q.shipping}, ${q.shipCost}, ${q.total}, ${method === "credits" ? q.credits : 0}) RETURNING *`;
  const what = q.lines.map((l) => `${l.qty > 1 ? `${l.qty} × ` : ""}${l.title} (${l.variant})`).join(", ");

  if (method === "credits") {
    const left = await change(sql, user.id, -q.credits, "purchase", `Merch: ${what}`.slice(0, 200), `merch:${order.id}`);
    if (left === null) {
      await sql`DELETE FROM merch_orders WHERE id = ${order.id}`;
      throw new HttpError(409, `This costs ${usd(q.credits)} in credits, but you have ${usd(await balance(sql, user.id))}. Top up, or pay with a card.`);
    }
    await sql`UPDATE merch_orders SET status = 'paid', paid_at = now() WHERE id = ${order.id}`;
    const placed = await place(env, sql, order.id);
    if (!placed.ok) return json({ ok: false, message: placed.message });
    return json({ ok: true, done: true, credits: left, message: "Order placed! We'll let you know when it ships." });
  }

  if (!stripeReadyEnv(env)) {
    await sql`DELETE FROM merch_orders WHERE id = ${order.id}`;
    return json({ ok: false, message: "Card payments aren't available yet. You can pay with Galaxy Credits." });
  }
  const [pay] = await sql`INSERT INTO payments (user_id, kind, item, amount_cents) VALUES (${user.id}, 'merch', ${String(order.id)}, ${q.total}) RETURNING id`;
  await sql`UPDATE merch_orders SET payment_id = ${pay.id} WHERE id = ${order.id}`;
  const origin = new URL(request.url).origin;
  const session = await createCheckout(env, {
    paymentId: pay.id, userId: user.id, name: "GalaxySMP Merch",
    description: `${what}. Shipping to ${q.address.city}, ${q.address.country}: ${usd(q.shipping)}.`.slice(0, 500),
    amountCents: q.total, origin, successPath: "/store?paid=merch#merch", cancelPath: "/store#merch",
  });
  await sql`UPDATE payments SET stripe_session = ${session.id} WHERE id = ${pay.id}`;
  return json({ ok: true, url: session.url });
}

// From the Stripe webhook: a card payment for merch went through.
export async function paid(env, sql, pay) {
  const [order] = await sql`UPDATE merch_orders SET status = 'paid', paid_at = now() WHERE id = ${Number(pay.item)} AND status = 'awaiting_payment' RETURNING id`;
  if (order) await place(env, sql, order.id, pay);
}

// Sends a paid order to Printify. If that fails, the player gets their money back.
async function place(env, sql, id, pay = null) {
  const [o] = await sql`SELECT * FROM merch_orders WHERE id = ${id}`;
  try {
    const shop = await shopId(env);
    const created = await printify(env, "POST", `/shops/${shop}/orders.json`, {
      external_id: `gsmp-${o.id}`, label: `GalaxySMP #${o.id}`,
      line_items: o.items.map((l) => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.qty })),
      shipping_method: 1, send_shipping_notification: false, address_to: o.address,
    });
    await sql`UPDATE merch_orders SET printify_id = ${String(created.id)}, status = 'placed', updated_at = now() WHERE id = ${o.id}`;
    try {
      await printify(env, "POST", `/shops/${shop}/orders/${created.id}/send_to_production.json`);
      await sql`UPDATE merch_orders SET status = 'in_production', updated_at = now() WHERE id = ${o.id}`;
    } catch (e) {
      // the order is in Printify; the owner can press "Send to production" there
      await sql`UPDATE merch_orders SET error = ${`Not sent to production: ${e.message}`.slice(0, 300)} WHERE id = ${o.id}`;
    }
    await notify(env, [Number(o.user_id)], "reward", { title: "Merch order placed", body: `Order #${o.id} is being made. We'll tell you when it ships.`, url: "/store#merch", tag: `merch-${o.id}` }).catch(() => {});
    await ownerAlert(env, sql, `New merch order #${o.id}: ${usd(o.total_cents)}${o.method === "credits" ? " (paid with credits)" : ""}.`).catch(() => {});
    return { ok: true };
  } catch (e) {
    console.error("merch order failed", o.id, e.message);
    await sql`UPDATE merch_orders SET status = 'failed', error = ${String(e.message).slice(0, 300)}, updated_at = now() WHERE id = ${o.id}`;
    let message = "We couldn't place your order, so you weren't charged.";
    if (o.method === "credits") {
      await change(sql, o.user_id, Number(o.credits_cents), "refund", `Merch order #${o.id} couldn't be placed`, `merch:${o.id}`);
      message = "We couldn't place your order, so your credits were given back.";
    } else if (pay?.payment_intent) {
      try {
        await stripe(env, "POST", "/refunds", { payment_intent: pay.payment_intent }, `gsmp-merch-refund-${o.id}`);
        await sql`UPDATE merch_orders SET status = 'refunded' WHERE id = ${o.id}`;
        message = "We couldn't place your order, so your card was refunded.";
      } catch (err) {
        console.error("merch refund failed", o.id, err.message);
        message = "We couldn't place your order. Staff will refund you shortly.";
      }
    }
    await notify(env, [Number(o.user_id)], "reward", { title: "Merch order problem", body: message, url: "/store#merch", tag: `merch-${o.id}` }).catch(() => {});
    await ownerAlert(env, sql, `Merch order #${o.id} failed: ${e.message}`).catch(() => {});
    return { ok: false, message };
  }
}

async function ownerAlert(env, sql, text) {
  const people = await sql`SELECT id, username, platform FROM users WHERE NOT banned ORDER BY id LIMIT 300`;
  const owners = people.filter((u) => isOwner(env, u.username, u.platform === "bedrock")).map((u) => Number(u.id));
  if (owners.length) await notify(env, owners, "reward", { title: "Merch", body: text, url: "/store#merch", tag: "merch-owner" });
}

// ---------- owner ----------
async function webhookSecret(env) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PRINTIFY_API_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("gsmp-printify-webhook"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

// POST /api/store/merch/connect (owner): checks the key and sets up shipping updates from Printify.
export async function connect(request, env) {
  const user = await requireUser(request, env);
  if (!ownerOf(env, user)) throw new HttpError(403, "Only the owner can do this.");
  if (!merchReady(env)) throw new HttpError(409, "Add PRINTIFY_API_KEY in Cloudflare first.");
  const sql = getDb(env);
  let shop;
  try { shop = await shopId(env); } catch (e) { throw new HttpError(409, `Printify said: ${e.message}`); }
  const url = `${new URL(request.url).origin}/api/store/printify-webhook`;
  const secret = await webhookSecret(env);
  const have = await printify(env, "GET", `/shops/${shop}/webhooks.json`).catch(() => []);
  const list = Array.isArray(have) ? have : have.data || [];
  for (const topic of ["order:updated", "order:shipment:created", "order:shipment:delivered"]) {
    const old = list.filter((w) => w.topic === topic && w.url === url);
    for (const w of old) await printify(env, "DELETE", `/shops/${shop}/webhooks/${w.id}.json`).catch(() => {});
    await printify(env, "POST", `/shops/${shop}/webhooks.json`, { topic, url, secret });
  }
  await sql`INSERT INTO economy_config (key, value, updated_by) VALUES ('printify_webhooks', ${JSON.stringify({ at: new Date().toISOString(), shop })}::jsonb, ${user.username})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  catalogCache = { at: 0, list: null };
  return json({ ok: true, message: "Printify is connected. Shipping updates will come in by themselves." });
}

// POST /api/store/printify-webhook (from Printify): order status changes and shipments.
export async function webhook(request, env) {
  if (!merchReady(env)) return new Response("not set up", { status: 404 });
  const raw = await request.text();
  const sent = String(request.headers.get("X-Pfy-Signature") || "").replace(/^sha256=/, "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(await webhookSecret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!sent || sent.length !== want.length || [...want].reduce((d, c, i) => d | (c.charCodeAt(0) ^ sent.charCodeAt(i)), 0) !== 0) {
    return new Response("bad signature", { status: 400 });
  }
  let ev;
  try { ev = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const sql = getDb(env);
  const pid = String(ev.resource?.id || "");
  const data = ev.resource?.data || {};
  const [o] = pid ? await sql`SELECT * FROM merch_orders WHERE printify_id = ${pid}` : [];
  if (!o) return json({ ok: true });
  if (ev.type === "order:shipment:created") {
    const tracking = { carrier: clip(data.carrier?.code, 40), number: clip(data.carrier?.tracking_number, 80), url: /^https?:\/\//.test(String(data.carrier?.tracking_url || "")) ? String(data.carrier.tracking_url).slice(0, 400) : null, at: data.shipped_at || new Date().toISOString() };
    await sql`UPDATE merch_orders SET status = 'shipped', tracking = ${JSON.stringify(tracking)}::jsonb, updated_at = now() WHERE id = ${o.id}`;
    await notify(env, [Number(o.user_id)], "reward", { title: "Your merch shipped!", body: `Order #${o.id} is on its way${tracking.carrier ? ` with ${tracking.carrier.toUpperCase()}` : ""}. Tap to see tracking.`, url: "/store#merch", tag: `merch-${o.id}` }).catch(() => {});
  } else if (ev.type === "order:shipment:delivered") {
    await sql`UPDATE merch_orders SET status = 'delivered', updated_at = now() WHERE id = ${o.id}`;
    await notify(env, [Number(o.user_id)], "reward", { title: "Your merch was delivered", body: `Order #${o.id} has arrived. Enjoy!`, url: "/store#merch", tag: `merch-${o.id}` }).catch(() => {});
  } else if (ev.type === "order:updated") {
    const st = String(data.status || "");
    if (st === "canceled" && !["canceled", "refunded"].includes(o.status)) {
      await sql`UPDATE merch_orders SET status = 'canceled', updated_at = now() WHERE id = ${o.id}`;
      await ownerAlert(env, sql, `Printify canceled merch order #${o.id}. Refund the player from the Control Panel or Stripe.`).catch(() => {});
    } else if (["in-production", "sending-to-production"].includes(st) && o.status === "placed") {
      await sql`UPDATE merch_orders SET status = 'in_production', updated_at = now() WHERE id = ${o.id}`;
    } else if (["has-issues", "unfulfillable", "payment-not-received", "on-hold"].includes(st)) {
      await sql`UPDATE merch_orders SET error = ${`Printify status: ${st}`} WHERE id = ${o.id}`;
      await ownerAlert(env, sql, `Merch order #${o.id} needs attention in Printify (${st.replace(/-/g, " ")}).`).catch(() => {});
    }
  }
  return json({ ok: true });
}

// From the Stripe webhook: the owner refunded a merch card payment.
export async function refunded(sql, pay) {
  await sql`UPDATE merch_orders SET status = 'refunded', updated_at = now() WHERE id = ${Number(pay.item)}`;
}
