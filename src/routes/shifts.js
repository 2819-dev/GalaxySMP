// Staff shifts (like Melonly): clock in, take a break, clock out (on the website or with /shift in game),
// weekly quotas per rank (Control Panel > Ranks), and leave of absence (LOA) requests the owner approves.
// Weeks start Monday 00:00 UTC. Shifts left open for more than 10 hours are closed by themselves.
import { can, permsOfUser } from "../lib/perms.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { checkPlugin } from "./ranks.js";
import { staffMemberIds } from "./staffroom.js";

const MAX_HOURS = 10;
const isManager = (u) => can(u, "admin_panel");
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function weekStart(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

// Seconds worked in a shift so far (breaks don't count).
const SECS = `GREATEST(0, EXTRACT(EPOCH FROM (coalesce(s.ended_at, now()) - s.started_at))::int - s.break_secs
               - CASE WHEN s.ended_at IS NULL AND s.break_started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (now() - s.break_started_at))::int ELSE 0 END)`;

async function quotaOf(sql, userIds) {
  const rows = await sql`
    SELECT u.id, coalesce(max(rk.shift_quota_min), 0)::int AS quota
      FROM users u LEFT JOIN players pl ON pl.uuid = u.mc_uuid LEFT JOIN player_ranks x ON x.xuid = pl.xuid LEFT JOIN ranks rk ON rk.id = x.rank_id
     WHERE u.id = ANY(${userIds}::bigint[]) GROUP BY u.id`;
  return new Map(rows.map((r) => [Number(r.id), r.quota]));
}

async function weekSecs(sql, userIds, from) {
  const rows = await sql.query(`SELECT s.user_id, sum(${SECS})::int AS secs FROM staff_shifts s
                                 WHERE s.user_id = ANY($1::bigint[]) AND s.started_at >= $2 GROUP BY s.user_id`, [userIds, from.toISOString()]);
  return new Map(rows.map((r) => [Number(r.user_id), Number(r.secs)]));
}

async function loaNow(sql, userIds) {
  const rows = await sql`SELECT user_id, ends_on FROM staff_loa WHERE status = 'approved' AND user_id = ANY(${userIds}::bigint[])
                          AND starts_on <= (now() AT TIME ZONE 'UTC')::date AND ends_on >= (now() AT TIME ZONE 'UTC')::date`;
  return new Map(rows.map((r) => [Number(r.user_id), r.ends_on]));
}

const shiftOut = (s) => s && ({ id: Number(s.id), startedAt: s.started_at, endedAt: s.ended_at, onBreak: Boolean(s.break_started_at) && !s.ended_at,
  breakStartedAt: s.break_started_at, secs: Number(s.secs), source: s.source, endedBy: s.ended_by });
const loaOut = (l) => ({ id: Number(l.id), userId: Number(l.user_id), username: l.username, starts: l.starts_on, ends: l.ends_on, reason: l.reason,
  status: l.status, note: l.note, decidedBy: l.decided_by_name || null, at: l.created_at });

// Clock in / break / back / clock out for a member. Returns a short message.
export async function shiftAction(sql, userId, action, source = "web") {
  const [open] = await sql`SELECT id, break_started_at FROM staff_shifts WHERE user_id = ${userId} AND ended_at IS NULL`;
  if (action === "start") {
    if (open) return { ok: false, message: "You're already on shift." };
    await sql`INSERT INTO staff_shifts (user_id, source) VALUES (${userId}, ${source}) ON CONFLICT DO NOTHING`;
    return { ok: true, message: "You're on shift. Have a good one!" };
  }
  if (!open) return { ok: false, message: "You're not on shift." };
  if (action === "break") {
    if (open.break_started_at) return { ok: false, message: "You're already on a break." };
    await sql`UPDATE staff_shifts SET break_started_at = now() WHERE id = ${open.id}`;
    return { ok: true, message: "Break started. Your time is paused." };
  }
  if (action === "resume") {
    if (!open.break_started_at) return { ok: false, message: "You're not on a break." };
    await sql`UPDATE staff_shifts SET break_secs = break_secs + EXTRACT(EPOCH FROM (now() - break_started_at))::int, break_started_at = NULL WHERE id = ${open.id}`;
    return { ok: true, message: "Welcome back. Your time is running again." };
  }
  if (action === "end") {
    const [s] = await sql.query(`UPDATE staff_shifts s SET break_secs = s.break_secs + CASE WHEN s.break_started_at IS NOT NULL
                                    THEN EXTRACT(EPOCH FROM (now() - s.break_started_at))::int ELSE 0 END,
                                    break_started_at = NULL, ended_at = now() WHERE s.id = $1 RETURNING ${SECS} AS secs`, [open.id]);
    const m = Math.round(Number(s?.secs || 0) / 60);
    return { ok: true, message: `Shift ended: ${m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`}. Thanks!` };
  }
  return { ok: false, message: "Unknown action." };
}

async function requireShiftStaff(request, env) {
  const user = await requireUser(request, env);
  if (!can(user, "staff_chat")) throw new HttpError(403, "Shifts are for staff.");
  return user;
}

// GET /api/shifts
export async function overview(request, env) {
  const me = await requireShiftStaff(request, env);
  const sql = getDb(env);
  const from = weekStart();
  const [open] = await sql.query(`SELECT s.*, ${SECS} AS secs FROM staff_shifts s WHERE s.user_id = $1 AND s.ended_at IS NULL`, [me.id]);
  const recent = await sql.query(`SELECT s.*, ${SECS} AS secs FROM staff_shifts s WHERE s.user_id = $1 AND s.ended_at IS NOT NULL ORDER BY s.started_at DESC LIMIT 8`, [me.id]);
  const onDuty = await sql.query(`SELECT s.*, ${SECS} AS secs, u.username FROM staff_shifts s JOIN users u ON u.id = s.user_id
                                   WHERE s.ended_at IS NULL ORDER BY s.started_at`, []);
  const myLoa = await sql`SELECT l.*, d.username AS decided_by_name FROM staff_loa l LEFT JOIN users d ON d.id = l.decided_by
                           WHERE l.user_id = ${me.id} ORDER BY l.starts_on DESC LIMIT 10`;
  const [quota, secs, loa] = await Promise.all([quotaOf(sql, [me.id]), weekSecs(sql, [me.id], from), loaNow(sql, [me.id])]);
  const out = {
    ok: true, weekStart: from, manager: isManager(me),
    me: { shift: shiftOut(open), weekSecs: secs.get(Number(me.id)) || 0, quotaMin: quota.get(Number(me.id)) || 0, loaUntil: loa.get(Number(me.id)) || null },
    onDuty: onDuty.map((s) => ({ ...shiftOut(s), username: s.username, userId: Number(s.user_id) })),
    recent: recent.map(shiftOut), loa: myLoa.map(loaOut),
  };
  if (isManager(me)) {
    const ids = await staffMemberIds(env, sql);
    const [names, q, w, l] = await Promise.all([
      sql`SELECT id, username FROM users WHERE id = ANY(${ids}::bigint[])`, quotaOf(sql, ids), weekSecs(sql, ids, from), loaNow(sql, ids)]);
    const duty = new Map(onDuty.map((s) => [Number(s.user_id), s]));
    out.team = names.map((u) => {
      const id = Number(u.id);
      return { id, username: u.username, weekSecs: w.get(id) || 0, quotaMin: q.get(id) || 0, loaUntil: l.get(id) || null,
        status: duty.has(id) ? (duty.get(id).break_started_at ? "break" : "on") : "off" };
    }).sort((a, b) => a.username.localeCompare(b.username));
    out.requests = (await sql`SELECT l.*, u.username, d.username AS decided_by_name FROM staff_loa l JOIN users u ON u.id = l.user_id
                               LEFT JOIN users d ON d.id = l.decided_by
                              WHERE l.status = 'open' OR l.ends_on >= (now() AT TIME ZONE 'UTC')::date - 7
                              ORDER BY (l.status = 'open') DESC, l.starts_on DESC LIMIT 30`).map(loaOut);
  }
  return json(out, 200, { "Cache-Control": "private, no-store" });
}

// POST /api/shifts/action { action: start | break | resume | end }
export async function action(request, env) {
  const me = await requireShiftStaff(request, env);
  const body = await readJson(request);
  const r = await shiftAction(getDb(env), me.id, String(body.action || ""));
  if (!r.ok) throw new HttpError(409, r.message);
  return json(r);
}

// POST /api/shifts/loa { starts, ends, reason }
export async function requestLoa(request, env) {
  const me = await requireShiftStaff(request, env);
  const body = await readJson(request);
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
  const starts = day(body.starts), ends = day(body.ends);
  if (!starts || !ends) throw new HttpError(400, "Choose the first and last day.");
  if (ends < starts) throw new HttpError(400, "The last day can't be before the first day.");
  if (new Date(ends) - new Date(starts) > 90 * 864e5) throw new HttpError(400, "Leave can be up to 90 days. Ask the owner for longer.");
  if (ends < new Date().toISOString().slice(0, 10)) throw new HttpError(400, "That leave is already over.");
  const reason = clean(body.reason, 300);
  if (reason.length < 3) throw new HttpError(400, "Add a short reason.");
  const sql = getDb(env);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM staff_loa WHERE user_id = ${me.id} AND status = 'open'`;
  if (n >= 3) throw new HttpError(429, "You already have requests waiting for an answer.");
  await sql`INSERT INTO staff_loa (user_id, starts_on, ends_on, reason) VALUES (${me.id}, ${starts}, ${ends}, ${reason})`;
  const { notify } = await import("./notify.js");
  const owners = (await staffMemberIds(env, sql));
  const managers = [];
  for (const id of owners) if (id !== Number(me.id) && (await permsOfUser(env, sql, id)).includes("admin_panel")) managers.push(id);
  if (managers.length) await notify(env, managers, "community", { title: "Leave of absence request", body: `${me.username}: ${starts} to ${ends}`, url: "/community#shifts", tag: "loa" }).catch(() => {});
  return json({ ok: true });
}

// POST /api/shifts/loa/:id { status: approved | declined | cancelled, note }
export async function decideLoa(request, env, ctx, url, params) {
  const me = await requireShiftStaff(request, env);
  const body = await readJson(request);
  const status = ["approved", "declined", "cancelled"].includes(body.status) ? body.status : null;
  if (!status) throw new HttpError(400, "Choose approve or decline.");
  const sql = getDb(env);
  const [l] = await sql`SELECT * FROM staff_loa WHERE id = ${Number(params.id) || 0}`;
  if (!l) throw new HttpError(404, "That request no longer exists.");
  const own = Number(l.user_id) === Number(me.id);
  if (status === "cancelled") {
    if (!own && !isManager(me)) throw new HttpError(403, "You can only cancel your own leave.");
  } else {
    if (!isManager(me)) throw new HttpError(403, "Only Admins can answer leave requests.");
    if (own && !me.owner) throw new HttpError(403, "Someone else has to answer your own request.");
    if (l.status !== "open") throw new HttpError(409, "That request was already answered.");
  }
  await sql`UPDATE staff_loa SET status = ${status}, decided_by = ${me.id}, decided_at = now(), note = ${clean(body.note, 200)} WHERE id = ${l.id}`;
  if (!own) {
    const { notify } = await import("./notify.js");
    await notify(env, [Number(l.user_id)], "community", { title: `Your leave was ${status}`, body: `${l.starts_on} to ${l.ends_on}`, url: "/community#shifts", tag: "loa" }).catch(() => {});
  }
  return json({ ok: true });
}

// POST /api/plugin/shift { xuid, action: start | break | resume | end | status }  (/shift in game)
export async function pluginShift(request, env) {
  await checkPlugin(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const [u] = await sql`SELECT u.id FROM players p JOIN users u ON u.mc_uuid = p.uuid WHERE p.xuid = ${String(body.xuid || "")}`;
  if (!u) return json({ ok: false, message: "Link your account first with /link (galaxymc.us), then you can use /shift." });
  const perms = await permsOfUser(env, sql, u.id);
  if (!perms.includes("staff_chat")) return json({ ok: false, message: "Shifts are for staff." });
  const act = String(body.action || "status");
  if (act === "status") {
    const from = weekStart();
    const [open] = await sql.query(`SELECT s.*, ${SECS} AS secs FROM staff_shifts s WHERE s.user_id = $1 AND s.ended_at IS NULL`, [u.id]);
    const [q, w] = await Promise.all([quotaOf(sql, [u.id]), weekSecs(sql, [u.id], from)]);
    const mins = Math.round((w.get(Number(u.id)) || 0) / 60), quota = q.get(Number(u.id)) || 0;
    const week = `This week: ${Math.floor(mins / 60)} h ${mins % 60} min${quota ? ` of ${Math.round(quota / 60 * 10) / 10} h` : ""}.`;
    return json({ ok: true, onShift: Boolean(open), onBreak: Boolean(open?.break_started_at),
      message: open ? `You're on shift${open.break_started_at ? " (on a break)" : ""}. ${week}` : `You're not on shift. ${week}` });
  }
  return json(await shiftAction(sql, u.id, act, "game"));
}

// Every 5 minutes: close shifts left open for more than 10 hours (counted as 10 hours).
export async function shiftsTick(env, sql) {
  await sql`UPDATE staff_shifts SET ended_at = started_at + make_interval(hours => ${MAX_HOURS}), ended_by = 'auto',
              break_secs = break_secs + CASE WHEN break_started_at IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (started_at + make_interval(hours => ${MAX_HOURS}) - break_started_at))::int) ELSE 0 END,
              break_started_at = NULL
             WHERE ended_at IS NULL AND started_at < now() - make_interval(hours => ${MAX_HOURS})`;
}
