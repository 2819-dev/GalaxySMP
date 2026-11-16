// Friend Streaks (like Duolingo): invite a friend, they accept, and every day you BOTH play on the server the
// streak grows by one. Miss a day and it starts again from 0. Up to 5 Friend Streaks each (invites count too).
// Milestones (7, 30, 100, 365 days) give both friends game money; 100 days also gives a badge.
// Days are counted in New York time, like the rest of the site. "Played" = was on the server at any time that day.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { notify } from "./notify.js";
import { queueReward, packText } from "./rewards.js";
import { postTimeline } from "./feed.js";

export const MAX_STREAKS = 5;
const TZ = "America/New_York";
// What EACH friend gets at a milestone (money is small on purpose: packs and keys are the real prize)
export const MILESTONES = {
  7: { cents: 10000, packs: { food: 1 }, keys: { common: 1 } },
  30: { cents: 50000, packs: { rare: 1 }, keys: { rare: 1 } },
  100: { cents: 250000, packs: { legendary: 1 }, keys: { rare: 2 } },
  365: { cents: 1000000, packs: { legendary: 2 }, keys: { galaxy: 1 } },
};
const BADGE = "Friend Streak: 100 days";
const pair = (x, y) => (x < y ? [x, y] : [y, x]);
const usd = (c) => `$${(c / 100).toLocaleString("en-US")}`;

// Today and yesterday as YYYY-MM-DD in New York time.
export function days(now = new Date()) {
  const f = (d) => d.toLocaleDateString("en-CA", { timeZone: TZ });
  return { today: f(now), yesterday: f(new Date(now.getTime() - 864e5)) };
}
const dayStr = (d) => (d ? (typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10)) : null);

// The streak as it stands now: a streak whose last counted day is before yesterday has ended (shows 0).
export function current(row, d = days()) {
  const last = dayStr(row.last_day);
  return last === d.today || last === d.yesterday ? Number(row.length || 0) : 0;
}

// Which of these users have been on the server today (New York time).
async function playedToday(sql, userIds) {
  if (!userIds.length) return new Set();
  const rows = await sql`
    SELECT DISTINCT u.id FROM users u JOIN players p ON p.uuid = u.mc_uuid JOIN player_sessions s ON s.xuid = p.xuid
     WHERE u.id = ANY(${userIds}) AND (s.ended_at AT TIME ZONE ${TZ})::date = (now() AT TIME ZONE ${TZ})::date`;
  return new Set(rows.map((r) => Number(r.id)));
}

// For the Friends list: every streak and invite of this member, keyed by the friend's user id.
export async function streaksFor(sql, me) {
  const rows = await sql`SELECT * FROM friend_streaks WHERE a = ${me} OR b = ${me}`;
  if (!rows.length) return {};
  const d = days();
  const ids = [...new Set(rows.flatMap((r) => [Number(r.a), Number(r.b)]))];
  const played = await playedToday(sql, ids);
  const out = {};
  for (const r of rows) {
    const other = Number(r.a) === Number(me) ? Number(r.b) : Number(r.a);
    out[other] = {
      status: r.status,
      byMe: Number(r.requested_by) === Number(me),
      length: current(r, d),
      best: Number(r.best || 0),
      doneToday: dayStr(r.last_day) === d.today,
      meToday: played.has(Number(me)),
      themToday: played.has(other),
      since: r.started_on ? dayStr(r.started_on) : null,
      canNudge: r.status === "active" && dayStr(r.last_day) !== d.today && played.has(Number(me)) && !played.has(other)
        && !(r.nudged_by && Number(r.nudged_by) === Number(me) && r.nudged_at && new Date(r.nudged_at) > new Date(Date.now() - 12 * 36e5)),
    };
  }
  return out;
}

