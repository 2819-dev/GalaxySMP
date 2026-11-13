// Promo codes for the Store. Made by Admins in the Control Panel > Promo codes.
//   kind: percent (value = % off), amount (value = cents off), free (100% off),
//         first_month (subscriptions: the first month is free, later months full price)
//   targets: what it works on: "subs" (every plan), "plan:plus", "shop" (every Shop item),
//            "cat:cosmetics", "item:trail_hearts". Empty = everything.
//   members: only these website accounts can use it (they get a "you have a promo code" pop-up when buying).
//            NULL = anyone who knows the code.
import { can } from "../lib/perms.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { isOwner } from "../lib/names.js";
import { GAME_SHOP as SHOP, SHOP_ITEMS } from "./shop.js";
import PLANS from "../../endstone-plugin/src/endstone_galaxylink/plans.json";

const ADMIN = 100;
const KINDS = ["percent", "amount", "free", "first_month"];
export const MIN_CHARGE = 50; // card payments under $0.50 aren't possible: such prices round up (or become free at 0)
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

// ---------- What's for sale ----------
export const PAID_PLANS = ["plus", "pro"];

// Everything a promo can point at, for the Control Panel's checkboxes.
export function promoTargets() {
  return [
    { id: "subs", name: "All subscriptions", group: "Subscriptions" },
    ...PAID_PLANS.map((p) => ({ id: `plan:${p}`, name: PLANS[p].name, group: "Subscriptions" })),
    { id: "shop", name: "Everything in the Shop", group: "Shop" },
    ...SHOP.map((c) => ({ id: `cat:${c.id}`, name: `All ${c.name.replace(/^Exclusive /, "").toLowerCase()}`, group: "Shop" })),
    ...SHOP.flatMap((c) => c.items.map((i) => ({ id: `item:${i.id}`, name: i.name, group: c.name }))),
  ];
}

// The thing being bought: { key, name, isPlan, price (cents), tags (what promo targets match it) }
export function product(itemId, optionId) {
  const id = String(itemId || "");
  if (PAID_PLANS.includes(id)) {
    return { key: id, name: PLANS[id].name, isPlan: true, option: null, price: Math.round(PLANS[id].price * 100), tags: ["subs", `plan:${id}`] };
  }
  const item = SHOP_ITEMS[id];
  if (!item) return null;
  const option = item.options ? item.options.find((o) => o.id === optionId) || null : null;
  if (item.options && !option) return null;
  return {
    key: id, name: option ? `${item.name} (${option.name})` : item.name, isPlan: false, option: option?.id || null,
    category: item.category, price: option ? option.price : item.price, tags: ["shop", `cat:${item.category}`, `item:${id}`],
  };
}

export const appliesTo = (promo, prod) => !promo.targets?.length || promo.targets.some((t) => prod.tags.includes(t));

// Price after the promo (cents). For first_month, the first payment.
export function discounted(promo, price) {
  let final = price;
  if (promo.kind === "percent") final = Math.round(price * (100 - promo.value) / 100);
  else if (promo.kind === "amount") final = price - promo.value;
  else if (promo.kind === "free" || promo.kind === "first_month") final = 0;
  final = Math.max(0, final);
  if (final > 0 && final < MIN_CHARGE) final = MIN_CHARGE;
  return Math.min(price, final);
}

export function describe(p) {
  const what = p.kind === "percent" ? `${p.value}% off` : p.kind === "amount" ? `$${(p.value / 100).toFixed(2)} off`
    : p.kind === "free" ? "Free" : "First month free";
  return what;
}

function targetText(targets) {
  if (!targets?.length) return "Everything";
  const all = Object.fromEntries(promoTargets().map((t) => [t.id, t.name]));
  return targets.map((t) => all[t] || t).join(", ");
}

const usable = (p) => p.active && (!p.expires_at || new Date(p.expires_at) > new Date());

async function usage(sql, promoId, userId) {
  const [r] = await sql`
    SELECT count(*) FILTER (WHERE status = 'used' OR (status = 'pending' AND created_at > now() - interval '2 hours'))::int AS total,
           count(*) FILTER (WHERE user_id = ${userId} AND (status = 'used' OR (status = 'pending' AND created_at > now() - interval '2 hours')))::int AS mine
      FROM promo_redemptions WHERE promo_id = ${promoId}`;
  return r;
}

