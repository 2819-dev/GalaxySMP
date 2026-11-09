// Economy: the public money leaderboard, and the Admin panel for balances and shop prices.
// Balances live on the Minecraft server (GalaxyLink keeps them, so the economy works even if
// the website is down). The server sends them here for the leaderboard; changes made here are
// sent to the server over GalaxyLink's live connection.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { voiceStub } from "./voice.js";
import DEFAULT_SHOP from "../../endstone-plugin/src/endstone_galaxylink/shop_default.json";

const ADMIN = 100;
const MAX_CENTS = 10n ** 17n;
const ITEM_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]{1,64}$/;
const ICON = /^(textures\/[A-Za-z0-9_./-]{1,100})?$/;

async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (Number(user.role_power) < ADMIN) throw new HttpError(403, "Only Admins can manage the economy.");
  return user;
}

async function audit(sql, actorId, action, details) {
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${actorId}, ${action}, ${JSON.stringify(details)}::jsonb)`;
}

// Sends a message to the GalaxyLink plugin. Returns false if the server isn't connected.
async function toPlugin(env, message) {
  const res = await voiceStub(env).fetch("https://voice/internal/plugin", { method: "POST", body: JSON.stringify(message) });
  const data = await res.json().catch(() => ({}));
  return Boolean(data.sent);
}

export async function loadShop(sql) {
  const rows = await sql`SELECT value FROM economy_config WHERE key = 'shop'`;
  return rows[0]?.value || DEFAULT_SHOP;
}

// ---------- from the server ----------
export async function recordBalances(env, list) {
  const players = (Array.isArray(list) ? list : [])
    .filter((p) => p && /^\d{1,20}$/.test(String(p.xuid || "")) && Number.isFinite(Number(p.cents)))
    .slice(0, 2000);
  if (!players.length) return;
  const sql = getDb(env);
  for (let i = 0; i < players.length; i += 200) {
    const chunk = players.slice(i, i + 200);
    await sql.transaction(chunk.map((p) => sql`
      INSERT INTO players (xuid, gamertag, balance_cents, is_op, balance_at)
      VALUES (${String(p.xuid)}, ${String(p.name || "Player").slice(0, 32)}, ${Math.max(0, Math.round(Number(p.cents)))}, ${Boolean(p.op)}, now())
      ON CONFLICT (xuid) DO UPDATE SET balance_cents = EXCLUDED.balance_cents, is_op = EXCLUDED.is_op, balance_at = now(),
        gamertag = CASE WHEN ${Boolean(p.name)} THEN EXCLUDED.gamertag ELSE players.gamertag END`));
  }
}

// ---------- public leaderboard ----------
export async function leaderboard(request, env) {
  const sql = getDb(env);
  const rows = await sql`
    SELECT gamertag, balance_cents FROM players
     WHERE balance_cents IS NOT NULL AND NOT is_op
     ORDER BY balance_cents DESC, gamertag LIMIT 50`;
  const [stats] = await sql`
    SELECT count(*)::int AS players, coalesce(sum(balance_cents), 0)::text AS total, max(balance_at) AS updated
      FROM players WHERE balance_cents IS NOT NULL AND NOT is_op`;
  return json({
    ok: true,
    players: rows.map((r) => ({ name: r.gamertag, cents: Number(r.balance_cents) })),
    totalPlayers: stats.players,
    totalCents: Number(stats.total),
    updated: stats.updated,
  }, 200, { "Cache-Control": "public, max-age=30" });
}

// ---------- Admin panel ----------
export async function adminEconomy(request, env, ctx, url) {
  await requireAdmin(request, env);
  const sql = getDb(env);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 32);
  const [shop, players, cfg] = await Promise.all([
    loadShop(sql),
    sql`SELECT xuid, gamertag, balance_cents, is_op, last_seen FROM players
         WHERE (${q} = '' OR lower(gamertag) LIKE '%' || ${q} || '%')
         ORDER BY balance_cents DESC NULLS LAST, last_seen DESC LIMIT 100`,
    sql`SELECT updated_at, updated_by FROM economy_config WHERE key = 'shop'`,
  ]);
  const online = await voiceStub(env).fetch("https://voice/internal/server").then((r) => r.json()).catch(() => null);
  return json({
    ok: true,
    shop,
    custom: Boolean(cfg[0]),
    shopUpdated: cfg[0] ? { at: cfg[0].updated_at, by: cfg[0].updated_by } : null,
    serverOnline: Boolean(online),
    players: players.map((p) => ({
      xuid: p.xuid, gamertag: p.gamertag, cents: p.balance_cents == null ? null : Number(p.balance_cents), op: p.is_op, lastSeen: p.last_seen,
    })),
  });
}

function cleanMoney(v, label) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e15) throw new HttpError(400, `${label} must be a number of dollars (or empty).`);
  return Math.round(n * 100) / 100;
}

function validShop(body) {
  const cats = Array.isArray(body?.categories) ? body.categories : null;
  if (!cats || cats.length < 1 || cats.length > 20) throw new HttpError(400, "The shop needs 1 to 20 categories.");
  const ids = new Set();
  return {
    categories: cats.map((c, ci) => {
      const name = String(c.name || "").trim().slice(0, 32);
      if (!name) throw new HttpError(400, `Category ${ci + 1} needs a name.`);
      const id = String(c.id || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || `cat${ci + 1}`;
      const icon = String(c.icon || "").trim();
      if (!ICON.test(icon)) throw new HttpError(400, `The icon for "${name}" should look like textures/items/diamond.`);
      const items = Array.isArray(c.items) ? c.items : [];
      if (items.length > 100) throw new HttpError(400, `"${name}" has more than 100 items.`);
      return {
        id: ids.has(id) ? `${id}-${ci + 1}` : (ids.add(id), id),
        name,
        icon,
        items: items.map((it) => {
          let itemId = String(it.id || "").trim().toLowerCase();
          if (itemId && !itemId.includes(":")) itemId = `minecraft:${itemId}`;
          if (!ITEM_ID.test(itemId)) throw new HttpError(400, `"${it.id || "(empty)"}" in ${name} isn't an item ID like minecraft:diamond.`);
          const itemIcon = String(it.icon || "").trim();
          if (!ICON.test(itemIcon)) throw new HttpError(400, `The icon for ${itemId} should look like textures/items/diamond.`);
          return {
            id: itemId,
            name: String(it.name || "").trim().slice(0, 40) || itemId.split(":")[1].replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
            buy: cleanMoney(it.buy, `The buy price of ${itemId}`),
            sell: cleanMoney(it.sell, `The sell price of ${itemId}`),
            icon: itemIcon,
          };
        }),
      };
    }),
  };
}

