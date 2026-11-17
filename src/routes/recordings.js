// Stage recordings uploaded to the website (Cloudflare R2, binding RECORDINGS).
// The recorder's browser uploads the video in pieces while it records (R2 "multipart upload": every piece is the same
// size except the last), so long recordings don't have to upload at the end. Only the site Owner and staff with
// "Moderate stages" can watch them, in Control Panel > Moderation > Reports > Recordings.
// Storage is capped at 9.5 GB so it stays inside R2's free 10 GB: past that, recordings only save on the device.
// Also here: the Owner/staff list of every podcast episode, including ones hosts removed (with Restore).
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { can } from "../lib/perms.js";

export const PART_BYTES = 8 * 1024 * 1024;          // every piece but the last (R2 needs equal sizes)
const CAP_BYTES = Math.round(9.5 * 1024 ** 3);      // stay inside the free 10 GB
const isMod = (user) => Boolean(user.owner) || can(user, "moderate_streams");

async function used(sql) {
  const [r] = await sql`SELECT coalesce(sum(size), 0)::bigint AS n FROM stream_recordings WHERE deleted_at IS NULL AND status <> 'failed'`;
  return Number(r.n);
}

// POST /api/recordings/start { streamId, mime } -> { id, upload, partBytes } (upload false: device only, with a reason)
export async function start(request, env) {
  const user = await requireUser(request, env);
  const b = await readJson(request);
  const sql = getDb(env);
  const [s] = await sql`SELECT * FROM streams_v WHERE id = ${Number(b.streamId) || 0} AND status = 'live'`;
  if (!s) throw new HttpError(404, "That stage isn't live.");
  // who may record: the stage's hosts (checked the same way as the stage page) and the Owner
  const { rightsForUser } = await import("./streams.js");
  const rights = await rightsForUser(sql, user, s);
  if (!rights.manage && !user.owner) throw new HttpError(403, "Only the stage's hosts can record it.");
  const mime = /^video\/(webm|mp4)/.test(String(b.mime || "")) ? String(b.mime).split(";")[0] : "video/webm";
  const [row] = await sql`INSERT INTO stream_recordings (stream_id, user_id, title, mime, status) VALUES (${s.id}, ${user.id}, ${s.title}, ${mime}, 'local') RETURNING id`;
  if (!env.RECORDINGS) return json({ ok: true, id: Number(row.id), upload: false, reason: "Recordings save to this device. (Uploading to GalaxySMP isn't switched on yet.)" });
  if (await used(sql) >= CAP_BYTES) return json({ ok: true, id: Number(row.id), upload: false, reason: "GalaxySMP's recording storage is full, so this one saves to this device only." });
  const key = `stage-${s.id}/${row.id}.${mime === "video/mp4" ? "mp4" : "webm"}`;
  const mpu = await env.RECORDINGS.createMultipartUpload(key, { httpMetadata: { contentType: mime } });
  await sql`UPDATE stream_recordings SET r2_key = ${key}, upload_id = ${mpu.uploadId}, status = 'uploading' WHERE id = ${row.id}`;
  return json({ ok: true, id: Number(row.id), upload: true, partBytes: PART_BYTES });
}

async function mine(sql, user, id) {
  const [r] = await sql`SELECT * FROM stream_recordings WHERE id = ${Number(id) || 0} AND deleted_at IS NULL`;
  if (!r || Number(r.user_id) !== Number(user.id)) throw new HttpError(404, "That recording isn't yours.");
  return r;
}

// PUT /api/recordings/:id/part?n=1 (body: the bytes of piece n)
export async function part(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const r = await mine(sql, user, params.id);
  if (r.status !== "uploading" || !env.RECORDINGS) throw new HttpError(409, "This recording isn't uploading.");
  const n = Number(url.searchParams.get("n"));
  if (!Number.isInteger(n) || n < 1 || n > 10000) throw new HttpError(400, "Bad piece number.");
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > PART_BYTES) throw new HttpError(400, "Bad piece size.");
  if (await used(sql) + body.byteLength > CAP_BYTES) {
    await abortUpload(env, sql, r, "full");
    return json({ ok: false, full: true, error: "GalaxySMP's recording storage is full. The rest saves to your device only." }, 507);
  }
  const done = await env.RECORDINGS.resumeMultipartUpload(r.r2_key, r.upload_id).uploadPart(n, body);
  await sql`UPDATE stream_recordings SET parts = parts || ${JSON.stringify([{ partNumber: done.partNumber, etag: done.etag }])}::jsonb,
                                         size = size + ${body.byteLength} WHERE id = ${r.id}`;
  return json({ ok: true });
}

// POST /api/recordings/:id/finish { seconds }
export async function finish(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const r = await mine(sql, user, params.id);
  const seconds = Math.max(0, Math.round(Number((await readJson(request)).seconds) || 0));
  if (r.status !== "uploading") {
    await sql`UPDATE stream_recordings SET seconds = ${seconds}, ended_at = now() WHERE id = ${r.id}`;
    return json({ ok: true, uploaded: false });
  }
  const parts = (r.parts || []).sort((a, b) => a.partNumber - b.partNumber);
  if (!parts.length) { await abortUpload(env, sql, r, "failed"); return json({ ok: true, uploaded: false }); }
  await env.RECORDINGS.resumeMultipartUpload(r.r2_key, r.upload_id).complete(parts);
  await sql`UPDATE stream_recordings SET status = 'done', seconds = ${seconds}, ended_at = now(), upload_id = NULL WHERE id = ${r.id}`;
  return json({ ok: true, uploaded: true });
}

