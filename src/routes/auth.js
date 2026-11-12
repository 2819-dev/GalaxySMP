// Accounts: create (via in-game /link code), sign in, sign out, who am I.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { linkCode, formatCode, randomToken, sha256 } from "../lib/crypto.js";
import { parseRequestedName, baseName } from "../lib/names.js";
import { createSession, destroySession, getUser, publicUser, sessionCookie, clearCookie } from "../lib/auth.js";
import { limit, clientIp } from "../lib/ratelimit.js";

const CODE_MINUTES = 10;
const BCRYPT_COST = 10;

function checkPassword(password, name) {
  const pw = String(password || "");
  const bytes = new TextEncoder().encode(pw).length;
  if (pw.length < 8) throw new HttpError(400, "Passwords must be at least 8 characters.");
  if (bytes > 72) throw new HttpError(400, "Passwords can be at most 72 characters.");
  if (pw.toLowerCase().includes(baseName(name))) throw new HttpError(400, "Your password cannot contain your username.");
  return pw;
}

// Step 1: the player picks a password and gets a one-time code to type in game.
export async function linkStart(request, env) {
  await limit(env, "AUTH_LIMITER", "start:" + clientIp(request));
  const body = await readJson(request);
  const parsed = parseRequestedName(body.username, body.platform);
  if (parsed.error) throw new HttpError(400, parsed.error);
  const password = checkPassword(body.password, parsed.name);
  const sql = getDb(env);

  const [{ recent }] = await sql`
    SELECT count(*)::int AS recent FROM link_codes
     WHERE lower(requested_name) = lower(${parsed.name}) AND created_at > now() - interval '10 minutes'`;
  if (recent >= 5) throw new HttpError(429, "Too many codes have been requested for this username. Please wait 10 minutes.");

  const pollToken = randomToken(24);
  const pollHash = await sha256(pollToken);
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = linkCode();
    try {
      const rows = await sql`
        INSERT INTO link_codes (code, requested_name, password_hash, expires_at, poll_token_hash)
        VALUES (${code}, ${parsed.name}, crypt(${password}, gen_salt('bf', ${BCRYPT_COST})),
                now() + make_interval(mins => ${CODE_MINUTES}), ${pollHash})
        RETURNING expires_at`;
      // Tidy up old codes now and then.
      if (Math.random() < 0.1) await sql`DELETE FROM link_codes WHERE expires_at < now() - interval '1 day'`;
      return json({
        ok: true,
        username: parsed.platform === "bedrock" ? String(body.username).trim().replace(/^[.*]+/, "") : parsed.name,
        code: formatCode(code),
        expiresAt: rows[0].expires_at,
        pollToken,
      });
    } catch (e) {
      if (!String(e.message).includes("link_codes_code_key")) throw e;
    }
  }
  throw new HttpError(500, "A code could not be generated. Please try again.");
}

// Step 2: the website asks every few seconds whether the player has typed /link yet.
// Once they have, this browser gets logged in.
export async function linkPoll(request, env) {
  await limit(env, "POLL_LIMITER", "poll:" + clientIp(request));
  const body = await readJson(request);
  const token = String(body.pollToken || "");
  if (!token || token.length > 100) throw new HttpError(400, "Missing code.");
  const sql = getDb(env);
  const rows = await sql`
    SELECT id, used_at, user_id, login_claimed_at, expires_at > now() AS active,
           used_at > now() - interval '30 minutes' AS fresh
      FROM link_codes WHERE poll_token_hash = ${await sha256(token)}`;
  const r = rows[0];
  if (!r) throw new HttpError(404, "Code not found.");
  if (!r.used_at) return json({ ok: true, status: r.active ? "waiting" : "expired" });
  if (r.login_claimed_at || !r.fresh) return json({ ok: true, status: "claimed" });

  const claimed = await sql`
    UPDATE link_codes SET login_claimed_at = now()
     WHERE id = ${r.id} AND login_claimed_at IS NULL RETURNING user_id`;
  if (!claimed.length) return json({ ok: true, status: "claimed" });

  const users = await sql`SELECT banned FROM users WHERE id = ${claimed[0].user_id}`;
  if (!users.length || users[0].banned) return json({ ok: true, status: "banned" });
  const sessionToken = await createSession(sql, claimed[0].user_id);
  return json({ ok: true, status: "linked" }, 200, { "Set-Cookie": sessionCookie(sessionToken) });
}

export async function login(request, env) {
  await limit(env, "AUTH_LIMITER", "login:" + clientIp(request));
  const body = await readJson(request);
  const name = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!name || !password || name.length > 32 || password.length > 200) {
    throw new HttpError(400, "Please enter your username and password.");
  }
  // Bedrock gamertags may be typed with spaces or underscores, with or without a leading dot.
  const base = name.replace(/^[.*]+/, "");
  const forms = new Set([base, base.replace(/_/g, " "), base.replace(/ /g, "_")]);
  const candidates = [...forms].flatMap((f) => [f, "." + f]);
  const sql = getDb(env);
  const rows = await sql`
    SELECT id, username_lower, banned, ban_reason,
           coalesce(locked_until > now(), false) AS locked,
           password_hash = crypt(${password}, password_hash) AS ok
      FROM users WHERE username_lower = ANY(${candidates})`;
  const user = rows.find((r) => r.ok) || rows.find((r) => r.username_lower === name) || rows[0];

  const wrong = "Incorrect username or password. New to GalaxySMP? Create an account first.";
  if (!user) throw new HttpError(401, wrong);
  if (user.locked) throw new HttpError(429, "Too many failed attempts. Please try again in 10 minutes.");
  if (!user.ok) {
    await sql`
      UPDATE users SET
        failed_logins = CASE WHEN failed_logins + 1 >= 5 THEN 0 ELSE failed_logins + 1 END,
        locked_until  = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '10 minutes' ELSE locked_until END
       WHERE id = ${user.id}`;
    throw new HttpError(401, wrong);
  }
  if (user.banned) {
    throw new HttpError(403, "This account has been banned from the community." + (user.ban_reason ? ` Reason: ${user.ban_reason}` : "") + " You can appeal at galaxymc.us/appeal.");
  }
  await sql`UPDATE users SET failed_logins = 0, locked_until = NULL, last_seen_at = now() WHERE id = ${user.id}`;
  const token = await createSession(sql, user.id);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
}

export async function logout(request, env) {
  await destroySession(request, env);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
}

export async function me(request, env) {
  const user = await getUser(request, env);
  return json({ ok: true, user: user ? publicUser(user) : null });
}
