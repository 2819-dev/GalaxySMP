// Community features: Events calendar, News, Polls, Builds gallery and the Suggestions upgrades
// (comments, staff responses, similar-suggestion check). Plus the 5-minute timer that sends event
// reminders, announces events in game and picks the Build of the Week.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { voiceStub } from "./voice.js";
import { notify } from "./notify.js";
import { toPlugin } from "./economy.js";
import { Buffer } from "node:buffer";

const STAFF = 50;
const ADMIN = 100;
const isStaff = (u) => Number(u.role_power) >= STAFF;
const isAdmin = (u) => Number(u.role_power) >= ADMIN;

function clean(v, max) {
  return String(v ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max);
}
function oneLine(v, max) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
async function filterOrThrow(sql, parts) {
  const list = compileWordList(await sql`SELECT word, match FROM filter_words`);
  for (const part of parts.filter(Boolean)) {
    const check = checkMessage(String(part).replace(/\n+/g, " ").toLowerCase(), list);
    if (!check.ok) throw new HttpError(400, check.message || "That isn't allowed.");
  }
}
function canPost(user, what) {
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  if (user.muted_until && new Date(user.muted_until) > new Date()) throw new HttpError(403, `You're muted, so you can't ${what} right now.`);
}
async function audit(sql, actorId, action, details) {
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${actorId}, ${action}, ${JSON.stringify(details)}::jsonb)`;
}
const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "Unknown item.");
  return n;
};

// =====================================================================
// Events calendar
// =====================================================================
const EVENT_KINDS = ["event", "bedwars", "build", "party", "update"];

const eventOut = (e) => ({
  id: Number(e.id), title: e.title, description: e.description, kind: e.kind, location: e.location,
  startsAt: e.starts_at, endsAt: e.ends_at, reminders: Number(e.reminders || 0), reminding: Boolean(e.reminding),
});

export async function eventsList(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const [upcoming, past, live] = await Promise.all([
    sql`SELECT e.*, (SELECT count(*) FROM event_reminders r WHERE r.event_id = e.id) AS reminders,
               EXISTS (SELECT 1 FROM event_reminders r WHERE r.event_id = e.id AND r.user_id = ${user.id}) AS reminding
          FROM events e WHERE e.deleted_at IS NULL AND coalesce(e.ends_at, e.starts_at + interval '2 hours') > now()
         ORDER BY e.starts_at LIMIT 30`,
    sql`SELECT e.*, 0 AS reminders, false AS reminding FROM events e
         WHERE e.deleted_at IS NULL AND coalesce(e.ends_at, e.starts_at + interval '2 hours') <= now()
         ORDER BY e.starts_at DESC LIMIT 5`,
    voiceStub(env).fetch("https://voice/internal/events").then((r) => r.json()).catch(() => ({ events: [], at: null })),
  ]);
  return json({
    ok: true, canManage: isStaff(user), now: new Date().toISOString(),
    upcoming: upcoming.map(eventOut), past: past.map(eventOut),
    minigames: live.events || [], updated: live.at, events: live.events || [],
  });
}

export async function eventSave(request, env) {
  const user = await requireUser(request, env);
  if (!isStaff(user)) throw new HttpError(403, "Only staff can add events.");
  const body = await readJson(request);
  const title = oneLine(body.title, 80);
  const description = clean(body.description, 1000);
  const location = oneLine(body.location, 80);
  const kind = EVENT_KINDS.includes(body.kind) ? body.kind : "event";
  const starts = new Date(body.startsAt);
  const ends = body.endsAt ? new Date(body.endsAt) : null;
  if (title.length < 3) throw new HttpError(400, "Give the event a name (at least 3 characters).");
  if (Number.isNaN(starts.getTime())) throw new HttpError(400, "Choose when the event starts.");
  if (ends && (Number.isNaN(ends.getTime()) || ends <= starts)) throw new HttpError(400, "The end time must be after the start time.");
  const sql = getDb(env);
  let row;
  if (body.id) {
    [row] = await sql`
      UPDATE events SET title = ${title}, description = ${description}, location = ${location}, kind = ${kind},
             reminded = CASE WHEN starts_at = ${starts.toISOString()}::timestamptz THEN reminded ELSE false END,
             announced = CASE WHEN starts_at = ${starts.toISOString()}::timestamptz THEN announced ELSE false END,
             starts_at = ${starts.toISOString()}, ends_at = ${ends ? ends.toISOString() : null}
       WHERE id = ${id(body.id)} AND deleted_at IS NULL RETURNING id`;
    if (!row) throw new HttpError(404, "That event no longer exists.");
    await audit(sql, user.id, "event.edit", { title });
  } else {
    [row] = await sql`
      INSERT INTO events (title, description, location, kind, starts_at, ends_at, created_by)
      VALUES (${title}, ${description}, ${location}, ${kind}, ${starts.toISOString()}, ${ends ? ends.toISOString() : null}, ${user.id})
      RETURNING id`;
    await audit(sql, user.id, "event.create", { title });
    if (body.notify !== false && starts > new Date()) {
      await notify(env, "all", "events", { title: `New event: ${title}`, body: "Tap to see when it starts and get a reminder.", url: "/community#events", tag: `event-${row.id}` });
    }
  }
  return json({ ok: true, id: Number(row.id) });
}

export async function eventAction(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const eid = id(params.id);
  const [e] = await sql`SELECT id, title FROM events WHERE id = ${eid} AND deleted_at IS NULL`;
  if (!e) throw new HttpError(404, "That event no longer exists.");
  if (params.action === "remind") {
    const [had] = await sql`DELETE FROM event_reminders WHERE event_id = ${eid} AND user_id = ${user.id} RETURNING 1 AS x`;
    if (!had) await sql`INSERT INTO event_reminders (event_id, user_id) VALUES (${eid}, ${user.id}) ON CONFLICT DO NOTHING`;
    return json({ ok: true, reminding: !had });
  }
  if (params.action === "delete") {
    if (!isStaff(user)) throw new HttpError(403, "Only staff can remove events.");
    await sql`UPDATE events SET deleted_at = now() WHERE id = ${eid}`;
    await audit(sql, user.id, "event.delete", { title: e.title });
    return json({ ok: true });
  }
  throw new HttpError(400, "Unknown action.");
}

// =====================================================================
// News
// =====================================================================
const NEWS_TAGS = ["news", "update", "event", "store", "fix"];

export async function newsList(request, env, ctx, url) {
  const user = await requireUser(request, env);
  const before = Number(url.searchParams.get("before")) || null;
  const sql = getDb(env);
  const rows = await sql`
    SELECT n.*, u.username AS author FROM news_posts n LEFT JOIN users u ON u.id = n.author_id
     WHERE n.deleted_at IS NULL AND (${before}::bigint IS NULL OR n.id < ${before})
     ORDER BY CASE WHEN ${before}::bigint IS NULL THEN NOT n.pinned ELSE true END, n.id DESC LIMIT 15`;
  return json({
    ok: true, canManage: isAdmin(user),
    posts: rows.map((r) => ({ id: Number(r.id), title: r.title, body: r.body, tag: r.tag, pinned: r.pinned, author: r.author || "GalaxySMP", createdAt: r.created_at, editedAt: r.edited_at })),
    hasMore: rows.length === 15,
  });
}

export async function newsSave(request, env) {
  const user = await requireUser(request, env);
  if (!isAdmin(user)) throw new HttpError(403, "Only Admins can post news.");
  const body = await readJson(request, 32768);
  const title = oneLine(body.title, 100);
  const text = clean(body.body, 4000);
  const tag = NEWS_TAGS.includes(body.tag) ? body.tag : "news";
  if (title.length < 3) throw new HttpError(400, "Give the post a title.");
  if (text.length < 3) throw new HttpError(400, "Write the post first.");
  const sql = getDb(env);
  if (body.id) {
    const [row] = await sql`UPDATE news_posts SET title = ${title}, body = ${text}, tag = ${tag}, pinned = ${Boolean(body.pinned)}, edited_at = now()
                             WHERE id = ${id(body.id)} AND deleted_at IS NULL RETURNING id`;
    if (!row) throw new HttpError(404, "That post no longer exists.");
    await audit(sql, user.id, "news.edit", { title });
    return json({ ok: true, id: Number(row.id) });
  }
  const [row] = await sql`INSERT INTO news_posts (title, body, tag, pinned, author_id) VALUES (${title}, ${text}, ${tag}, ${Boolean(body.pinned)}, ${user.id}) RETURNING id`;
  await audit(sql, user.id, "news.create", { title });
  if (body.notify) await notify(env, "all", "news", { title: `News: ${title}`, body: text.replace(/[#*_`>\[\]]/g, "").slice(0, 140), url: "/community#news", tag: `news-${row.id}` });
  if (body.inGame) { try { await toPlugin(env, { type: "announce", text: `News: ${title}. Read it at galaxymc.us`, by: user.username }); } catch { /* server offline */ } }
  return json({ ok: true, id: Number(row.id) });
}

