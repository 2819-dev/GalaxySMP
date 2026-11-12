// Direct messages between community members. They also work in game: a DM shows in the player's
// game chat when they're online, and /dm <player> <message> in game sends one.
// The server owners can read DMs for safety (stated in the privacy policy).
import { permsOfUser } from "../lib/perms.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { checkMessage, compileWordList, maxLengthFor } from "../lib/filter.js";
import { isOwner } from "../lib/names.js";
import { hubStub } from "./chat.js";
import { headUrlFor } from "./heads.js";
import { toPlugin } from "./economy.js";
import { checkPlugin } from "./ranks.js";
import { notify as pushNotify } from "./notify.js";

const MAX = 500;
const clean = (v) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, MAX);
const pair = (x, y) => (Number(x) < Number(y) ? [Number(x), Number(y)] : [Number(y), Number(x)]);

async function notify(env, payload) {
  try {
    await hubStub(env).fetch("https://hub/internal/broadcast", { method: "POST", body: JSON.stringify({ type: "dm", ...payload }) }); // payload.type can override
  } catch { /* live update is best effort */ }
}

async function loadUser(sql, id) {
  const [u] = await sql`
    SELECT u.id, u.username, u.platform, u.banned, u.muted_until, r.power, p.xuid, p.head_at, p.gamerpic_at,
           (p.online_at > now() - interval '150 seconds') AS in_game
      FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN players p ON p.uuid = u.mc_uuid
     WHERE u.id = ${id}`;
  return u || null;
}

const userOut = (u) => ({ id: Number(u.id), username: u.username, head: headUrlFor(u), inGame: Boolean(u.in_game) });

// The one place every DM goes through (website and game).
async function sendDm(env, sql, from, to, text, via) {
  if (!to || to.banned) throw new HttpError(404, "That member can't receive messages.");
  if (Number(from.id) === Number(to.id)) throw new HttpError(400, "You can't message yourself.");
  if (from.banned) throw new HttpError(403, "Your account has been banned.");
  if (from.muted_until && new Date(from.muted_until) > new Date()) throw new HttpError(403, "You're muted, so you can't send messages right now.");
  const body = clean(text);
  if (!body) throw new HttpError(400, "Type a message first.");
  const words = compileWordList(await sql`SELECT word, match FROM filter_words`);
  const fromPerms = { perms: await permsOfUser(env, sql, from.id) };
  const check = checkMessage(body, words, { allowLinks: fromPerms.perms.includes("post_links"), maxLength: maxLengthFor(fromPerms) });
  if (!check.ok) throw new HttpError(400, check.message);
  const [blocked] = await sql`SELECT 1 FROM dm_blocks WHERE (user_id = ${to.id} AND blocked_id = ${from.id}) OR (user_id = ${from.id} AND blocked_id = ${to.id})`;
  if (blocked) throw new HttpError(403, "You can't message this member.");
  const [{ n }] = await sql`
    SELECT count(*)::int AS n FROM dm_messages m JOIN dm_threads t ON t.id = m.thread_id
     WHERE m.sender_id = ${from.id} AND m.created_at > now() - interval '1 minute'`;
  if (n >= 12) throw new HttpError(429, "You're sending messages too fast. Please wait a moment.");
  const [a, b] = pair(from.id, to.id);
  const fromIsA = Number(from.id) === a;
  const [thread] = await sql`
    INSERT INTO dm_threads (user_a, user_b, last_message_at, a_unread, b_unread)
    VALUES (${a}, ${b}, now(), ${fromIsA ? 0 : 1}, ${fromIsA ? 1 : 0})
    ON CONFLICT (user_a, user_b) DO UPDATE SET last_message_at = now(),
      a_unread = dm_threads.a_unread + ${fromIsA ? 0 : 1}, b_unread = dm_threads.b_unread + ${fromIsA ? 1 : 0}
    RETURNING id`;
  const [msg] = await sql`INSERT INTO dm_messages (thread_id, sender_id, body, via) VALUES (${thread.id}, ${from.id}, ${check.text}, ${via}) RETURNING id, created_at`;
  const out = { id: Number(msg.id), threadId: Number(thread.id), from: Number(from.id), fromName: from.username, to: Number(to.id), body: check.text, at: msg.created_at, via };
  await notify(env, out);
  try { // phone/computer notification for the recipient, unless they have this conversation open right now
    const r = await hubStub(env).fetch(`https://hub/internal/viewing?user=${Number(to.id)}&view=dm:${Number(from.id)}`).then((x) => x.json()).catch(() => ({}));
    if (!r.viewing) await pushNotify(env, [to.id], "dms", { title: `Message from ${from.username}`, body: check.text, url: "/community#messages", tag: `dm-${from.id}` });
  } catch { /* best effort */ }
  // in game: show it to the recipient if they're playing (the plugin delivers game-to-game DMs itself)
  if (via === "web" && to.xuid) {
    try { await toPlugin(env, { type: "dm", toXuid: String(to.xuid), from: from.username, text: check.text }); } catch { /* server offline */ }
  }
  return out;
}

