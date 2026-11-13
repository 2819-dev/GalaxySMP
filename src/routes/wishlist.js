// Store wishlist (like Discord's): tap the heart on a plan or Shop item to save it. Your wishlist shows on your
// profile, so friends can gift you something from it in one tap (players can hide it in Account settings).
// Bought or gifted items leave the wishlist by themselves. Promo codes made with "Tell wishlists" send a
// notification to members who wished for something the code works on.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { SHOP_ITEMS } from "../store/shop.js";
import { PAID_PLANS, product, appliesTo, describe } from "../store/promos.js";
import PLANS from "../../endstone-plugin/src/endstone_galaxylink/plans.json";
import { notify } from "./notify.js";

export const MAX_ITEMS = 30;

export function isWishable(key) {
  return PAID_PLANS.includes(key) || Boolean(SHOP_ITEMS[key]);
}

// What a wishlist entry looks like on a profile.
export function describeItem(key) {
  if (PAID_PLANS.includes(key)) return { key, name: PLANS[key].name, icon: "star", price: Math.round(PLANS[key].price * 100), isPlan: true, category: "plan", per: "month" };
  const i = SHOP_ITEMS[key];
  if (!i) return null;
  const price = i.options ? Math.min(...i.options.map((o) => o.price)) : i.price;
  return { key, name: i.name, icon: i.icon || "cart", price, from: Boolean(i.options), isPlan: false, category: i.category, description: i.description || "" };
}

export async function wishlistFor(sql, userId) {
  const rows = await sql`SELECT item FROM wishlist WHERE user_id = ${userId} ORDER BY created_at DESC`;
  return rows.map((r) => describeItem(r.item)).filter(Boolean);
}

// POST /api/wishlist { item, on }
export async function toggle(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const key = String(body.item || "");
  if (!isWishable(key)) throw new HttpError(400, "That can't go on a wishlist.");
  const sql = getDb(env);
  if (body.on === false) {
    await sql`DELETE FROM wishlist WHERE user_id = ${user.id} AND item = ${key}`;
  } else {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM wishlist WHERE user_id = ${user.id}`;
    if (n >= MAX_ITEMS) throw new HttpError(409, `Your wishlist is full (${MAX_ITEMS} things). Remove something first.`);
    await sql`INSERT INTO wishlist (user_id, item) VALUES (${user.id}, ${key}) ON CONFLICT DO NOTHING`;
  }
  const items = (await sql`SELECT item FROM wishlist WHERE user_id = ${user.id}`).map((r) => r.item);
  return json({ ok: true, wishlist: items, message: body.on === false ? "Removed from your wishlist." : "Added to your wishlist. It shows on your profile so friends can gift it." });
}

// POST /api/account/wishlist { hidden }
export async function privacy(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  await getDb(env)`UPDATE users SET wishlist_hidden = ${Boolean(body.hidden)} WHERE id = ${user.id}`;
  return json({ ok: true, hidden: Boolean(body.hidden) });
}

// A Store item reached this player (bought or gifted): it leaves their wishlist.
export async function gotItem(sql, xuid, key) {
  await sql`DELETE FROM wishlist w USING users u, players p
             WHERE w.user_id = u.id AND p.uuid = u.mc_uuid AND p.xuid = ${String(xuid)} AND w.item = ${String(key)}`;
}

// Every 5 minutes: promo codes marked "Tell wishlists" notify members who wished for something they work on.
export async function wishlistSales(env, sql = getDb(env)) {
  const promos = await sql`SELECT * FROM promo_codes WHERE active AND wishlist_alert AND (expires_at IS NULL OR expires_at > now())
                             AND created_at > now() - interval '30 days' ORDER BY id DESC LIMIT 10`;
  for (const p of promos) {
    const rows = await sql`SELECT w.user_id, w.item FROM wishlist w
                            WHERE NOT EXISTS (SELECT 1 FROM wishlist_alerts a WHERE a.promo_id = ${p.id} AND a.user_id = w.user_id)
                              AND (${p.members === null} OR w.user_id = ANY(${p.members || []}::bigint[]))
                            LIMIT 2000`;
    const byUser = new Map();
    for (const r of rows) {
      const prod = product(r.item, SHOP_ITEMS[r.item]?.options?.[0]?.id);
      if (!prod || (p.kind === "first_month" && !prod.isPlan) || !appliesTo(p, prod)) continue;
      const uid = Number(r.user_id);
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid).push(prod.name.replace(/ \(.*\)$/, ""));
    }
    if (!byUser.size) continue;
    const ids = [...byUser.keys()];
    await sql`INSERT INTO wishlist_alerts (promo_id, user_id) SELECT ${p.id}, unnest(${ids}::bigint[]) ON CONFLICT DO NOTHING`;
    const deal = describe(p);
    for (const [uid, names] of byUser) {
      const what = names.length === 1 ? names[0] : `${names[0]} and ${names.length - 1} more`;
      await notify(env, [uid], "wishlist", { title: `On your wishlist: ${what} is on sale!`, body: `${deal} with code ${p.code}${p.expires_at ? `, until ${new Date(p.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}.`, url: "/store", tag: `wish-sale-${p.id}` }).catch(() => {});
    }
  }
}
