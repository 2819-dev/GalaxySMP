// #Meet The Team: the staff (Moderators, Admins and the owner) with their picture, role and a bio they write.
// #Applications: members apply to become a Moderator; only the owner sees applications, chats with the
// applicant, and accepts (they become a Moderator on the website) or declines.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { isOwner } from "../lib/names.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { headUrlFor } from "./heads.js";
import { notify } from "./notify.js";
import { hubBroadcast } from "./chat.js";
import { voiceEvent } from "./voice.js";
import { postTimeline } from "./feed.js";

const STAFF = 50;
const MOD_ROLE_ID = 3;
export const QUESTIONS = [
  { id: "why", q: "Why do you want to be a Moderator on GalaxySMP?", min: 40 },
  { id: "time", q: "How much do you play each week, and at what times (your time zone)?", min: 5 },
  { id: "situation", q: "Two players are arguing and calling each other names in chat. What do you do?", min: 30 },
  { id: "experience", q: "Have you helped run or moderate a server or community before? Tell us about it.", min: 2 },
  { id: "extra", q: "Anything else you'd like us to know? (optional)", min: 0 },
];

const ownerOf = (env, u) => isOwner(env, u.username, u.platform === "bedrock");
async function words(sql) { return compileWordList(await sql`SELECT word, match FROM filter_words`); }
function clean(raw, list, max) {
  const text = String(raw ?? "").replace(/\r/g, "").trim().slice(0, max);
  if (!text) return "";
  const c = checkMessage(text, list, { allowLinks: false, maxLength: max });
  if (!c.ok) throw new HttpError(400, c.message);
  return c.text;
}

// ---------- Meet The Team ----------
// GET /api/team
export async function listTeam(request, env) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  const rows = await sql`
    SELECT u.id, u.username, u.platform, u.team_bio, u.created_at, r.power, r.name AS role_name, r.color AS role_color,
           pl.xuid, pl.head_at, pl.gamerpic_at, pl.gamertag, (pl.online_at > now() - interval '150 seconds') AS in_game
      FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN players pl ON pl.uuid = u.mc_uuid
     WHERE NOT u.banned AND r.power >= ${STAFF} ORDER BY r.power DESC, u.created_at`;
  const meOwner = ownerOf(env, me);
  const team = rows.map((u) => {
    const owner = ownerOf(env, u);
    return {
      id: Number(u.id), name: u.gamertag || u.username, username: u.username, role: owner ? "Owner" : u.role_name, owner,
      color: u.role_color, head: headUrlFor(u), bio: u.team_bio || "", inGame: Boolean(u.in_game), since: u.created_at,
      profile: u.gamertag ? `/player/${encodeURIComponent(u.gamertag)}` : null,
      canEdit: Number(u.id) === Number(me.id) || meOwner, isMe: Number(u.id) === Number(me.id),
    };
  }).sort((a, b) => Number(b.owner) - Number(a.owner));
  return json({ ok: true, team });
}

// POST /api/team/bio { userId?, bio }  (staff: their own; the owner: anyone's)
export async function saveBio(request, env) {
  const me = await requireUser(request, env);
  const b = await readJson(request);
  const target = Number(b.userId) || Number(me.id);
  if (target !== Number(me.id) && !ownerOf(env, me)) throw new HttpError(403, "You can only edit your own bio.");
  const sql = getDb(env);
  const [u] = await sql`SELECT u.id, r.power FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ${target}`;
  if (!u || (Number(u.power) < STAFF && !ownerOf(env, me))) throw new HttpError(403, "Only staff are on the team page.");
  const bio = clean(b.bio, await words(sql), 400);
  await sql`UPDATE users SET team_bio = ${bio || null} WHERE id = ${target}`;
  return json({ ok: true });
}

// ---------- Applications ----------
const appOut = (a) => ({
  id: Number(a.id), role: a.role, status: a.status, answers: a.answers, createdAt: a.created_at, decidedAt: a.decided_at,
  user: a.username ? { id: Number(a.user_id), username: a.username, head: headUrlFor(a), profile: a.gamertag ? `/player/${encodeURIComponent(a.gamertag)}` : null,
    since: a.user_since, playtime: a.playtime_s == null ? null : Number(a.playtime_s) } : undefined,
  unread: a.owner_unread,
});
async function messages(sql, id) {
  return (await sql`SELECT id, from_owner, body, created_at FROM staff_application_messages WHERE application_id = ${id} ORDER BY id`)
    .map((m) => ({ id: Number(m.id), fromOwner: m.from_owner, body: m.body, at: m.created_at }));
}

