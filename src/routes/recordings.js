// Stage recordings and podcast episodes uploaded to the website (Cloudflare R2, binding RECORDINGS).
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

// Recordings and podcast episodes share the free storage.
async function used(sql) {
  const [r] = await sql`SELECT (SELECT coalesce(sum(size), 0) FROM stream_recordings WHERE deleted_at IS NULL AND status <> 'failed')
                             + (SELECT coalesce(sum(size), 0) FROM stream_episodes WHERE r2_key IS NOT NULL AND status <> 'failed' AND size > 0) AS n`;
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
  // publish: the automatic recording of a live podcast (audio) or a live stream the host chose to save as a video
  const publish = Boolean(b.publish) && rights.manage && (s.kind === "podcast" || s.save_video);
  const audioOnly = publish && s.kind === "podcast";
  const mime = audioOnly ? (/^audio\/(webm|mp4|ogg)/.test(String(b.mime || "")) ? String(b.mime).split(";")[0] : "audio/webm")
    : /^video\/(webm|mp4)/.test(String(b.mime || "")) ? String(b.mime).split(";")[0] : "video/webm";
  const [row] = await sql`INSERT INTO stream_recordings (stream_id, user_id, title, mime, status, publish) VALUES (${s.id}, ${user.id}, ${s.title}, ${mime}, 'local', ${publish}) RETURNING id`;
  if (!env.RECORDINGS) return json({ ok: true, id: Number(row.id), upload: false, reason: "Recordings save to this device. (Uploading to GalaxySMP isn't switched on yet.)" });
  if (await used(sql) >= CAP_BYTES) return json({ ok: true, id: Number(row.id), upload: false, reason: "GalaxySMP's recording storage is full, so this one saves to this device only." });
  const key = `stage-${s.id}/${row.id}.${/mp4/.test(mime) ? (audioOnly ? "m4a" : "mp4") : /ogg/.test(mime) ? "ogg" : "webm"}`;
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
  const ep = r.publish ? await publishRecording(env, sql, r.id) : null;
  return json({ ok: true, uploaded: true, episode: ep });
}

// A finished automatic recording becomes an episode (Podcasts) or a saved stream (Live > Watch again).
// The file is the episode's now, so the recording row is hidden (and not counted twice in storage).
async function publishRecording(env, sql, id) {
  const [r] = await sql`UPDATE stream_recordings SET publish = false, deleted_at = now() WHERE id = ${id} AND publish AND status = 'done' RETURNING *`;
  if (!r) return null;
  const [s] = await sql`SELECT * FROM streams_v WHERE id = ${r.stream_id}`;
  if (!s) return null;
  const kind = s.kind === "podcast" ? "podcast" : "video";
  const seconds = r.seconds || (s.started_at && s.ended_at ? Math.round((new Date(s.ended_at) - new Date(s.started_at)) / 1000) : null);
  const [e] = await sql`INSERT INTO stream_episodes (host_user_id, team_id, title, description, created_by, mime, seconds, status, r2_key, size, kind, category, team_only, stream_id)
                        VALUES (${s.host_user_id}, ${s.team_id}, ${s.title}, ${s.description || ""}, ${s.created_by}, ${r.mime}, ${seconds}, 'ready', ${r.r2_key}, ${r.size}, ${kind}, ${s.category}, ${s.team_only}, ${s.id}) RETURNING id`;
  const who = s.team_id ? `[${s.team_tag}] ${s.team_name}` : s.host_name;
  const ids = s.team_only ? [] : (await sql`SELECT user_id FROM stream_follows WHERE host_user_id = ${s.host_user_id} OR team_id = ${s.team_id}`).map((x) => Number(x.user_id));
  const { notify } = await import("./notify.js");
  if (ids.length) await notify(env, ids, "streams", { title: kind === "podcast" ? `New episode from ${who}` : `${who}'s stream was saved`, body: s.title, url: `/community#stages/ep-${e.id}`, tag: `ep-${e.id}` }, { exclude: [s.created_by] }).catch(() => {});
  const { hubBroadcast } = await import("./chat.js");
  await hubBroadcast(env, { type: "streams_changed" }).catch(() => {});
  return Number(e.id);
}