export async function newsDelete(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  if (!isAdmin(user)) throw new HttpError(403, "Only Admins can remove news.");
  const sql = getDb(env);
  const [row] = await sql`UPDATE news_posts SET deleted_at = now() WHERE id = ${id(params.id)} AND deleted_at IS NULL RETURNING title`;
  if (!row) throw new HttpError(404, "That post no longer exists.");
  await audit(sql, user.id, "news.delete", { title: row.title });
  return json({ ok: true });
}

// =====================================================================
// Polls (staff create, everyone votes)
// =====================================================================
export async function pollsList(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const polls = await sql`
    SELECT p.*, u.username AS author,
           (p.closed OR (p.closes_at IS NOT NULL AND p.closes_at < now())) AS is_closed,
           (SELECT count(DISTINCT v.user_id) FROM poll_votes v WHERE v.poll_id = p.id) AS voters
      FROM polls p LEFT JOIN users u ON u.id = p.author_id
     WHERE p.deleted_at IS NULL ORDER BY (p.closed OR (p.closes_at IS NOT NULL AND p.closes_at < now())), p.id DESC LIMIT 30`;
  const ids = polls.map((p) => p.id);
  const options = ids.length ? await sql`
    SELECT o.id, o.poll_id, o.label, o.position, (SELECT count(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes,
           EXISTS (SELECT 1 FROM poll_votes v WHERE v.option_id = o.id AND v.user_id = ${user.id}) AS mine
      FROM poll_options o WHERE o.poll_id = ANY(${ids}::bigint[]) ORDER BY o.poll_id, o.position` : [];
  return json({
    ok: true, canManage: isStaff(user),
    polls: polls.map((p) => ({
      id: Number(p.id), question: p.question, multi: p.multi, author: p.author || "Staff", createdAt: p.created_at,
      closesAt: p.closes_at, closed: Boolean(p.is_closed), voters: Number(p.voters),
      options: options.filter((o) => String(o.poll_id) === String(p.id)).map((o) => ({ id: Number(o.id), label: o.label, votes: Number(o.votes), mine: o.mine })),
    })),
  });
}

