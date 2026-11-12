// In-game moderation, shared with the website.
//   /report (players)  -> game_reports, shown in Staff Tools > Reports and in the in-game /mod panel
//   /mod (staff)       -> warnings, mutes, kicks and bans, saved in game_punishments and the audit log
// The Minecraft server enforces mutes and bans itself; the website keeps the shared record.
import { can } from "../lib/perms.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { checkPlugin } from "./ranks.js";
import { hubBroadcast } from "./chat.js";

export const GAME_REPORT_REASONS = ["Cheating or hacking", "Griefing", "Stealing", "Bad language", "Bullying or harassment", "Spam", "Other"];
const KINDS = ["warn", "mute", "unmute", "kick", "ban", "unban"];

const text = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const xuidOf = (v) => (/^\d{1,20}$/.test(String(v ?? "")) ? String(v) : null);
const intOr = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Number(v)) : null);

async function actorFor(sql, xuid) {
  if (!xuid) return null;
  const rows = await sql`SELECT u.id FROM players p JOIN users u ON u.mc_uuid = p.uuid WHERE p.xuid = ${xuid}`;
  return rows[0] ? Number(rows[0].id) : null;
}

function audit(sql, actorId, action, details) {
  return sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${actorId}, ${action}, ${JSON.stringify(details)}::jsonb)`;
}

export async function openGameReportCount(sql) {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM game_reports WHERE status = 'open'`;
  return n;
}

async function notifyStaff(env, sql) {
  const [{ n }] = await sql`SELECT count(DISTINCT message_id)::int AS n FROM reports WHERE status = 'open'`;
  await hubBroadcast(env, { type: "reports_open", count: n + (await openGameReportCount(sql)), staffOnly: true });
}

function reportOut(r) {
  return {
    id: Number(r.id), reporter: r.reporter_name, target: r.target_name, targetXuid: r.target_xuid, reason: r.reason, details: r.details,
    world: r.world, x: r.x, y: r.y, z: r.z, status: r.status, at: r.created_at,
    resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, resolution: r.resolution,
  };
}

// ---------- from the plugin ----------
export async function pluginReport(request, env) {
  await checkPlugin(request, env);
  const b = await readJson(request);
  const reporter = text(b.reporter, 32), target = text(b.target, 32);
  if (!reporter || !target) throw new HttpError(400, "Missing player names.");
  const reason = GAME_REPORT_REASONS.includes(b.reason) ? b.reason : "Other";
  const sql = getDb(env);
  const [row] = await sql`
    INSERT INTO game_reports (reporter_xuid, reporter_name, target_xuid, target_name, reason, details, world, x, y, z)
    VALUES (${xuidOf(b.reporterXuid)}, ${reporter}, ${xuidOf(b.targetXuid)}, ${target}, ${reason}, ${text(b.details, 300)},
            ${text(b.world, 32) || null}, ${intOr(b.x)}, ${intOr(b.y)}, ${intOr(b.z)})
    RETURNING id`;
  await notifyStaff(env, sql);
  return json({ ok: true, id: Number(row.id) });
}

export async function pluginReports(request, env) {
  await checkPlugin(request, env);
  const sql = getDb(env);
  const rows = await sql`SELECT * FROM game_reports WHERE status = 'open' ORDER BY created_at LIMIT 50`;
  return json({ ok: true, reports: rows.map(reportOut) });
}

async function resolveGameReport(env, sql, id, outcome, note, actorId, by) {
  outcome = outcome === "dismissed" ? "dismissed" : "resolved";
  note = text(note, 200) || (outcome === "dismissed" ? "No action needed" : "Handled");
  const [rows] = await sql.transaction([
    sql`UPDATE game_reports SET status = ${outcome}, resolved_by = ${by}, resolved_at = now(), resolution = ${note}
         WHERE id = ${id} AND status = 'open' RETURNING target_name`,
    audit(sql, actorId, outcome === "dismissed" ? "game_report.dismiss" : "game_report.resolve", { by, note, report: id }),
  ]);
  if (!rows.length) throw new HttpError(404, "That report was already handled.");
  await notifyStaff(env, sql);
}

export async function pluginResolveReport(request, env) {
  await checkPlugin(request, env);
  const b = await readJson(request);
  const sql = getDb(env);
  const by = `${text(b.by, 32) || "Staff"} (in game)`;
  try {
    await resolveGameReport(env, sql, Number(b.id), b.outcome, b.note, await actorFor(sql, xuidOf(b.byXuid)), by);
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, message: e.message });
    throw e;
  }
  return json({ ok: true });
}

