// Pictures members upload:
//   chat pictures  - staff, Galaxy+ and Galaxy Pro+ (attach a picture to a chat message)
//   profile banner - staff, Galaxy+ and Galaxy Pro+ (the picture at the top of their profile)
//   profile picture - Galaxy Pro+ (and Admins)
// They show right away. Staff can remove any of them and stop a member from uploading.
import { can } from "../lib/perms.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { setPicture } from "./heads.js";

const STAFF = 50;
const ADMIN = 100;
const MAX_BYTES = 700 * 1024;
const MAGIC = { "image/jpeg": [0xff, 0xd8], "image/webp": [0x52, 0x49], "image/png": [0x89, 0x50] };

export function readImage(img, maxBytes = MAX_BYTES) {
  const mime = String(img?.mime || "");
  const magic = MAGIC[mime];
  if (!magic) throw new HttpError(400, "Pictures must be JPEG, WebP or PNG.");
  const b64 = String(img.data || "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4) throw new HttpError(400, "That picture couldn't be read.");
  if ((b64.length * 3) / 4 > maxBytes) throw new HttpError(400, "That picture is too large. Try a smaller one.");
  let head;
  try { head = atob(b64.slice(0, 8)); } catch { throw new HttpError(400, "That picture couldn't be read."); }
  if (head.charCodeAt(0) !== magic[0] || head.charCodeAt(1) !== magic[1]) throw new HttpError(400, "That picture couldn't be read.");
  const w = Math.round(Number(img.width)), h = Math.round(Number(img.height));
  if (!(w > 0 && w <= 4096 && h > 0 && h <= 4096)) throw new HttpError(400, "That picture couldn't be read.");
  return { mime, w, h, b64 };
}

// What this member may upload.
export async function uploadRights(sql, user) {
  const [r] = await sql`SELECT u.uploads_blocked, p.xuid,
                               (SELECT s.plan FROM subscriptions s WHERE s.xuid = p.xuid AND (s.expires_at IS NULL OR s.expires_at > now())) AS plan
                          FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  const staff = false;  // pictures are a rank permission (or a Galaxy+ / Pro+ perk)
  const plan = r?.plan || null;
  const blocked = Boolean(r?.uploads_blocked);
  return {
    plan, blocked, xuid: r?.xuid || null,
    chat: !blocked && (can(user, "chat_pictures") || plan === "plus" || plan === "pro"),
    banner: !blocked && (can(user, "chat_pictures") || plan === "plus" || plan === "pro"),
    picture: !blocked && Boolean(r?.xuid) && (plan === "pro" || user.owner),
  };
}

function serve(row, cache = "private, max-age=604800, immutable") {
  if (!row) return new Response("Not found", { status: 404 });
  const bytes = Uint8Array.from(atob(row.b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { "Content-Type": row.mime, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" } });
}

// GET /api/uploads/rights
export async function rights(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const r = await uploadRights(sql, user);
  const [u] = await sql`SELECT u.id, u.banner_at, (u.banner IS NOT NULL) AS has_banner, p.pic_source, (p.custom_pic IS NOT NULL) AS has_pic
                          FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  return json({ ok: true, chat: r.chat, banner: r.banner, picture: r.picture, plan: r.plan, blocked: r.blocked, linked: Boolean(r.xuid),
    bannerUrl: bannerUrl(u), picSource: u.pic_source || "auto", hasPicture: Boolean(u.has_pic) });
}

// ---------- chat pictures ----------
// POST /api/chat/images { mime, data, width, height } -> { id }; then the message is sent with imageId.
export async function uploadChatImage(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const r = await uploadRights(sql, user);
  if (r.blocked) throw new HttpError(403, "Staff turned off picture uploads for your account.");
  if (!r.chat) throw new HttpError(403, "Pictures in chat are a Galaxy+ and Galaxy Pro+ perk.");
  await rateLimit(env, "AUTH_LIMITER", `chatimg:${user.id}`);
  const img = readImage(await readJson(request, 1_000_000));
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM message_images WHERE user_id = ${user.id} AND created_at > now() - interval '1 hour'`;
  if (n >= 30) throw new HttpError(429, "You've shared a lot of pictures this hour. Try again later.");
  const [row] = await sql`INSERT INTO message_images (user_id, mime, width, height, data) VALUES (${user.id}, ${img.mime}, ${img.w}, ${img.h}, decode(${img.b64}, 'base64')) RETURNING id`;
  return json({ ok: true, id: Number(row.id), width: img.w, height: img.h });
}

// GET /api/chat/images/:id  (members only)
export async function chatImage(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const staff = can(user, "staff_chat");
  const [row] = await getDb(env)`
    SELECT i.mime, encode(i.data, 'base64') AS b64 FROM message_images i
     WHERE i.id = ${Number(params.id) || 0}
       AND (EXISTS (SELECT 1 FROM messages m JOIN channels c ON c.id = m.channel_id
                     WHERE m.image_id = i.id AND m.deleted_at IS NULL AND (NOT c.staff_only OR ${staff}))
            OR (i.user_id = ${user.id} AND i.created_at > now() - interval '10 minutes'))`;
  return serve(row);
}

// ---------- profile banner ----------
// POST /api/account/banner { image } or { remove: true }
export async function saveBanner(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const body = await readJson(request, 1_000_000);
  if (body.remove) {
    await sql`UPDATE users SET banner = NULL, banner_type = NULL, banner_at = now() WHERE id = ${user.id}`;
    return json({ ok: true });
  }
  const r = await uploadRights(sql, user);
  if (r.blocked) throw new HttpError(403, "Staff turned off picture uploads for your account.");
  if (!r.banner) throw new HttpError(403, "Profile banners are a Galaxy+ and Galaxy Pro+ perk.");
  await rateLimit(env, "AUTH_LIMITER", `banner:${user.id}`);
  const img = readImage(body.image);
  await sql`UPDATE users SET banner = decode(${img.b64}, 'base64'), banner_type = ${img.mime}, banner_at = now() WHERE id = ${user.id}`;
  return json({ ok: true });
}

// GET /api/banner/:userId?v=  (members only)
export async function banner(request, env, ctx, url, params) {
  await requireUser(request, env);
  const [row] = await getDb(env)`SELECT banner_type AS mime, encode(banner, 'base64') AS b64 FROM users WHERE id = ${Number(params.id) || 0} AND banner IS NOT NULL`;
  return serve(row);
}

export const bannerUrl = (u) => (u.banner_at && u.has_banner ? `/api/banner/${u.id}?v=${new Date(u.banner_at).getTime()}` : null);

// ---------- own profile picture (Galaxy Pro+) ----------
// POST /api/account/picture { image } or { source: "auto" | "xbox" | "head" }
export async function savePicture(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const r = await uploadRights(sql, user);
  const body = await readJson(request, 600_000);
  if (!r.xuid) throw new HttpError(400, "Link your Minecraft account first (Account > Link).");
  if (body.image) {
    if (r.blocked) throw new HttpError(403, "Staff turned off picture uploads for your account.");
    if (!r.picture) throw new HttpError(403, "Your own profile picture is a Galaxy Pro+ perk.");
    await rateLimit(env, "AUTH_LIMITER", `pic:${user.id}`);
    const img = readImage(body.image, 300 * 1024);
    await setPicture(env, sql, r.xuid, { source: "custom", image: { mime: img.mime, data: img.b64 } });
  } else {
    const source = ["auto", "xbox", "head", "custom"].includes(body.source) ? body.source : "auto";  // custom: the picture already uploaded
    await setPicture(env, sql, r.xuid, { source });
  }
  return json({ ok: true });
}

// ---------- staff ----------
// POST /api/mod/users/:id/uploads { action: "remove-banner" | "remove-picture" | "block" | "unblock" }
export async function modUploads(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  if (!can(me, "remove_pictures")) throw new HttpError(403, "Your rank can't remove pictures.");
  const sql = getDb(env);
  const id = Number(params.id) || 0;
  const { action } = await readJson(request);
  const [u] = await sql`SELECT u.id, u.username, p.xuid FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${id}`;
  if (!u) throw new HttpError(404, "That member doesn't exist.");
  if (action === "remove-banner") await sql`UPDATE users SET banner = NULL, banner_type = NULL, banner_at = now() WHERE id = ${id}`;
  else if (action === "remove-picture") {
    if (u.xuid) await sql`UPDATE players SET custom_pic = NULL, custom_pic_type = NULL, pic_source = 'auto', gamerpic_at = now(),
                                head_at = CASE WHEN head IS NOT NULL THEN now() ELSE head_at END WHERE xuid = ${u.xuid}`;
  } else if (action === "block" || action === "unblock") await sql`UPDATE users SET uploads_blocked = ${action === "block"} WHERE id = ${id}`;
  else throw new HttpError(400, "Unknown action.");
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${me.id}, ${`uploads.${action}`}, ${JSON.stringify({ member: u.username })}::jsonb)`;
  return json({ ok: true, message: { "remove-banner": "Banner removed.", "remove-picture": "Profile picture removed.", block: `${u.username} can't upload pictures any more.`, unblock: `${u.username} can upload pictures again.` }[action] });
}
