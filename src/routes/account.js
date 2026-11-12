// Account settings (the profile menu in the top right > Account): profile, subscription, purchases,
// password, signed-in devices and blocked members. Notification settings live in notify.js.
import { balance as creditBalance, history as creditHistory } from "../store/credits.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser, readCookie, getUser } from "../lib/auth.js";
import { sha256 } from "../lib/crypto.js";
import { baseName, isOwner } from "../lib/names.js";
import { limit, clientIp } from "../lib/ratelimit.js";
import { headUrlFor } from "./heads.js";
import { rankOf } from "../chat/messages.js";
import { displayRank, loadPlanPriority } from "./ranks.js";
import { PLANS } from "./plans.js";
import { SHOP_ITEMS } from "../store/shop.js";

async function profileRow(sql, userId) {
  const [u] = await sql`
    SELECT u.id, u.username, u.platform, u.created_at, u.muted_until, r.power, u.real_name, u.real_name_hidden, u.onboarded_at, u.show_activity, u.bio, u.interests, u.profile_color,
           p.xuid, p.gamertag, p.head_at, p.gamerpic_at, p.balance_cents, p.playtime_s, p.streak, p.extra_plots, p.extra_shop_plots,
           p.cosmetics, p.night_vision_until, p.first_seen, p.last_seen, (p.online_at > now() - interval '150 seconds') AS in_game,
           rk.name AS rank_name, rk.prefix AS rank_prefix, rk.color AS rank_color, rk.icon AS rank_icon, rk.gradient AS rank_gradient,
           rk.position AS rank_position, rk.priority AS rank_priority,
           s.plan, s.expires_at AS plan_expires
      FROM users u JOIN roles r ON r.id = u.role_id
      LEFT JOIN players p ON p.uuid = u.mc_uuid
      LEFT JOIN player_top_rank pr ON pr.xuid = p.xuid LEFT JOIN ranks rk ON rk.id = pr.rank_id
      LEFT JOIN subscriptions s ON s.xuid = p.xuid AND (s.expires_at IS NULL OR s.expires_at > now())
     WHERE u.id = ${userId}`;
  return u;
}

// Small and fast: what the header's profile button needs (every page).
export async function headerMe(request, env) {
  const user = await getUser(request, env);
  if (!user) return json({ ok: true, user: null });
  const sql = getDb(env);
  const u = await profileRow(sql, user.id);
  const rank = displayRank(rankOf(u), u.plan, await loadPlanPriority(sql), PLANS);
  return json({
    ok: true,
    user: {
      id: Number(u.id), username: u.username, head: headUrlFor(u), rank, plan: u.plan || null,
      money: u.balance_cents == null ? null : Number(u.balance_cents) / 100, inGame: Boolean(u.in_game),
      staff: Number(u.power) >= 50,
      panel: Number(u.power) < 50 ? null : isOwner(env, user.username, user.platform === "bedrock") ? "Control Panel" : Number(u.power) >= 100 ? "Admin Panel" : "Staff Panel",
      onboarding: !u.onboarded_at && !user.acting_by, // still has to do the welcome steps
      acting: user.acting_by ? { by: user.acting_by_name } : null,  // the owner is looking as this member
    },
  }, 200, { "Cache-Control": "no-store" });
}