// Every 5 minutes: an automatic recording whose host closed the page before it finished is finished here, from the
// pieces that were uploaded, so the episode isn't lost.
export async function finishStale(env, sql) {
  if (!env.RECORDINGS) return;
  const rows = await sql`SELECT r.* FROM stream_recordings r JOIN streams s ON s.id = r.stream_id
                          WHERE r.status = 'uploading' AND r.deleted_at IS NULL AND s.status = 'ended' AND s.ended_at < now() - interval '15 minutes' LIMIT 5`;
  for (const r of rows) {
    const parts = (r.parts || []).sort((a, b) => a.partNumber - b.partNumber);
    if (!parts.length) { await abortUpload(env, sql, r, "failed"); continue; }
    try { await env.RECORDINGS.resumeMultipartUpload(r.r2_key, r.upload_id).complete(parts); }
    catch (e) { console.error("finish stale recording", e); await abortUpload(env, sql, r, "failed"); continue; }
    await sql`UPDATE stream_recordings SET status = 'done', ended_at = now(), upload_id = NULL WHERE id = ${r.id}`;
    if (r.publish) await publishRecording(env, sql, r.id);
  }
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
    sql`SELECT e.id, e.kind, e.mime, e.title, e.description, e.r2_key, e.size, e.seconds, e.status, e.plays, e.created_at, e.deleted_at, cu.username AS by_name, hu.username AS host_name, t.name AS team_name, t.tag AS team_tag
          FROM stream_episodes e LEFT JOIN users cu ON cu.id = e.created_by LEFT JOIN users hu ON hu.id = e.host_user_id LEFT JOIN teams t ON t.id = e.team_id
         ORDER BY e.created_at DESC LIMIT 100`,
  ]);
  return json({
    ok: true, storageOn: Boolean(env.RECORDINGS), used: await used(sql), cap: CAP_BYTES,
    recordings: rows.map((r) => ({ id: Number(r.id), streamId: r.stream_id ? Number(r.stream_id) : null, title: r.title, by: r.username, mime: r.mime, size: Number(r.size),
      seconds: r.seconds, status: r.status, startedAt: r.started_at, endedAt: r.ended_at })),
    episodes: episodes.filter((e) => e.r2_key).map((e) => ({ id: Number(e.id), kind: e.kind, media: /^video\//.test(e.mime || "") ? "video" : "audio", title: e.title, description: e.description, audio: e.status === "ready" ? `/api/episodes/${e.id}/audio` : null,
      size: Number(e.size), seconds: e.seconds, status: e.status, plays: Number(e.plays), createdAt: e.created_at,
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

// ---------- podcast episodes (audio files) ----------
const VIDEO = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
const AUDIO = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/ogg": "ogg", "audio/opus": "opus", "audio/webm": "webm", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "video/webm": "webm" };
const MAX_EPISODE_BYTES = 300 * 1024 * 1024;

// POST /api/episodes/start { as, kind: podcast|more, title, description, category, teamOnly, chapters, mime, size, seconds } -> { id, partBytes }
export async function episodeStart(request, env) {
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  if (!env.RECORDINGS) throw new HttpError(503, "Episode uploads aren't switched on yet.");
  const b = await readJson(request, 4000);
  const sql = getDb(env);
  const { memberInfo, whoHosts } = await import("./streams.js");
  const m = await memberInfo(sql, user);
  if (m.banned) throw new HttpError(403, "You can't post episodes right now.");
  const { hostId, teamId } = await whoHosts(sql, env, user, m, String(b.as || "me"));
  const { checkMessage, compileWordList } = await import("../lib/filter.js");
  const words = compileWordList(await sql`SELECT word, match FROM filter_words WHERE NOT EXISTS (SELECT 1 FROM economy_config WHERE key = 'chatfilter_off')`);
  const clean = (t, max) => { const c = checkMessage(String(t || ""), words, { allowLinks: false, maxLength: max }); if (!c.ok) throw new HttpError(400, c.message || "That isn't allowed."); return c.text.replace(/\s+/g, " ").trim(); };
  const title = clean(b.title, 80);
  if (title.length < 3) throw new HttpError(400, "Give the episode a title (at least 3 characters).");
  const description = b.description ? clean(b.description, 300) : "";
  const kind = b.kind === "more" ? "more" : "podcast";
  const { CATEGORIES } = await import("./streams.js");
  const category = CATEGORIES.includes(b.category) ? b.category : null;
  const teamOnly = Boolean(teamId) && Boolean(b.teamOnly);
  let mime = String(b.mime || "").split(";")[0].toLowerCase();
  // a podcast is audio; More can be audio or video (a phone's .mov is fine too)
  const isVideo = kind === "more" && VIDEO[mime] && !b.audioOnly;
  if (kind === "podcast" && mime === "video/webm") mime = "audio/webm";   // recorded in the browser
  const ext = isVideo ? VIDEO[mime] : AUDIO[mime];
  if (!ext) throw new HttpError(400, kind === "more" ? "That file type isn't supported. Use an MP4, MOV or WEBM video, or an MP3, M4A, WAV or OGG audio file." : "That file type isn't supported. Use an MP3, M4A, WAV, OGG or WEBM audio file.");
  const chapters = [];
  for (const c of String(b.chapters || "").split(/\n/)) {
    const mm = c.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–:]?\s*(.+)$/);
    if (mm && chapters.length < 30) chapters.push({ t: Number(mm[1] || 0) * 3600 + Number(mm[2]) * 60 + Number(mm[3]), title: clean(mm[4], 60) });
  }
  chapters.sort((x, y) => x.t - y.t);
  const size = Math.round(Number(b.size) || 0);
  if (size < 1000) throw new HttpError(400, "That file is empty.");
  if (size > MAX_EPISODE_BYTES) throw new HttpError(413, isVideo ? "Videos can be up to 300 MB. Try a shorter clip or a lower quality." : "Episodes can be up to 300 MB. Try exporting it as an MP3.");
  if (await used(sql) + size > CAP_BYTES) throw new HttpError(507, "GalaxySMP's podcast storage is full right now. Please ask the Owner.");
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM stream_episodes WHERE created_by = ${user.id} AND created_at > now() - interval '1 day'`;
  if (n >= 10) throw new HttpError(429, "That's a lot of episodes today. Try again tomorrow.");
  const [row] = await sql`INSERT INTO stream_episodes (host_user_id, team_id, title, description, created_by, mime, seconds, status, kind, category, team_only, chapters)
                          VALUES (${hostId}, ${teamId}, ${title}, ${description}, ${user.id}, ${mime}, ${Math.round(Number(b.seconds) || 0) || null}, 'uploading', ${kind}, ${category}, ${teamOnly}, ${JSON.stringify(chapters)}::jsonb) RETURNING id`;
  const key = `episodes/${row.id}.${ext}`;
  const mpu = await env.RECORDINGS.createMultipartUpload(key, { httpMetadata: { contentType: mime } });
  await sql`UPDATE stream_episodes SET r2_key = ${key}, upload_id = ${mpu.uploadId} WHERE id = ${row.id}`;
  return json({ ok: true, id: Number(row.id), partBytes: PART_BYTES });
}

async function myEpisode(sql, user, id) {
  const [e] = await sql`SELECT * FROM stream_episodes WHERE id = ${Number(id) || 0} AND deleted_at IS NULL`;
  if (!e || Number(e.created_by) !== Number(user.id)) throw new HttpError(404, "That upload isn't yours.");
  return e;
}

// PUT /api/episodes/:id/part?n=1
export async function episodePart(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const e = await myEpisode(sql, user, params.id);
  if (e.status !== "uploading") throw new HttpError(409, "This episode isn't uploading.");
  const n = Number(url.searchParams.get("n"));
  if (!Number.isInteger(n) || n < 1 || n > 10000) throw new HttpError(400, "Bad piece number.");
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > PART_BYTES) throw new HttpError(400, "Bad piece size.");
  if (Number(e.size) + body.byteLength > MAX_EPISODE_BYTES) throw new HttpError(413, "That file is too large.");
  const done = await env.RECORDINGS.resumeMultipartUpload(e.r2_key, e.upload_id).uploadPart(n, body);
  await sql`UPDATE stream_episodes SET parts = parts || ${JSON.stringify([{ partNumber: done.partNumber, etag: done.etag }])}::jsonb, size = size + ${body.byteLength} WHERE id = ${e.id}`;
  return json({ ok: true });
}

// POST /api/episodes/:id/finish -> the episode goes live and followers hear about it
export async function episodeFinish(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const e = await myEpisode(sql, user, params.id);
  if (e.status !== "uploading") return json({ ok: true });
  const parts = (e.parts || []).sort((a, b) => a.partNumber - b.partNumber);
  if (!parts.length) throw new HttpError(400, "Nothing was uploaded.");
  await env.RECORDINGS.resumeMultipartUpload(e.r2_key, e.upload_id).complete(parts);
  await sql`UPDATE stream_episodes SET status = 'ready', upload_id = NULL, created_at = now() WHERE id = ${e.id}`;
  const [h] = await sql`SELECT u.username, t.name, t.tag FROM (SELECT 1) x LEFT JOIN users u ON u.id = ${e.host_user_id} LEFT JOIN teams t ON t.id = ${e.team_id}`;
  const who = e.team_id ? `[${h.tag}] ${h.name}` : h.username;
  const ids = e.team_only
    ? (await sql`SELECT u.id AS user_id FROM team_members tm JOIN players p ON p.xuid = tm.xuid JOIN users u ON u.mc_uuid = p.uuid WHERE tm.team_id = ${e.team_id}`).map((r) => Number(r.user_id))
    : (await sql`SELECT user_id FROM stream_follows WHERE host_user_id = ${e.host_user_id} OR team_id = ${e.team_id}`).map((r) => Number(r.user_id));
  const { notify } = await import("./notify.js");
  await notify(env, ids, "streams", { title: e.kind === "more" ? `New from ${who}` : `New episode from ${who}`, body: e.title, url: `/community#stages/ep-${e.id}`, tag: `ep-${e.id}` }, { exclude: [user.id] }).catch(() => {});
  const { hubBroadcast } = await import("./chat.js");
  await hubBroadcast(env, { type: "streams_changed" }).catch(() => {});
  return json({ ok: true, message: e.kind === "more" ? "Posted!" : "Episode posted!" });
}

// POST /api/episodes/:id/cancel (the upload failed or was stopped)
export async function episodeCancel(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const e = await myEpisode(sql, user, params.id);
  if (e.status === "uploading") {
    try { await env.RECORDINGS.resumeMultipartUpload(e.r2_key, e.upload_id).abort(); } catch { /* gone */ }
    await sql`UPDATE stream_episodes SET status = 'failed', size = 0, deleted_at = now() WHERE id = ${e.id}`;
  }
  return json({ ok: true });
}

// GET /api/episodes/:id/audio (signed-in members; supports seeking)
export async function episodeAudio(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  if (!env.RECORDINGS) throw new HttpError(404, "Episodes aren't available.");
  const sql = getDb(env);
  const [e] = await sql`SELECT r2_key, mime, deleted_at, team_only, team_id FROM stream_episodes WHERE id = ${Number(params.id) || 0} AND status = 'ready'`;
  if (!e || (e.deleted_at && !isMod(user))) throw new HttpError(404, "That episode isn't available.");
  if (e.team_only && !isMod(user)) {
    const { memberInfo } = await import("./streams.js");
    const m = await memberInfo(sql, user);
    if (!m.team || m.team.id !== Number(e.team_id)) throw new HttpError(403, "This is for the team's members only.");
  }
  const obj = await env.RECORDINGS.get(e.r2_key, { range: request.headers });
  if (!obj) throw new HttpError(404, "That episode file is missing.");
  const headers = new Headers({ "Content-Type": e.mime || "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
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

// POST /api/recordings/episodes/:id/purge (Owner/staff: delete a removed episode's file for good)
export async function purgeEpisode(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  if (!isMod(user)) throw new HttpError(403, "Only the Owner and staff can do that.");
  const sql = getDb(env);
  const [e] = await sql`UPDATE stream_episodes SET status = 'failed', size = 0, deleted_at = coalesce(deleted_at, now()) WHERE id = ${Number(params.id) || 0} RETURNING r2_key`;
  if (!e) throw new HttpError(404, "That episode isn't there.");
  if (env.RECORDINGS && e.r2_key) await env.RECORDINGS.delete(e.r2_key).catch(() => {});
  return json({ ok: true, message: "Episode deleted for good." });
}
