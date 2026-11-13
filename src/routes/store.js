// Store checkout. Players pay for Store items with Galaxy Credits (a balance they top up with a card)
// or straight with a card. Card payments go through Stripe Checkout once its keys are in Cloudflare
// (STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET); Stripe then calls /api/store/stripe-webhook and
// the item or credit is delivered. What can be bought: the Shop's cosmetics (the rest says "Coming soon").
import { recordGift } from "./gifter.js";
import { postTimeline } from "./feed.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser, getUser } from "../lib/auth.js";
import { product, checkPromo, memberPromos, publicPromo, MIN_CHARGE } from "../store/promos.js";
import { SHOP_ITEMS } from "../store/shop.js";
import { PACKS, PACK, GIFT_MIN, GIFT_DAILY_MAX, change, balance, history } from "../store/credits.js";
import { createCheckout, verifyWebhook, stripe } from "../lib/stripe.js";
import { giveShopItem } from "./panel.js";
import { sendPlans, PLANS } from "./plans.js";
import { isOwner } from "../lib/names.js";
import { headUrlFor } from "./heads.js";
import { notify as pushNotify } from "./notify.js";

// What can be bought now ("plans" = subscriptions). The rest show "Coming soon".
export const ON_SALE = new Set(["plans", "money", "plots", "effects"]);
export const PLAN_DAYS = 30; // a subscription bought here lasts 30 days (buying again adds 30 more)

// The owner has unlimited credits (they aren't real money).
const ownerOf = (env, user) => isOwner(env, user.username, user.platform === "bedrock");

export const stripeReady = (env) => Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);

export function onSale(prod) {
  return Boolean(prod && (prod.isPlan ? ON_SALE.has("plans") : ON_SALE.has(prod.category)));
}

const usd = (c) => `$${(c / 100).toFixed(2)}`;

async function linkedPlayer(sql, userId) {
  const [p] = await sql`SELECT p.xuid, p.gamertag, p.cosmetics FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${userId}`;
  return p || null;
}

async function audit(sql, actorId, action, details) {
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${actorId}, ${action}, ${JSON.stringify(details)}::jsonb)`;
}

// GET /api/store/mine: balance, what the member owns, their plan and personal promo codes.
export async function mine(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ ok: true, signedIn: false, packs: publicPacks() });
  const sql = getDb(env);
  const p = await linkedPlayer(sql, user.id);
  const owned = {};
  let plan = "free";
  if (p) {
    const rows = await sql`SELECT item, count(*)::int AS n FROM shop_orders WHERE xuid = ${p.xuid} GROUP BY item`;
    for (const r of rows) owned[r.item] = r.n;
    for (const c of p.cosmetics || []) owned[c] = Math.max(owned[c] || 0, 1);
    const [s] = await sql`SELECT plan FROM subscriptions WHERE xuid = ${p.xuid} AND (expires_at IS NULL OR expires_at > now())`;
    if (s) plan = s.plan;
  }
  return json({
    ok: true, signedIn: true, username: user.username, linked: Boolean(p), owned, plan,
    infinite: ownerOf(env, user), credits: ownerOf(env, user) ? 1e9 : (await balance(sql, user.id)) / 100, history: await history(sql, user.id, 15),
    promos: await memberPromos(sql, user), packs: publicPacks(), cards: stripeReady(env),
    wishlist: (await sql`SELECT item FROM wishlist WHERE user_id = ${user.id}`).map((r) => r.item),
  });
}

const publicPacks = () => PACKS.map((p) => ({ id: p.id, price: p.price / 100, credit: p.credit / 100, bonus: (p.credit - p.price) / 100, badge: p.badge || null }));

// Checks an item can be bought by this member; returns { prod, item, player, promo, final }.
async function prepare(sql, user, body) {
  const prod = product(body.item ?? body.rankId, body.option);
  if (!prod) throw new HttpError(404, "That item doesn't exist.");
  if (!onSale(prod)) return { soon: true, prod };
  // "Gift to someone": it goes to their Minecraft account instead
  let giftTo = null;
  if (body.giftTo) {
    [giftTo] = await sql`SELECT id, username, banned FROM users WHERE id = ${Number(body.giftTo) || 0}`;
    if (!giftTo || giftTo.banned) throw new HttpError(404, "There's no member with that name.");
    if (Number(giftTo.id) === Number(user.id)) throw new HttpError(400, "That's you! Turn off gifting to buy it for yourself.");
  }
  const p = await linkedPlayer(sql, giftTo ? giftTo.id : user.id);
  if (!p) throw new HttpError(409, giftTo ? `${giftTo.username} hasn't linked their Minecraft account yet, so they can't get Store items.` : "Link your Minecraft account first (type /link in game), so we know who to give it to.");
  const item = prod.isPlan ? null : SHOP_ITEMS[prod.key];
  if (prod.isPlan) {
    const [s] = await sql`SELECT plan, expires_at FROM subscriptions WHERE xuid = ${p.xuid}`;
    if (s && !s.expires_at && s.plan === prod.key) throw new HttpError(409, giftTo ? `${giftTo.username} already has ${prod.name} with no end date.` : `You already have ${prod.name} with no end date.`);
  }
  if (item?.limit) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM shop_orders WHERE xuid = ${p.xuid} AND item = ${item.id}`;
    const has = n + ((p.cosmetics || []).includes(item.id) && !n ? 1 : 0);
    if (has >= item.limit) throw new HttpError(409, giftTo ? `${giftTo.username} already has ${item.limit === 1 ? item.name : `the most of ${item.name}`}.` : item.limit === 1 ? `You already have ${item.name}.` : `You already have the most (${item.limit}) of ${item.name}.`);
  }
  let promo = null;
  let final = prod.price;
  if (body.code) ({ promo, final } = await checkPromo(sql, user, body.code, prod));
  return { prod, item, player: p, promo, final, giftTo };
}

