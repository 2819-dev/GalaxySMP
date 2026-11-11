// Store checkout. What can be bought right now: the Shop's cosmetics (everything else says
// "Coming soon"). Card payments go through Stripe once its keys are added in Cloudflare
// (STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET). A promo code that makes something free works
// without Stripe: the item is given straight away.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser, getUser } from "../lib/auth.js";
import { product, checkPromo, memberPromos, publicPromo } from "../store/promos.js";
import { SHOP_ITEMS } from "../store/shop.js";
import { giveShopItem } from "./panel.js";

// Shop categories that can be bought now. The rest show "Coming soon".
export const ON_SALE = new Set(["cosmetics"]);

export const stripeReady = (env) => Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);

export function onSale(prod) {
  return Boolean(prod && !prod.isPlan && ON_SALE.has(prod.category));
}

async function linkedPlayer(sql, user) {
  const [p] = await sql`SELECT p.xuid, p.gamertag, p.cosmetics FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  return p || null;
}

// GET /api/store/mine: what the signed-in member already owns and their personal promo codes.
export async function mine(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ ok: true, signedIn: false });
  const sql = getDb(env);
  const p = await linkedPlayer(sql, user);
  const owned = {};
  let plan = "free";
  if (p) {
    const rows = await sql`SELECT item, count(*)::int AS n FROM shop_orders WHERE xuid = ${p.xuid} GROUP BY item`;
    for (const r of rows) owned[r.item] = r.n;
    for (const c of p.cosmetics || []) owned[c] = Math.max(owned[c] || 0, 1);
    const [s] = await sql`SELECT plan FROM subscriptions WHERE xuid = ${p.xuid} AND (expires_at IS NULL OR expires_at > now())`;
    if (s) plan = s.plan;
  }
  return json({ ok: true, signedIn: true, username: user.username, linked: Boolean(p), owned, plan, promos: await memberPromos(sql, user) });
}

// POST /api/store/checkout { item, option, code }
export async function checkout(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const prod = product(body.item ?? body.rankId, body.option);
  if (!prod) throw new HttpError(404, "That item doesn't exist.");
  if (!onSale(prod)) return json({ ok: false, comingSoon: true, message: `${prod.name} is coming soon.` });
  const sql = getDb(env);
  const p = await linkedPlayer(sql, user);
  if (!p) throw new HttpError(409, "Link your Minecraft account first (type /link in game), so we know who to give it to.");
  const item = SHOP_ITEMS[prod.key];
  if (item.limit) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM shop_orders WHERE xuid = ${p.xuid} AND item = ${item.id}`;
    const has = n + ((p.cosmetics || []).includes(item.id) && !n ? 1 : 0);
    if (has >= item.limit) throw new HttpError(409, item.limit === 1 ? `You already have ${item.name}.` : `You already have the most (${item.limit}) of ${item.name}.`);
  }
  let promo = null;
  let final = prod.price;
  if (body.code) ({ promo, final } = await checkPromo(sql, user, body.code, prod));

  if (final === 0) { // free with a promo code: give it now
    const result = await giveShopItem(env, sql, { xuid: p.xuid, gamertag: p.gamertag }, { item: prod.key, option: prod.option },
      { id: user.id, username: `promo ${promo.code}` }, "promo");
    await sql`INSERT INTO promo_redemptions (promo_id, user_id, item, option, price_cents, final_cents, status)
              VALUES (${promo.id}, ${user.id}, ${prod.key}, ${prod.option}, ${prod.price}, 0, 'used')`;
    return json({ ok: true, free: true, sent: result.sent, message: `${prod.name} is yours! ${result.sent ? "It's ready in game." : "You'll get it next time the server is online."}` });
  }
  if (!stripeReady(env)) return json({ ok: false, comingSoon: true, message: "Card payments open very soon. Check back shortly!" });
  // Card payment (Stripe Checkout) is added here once Stripe is set up.
  return json({ ok: false, comingSoon: true, message: "Card payments open very soon. Check back shortly!", promo: promo ? publicPromo(promo, prod) : null });
}