// ---------- website ----------
export async function listThreads(request, env) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  const rows = await sql`
    SELECT t.id, t.last_message_at, CASE WHEN t.user_a = ${me.id} THEN t.a_unread ELSE t.b_unread END AS unread,
           o.id AS other_id, o.username, p.xuid, p.head_at, p.gamerpic_at, (p.online_at > now() - interval '150 seconds') AS in_game,
           (SELECT body FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS preview,
           (SELECT sender_id FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_sender
      FROM dm_threads t
      JOIN users o ON o.id = CASE WHEN t.user_a = ${me.id} THEN t.user_b ELSE t.user_a END
      LEFT JOIN players p ON p.uuid = o.mc_uuid
     WHERE t.user_a = ${me.id} OR t.user_b = ${me.id}
     ORDER BY t.last_message_at DESC LIMIT 100`;
  const blocks = await sql`SELECT blocked_id FROM dm_blocks WHERE user_id = ${me.id}`;
  return json({
    ok: true,
    threads: rows.map((r) => ({
      id: Number(r.id), unread: r.unread, at: r.last_message_at, preview: r.preview, mine: Number(r.last_sender) === Number(me.id),
      other: userOut({ id: r.other_id, username: r.username, xuid: r.xuid, head_at: r.head_at, gamerpic_at: r.gamerpic_at, in_game: r.in_game }),
    })),
    blocked: blocks.map((b) => Number(b.blocked_id)),
    unread: rows.reduce((n, r) => n + Number(r.unread || 0), 0),
  });
}

export async function getConversation(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  const other = await loadUser(sql, Number(params.userId));
  if (!other) throw new HttpError(404, "That member doesn't exist.");
  const [a, b] = pair(me.id, other.id);
  const [thread] = await sql`SELECT id FROM dm_threads WHERE user_a = ${a} AND user_b = ${b}`;
  let messages = [];
  if (thread) {
    const before = Number(url.searchParams.get("before")) || null;
    const rows = await sql`
      SELECT id, sender_id, body, via, created_at, read_at, edited_at FROM dm_messages
       WHERE thread_id = ${thread.id} AND (${before}::bigint IS NULL OR id < ${before})
       ORDER BY id DESC LIMIT 60`;
    messages = rows.reverse().map((m) => ({ id: Number(m.id), from: Number(m.sender_id), body: m.body, via: m.via, at: m.created_at,
      read: Boolean(m.read_at), editedAt: m.edited_at || null }));
    // opening the conversation reads their messages: the sender can't edit them any more
    // (looking as this member with "Act as Member" doesn't mark their messages as read)
    const read = me.acting_by ? [] : await sql`UPDATE dm_messages SET read_at = now() WHERE thread_id = ${thread.id} AND sender_id <> ${me.id} AND read_at IS NULL RETURNING id`;
    if (read.length) await notify(env, { type: "dm_read", ids: read.map((r) => Number(r.id)), from: Number(me.id), to: Number(other.id) });
    if (!me.acting_by) await sql`UPDATE dm_threads SET a_unread = CASE WHEN user_a = ${me.id} THEN 0 ELSE a_unread END,
                                   b_unread = CASE WHEN user_b = ${me.id} THEN 0 ELSE b_unread END WHERE id = ${thread.id}`;
  }
  const [blockedByMe] = await sql`SELECT 1 FROM dm_blocks WHERE user_id = ${me.id} AND blocked_id = ${other.id}`;
  return json({ ok: true, threadId: thread ? Number(thread.id) : null, other: userOut(other), messages, blocked: Boolean(blockedByMe) });
}

export async function postMessage(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const from = await loadUser(sql, me.id);
  const to = await loadUser(sql, Number(params.userId));
  const msg = await sendDm(env, sql, from, to, body.body, "web");
  return json({ ok: true, message: msg });
}

export async function setBlock(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const other = Number(params.userId);
  if (other === Number(me.id)) throw new HttpError(400, "You can't block yourself.");
  if (body.blocked) await sql`INSERT INTO dm_blocks (user_id, blocked_id) VALUES (${me.id}, ${other}) ON CONFLICT DO NOTHING`;
  else await sql`DELETE FROM dm_blocks WHERE user_id = ${me.id} AND blocked_id = ${other}`;
  return json({ ok: true, blocked: Boolean(body.blocked) });
}

// ---------- owners: read any conversation (for safety) ----------
async function requireOwner(request, env) {
  const user = await requireUser(request, env);
  if (!isOwner(env, user.username, user.platform === "bedrock")) throw new HttpError(403, "Only the server owners can do that.");
  return user;
}

