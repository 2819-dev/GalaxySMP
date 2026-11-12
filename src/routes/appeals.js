// Ban appeals: a banned player (game, website or both) explains on /appeal without signing in.
// Staff answer in the Control Panel (Moderation > Appeals); accepting can lift the ban.
// The person keeps a private link (random token) to check the answer.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { limit as rateLimit, clientIp } from "../lib/ratelimit.js";
import { isOwner } from "../lib/names.js";
import { toPlugin } from "./economy.js";

const ADMIN = 100;
const STAFF = 50;

function token() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function bansFor(sql, gamertag) {
  const name = String(gamertag).replace(/^\./, "").trim();
  const [p] = await sql`SELECT xuid, gamertag, uuid FROM players WHERE lower(gamertag) = lower(${name})`;
  const [u] = await sql`SELECT id, username, banned FROM users
                         WHERE banned AND (username_lower = lower(${name}) OR (${p?.uuid || null}::text IS NOT NULL AND mc_uuid = ${p?.uuid || null}))
                         LIMIT 1`;
  const [g] = p ? await sql`SELECT kind FROM game_punishments WHERE xuid = ${p.xuid} AND kind IN ('ban', 'unban') ORDER BY id DESC LIMIT 1` : [];
  return { player: p || null, websiteUser: u || null, game: g?.kind === "ban", website: Boolean(u) };
}

// POST /api/appeals { gamertag, which, message } (no sign-in: banned people can't sign in)
export async function createAppeal(request, env) {
  await rateLimit(env, "AUTH_LIMITER", `appeal:${clientIp(request)}`);
  const body = await readJson(request);
  const gamertag = String(body.gamertag || "").replace(/\s+/g, " ").trim().slice(0, 32);
  const message = String(body.message || "").replace(/\r/g, "").trim().slice(0, 1500);
  if (gamertag.length < 2) throw new HttpError(400, "Enter your Xbox gamertag.");
  if (message.length < 30) throw new HttpError(400, "Explain what happened in at least a few sentences (30 characters or more).");
  const sql = getDb(env);
  const bans = await bansFor(sql, gamertag);
  if (!bans.game && !bans.website) throw new HttpError(404, "We couldn't find a ban for that gamertag. Check the spelling, including spaces.");
  const which = bans.game && bans.website ? "both" : bans.game ? "game" : "website";
  const [open] = await sql`SELECT id FROM appeals WHERE lower(gamertag) = lower(${gamertag}) AND status = 'open'`;
  if (open) throw new HttpError(409, "There's already an open appeal for this gamertag. Use the link you got to check on it.");
  const [recent] = await sql`SELECT count(*)::int AS n FROM appeals WHERE lower(gamertag) = lower(${gamertag}) AND created_at > now() - interval '7 days'`;
  if (recent.n >= 2) throw new HttpError(429, "You can appeal twice a week. Please wait before appealing again.");
  const t = token();
  await sql`INSERT INTO appeals (token, gamertag, xuid, which, message) VALUES (${t}, ${bans.player?.gamertag || gamertag}, ${bans.player?.xuid || null}, ${which}, ${message})`;
  return json({ ok: true, token: t });
}

// GET /api/appeals/:token
export async function getAppeal(request, env, ctx, url, params) {
  const t = String(params.token || "");
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(t)) throw new HttpError(404, "Appeal not found.");
  const sql = getDb(env);
  const [a] = await sql`SELECT gamertag, which, message, status, staff_reply, created_at, handled_at FROM appeals WHERE token = ${t}`;
  if (!a) throw new HttpError(404, "Appeal not found.");
  return json({ ok: true, appeal: { gamertag: a.gamertag, which: a.which, message: a.message, status: a.status, reply: a.staff_reply, createdAt: a.created_at, answeredAt: a.handled_at } });
}

// ---------- staff ----------
async function requireStaff(request, env, power = STAFF) {
  const user = await requireUser(request, env);
  if (Number(user.role_power) < power) throw new HttpError(403, power >= ADMIN ? "Only Admins can do that." : "Only staff can see appeals.");
  return user;
}

// GET /api/mod/appeals?status=open
export async function listAppeals(request, env, ctx, url) {
  const user = await requireStaff(request, env);
  const status = ["open", "accepted", "declined"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "open";
  const sql = getDb(env);
  const rows = await sql`
    SELECT a.*, u.username AS handled_name,
           (SELECT g.reason FROM game_punishments g WHERE g.xuid = a.xuid AND g.kind = 'ban' ORDER BY g.id DESC LIMIT 1) AS game_reason,
           (SELECT g.by_name FROM game_punishments g WHERE g.xuid = a.xuid AND g.kind = 'ban' ORDER BY g.id DESC LIMIT 1) AS game_by
      FROM appeals a LEFT JOIN users u ON u.id = a.handled_by
     WHERE a.status = ${status} ORDER BY a.id DESC LIMIT 100`;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM appeals WHERE status = 'open'`;
  return json({
    ok: true, open: n, canDecide: Number(user.role_power) >= ADMIN,
    appeals: rows.map((a) => ({ id: Number(a.id), gamertag: a.gamertag, xuid: a.xuid, which: a.which, message: a.message, status: a.status,
      reply: a.staff_reply, handledBy: a.handled_name, createdAt: a.created_at, answeredAt: a.handled_at,
      gameBan: a.game_reason || a.game_by ? { reason: a.game_reason, by: a.game_by } : null })),
  });
}

// POST /api/mod/appeals/:id { status: "accepted" | "declined", reply, unban }  (Admins: unbanning is an Admin power)
export async function decideAppeal(request, env, ctx, url, params) {
  const user = await requireStaff(request, env, ADMIN);
  const body = await readJson(request);
  const status = ["accepted", "declined"].includes(body.status) ? body.status : null;
  if (!status) throw new HttpError(400, "Accept or decline the appeal.");
  const reply = String(body.reply || "").replace(/\r/g, "").trim().slice(0, 1000);
  if (reply.length < 3) throw new HttpError(400, "Write a short answer. The player sees it.");
  const sql = getDb(env);
  const [a] = await sql`SELECT * FROM appeals WHERE id = ${Number(params.id) || 0}`;
  if (!a) throw new HttpError(404, "That appeal no longer exists.");
  if (a.status !== "open") throw new HttpError(409, "This appeal was already answered.");
  const notes = [];
  if (status === "accepted" && body.unban !== false) {
    const bans = await bansFor(sql, a.gamertag);
    if (bans.website && bans.websiteUser && !isOwner(env, bans.websiteUser.username, false)) {
      await sql`UPDATE users SET banned = false, ban_reason = NULL WHERE id = ${bans.websiteUser.id}`;
      notes.push("website ban lifted");
    }
    if (bans.game && bans.player) {
      const sent = await toPlugin(env, { type: "mod_action", action: "unban", xuid: bans.player.xuid, name: bans.player.gamertag, reason: "Appeal accepted", by: user.username });
      if (!sent) throw new HttpError(409, "The Minecraft server isn't connected, so the game ban can't be lifted right now. Try again when it's online.");
      notes.push("game ban lifted");
    }
  }
  await sql`UPDATE appeals SET status = ${status}, staff_reply = ${reply}, handled_by = ${user.id}, handled_at = now() WHERE id = ${a.id}`;
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, ${`appeal.${status}`}, ${JSON.stringify({ player: a.gamertag, unbanned: notes })}::jsonb)`;
  return json({ ok: true, message: `Appeal ${status}${notes.length ? ` (${notes.join(", ")})` : ""}.` });
}