async function deliver(env, sql, player, prod, by, source) {
  await (await import("./wishlist.js")).gotItem(sql, player.xuid, prod.key).catch(() => {});
  if (prod.isPlan) return grantPlan(env, sql, player, prod, by, source);
  return giveShopItem(env, sql, { xuid: player.xuid, gamertag: player.gamertag }, { item: prod.key, option: prod.option }, by, source);
}

// A subscription bought in the Store: 30 days. Same plan again = 30 more days; the other plan = switch to it.
async function grantPlan(env, sql, player, prod, by, source) {
  const [cur] = await sql`SELECT plan, expires_at FROM subscriptions WHERE xuid = ${player.xuid}`;
  const keep = cur && cur.plan === prod.key && cur.expires_at && new Date(cur.expires_at) > new Date();
  const from = keep ? new Date(cur.expires_at) : new Date();
  const expires = new Date(from.getTime() + PLAN_DAYS * 86400_000).toISOString();
  await sql`INSERT INTO subscriptions (xuid, plan, expires_at, granted_by) VALUES (${player.xuid}, ${prod.key}, ${expires}, ${by.username})
            ON CONFLICT (xuid) DO UPDATE SET plan = EXCLUDED.plan, expires_at = EXCLUDED.expires_at, granted_by = EXCLUDED.granted_by`;
  await sql`INSERT INTO shop_orders (xuid, item, option, price_cents, source, given_by) VALUES (${player.xuid}, ${"plan:" + prod.key}, ${`${PLAN_DAYS} days`}, ${prod.price}, ${source}, ${by.username})`;
  const sent = await sendPlans(env, sql).catch(() => false);
  if (!keep) await postTimeline(sql, { kind: "plan", xuid: player.xuid, name: player.gamertag, title: `got ${prod.name || (prod.key === "pro" ? "Galaxy Pro+" : "Galaxy+")}`,
    detail: "Thanks for supporting GalaxySMP!", icon: "star", dedupe: `plan:${player.xuid}:${prod.key}:${new Date().toISOString().slice(0, 10)}` });
  return { ok: true, sent, expires };
}