export async function ownerThreads(request, env, ctx, url) {
  await requireOwner(request, env);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 32);
  const sql = getDb(env);
  const rows = await sql`
    SELECT t.id, t.last_message_at, a.id AS a_id, a.username AS a_name, b.id AS b_id, b.username AS b_name,
           (SELECT count(*)::int FROM dm_messages m WHERE m.thread_id = t.id) AS count,
           (SELECT body FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS preview
      FROM dm_threads t JOIN users a ON a.id = t.user_a JOIN users b ON b.id = t.user_b
     WHERE ${q} = '' OR lower(a.username) LIKE ${"%" + q + "%"} OR lower(b.username) LIKE ${"%" + q + "%"}
     ORDER BY t.last_message_at DESC LIMIT 100`;
  return json({ ok: true, threads: rows.map((r) => ({ id: Number(r.id), at: r.last_message_at, count: r.count, preview: r.preview,
    a: { id: Number(r.a_id), username: r.a_name }, b: { id: Number(r.b_id), username: r.b_name } })) });
}

export async function ownerThread(request, env, ctx, url, params) {
  const owner = await requireOwner(request, env);
  const sql = getDb(env);
  const [t] = await sql`SELECT t.id, a.username AS a_name, b.username AS b_name FROM dm_threads t
                          JOIN users a ON a.id = t.user_a JOIN users b ON b.id = t.user_b WHERE t.id = ${Number(params.id)}`;
  if (!t) throw new HttpError(404, "That conversation doesn't exist.");
  const rows = await sql`SELECT m.id, m.body, m.via, m.created_at, u.username FROM dm_messages m LEFT JOIN users u ON u.id = m.sender_id
                          WHERE m.thread_id = ${t.id} ORDER BY m.id DESC LIMIT 300`;
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${owner.id}, 'dm.read', ${JSON.stringify({ between: [t.a_name, t.b_name] })}::jsonb)`;
  return json({ ok: true, between: [t.a_name, t.b_name],
    messages: rows.reverse().map((m) => ({ id: Number(m.id), from: m.username || "?", body: m.body, via: m.via, at: m.created_at })) });
}

// ---------- the game: /dm <player> <message> ----------
export async function pluginDm(request, env) {
  await checkPlugin(request, env);
  const b = await readJson(request);
  const sql = getDb(env);
  const fromXuid = String(b.fromXuid || "");
  const toName = String(b.to || "").trim().toLowerCase();
  const [fromRow] = await sql`SELECT u.id FROM players p JOIN users u ON u.mc_uuid = p.uuid WHERE p.xuid = ${fromXuid}`;
  if (!fromRow) return json({ ok: false, message: "Link your account first: type /link and follow the steps on galaxymc.us." });
  const targets = await sql`
    SELECT u.id FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
     WHERE lower(u.username) = ${toName} OR lower(p.gamertag) = ${toName}
     UNION SELECT u.id FROM users u WHERE lower(u.username) LIKE ${toName.replace(/[\\%_]/g, (c) => "\\" + c) + "%"}
     LIMIT 2`;
  if (!targets.length) return json({ ok: false, message: `No community member called ${b.to}. They need to link their account on galaxymc.us first.` });
  const from = await loadUser(sql, fromRow.id);
  const to = await loadUser(sql, targets[0].id);
  try {
    const msg = await sendDm(env, sql, from, to, b.text, "game");
    return json({ ok: true, to: to.username, toXuid: to.xuid ? String(to.xuid) : null, text: msg.body });
  } catch (e) {
    return json({ ok: false, message: e.message });
  }
}

// Edit your own DM, only while the other person hasn't read it yet.
export async function editMessage(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const [m] = await sql`
    SELECT m.id, m.sender_id, m.read_at, t.user_a, t.user_b FROM dm_messages m JOIN dm_threads t ON t.id = m.thread_id WHERE m.id = ${Number(params.id)}`;
  if (!m) throw new HttpError(404, "That message no longer exists.");
  if (Number(m.sender_id) !== Number(me.id)) throw new HttpError(403, "You can only edit your own messages.");
  if (m.read_at) throw new HttpError(409, "They've already read this message, so it can't be edited.");
  const from = await loadUser(sql, me.id);
  if (from.muted_until && new Date(from.muted_until) > new Date()) throw new HttpError(403, "You're muted, so you can't edit messages right now.");
  const text = clean(body.body);
  if (!text) throw new HttpError(400, "Type a message first.");
  const words = compileWordList(await sql`SELECT word, match FROM filter_words`);
  const fromPerms = { perms: await permsOfUser(env, sql, from.id) };
  const check = checkMessage(text, words, { allowLinks: fromPerms.perms.includes("post_links"), maxLength: maxLengthFor(fromPerms) });
  if (!check.ok) throw new HttpError(400, check.message);
  const [done] = await sql`UPDATE dm_messages SET body = ${check.text}, edited_at = now() WHERE id = ${m.id} AND read_at IS NULL RETURNING id, edited_at`;
  if (!done) throw new HttpError(409, "They've just read this message, so it can't be edited any more.");
  const other = Number(m.user_a) === Number(me.id) ? Number(m.user_b) : Number(m.user_a);
  await notify(env, { type: "dm_edit", id: Number(m.id), body: check.text, editedAt: done.edited_at, from: Number(me.id), to: other });
  return json({ ok: true, body: check.text, editedAt: done.edited_at });
}