export async function adminEconomyAction(request, env, ctx, url, params) {
  const user = await requireAdmin(request, env);
  const body = await readJson(request, 65536);
  const sql = getDb(env);
  const actor = user.username;

  if (params.action === "shop" || params.action === "reset-shop") {
    const shop = params.action === "shop" ? validShop(body.shop) : DEFAULT_SHOP;
    if (params.action === "shop") {
      await sql`
        INSERT INTO economy_config (key, value, updated_by) VALUES ('shop', ${JSON.stringify(shop)}::jsonb, ${actor})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
    } else {
      await sql`DELETE FROM economy_config WHERE key = 'shop'`;
    }
    const items = shop.categories.reduce((n, c) => n + c.items.length, 0);
    await audit(sql, user.id, params.action === "shop" ? "economy.shop" : "economy.shop_reset", { categories: shop.categories.length, items });
    const sent = await toPlugin(env, { type: "shop", shop });
    return json({ ok: true, shop, sent });
  }

  if (params.action === "money") {
    const action = String(body.action || "");
    if (!["set", "add", "take"].includes(action)) throw new HttpError(400, "Choose set, add or take.");
    const amount = Number(String(body.amount ?? "").replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amount) || amount < 0 || (action !== "set" && amount === 0)) throw new HttpError(400, "Type an amount in dollars, like 1000.");
    const cents = Math.round(amount * 100);
    if (BigInt(cents) > MAX_CENTS) throw new HttpError(400, "That amount is too large.");
    const [player] = await sql`SELECT xuid, gamertag, balance_cents FROM players WHERE xuid = ${String(body.xuid || "")}`;
    if (!player) throw new HttpError(404, "That player hasn't joined the server yet.");
    const sent = await toPlugin(env, { type: "eco", action, xuid: player.xuid, name: player.gamertag, cents, by: actor });
    if (!sent) throw new HttpError(409, "The Minecraft server isn't connected right now, so money can't be changed. Try again when it's online.");
    // Show the new balance right away; the server confirms it within seconds.
    const old = Number(player.balance_cents || 0);
    const next = action === "set" ? cents : action === "add" ? old + cents : Math.max(0, old - cents);
    await sql`UPDATE players SET balance_cents = ${next}, balance_at = now() WHERE xuid = ${player.xuid}`;
    await audit(sql, user.id, "economy.money", { player: player.gamertag, action, cents });
    return json({ ok: true, cents: next });
  }

  throw new HttpError(400, "Unknown action.");
}