const doneMessage = (prod, sent) => `${prod.name} is yours${prod.isPlan ? ` for ${PLAN_DAYS} days` : ""}! ${sent ? "It's ready in game." : "You'll get it next time the server is online."}`;

// POST /api/store/checkout { item, option, code, method: "credits" | "card" }
export async function checkout(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const ready = await prepare(sql, user, body);
  if (ready.soon) return json({ ok: false, comingSoon: true, message: `${ready.prod.name} is coming soon.` });
  const { prod, player, promo, final, giftTo } = ready;
  const by = { id: user.id, username: promo ? `promo ${promo.code}` : user.username };
  // a gift: count it for the Gifter badges and tell them
  const gifted = async (paid, ref) => {
    if (!giftTo) return;
    await recordGift(env, sql, { giverId: user.id, receiverId: giftTo.id, kind: prod.isPlan ? "plan" : "item", item: prod.key, cents: paid ? final : 0, paid, ref });
    await pushNotify(env, [giftTo.id], "dms", { title: `${user.username} sent you a gift!`, body: `${prod.name} is yours. It's ready in game.`, url: "/store", tag: `gift-item-${user.id}` }).catch(() => {});
  };
  const giftNote = (m) => (giftTo ? `You gifted ${prod.name} to ${giftTo.username}!` : m);

  if (final === 0) { // free with a promo code: give it now
    const result = await deliver(env, sql, player, prod, by, "promo");
    await sql`INSERT INTO promo_redemptions (promo_id, user_id, item, option, price_cents, final_cents, status)
              VALUES (${promo.id}, ${user.id}, ${prod.key}, ${prod.option}, ${prod.price}, 0, 'used')`;
    await gifted(false, null);
    return json({ ok: true, done: true, message: giftNote(doneMessage(prod, result.sent)) });
  }

  if (body.method === "credits" && ownerOf(env, user)) {
    const result = await deliver(env, sql, player, prod, { id: user.id, username: user.username }, "credits");
    await gifted(false, null);  // the owner's free gifts count too
    return json({ ok: true, done: true, message: giftNote(doneMessage(prod, result.sent)) });
  }
  if (body.method === "credits") {
    const left = await change(sql, user.id, -final, "purchase", prod.name, prod.key);
    if (left === null) throw new HttpError(409, `You need ${usd(final)} of credits but have ${usd(await balance(sql, user.id))}. Top up, or pay with a card.`);
    try {
      const result = await deliver(env, sql, player, prod, { id: user.id, username: user.username }, "credits");
      await sql`UPDATE shop_orders SET price_cents = ${final} WHERE id = (SELECT max(id) FROM shop_orders WHERE xuid = ${player.xuid} AND item = ${prod.isPlan ? "plan:" + prod.key : prod.key})`;
      if (promo) await sql`INSERT INTO promo_redemptions (promo_id, user_id, item, option, price_cents, final_cents, status)
                           VALUES (${promo.id}, ${user.id}, ${prod.key}, ${prod.option}, ${prod.price}, ${final}, 'used')`;
      await gifted(true, null);
      return json({ ok: true, done: true, credits: left / 100, message: giftNote(doneMessage(prod, result.sent)) });
    } catch (e) {
      await change(sql, user.id, final, "refund", `${prod.name} (couldn't be given)`, prod.key); // give the credit back
      throw e;
    }
  }

  // card
  if (!stripeReady(env)) return json({ ok: false, comingSoon: true, message: "Card payments open very soon. Check back shortly!" });
  const amount = Math.max(MIN_CHARGE, final);
  const [pay] = await sql`INSERT INTO payments (user_id, kind, item, option, promo_id, amount_cents, gift_to)
                          VALUES (${user.id}, 'item', ${prod.key}, ${prod.option}, ${promo?.id || null}, ${amount}, ${giftTo?.id || null}) RETURNING id`;
  if (promo) await sql`INSERT INTO promo_redemptions (promo_id, user_id, item, option, price_cents, final_cents, status, payment_id)
                       VALUES (${promo.id}, ${user.id}, ${prod.key}, ${prod.option}, ${prod.price}, ${amount}, 'pending', ${pay.id})`;
  const origin = new URL(request.url).origin;
  const session = await createCheckout(env, {
    paymentId: pay.id, userId: user.id, name: `GalaxySMP: ${prod.name}`,
    description: `${giftTo ? "A gift for" : "For"} ${player.gamertag} on GalaxySMP${promo ? ` (promo ${promo.code})` : ""}`,
    amountCents: amount, origin, successPath: "/store?paid=item", cancelPath: "/store#shop",
  });
  await sql`UPDATE payments SET stripe_session = ${session.id} WHERE id = ${pay.id}`;
  return json({ ok: true, url: session.url });
}

