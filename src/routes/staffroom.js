// The Staff category in Community: who can see it, and the #Staff Logs feed (moderation actions from the
// website and the game). #Reports uses the existing report lists (Staff Panel > Reports).
import { can } from "../lib/perms.js";
import { isOwner } from "../lib/names.js";
import { getDb } from "../lib/db.js";
import { json, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";

// Member ids that can see the Staff category: ranks with the permission, and the owner.
export async function staffMemberIds(env, sql) {
  const rows = await sql`
    SELECT u.id, u.username, u.platform,
           EXISTS (SELECT 1 FROM players pl JOIN player_ranks x ON x.xuid = pl.xuid JOIN ranks rk ON rk.id = x.rank_id
                    WHERE pl.uuid = u.mc_uuid AND 'staff_chat' = ANY(rk.web_perms)) AS staff
      FROM users u WHERE NOT u.banned`;
  return rows.filter((r) => r.staff || isOwner(env, r.username, r.platform === "bedrock")).map((r) => Number(r.id));
}

// Moderation actions shown in #Staff Logs (everything else stays in the Control Panel's Audit log).
const LOG_ACTIONS = ["message.delete", "user.mute", "user.unmute", "user.ban", "user.unban", "voice.mute", "voice.unmute", "voice.kick",
  "game.warn", "game.mute", "game.unmute", "game.kick", "game.ban", "game.unban", "game.rollback",
  "report.resolve", "report.dismiss", "game_report.resolve", "game_report.dismiss",
  "uploads.remove-banner", "uploads.remove-picture", "uploads.block", "uploads.unblock", "appeal.accepted", "appeal.declined", "server.crash"];

// GET /api/staff-room/logs?before=<id>
export async function staffLogs(request, env, ctx, url) {
  const user = await requireUser(request, env);
  if (!can(user, "staff_chat")) throw new HttpError(403, "Only staff can see this.");
  const before = Number(url.searchParams.get("before")) || null;
  const rows = await getDb(env)`
    SELECT a.id, a.action, a.details, a.created_at, actor.username AS actor, t.username AS target
      FROM audit_log a
      LEFT JOIN users actor ON actor.id = a.actor_id
      LEFT JOIN users t ON t.id = a.target_user_id
     WHERE a.action = ANY(${LOG_ACTIONS}) AND (${before}::bigint IS NULL OR a.id < ${before})
     ORDER BY a.id DESC LIMIT 40`;
  return json({
    ok: true,
    entries: rows.map((r) => ({ id: Number(r.id), action: r.action, actor: r.actor, target: r.target, details: r.details || {}, at: r.created_at })),
    more: rows.length === 40,
  });
}
