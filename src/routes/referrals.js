// Referrals: share your invite link (galaxymc.us/?ref=...). When a friend makes an account with it and plays
// for 1 hour, you get $5,000 and they get $2,500 in game. Invite 15 friends who play and you get the
// Recruiter badge. Only new players count (their first time on the server must be around when they joined).
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { queueReward } from "./rewards.js";
import { notify } from "./notify.js";

export const INVITER_CENTS = 5000_00;
export const FRIEND_CENTS = 2500_00;
export const NEEDED_SECS = 3600;
export const BADGE_AT = 15;

export const refCode = (id) => `g${Number(id).toString(36)}`;
export function refUserId(code) {
  const m = /^g([0-9a-z]{1,10})$/.exec(String(code || "").toLowerCase());
  return m ? parseInt(m[1], 36) : null;
}

// The inviter for a sign-up: a valid, unbanned member (or null).
export async function inviterFor(sql, code) {
  const id = refUserId(code);
  if (!id) return null;
  const [u] = await sql`SELECT id FROM users WHERE id = ${id} AND NOT banned`;
  return u ? Number(u.id) : null;
}

// GET /api/referrals
export async function mine(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const friends = await sql`
    SELECT u.username, u.created_at, u.referral_rewarded_at, coalesce(p.playtime_s, 0) AS secs
      FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE u.referred_by = ${user.id} ORDER BY u.created_at DESC LIMIT 100`;
  const [me] = await sql`SELECT u.referred_by, u.created_at, r.username AS inviter FROM users u LEFT JOIN users r ON r.id = u.referred_by WHERE u.id = ${user.id}`;
  const qualified = friends.filter((f) => f.referral_rewarded_at).length;
  return json({
    ok: true, code: refCode(user.id), link: `${new URL(request.url).origin}/?ref=${refCode(user.id)}`,
    rewards: { inviter: INVITER_CENTS, friend: FRIEND_CENTS, hours: NEEDED_SECS / 3600, badgeAt: BADGE_AT },
    qualified, badge: qualified >= BADGE_AT,
    friends: friends.map((f) => ({ name: f.username, joined: f.created_at, done: Boolean(f.referral_rewarded_at), minutes: Math.floor(Number(f.secs) / 60) })),
    invitedBy: me.inviter || null,
    // new members can still say who invited them for a week (if they didn't use a link)
    canSetInviter: !me.referred_by && Date.now() - new Date(me.created_at).getTime() < 7 * 864e5,
  });
}

// POST /api/referrals/inviter { name }  (a new member says who invited them)
export async function setInviter(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const name = String((await readJson(request)).name || "").trim().replace(/^\./, "").toLowerCase().slice(0, 32);
  const [me] = await sql`SELECT referred_by, created_at FROM users WHERE id = ${user.id}`;
  if (me.referred_by) throw new HttpError(409, "You already have an inviter.");
  if (Date.now() - new Date(me.created_at).getTime() > 7 * 864e5) throw new HttpError(409, "This can only be set in your first week.");
  const [inv] = await sql`SELECT id, username FROM users WHERE (username_lower = ${name} OR username_lower = ${`.${name}`}) AND NOT banned LIMIT 1`;
  if (!inv) throw new HttpError(404, "No member with that name.");
  if (Number(inv.id) === Number(user.id)) throw new HttpError(400, "You can't invite yourself.");
  const [loop] = await sql`SELECT 1 FROM users WHERE id = ${inv.id} AND referred_by = ${user.id}`;
  if (loop) throw new HttpError(400, "You invited them, so they can't be your inviter.");
  await sql`UPDATE users SET referred_by = ${inv.id} WHERE id = ${user.id} AND referred_by IS NULL`;
  return json({ ok: true, message: `Thanks! ${inv.username} will get a reward once you've played for an hour.` });
}

// Every 5 minutes: friends who reached 1 hour of play -> rewards (and the Recruiter badge at 15).
export async function checkReferrals(env, sql) {
  const due = await sql`
    SELECT u.id, u.username, p.xuid, p.gamertag, inv.id AS inv_id, inv.username AS inv_name, ip.xuid AS inv_xuid, ip.gamertag AS inv_tag
      FROM users u
      JOIN players p ON p.uuid = u.mc_uuid
      JOIN users inv ON inv.id = u.referred_by AND NOT inv.banned AND inv.id <> u.id
      LEFT JOIN players ip ON ip.uuid = inv.mc_uuid
     WHERE u.referral_rewarded_at IS NULL AND NOT u.banned AND p.playtime_s >= ${NEEDED_SECS}
       AND p.first_seen > u.created_at - interval '3 days'          -- only brand-new players count
       AND (ip.xuid IS NULL OR ip.xuid <> p.xuid)
     LIMIT 50`;
  for (const r of due) {
    const [claimed] = await sql`UPDATE users SET referral_rewarded_at = now() WHERE id = ${r.id} AND referral_rewarded_at IS NULL RETURNING id`;
    if (!claimed) continue;
    await queueReward(sql, { xuid: r.xuid, name: r.gamertag, cents: FRIEND_CENTS, reason: `Welcome gift: ${r.inv_name} invited you` });
    if (r.inv_xuid) await queueReward(sql, { xuid: r.inv_xuid, name: r.inv_tag, cents: INVITER_CENTS, reason: `${r.username} played their first hour` });
    await notify(env, [Number(r.inv_id)], "community", { title: `${r.username} played their first hour!`, body: `You earned $5,000 in game for inviting them.`, url: "/account#invite", tag: "referral" }).catch(() => {});
    await syncRecruiter(env, sql, r.inv_id);
  }
}

export async function syncRecruiter(env, sql, userId) {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM users WHERE referred_by = ${userId} AND referral_rewarded_at IS NOT NULL`;
  if (n < BADGE_AT) return false;
  const [b] = await sql`SELECT id FROM badges WHERE name = 'Recruiter'`;
  if (!b) return false;
  const added = await sql`INSERT INTO user_badges (user_id, badge_id) VALUES (${userId}, ${b.id}) ON CONFLICT DO NOTHING RETURNING badge_id`;
  if (added.length) await notify(env, [Number(userId)], "community", { title: "You earned the Recruiter badge!", body: `${n} friends you invited play on GalaxySMP. Thank you!`, url: "/account", tag: "recruiter" }).catch(() => {});
  return true;
}