// Checks a code for this user and product. Returns { promo, final } or throws a friendly message.
export async function checkPromo(sql, user, code, prod) {
  const c = clean(code, 32).toUpperCase().replace(/\s+/g, "");
  if (!c) throw new HttpError(400, "Type a promo code.");
  const [p] = await sql`SELECT * FROM promo_codes WHERE code = ${c}`;
  if (!p || (p.members && !p.members.map(Number).includes(Number(user.id)))) throw new HttpError(404, "That promo code doesn't exist.");
  if (!p.active) throw new HttpError(409, "That promo code has been turned off.");
  if (p.expires_at && new Date(p.expires_at) <= new Date()) throw new HttpError(409, "That promo code has expired.");
  if (!appliesTo(p, prod)) throw new HttpError(409, `That code doesn't work on ${prod.name}. It's for: ${targetText(p.targets)}.`);
  if (p.kind === "first_month" && !prod.isPlan) throw new HttpError(409, "That code is only for subscriptions.");
  const used = await usage(sql, p.id, user.id);
  if (p.max_uses != null && used.total >= p.max_uses) throw new HttpError(409, "That promo code has been used up.");
  if (p.per_player != null && used.mine >= p.per_player) throw new HttpError(409, p.per_player === 1 ? "You've already used that promo code." : `You've already used that code ${p.per_player} times.`);
  return { promo: p, final: discounted(p, prod.price) };
}

export function publicPromo(p, prod) {
  return {
    code: p.code, label: describe(p), kind: p.kind,
    expires: p.expires_at || null,
    final: prod ? discounted(p, prod.price) / 100 : undefined,
    later: prod?.isPlan && p.kind === "first_month" ? prod.price / 100 : undefined,
  };
}

// Promos made just for this member that still work (for the Store's pop-up).
export async function memberPromos(sql, user) {
  const rows = await sql`SELECT * FROM promo_codes WHERE active AND members IS NOT NULL AND ${Number(user.id)} = ANY(members)
                           AND (expires_at IS NULL OR expires_at > now()) ORDER BY id DESC LIMIT 20`;
  const out = [];
  for (const p of rows) {
    const used = await usage(sql, p.id, user.id);
    if (p.max_uses != null && used.total >= p.max_uses) continue;
    if (p.per_player != null && used.mine >= p.per_player) continue;
    out.push({ ...publicPromo(p), targets: p.targets || [], value: p.value, kindRaw: p.kind });
  }
  return out;
}

// ---------- Store routes ----------
// POST /api/store/promo { code, item, option } -> the price with that code
export async function checkRoute(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const prod = product(body.item, body.option);
  if (!prod) throw new HttpError(404, "That item doesn't exist.");
  const { promo, final } = await checkPromo(getDb(env), user, body.code, prod);
  return json({ ok: true, promo: publicPromo(promo, prod), price: prod.price / 100, final: final / 100 });
}

// ---------- Control Panel routes (Admins) ----------
async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (!can(user, "promo_codes")) throw new HttpError(403, "Your rank can't manage promo codes.");
  user.owner = isOwner(env, user.username, user.platform === "bedrock");
  return user;
}

