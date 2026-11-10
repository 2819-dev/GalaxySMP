// Support: private live chat between a player and staff (tickets).
// Players open tickets from the Support channel; staff handle them in the panel's Tickets tab,
// set status (open / waiting / resolved / closed), priority (low / normal / high / urgent),
// a label (question, bug, report, appeal, store, other) and who's handling it.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { hubStub } from "./chat.js";
import { headUrlFor } from "./heads.js";
import { toPlugin } from "./economy.js";

const STAFF = 50;
const STATUSES = ["open", "waiting", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const LABELS = ["question", "bug", "report", "appeal", "store", "other"];
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, max);
const isStaff = (u) => Number(u.role_power) >= STAFF;

async function filterText(sql, text) {
  const words = await sql`SELECT word, match FROM filter_words`;
  const list = compileWordList(words);
  const check = checkMessage(text.replace(/\n+/g, " ").toLowerCase(), list);
  if (!check.ok) throw new HttpError(400, check.message || "That isn't allowed.");
}

// Tell the ticket's player and every staff member (live update, no page refresh).
async function notify(env, ticket) {
  try {
    await hubStub(env).fetch("https://hub/internal/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "ticket", ticketId: Number(ticket.id), ownerId: Number(ticket.user_id), status: ticket.status }),
    });
  } catch { /* live update is best effort */ }
}

function ticketOut(t) {
  return {
    id: Number(t.id), subject: t.subject, status: t.status, priority: t.priority, label: t.label,
    createdAt: t.created_at, updatedAt: t.updated_at, lastMessageAt: t.last_message_at,
    userUnread: t.user_unread, staffUnread: t.staff_unread,
    user: t.username ? { id: Number(t.user_id), username: t.username, head: headUrlFor(t) } : undefined,
    assignedTo: t.assigned_name || null, preview: t.preview || null,
  };
}

const TICKET_SELECT = (sql) => sql`
  SELECT t.*, u.username, p.xuid, p.head_at, p.gamerpic_at, a.username AS assigned_name,
         (SELECT body FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS preview
    FROM tickets t JOIN users u ON u.id = t.user_id
    LEFT JOIN players p ON p.uuid = u.mc_uuid
    LEFT JOIN users a ON a.id = t.assigned_to`;

async function loadTicket(sql, id, user) {
  const rows = await sql`
    SELECT t.*, u.username, p.xuid, p.head_at, p.gamerpic_at, a.username AS assigned_name
      FROM tickets t JOIN users u ON u.id = t.user_id
      LEFT JOIN players p ON p.uuid = u.mc_uuid
      LEFT JOIN users a ON a.id = t.assigned_to
     WHERE t.id = ${id}`;
  const t = rows[0];
  if (!t || (Number(t.user_id) !== Number(user.id) && !isStaff(user))) throw new HttpError(404, "That ticket doesn't exist.");
  return t;
}

async function detail(sql, t, viewer) {
  const msgs = await sql`
    SELECT m.id, m.body, m.from_staff, m.created_at, u.username, p.xuid, p.head_at, p.gamerpic_at
      FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN players p ON p.uuid = u.mc_uuid
     WHERE m.ticket_id = ${t.id} ORDER BY m.id`;
  // reading clears the unread counter for whoever is looking
  if (Number(t.user_id) === Number(viewer.id) && t.user_unread) await sql`UPDATE tickets SET user_unread = 0 WHERE id = ${t.id}`;
  else if (isStaff(viewer) && Number(t.user_id) !== Number(viewer.id) && t.staff_unread) await sql`UPDATE tickets SET staff_unread = 0 WHERE id = ${t.id}`;
  return {
    ok: true,
    ticket: ticketOut(t),
    messages: msgs.map((m) => ({
      id: Number(m.id), body: m.body, fromStaff: m.from_staff, at: m.created_at, author: m.username || "Staff",
      head: headUrlFor(m),
    })),
  };
}

// ---------- players ----------
export async function myTickets(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const rows = await sql`
    SELECT t.*, (SELECT body FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS preview
      FROM tickets t WHERE t.user_id = ${user.id} ORDER BY (t.status IN ('resolved', 'closed')), t.last_message_at DESC LIMIT 50`;
  return json({ ok: true, tickets: rows.map(ticketOut) });
}