async function abortUpload(env, sql, r, status) {
  try { await env.RECORDINGS?.resumeMultipartUpload(r.r2_key, r.upload_id).abort(); } catch { /* already gone */ }
  await sql`UPDATE stream_recordings SET status = ${status === "full" ? "local" : "failed"}, size = 0, parts = '[]', upload_id = NULL, ended_at = now() WHERE id = ${r.id}`;
}

// ---------- Owner / staff ----------
// GET /api/recordings
export async function list(request, env) {
  const user = await requireUser(request, env);
  if (!isMod(user)) throw new HttpError(403, "Only the Owner and staff can see recordings.");
  const sql = getDb(env);
  const [rows, episodes] = await Promise.all([
    sql`SELECT r.id, r.stream_id, r.title, r.mime, r.size, r.seconds, r.status, r.started_at, r.ended_at, u.username
          FROM stream_recordings r LEFT JOIN users u ON u.id = r.user_id WHERE r.deleted_at IS NULL ORDER BY r.started_at DESC LIMIT 100`,
    sql`SELECT e.id, e.title, e.description, e.youtube_id, e.plays, e.created_at, e.deleted_at, cu.username AS by_name, hu.username AS host_name, t.name AS team_name, t.tag AS team_tag
          FROM stream_episodes e LEFT JOIN users cu ON cu.id = e.created_by LEFT JOIN users hu ON hu.id = e.host_user_id LEFT JOIN teams t ON t.id = e.team_id
         ORDER BY e.created_at DESC LIMIT 100`,
  ]);
  return json({
    ok: true, storageOn: Boolean(env.RECORDINGS), used: await used(sql), cap: CAP_BYTES,
    recordings: rows.map((r) => ({ id: Number(r.id), streamId: r.stream_id ? Number(r.stream_id) : null, title: r.title, by: r.username, mime: r.mime, size: Number(r.size),
      seconds: r.seconds, status: r.status, startedAt: r.started_at, endedAt: r.ended_at })),
    episodes: episodes.map((e) => ({ id: Number(e.id), title: e.title, description: e.description, youtubeId: e.youtube_id, plays: Number(e.plays), createdAt: e.created_at,
      removed: Boolean(e.deleted_at), by: e.by_name, host: e.team_name ? `[${e.team_tag}] ${e.team_name}` : e.host_name })),
  }, 200, { "Cache-Control": "no-store" });
}

// GET /api/recordings/:id/file (plays in the browser; supports seeking)
export async function file(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  if (!isMod(user)) throw new HttpError(403, "Only the Owner and staff can watch recordings.");
  if (!env.RECORDINGS) throw new HttpError(404, "Recording storage isn't switched on.");
  const [r] = await getDb(env)`SELECT r2_key, mime, title FROM stream_recordings WHERE id = ${Number(params.id) || 0} AND status = 'done' AND deleted_at IS NULL`;
  if (!r) throw new HttpError(404, "That recording isn't available.");
  const obj = await env.RECORDINGS.get(r.r2_key, { range: request.headers });
  if (!obj) throw new HttpError(404, "That recording file is missing.");
  const headers = new Headers({ "Content-Type": r.mime, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (url.searchParams.has("download")) headers.set("Content-Disposition", `attachment; filename="${String(r.title).replace(/[^\w\- ]+/g, "").slice(0, 40) || "stage"}.${r.mime === "video/mp4" ? "mp4" : "webm"}"`);
  if (obj.range && request.headers.get("Range")) {
    const start = obj.range.offset ?? 0;
    const len = obj.range.length ?? (obj.size - start);
    headers.set("Content-Range", `bytes ${start}-${start + len - 1}/${obj.size}`);
    headers.set("Content-Length", String(len));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { headers });
}

// POST /api/recordings/:id/delete
export async function remove(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  if (!isMod(user)) throw new HttpError(403, "Only the Owner and staff can delete recordings.");
  const sql = getDb(env);
  const [r] = await sql`UPDATE stream_recordings SET deleted_at = now() WHERE id = ${Number(params.id) || 0} AND deleted_at IS NULL RETURNING r2_key, upload_id`;
  if (!r) throw new HttpError(404, "That recording isn't there.");
  if (env.RECORDINGS && r.r2_key) {
    if (r.upload_id) { try { await env.RECORDINGS.resumeMultipartUpload(r.r2_key, r.upload_id).abort(); } catch { /* gone */ } }
    await env.RECORDINGS.delete(r.r2_key).catch(() => {});
  }
  return json({ ok: true, message: "Recording deleted." });
}

// POST /api/recordings/episodes/:id/restore (a podcast episode a host removed)
export async function restoreEpisode(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  if (!isMod(user)) throw new HttpError(403, "Only the Owner and staff can do that.");
  const [e] = await getDb(env)`UPDATE stream_episodes SET deleted_at = NULL WHERE id = ${Number(params.id) || 0} RETURNING id`;
  if (!e) throw new HttpError(404, "That episode isn't there.");
  return json({ ok: true, message: "Episode restored." });
}