async function audit(sql, actorId, action, details) {
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${actorId}, ${action}, ${JSON.stringify(details)}::jsonb)`;
}

export async function listRoute(request, env) {
  await requireAdmin(request, env);
  const sql = getDb(env);
  const rows = await sql`
    SELECT p.*, u.username AS creator,
           (SELECT count(*)::int FROM promo_redemptions r WHERE r.promo_id = p.id AND r.status = 'used') AS uses,
           (SELECT coalesce(sum(price_cents - final_cents), 0)::int FROM promo_redemptions r WHERE r.promo_id = p.id AND r.status = 'used') AS saved,
           (SELECT json_agg(json_build_object('id', m.id, 'username', m.username)) FROM users m WHERE m.id = ANY(p.members)) AS member_list
      FROM promo_codes p LEFT JOIN users u ON u.id = p.created_by
     ORDER BY p.active DESC, p.id DESC LIMIT 200`;
  return json({
    ok: true,
    targets: promoTargets(),
    promos: rows.map((p) => ({
      id: Number(p.id), code: p.code, kind: p.kind, value: p.value, label: describe(p),
      targets: p.targets || [], targetText: targetText(p.targets),
      members: p.member_list || null, maxUses: p.max_uses, perPlayer: p.per_player,
      expires: p.expires_at, active: p.active, live: usable(p), note: p.note || "",
      uses: p.uses, saved: p.saved / 100, creator: p.creator || null, created: p.created_at,
    })),
  });
}

function randomCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I mix-ups
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "GALAXY-" + [...bytes].map((b) => abc[b % abc.length]).join("").slice(0, 6);
}

export async function createRoute(request, env) {
  const user = await requireAdmin(request, env);
  const body = await readJson(request, 32768);
  const sql = getDb(env);
  const kind = String(body.kind || "");
  if (!KINDS.includes(kind)) throw new HttpError(400, "Choose what the code gives.");
  let value = 0;
  if (kind === "percent") {
    value = Math.round(Number(body.value));
    if (!(value >= 1 && value <= 99)) throw new HttpError(400, "Percent off must be between 1 and 99 (use Free for 100%).");
  } else if (kind === "amount") {
    value = Math.round(Number(body.value) * 100);
    if (!(value >= 1 && value <= 100000)) throw new HttpError(400, "Type how many dollars off (like 1.50).");
  }
  const valid = new Set(promoTargets().map((t) => t.id));
  const targets = [...new Set((Array.isArray(body.targets) ? body.targets : []).map(String).filter((t) => valid.has(t)))];
  if (kind === "first_month" && targets.some((t) => !t.startsWith("plan:") && t !== "subs")) throw new HttpError(400, "First month free only works on subscriptions.");
  if (kind === "first_month" && !targets.length) targets.push("subs");
  let members = null;
  if (Array.isArray(body.members) && body.members.length) {
    const ids = [...new Set(body.members.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
    const found = await sql`SELECT id FROM users WHERE id = ANY(${ids})`;
    if (!found.length) throw new HttpError(400, "Pick at least one member (or leave members empty so anyone can use it).");
    members = found.map((r) => Number(r.id));
  }
  const intOrNull = (v, label) => {
    if (v === "" || v == null) return null;
    const n = Math.round(Number(v));
    if (!(n >= 1 && n <= 1000000)) throw new HttpError(400, `${label} must be a whole number of at least 1 (or empty for unlimited).`);
    return n;
  };
  const maxUses = intOrNull(body.maxUses, "Total uses");
  const perPlayer = intOrNull(body.perPlayer, "Uses per player");
  let expires = null;
  if (body.expires) {
    expires = new Date(body.expires);
    if (Number.isNaN(expires.getTime()) || expires <= new Date()) throw new HttpError(400, "The expiry date has to be in the future.");
  }
  let code = clean(body.code, 32).toUpperCase().replace(/\s+/g, "");
  if (code && !/^[A-Z0-9_-]{3,32}$/.test(code)) throw new HttpError(400, "Codes can use letters, numbers, - and _ (3 to 32 characters).");
  if (!code) code = randomCode();
  const note = clean(body.note, 120) || null;
  try {
    const [row] = await sql`
      INSERT INTO promo_codes (code, kind, value, targets, members, max_uses, per_player, expires_at, note, created_by, wishlist_alert)
      VALUES (${code}, ${kind}, ${value}, ${targets}, ${members}, ${maxUses}, ${perPlayer}, ${expires}, ${note}, ${user.id}, ${Boolean(body.wishlistAlert)})
      RETURNING id`;
    await audit(sql, user.id, "promo.create", { code, offer: describe({ kind, value }), members: members?.length || 0 });
    return json({ ok: true, id: Number(row.id), code });
  } catch (e) {
    if (String(e.message).includes("duplicate")) throw new HttpError(409, `There's already a code called ${code}.`);
    throw e;
  }
}

// POST /api/panel/promos/:id { action: "pause" | "resume" | "delete" }
export async function updateRoute(request, env, ctx, url, params) {
  const user = await requireAdmin(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const id = Number(params.id);
  const [p] = await sql`SELECT code FROM promo_codes WHERE id = ${id}`;
  if (!p) throw new HttpError(404, "That promo code doesn't exist.");
  if (body.action === "pause" || body.action === "resume") {
    await sql`UPDATE promo_codes SET active = ${body.action === "resume"} WHERE id = ${id}`;
  } else if (body.action === "delete") {
    await sql`DELETE FROM promo_codes WHERE id = ${id}`;
  } else throw new HttpError(400, "Unknown action.");
  await audit(sql, user.id, `promo.${body.action}`, { code: p.code });
  return json({ ok: true });
}