// POST /api/store/topup { pack }
export async function topup(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const pack = PACK[String(body.pack || "")];
  if (!pack) throw new HttpError(404, "Choose a credit pack.");
  if (!stripeReady(env)) return json({ ok: false, comingSoon: true, message: "Card payments open very soon. Check back shortly!" });
  const sql = getDb(env);
  const [pay] = await sql`INSERT INTO payments (user_id, kind, item, amount_cents, credit_cents)
                          VALUES (${user.id}, 'topup', ${pack.id}, ${pack.price}, ${pack.credit}) RETURNING id`;
  const origin = new URL(request.url).origin;
  const bonus = pack.credit - pack.price;
  const session = await createCheckout(env, {
    paymentId: pay.id, userId: user.id, name: `GalaxySMP Credits: ${usd(pack.credit)}`,
    description: `${usd(pack.price)} of Galaxy Credits${bonus ? ` + ${usd(bonus)} bonus` : ""} for ${user.username}. Spend them in the GalaxySMP Store.`,
    amountCents: pack.price, origin, successPath: "/store?paid=credits", cancelPath: "/store#credits",
  });
  await sql`UPDATE payments SET stripe_session = ${session.id} WHERE id = ${pay.id}`;
  return json({ ok: true, url: session.url });
}

// POST /api/store/gift { to: username, amount: dollars }
export async function gift(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  if (user.muted_until && new Date(user.muted_until) > new Date()) throw new HttpError(403, "You're muted, so you can't send gifts right now.");
  const cents = Math.round(Number(body.amount) * 100);
  if (!Number.isFinite(cents) || cents < GIFT_MIN) throw new HttpError(400, `Gifts start at ${usd(GIFT_MIN)}.`);
  const name = String(body.to || "").trim().toLowerCase().slice(0, 32);
  const toId = Number(body.toId) || 0;
  const [to] = toId ? await sql`SELECT id, username, banned FROM users WHERE id = ${toId}`
    : name ? await sql`SELECT id, username, banned FROM users WHERE username_lower = ${name}` : [];
  if (!to || to.banned) throw new HttpError(404, "There's no member with that name.");
  if (Number(to.id) === Number(user.id)) throw new HttpError(400, "You can't gift credits to yourself.");
  if (ownerOf(env, user)) {
    if (cents > 100_000_00) throw new HttpError(400, "That's a lot! Gifts go up to $100,000 at a time.");
    await change(sql, to.id, cents, "staff", `Gift from ${user.username}`, String(user.id));
    await audit(sql, user.id, "credits.give", { to: to.username, cents });
    await recordGift(env, sql, { giverId: user.id, receiverId: to.id, kind: "credits", cents, paid: false });
    try {
      await pushNotify(env, [to.id], "dms", { title: `${user.username} sent you ${usd(cents)} of credits!`, body: "Spend them in the GalaxySMP Store.", url: "/store", tag: `gift-${user.id}` });
    } catch { /* best effort */ }
    return json({ ok: true, message: `Sent ${usd(cents)} of credits to ${to.username}.` });
  }
  const [{ sent }] = await sql`SELECT coalesce(-sum(delta_cents), 0)::bigint AS sent FROM credit_ledger
                                WHERE user_id = ${user.id} AND reason = 'gift_out' AND created_at > now() - interval '1 day'`;
  if (Number(sent) + cents > GIFT_DAILY_MAX) throw new HttpError(429, `You can gift up to ${usd(GIFT_DAILY_MAX)} a day. You have ${usd(Math.max(0, GIFT_DAILY_MAX - Number(sent)))} left today.`);
  const left = await change(sql, user.id, -cents, "gift_out", `To ${to.username}`, String(to.id));
  if (left === null) throw new HttpError(409, `You only have ${usd(await balance(sql, user.id))} of credits.`);
  await change(sql, to.id, cents, "gift_in", `From ${user.username}`, String(user.id));
  await audit(sql, user.id, "credits.gift", { to: to.username, cents });
  await recordGift(env, sql, { giverId: user.id, receiverId: to.id, kind: "credits", cents, paid: true });
  try {
    await pushNotify(env, [to.id], "dms", { title: `${user.username} sent you ${usd(cents)} of credits!`, body: "Spend them in the GalaxySMP Store.", url: "/store", tag: `gift-${user.id}` });
  } catch { /* best effort */ }
  return json({ ok: true, credits: left / 100, message: `Sent ${usd(cents)} of credits to ${to.username}.` });
}