// POST /api/friends/streak { action: invite | accept | decline | cancel | end | nudge, userId }
export async function act(request, env) {
  const me = await requireUser(request, env);
  if (me.banned) throw new HttpError(403, "Your account has been banned.");
  await rateLimit(env, "AUTH_LIMITER", `fstreak:${me.id}`);
  const body = await readJson(request);
  const other = Number(body.userId) || 0;
  if (!other || other === Number(me.id)) throw new HttpError(400, "Choose a friend.");
  const sql = getDb(env);
  const [a, b] = pair(Number(me.id), other);
  const [friend] = await sql`SELECT 1 FROM friends WHERE a = ${a} AND b = ${b} AND status = 'accepted'`;
  if (!friend) throw new HttpError(409, "You can only have a Friend Streak with a friend.");
  const [them] = await sql`SELECT u.id, u.username, coalesce(p.gamertag, u.username) AS name, p.xuid FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
                            WHERE u.id = ${other} AND NOT u.banned`;
  if (!them) throw new HttpError(404, "We couldn't find that member.");
  const [row] = await sql`SELECT * FROM friend_streaks WHERE a = ${a} AND b = ${b}`;
  const action = String(body.action || "");
  const myName = me.username;

  if (action === "invite") {
    if (row?.status === "active") return json({ ok: true, message: "You already have a Friend Streak together." });
    if (row && Number(row.requested_by) !== Number(me.id)) return accept();
    if (row) return json({ ok: true, message: "Invite already sent." });
    const [mine] = await sql`SELECT u.id FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${me.id}`;
    if (!mine) throw new HttpError(409, "Link your Minecraft account first, so your days on the server can count.");
    if (!them.xuid) throw new HttpError(409, `${them.name} hasn't linked a Minecraft account yet.`);
    await checkRoom(me.id, "You");
    await checkRoom(other, them.name);
    await sql`INSERT INTO friend_streaks (a, b, requested_by) VALUES (${a}, ${b}, ${me.id}) ON CONFLICT DO NOTHING`;
    await notify(env, [other], "friends", { title: "Friend Streak invite", body: `${myName} wants to start a Friend Streak with you. Play on the same days to grow it.`, url: "/community#friends", tag: `fstreak-${a}-${b}` }).catch(() => {});
    return json({ ok: true, message: `Friend Streak invite sent to ${them.name}.` });
  }
  if (action === "accept") {
    if (!row || row.status !== "pending" || Number(row.requested_by) === Number(me.id)) throw new HttpError(409, "There's no Friend Streak invite to accept.");
    return accept();
  }
  if (action === "decline" || action === "cancel" || action === "end") {
    if (!row) return json({ ok: true });
    await sql`DELETE FROM friend_streaks WHERE a = ${a} AND b = ${b}`;
    return json({ ok: true, message: action === "end" ? "Friend Streak ended." : "Invite removed." });
  }
  if (action === "nudge") {
    if (!row || row.status !== "active") throw new HttpError(409, "You don't have a Friend Streak together.");
    const d = days();
    if (dayStr(row.last_day) === d.today) return json({ ok: true, message: "You've both played today already." });
    if (row.nudged_by && Number(row.nudged_by) === Number(me.id) && new Date(row.nudged_at) > new Date(Date.now() - 12 * 36e5)) {
      throw new HttpError(429, `You already reminded ${them.name} today.`);
    }
    await sql`UPDATE friend_streaks SET nudged_at = now(), nudged_by = ${me.id} WHERE a = ${a} AND b = ${b}`;
    const len = current(row, d);
    await notify(env, [other], "friends", {
      title: `${myName} is waiting for you`,
      body: len ? `Join GalaxySMP today to keep your ${len}-day Friend Streak with ${myName}.` : `Join GalaxySMP today to start your Friend Streak with ${myName}.`,
      url: "/community#friends", tag: `fstreak-nudge-${a}-${b}`, ttl: 43200,
    }).catch(() => {});
    return json({ ok: true, message: `Reminder sent to ${them.name}.` });
  }
  throw new HttpError(400, "Unknown action.");

  async function checkRoom(id, who) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM friend_streaks WHERE a = ${id} OR b = ${id}`;
    if (n >= MAX_STREAKS) throw new HttpError(409, `${who === "You" ? "You have" : `${who} has`} ${MAX_STREAKS} Friend Streaks (including invites) already, which is the most.`);
  }
  async function accept() {
    await sql`UPDATE friend_streaks SET status = 'active', accepted_at = now(), started_on = (now() AT TIME ZONE ${TZ})::date WHERE a = ${a} AND b = ${b}`;
    await notify(env, [other], "friends", { title: "Friend Streak started", body: `${myName} accepted. Play on GalaxySMP on the same days to grow your streak.`, url: "/community#friends", tag: `fstreak-${a}-${b}` }).catch(() => {});
    await update(env, sql, [Number(me.id), other]).catch(() => {});
    return json({ ok: true, message: `Friend Streak with ${them.name} started. Play on the same days to grow it.` });
  }
}

// From the server's stats (every minute): the xuids online right now.
export async function updateOnline(env, sql, xuids) {
  if (!xuids.length) return;
  const rows = await sql`SELECT u.id FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE p.xuid = ANY(${xuids}) AND NOT u.banned`;
  await update(env, sql, rows.map((r) => Number(r.id)));
}

// Called every minute with who's online (from the server's stats). Counts today for every streak where both
// friends have now played today. Safe to call often: each streak counts at most once a day.
export async function update(env, sql, userIds) {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) return;
  const d = days();
  const rows = await sql`SELECT * FROM friend_streaks WHERE status = 'active' AND (a = ANY(${ids}) OR b = ANY(${ids}))
                            AND (last_day IS NULL OR last_day < ${d.today}::date)`;
  if (!rows.length) return;
  const played = await playedToday(sql, [...new Set(rows.flatMap((r) => [Number(r.a), Number(r.b)]))]);
  for (const r of rows) {
    if (!played.has(Number(r.a)) || !played.has(Number(r.b))) continue;
    const next = dayStr(r.last_day) === d.yesterday ? Number(r.length || 0) + 1 : 1;
    const [done] = await sql`UPDATE friend_streaks SET length = ${next}, best = greatest(best, ${next}), last_day = ${d.today}::date,
                                    started_on = CASE WHEN ${next} = 1 THEN ${d.today}::date ELSE started_on END
                              WHERE a = ${r.a} AND b = ${r.b} AND (last_day IS NULL OR last_day < ${d.today}::date) RETURNING a`;
    if (done && MILESTONES[next]) await milestone(env, sql, r, next).catch((e) => console.error("friend streak milestone failed", e));
  }
}

async function milestone(env, sql, r, n) {
  const people = await sql`SELECT u.id, u.username, coalesce(p.gamertag, u.username) AS name, p.xuid FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
                            WHERE u.id = ANY(${[Number(r.a), Number(r.b)]})`;
  if (people.length < 2) return;
  // once per pair per milestone, even if the streak restarts and reaches it again
  const key = `fstreak:${r.a}:${r.b}:${n}`;
  const [claimed] = await sql`INSERT INTO economy_config (key, value, updated_by) VALUES (${key}, ${JSON.stringify(new Date().toISOString())}::jsonb, 'server')
                              ON CONFLICT (key) DO NOTHING RETURNING key`;
  if (!claimed) return;
  const prize = MILESTONES[n];
  const cents = prize.cents;
  let badge = null;
  if (n >= 100) {
    [badge] = await sql`SELECT id FROM badges WHERE name = ${BADGE} ORDER BY id LIMIT 1`;
    if (!badge) [badge] = await sql`INSERT INTO badges (name, description, icon, style) VALUES (${BADGE}, 'Kept a Friend Streak going for 100 days.', 'flame', 'gold') RETURNING id`;
  }
  for (const p of people) {
    const friend = people.find((x) => Number(x.id) !== Number(p.id));
    if (p.xuid) await queueReward(sql, { xuid: p.xuid, name: p.name, cents, packs: prize.packs, keys: prize.keys, reason: `${n}-day Friend Streak with ${friend.name}` });
    if (badge) await sql`INSERT INTO user_badges (user_id, badge_id) VALUES (${p.id}, ${badge.id}) ON CONFLICT DO NOTHING`;
    await notify(env, [Number(p.id)], "friends", {
      title: `${n}-day Friend Streak!`,
      body: `You and ${friend.name} played on ${n} days in a row. You both earned ${usd(cents)}, ${packText(prize.packs)} and crate keys in game${badge ? ", plus the Friend Streak badge" : ""}.`,
      url: "/community#friends", tag: `fstreak-ms-${r.a}-${r.b}`,
    }).catch(() => {});
  }
  if (n >= 30) {
    await postTimeline(sql, { kind: "friend_streak", name: `${people[0].name} & ${people[1].name}`, title: `reached a ${n}-day Friend Streak`,
      detail: "Played on GalaxySMP together every day.", icon: "flame", dedupe: key });
  }
}
