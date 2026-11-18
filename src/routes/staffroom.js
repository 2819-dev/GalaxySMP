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

// ---------- Staff to-do list (in #Ideas & To-Do) ----------
// GET  /api/staff/todos                      open and recently finished tasks, plus the staff you can assign
// POST /api/staff/todos { action, ... }      create { title, notes, assigneeId, sourceMessage } | update { id, title, notes, assigneeId }
//                                            | toggle { id } | delete { id }
async function todoStaff(request, env) {
  const { requireUser } = await import("../lib/auth.js");
  const { can } = await import("../lib/perms.js");
  const { HttpError } = await import("../lib/http.js");
  const user = await requireUser(request, env);
  if (!can(user, "staff_chat")) throw new HttpError(403, "The to-do list is for staff.");
  return user;
}
const todoOut = (t) => ({ id: Number(t.id), title: t.title, notes: t.notes || "", done: t.done, assigneeId: t.assignee_id ? Number(t.assignee_id) : null,
  assignee: t.assignee || null, by: t.by || null, doneBy: t.done_by_name || null, doneAt: t.done_at, at: t.created_at, sourceMessage: t.source_message ? Number(t.source_message) : null });

export async function todos(request, env) {
  await todoStaff(request, env);
  const { json } = await import("../lib/http.js");
  const sql = getDb(env);
  const rows = await sql`
    SELECT t.*, a.username AS assignee, c.username AS by, d.username AS done_by_name FROM staff_todos t
      LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users c ON c.id = t.created_by LEFT JOIN users d ON d.id = t.done_by
     WHERE NOT t.done OR t.done_at > now() - interval '14 days' ORDER BY t.done, t.created_at DESC LIMIT 200`;
  const ids = await staffMemberIds(env, sql);
  const staff = ids.length ? await sql`SELECT id, username FROM users WHERE id = ANY(${ids}::bigint[]) ORDER BY lower(username)` : [];
  return json({ ok: true, todos: rows.map(todoOut), staff: staff.map((s) => ({ id: Number(s.id), username: s.username })) });
}

export async function todoAction(request, env) {
  const user = await todoStaff(request, env);
  const { json, readJson, HttpError } = await import("../lib/http.js");
  const b = await readJson(request);
  const sql = getDb(env);
  const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);
  const staffIds = new Set(await staffMemberIds(env, sql));
  const assignee = b.assigneeId ? Number(b.assigneeId) : null;
  if (assignee && !staffIds.has(assignee)) throw new HttpError(400, "Tasks can only be assigned to staff.");
  const tell = async (id, title) => {
    if (!id || id === Number(user.id)) return;
    const { notify } = await import("./notify.js");
    await notify(env, [id], "mentions", { title: `${user.username} gave you a task`, body: title, url: "/community#ideas-todo", tag: `todo-${title.slice(0, 20)}` }).catch(() => {});
  };
  if (b.action === "create") {
    const title = clean(b.title, 200);
    if (!title) throw new HttpError(400, "Write what needs doing.");
    await sql`INSERT INTO staff_todos (title, notes, assignee_id, created_by, source_message) VALUES (${title}, ${clean(b.notes, 1000) || null}, ${assignee}, ${user.id}, ${Number(b.sourceMessage) || null})`;
    await tell(assignee, title);
    return json({ ok: true, message: "Task added." });
  }
  const id = Number(b.id) || 0;
  const [t] = await sql`SELECT * FROM staff_todos WHERE id = ${id}`;
  if (!t) throw new HttpError(404, "That task is gone.");
  if (b.action === "update") {
    const title = clean(b.title, 200) || t.title;
    await sql`UPDATE staff_todos SET title = ${title}, notes = ${clean(b.notes, 1000) || null}, assignee_id = ${assignee} WHERE id = ${id}`;
    if (assignee && assignee !== Number(t.assignee_id)) await tell(assignee, title);
    return json({ ok: true, message: "Saved." });
  }
  if (b.action === "toggle") {
    await sql`UPDATE staff_todos SET done = NOT done, done_by = CASE WHEN done THEN NULL ELSE ${user.id}::bigint END,
                done_at = CASE WHEN done THEN NULL ELSE now() END WHERE id = ${id}`;
    return json({ ok: true, message: t.done ? "Moved back to the list." : "Done! Nice work." });
  }
  if (b.action === "delete") {
    await sql`DELETE FROM staff_todos WHERE id = ${id}`;
    return json({ ok: true, message: "Task removed." });
  }
  throw new HttpError(400, "Unknown action.");
}
