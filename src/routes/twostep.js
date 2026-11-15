// Optional two-step sign-in: members can turn on codes from an authenticator app (Account settings > Security).
// With it on, signing in with a password asks for a 6-digit code (or a one-time backup code) as well.
// (Signing in by typing a code in Minecraft already proves it's you, so that way doesn't ask.)
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser, createSession, sessionCookie } from "../lib/auth.js";
import { limit } from "../lib/ratelimit.js";
import { sha256 } from "../lib/crypto.js";
import { newSecret, matchStep, otpauthUrl } from "../lib/totp.js";

const BACKUP_COUNT = 8;
const backupCodes = () => Array.from({ length: BACKUP_COUNT }, () => {
  const b = crypto.getRandomValues(new Uint8Array(5));
  const s = [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 8).toUpperCase();
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
});
const normBackup = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// A code from the app, or a backup code (used up). Returns true when it's good.
async function checkCode(sql, user, code) {
  const step = await matchStep(user.totp_secret, code);
  if (step !== null) {
    // each code works once
    const [ok] = await sql`UPDATE users SET totp_last_step = ${step} WHERE id = ${user.id} AND (totp_last_step IS NULL OR totp_last_step < ${step}) RETURNING id`;
    return Boolean(ok);
  }
  const b = normBackup(code);
  if (b.length !== 8) return false;
  const hash = await sha256(`backup:${user.id}:${b}`);
  const [used] = await sql`UPDATE users SET totp_backup = array_remove(totp_backup, ${hash}) WHERE id = ${user.id} AND ${hash} = ANY(totp_backup) RETURNING id`;
  return Boolean(used);
}

async function hashBackups(userId, codes) {
  return Promise.all(codes.map((c) => sha256(`backup:${userId}:${normBackup(c)}`)));
}

// GET /api/account/2fa
export async function status(request, env) {
  const user = await requireUser(request, env);
  const [u] = await getDb(env)`SELECT totp_enabled_at, cardinality(totp_backup) AS backups FROM users WHERE id = ${user.id}`;
  return json({ ok: true, on: Boolean(u.totp_enabled_at), since: u.totp_enabled_at, backupsLeft: Number(u.backups || 0) });
}

// POST /api/account/2fa { action: "start" | "enable" | "disable" | "backups", code }
export async function action(request, env) {
  const user = await requireUser(request, env);
  if (user.acting_by) throw new HttpError(403, "You can't change two-step sign-in while acting as a member.");
  await limit(env, "AUTH_LIMITER", `2fa:${user.id}`);
  const body = await readJson(request);
  const sql = getDb(env);
  const [u] = await sql`SELECT id, username, totp_secret, totp_enabled_at, totp_last_step FROM users WHERE id = ${user.id}`;
  if (body.action === "start") {
    if (u.totp_enabled_at) throw new HttpError(409, "Two-step sign-in is already on.");
    const secret = newSecret();
    await sql`UPDATE users SET totp_secret = ${secret}, totp_last_step = NULL WHERE id = ${user.id}`;
    return json({ ok: true, secret, url: otpauthUrl(secret, u.username) });
  }
  if (body.action === "enable") {
    if (u.totp_enabled_at) throw new HttpError(409, "Two-step sign-in is already on.");
    if (!u.totp_secret) throw new HttpError(400, "Start the setup again.");
    if (!(await checkCode(sql, u, body.code))) throw new HttpError(400, "That code isn't right. Check the time on your phone and try the newest code.");
    const codes = backupCodes();
    await sql`UPDATE users SET totp_enabled_at = now(), totp_backup = ${await hashBackups(user.id, codes)} WHERE id = ${user.id}`;
    await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, '2fa.enable', '{}'::jsonb)`;
    return json({ ok: true, backupCodes: codes, message: "Two-step sign-in is on." });
  }
  if (body.action === "disable" || body.action === "backups") {
    if (!u.totp_enabled_at) throw new HttpError(409, "Two-step sign-in is off.");
    if (!(await checkCode(sql, u, body.code))) throw new HttpError(400, "That code isn't right.");
    if (body.action === "disable") {
      await sql`UPDATE users SET totp_enabled_at = NULL, totp_secret = NULL, totp_backup = '{}', totp_last_step = NULL WHERE id = ${user.id}`;
      await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, '2fa.disable', '{}'::jsonb)`;
      return json({ ok: true, message: "Two-step sign-in is off." });
    }
    const codes = backupCodes();
    await sql`UPDATE users SET totp_backup = ${await hashBackups(user.id, codes)} WHERE id = ${user.id}`;
    return json({ ok: true, backupCodes: codes, message: "New backup codes made. The old ones no longer work." });
  }
  throw new HttpError(400, "Unknown action.");
}

// Called by login after the password was right: returns a challenge when the account has two-step on.
export async function challengeFor(sql, userId) {
  const [u] = await sql`SELECT totp_enabled_at FROM users WHERE id = ${userId}`;
  if (!u?.totp_enabled_at) return null;
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await sql`DELETE FROM login_challenges WHERE created_at < now() - interval '1 hour'`;
  await sql`INSERT INTO login_challenges (token, user_id) VALUES (${await sha256(token)}, ${userId})`;
  return token;
}

// POST /api/auth/login/2fa { challenge, code }
export async function finishLogin(request, env) {
  const body = await readJson(request);
  const token = String(body.challenge || "");
  if (!token || token.length > 100) throw new HttpError(400, "Sign in again.");
  const sql = getDb(env);
  const hash = await sha256(token);
  const [c] = await sql`UPDATE login_challenges SET tries = tries + 1 WHERE token = ${hash} AND created_at > now() - interval '10 minutes' RETURNING user_id, tries`;
  if (!c) throw new HttpError(401, "That sign-in timed out. Enter your password again.");
  if (c.tries > 5) {
    await sql`DELETE FROM login_challenges WHERE token = ${hash}`;
    throw new HttpError(429, "Too many wrong codes. Enter your password again.");
  }
  const [u] = await sql`SELECT id, banned, totp_secret, totp_last_step FROM users WHERE id = ${c.user_id}`;
  if (!u || u.banned) throw new HttpError(403, "This account can't sign in.");
  if (!(await checkCode(sql, u, body.code))) throw new HttpError(401, "That code isn't right. Try the newest code in your authenticator app, or a backup code.");
  await sql`DELETE FROM login_challenges WHERE token = ${hash}`;
  await sql`UPDATE users SET last_seen_at = now() WHERE id = ${u.id}`;
  const session = await createSession(sql, u.id);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(session) });
}
