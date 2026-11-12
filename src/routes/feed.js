// #Timeline: a feed of what's happening on GalaxySMP (new players, achievements, Player/Build of the Week,
// rank-ups and Galaxy+), shown as cards with likes and comments. Members only.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { headUrlFor } from "./heads.js";

const STAFF = 50;

// Add a moment to the feed. dedupe makes sure the same moment is never posted twice. Never throws.
export async function postTimeline(sql, { kind, xuid = null, name, title, detail = "", icon = null, buildId = null, dedupe = null }) {
  try {
    await sql`INSERT INTO timeline_posts (kind, xuid, name, title, detail, icon, build_id, dedupe)
              VALUES (${kind}, ${xuid}, ${String(name).slice(0, 40)}, ${String(title).slice(0, 160)}, ${String(detail).slice(0, 300)},
                      ${icon}, ${buildId}, ${dedupe}) ON CONFLICT (dedupe) DO NOTHING`;
  } catch (e) {
    console.error("timeline post failed", e);
  }
}

const out = (p, me) => ({
  id: Number(p.id), kind: p.kind, name: p.name, title: p.title, detail: p.detail, icon: p.icon, at: p.created_at,
  head: p.p_xuid ? headUrlFor({ xuid: p.p_xuid, head_at: p.head_at, gamerpic_at: p.gamerpic_at }) : null,
  profile: p.xuid ? `/player/${encodeURIComponent(p.name)}` : null,
  image: p.image_id ? `/api/community/builds/image/${p.image_id}` : null,
  likes: Number(p.likes), liked: Boolean(p.liked), comments: Number(p.comments),
  canDelete: Number(me.role_power) >= STAFF,
});

// GET /api/feed?before=<id>
export async function listFeed(request, env, ctx, url) {
  const me = await requireUser(request, env);
  const before = Number(url.searchParams.get("before")) || null;
  const sql = getDb(env);
  const rows = await sql`
    SELECT t.*, pl.xuid AS p_xuid, pl.head_at, pl.gamerpic_at,
           (SELECT count(*) FROM timeline_likes l WHERE l.post_id = t.id) AS likes,
           EXISTS (SELECT 1 FROM timeline_likes l WHERE l.post_id = t.id AND l.user_id = ${me.id}) AS liked,
           (SELECT count(*) FROM timeline_comments c WHERE c.post_id = t.id AND c.deleted_at IS NULL) AS comments,
           (SELECT i.id FROM build_images i WHERE i.build_id = t.build_id ORDER BY i.position LIMIT 1) AS image_id
      FROM timeline_posts t LEFT JOIN players pl ON pl.xuid = t.xuid
     WHERE t.deleted_at IS NULL AND (${before}::bigint IS NULL OR t.id < ${before})
     ORDER BY t.id DESC LIMIT 20`;
  return json({ ok: true, posts: rows.map((p) => out(p, me)), more: rows.length === 20 });
}

async function post(sql, id) {
  const [p] = await sql`SELECT id FROM timeline_posts WHERE id = ${Number(id) || 0} AND deleted_at IS NULL`;
  if (!p) throw new HttpError(404, "That post is no longer on the timeline.");
  return p;
}

// POST /api/feed/:id/like  (toggle)
export async function likePost(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  await post(sql, params.id);
  const [had] = await sql`DELETE FROM timeline_likes WHERE post_id = ${params.id} AND user_id = ${me.id} RETURNING post_id`;
  if (!had) await sql`INSERT INTO timeline_likes (post_id, user_id) VALUES (${params.id}, ${me.id}) ON CONFLICT DO NOTHING`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM timeline_likes WHERE post_id = ${params.id}`;
  return json({ ok: true, liked: !had, likes: n });
}

// GET /api/feed/:id/comments
export async function listComments(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  await post(sql, params.id);
  const rows = await sql`
    SELECT c.id, c.body, c.created_at, c.user_id, u.username FROM timeline_comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ${params.id} AND c.deleted_at IS NULL ORDER BY c.id LIMIT 200`;
  return json({ ok: true, comments: rows.map((c) => ({ id: Number(c.id), body: c.body, at: c.created_at, author: c.username,
    canDelete: Number(c.user_id) === Number(me.id) || Number(me.role_power) >= STAFF })) });
}

// POST /api/feed/:id/comments { body }
export async function addComment(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  if (me.muted_until && new Date(me.muted_until) > new Date()) throw new HttpError(403, "You're muted, so you can't comment right now.");
  await rateLimit(env, "AUTH_LIMITER", `feedc:${me.id}`);
  const sql = getDb(env);
  await post(sql, params.id);
  const check = checkMessage(String((await readJson(request)).body || "").slice(0, 300), compileWordList(await sql`SELECT word, match FROM filter_words`),
    { allowLinks: Number(me.role_power) >= 100 });
  if (!check.ok) throw new HttpError(400, check.message);
  await sql`INSERT INTO timeline_comments (post_id, user_id, body) VALUES (${params.id}, ${me.id}, ${check.text})`;
  return json({ ok: true });
}

// POST /api/feed/comments/:id/delete  (your own, or staff)
export async function deleteComment(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  const [c] = await sql`UPDATE timeline_comments SET deleted_at = now()
                         WHERE id = ${Number(params.id) || 0} AND deleted_at IS NULL AND (user_id = ${me.id} OR ${Number(me.role_power) >= STAFF})
                         RETURNING id`;
  if (!c) throw new HttpError(404, "That comment can't be removed.");
  return json({ ok: true });
}

// POST /api/feed/:id/delete  (staff)
export async function deletePost(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  if (Number(me.role_power) < STAFF) throw new HttpError(403, "Only staff can remove timeline posts.");
  const sql = getDb(env);
  await sql`UPDATE timeline_posts SET deleted_at = now() WHERE id = ${Number(params.id) || 0}`;
  return json({ ok: true });
}
