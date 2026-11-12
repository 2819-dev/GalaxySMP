// Chat API: everything the chat page needs, plus the live connection.
import { badgesFor } from "./badges.js";
import { isOwner } from "../lib/names.js";
import { INTEREST_NAME } from "./onboarding.js";
import { getDb } from "../lib/db.js";
import { json, HttpError } from "../lib/http.js";
import { requireUser, publicUser } from "../lib/auth.js";
import { REACTIONS, loadHistory, rankOf } from "../chat/messages.js";
import { MAX_LENGTH } from "../lib/filter.js";
import { headUrlFor } from "./heads.js";
import { displayRank, loadPlanPriority } from "./ranks.js";
import { PLANS } from "./plans.js";

export function hubStub(env) {
  return env.HUB.get(env.HUB.idFromName("community"));
}

// Sends an event to everyone connected (used by staff tools).
export async function hubBroadcast(env, event) {
  await hubStub(env).fetch("https://hub/internal/broadcast", { method: "POST", body: JSON.stringify(event) });
}

export async function bootstrap(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const [categories, channels, roles, members] = await Promise.all([
    sql`SELECT id, name FROM categories ORDER BY position, id`,
    sql`SELECT id, category_id, slug, name, topic, min_post_power, kind FROM channels WHERE NOT hidden ORDER BY position, id`,
    sql`SELECT key, name, color, power FROM roles ORDER BY power DESC`,
    sql`SELECT u.id, u.username, r.key AS role, u.real_name, u.real_name_hidden, u.bio, u.interests, u.profile_color, u.custom_presence, u.platform AS plat,
               rk.name AS rank_name, rk.prefix AS rank_prefix, rk.color AS rank_color, rk.icon AS rank_icon,
               rk.gradient AS rank_gradient, rk.position AS rank_position, rk.priority AS rank_priority,
               pl.xuid, pl.head_at, pl.gamerpic_at, (pl.online_at > now() - interval '150 seconds') AS in_game, u.created_at,
               (SELECT s.plan FROM subscriptions s WHERE s.xuid = pl.xuid AND (s.expires_at IS NULL OR s.expires_at > now())) AS plan
          FROM users u JOIN roles r ON r.id = u.role_id
          LEFT JOIN players pl ON pl.uuid = u.mc_uuid
          LEFT JOIN player_top_rank prk ON prk.xuid = pl.xuid
          LEFT JOIN ranks rk ON rk.id = prk.rank_id
         WHERE NOT u.banned
         ORDER BY (rk.id IS NULL), rk.position, lower(u.username)
         LIMIT 500`,
  ]);
  await sql`UPDATE users SET last_seen_at = now() WHERE id = ${user.id}`;
  const planPriority = await loadPlanPriority(sql);
  const badgeMap = await badgesFor(env, sql, members.map((m) => ({ id: m.id, username: m.username, plat: m.plat })));
  // staff replies to your support tickets you haven't read yet (shows a dot on the Support channel)
  const [{ ticket_unread: ticketUnread }] = await sql`SELECT coalesce(sum(user_unread), 0)::int AS ticket_unread FROM tickets WHERE user_id = ${user.id}`;
  const [{ dm_unread: dmUnread }] = await sql`
    SELECT coalesce(sum(CASE WHEN user_a = ${user.id} THEN a_unread ELSE b_unread END), 0)::int AS dm_unread
      FROM dm_threads WHERE user_a = ${user.id} OR user_b = ${user.id}`;
  const me = publicUser(user);
  const [{ onboarded_at: onboarded }] = await sql`SELECT onboarded_at FROM users WHERE id = ${user.id}`;
  return json({
    ok: true,
    me,
    onboarding: !onboarded,
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    channels: channels.map((c) => ({
      id: c.id,
      categoryId: c.category_id,
      slug: c.slug,
      name: c.name,
      topic: c.topic,
      kind: c.kind,
      canPost: c.kind === "text" && me.role.power >= c.min_post_power,
    })),
    roles: roles.map((r) => ({ key: r.key, name: r.name, color: r.color, power: r.power })),
    members: members.map((m) => ({
      id: Number(m.id), username: m.username, role: m.role, rank: displayRank(rankOf(m), m.plan, planPriority, PLANS),
      // Minecraft head picture (if the server has sent it), plan, and when they joined the community
      head: headUrlFor(m),
      plan: m.plan || null, inGame: Boolean(m.in_game), since: m.created_at,
      status: isOwner(env, m.username, m.plat === "bedrock") && m.custom_presence?.title && (!m.custom_presence.until || new Date(m.custom_presence.until) > new Date())
        ? `${m.custom_presence.label && m.custom_presence.label !== "Status" ? `${m.custom_presence.label} ` : ""}${m.custom_presence.title}` : null,
      badges: badgeMap.get(Number(m.id)) || [],
      bio: m.bio || null, interests: (m.interests || []).map((i) => INTEREST_NAME[i]).filter(Boolean), color: m.profile_color || null,
      // real name (set by staff): everyone sees it unless the member hid it; they and staff always do
      ...(m.real_name && (!m.real_name_hidden || Number(m.id) === Number(user.id) || me.role.power >= 50)
        ? { realName: m.real_name, realNameHidden: Boolean(m.real_name_hidden) } : {}),
    })),
    reactions: REACTIONS,
    maxLength: MAX_LENGTH,
    ticketUnread,
    dmUnread,
  });
}

export async function history(request, env, ctx, url, params) {
  await requireUser(request, env);
  const channelId = Number(params.id);
  const before = url.searchParams.get("before");
  if (!Number.isInteger(channelId)) throw new HttpError(400, "Unknown channel.");
  const sql = getDb(env);
  const messages = await loadHistory(sql, channelId, before ? Number(before) : null);
  return json({ ok: true, messages, hasMore: messages.length >= 50 });
}

// Opens the live connection. Only signed-in members from our own site may connect.
export async function connect(request, env) {
  if (request.headers.get("Upgrade") !== "websocket") throw new HttpError(426, "Expected a WebSocket.");
  const origin = request.headers.get("Origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) throw new HttpError(403, "Forbidden.");
  const user = await requireUser(request, env);
  const headers = new Headers(request.headers);
  headers.set("X-GSMP-User", JSON.stringify({ id: Number(user.id), username: user.username, power: Number(user.role_power) }));
  return hubStub(env).fetch(new Request(request.url, { headers }));
}