// ---------- Stripe webhook ----------
async function fulfil(env, sql, payId) {
  const [pay] = await sql`UPDATE payments SET status = 'paid', paid_at = now() WHERE id = ${payId} AND status = 'pending' RETURNING *`;
  if (!pay) return; // already done (Stripe can send an event twice)
  if (pay.kind === "topup") {
    await change(sql, pay.user_id, pay.credit_cents, "topup", `${usd(pay.amount_cents)} top-up${pay.credit_cents > pay.amount_cents ? ` + ${usd(pay.credit_cents - pay.amount_cents)} bonus` : ""}`, String(pay.id));
    return;
  }
  const prod = product(pay.item, pay.option);
  const player = await linkedPlayer(sql, pay.gift_to || pay.user_id);  // a gift goes to the other member
  const [u] = await sql`SELECT username FROM users WHERE id = ${pay.user_id}`;
  try {
    if (!prod || !player) throw new Error("no player");
    await deliver(env, sql, player, prod, { id: pay.user_id, username: u?.username || "card" }, "payment");
    if (pay.gift_to) {
      await recordGift(env, sql, { giverId: pay.user_id, receiverId: pay.gift_to, kind: prod.isPlan ? "plan" : "item", item: prod.key, cents: pay.amount_cents, paid: true, ref: `payment:${pay.id}` });
      await pushNotify(env, [pay.gift_to], "dms", { title: `${u?.username || "Someone"} sent you a gift!`, body: `${prod.name} is yours. It's ready in game.`, url: "/store", tag: `gift-item-${pay.user_id}` }).catch(() => {});
    }
    await sql`UPDATE shop_orders SET price_cents = ${pay.amount_cents} WHERE id = (SELECT max(id) FROM shop_orders WHERE xuid = ${player.xuid} AND item = ${prod.isPlan ? "plan:" + prod.key : prod.key})`;
  } catch (e) {
    // couldn't give it (e.g. they got it another way meanwhile): turn the payment into credit instead
    await change(sql, pay.user_id, pay.amount_cents, "refund", `${prod?.name || pay.item} couldn't be given, so you got credit instead`, String(pay.id));
    console.error("payment delivery failed", pay.id, e.message);
  }
  await sql`UPDATE promo_redemptions SET status = 'used' WHERE payment_id = ${pay.id}`;
}

