// Moderation: reports, deleting messages, mutes, bans, roles, word filter, audit log.
//
// Who can do what
//   Members:    report messages, delete their own messages
//   Moderators: everything below except bans and roles
//               (delete messages, mute/unmute, handle reports, edit the word filter, read the audit log)
//   Admins:     everything, including bans and role changes
// Staff can only act on people with a LOWER role than their own, and the owners listed in
// OWNER_USERNAMES can never be muted, banned or demoted from the website.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { isOwner } from "../lib/names.js";
import { hubBroadcast } from "./chat.js";

const MOD = 50;
const ADMIN = 100;
export const MUTE_OPTIONS = [10, 60, 1440, 10080, 43200]; // 10 min, 1 h, 1 day, 7 days, 30 days
export const REPORT_REASONS = ["Bad language", "Bullying or harassment", "Personal information", "Spam", "Inappropriate content", "Other"];
const ROLE_IDS = { member: 1, vip: 2, moderator: 3, admin: 4 };

async function requireStaff(request, env, power = MOD) {
  const user = await requireUser(request, env);
  if (Number(user.role_power) < power) {
    throw new HttpError(403, power >= ADMIN ? "Only Admins can do that." : "Only staff can do that.");
  }
  return user;
}

function cleanReason(text, max = 300) {
  return String(text || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

async function loadTarget(sql, userId) {
  const rows = await sql`
    SELECT u.id, u.username, u.platform, u.banned, u.muted_until, r.key AS role, r.power
      FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ${userId}`;
  if (!rows.length) throw new HttpError(404, "That member doesn't exist.");
  return rows[0];
}

// Throws unless `actor` is allowed to take action against `target`.
function assertCanAct(env, actor, target) {
  if (Number(actor.id) === Number(target.id)) throw new HttpError(400, "You can't do that to yourself.");
  if (isOwner(env, target.username, target.platform === "bedrock")) throw new HttpError(403, "Server owners can't be moderated.");
  if (Number(actor.role_power) <= Number(target.power)) throw new HttpError(403, "You can only moderate members with a lower role than yours.");
}

function audit(sql, actorId, action, { userId = null, messageId = null, details = {} } = {}) {
  return sql`INSERT INTO audit_log (actor_id, action, target_user_id, target_message_id, details)
             VALUES (${actorId}, ${action}, ${userId}, ${messageId}, ${JSON.stringify(details)}::jsonb)`;
}

async function openReportCount(sql) {
  const [{ n }] = await sql`SELECT count(DISTINCT message_id)::int AS n FROM reports WHERE status = 'open'`;
  return n;
}

async function notifyReports(env, sql) {
  await hubBroadcast(env, { type: "reports_open", count: await openReportCount(sql), staffOnly: true });
}

// ---------- Members: reports and own deletes ----------
export async function createReport(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const messageId = Number(body.messageId);
  const reason = REPORT_REASONS.includes(body.reason) ? body.reason : "Other";
  const details = cleanReason(body.details);
  const sql = getDb(env);
  const [{ recent }] = await sql`
    SELECT count(*)::int AS recent FROM reports WHERE reporter_id = ${user.id} AND created_at > now() - interval '1 hour'`;
  if (recent >= 15) throw new HttpError(429, "You've sent a lot of reports. Please wait a while before sending more.");
  const msgs = await sql`SELECT user_id FROM messages WHERE id = ${messageId} AND deleted_at IS NULL`;
  if (!msgs.length) throw new HttpError(404, "That message no longer exists.");
  if (Number(msgs[0].user_id) === Number(user.id)) throw new HttpError(400, "You can't report your own message.");
  await sql`
    INSERT INTO reports (message_id, reporter_id, reason)
    VALUES (${messageId}, ${user.id}, ${details ? `${reason}: ${details}` : reason})
    ON CONFLICT (message_id, reporter_id) DO UPDATE SET reason = EXCLUDED.reason, status = 'open', created_at = now()`;
  await notifyReports(env, sql);
  return json({ ok: true, message: "Report sent. Thank you for helping keep GalaxySMP safe." });
}

export async function deleteMessage(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const body = await readJson(request).catch(() => ({}));
  const messageId = Number(params.id);
  const sql = getDb(env);
  const rows = await sql`
    SELECT m.id, m.user_id, m.content, m.channel_id, u.username, u.platform, r.power
      FROM messages m JOIN users u ON u.id = m.user_id JOIN roles r ON r.id = u.role_id
     WHERE m.id = ${messageId} AND m.deleted_at IS NULL`;
  if (!rows.length) throw new HttpError(404, "That message no longer exists.");
  const m = rows[0];
  const own = Number(m.user_id) === Number(user.id);
  if (!own) {
    if (Number(user.role_power) < MOD) throw new HttpError(403, "You can only delete your own messages.");
    assertCanAct(env, user, { id: m.user_id, username: m.username, platform: m.platform, power: m.power });
  }
  const reason = cleanReason(body.reason);
  const queries = [
    sql`UPDATE messages SET deleted_at = now(), deleted_by = ${user.id} WHERE id = ${messageId}`,
    sql`UPDATE reports SET status = 'resolved', resolved_by = ${user.id}, resolved_at = now(), resolution = 'Message deleted'
         WHERE message_id = ${messageId} AND status = 'open'`,
  ];
  if (!own) {
    queries.push(audit(sql, user.id, "message.delete", {
      userId: m.user_id, messageId, details: { reason, content: m.content.slice(0, 500) },
    }));
  }
  await sql.transaction(queries);
  await hubBroadcast(env, { type: "message_deleted", messageId });
  if (!own) await notifyReports(env, sql);
  return json({ ok: true });
}

// ---------- Staff: members ----------
async function memberUpdated(env, sql, userId) {
  const t = await loadTarget(sql, userId);
  await hubBroadcast(env, {
    type: "member_updated",
    member: { id: Number(t.id), username: t.username, role: t.role },
    mutedUntil: t.muted_until && new Date(t.muted_until) > new Date() ? t.muted_until : null,
  });
}

export async function mute(request, env, ctx, url, params) {
  const actor = await requireStaff(request, env);
  const body = await readJson(request);
  const minutes = Number(body.minutes);
  if (!MUTE_OPTIONS.includes(minutes)) throw new HttpError(400, "Choose a mute length.");
  const sql = getDb(env);
  const target = await loadTarget(sql, Number(params.id));
  assertCanAct(env, actor, target);
  const reason = cleanReason(body.reason);
  await sql.transaction([
    sql`UPDATE users SET muted_until = now() + make_interval(mins => ${minutes}), mute_reason = ${reason || null} WHERE id = ${target.id}`,
    audit(sql, actor.id, "user.mute", { userId: target.id, details: { minutes, reason } }),
  ]);
  await memberUpdated(env, sql, target.id);
  return json({ ok: true });
}

export async function unmute(request, env, ctx, url, params) {
  const actor = await requireStaff(request, env);
  const sql = getDb(env);
  const target = await loadTarget(sql, Number(params.id));
  assertCanAct(env, actor, target);
  await sql.transaction([
    sql`UPDATE users SET muted_until = NULL, mute_reason = NULL WHERE id = ${target.id}`,
    audit(sql, actor.id, "user.unmute", { userId: target.id }),
  ]);
  await memberUpdated(env, sql, target.id);
  return json({ ok: true });
}

export async function ban(request, env, ctx, url, params) {
  const actor = await requireStaff(request, env, ADMIN);
  const body = await readJson(request);
  const sql = getDb(env);
  const target = await loadTarget(sql, Number(params.id));
  assertCanAct(env, actor, target);
  const reason = cleanReason(body.reason);
  if (!reason) throw new HttpError(400, "Please give a reason for the ban.");
  await sql.transaction([
    sql`UPDATE users SET banned = true, ban_reason = ${reason} WHERE id = ${target.id}`,
    sql`DELETE FROM sessions WHERE user_id = ${target.id}`,
    audit(sql, actor.id, "user.ban", { userId: target.id, details: { reason } }),
  ]);
  await hubBroadcast(env, { type: "kick", userId: Number(target.id), reason: "Your account has been banned from the community." });
  await hubBroadcast(env, { type: "member_removed", userId: Number(target.id) });
  return json({ ok: true });
}

export async function unban(request, env, ctx, url, params) {
  const actor = await requireStaff(request, env, ADMIN);
  const sql = getDb(env);
  const target = await loadTarget(sql, Number(params.id));
  assertCanAct(env, actor, target);
  await sql.transaction([
    sql`UPDATE users SET banned = false, ban_reason = NULL WHERE id = ${target.id}`,
    audit(sql, actor.id, "user.unban", { userId: target.id }),
  ]);
  return json({ ok: true });
}

export async function setRole(request, env, ctx, url, params) {
  const actor = await requireStaff(request, env, ADMIN);
  const body = await readJson(request);
  const roleId = ROLE_IDS[body.role];
  if (!roleId) throw new HttpError(400, "Unknown role.");
  const sql = getDb(env);
  const target = await loadTarget(sql, Number(params.id));
  assertCanAct(env, actor, target);
  if (target.role === body.role) return json({ ok: true });
  await sql.transaction([
    sql`UPDATE users SET role_id = ${roleId} WHERE id = ${target.id}`,
    audit(sql, actor.id, "user.role", { userId: target.id, details: { from: target.role, to: body.role } }),
  ]);
  await memberUpdated(env, sql, target.id);
  return json({ ok: true });
}

export async function searchMembers(request, env, ctx, url) {
  await requireStaff(request, env);
  const q = cleanReason(url.searchParams.get("q"), 32).toLowerCase();
  const filter = url.searchParams.get("filter") || "all";
  const sql = getDb(env);
  const rows = await sql`
    SELECT u.id, u.username, u.platform, u.banned, u.ban_reason, u.muted_until, u.mute_reason,
           u.created_at, u.last_seen_at, r.key AS role, r.power,
           (SELECT count(*)::int FROM messages m WHERE m.user_id = u.id AND m.deleted_at IS NULL) AS messages,
           (SELECT count(*)::int FROM reports rp JOIN messages m ON m.id = rp.message_id WHERE m.user_id = u.id) AS reported
      FROM users u JOIN roles r ON r.id = u.role_id
     WHERE (${q} = '' OR u.username_lower LIKE '%' || ${q} || '%')
       AND (${filter} = 'all'
            OR (${filter} = 'muted' AND u.muted_until > now())
            OR (${filter} = 'banned' AND u.banned)
            OR (${filter} = 'staff' AND r.power >= 50))
     ORDER BY r.power DESC, lower(u.username)
     LIMIT 100`;
  return json({
    ok: true,
    muteOptions: MUTE_OPTIONS,
    members: rows.map((u) => ({
      id: Number(u.id),
      username: u.username,
      platform: u.platform,
      role: u.role,
      power: Number(u.power),
      owner: isOwner(env, u.username, u.platform === "bedrock"),
      banned: u.banned,
      banReason: u.ban_reason,
      mutedUntil: u.muted_until && new Date(u.muted_until) > new Date() ? u.muted_until : null,
      muteReason: u.mute_reason,
      joined: u.created_at,
      lastSeen: u.last_seen_at,
      messages: u.messages,
      reported: u.reported,
    })),
  });
}

// ---------- Staff: reports ----------
export async function listReports(request, env, ctx, url) {
  await requireStaff(request, env);
  const sql = getDb(env);
  const open = await sql`
    SELECT m.id AS message_id, m.content, m.created_at AS message_at, (m.deleted_at IS NOT NULL) AS deleted,
           c.name AS channel, au.id AS author_id, au.username AS author, ar.key AS author_role,
           count(rp.id)::int AS report_count, min(rp.created_at) AS first_reported,
           json_agg(json_build_object('reporter', ru.username, 'reason', rp.reason, 'at', rp.created_at)
                    ORDER BY rp.created_at) AS reports
      FROM reports rp
      JOIN messages m ON m.id = rp.message_id
      JOIN channels c ON c.id = m.channel_id
      JOIN users au ON au.id = m.user_id
      JOIN roles ar ON ar.id = au.role_id
      JOIN users ru ON ru.id = rp.reporter_id
     WHERE rp.status = 'open'
     GROUP BY m.id, c.name, au.id, ar.key
     ORDER BY min(rp.created_at)
     LIMIT 100`;
  const closed = await sql`
    SELECT DISTINCT ON (m.id) m.id AS message_id, m.content, c.name AS channel, au.username AS author,
           rp.status, rp.resolution, rp.resolved_at, rs.username AS resolved_by
      FROM reports rp
      JOIN messages m ON m.id = rp.message_id
      JOIN channels c ON c.id = m.channel_id
      JOIN users au ON au.id = m.user_id
      LEFT JOIN users rs ON rs.id = rp.resolved_by
     WHERE rp.status <> 'open'
     ORDER BY m.id, rp.resolved_at DESC`;
  closed.sort((a, b) => new Date(b.resolved_at) - new Date(a.resolved_at));
  return json({
    ok: true,
    open: open.map((r) => ({
      messageId: Number(r.message_id),
      content: r.content,
      messageAt: r.message_at,
      deleted: r.deleted,
      channel: r.channel,
      author: { id: Number(r.author_id), username: r.author, role: r.author_role },
      count: r.report_count,
      firstReported: r.first_reported,
      reports: r.reports,
    })),
    closed: closed.slice(0, 30).map((r) => ({
      messageId: Number(r.message_id),
      content: r.content,
      channel: r.channel,
      author: r.author,
      status: r.status,
      resolution: r.resolution,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
    })),
  });
}

export async function resolveReport(request, env, ctx, url, params) {
  const actor = await requireStaff(request, env);
  const body = await readJson(request);
  const messageId = Number(params.id);
  const outcome = body.outcome === "dismissed" ? "dismissed" : "resolved";
  const note = cleanReason(body.note, 200) || (outcome === "dismissed" ? "No action needed" : "Handled");
  const sql = getDb(env);
  const results = await sql.transaction([
    sql`UPDATE reports SET status = ${outcome}, resolved_by = ${actor.id}, resolved_at = now(), resolution = ${note}
         WHERE message_id = ${messageId} AND status = 'open' RETURNING id`,
    audit(sql, actor.id, outcome === "dismissed" ? "report.dismiss" : "report.resolve", {
      messageId, userId: null, details: { note },
    }),
  ]);
  if (!results[0].length) throw new HttpError(404, "There are no open reports for that message.");
  await notifyReports(env, sql);
  return json({ ok: true });
}

// ---------- Staff: word filter ----------
export async function listWords(request, env) {
  await requireStaff(request, env);
  const sql = getDb(env);
  const rows = await sql`
    SELECT w.id, w.word, w.match, w.created_at, u.username AS added_by
      FROM filter_words w LEFT JOIN users u ON u.id = w.added_by ORDER BY lower(w.word)`;
  return json({ ok: true, words: rows.map((w) => ({ id: w.id, word: w.word, match: w.match, addedBy: w.added_by, createdAt: w.created_at })) });
}

export async function addWord(request, env) {
  const actor = await requireStaff(request, env);
  const body = await readJson(request);
  const word = String(body.word || "").trim().toLowerCase();
  const match = body.match === "contains" ? "contains" : "word";
  if (!/^[\p{L}\p{N}' -]{2,40}$/u.test(word)) throw new HttpError(400, "Words must be 2 to 40 letters or numbers.");
  const sql = getDb(env);
  const rows = await sql`
    INSERT INTO filter_words (word, match, added_by) VALUES (${word}, ${match}, ${actor.id})
    ON CONFLICT (word) DO NOTHING RETURNING id`;
  if (!rows.length) throw new HttpError(409, "That word is already on the list.");
  await audit(sql, actor.id, "filter.add", { details: { word, match } });
  await hubBroadcast(env, { type: "words_changed" });
  return json({ ok: true });
}

export async function removeWord(request, env, ctx, url, params) {
  const actor = await requireStaff(request, env);
  const sql = getDb(env);
  const rows = await sql`DELETE FROM filter_words WHERE id = ${Number(params.id)} RETURNING word, match`;
  if (!rows.length) throw new HttpError(404, "That word isn't on the list.");
  await audit(sql, actor.id, "filter.remove", { details: { word: rows[0].word, match: rows[0].match } });
  await hubBroadcast(env, { type: "words_changed" });
  return json({ ok: true });
}

// ---------- Staff: audit log ----------
export async function listAudit(request, env, ctx, url) {
  await requireStaff(request, env);
  const before = url.searchParams.get("before");
  const sql = getDb(env);
  const rows = await sql.query(
    `SELECT a.id, a.action, a.details, a.created_at, a.target_message_id,
            actor.username AS actor, t.username AS target
       FROM audit_log a
       LEFT JOIN users actor ON actor.id = a.actor_id
       LEFT JOIN users t ON t.id = a.target_user_id
      WHERE ($1::bigint IS NULL OR a.id < $1)
      ORDER BY a.id DESC LIMIT 50`,
    [before ? Number(before) : null]
  );
  return json({
    ok: true,
    entries: rows.map((r) => ({
      id: Number(r.id),
      action: r.action,
      actor: r.actor,
      target: r.target,
      messageId: r.target_message_id ? Number(r.target_message_id) : null,
      details: r.details,
      at: r.created_at,
    })),
    hasMore: rows.length === 50,
  });
}

export async function staffSummary(request, env) {
  const user = await requireStaff(request, env);
  const sql = getDb(env);
  return json({ ok: true, power: Number(user.role_power), openReports: await openReportCount(sql), muteOptions: MUTE_OPTIONS });
}
