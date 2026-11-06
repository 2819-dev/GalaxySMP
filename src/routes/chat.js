// Chat API: everything the chat page needs, plus the live connection.
import { getDb } from "../lib/db.js";
import { json, HttpError } from "../lib/http.js";
import { requireUser, publicUser } from "../lib/auth.js";
import { REACTIONS, loadHistory } from "../chat/messages.js";
import { MAX_LENGTH } from "../lib/filter.js";

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
    sql`SELECT id, category_id, slug, name, topic, min_post_power FROM channels ORDER BY position, id`,
    sql`SELECT key, name, color, power FROM roles ORDER BY power DESC`,
    sql`SELECT u.id, u.username, r.key AS role
          FROM users u JOIN roles r ON r.id = u.role_id
         WHERE NOT u.banned
         ORDER BY r.power DESC, lower(u.username)
         LIMIT 500`,
  ]);
  await sql`UPDATE users SET last_seen_at = now() WHERE id = ${user.id}`;
  const me = publicUser(user);
  return json({
    ok: true,
    me,
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    channels: channels.map((c) => ({
      id: c.id,
      categoryId: c.category_id,
      slug: c.slug,
      name: c.name,
      topic: c.topic,
      canPost: me.role.power >= c.min_post_power,
    })),
    roles: roles.map((r) => ({ key: r.key, name: r.name, color: r.color, power: r.power })),
    members: members.map((m) => ({ id: Number(m.id), username: m.username, role: m.role })),
    reactions: REACTIONS,
    maxLength: MAX_LENGTH,
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
  headers.set("X-GSMP-User", JSON.stringify({ id: Number(user.id), username: user.username }));
  return hubStub(env).fetch(new Request(request.url, { headers }));
}