async function refunded(env, sql, intentId) {
  const [pay] = await sql`UPDATE payments SET status = 'refunded' WHERE payment_intent = ${intentId} AND status = 'paid' RETURNING *`;
  if (!pay) return;
  if (pay.kind === "topup") {
    await change(sql, pay.user_id, -pay.credit_cents, "refund", `${usd(pay.amount_cents)} top-up refunded`, String(pay.id), { allowNegative: true });
  } else {
    const player = await linkedPlayer(sql, pay.user_id);
    const item = SHOP_ITEMS[pay.item];
    if (player && PLANS[pay.item] && pay.item !== "free") {
      await sql`UPDATE subscriptions SET expires_at = greatest(now(), expires_at - make_interval(days => ${PLAN_DAYS})) WHERE xuid = ${player.xuid} AND plan = ${pay.item}`;
      await sendPlans(env, sql).catch(() => {});
    }
    if (player && item?.category === "cosmetics") {
      await sql`UPDATE players SET cosmetics = array_remove(cosmetics, ${item.id}) WHERE xuid = ${player.xuid}`;
      await sql`DELETE FROM shop_orders WHERE id = (SELECT max(id) FROM shop_orders WHERE xuid = ${player.xuid} AND item = ${item.id} AND source = 'payment')`;
      await sendPlans(env, sql).catch(() => {});
    }
  }
  await audit(sql, null, "payment.refunded", { payment: Number(pay.id), kind: pay.kind, item: pay.item, cents: pay.amount_cents });
}

export async function stripeWebhook(request, env) {
  const raw = await request.text();
  const event = await verifyWebhook(env, raw, request.headers.get("Stripe-Signature"));
  if (!event) return new Response("bad signature", { status: 400 });
  const sql = getDb(env);
  const obj = event.data?.object || {};
  const payId = Number(obj.metadata?.payment_id);
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (payId && obj.payment_intent) await sql`UPDATE payments SET payment_intent = ${obj.payment_intent} WHERE id = ${payId}`;
    if (payId && obj.payment_status === "paid") await fulfil(env, sql, payId);
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    if (payId) {
      await sql`UPDATE payments SET status = 'failed' WHERE id = ${payId} AND status = 'pending'`;
      await sql`UPDATE promo_redemptions SET status = 'cancelled' WHERE payment_id = ${payId} AND status = 'pending'`;
    }
  } else if (event.type === "charge.refunded" && obj.payment_intent && obj.refunded) {
    await refunded(env, sql, obj.payment_intent);
  }
  return json({ received: true });
}