export async function pollCreate(request, env) {
  const user = await requireUser(request, env);
  if (!isStaff(user)) throw new HttpError(403, "Only staff can create polls.");
  const body = await readJson(request);
  const question = oneLine(body.question, 140);
  const opts = (Array.isArray(body.options) ? body.options : []).map((o) => oneLine(o, 80)).filter(Boolean);
  if (question.length < 3) throw new HttpError(400, "Write the question.");
  if (opts.length < 2 || opts.length > 8) throw new HttpError(400, "A poll needs 2 to 8 answers.");
  if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) throw new HttpError(400, "Two answers are the same.");
  const hours = Number(body.hours) || 0;
  if (hours < 0 || hours > 24 * 30) throw new HttpError(400, "Polls can run for up to 30 days.");
  const sql = getDb(env);
  const [p] = await sql`INSERT INTO polls (question, multi, author_id, closes_at)
                        VALUES (${question}, ${Boolean(body.multi)}, ${user.id}, ${hours ? new Date(Date.now() + hours * 3600e3).toISOString() : null}) RETURNING id`;
  await sql.transaction(opts.map((label, i) => sql`INSERT INTO poll_options (poll_id, label, position) VALUES (${p.id}, ${label}, ${i})`));
  await audit(sql, user.id, "poll.create", { question });
  if (body.notify !== false) await notify(env, "all", "news", { title: "New poll", body: question, url: "/community#polls", tag: `poll-${p.id}` });
  return json({ ok: true, id: Number(p.id) });
}

