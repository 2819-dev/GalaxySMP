// Quiet Mode: slow mode on every chat channel for a while (e.g. 3 hours, one message every 5 minutes per member).
// Staff who can delete messages aren't limited, as with normal slow mode. When it ends (by itself, or turned off),
// each channel goes back to the slow mode it had before. Turned on from the Slow mode button or with /quietmode.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { can } from "../lib/perms.js";
import { hubBroadcast } from "./chat.js";
import { botPost } from "../chat/engage.js";

const KEY = "quiet_mode";
const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

// "5m", "3h", "1h30m", "90s", "2d", or a plain number (minutes). Returns seconds, or null if it can't be read.
export function parseDuration(text) {
  const t = String(text || "").toLowerCase().replace(/\s+/g, "")
    .replace(/(seconds?|secs?)/g, "s").replace(/(minutes?|mins?)/g, "m").replace(/(hours?|hrs?)/g, "h").replace(/days?/g, "d");
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60);
  if (!/^(\d+(\.\d+)?[smhd])+$/.test(t)) return null;
  let total = 0;
  for (const [, n, u] of t.matchAll(/(\d+(?:\.\d+)?)([smhd])/g)) total += Number(n) * UNITS[u];
  return Math.round(total);
}

export function formatDuration(s) {
  s = Math.round(s);
  const parts = [];
  for (const [n, name] of [[86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]]) {
    if (s >= n) { const k = Math.floor(s / n); s -= k * n; parts.push(`${k} ${name}${k === 1 ? "" : "s"}`); }
  }
  return parts.slice(0, 2).join(" ") || "0 seconds";
}

export async function quietState(sql) {
  const [row] = await sql`SELECT value FROM economy_config WHERE key = ${KEY}`;
  const v = row?.value;
  return v && v.until && new Date(v.until) > new Date() ? v : null;
}
const publicState = (q) => (q ? { on: true, until: q.until, seconds: q.seconds, by: q.by || null } : { on: false });

async function announce(env, sql, text) {
  const m = await botPost(sql, { slug: "chat", kind: "bot", content: text });
  if (m) await hubBroadcast(env, { type: "message", message: m });
}

// Turns Quiet Mode on (or changes it while it's on). Returns the new state.
export async function startQuiet(env, sql, user, { duration, gap }) {
  const length = parseDuration(duration);
  const seconds = parseDuration(gap);
  if (!length) throw new HttpError(400, 'Say how long it lasts, like "30m", "3h" or "1d".');
  if (!seconds) throw new HttpError(400, 'Say how long members wait between messages, like "30s", "5m" or "1h".');
  if (length < 60 || length > 7 * 86400) throw new HttpError(400, "Quiet Mode can last from 1 minute to 7 days.");
  if (seconds < 5 || seconds > 86400) throw new HttpError(400, "The wait between messages can be from 5 seconds to 1 day.");
  const old = await quietState(sql);
  const chans = await sql`SELECT id, slow_seconds FROM channels WHERE kind = 'text' AND NOT hidden`;
  // remember each channel's own slow mode (from before Quiet Mode, if it was already on)
  const prev = old?.prev || Object.fromEntries(chans.map((c) => [String(c.id), Number(c.slow_seconds || 0)]));
  const until = new Date(Date.now() + length * 1000).toISOString();
  const state = { until, seconds, prev, by: user.username, byId: Number(user.id) };
  await sql`INSERT INTO economy_config (key, value, updated_by) VALUES (${KEY}, ${JSON.stringify(state)}::jsonb, ${user.username})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  // the stricter of the two: a channel that already had a longer slow mode keeps it
  for (const c of chans) {
    const s = Math.max(seconds, Number(prev[String(c.id)] || 0));
    await sql`UPDATE channels SET slow_seconds = ${s} WHERE id = ${c.id}`;
    await hubBroadcast(env, { type: "slowmode", channelId: Number(c.id), seconds: s });
  }
  await hubBroadcast(env, { type: "quiet_mode", ...publicState(state) });
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'chat.quiet_on', ${JSON.stringify({ length, seconds, until })}::jsonb)`;
  await announce(env, sql, `🌙 **Quiet Mode is on** for ${formatDuration(length)}. Everyone can send one message every ${formatDuration(seconds)} in each channel. Thanks for keeping the chat calm!`);
  return { state: publicState(state), length };
}

// Turns Quiet Mode off and puts each channel's slow mode back. by: who (null when it ran out).
export async function endQuiet(env, sql, by = null) {
  const [row] = await sql`SELECT value FROM economy_config WHERE key = ${KEY}`;
  const q = row?.value;
  if (!q) return false;
  // put each channel back first (only channels still on the Quiet Mode setting: staff may have changed one by hand)
  for (const [id, before] of Object.entries(q.prev || {})) {
    const was = Math.max(0, Math.round(Number(before) || 0));
    const [c] = await sql`UPDATE channels SET slow_seconds = ${was}::int
                           WHERE id = ${Number(id)}::int AND slow_seconds = ${Math.max(Number(q.seconds) || 0, was)}::int RETURNING id`;
    if (c) await hubBroadcast(env, { type: "slowmode", channelId: Number(id), seconds: was });
  }
  const [gone] = await sql`DELETE FROM economy_config WHERE key = ${KEY} RETURNING key`;
  if (!gone) return false;   // someone else ended it at the same moment
  await hubBroadcast(env, { type: "quiet_mode", on: false });
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${by?.id || null}, 'chat.quiet_off', ${JSON.stringify({ by: by?.username || "timer" })}::jsonb)`;
  await announce(env, sql, "☀️ **Quiet Mode has ended.** Chat is back to normal.");
  return true;
}

const allowed = (user) => can(user, "admin_panel");

// GET /api/chat/quiet
export async function getQuiet(request, env) {
  await requireUser(request, env);
  return json({ ok: true, quiet: publicState(await quietState(getDb(env))) });
}

// POST /api/chat/quiet { duration: "3h", gap: "5m" } or { off: true }   (Admin Panel access)
export async function setQuiet(request, env) {
  const user = await requireUser(request, env);
  if (!allowed(user)) throw new HttpError(403, "Only Admins can use Quiet Mode.");
  const body = await readJson(request);
  const sql = getDb(env);
  if (body.off) {
    const was = await endQuiet(env, sql, user);
    return json({ ok: true, quiet: { on: false }, message: was ? "Quiet Mode is off. Each channel's slow mode is back to how it was." : "Quiet Mode wasn't on." });
  }
  const { state, length } = await startQuiet(env, sql, user, body);
  return json({ ok: true, quiet: state, message: `Quiet Mode is on for ${formatDuration(length)}: one message every ${formatDuration(state.seconds)}.` });
}

// Every minute (features tick): end it when the time is up.
export async function tick(env) {
  const sql = getDb(env);
  const [row] = await sql`SELECT value FROM economy_config WHERE key = ${KEY}`;
  if (row?.value?.until && new Date(row.value.until) <= new Date()) await endQuiet(env, sql, null);
}
