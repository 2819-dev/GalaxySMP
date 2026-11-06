// Login sessions. The browser holds a random token in an HttpOnly cookie that page
// scripts can't read; the database only stores a SHA-256 hash of it.
import { getDb } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";
import { HttpError } from "./http.js";

const COOKIE = "gsmp_session";
const SESSION_DAYS = 30;

export function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
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
    SELECT u.id, u.username, u.platform, u.banned, u.ban_reason, u.muted_until, u.mute_reason,
           r.key AS role_key, r.name AS role_name, r.color AS role_color, r.power AS role_power
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN roles r ON r.id = u.role_id
     WHERE s.token_hash = ${await sha256(token)} AND s.expires_at > now()`;
  const u = rows[0];
  if (!u || u.banned) return null;
  return u;
}

export async function requireUser(request, env) {
  const user = await getUser(request, env);
  if (!user) throw new HttpError(401, "Please sign in first.");
  return user;
}

export function publicUser(u) {
  return {
    id: Number(u.id),
    username: u.username,
    platform: u.platform,
    role: { key: u.role_key, name: u.role_name, color: u.role_color, power: Number(u.role_power) },
    mutedUntil: u.muted_until && new Date(u.muted_until) > new Date() ? u.muted_until : null,
  };
}
