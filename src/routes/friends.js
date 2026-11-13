// Friends: send a request, the other member accepts or declines. Friends see each other in the Friends list
// (in game right now or not), and get a notification when a friend joins the server.
// Also: Build Contest results from the plugin (wins on profiles and the leaderboard, a #Timeline post).
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { headUrlFor } from "./heads.js";
import { notify } from "./notify.js";
import { postTimeline } from "./feed.js";

const MAX_FRIENDS = 200;
const pair = (x, y) => (x < y ? [x, y] : [y, x]);

// The relationship between the signed-in member and another member.
export async function friendState(sql, me, other) {
  if (!other) return null;
  if (Number(other) === Number(me)) return "self";
  const [a, b] = pair(Number(me), Number(other));
  const [row] = await sql`SELECT status, requested_by FROM friends WHERE a = ${a} AND b = ${b}`;
  if (!row) return "none";
  if (row.status === "accepted") return "friends";
  return Number(row.requested_by) === Number(me) ? "outgoing" : "incoming";
}

// GET /api/friends
export async function list(request, env) {
  const me = await requireUser(request, env);
  const sql = getDb(env);
  const rows = await sql`
    SELECT f.status, f.requested_by, f.created_at, f.accepted_at, u.id, u.username,
           p.xuid, p.gamertag, p.head_at, p.gamerpic_at, p.last_seen,
           (p.online_at > now() - interval '150 seconds') AS in_game
      FROM friends f
      JOIN users u ON u.id = CASE WHEN f.a = ${me.id} THEN f.b ELSE f.a END
      LEFT JOIN players p ON p.uuid = u.mc_uuid
     WHERE (f.a = ${me.id} OR f.b = ${me.id}) AND NOT u.banned
     ORDER BY (p.online_at > now() - interval '150 seconds') DESC NULLS LAST, lower(u.username)`;
  const person = (r) => ({
    id: Number(r.id), username: r.username, gamertag: r.gamertag || null, head: headUrlFor(r),
    inGame: Boolean(r.in_game), lastSeen: r.last_seen || null,
  });
  return json({
    ok: true,
    friends: rows.filter((r) => r.status === "accepted").map(person),
    incoming: rows.filter((r) => r.status === "pending" && Number(r.requested_by) !== Number(me.id)).map(person),
    outgoing: rows.filter((r) => r.status === "pending" && Number(r.requested_by) === Number(me.id)).map(person),
  }, 200, { "Cache-Control": "no-store" });
}

