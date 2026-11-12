// Player trades (galaxymc.us/trades). The seller must be online in game: the plugin takes the item from
// their inventory and holds it. The buyer accepts (pays) or declines here or with /trade in game.
// Open offers expire after 24 hours and the item goes back. The plugin does the item and money moves;
// this keeps the list and sends the notifications.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { voiceStub } from "./voice.js";
import { notify } from "./notify.js";

const MAX_OPEN = 5;
const MAX_PRICE_CENTS = 100_000_000_000; // $1B

async function ask(env, msg) {
  return voiceStub(env).fetch("https://voice/internal/ask", { method: "POST", body: JSON.stringify({ type: "trade", ...msg }) }).then((r) => r.json());
}

async function me(request, env, sql) {
  const user = await requireUser(request, env);
  const [p] = await sql`SELECT p.xuid, p.gamertag FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  if (!p) throw new HttpError(400, "Link your Minecraft account first (Account > Link), so we know which player you are.");
  return { user, xuid: p.xuid, name: p.gamertag };
}

const out = (t, myXuid) => ({
  id: Number(t.id), label: t.label, amount: t.amount, enchants: t.enchants || [], price: Number(t.price_cents), note: t.note || "",
  status: t.status, createdAt: t.created_at, decidedAt: t.decided_at, expiresAt: new Date(new Date(t.created_at).getTime() + 864e5).toISOString(),
  seller: t.seller_name, buyer: t.buyer_name, incoming: t.buyer_xuid === myXuid,
});

// GET /api/trades
export async function listTrades(request, env) {
  const sql = getDb(env);
  const who = await me(request, env, sql);
  const rows = await sql`
    SELECT t.*, sp.gamertag AS seller_name, bp.gamertag AS buyer_name FROM trades t
      JOIN players sp ON sp.xuid = t.seller_xuid JOIN players bp ON bp.xuid = t.buyer_xuid
     WHERE (t.seller_xuid = ${who.xuid} OR t.buyer_xuid = ${who.xuid}) AND t.status <> 'creating'
     ORDER BY (t.status = 'pending') DESC, t.id DESC LIMIT 60`;
  return json({ ok: true, me: who.name, trades: rows.map((t) => out(t, who.xuid)) });
}

// GET /api/trades/inventory: the seller's inventory, live from the server
export async function inventory(request, env) {
  const sql = getDb(env);
  const who = await me(request, env, sql);
  await rateLimit(env, "POLL_LIMITER", `tinv:${who.user.id}`);
  const a = await ask(env, { op: "inventory", xuid: who.xuid });
  if (!a.ok) throw new HttpError(409, a.message || "You need to be online in Minecraft to offer an item.");
  return json({ ok: true, items: a.items || [] });
}

// POST /api/trades { buyer, slot, expectId, expectAmount, price (cents), note }
export async function createTrade(request, env) {
  const sql = getDb(env);
  const who = await me(request, env, sql);
  if (who.user.banned) throw new HttpError(403, "Your account has been banned.");
  await rateLimit(env, "AUTH_LIMITER", `trade:${who.user.id}`);
  const body = await readJson(request);
  const price = Math.round(Number(body.price));
  if (!Number.isFinite(price) || price < 100 || price > MAX_PRICE_CENTS) throw new HttpError(400, "Choose a price from $1 to $1B.");
  const note = String(body.note || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const [buyer] = await sql`SELECT xuid, gamertag FROM players WHERE lower(gamertag) = lower(${String(body.buyer || "").replace(/^\./, "").trim()})`;
  if (!buyer) throw new HttpError(404, "There's no player with that name. They need to have joined the server.");
  if (buyer.xuid === who.xuid) throw new HttpError(400, "You can't trade with yourself.");
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM trades WHERE seller_xuid = ${who.xuid} AND status = 'pending'`;
  if (n >= MAX_OPEN) throw new HttpError(429, `You can have up to ${MAX_OPEN} open offers. Cancel one or wait for an answer.`);
  const [t] = await sql`INSERT INTO trades (seller_xuid, buyer_xuid, label, amount, item_id, price_cents, note, status)
                        VALUES (${who.xuid}, ${buyer.xuid}, '', ${Number(body.expectAmount) || 1}, ${String(body.expectId || "")}, ${price}, ${note}, 'creating') RETURNING id`;
  const a = await ask(env, { op: "create", id: Number(t.id), seller: who.xuid, slot: Number(body.slot), expectId: String(body.expectId || ""),
    expectAmount: Number(body.expectAmount), buyer: buyer.xuid, buyerName: buyer.gamertag, price });
  if (!a.ok) {
    await sql`DELETE FROM trades WHERE id = ${t.id}`;
    throw new HttpError(409, a.message || "The trade couldn't be made.");
  }
  await sql`UPDATE trades SET status = 'pending', label = ${String(a.label || "item").slice(0, 80)}, enchants = ${Array.isArray(body.enchants) ? body.enchants.map((e) => String(e).slice(0, 40)).slice(0, 10) : []} WHERE id = ${t.id}`;
  const buyerUser = await sql`SELECT u.id FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE p.xuid = ${buyer.xuid}`;
  if (buyerUser.length) {
    await notify(env, [buyerUser[0].id], "trades", { title: `${who.name} offers you a trade`, body: `${body.expectAmount}x ${a.label} for $${(price / 100).toLocaleString("en-US")}`, url: "/trades", tag: `trade-${t.id}` });
  }
  return json({ ok: true, id: Number(t.id) });
}

