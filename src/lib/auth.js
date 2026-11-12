// Login sessions. The browser holds a random token in an HttpOnly cookie that page
// scripts can't read; the database only stores a SHA-256 hash of it.
import { getDb } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";
import { HttpError } from "./http.js";
import { isOwner } from "./names.js";
import { ALL_PERMS, PERM_KEYS, tierFor } from "./perms.js";

const COOKIE = "gsmp_session";
const SESSION_DAYS = 30;

export function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readCookie(request, name = COOKIE) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// "Act as Member": the owner's own session token waits in this cookie until they go back.
export const RETURN_COOKIE = "gsmp_return";
export const returnCookie = (token, maxAge) => `${RETURN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Is this request from a look-only "Act as Member" session? (Used to block every change.)
export async function isActingRequest(request, env) {
  const token = readCookie(request);
  if (!token || token.length > 100) return false;
  const [s] = await getDb(env)`SELECT acting_by FROM sessions WHERE token_hash = ${await sha256(token)}`;
  return Boolean(s?.acting_by);
}

export async function createSession(sql, userId) {
  const token = randomToken(32);
  const hash = await sha256(token);
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at)
            VALUES (${hash}, ${userId}, now() + make_interval(days => ${SESSION_DAYS}))`;
  return token;
}

export async function destroySession(request, env) {
  const token = readCookie(request);
  if (!token) return;
  const sql = getDb(env);
  await sql`DELETE FROM sessions WHERE token_hash = ${await sha256(token)}`;
}

// Returns the logged-in user (with role), or null.
export async function getUser(request, env) {
  const token = readCookie(request);
  if (!token || token.length > 100) return null;
  const sql = getDb(env);
  const rows = await sql`
    SELECT u.id, u.username, u.platform, u.banned, u.ban_reason, u.muted_until, u.mute_reason, s.acting_by,
           (SELECT username FROM users a WHERE a.id = s.acting_by) AS acting_by_name,
           r.key AS role_key, r.name AS role_name, r.color AS role_color, r.power AS role_power,
           (SELECT coalesce(array_agg(DISTINCT pm), '{}') FROM players pl JOIN player_ranks x ON x.xuid = pl.xuid JOIN ranks rk ON rk.id = x.rank_id,
                   unnest(rk.web_perms) pm WHERE pl.uuid = u.mc_uuid) AS web_perms
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN roles r ON r.id = u.role_id
     WHERE s.token_hash = ${await sha256(token)} AND s.expires_at > now()`;
  const u = rows[0];
  if (!u || u.banned) return null;
  // Website permissions come from the member's ranks (the owner has all). role_power is worked out from them
  // (Admin Panel = 100, Mod Panel = 50) so every page agrees with the ranks.
  u.owner = isOwner(env, u.username, u.platform === "bedrock");
  u.perms = u.owner ? ALL_PERMS : (u.web_perms || []).filter((p) => PERM_KEYS.has(p));
  u.role_power = u.owner ? 100 : Math.max(tierFor(u.perms), Number(u.role_power) < 50 ? Number(u.role_power) : 10);
  return u;
}

export async function requireUser(request, env) {
  const user = await getUser(request, env);
  if (!user) throw new HttpError(401, "Please sign in to continue.");
  return user;
}

export function publicUser(u) {
  return {
    id: Number(u.id),
    username: u.username,
    platform: u.platform,
    role: { key: u.role_key, name: u.role_name, color: u.role_color, power: Number(u.role_power) },
    perms: u.perms || [], owner: Boolean(u.owner),
    acting: u.acting_by ? { by: u.acting_by_name } : null,  // the owner is looking at the site as this member
    mutedUntil: u.muted_until && new Date(u.muted_until) > new Date() ? u.muted_until : null,
  };
}
