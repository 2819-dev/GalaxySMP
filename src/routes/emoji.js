// Custom server emoji (:creeper:, :diamond:...). Admins add them in the Control Panel; members use
// them in community chat, DMs and reactions (written as :name:).
import { can } from "../lib/perms.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { Buffer } from "node:buffer";

export const NAME_RE = /^[a-z0-9_]{2,24}$/;
const MAX_EMOJI = 100;

export async function emojiNames(sql) {
  return (await sql`SELECT name FROM emoji`).map((r) => r.name);
}

// GET /api/emoji: every custom emoji (name + picture address)
export async function listEmoji(request, env) {
  await requireUser(request, env);
  const sql = getDb(env);
  const rows = await sql`SELECT name, extract(epoch FROM created_at)::bigint AS v FROM emoji ORDER BY name`;
  return json({ ok: true, emoji: rows.map((r) => ({ name: r.name, url: `/api/emoji/${r.name}?v=${r.v}` })) });
}

// GET /api/emoji/:name  (the picture)
export async function emojiImage(request, env, ctx, url, params) {
  const name = String(params.name || "").toLowerCase();
  if (!NAME_RE.test(name)) return new Response("Not found", { status: 404 });
  const [e] = await getDb(env)`SELECT mime, data FROM emoji WHERE name = ${name}`;
  if (!e) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(e.data, "base64"), { headers: { "Content-Type": e.mime, "Cache-Control": "public, max-age=604800, immutable", "X-Content-Type-Options": "nosniff" } });
}

async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (!can(user, "custom_emoji")) throw new HttpError(403, "Your rank can't manage emoji.");
  return user;
}

// POST /api/panel/emoji { name, image: { mime, data } }
export async function addEmoji(request, env) {
  const user = await requireAdmin(request, env);
  const body = await readJson(request, 200_000);
  const name = String(body.name || "").trim().toLowerCase().replace(/^:|:$/g, "");
  if (!NAME_RE.test(name)) throw new HttpError(400, "Names use 2 to 24 lowercase letters, numbers or _ (like creeper or gold_ingot).");
  const mime = String(body.image?.mime || "");
  const data = String(body.image?.data || "").replace(/\s+/g, "");
  if (!/^image\/(png|webp|gif)$/.test(mime)) throw new HttpError(400, "Emoji must be PNG, WebP or GIF.");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > 140_000) throw new HttpError(400, "That picture is too large (up to about 100 KB).");
  const sql = getDb(env);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM emoji`;
  if (n >= MAX_EMOJI) throw new HttpError(409, `You can have up to ${MAX_EMOJI} emoji. Remove one first.`);
  const [row] = await sql`INSERT INTO emoji (name, mime, data, created_by) VALUES (${name}, ${mime}, ${data}, ${user.id}) ON CONFLICT (name) DO NOTHING RETURNING name`;
  if (!row) throw new HttpError(409, `:${name}: already exists.`);
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'emoji.add', ${JSON.stringify({ name })}::jsonb)`;
  return json({ ok: true });
}

// POST /api/panel/emoji/:name/delete
export async function deleteEmoji(request, env, ctx, url, params) {
  const user = await requireAdmin(request, env);
  const name = String(params.name || "").toLowerCase();
  const sql = getDb(env);
  const [row] = await sql`DELETE FROM emoji WHERE name = ${name} RETURNING name`;
  if (!row) throw new HttpError(404, "That emoji no longer exists.");
  await sql`DELETE FROM reactions WHERE emoji = ${`:${name}:`}`;
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'emoji.delete', ${JSON.stringify({ name })}::jsonb)`;
  return json({ ok: true });
}
