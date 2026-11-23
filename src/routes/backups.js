// World backups. The plugin makes a backup every night (and on "Back up now"), keeps 3 on the server and uploads the
// newest here in parts (R2 multipart upload, private bucket, prefix backups/). We keep the newest 3 too.
// The owner can restore one from Control Panel > Server control > Backups: the plugin downloads it and the world is
// swapped on the next server start.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { checkSecret } from "./plugin.js";
import { requireOwner } from "./servercontrol.js";
import { toPlugin } from "./economy.js";

const PREFIX = "backups/";
const KEEP = 3;
const bucket = (env) => {
  if (!env.RECORDINGS) throw new HttpError(503, "Storage isn't set up on the website.");
  return env.RECORDINGS;
};
const validKey = (key) => typeof key === "string" && key.startsWith(PREFIX) && /^backups\/[\w.-]{1,120}\.zip$/.test(key);

async function listBackups(env) {
  const out = [];
  let cursor;
  do {
    const page = await bucket(env).list({ prefix: PREFIX, cursor });
    out.push(...page.objects.map((o) => ({ key: o.key, size: o.size, at: o.uploaded.toISOString(), name: o.key.slice(PREFIX.length) })));
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

// ---------- from the plugin ----------
// POST /api/plugin/backup/start { name, size } -> { key, uploadId }
export async function start(request, env) {
  await checkSecret(request, env);
  const b = await readJson(request);
  const name = String(b.name || "").replace(/[^\w.-]/g, "_").slice(0, 100);
  if (!name.endsWith(".zip")) throw new HttpError(400, "Bad backup name.");
  const key = PREFIX + name;
  const up = await bucket(env).createMultipartUpload(key, { httpMetadata: { contentType: "application/zip" } });
  return json({ ok: true, key, uploadId: up.uploadId });
}

// PUT /api/plugin/backup/part?key&uploadId&part=n   (raw bytes) -> { etag }
export async function part(request, env, ctx, url) {
  await checkSecret(request, env);
  const key = url.searchParams.get("key"), uploadId = url.searchParams.get("uploadId"), n = Number(url.searchParams.get("part"));
  if (!validKey(key) || !uploadId || !(n >= 1 && n <= 10000)) throw new HttpError(400, "Bad upload part.");
  const up = bucket(env).resumeMultipartUpload(key, uploadId);
  const res = await up.uploadPart(n, request.body);
  return json({ ok: true, etag: res.etag });
}

// POST /api/plugin/backup/complete { key, uploadId, parts }
export async function complete(request, env) {
  await checkSecret(request, env);
  const b = await readJson(request, 1 << 20);
  if (!validKey(b.key) || !b.uploadId || !Array.isArray(b.parts) || !b.parts.length) throw new HttpError(400, "Bad upload.");
  const up = bucket(env).resumeMultipartUpload(b.key, b.uploadId);
  await up.complete(b.parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
  // keep the newest 3
  const all = await listBackups(env);
  for (const old of all.slice(KEEP)) await bucket(env).delete(old.key).catch(() => {});
  const sql = getDb(env);
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (NULL, 'backup.saved', ${JSON.stringify({ key: b.key, size: Number(b.size) || 0 })}::jsonb)`.catch(() => {});
  return json({ ok: true });
}

// GET /api/plugin/backup/download?key=
export async function download(request, env, ctx, url) {
  await checkSecret(request, env);
  const key = url.searchParams.get("key");
  if (!validKey(key)) throw new HttpError(400, "Bad backup.");
  const obj = await bucket(env).get(key);
  if (!obj) throw new HttpError(404, "That backup doesn't exist any more.");
  return new Response(obj.body, { headers: { "Content-Type": "application/zip", "Content-Length": String(obj.size) } });
}

// ---------- Control Panel (owner) ----------
// GET /api/panel/backups
export async function list(request, env) {
  await requireOwner(request, env);
  const sql = getDb(env);
  const [st] = await sql`SELECT value FROM economy_config WHERE key = 'backup_restore'`;
  return json({ ok: true, backups: await listBackups(env), restore: st?.value || null });
}

// POST /api/panel/backups { action: "now" } | { action: "restore", key }
export async function act(request, env) {
  const user = await requireOwner(request, env);
  const b = await readJson(request);
  const sql = getDb(env);
  if (b.action === "now") {
    const sent = await toPlugin(env, { type: "backup_now" });
    if (!sent) throw new HttpError(409, "The server is offline, so it can't make a backup right now.");
    await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'backup.now', '{}'::jsonb)`;
    return json({ ok: true, message: "Backing up now. It shows up here in a few minutes (bigger worlds take longer)." });
  }
  if (b.action === "restore") {
    if (!validKey(b.key) || !(await bucket(env).head(b.key))) throw new HttpError(404, "That backup doesn't exist any more.");
    const sent = await toPlugin(env, { type: "backup_restore", key: b.key, by: user.username });
    if (!sent) throw new HttpError(409, "The server is offline. Start it, then try again.");
    await sql`INSERT INTO economy_config (key, value, updated_by) VALUES ('backup_restore', ${JSON.stringify({ key: b.key, at: new Date().toISOString(), by: user.username })}::jsonb, ${user.username})
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
    await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'backup.restore', ${JSON.stringify({ key: b.key })}::jsonb)`;
    return json({ ok: true, message: "The server is downloading that backup. Restart the server to put it back (the current world is kept as a copy)." });
  }
  throw new HttpError(400, "Unknown action.");
}