// For the owner: is Stripe connected? (used by the Control Panel)
export async function stripeStatus(env) {
  if (!stripeReady(env)) return { connected: false };
  try {
    const acct = await stripe(env, "GET", "/account");
    return { connected: true, live: !String(env.STRIPE_SECRET_KEY).startsWith("sk_test_"), name: acct.settings?.dashboard?.display_name || acct.business_profile?.name || null };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

// GET /api/panel/payments (owner): is Stripe connected, money made, recent payments and credit totals.
export async function paymentsOverview(request, env) {
  const user = await requireUser(request, env);
  const { isOwner } = await import("../lib/names.js");
  if (!isOwner(env, user.username, user.platform === "bedrock")) throw new HttpError(403, "Only the owner can see payments.");
  const sql = getDb(env);
  const [[totals], recent, [credits]] = await Promise.all([
    sql`SELECT coalesce(sum(amount_cents) FILTER (WHERE paid_at > now() - interval '1 day'), 0)::bigint AS day,
               coalesce(sum(amount_cents) FILTER (WHERE paid_at > now() - interval '7 days'), 0)::bigint AS week,
               coalesce(sum(amount_cents) FILTER (WHERE paid_at > now() - interval '30 days'), 0)::bigint AS month,
               coalesce(sum(amount_cents), 0)::bigint AS total,
               count(*)::int AS count
          FROM payments WHERE status = 'paid'`,
    sql`SELECT p.id, p.kind, p.item, p.option, p.amount_cents, p.credit_cents, p.status, p.created_at, p.paid_at, u.username
          FROM payments p LEFT JOIN users u ON u.id = p.user_id
         WHERE p.status <> 'pending' OR p.created_at > now() - interval '1 hour'
         ORDER BY p.id DESC LIMIT 30`,
    sql`SELECT coalesce(sum(credit_cents), 0)::bigint AS held,
               (SELECT coalesce(-sum(delta_cents), 0)::bigint FROM credit_ledger WHERE reason = 'purchase') AS spent,
               (SELECT coalesce(sum(delta_cents), 0)::bigint FROM credit_ledger WHERE reason = 'staff') AS given
          FROM users`,
  ]);
  const name = (r) => (r.kind === "topup" ? `${usd(r.credit_cents)} credits` : (SHOP_ITEMS[r.item]?.name || PLANS[r.item]?.name || r.item));
  return json({
    ok: true,
    stripe: await stripeStatus(env),
    totals: { day: Number(totals.day) / 100, week: Number(totals.week) / 100, month: Number(totals.month) / 100, total: Number(totals.total) / 100, count: totals.count },
    credits: { held: Number(credits.held) / 100, spent: Number(credits.spent) / 100, given: Number(credits.given) / 100 },
    recent: recent.map((r) => ({ id: Number(r.id), who: r.username || "?", what: name(r), amount: r.amount_cents / 100, status: r.status, at: r.paid_at || r.created_at })),
  });
}

// POST /api/panel/credits { userId, action: "give" | "take", amount } (owner): free credits that aren't real money.
export async function ownerCredits(request, env) {
  const user = await requireUser(request, env);
  if (!ownerOf(env, user)) throw new HttpError(403, "Only the owner can give credits.");
  const body = await readJson(request);
  const sql = getDb(env);
  const [to] = await sql`SELECT id, username FROM users WHERE id = ${Number(body.userId) || 0}`;
  if (!to) throw new HttpError(404, "That member doesn't exist.");
  let cents = Math.round(Number(body.amount) * 100);
  if (!Number.isFinite(cents) || cents < 1 || cents > 100_000_00) throw new HttpError(400, "Type an amount from $0.01 to $100,000.");
  if (body.action === "take") {
    cents = Math.min(cents, await balance(sql, to.id));
    if (!cents) throw new HttpError(409, `${to.username} has no credits to take.`);
    await change(sql, to.id, -cents, "staff", `Taken by ${user.username}`, String(user.id));
  } else {
    await change(sql, to.id, cents, "staff", `Gift from ${user.username}`, String(user.id));
    await recordGift(env, sql, { giverId: user.id, receiverId: to.id, kind: "credits", cents, paid: false });  // the owner's free gifts count
    try {
      await pushNotify(env, [to.id], "dms", { title: `${user.username} sent you ${usd(cents)} of credits!`, body: "Spend them in the GalaxySMP Store.", url: "/store", tag: `gift-${user.id}` });
    } catch { /* best effort */ }
  }
  await audit(sql, user.id, body.action === "take" ? "credits.take" : "credits.give", { to: to.username, cents });
  return json({ ok: true, credits: (await balance(sql, to.id)) / 100, message: body.action === "take" ? `Took ${usd(cents)} of credits from ${to.username}.` : `Gave ${to.username} ${usd(cents)} of credits.` });
}

// GET /api/store/members?q=ab : members whose name starts with what was typed (for picking who to gift)
export async function findMembers(request, env, ctx, url) {
  const user = await requireUser(request, env);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 32);
  if (q.length < 2) return json({ ok: true, members: [] });
  const sql = getDb(env);
  const skip = url.searchParams.get("self") === "1" ? 0 : user.id; // gifts leave yourself out; badges don't
  const rows = await sql`
    SELECT u.id, u.username, p.xuid, p.head_at, p.gamerpic_at FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
     WHERE NOT u.banned AND u.id <> ${skip} AND u.username_lower LIKE ${q.replace(/[%_\\]/g, "\\$&") + "%"}
     ORDER BY length(u.username), u.username_lower LIMIT 8`;
  return json({ ok: true, members: rows.map((r) => ({ id: Number(r.id), username: r.username, head: headUrlFor(r) })) });
}