const RESULT_STATUS = { accepted: "accepted", declined: "declined", cancelled: "cancelled", expired: "expired" };

async function closeTrade(env, sql, t, status, byName) {
  await sql`UPDATE trades SET status = ${status}, decided_at = now() WHERE id = ${t.id} AND status = 'pending'`;
  // tell the other person
  const otherXuid = status === "cancelled" || status === "expired" ? t.buyer_xuid : t.seller_xuid;
  const [u] = await sql`SELECT u.id FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE p.xuid = ${otherXuid}`;
  if (!u) return;
  const what = `${t.amount}x ${t.label}`;
  const msg = {
    accepted: [`${byName} accepted your trade`, `You got $${(Number(t.price_cents) / 100).toLocaleString("en-US")} for ${what}.`],
    declined: [`${byName} declined your trade`, `${what} is back in your inventory.`],
    cancelled: ["A trade offer was cancelled", `${byName} cancelled the offer of ${what}.`],
    expired: ["A trade offer expired", `The offer of ${what} wasn't answered in 24 hours.`],
  }[status];
  if (msg && status !== "expired") await notify(env, [u.id], "trades", { title: msg[0], body: msg[1], url: "/trades", tag: `trade-${t.id}` });
}

// POST /api/trades/:id/:action  (accept / decline: the buyer; cancel: the seller)
export async function tradeAction(request, env, ctx, url, params) {
  const sql = getDb(env);
  const who = await me(request, env, sql);
  const [t] = await sql`SELECT * FROM trades WHERE id = ${Number(params.id) || 0}`;
  if (!t || t.status !== "pending") throw new HttpError(409, "This trade is no longer open.");
  const action = String(params.action);
  if ((action === "accept" || action === "decline") && t.buyer_xuid !== who.xuid) throw new HttpError(403, "This trade isn't for you.");
  if (action === "cancel" && t.seller_xuid !== who.xuid) throw new HttpError(403, "Only the person who offered it can cancel it.");
  if (!["accept", "decline", "cancel"].includes(action)) throw new HttpError(400, "Unknown action.");
  const a = await ask(env, { op: action, id: Number(t.id), by: who.xuid });
  if (!a.ok) throw new HttpError(409, a.message || "That didn't work.");
  await closeTrade(env, sql, t, { accept: "accepted", decline: "declined", cancel: "cancelled" }[action], who.name);
  return json({ ok: true, message: a.message });
}

// From the plugin: a trade was accepted, declined or cancelled in game (/trade).
export async function tradeFromGame(env, msg) {
  const status = RESULT_STATUS[msg.result];
  if (!status) return;
  const sql = getDb(env);
  const [t] = await sql`SELECT t.*, sp.gamertag AS seller_name, bp.gamertag AS buyer_name FROM trades t
                         JOIN players sp ON sp.xuid = t.seller_xuid JOIN players bp ON bp.xuid = t.buyer_xuid WHERE t.id = ${Number(msg.id) || 0}`;
  if (!t || t.status !== "pending") return;
  await closeTrade(env, sql, t, status, status === "cancelled" ? t.seller_name : t.buyer_name);
}

// Every 5 minutes: offers older than 24 hours expire (the item goes back to the seller).
export async function expireTrades(env, sql) {
  const old = await sql`SELECT * FROM trades WHERE status = 'pending' AND created_at < now() - interval '24 hours' LIMIT 20`;
  for (const t of old) {
    const a = await ask(env, { op: "expire", id: Number(t.id) });
    if (a.ok || /no longer open/i.test(a.message || "")) await closeTrade(env, sql, t, "expired", "");
  }
  await sql`DELETE FROM trades WHERE status = 'creating' AND created_at < now() - interval '1 hour'`;
}