export async function createTicket(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const subject = clean(body.subject, 80);
  const text = clean(body.body, 500);
  const label = LABELS.includes(body.label) ? body.label : "question";
  if (subject.length < 3) throw new HttpError(400, "Give your ticket a short title.");
  if (!text) throw new HttpError(400, "Tell staff what you need help with.");
  const sql = getDb(env);
  await filterText(sql, `${subject} ${text}`);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM tickets WHERE user_id = ${user.id} AND status IN ('open', 'waiting')`;
  if (n >= 3) throw new HttpError(429, "You already have 3 open tickets. Please wait for staff to answer those first.");
  const [{ recent }] = await sql`SELECT count(*)::int AS recent FROM tickets WHERE user_id = ${user.id} AND created_at > now() - interval '1 hour'`;
  if (recent >= 5) throw new HttpError(429, "You've opened a lot of tickets. Please wait a while.");
  const [t] = await sql`INSERT INTO tickets (user_id, subject, label, staff_unread) VALUES (${user.id}, ${subject}, ${label}, 1) RETURNING *`;
  await sql`INSERT INTO ticket_messages (ticket_id, user_id, body) VALUES (${t.id}, ${user.id}, ${text})`;
  await notify(env, t);
  // staff who are playing get a message in game too (older plugins ignore it)
  try { await toPlugin(env, { type: "staff_alert", text: `New support ticket from ${user.username}: ${subject}. Answer it on galaxymc.us (Panel > Tickets).` }); } catch { /* best effort */ }
  return json({ ok: true, id: Number(t.id) });
}

export async function getTicket(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const t = await loadTicket(sql, Number(params.id), user);
  return json(await detail(sql, t, user));
}

export async function postMessage(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const text = clean(body.body, 500);
  if (!text) throw new HttpError(400, "Type a message first.");
  const sql = getDb(env);
  const t = await loadTicket(sql, Number(params.id), user);
  const mine = Number(t.user_id) === Number(user.id);
  const asStaff = !mine && isStaff(user);
  if (t.status === "closed" && !asStaff) throw new HttpError(400, "This ticket is closed. Open a new one if you still need help.");
  if (!asStaff) {
    await filterText(sql, text);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM ticket_messages WHERE user_id = ${user.id} AND created_at > now() - interval '1 minute'`;
    if (n >= 8) throw new HttpError(429, "You're sending messages too fast.");
  }
  await sql`INSERT INTO ticket_messages (ticket_id, user_id, from_staff, body) VALUES (${t.id}, ${user.id}, ${asStaff}, ${text})`;
  const [updated] = asStaff
    ? await sql`UPDATE tickets SET last_message_at = now(), updated_at = now(), user_unread = user_unread + 1,
                  status = CASE WHEN status = 'open' THEN 'waiting' ELSE status END,
                  assigned_to = coalesce(assigned_to, ${user.id}) WHERE id = ${t.id} RETURNING *`
    : await sql`UPDATE tickets SET last_message_at = now(), updated_at = now(), staff_unread = staff_unread + 1,
                  status = CASE WHEN status IN ('waiting', 'resolved') THEN 'open' ELSE status END WHERE id = ${t.id} RETURNING *`;
  await notify(env, updated);
  return json({ ok: true });
}

export async function closeTicket(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const t = await loadTicket(sql, Number(params.id), user);
  const [updated] = await sql`UPDATE tickets SET status = 'closed', updated_at = now() WHERE id = ${t.id} RETURNING *`;
  await sql`INSERT INTO ticket_messages (ticket_id, user_id, from_staff, body) VALUES (${t.id}, ${user.id}, ${isStaff(user) && Number(t.user_id) !== Number(user.id)}, ${"🔒 Ticket closed."})`;
  await notify(env, updated);
  return json({ ok: true });
}

// ---------- staff ----------
async function requireStaff(request, env) {
  const user = await requireUser(request, env);
  if (!isStaff(user)) throw new HttpError(403, "Only staff can do that.");
  return user;
}

export async function staffTickets(request, env, ctx, url) {
  await requireStaff(request, env);
  const filter = url.searchParams.get("status") || "active";
  const sql = getDb(env);
  const base = TICKET_SELECT(sql);
  const rows = filter === "all"
    ? await sql`${base} ORDER BY t.last_message_at DESC LIMIT 200`
    : filter === "done"
      ? await sql`${base} WHERE t.status IN ('resolved', 'closed') ORDER BY t.updated_at DESC LIMIT 100`
      : await sql`${base} WHERE t.status IN ('open', 'waiting')
                   ORDER BY array_position(ARRAY['urgent','high','normal','low'], t.priority), t.staff_unread > 0 DESC, t.last_message_at DESC LIMIT 200`;
  const [{ open }] = await sql`SELECT count(*)::int AS open FROM tickets WHERE status = 'open'`;
  return json({ ok: true, tickets: rows.map(ticketOut), open, statuses: STATUSES, priorities: PRIORITIES, labels: LABELS });
}

export async function updateTicket(request, env, ctx, url, params) {
  const user = await requireStaff(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const t = await loadTicket(sql, Number(params.id), user);
  const status = STATUSES.includes(body.status) ? body.status : t.status;
  const priority = PRIORITIES.includes(body.priority) ? body.priority : t.priority;
  const label = LABELS.includes(body.label) ? body.label : t.label;
  let assigned = t.assigned_to;
  if (body.assign === "me") assigned = user.id;
  else if (body.assign === "none") assigned = null;
  const [updated] = await sql`UPDATE tickets SET status = ${status}, priority = ${priority}, label = ${label}, assigned_to = ${assigned}, updated_at = now()
                               WHERE id = ${t.id} RETURNING *`;
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'ticket.update',
            ${JSON.stringify({ ticket: Number(t.id), subject: t.subject, status, priority, label })}::jsonb)`;
  await notify(env, updated);
  return json({ ok: true });
}

export async function openTicketCount(sql) {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM tickets WHERE status = 'open'`;
  return n;
}
