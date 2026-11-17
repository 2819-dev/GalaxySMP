// Community extras (see chat/engage.js for chat levels, the Question of the Day and welcome cards):
//   POST /api/chat/messages/:id/thank   thank someone for a message (25 thanks = the Helpful badge)
//   POST /api/chat/messages/:id/wave    wave at a new player on their welcome card
//   GET  /api/community/away            "While you were away": what happened since your last visit (1+ day)
//   GET/POST /api/panel/qotd            the owner's Question of the Day list
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { can } from "../lib/perms.js";
import { isOwner } from "../lib/names.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { loadMessage } from "../chat/messages.js";
import { hubBroadcast } from "./chat.js";
import { notify } from "./notify.js";
import { levelInfo } from "../chat/engage.js";

export const HELPFUL_AT = 25;

async function visibleMessage(sql, user, id) {
  const [m] = await sql`SELECT m.id, m.user_id, m.kind, m.meta, m.channel_id, c.staff_only, (SELECT is_bot FROM users WHERE id = m.user_id) AS is_bot FROM messages m JOIN channels c ON c.id = m.channel_id
                         WHERE m.id = ${id} AND m.deleted_at IS NULL`;
  if (!m || (m.staff_only && !can(user, "staff_chat"))) throw new HttpError(404, "That message no longer exists.");
  return m;
}
const updated = async (env, sql, id) => {
  const message = await loadMessage(sql, id);
  if (message) await hubBroadcast(env, { type: "message_updated", message });
  return message;
};