export async function pollAction(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const pid = id(params.id);
  const [p] = await sql`SELECT id, question, multi, (closed OR (closes_at IS NOT NULL AND closes_at < now())) AS is_closed FROM polls WHERE id = ${pid} AND deleted_at IS NULL`;
  if (!p) throw new HttpError(404, "That poll no longer exists.");
  if (params.action === "vote") {
    canPost(user, "vote");
    if (p.is_closed) throw new HttpError(409, "This poll has closed.");
    const body = await readJson(request);
    const chosen = [...new Set((Array.isArray(body.optionIds) ? body.optionIds : []).map(Number))];
    if (!p.multi && chosen.length > 1) throw new HttpError(400, "Choose one answer.");
    const valid = await sql`SELECT id FROM poll_options WHERE poll_id = ${pid} AND id = ANY(${chosen}::bigint[])`;
    if (valid.length !== chosen.length) throw new HttpError(400, "That answer isn't part of this poll.");
    await sql.transaction([
      sql`DELETE FROM poll_votes WHERE poll_id = ${pid} AND user_id = ${user.id}`,
      ...chosen.map((o) => sql`INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (${pid}, ${o}, ${user.id})`),
    ]);
    return json({ ok: true });
  }
  if (!isStaff(user)) throw new HttpError(403, "Only staff can do that.");
  if (params.action === "close") {
    await sql`UPDATE polls SET closed = true WHERE id = ${pid}`;
    await audit(sql, user.id, "poll.close", { question: p.question });
    return json({ ok: true });
  }
  if (params.action === "delete") {
    await sql`UPDATE polls SET deleted_at = now() WHERE id = ${pid}`;
    await audit(sql, user.id, "poll.delete", { question: p.question });
    return json({ ok: true });
  }
  throw new HttpError(400, "Unknown action.");
}

// =====================================================================
// Builds gallery
// =====================================================================
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 700 * 1024;
const IMAGE_TYPES = { "image/jpeg": [0xff, 0xd8], "image/webp": [0x52, 0x49], "image/png": [0x89, 0x50] };

function mondayOf(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

export async function buildsList(request, env, ctx, url) {
  const user = await requireUser(request, env);
  const sort = ["new", "top", "week"].includes(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "new";
  const sql = getDb(env);
  const weekStart = mondayOf(new Date()).toISOString();
  const rows = await sql`
    SELECT b.id, b.title, b.description, b.location, b.created_at, b.botw_week, b.user_id, u.username AS author,
           (SELECT count(*) FROM build_likes l WHERE l.build_id = b.id) AS likes,
           EXISTS (SELECT 1 FROM build_likes l WHERE l.build_id = b.id AND l.user_id = ${user.id}) AS liked,
           (SELECT json_agg(json_build_object('id', i.id, 'w', i.width, 'h', i.height) ORDER BY i.position) FROM build_images i WHERE i.build_id = b.id) AS images
      FROM builds b JOIN users u ON u.id = b.user_id
     WHERE b.deleted_at IS NULL AND (${sort} <> 'week' OR b.created_at >= ${weekStart}::timestamptz)
     ORDER BY CASE WHEN ${sort} = 'new' THEN 0 ELSE (SELECT count(*) FROM build_likes l WHERE l.build_id = b.id) END DESC, b.id DESC
     LIMIT 60`;
  const [botw] = await sql`SELECT b.id FROM builds b WHERE b.botw_week IS NOT NULL AND b.deleted_at IS NULL ORDER BY b.botw_week DESC LIMIT 1`;
  return json({
    ok: true, canModerate: isStaff(user), me: Number(user.id), botwId: botw ? Number(botw.id) : null,
    builds: rows.map((b) => ({
      id: Number(b.id), title: b.title, description: b.description, location: b.location, createdAt: b.created_at,
      author: b.author, mine: Number(b.user_id) === Number(user.id), likes: Number(b.likes), liked: b.liked,
      botwWeek: b.botw_week, images: (b.images || []).map((i) => ({ id: Number(i.id), w: i.w, h: i.h })),
    })),
  });
}

export async function buildCreate(request, env) {
  const user = await requireUser(request, env);
  canPost(user, "post builds");
  await rateLimit(env, "AUTH_LIMITER", `build:${user.id}`);
  const body = await readJson(request, 4_200_000);  // up to 4 photos of ~700 KB (sent as base64)
  const title = oneLine(body.title, 60);
  const description = clean(body.description, 500);
  const location = oneLine(body.location, 60);
  if (title.length < 3) throw new HttpError(400, "Give your build a name (at least 3 characters).");
  const imgs = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES + 1) : [];
  if (!imgs.length) throw new HttpError(400, "Add at least one photo.");
  if (imgs.length > MAX_IMAGES) throw new HttpError(400, `Up to ${MAX_IMAGES} photos per build.`);
  const decoded = imgs.map((img) => {
    const mime = String(img.mime || "");
    const magic = IMAGE_TYPES[mime];
    if (!magic) throw new HttpError(400, "Photos must be JPEG, WebP or PNG.");
    const b64 = String(img.data || "").replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4) throw new HttpError(400, "A photo couldn't be read.");
    if ((b64.length * 3) / 4 > MAX_IMAGE_BYTES) throw new HttpError(400, "A photo is too large. Try a smaller one.");
    let head;
    try { head = atob(b64.slice(0, 8)); } catch { throw new HttpError(400, "A photo couldn't be read."); }
    if (head.charCodeAt(0) !== magic[0] || head.charCodeAt(1) !== magic[1]) throw new HttpError(400, "A photo couldn't be read.");
    const w = Math.round(Number(img.width)), h = Math.round(Number(img.height));
    if (!(w > 0 && w <= 4096 && h > 0 && h <= 4096)) throw new HttpError(400, "A photo couldn't be read.");
    return { mime, w, h, b64 };
  });
  const sql = getDb(env);
  await filterOrThrow(sql, [title, description, location]);
  const [recent] = await sql`SELECT count(*)::int AS n FROM builds WHERE user_id = ${user.id} AND created_at > now() - interval '1 day'`;
  if (recent.n >= 3) throw new HttpError(429, "You can post 3 builds a day.");
  const [b] = await sql`INSERT INTO builds (user_id, title, description, location) VALUES (${user.id}, ${title}, ${description}, ${location}) RETURNING id`;
  for (const [i, img] of decoded.entries()) {
    await sql`INSERT INTO build_images (build_id, position, mime, width, height, data) VALUES (${b.id}, ${i}, ${img.mime}, ${img.w}, ${img.h}, decode(${img.b64}, 'base64'))`;
  }
  return json({ ok: true, id: Number(b.id) });
}