// GET /api/applications?status=open  -> the owner: everyone's; others: their own
export async function listApplications(request, env, ctx, url) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  if (ownerOf(env, me)) {
    const status = ["open", "accepted", "declined", "withdrawn"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "open";
    const rows = await sql`
      SELECT a.*, u.username, u.created_at AS user_since, pl.xuid, pl.head_at, pl.gamerpic_at, pl.gamertag, pl.playtime_s
        FROM staff_applications a JOIN users u ON u.id = a.user_id LEFT JOIN players pl ON pl.uuid = u.mc_uuid
       WHERE a.status = ${status} ORDER BY a.last_at DESC LIMIT 100`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM staff_applications WHERE status = 'open'`;
    return json({ ok: true, owner: true, open: n, questions: QUESTIONS, applications: rows.map(appOut) });
  }
  const [mine] = await sql`SELECT * FROM staff_applications WHERE user_id = ${me.id} ORDER BY id DESC LIMIT 1`;
  if (mine?.user_unread) await sql`UPDATE staff_applications SET user_unread = 0 WHERE id = ${mine.id}`;
  const staff = Number(me.role_power) >= STAFF;
  const waitDays = mine && mine.status === "declined" ? Math.ceil(14 - (Date.now() - new Date(mine.decided_at)) / 864e5) : 0;
  return json({
    ok: true, owner: false, questions: QUESTIONS, staff,
    canApply: !staff && (!mine || mine.status === "withdrawn" || (mine.status === "declined" && waitDays <= 0)),
    waitDays: Math.max(0, waitDays),
    application: mine ? { ...appOut(mine), messages: await messages(sql, mine.id) } : null,
  });
}

// POST /api/applications { answers: { why, time, situation, experience, extra } }
export async function createApplication(request, env) {
  const me = await requireUser(request, env);
  if (Number(me.role_power) >= STAFF) throw new HttpError(400, "You're already on the staff team.");
  if (me.muted_until && new Date(me.muted_until) > new Date()) throw new HttpError(403, "You can't apply while you're muted.");
  await rateLimit(env, "AUTH_LIMITER", `apply:${me.id}`);
  const sql = getDb(env);
  const [mine] = await sql`SELECT status, decided_at FROM staff_applications WHERE user_id = ${me.id} ORDER BY id DESC LIMIT 1`;
  if (mine?.status === "open") throw new HttpError(409, "You already have an application waiting.");
  if (mine?.status === "accepted") throw new HttpError(409, "Your application was already accepted.");
  if (mine?.status === "declined" && Date.now() - new Date(mine.decided_at) < 14 * 864e5) throw new HttpError(429, "You can apply again 2 weeks after your last application.");
  const body = await readJson(request);
  const list = await words(sql);
  const answers = {};
  for (const q of QUESTIONS) {
    const a = clean(body.answers?.[q.id], list, 1000);
    if (a.length < q.min) throw new HttpError(400, q.min > 10 ? `Please answer "${q.q}" in a bit more detail.` : `Please answer "${q.q}"`);
    answers[q.id] = a;
  }
  const [a] = await sql`INSERT INTO staff_applications (user_id, answers) VALUES (${me.id}, ${JSON.stringify(answers)}::jsonb) RETURNING id`;
  const owners = (await sql`SELECT id, username, platform FROM users WHERE NOT banned`).filter((u) => ownerOf(env, u)).map((u) => Number(u.id));
  if (owners.length) await notify(env, owners, null, { title: "New Moderator application", body: `${me.username} applied to be a Moderator.`, url: "/community#applications", tag: "applications" }).catch(() => {});
  return json({ ok: true, id: Number(a.id) });
}

async function loadApp(sql, id) {
  const [a] = await sql`
    SELECT a.*, u.username, u.created_at AS user_since, pl.xuid, pl.head_at, pl.gamerpic_at, pl.gamertag, pl.playtime_s
      FROM staff_applications a JOIN users u ON u.id = a.user_id LEFT JOIN players pl ON pl.uuid = u.mc_uuid
     WHERE a.id = ${Number(id) || 0}`;
  if (!a) throw new HttpError(404, "That application no longer exists.");
  return a;
}

// GET /api/applications/:id  (the owner)
export async function getApplication(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  if (!ownerOf(env, me)) throw new HttpError(403, "Only the owner can read applications.");
  const sql = getDb(env);
  const a = await loadApp(sql, params.id);
  await sql`UPDATE staff_applications SET owner_unread = 0 WHERE id = ${a.id}`;
  return json({ ok: true, application: { ...appOut(a), messages: await messages(sql, a.id) } });
}

// POST /api/applications/:id/messages { body }  (the owner, or the applicant)
export async function appMessage(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  const a = await loadApp(sql, params.id);
  const owner = ownerOf(env, me);
  if (!owner && Number(a.user_id) !== Number(me.id)) throw new HttpError(403, "That isn't your application.");
  if (!owner) await rateLimit(env, "AUTH_LIMITER", `appmsg:${me.id}`);
  const body = owner ? String((await readJson(request)).body || "").replace(/\r/g, "").trim().slice(0, 2000) : clean((await readJson(request)).body, await words(sql), 1000);
  if (!body) throw new HttpError(400, "Write a message.");
  await sql`INSERT INTO staff_application_messages (application_id, from_owner, body) VALUES (${a.id}, ${owner}, ${body})`;
  await sql`UPDATE staff_applications SET last_at = now(), owner_unread = owner_unread + ${owner ? 0 : 1}, user_unread = user_unread + ${owner ? 1 : 0} WHERE id = ${a.id}`;
  if (owner) await notify(env, [Number(a.user_id)], null, { title: "Reply to your application", body: body.slice(0, 120), url: "/community#applications", tag: "application" }).catch(() => {});
  return json({ ok: true });
}

// POST /api/applications/:id/decide { status: "accepted" | "declined", message }  (the owner)
export async function decideApplication(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  if (!ownerOf(env, me)) throw new HttpError(403, "Only the owner can decide applications.");
  const sql = getDb(env);
  const a = await loadApp(sql, params.id);
  if (a.status !== "open") throw new HttpError(409, "This application was already answered.");
  const b = await readJson(request);
  const status = b.status === "accepted" ? "accepted" : b.status === "declined" ? "declined" : null;
  if (!status) throw new HttpError(400, "Accept or decline the application.");
  const note = String(b.message || "").replace(/\r/g, "").trim().slice(0, 2000)
    || (status === "accepted" ? "Congratulations, you're now a Moderator on GalaxySMP! Check the Staff Guide in your Staff Panel to get started."
      : "Thanks for applying. We're not adding you to the team right now, but you can apply again in 2 weeks.");
  await sql.transaction([
    sql`UPDATE staff_applications SET status = ${status}, decided_at = now(), last_at = now(), user_unread = user_unread + 1 WHERE id = ${a.id}`,
    sql`INSERT INTO staff_application_messages (application_id, from_owner, body) VALUES (${a.id}, true, ${note})`,
    sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${me.id}, ${`application.${status}`}, ${JSON.stringify({ user: a.username })}::jsonb)`,
  ]);
  if (status === "accepted") {
    await sql`UPDATE users SET role_id = ${MOD_ROLE_ID}, role_from_rank = false WHERE id = ${a.user_id} AND role_id < ${MOD_ROLE_ID}`;
    await hubBroadcast(env, { type: "member_updated", member: { id: Number(a.user_id), username: a.username, role: "moderator" } }).catch(() => {});
    await voiceEvent(env, { type: "role_changed", userId: Number(a.user_id) }).catch(() => {});
    await postTimeline(sql, { kind: "rank", xuid: a.xuid || null, name: a.gamertag || a.username, title: "joined the staff team as a Moderator",
      detail: "Welcome to the team!", icon: "shield", dedupe: `mod:${a.user_id}:${a.id}` });
  }
  await notify(env, [Number(a.user_id)], null, { title: status === "accepted" ? "You're a Moderator!" : "About your application", body: note.slice(0, 120), url: "/community#applications", tag: "application" }).catch(() => {});
  return json({ ok: true, message: status === "accepted" ? `${a.username} is now a Moderator.` : "Application declined." });
}

// POST /api/applications/withdraw  (the applicant)
export async function withdrawApplication(request, env) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  await sql`UPDATE staff_applications SET status = 'withdrawn', decided_at = now() WHERE user_id = ${me.id} AND status = 'open'`;
  return json({ ok: true });
}