export async function getAccount(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const u = await profileRow(sql, user.id);
  const [orders, sessions, blocked] = await Promise.all([
    u.xuid ? sql`SELECT item, option, price_cents, source, given_by, created_at FROM shop_orders WHERE xuid = ${u.xuid} ORDER BY id DESC LIMIT 50` : [],
    sql`SELECT count(*)::int AS n FROM sessions WHERE user_id = ${user.id} AND expires_at > now()`,
    sql`SELECT b.blocked_id, x.username FROM dm_blocks b JOIN users x ON x.id = b.blocked_id WHERE b.user_id = ${user.id} ORDER BY x.username`,
  ]);
  const credits = { balance: await creditBalance(sql, user.id) / 100, history: await creditHistory(sql, user.id, 30) };
  const plan = u.plan ? PLANS[u.plan] : PLANS.free;
  return json({
    ok: true,
    profile: {
      username: u.username, platform: u.platform, joined: u.created_at, gamertag: u.gamertag || null, head: headUrlFor(u),
      rank: displayRank(rankOf(u), u.plan, await loadPlanPriority(sql), PLANS),
      money: u.balance_cents == null ? null : Number(u.balance_cents) / 100,
      playtimeH: Math.round(Number(u.playtime_s || 0) / 360) / 10, streak: u.streak || 0,
      firstSeen: u.first_seen, lastSeen: u.last_seen, inGame: Boolean(u.in_game),
      mutedUntil: u.muted_until && new Date(u.muted_until) > new Date() ? u.muted_until : null,
    },
    subscription: {
      plan: u.plan || "free", name: plan.name, price: plan.price, gameCost: plan.gameCost, perks: plan.perks,
      expires: u.plan_expires || null, extraPlots: u.extra_plots || 0, extraShopPlots: u.extra_shop_plots || 0,
      cosmetics: (u.cosmetics || []).map((id) => SHOP_ITEMS[id]?.name || id),
      nightVisionUntil: u.night_vision_until && new Date(u.night_vision_until) > new Date() ? u.night_vision_until : null,
    },
    orders: orders.map((o) => ({
      item: SHOP_ITEMS[o.item]?.name || (o.item.startsWith("plan:") ? PLANS[o.item.slice(5)]?.name : null) || o.item,
      option: o.option ? SHOP_ITEMS[o.item]?.options?.find((x) => x.id === o.option)?.name || o.option : null,
      price: o.price_cents / 100, source: o.source, at: o.created_at,
    })),
    credits,
    realName: u.real_name || null, realNameHidden: Boolean(u.real_name_hidden), showActivity: u.show_activity !== false, hasXbox: Boolean(u.xuid),
    social: { bio: u.bio || "", interests: u.interests || [], color: u.profile_color || null },
    sessions: sessions[0].n,
    blocked: blocked.map((b) => ({ id: Number(b.blocked_id), username: b.username })),
  });
}

export async function changePassword(request, env) {
  const user = await requireUser(request, env);
  await limit(env, "AUTH_LIMITER", "password:" + clientIp(request));
  const body = await readJson(request);
  const current = String(body.current || "");
  const next = String(body.next || "");
  if (next.length < 8) throw new HttpError(400, "Your new password must be at least 8 characters.");
  if (new TextEncoder().encode(next).length > 72) throw new HttpError(400, "Passwords can be at most 72 characters.");
  if (next.toLowerCase().includes(baseName(user.username))) throw new HttpError(400, "Your password cannot contain your username.");
  if (next === current) throw new HttpError(400, "Choose a password that's different from your current one.");
  const sql = getDb(env);
  const [ok] = await sql`SELECT password_hash = crypt(${current}, password_hash) AS ok FROM users WHERE id = ${user.id}`;
  if (!ok?.ok) throw new HttpError(400, "Your current password isn't right.");
  await sql`UPDATE users SET password_hash = crypt(${next}, gen_salt('bf', 10)) WHERE id = ${user.id}`;
  // other devices are signed out; this one stays signed in
  const mine = await sha256(readCookie(request) || "");
  await sql`DELETE FROM sessions WHERE user_id = ${user.id} AND token_hash <> ${mine}`;
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'account.password', '{}'::jsonb)`;
  return json({ ok: true });
}

export async function signOutOthers(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const mine = await sha256(readCookie(request) || "");
  const gone = await sql`DELETE FROM sessions WHERE user_id = ${user.id} AND token_hash <> ${mine} RETURNING 1`;
  return json({ ok: true, signedOut: gone.length });
}

// POST /api/account/real-name { hidden } : who can see the real name staff added
export async function setRealNameVisibility(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  await sql`UPDATE users SET real_name_hidden = ${Boolean(body.hidden)} WHERE id = ${user.id}`;
  return json({ ok: true, hidden: Boolean(body.hidden) });
}
