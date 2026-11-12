// "Act as Member" (Control Panel > Members, owner only): see the website exactly as another member does.
// It's look-only: the session can't change anything (the website and chat refuse every change).
// "Sign out" (or "Back to my account" in the banner) ends it and signs the owner back into their own account.
import { getDb } from "../lib/db.js";
import { json, HttpError } from "../lib/http.js";
import { requireUser, readCookie, sessionCookie, clearCookie, RETURN_COOKIE, returnCookie } from "../lib/auth.js";
import { isOwner } from "../lib/names.js";
import { randomToken, sha256 } from "../lib/crypto.js";

const HOURS = 2;

// POST /api/mod/act-as/:id
export async function startActing(request, env, ctx, url, params) {
  const me = await requireUser(request, env);
  if (me.acting_by) throw new HttpError(400, "Go back to your own account first.");
  if (!isOwner(env, me.username, me.platform === "bedrock")) throw new HttpError(403, "Only the owner can act as a member.");
  const sql = getDb(env);
  const [target] = await sql`SELECT id, username, platform FROM users WHERE id = ${Number(params.id) || 0}`;
  if (!target) throw new HttpError(404, "That member doesn't exist.");
  if (Number(target.id) === Number(me.id)) throw new HttpError(400, "That's you.");
  const token = randomToken(32);
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at, acting_by)
            VALUES (${await sha256(token)}, ${target.id}, now() + make_interval(hours => ${HOURS}), ${me.id})`;
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${me.id}, 'act_as.start', ${JSON.stringify({ member: target.username })}::jsonb)`;
  const own = readCookie(request);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", returnCookie(own, HOURS * 3600));
  headers.append("Set-Cookie", sessionCookie(token).replace(/Max-Age=\d+/, `Max-Age=${HOURS * 3600}`));
  return new Response(JSON.stringify({ ok: true, message: `You're now seeing GalaxySMP as ${target.username}.` }), { headers });
}

// Ends an acting session: back into the owner's own account. Returns the response, or null if not acting.
export async function stopActing(request, env) {
  const token = readCookie(request);
  if (!token) return null;
  const sql = getDb(env);
  const [s] = await sql`SELECT acting_by FROM sessions WHERE token_hash = ${await sha256(token)}`;
  if (!s?.acting_by) return null;
  await sql`DELETE FROM sessions WHERE token_hash = ${await sha256(token)}`;
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", returnCookie("", 0));
  const own = readCookie(request, RETURN_COOKIE);
  const [mine] = own ? await sql`SELECT user_id FROM sessions WHERE token_hash = ${await sha256(own)} AND expires_at > now()` : [];
  if (mine && Number(mine.user_id) === Number(s.acting_by)) {
    headers.append("Set-Cookie", sessionCookie(own));
    await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${s.acting_by}, 'act_as.stop', '{}'::jsonb)`;
    return new Response(JSON.stringify({ ok: true, backToOwner: true, url: "/staff#players" }), { headers });
  }
  headers.append("Set-Cookie", clearCookie());  // their own session ended meanwhile: just signed out
  return new Response(JSON.stringify({ ok: true, backToOwner: false }), { headers });
}

// POST /api/act-as/stop
export async function stopActingRoute(request, env) {
  return (await stopActing(request, env)) || json({ ok: true, backToOwner: false });
}