// POST /api/chat/messages/:id/thank  (again = take the thanks back)
export async function thank(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  if (user.banned || user.acting_by) throw new HttpError(403, "You can't do that right now.");
  await rateLimit(env, "AUTH_LIMITER", `thank:${user.id}`);
  const sql = getDb(env);
  const m = await visibleMessage(sql, user, Number(params.id));
  if (!m.user_id || m.is_bot) throw new HttpError(400, "You can only thank members.");
  if (Number(m.user_id) === Number(user.id)) throw new HttpError(400, "You can't thank yourself.");
  const [had] = await sql`DELETE FROM message_thanks WHERE message_id = ${m.id} AND user_id = ${user.id} RETURNING 1`;
  if (!had) {
    await sql`INSERT INTO message_thanks (message_id, user_id, author_id) VALUES (${m.id}, ${user.id}, ${m.user_id}) ON CONFLICT DO NOTHING`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM message_thanks WHERE author_id = ${m.user_id}`;
    await notify(env, [Number(m.user_id)], "mentions", { title: `${user.username} thanked you`, body: n >= HELPFUL_AT ? "Thanks for helping out!" : `${n} thank${n === 1 ? "" : "s"} so far. At ${HELPFUL_AT} you get the Helpful badge.`,
      url: "/community#chat", tag: `thanks-${m.user_id}`, ttl: 3600 }).catch(() => {});
    if (n >= HELPFUL_AT) {
      let [badge] = await sql`SELECT id FROM badges WHERE name = 'Helpful' ORDER BY id LIMIT 1`;
      if (!badge) [badge] = await sql`INSERT INTO badges (name, description, icon, style) VALUES ('Helpful', ${`Thanked ${HELPFUL_AT} times by other members for helping out.`}, 'handshake', 'emerald') RETURNING id`;
      const [got] = await sql`INSERT INTO user_badges (user_id, badge_id) VALUES (${m.user_id}, ${badge.id}) ON CONFLICT DO NOTHING RETURNING user_id`;
      if (got) await notify(env, [Number(m.user_id)], "reward", { title: "You earned the Helpful badge!", body: `${HELPFUL_AT} members thanked you for your messages. It now shows on your profile.`, url: "/account", tag: "helpful-badge" }).catch(() => {});
    }
  }
  const message = await updated(env, sql, m.id);
  return json({ ok: true, thanked: !had, thanks: message?.thanks?.length || 0 });
}

// POST /api/chat/messages/:id/wave  (welcome cards only; once per member)
export async function wave(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  if (user.banned || user.acting_by) throw new HttpError(403, "You can't do that right now.");
  await rateLimit(env, "AUTH_LIMITER", `wave:${user.id}`);
  const sql = getDb(env);
  const m = await visibleMessage(sql, user, Number(params.id));
  if (m.kind !== "welcome") throw new HttpError(400, "You can only wave on welcome messages.");
  const newbie = m.meta?.userId ? Number(m.meta.userId) : null;
  if (newbie === Number(user.id)) throw new HttpError(400, "That's your own welcome! Say hi in chat instead.");
  const [added] = await sql`INSERT INTO message_waves (message_id, user_id) VALUES (${m.id}, ${user.id}) ON CONFLICT DO NOTHING RETURNING 1`;
  if (!added) return json({ ok: true, already: true });
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM message_waves WHERE message_id = ${m.id}`;
  // the new player (if they have a website account) hears about it; the notification updates as more people wave
  const who = newbie || (await sql`SELECT u.id FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE p.xuid = ${String(m.meta?.xuid || "")} LIMIT 1`)[0]?.id;
  if (who) {
    await notify(env, [Number(who)], "mentions", { title: n === 1 ? `${user.username} waved at you 👋` : `${n} people waved at you 👋`,
      body: "Welcome to GalaxySMP! Say hi back in #Chat.", url: "/community#chat", tag: `waves-${m.id}`, ttl: 86400 }).catch(() => {});
  }
  await updated(env, sql, m.id);
  return json({ ok: true, waves: n });
}

// GET /api/community/away: shown once when you come back after a day or more.
export async function away(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  if (user.acting_by) return json({ ok: true, show: false });
  const [prev] = await sql`SELECT community_seen_at FROM users WHERE id = ${user.id}`;
  await sql`UPDATE users SET community_seen_at = now() WHERE id = ${user.id}`;
  const since = prev?.community_seen_at ? new Date(prev.community_seen_at) : null;
  if (!since || Date.now() - since.getTime() < 24 * 3600e3) return json({ ok: true, show: false });
  const from = new Date(Math.max(since.getTime(), Date.now() - 14 * 864e5)).toISOString();
  const staff = can(user, "staff_chat");
  const [channels, top, members, events, mine] = await Promise.all([
    sql`SELECT c.id, c.slug, c.name, count(*)::int AS n FROM messages m JOIN channels c ON c.id = m.channel_id
         WHERE m.created_at > ${from}::timestamptz AND m.deleted_at IS NULL AND NOT c.hidden AND (NOT c.staff_only OR ${staff})
         GROUP BY c.id ORDER BY n DESC LIMIT 3`,
    sql`SELECT m.id, m.channel_id, left(m.content, 140) AS content, coalesce(u.username, m.game_name) AS author, c.name AS channel, count(r.*)::int AS reactions
          FROM messages m JOIN channels c ON c.id = m.channel_id JOIN reactions r ON r.message_id = m.id LEFT JOIN users u ON u.id = m.user_id
         WHERE m.created_at > ${from}::timestamptz AND m.deleted_at IS NULL AND NOT c.hidden AND (NOT c.staff_only OR ${staff}) AND m.content <> ''
         GROUP BY m.id, u.username, c.name ORDER BY reactions DESC, m.id DESC LIMIT 3`,
    sql`SELECT gamertag FROM players WHERE first_seen > ${from}::timestamptz ORDER BY first_seen DESC LIMIT 6`,
    sql`SELECT id, title, starts_at FROM events WHERE deleted_at IS NULL AND starts_at > now() ORDER BY starts_at LIMIT 3`,
    sql`SELECT count(*)::int AS n FROM messages m JOIN channels c ON c.id = m.channel_id
         WHERE m.created_at > ${from}::timestamptz AND m.deleted_at IS NULL AND (NOT c.staff_only OR ${staff})
           AND (m.content ILIKE ${"%@" + user.username + "%"} OR m.reply_to IN (SELECT id FROM messages WHERE user_id = ${user.id}))`,
  ]);
  const [{ n: newCount }] = await sql`SELECT count(*)::int AS n FROM players WHERE first_seen > ${from}::timestamptz`;
  const nothing = !channels.length && !top.length && !newCount && !events.length;
  return json({
    ok: true, show: !nothing, since: since.toISOString(),
    channels: channels.map((c) => ({ id: Number(c.id), slug: c.slug, name: c.name, messages: c.n })),
    top: top.map((t) => ({ id: Number(t.id), channelId: Number(t.channel_id), content: t.content, author: t.author, channel: t.channel, reactions: t.reactions })),
    newMembers: { count: newCount, names: members.map((r) => r.gamertag) },
    events: events.map((e) => ({ id: Number(e.id), title: e.title, startsAt: e.starts_at })),
    mentions: mine[0]?.n || 0,
    level: await levelInfo(sql, user.id).catch(() => null),
  });
}

// GET /api/community/level?user=ID: a member's chat level (for profile cards)
export async function level(request, env, ctx, url) {
  await requireUser(request, env);
  const id = Number(url.searchParams.get("user")) || 0;
  return json({ ok: true, ...(await levelInfo(getDb(env), id)) });
}

// ---------- the owner's Question of the Day list ----------
const ownerOnly = async (request, env) => {
  const user = await requireUser(request, env);
  if (!isOwner(env, user.username, user.platform === "bedrock")) throw new HttpError(403, "Only the owner can do this.");
  return user;
};

export async function qotdList(request, env) {
  await ownerOnly(request, env);
  const sql = getDb(env);
  const rows = await sql`SELECT id, text, used_at, created_at FROM qotd_questions ORDER BY used_at ASC NULLS FIRST, id DESC LIMIT 300`;
  return json({ ok: true, questions: rows.map((r) => ({ id: Number(r.id), text: r.text, usedAt: r.used_at })) });
}

// POST /api/panel/qotd { action: "add", text } | { action: "delete", id }
export async function qotdSave(request, env) {
  const user = await ownerOnly(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  if (body.action === "delete") {
    await sql`DELETE FROM qotd_questions WHERE id = ${Number(body.id) || 0}`;
    return json({ ok: true });
  }
  const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (text.length < 8) throw new HttpError(400, "Write a question (at least 8 characters).");
  const check = checkMessage(text, compileWordList(await sql`SELECT word, match FROM filter_words WHERE NOT EXISTS (SELECT 1 FROM economy_config WHERE key = 'chatfilter_off')`), { allowLinks: false, maxLength: 200 });
  if (!check.ok) throw new HttpError(400, check.message);
  await sql`INSERT INTO qotd_questions (text, created_by) VALUES (${check.text}, ${user.id})`;
  return json({ ok: true, message: "Added. New questions are asked before older ones." });
}

// ---------- post as GalaxySMP (owner) ----------
// GET: the channels it can post in. POST { channelId, text }: posts the message as GalaxySMP.
export async function botChannels(request, env) {
  await ownerOnly(request, env);
  const rows = await getDb(env)`SELECT id, name FROM channels WHERE kind = 'text' AND NOT hidden ORDER BY position, id`;
  return json({ ok: true, channels: rows.map((c) => ({ id: Number(c.id), name: c.name })) });
}

export async function botSay(request, env) {
  const user = await ownerOnly(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const text = String(body.text || "").replace(/\r\n?/g, "\n").trim().slice(0, 2000);
  if (!text) throw new HttpError(400, "Write a message first.");
  const [ch] = await sql`SELECT id, name FROM channels WHERE id = ${Number(body.channelId) || 0} AND kind = 'text' AND NOT hidden`;
  if (!ch) throw new HttpError(404, "Choose a channel.");
  const { botPost } = await import("../chat/engage.js");
  const message = await botPost(sql, { channelId: ch.id, content: text, kind: "post", meta: { by: user.username } });
  if (!message) throw new HttpError(409, "That couldn't be posted.");
  await hubBroadcast(env, { type: "message", message });
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'bot.post', ${JSON.stringify({ channel: ch.name, text: text.slice(0, 200) })}::jsonb)`;
  return json({ ok: true, message: `Posted in #${ch.name} as GalaxySMP.` });
}
