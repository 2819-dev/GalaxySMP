// Store cart: buy several things at once (ranks, Shop items, packs, bundles and merch), with one promo code
// for the whole cart and one payment (card or Galaxy Credits). "Buy now" on an item still works like before
// (and is the way to send something as a gift).
//
// Prices are always worked out here, never trusted from the browser:
//   - game items: their Store price; a promo code applies to every item it works on
//     ("$ off" codes come off once per cart, not once per item);
//   - merch: the Printify price + real shipping (promo codes don't apply to merch);
//   - credits: game items cost the same in credits; merch costs more in credits (see merch.js).
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { product, checkPromo, appliesTo, MIN_CHARGE, reservePromo, promoUsed, promoCancel } from "../store/promos.js";
import { SHOP_ITEMS } from "../store/shop.js";
import { change, balance } from "../store/credits.js";
import { createCheckout } from "../lib/stripe.js";
import { onSale, linkedPlayer, deliver, ownerOf, stripeReady, PLAN_DAYS } from "./store.js";
import { notify } from "./notify.js";

const MAX_LINES = 20;
const MAX_QTY = 10;
const usd = (c) => `$${(Number(c) / 100).toFixed(2)}`;

// Works out the whole cart. Returns everything the quote and the checkout need.
async function priceCart(env, sql, user, body, { needAddress }) {
  const raw = (Array.isArray(body.lines) ? body.lines : []).slice(0, MAX_LINES);
  if (!raw.length) throw new HttpError(400, "Your cart is empty.");
  const player = await linkedPlayer(sql, user.id);
  const game = [];
  const merchRaw = [];
  for (const l of raw) {
    if (l?.type === "merch") { merchRaw.push({ productId: l.productId, variantId: l.variantId, qty: l.qty }); continue; }
    const prod = product(l?.item, l?.option);
    if (!prod) throw new HttpError(404, "Something in your cart isn't in the Store anymore. Remove it and try again.");
    if (!onSale(prod)) throw new HttpError(409, `${prod.name} can't be bought yet.`);
    const item = prod.isPlan ? null : SHOP_ITEMS[prod.key];
    const qty = prod.isPlan || item?.limit === 1 ? 1 : Math.max(1, Math.min(MAX_QTY, Math.round(Number(l.qty) || 1)));
    const same = game.find((g) => g.prod.key === prod.key && g.prod.option === prod.option);
    if (same) { same.qty = Math.min(MAX_QTY, same.qty + qty); continue; }
    game.push({ prod, item, qty });
  }
  if (game.length && !player) throw new HttpError(409, "Link your Minecraft account first (type /link in game), so we know who to give your items to.");
  if (game.filter((g) => g.prod.isPlan).length > 1) throw new HttpError(409, "You can only have one rank in your cart. Remove one of them.");
  for (const g of game) {
    if (g.prod.isPlan) {
      const [s] = await sql`SELECT plan, expires_at FROM subscriptions WHERE xuid = ${player.xuid}`;
      if (s && !s.expires_at && s.plan === g.prod.key) throw new HttpError(409, `You already have ${g.prod.name} with no end date.`);
    }
    if (g.item?.limit) {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM shop_orders WHERE xuid = ${player.xuid} AND item = ${g.item.id}`;
      const has = n + ((player.cosmetics || []).includes(g.item.id) && !n ? 1 : 0);
      if (has + g.qty > g.item.limit) {
        throw new HttpError(409, g.item.limit === 1 ? `You already have ${g.item.name}. Remove it from your cart.` : `You can have at most ${g.item.limit} of ${g.item.name} (you have ${has}).`);
      }
    }
  }

  // one promo code for the whole cart
  let promo = null;
  if (body.code && game.length) {
    let firstError = null;
    for (const g of game) {
      try { ({ promo } = await checkPromo(sql, user, body.code, g.prod)); break; } catch (e) { firstError ||= e; }
    }
    if (!promo) throw firstError?.status === 409 && /doesn't work on/.test(firstError.message) ? new HttpError(409, "That code doesn't work on anything in your cart.") : firstError;
  } else if (body.code && !game.length) {
    throw new HttpError(409, "Promo codes don't work on merch.");
  }
  // The discount is worked out on each line's total (the card minimum applies to the whole cart, not each item).
  let amountLeft = promo?.kind === "amount" ? Number(promo.value) : 0;
  let oneUsed = false;   // "free" and "first month" codes cover one item
  for (const g of game) {
    g.unit = g.prod.price;
    g.paid = g.prod.price * g.qty;
    if (!promo || !appliesTo(promo, g.prod) || (promo.kind === "first_month" && !g.prod.isPlan)) continue;
    if (promo.kind === "percent") g.paid = Math.round(g.paid * (100 - Number(promo.value)) / 100);
    else if (promo.kind === "free") { if (oneUsed) continue; oneUsed = true; g.paid = Math.max(0, g.paid - g.unit); }   // one item free, not the whole cart
    else if (promo.kind === "first_month") { if (oneUsed) continue; oneUsed = true; g.paid = g.prod.price * (g.qty - 1); }
    else if (promo.kind === "amount") { const off = Math.min(amountLeft, g.paid); g.paid -= off; amountLeft -= off; }
    g.paid = Math.max(0, g.paid);
  }
  const gameFull = game.reduce((s, g) => s + g.prod.price * g.qty, 0);
  const gameTotal = game.reduce((s, g) => s + g.paid, 0);

  // merch
  let merch = null;
  if (merchRaw.length) {
    const m = await import("./merch.js");
    if (!m.merchReady(env)) throw new HttpError(409, "Merch isn't available right now. Remove it from your cart.");
    const { lines, subtotal } = await m.priced(env, merchRaw);
    merch = { lines, subtotal, shipping: null, shipCost: null, address: null };
    if (needAddress || body.address) {
      merch.address = m.cleanAddress(body.address);
      let cost;
      try { cost = await m.shippingCost(env, lines, merch.address); } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(409, "We couldn't work out shipping to that address. Check it and try again.");
      }
      merch.shipCost = cost;
      merch.shipping = m.shippingPrice(cost);
    }
    merch.total = subtotal + (merch.shipping || 0);
    merch.credits = m.creditsFor(merch.total);
  }
  const total = gameTotal + (merch?.total || 0);
  const owner = ownerOf(env, user);
  const credits = (owner ? 0 : gameTotal) + (merch?.credits || 0);  // the owner's game items are free with credits
  return { player, game, promo, gameFull, gameTotal, merch, total, credits, owner };
}

const outLines = (c) => [
  ...c.game.map((g) => ({ type: "item", key: g.prod.key, option: g.prod.option, name: g.prod.name, qty: g.qty, unit: g.unit, total: g.paid, discounted: g.paid < g.unit * g.qty })),
  ...(c.merch?.lines || []).map((l) => ({ type: "merch", name: `${l.title} (${l.variant})`, qty: l.qty, unit: l.price, total: l.price * l.qty })),
];

// POST /api/store/cart/quote { lines, code, address? }
export async function quote(request, env) {
  const user = await requireUser(request, env);
  await rateLimit(env, "AUTH_LIMITER", `cartq:${user.id}`);
  const body = await readJson(request);
  const sql = getDb(env);
  const c = await priceCart(env, sql, user, body, { needAddress: false });
  return json({
    ok: true, lines: outLines(c), promo: c.promo ? { code: c.promo.code } : null,
    discount: c.gameFull - c.gameTotal, gameTotal: c.gameTotal,
    merch: c.merch ? { subtotal: c.merch.subtotal, shipping: c.merch.shipping, needsAddress: true } : null,
    total: c.total, credits: c.credits, balance: c.owner ? null : await balance(sql, user.id), owner: c.owner, cards: stripeReady(env),
  });
}

// POST /api/store/cart/checkout { lines, code, address?, method: "card" | "credits" }
export async function checkout(request, env) {
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  await rateLimit(env, "AUTH_LIMITER", `cartc:${user.id}`);
  const body = await readJson(request);
  const sql = getDb(env);
  const c = await priceCart(env, sql, user, body, { needAddress: true });
  const method = body.method === "credits" ? "credits" : "card";
  const cart = {
    game: c.game.map((g) => ({ key: g.prod.key, option: g.prod.option, qty: g.qty, paid: g.paid })),
    merch: c.merch ? { lines: c.merch.lines, address: c.merch.address, subtotal: c.merch.subtotal, shipping: c.merch.shipping, shipCost: c.merch.shipCost, credits: c.merch.credits } : null,
    promo: c.promo ? Number(c.promo.id) : null, total: c.total, credits: c.credits,
  };

  if (method === "credits" || c.total === 0) {
    const cost = method === "credits" ? c.credits : 0;
    const rid = c.promo ? await reservePromo(sql, c.promo, user.id, { item: "cart", price: c.gameFull, final: c.gameTotal }) : null;
    if (cost > 0) {
      const left = await change(sql, user.id, -cost, "purchase", `Store cart (${outLines(c).length} item${outLines(c).length === 1 ? "" : "s"})`, "cart");
      if (left === null) {
        if (rid) await promoCancel(sql, rid);
        throw new HttpError(409, `This costs ${usd(cost)} in credits, but you have ${usd(await balance(sql, user.id))}. Top up, or pay with a card.`);
      }
    }
    if (rid) await promoUsed(sql, rid);
    const result = await fulfil(env, sql, user.id, cart, { method: c.total === 0 ? "promo" : "credits" });
    return json({ ok: true, done: true, message: result.message });
  }

  if (!stripeReady(env)) return json({ ok: false, message: "Card payments aren't available yet. You can pay with Galaxy Credits." });
  const amount = Math.max(MIN_CHARGE, c.total);
  const [pay] = await sql`INSERT INTO payments (user_id, kind, item, amount_cents, promo_id, cart) VALUES (${user.id}, 'cart', 'cart', ${amount}, ${c.promo?.id || null}, ${JSON.stringify(cart)}::jsonb) RETURNING id`;
  const rid = c.promo ? await reservePromo(sql, c.promo, user.id, { item: "cart", price: c.gameFull, final: c.gameTotal, paymentId: pay.id }) : null;
  const names = outLines(c).map((l) => `${l.qty > 1 ? `${l.qty} × ` : ""}${l.name}`).join(", ");
  let session;
  try {
    session = await createCheckout(env, {
      paymentId: pay.id, userId: user.id, name: "GalaxySMP Store",
      description: `${names}${c.merch ? `. Shipping: ${usd(c.merch.shipping)}` : ""}${c.promo ? ` (promo ${c.promo.code})` : ""}`.slice(0, 500),
      amountCents: amount, origin: new URL(request.url).origin, successPath: "/store?paid=cart", cancelPath: "/store",
    });
  } catch (e) {
    if (rid) await promoCancel(sql, rid);
    throw e;
  }
  await sql`UPDATE payments SET stripe_session = ${session.id} WHERE id = ${pay.id}`;
  return json({ ok: true, url: session.url });
}

// From the Stripe webhook: a cart paid by card.
export async function paid(env, sql, pay) {
  await fulfil(env, sql, Number(pay.user_id), pay.cart, { method: "card", pay });
}

// Gives everything in a paid cart. Anything that can't be given becomes credit (game items) or is refunded (merch).
async function fulfil(env, sql, userId, cart, { method, pay = null }) {
  const [u] = await sql`SELECT username FROM users WHERE id = ${userId}`;
  const by = { id: userId, username: u?.username || "card" };
  const player = cart.game.length ? await linkedPlayer(sql, userId) : null;
  const given = [];
  let creditBack = 0;
  for (const g of cart.game) {
    const prod = product(g.key, g.option);
    for (let i = 0; i < g.qty; i++) {
      try {
        if (!prod || !player) throw new Error("no player");
        await deliver(env, sql, player, prod, by, method === "card" ? "payment" : method);
        if (!prod.isPlan) await sql`UPDATE shop_orders SET price_cents = ${Math.round(g.paid / g.qty)} WHERE id = (SELECT max(id) FROM shop_orders WHERE xuid = ${player.xuid} AND item = ${prod.key})`;
        given.push(prod.isPlan ? `${prod.name} (${PLAN_DAYS} days)` : prod.name);
      } catch (e) {
        console.error("cart item failed", g.key, e.message);
        creditBack += Math.round(g.paid / g.qty);
      }
    }
  }
  if (creditBack > 0 && method !== "promo") await change(sql, userId, creditBack, "refund", "Store items that couldn't be given", "cart");
  let merchNote = "";
  if (cart.merch) {
    const m = await import("./merch.js");
    const [order] = await sql`
      INSERT INTO merch_orders (user_id, status, method, items, address, subtotal_cents, shipping_cents, ship_cost_cents, total_cents, credits_cents, payment_id, paid_at)
      VALUES (${userId}, 'paid', ${method === "card" ? "card" : "credits"}, ${JSON.stringify(cart.merch.lines)}::jsonb, ${JSON.stringify(cart.merch.address)}::jsonb,
              ${cart.merch.subtotal}, ${cart.merch.shipping}, ${cart.merch.shipCost || 0}, ${cart.merch.subtotal + cart.merch.shipping},
              ${method === "credits" ? cart.merch.credits : 0}, ${pay?.id || null}, now()) RETURNING id`;
    const placed = await m.place(env, sql, order.id, pay, cart.merch.subtotal + cart.merch.shipping);
    merchNote = placed.ok ? " Your merch is being made, and we'll tell you when it ships." : ` ${placed.message}`;
  }
  if (pay) await sql`UPDATE promo_redemptions SET status = 'used' WHERE payment_id = ${pay.id}`;
  const message = `${given.length ? `${given.join(", ")} ${given.length === 1 ? "is" : "are"} yours! ${player ? "They're ready in game." : ""}` : ""}${creditBack ? ` Something couldn't be given, so you got ${usd(creditBack)} of credit instead.` : ""}${merchNote}`.trim() || "Thanks for your order!";
  if (method === "card") await notify(env, [userId], "reward", { title: "Thanks for your order!", body: message.slice(0, 200), url: "/store", tag: "cart" }).catch(() => {});
  return { message };
}
