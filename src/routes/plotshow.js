// Plots on the map. Free plots show as green boxes. A player's plot only shows when its owner makes it public
// (/plot public in game, or the switch on the map). Tapping a public plot shows its name, owner, photos and likes.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { voiceStub } from "./voice.js";
import { decodeImages } from "./features.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { Buffer } from "node:buffer";

const MAX_PHOTOS = 4;

async function viewerXuid(sql, user) {
  const [p] = await sql`SELECT p.xuid FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  return p?.xuid || null;
}

// The plots the map may show this viewer (free plots, public plots, their own, shops and areas)
export async function visiblePlots(sql, user, plots) {
  const me = await viewerXuid(sql, user);
  const shown = (plots || []).filter((p) => p.kind !== "plot" || !p.ownerXuid || p.public || p.ownerXuid === me);
  const ids = shown.filter((p) => p.kind === "plot" && p.public).map((p) => String(p.id));
  const likes = ids.length ? await sql`SELECT plot_id, count(*)::int AS n FROM plot_likes WHERE plot_id = ANY(${ids}) GROUP BY plot_id`.catch(() => []) : [];
  const likeMap = new Map(likes.map((r) => [r.plot_id, r.n]));
  return shown.map(({ ownerXuid, ...p }) => ({
    ...p, mine: Boolean(me && ownerXuid === me), available: p.kind === "plot" && !ownerXuid && !p.owner,
    owner: p.kind !== "plot" || p.public || ownerXuid === me ? p.owner : "", likes: likeMap.get(String(p.id)) || 0,
  }));
}

async function plotById(env, id) {
  const live = await voiceStub(env).fetch("https://voice/internal/map").then((r) => r.json()).catch(() => ({}));
  return (live.plots || []).find((p) => String(p.id) === String(id)) || null;
}

// GET /api/map/plots/:id
export async function plotCard(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const p = await plotById(env, params.id);
  const me = await viewerXuid(sql, user);
  if (!p || p.kind !== "plot" || !p.ownerXuid || (!p.public && p.ownerXuid !== me)) throw new HttpError(404, "This plot isn't public.");
  const [show] = await sql`SELECT caption FROM plot_showcase WHERE plot_id = ${String(p.id)}`;
  const photos = await sql`SELECT id, width, height FROM plot_photos WHERE plot_id = ${String(p.id)} ORDER BY position`;
  const [lk] = await sql`SELECT count(*)::int AS n, bool_or(user_id = ${user.id}) AS mine FROM plot_likes WHERE plot_id = ${String(p.id)}`;
  return json({ ok: true, plot: {
    id: p.id, name: p.label || `${p.owner}'s plot`, owner: p.owner, public: Boolean(p.public), mine: p.ownerXuid === me,
    caption: show?.caption || "", photos: photos.map((x) => ({ id: Number(x.id), w: x.width, h: x.height })),
    likes: lk?.n || 0, liked: Boolean(lk?.mine), x: Math.round((p.x1 + p.x2) / 2), z: Math.round((p.z1 + p.z2) / 2),
  } });
}

// POST /api/map/plots/:id { action: "public" | "private" | "like" | "photos", images?, caption? }
export async function plotAction(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  await rateLimit(env, "POLL_LIMITER", `plot:${user.id}`);
  const body = await readJson(request, 4_200_000);
  const sql = getDb(env);
  const p = await plotById(env, params.id);
  const me = await viewerXuid(sql, user);
  if (!p || p.kind !== "plot" || !p.ownerXuid) throw new HttpError(404, "That plot doesn't exist.");
  const mine = p.ownerXuid === me;
  const id = String(p.id);
  if (body.action === "like") {
    if (!p.public) throw new HttpError(404, "This plot isn't public.");
    if (mine) throw new HttpError(400, "You can't like your own plot.");
    const del = await sql`DELETE FROM plot_likes WHERE plot_id = ${id} AND user_id = ${user.id} RETURNING 1`;
    if (!del.length) await sql`INSERT INTO plot_likes (plot_id, user_id) VALUES (${id}, ${user.id}) ON CONFLICT DO NOTHING`;
    return json({ ok: true, liked: !del.length });
  }
  if (!mine) throw new HttpError(403, "Only the plot's owner can change this.");
  if (body.action === "public" || body.action === "private") {
    const a = await voiceStub(env).fetch("https://voice/internal/ask", { method: "POST", body: JSON.stringify({ type: "plot_public", id: p.id, xuid: me, public: body.action === "public" }) })
      .then((r) => r.json()).catch(() => ({ ok: false }));
    if (!a.ok) throw new HttpError(409, a.message || "The server needs to be online to change this. You can also type /plot public in game.");
    return json({ ok: true, public: body.action === "public", message: body.action === "public" ? "Your plot is public. Everyone can find it on the map." : "Your plot is private again." });
  }
  if (body.action === "photos") {
    const imgs = Array.isArray(body.images) ? body.images.slice(0, MAX_PHOTOS + 1) : [];
    if (imgs.length > MAX_PHOTOS) throw new HttpError(400, `Up to ${MAX_PHOTOS} photos.`);
    const decoded = decodeImages(imgs);
    const caption = String(body.caption || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (caption) {
      const check = checkMessage(caption, compileWordList(await sql`SELECT word, match FROM filter_words`), { allowLinks: false, maxLength: 200 });
      if (!check.ok) throw new HttpError(400, check.message || "That isn't allowed.");
    }
    await sql`INSERT INTO plot_showcase (plot_id, owner_xuid, caption) VALUES (${id}, ${me}, ${caption})
              ON CONFLICT (plot_id) DO UPDATE SET owner_xuid = EXCLUDED.owner_xuid, caption = EXCLUDED.caption, updated_at = now()`;
    if (imgs.length || body.clearPhotos) await sql`DELETE FROM plot_photos WHERE plot_id = ${id}`;
    for (const [i, img] of decoded.entries()) {
      await sql`INSERT INTO plot_photos (plot_id, position, mime, width, height, data) VALUES (${id}, ${i}, ${img.mime}, ${img.w}, ${img.h}, decode(${img.b64}, 'base64'))`;
    }
    return json({ ok: true, message: "Saved." });
  }
  throw new HttpError(400, "Unknown action.");
}

// GET /api/map/plot-photo/:id
export async function plotPhoto(request, env, ctx, url, params) {
  await requireUser(request, env);
  const [img] = await getDb(env)`SELECT mime, encode(data, 'base64') AS b64 FROM plot_photos WHERE id = ${Number(params.id) || 0}`;
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(img.b64.replace(/\s+/g, ""), "base64"), { headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=86400" } });
}
