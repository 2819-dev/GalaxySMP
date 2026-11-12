// galaxymc.us/shops: buy from players' shop chests on the website.
// The server sends every Sell shop chest; only shops whose owner has Galaxy+ or Galaxy Pro+ are listed here.
// The plugin does the buying (stock, money, items); the buyer pays from their in-game balance and gets the
// items in their inventory (the next time they join, if they're offline).
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { voiceStub } from "./voice.js";

const PLAN_NAMES = { plus: "Galaxy+", pro: "Galaxy Pro+" };

async function listed(env, sql) {
  const data = await voiceStub(env).fetch("https://voice/internal/shopchests").then((r) => r.json()).catch(() => ({ shops: [] }));
  const shops = data.shops || [];
  const owners = [...new Set(shops.map((s) => s.owner))];
  const plans = owners.length ? await sql`
    SELECT xuid, plan FROM subscriptions
     WHERE xuid = ANY(${owners}::text[]) AND plan IN ('plus', 'pro') AND (expires_at IS NULL OR expires_at > now())` : [];
  const planOf = new Map(plans.map((p) => [p.xuid, p.plan]));
  return { at: data.at, shops: shops.filter((s) => planOf.has(s.owner)).map((s) => ({ ...s, plan: planOf.get(s.owner) })) };
}

// GET /api/shops
export async function listShops(request, env) {
  const sql = getDb(env);
  const user = await requireUser(request, env);  // shop owners and locations: members only
  const { at, shops } = await listed(env, sql);
  let me = null;
  if (user) {
    const [p] = await sql`SELECT p.xuid, p.gamertag, p.balance_cents FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
    me = p ? { xuid: p.xuid, name: p.gamertag, balance: Number(p.balance_cents || 0) } : { xuid: null };
  }
  return json({
    ok: true, updated: at, me: me && { name: me.name || null, balance: me.balance ?? null, linked: Boolean(me.xuid) },
    shops: shops
      .sort((a, b) => (b.stock >= b.amount) - (a.stock >= a.amount) || a.name.localeCompare(b.name))
      .map((s) => ({
        id: s.id, owner: s.ownerName, mine: Boolean(me?.xuid && me.xuid === s.owner), plan: PLAN_NAMES[s.plan],
        item: s.item, name: s.name, amount: s.amount, price: s.price, stock: s.stock, shop: s.shop,
        where: { dim: s.dim, x: s.x, y: s.y, z: s.z },
      })),
  });
}

// POST /api/shops/:id/buy { times, price, amount }
export async function buyFromShop(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  await rateLimit(env, "POLL_LIMITER", `shopbuy:${user.id}`);
  const sql = getDb(env);
  const [p] = await sql`SELECT p.xuid, p.gamertag FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  if (!p) throw new HttpError(400, "Link your Minecraft account first (Account > Link), so we know which player you are.");
  const id = Number(params.id);
  const { shops } = await listed(env, sql);
  const shop = shops.find((s) => s.id === id);
  if (!shop) throw new HttpError(404, "This shop isn't listed any more.");
  const body = await readJson(request);
  const times = Math.max(1, Math.min(1000, Math.floor(Number(body.times) || 1)));
  const answer = await voiceStub(env).fetch("https://voice/internal/ask", {
    method: "POST",
    body: JSON.stringify({ type: "shopchest_buy", shop: id, xuid: p.xuid, name: p.gamertag, times, price: Number(body.price), amount: Number(body.amount) }),
  }).then((r) => r.json());
  if (!answer.ok) throw new HttpError(409, answer.message || "That couldn't be bought.");
  return json({ ok: true, message: answer.message });
}