// POST /api/friends { action: request | accept | decline | cancel | remove, userId | username }
export async function act(request, env) {
  const me = await requireUser(request, env);
  if (me.banned) throw new HttpError(403, "Your account has been banned.");
  await rateLimit(env, "AUTH_LIMITER", `friends:${me.id}`);
  const body = await readJson(request);
  const sql = getDb(env);
  let other = Number(body.userId) || null;
  if (!other && body.username) {
    const [u] = await sql`SELECT u.id FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
                           WHERE (u.username_lower = ${String(body.username).toLowerCase().trim()} OR lower(p.gamertag) = ${String(body.username).toLowerCase().trim()})
                             AND NOT u.banned LIMIT 1`;
    other = u ? Number(u.id) : null;
  }
  if (!other) throw new HttpError(404, "We couldn't find that member.");
  if (other === Number(me.id)) throw new HttpError(400, "You can't add yourself.");
  const [them] = await sql`SELECT id, username, banned FROM users WHERE id = ${other}`;
  if (!them || them.banned) throw new HttpError(404, "We couldn't find that member.");
  const [a, b] = pair(Number(me.id), other);
  const state = await friendState(sql, me.id, other);
  const action = String(body.action || "");

  if (action === "request") {
    if (state === "friends") return json({ ok: true, state });
    if (state === "outgoing") return json({ ok: true, state });
    if (state === "incoming") return accept();
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM friends WHERE (a = ${me.id} OR b = ${me.id})`;
    if (n >= MAX_FRIENDS) throw new HttpError(409, `You can have up to ${MAX_FRIENDS} friends and requests.`);
    await sql`INSERT INTO friends (a, b, requested_by, status) VALUES (${a}, ${b}, ${me.id}, 'pending') ON CONFLICT DO NOTHING`;
    await notify(env, [other], "friends", { title: "Friend request", body: `${me.username} wants to be your friend on GalaxySMP.`, url: "/community#friends", tag: `friend-${me.id}` }).catch(() => {});
    return json({ ok: true, state: "outgoing" });
  }
  if (action === "accept") {
    if (state !== "incoming") throw new HttpError(409, "There's no friend request to accept.");
    return accept();
  }
  if (action === "decline" || action === "cancel" || action === "remove") {
    await sql`DELETE FROM friends WHERE a = ${a} AND b = ${b}`;
    return json({ ok: true, state: "none" });
  }
  throw new HttpError(400, "Unknown action.");

  async function accept() {
    await sql`UPDATE friends SET status = 'accepted', accepted_at = now() WHERE a = ${a} AND b = ${b}`;
    await notify(env, [other], "friends", { title: "Friend request accepted", body: `You and ${me.username} are now friends.`, url: "/community#friends", tag: `friend-${me.id}` }).catch(() => {});
    return json({ ok: true, state: "friends" });
  }
}

// From the plugin ("seen", when players join): tell their friends. Call BEFORE online_at is updated.
// Only real joins (not online in the last 10 minutes) and at most once every 2 hours per player.
export async function friendsJoined(env, players) {
  const xuids = (Array.isArray(players) ? players : []).map((p) => String(p?.xuid || "")).filter((x) => /^\d{1,20}$/.test(x)).slice(0, 100);
  if (!xuids.length) return;
  const sql = getDb(env);
  const fresh = await sql`
    UPDATE players p SET friend_alert_at = now()
      FROM users u
     WHERE p.xuid = ANY(${xuids}) AND u.mc_uuid = p.uuid AND NOT u.banned
       AND (p.online_at IS NULL OR p.online_at < now() - interval '10 minutes')
       AND (p.friend_alert_at IS NULL OR p.friend_alert_at < now() - interval '2 hours')
    RETURNING u.id, coalesce(p.gamertag, u.username) AS name`;
  for (const r of fresh) {
    const friends = await sql`SELECT CASE WHEN a = ${r.id} THEN b ELSE a END AS id FROM friends WHERE (a = ${r.id} OR b = ${r.id}) AND status = 'accepted'`;
    if (!friends.length) continue;
    await notify(env, friends.map((f) => Number(f.id)), "friends", {
      title: `${r.name} is on GalaxySMP`, body: `Your friend ${r.name} just joined the server.`, url: "/community#friends", tag: `friend-join-${r.id}`, ttl: 1800,
    }).catch(() => {});
  }
}

// From the plugin: a Build Contest finished.
export async function recordContest(env, msg) {
  const clip = (v, n) => String(v ?? "").slice(0, n);
  const results = (Array.isArray(msg.results) ? msg.results : []).slice(0, 16).map((r) => ({
    xuid: /^\d{1,20}$/.test(String(r.xuid || "")) ? String(r.xuid) : null, name: clip(r.name, 32),
    place: [1, 2, 3].includes(Number(r.place)) ? Number(r.place) : null, score: Math.max(0, Math.min(5, Number(r.score) || 0)),
    votes: Math.max(0, Number(r.votes) || 0), prize: Math.max(0, Math.round(Number(r.prize) || 0)),
  }));
  if (!results.length) return;
  const sql = getDb(env);
  const theme = clip(msg.theme, 40) || "Build Contest";
  const [row] = await sql`INSERT INTO build_contests (theme, host_name, prize_cents, results) VALUES (${theme}, ${clip(msg.host, 32)},
                            ${Math.max(0, Math.round(Number(msg.prize) || 0))}, ${JSON.stringify(results)}::jsonb) RETURNING id`;
  const win = results.find((r) => r.place === 1);
  if (!win) return;
  if (win.xuid) await sql`UPDATE players SET contest_wins = contest_wins + 1 WHERE xuid = ${win.xuid}`;
  const others = results.filter((r) => r.place && r.place > 1).map((r) => `${r.place === 2 ? "2nd" : "3rd"}: ${r.name}`);
  await postTimeline(sql, {
    kind: "contest", xuid: win.xuid, name: win.name, title: `won the Build Contest: ${theme}`,
    detail: [`${win.score.toFixed(1)}/5 from ${win.votes} vote${win.votes === 1 ? "" : "s"}`, ...others, `Hosted by ${clip(msg.host, 32)}`].join(" · "),
    icon: "trophy2", dedupe: `contest:${row.id}`,
  });
}