export async function buildImage(request, env, ctx, url, params) {
  await requireUser(request, env);
  const sql = getDb(env);
  const [img] = await sql`SELECT i.mime, encode(i.data, 'base64') AS b64 FROM build_images i JOIN builds b ON b.id = i.build_id
                           WHERE i.id = ${id(params.id)} AND b.deleted_at IS NULL`;
  if (!img) return new Response("Not found", { status: 404 });
  const bytes = Buffer.from(img.b64.replace(/\s+/g, ""), "base64");
  return new Response(bytes, { headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=604800, immutable", "X-Content-Type-Options": "nosniff" } });
}

export async function buildAction(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const bid = id(params.id);
  const [b] = await sql`SELECT id, user_id, title FROM builds WHERE id = ${bid} AND deleted_at IS NULL`;
  if (!b) throw new HttpError(404, "That build no longer exists.");
  if (params.action === "like") {
    canPost(user, "like builds");
    const [had] = await sql`DELETE FROM build_likes WHERE build_id = ${bid} AND user_id = ${user.id} RETURNING 1 AS x`;
    if (!had) await sql`INSERT INTO build_likes (build_id, user_id) VALUES (${bid}, ${user.id}) ON CONFLICT DO NOTHING`;
    return json({ ok: true, liked: !had });
  }
  if (params.action === "delete") {
    const own = Number(b.user_id) === Number(user.id);
    if (!own && !isStaff(user)) throw new HttpError(403, "You can only delete your own builds.");
    await sql`UPDATE builds SET deleted_at = now() WHERE id = ${bid}`;
    if (!own) await audit(sql, user.id, "build.delete", { title: b.title });
    return json({ ok: true });
  }
  throw new HttpError(400, "Unknown action.");
}

// =====================================================================
// Suggestions: comments, staff response, similar suggestions
// =====================================================================
export async function suggestionComments(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const rows = await sql`
    SELECT c.id, c.body, c.created_at, c.user_id, u.username FROM suggestion_comments c JOIN users u ON u.id = c.user_id
     WHERE c.suggestion_id = ${id(params.id)} AND c.deleted_at IS NULL ORDER BY c.id LIMIT 200`;
  return json({ ok: true, canModerate: isStaff(user),
    comments: rows.map((c) => ({ id: Number(c.id), body: c.body, author: c.username, mine: Number(c.user_id) === Number(user.id), createdAt: c.created_at })) });
}

export async function suggestionComment(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  canPost(user, "comment");
  await rateLimit(env, "POLL_LIMITER", `sgc:${user.id}`);
  const body = await readJson(request);
  const text = clean(body.body, 500);
  if (text.length < 2) throw new HttpError(400, "Write a comment first.");
  const sql = getDb(env);
  const sid = id(params.id);
  const [s] = await sql`SELECT id, user_id, title FROM suggestions WHERE id = ${sid} AND deleted_at IS NULL`;
  if (!s) throw new HttpError(404, "That suggestion no longer exists.");
  await filterOrThrow(sql, [text]);
  const [c] = await sql`INSERT INTO suggestion_comments (suggestion_id, user_id, body) VALUES (${sid}, ${user.id}, ${text}) RETURNING id`;
  if (Number(s.user_id) !== Number(user.id)) {
    await notify(env, [s.user_id], "community", { title: `${user.username} commented on your suggestion`, body: `"${s.title}": ${text.slice(0, 120)}`, url: "/community#suggestions", tag: `sg-${sid}` });
  }
  return json({ ok: true, id: Number(c.id) });
}

export async function suggestionCommentDelete(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const [c] = await sql`SELECT id, user_id FROM suggestion_comments WHERE id = ${id(params.id)} AND deleted_at IS NULL`;
  if (!c) throw new HttpError(404, "That comment no longer exists.");
  if (Number(c.user_id) !== Number(user.id) && !isStaff(user)) throw new HttpError(403, "You can only delete your own comments.");
  await sql`UPDATE suggestion_comments SET deleted_at = now() WHERE id = ${c.id}`;
  return json({ ok: true });
}

// Staff change the status and (optionally) write a short response; the author is told.
export async function suggestionRespond(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  if (!isStaff(user)) throw new HttpError(403, "Only staff can respond to suggestions.");
  const body = await readJson(request);
  const status = ["open", "planned", "done", "declined"].includes(body.status) ? body.status : null;
  if (!status) throw new HttpError(400, "Choose a status.");
  const reply = clean(body.reply, 500);
  const sql = getDb(env);
  const sid = id(params.id);
  const [s] = await sql`
    UPDATE suggestions SET status = ${status},
           staff_reply = CASE WHEN ${reply} = '' THEN staff_reply ELSE ${reply} END,
           staff_reply_by = CASE WHEN ${reply} = '' THEN staff_reply_by ELSE ${user.id}::bigint END,
           staff_reply_at = CASE WHEN ${reply} = '' THEN staff_reply_at ELSE now() END
     WHERE id = ${sid} AND deleted_at IS NULL RETURNING user_id, title`;
  if (!s) throw new HttpError(404, "That suggestion no longer exists.");
  await audit(sql, user.id, "suggestion.status", { title: s.title, status, reply: reply || undefined });
  const NAMES = { open: "Open", planned: "Planned", done: "Done", declined: "Declined" };
  await notify(env, [s.user_id], "community", { title: `Your suggestion is now ${NAMES[status]}`, body: reply ? `"${s.title}": ${reply.slice(0, 120)}` : `"${s.title}"`, url: "/community#suggestions", tag: `sg-${sid}` }, { exclude: [user.id] });
  return json({ ok: true });
}

// While someone types a title: existing suggestions that share its words.
export async function suggestionSimilar(request, env, ctx, url) {
  await requireUser(request, env);
  const words = [...new Set(String(url.searchParams.get("q") || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [])]
    .filter((w) => !["with", "that", "this", "have", "more", "from", "make", "please", "could", "would", "should", "there", "their", "about", "server"].includes(w))
    .slice(0, 6);
  if (!words.length) return json({ ok: true, similar: [] });
  const patterns = words.map((w) => `%${w}%`);
  const sql = getDb(env);
  const rows = await sql`
    SELECT s.id, s.title, s.status,
           (SELECT count(*) FROM unnest(${patterns}::text[]) p WHERE s.title ILIKE p) AS hits,
           (SELECT coalesce(sum(CASE WHEN v.value > 0 THEN 1 ELSE 0 END), 0) FROM suggestion_votes v WHERE v.suggestion_id = s.id) AS likes
      FROM suggestions s
     WHERE s.deleted_at IS NULL AND s.title ILIKE ANY(${patterns}::text[])
     ORDER BY hits DESC, likes DESC LIMIT 5`;
  return json({ ok: true, similar: rows.map((r) => ({ id: Number(r.id), title: r.title, status: r.status, likes: Number(r.likes) })) });
}

// =====================================================================
// Every 5 minutes: event reminders and in-game announcements, Build of the Week.
// =====================================================================
export async function tick(env) {
  const sql = getDb(env);
  // "Starting in 15 minutes" to everyone who tapped Remind me.
  const soon = await sql`
    UPDATE events SET reminded = true
     WHERE deleted_at IS NULL AND NOT reminded AND starts_at <= now() + interval '15 minutes' AND starts_at > now() - interval '10 minutes'
     RETURNING id, title, location, starts_at`;
  for (const e of soon) {
    const ids = (await sql`SELECT user_id FROM event_reminders WHERE event_id = ${e.id}`).map((r) => Number(r.user_id));
    const mins = Math.max(0, Math.round((new Date(e.starts_at) - Date.now()) / 60000));
    if (ids.length) await notify(env, ids, "events", { title: mins ? `${e.title} starts in ${mins} minutes` : `${e.title} is starting`, body: e.location ? `Where: ${e.location}` : "Join GalaxySMP to take part.", url: "/community#events", tag: `event-${e.id}`, urgent: true });
  }
  // In game, when it starts (only marked once the server took it, so it retries while offline).
  const starting = await sql`
    SELECT id, title, location FROM events
     WHERE deleted_at IS NULL AND NOT announced AND starts_at <= now() AND starts_at > now() - interval '20 minutes'`;
  for (const e of starting) {
    let sent = false;
    try { sent = await toPlugin(env, { type: "announce", text: `Event starting now: ${e.title}${e.location ? ` (${e.location})` : ""}`, by: "Events" }); } catch { /* offline */ }
    if (sent) await sql`UPDATE events SET announced = true WHERE id = ${e.id}`;
  }
  await buildOfTheWeek(env, sql);
}

async function buildOfTheWeek(env, sql) {
  const thisMonday = mondayOf(new Date());
  const lastMonday = new Date(thisMonday.getTime() - 7 * 864e5);
  const week = lastMonday.toISOString().slice(0, 10);
  const [done] = await sql`SELECT value FROM economy_config WHERE key = 'botw_last'`;
  if (done?.value === week) return;
  const [winner] = await sql`
    SELECT b.id, b.user_id, b.title, count(l.user_id) AS likes FROM builds b JOIN build_likes l ON l.build_id = b.id
     WHERE b.deleted_at IS NULL AND b.created_at >= ${lastMonday.toISOString()}::timestamptz AND b.created_at < ${thisMonday.toISOString()}::timestamptz
     GROUP BY b.id ORDER BY count(l.user_id) DESC, b.id LIMIT 1`;
  await sql`INSERT INTO economy_config (key, value, updated_by) VALUES ('botw_last', ${JSON.stringify(week)}::jsonb, 'server')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = 'server'`;
  if (!winner) return;
  await sql`UPDATE builds SET botw_week = ${week}::date WHERE id = ${winner.id}`;
  let [badge] = await sql`SELECT id FROM badges WHERE name = 'Build of the Week' ORDER BY id LIMIT 1`;
  if (!badge) [badge] = await sql`INSERT INTO badges (name, description, icon, style) VALUES ('Build of the Week', 'Posted the most liked build of the week in #Builds.', 'castle', 'gold') RETURNING id`;
  await sql`INSERT INTO user_badges (user_id, badge_id) VALUES (${winner.user_id}, ${badge.id}) ON CONFLICT DO NOTHING`;
  await notify(env, [winner.user_id], "community", { title: "Your build is Build of the Week!", body: `"${winner.title}" got the most likes last week. You earned the Build of the Week badge.`, url: "/community#builds", tag: "botw" });
}