export async function pluginPunish(request, env) {
  await checkPlugin(request, env);
  const b = await readJson(request);
  const kind = String(b.kind);
  const name = text(b.name, 32);
  const sql = getDb(env);
  const by = `${text(b.by, 32) || "Server"} (in game)`;
  if (kind === "rollback" && name) {  // anti-grief rollback: audit log only
    await audit(sql, await actorFor(sql, xuidOf(b.byXuid)), "game.rollback",
      { by, player: name, blocks: Math.max(0, intOr(b.blocks) || 0), span: text(b.span, 20), reason: text(b.reason, 300) });
    return json({ ok: true });
  }
  if (!KINDS.includes(kind) || !name) throw new HttpError(400, "Bad punishment.");
  const reason = text(b.reason, 300);
  const minutes = intOr(b.minutes);
  await sql.transaction([
    sql`INSERT INTO game_punishments (xuid, name, kind, reason, minutes, by_name, created_at)
        VALUES (${xuidOf(b.xuid)}, ${name}, ${kind}, ${reason}, ${minutes}, ${by},
                ${b.at ? new Date(Number(b.at) * 1000).toISOString() : new Date().toISOString()}::timestamptz)`,
    audit(sql, await actorFor(sql, xuidOf(b.byXuid)), `game.${kind}`, { by, player: name, reason, minutes }),
  ]);
  return json({ ok: true });
}

// ---------- Staff Tools ----------
async function requireMod(request, env) {
  const user = await requireUser(request, env);
  if (!can(user, "handle_reports")) throw new HttpError(403, "Your rank can't handle reports.");
  return user;
}

export async function staffGameReports(request, env) {
  await requireMod(request, env);
  const sql = getDb(env);
  const open = await sql`SELECT * FROM game_reports WHERE status = 'open' ORDER BY created_at LIMIT 100`;
  const closed = await sql`SELECT * FROM game_reports WHERE status <> 'open' ORDER BY resolved_at DESC LIMIT 30`;
  const names = [...new Set(open.map((r) => r.target_name.toLowerCase()))];
  const history = names.length ? await sql`
    SELECT lower(name) AS n, kind, reason, minutes, by_name, created_at FROM game_punishments
     WHERE lower(name) = ANY(${names}) ORDER BY created_at DESC` : [];
  const byName = {};
  for (const h of history) (byName[h.n] ||= []).length < 5 && byName[h.n].push({ kind: h.kind, reason: h.reason, minutes: h.minutes, by: h.by_name, at: h.created_at });
  return json({
    ok: true,
    open: open.map((r) => ({ ...reportOut(r), history: byName[r.target_name.toLowerCase()] || [] })),
    closed: closed.map(reportOut),
  });
}

export async function staffResolveGameReport(request, env, ctx, url, params) {
  const user = await requireMod(request, env);
  const b = await readJson(request);
  await resolveGameReport(env, getDb(env), Number(params.id), b.outcome, b.note, Number(user.id), user.username);
  return json({ ok: true });
}

// ---------- from the website: "Report player" on profiles and member cards ----------
// Goes into the same list as in-game /report, so staff see it in Staff Tools > Reports and in the in-game /mod panel.
export async function webReportPlayer(request, env) {
  const user = await requireUser(request, env);
  const b = await readJson(request);
  const sql = getDb(env);
  const reason = GAME_REPORT_REASONS.includes(b.reason) ? b.reason : "Other";
  // who is reported: a website member (userId) or a player by gamertag (name)
  let target = null;
  if (b.userId) {
    [target] = await sql`SELECT u.id, coalesce(p.gamertag, u.username) AS name, p.xuid FROM users u
                           LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${Number(b.userId) || 0}`;
  } else if (b.name) {
    [target] = await sql`SELECT u.id, p.gamertag AS name, p.xuid FROM players p LEFT JOIN users u ON u.mc_uuid = p.uuid
                          WHERE lower(p.gamertag) = lower(${text(b.name, 32)}) LIMIT 1`;
  }
  if (!target) throw new HttpError(404, "That player couldn't be found.");
  if (target.id && Number(target.id) === Number(user.id)) throw new HttpError(400, "You can't report yourself.");
  const [me] = await sql`SELECT coalesce(p.gamertag, u.username) AS name, p.xuid FROM users u
                          LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  const [{ recent, same }] = await sql`
    SELECT count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS recent,
           count(*) FILTER (WHERE status = 'open' AND lower(target_name) = lower(${target.name}))::int AS same
      FROM game_reports WHERE lower(reporter_name) = lower(${me.name})`;
  if (same) return json({ ok: true, message: "You've already reported this player. Staff will look at it soon." });
  if (recent >= 5) throw new HttpError(429, "You've sent a lot of reports today. Please try again tomorrow, or open a ticket in #support.");
  await sql`INSERT INTO game_reports (reporter_xuid, reporter_name, target_xuid, target_name, reason, details, world)
            VALUES (${me.xuid || null}, ${me.name}, ${target.xuid || null}, ${target.name}, ${reason}, ${text(b.details, 300)}, 'website')`;
  await notifyStaff(env, sql);
  return json({ ok: true, message: "Thanks. Your report was sent to staff." });
}
