// Bedwars on the website: match history (profiles), the live game view, weekly/monthly leaderboards with a
// weekly champion ($1,000 + Rare Pack + Rare key + badge), and "players are waiting" alerts for members who turn them on.
import { getDb } from "../lib/db.js";
import { json, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { voiceStub } from "./voice.js";
import { notify } from "./notify.js";
import { queueReward } from "./rewards.js";

const TEAMS = { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow" };
const clip = (v, n) => String(v ?? "").slice(0, n);
const num = (v) => Math.max(0, Math.min(1e6, Math.round(Number(v) || 0)));

// ---------- from the plugin ----------
export async function recordMatch(env, msg) {
  const players = (Array.isArray(msg.players) ? msg.players : []).filter((p) => p && /^\d{1,20}$/.test(String(p.xuid || ""))).slice(0, 32);
  if (!players.length) return;
  const sql = getDb(env);
  const feed = (Array.isArray(msg.feed) ? msg.feed : []).slice(-40).map((f) => ({ t: num(f.t), text: clip(f.text, 120), a: TEAMS[f.a] ? f.a : null, b: TEAMS[f.b] ? f.b : null }));
  const started = new Date((Number(msg.started) || Date.now() / 1000) * 1000);
  const [m] = await sql`INSERT INTO bw_matches (started_at, seconds, mode, winner, feed)
                        VALUES (${started.toISOString()}, ${num(msg.seconds)}, ${clip(msg.mode, 20) || null}, ${TEAMS[msg.winner] ? msg.winner : null}, ${JSON.stringify(feed)}::jsonb)
                        RETURNING id`;
  await sql.transaction(players.map((p) => sql`
    INSERT INTO bw_match_players (match_id, xuid, name, team, kills, finals, beds, won)
    VALUES (${m.id}, ${String(p.xuid)}, ${clip(p.name, 32)}, ${TEAMS[p.team] ? p.team : "red"}, ${num(p.kills)}, ${num(p.finals)}, ${num(p.beds)}, ${Boolean(p.won)})
    ON CONFLICT DO NOTHING`));
}

// "Players are waiting for Bedwars": at most once every 30 minutes, to members who turned it on.
export async function lobbyAlert(env, storage, msg) {
  const waiting = num(msg.waiting);
  if (msg.running || waiting < 1) return;
  const last = (await storage.get("bwAlertAt")) || 0;
  if (Date.now() - last < 30 * 60e3) return;
  await storage.put("bwAlertAt", Date.now());
  const mode = clip(msg.mode, 20);
  await notify(env, "all", "bedwars", {
    title: "A Bedwars game is starting",
    body: `${waiting} player${waiting === 1 ? " is" : "s are"} waiting${mode ? ` for ${mode}` : ""}. Join from a Minigame Computer or /bedwars.`,
    url: "/leaderboard#bedwars", tag: "bedwars-lobby", ttl: 900,
  }).catch(() => {});
}

// ---------- pages ----------
const matchOut = (m, players) => ({
  id: Number(m.id), startedAt: m.started_at, seconds: m.seconds, mode: m.mode, winner: m.winner,
  players: players.map((p) => ({ name: p.name, team: p.team, kills: p.kills, finals: p.finals, beds: p.beds, won: p.won })),
});

// GET /api/bedwars/history?name=Player (signed-in members, like profiles)
export async function history(request, env, ctx, url) {
  await requireUser(request, env);
  const name = clip(url.searchParams.get("name"), 32).toLowerCase();
  const sql = getDb(env);
  const [p] = await sql`SELECT xuid FROM players WHERE lower(gamertag) = ${name}`;
  if (!p) return json({ ok: true, matches: [] });
  const rows = await sql`SELECT m.id, m.started_at, m.seconds, m.mode, m.winner, mp.team, mp.kills, mp.finals, mp.beds, mp.won,
                                (SELECT count(*)::int FROM bw_match_players x WHERE x.match_id = m.id) AS players
                           FROM bw_match_players mp JOIN bw_matches m ON m.id = mp.match_id
                          WHERE mp.xuid = ${p.xuid} ORDER BY m.started_at DESC LIMIT 15`;
  return json({ ok: true, matches: rows.map((r) => ({ id: Number(r.id), startedAt: r.started_at, seconds: r.seconds, mode: r.mode, winner: r.winner,
    team: r.team, kills: r.kills, finals: r.finals, beds: r.beds, won: r.won, players: r.players })) });
}

// GET /api/bedwars/match/:id
export async function match(request, env, ctx, url, params) {
  await requireUser(request, env);
  const sql = getDb(env);
  const [m] = await sql`SELECT * FROM bw_matches WHERE id = ${Number(params.id) || 0}`;
  if (!m) throw new HttpError(404, "That game isn't in the history.");
  const players = await sql`SELECT * FROM bw_match_players WHERE match_id = ${m.id} ORDER BY team, finals DESC, kills DESC`;
  return json({ ok: true, match: { ...matchOut(m, players), feed: m.feed || [] } });
}

// GET /api/bedwars/live: the game running right now (teams, beds, kill feed), straight from the server
export async function live(request, env) {
  const d = await voiceStub(env).fetch("https://voice/internal/bwlive").then((r) => r.json()).catch(() => null);
  const fresh = d && d.at && Date.now() - d.at < 30e3;
  return json({ ok: true, live: fresh && d.running ? d : null }, 200, { "Cache-Control": "no-store" });
}

// GET /api/bedwars/top?range=week|month
export async function top(request, env, ctx, url) {
  const range = url.searchParams.get("range") === "month" ? "month" : "week";
  const sql = getDb(env);
  const since = range === "month" ? "date_trunc('month', now())" : "date_trunc('week', now())";
  const rows = await sql.query(`
    SELECT mp.xuid, max(mp.name) AS name, count(*) FILTER (WHERE mp.won)::int AS wins, sum(mp.finals)::int AS finals,
           sum(mp.beds)::int AS beds, sum(mp.kills)::int AS kills, count(*)::int AS games
      FROM bw_match_players mp JOIN bw_matches m ON m.id = mp.match_id
     WHERE m.started_at >= ${since}
     GROUP BY mp.xuid ORDER BY wins DESC, finals DESC, beds DESC LIMIT 20`);
  return json({ ok: true, range, players: rows.map((r) => ({ name: r.name, wins: r.wins, finals: r.finals, beds: r.beds, kills: r.kills, games: r.games })) },
    200, { "Cache-Control": "public, max-age=60" });
}

// ---------- every 5 minutes: the weekly champion (on Monday, for last week) ----------
export async function weeklyChampion(env, sql) {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const last = new Date(monday.getTime() - 7 * 864e5);
  const week = last.toISOString().slice(0, 10);
  const key = `bw_champion:${week}`;
  const [claimed] = await sql`INSERT INTO economy_config (key, value, updated_by) VALUES (${key}, ${JSON.stringify(now.toISOString())}::jsonb, 'server')
                              ON CONFLICT (key) DO NOTHING RETURNING key`;
  if (!claimed) return;
  const [best] = await sql`
    SELECT mp.xuid, max(mp.name) AS name, count(*) FILTER (WHERE mp.won)::int AS wins, sum(mp.finals)::int AS finals
      FROM bw_match_players mp JOIN bw_matches m ON m.id = mp.match_id
     WHERE m.started_at >= ${last.toISOString()}::timestamptz AND m.started_at < ${monday.toISOString()}::timestamptz
     GROUP BY mp.xuid HAVING count(*) FILTER (WHERE mp.won) > 0 ORDER BY wins DESC, finals DESC LIMIT 1`;
  if (!best) return;
  await queueReward(sql, { xuid: best.xuid, name: best.name, cents: 100000, keys: { rare: 1 }, packs: { rare: 1 }, reason: "Weekly Bedwars Champion" });
  let [badge] = await sql`SELECT id FROM badges WHERE name = 'Weekly Bedwars Champion' ORDER BY id LIMIT 1`;
  if (!badge) [badge] = await sql`INSERT INTO badges (name, description, icon, style) VALUES ('Weekly Bedwars Champion', 'Won the most Bedwars games in a week.', 'trophy', 'gold') RETURNING id`;
  const [u] = await sql`SELECT u.id FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE p.xuid = ${best.xuid} AND NOT u.banned`;
  if (u) {
    await sql`INSERT INTO user_badges (user_id, badge_id) VALUES (${u.id}, ${badge.id}) ON CONFLICT DO NOTHING`;
    await notify(env, [Number(u.id)], "community", { title: "You're the Weekly Bedwars Champion!", body: `${best.wins} wins last week. You earned $1,000, a Rare Pack and a Rare key (in game), and the Weekly Bedwars Champion badge.`, url: "/leaderboard#bedwars", tag: "bw-champion" }).catch(() => {});
  }
  const { postTimeline } = await import("./feed.js");
  await postTimeline(sql, { kind: "bw_champion", xuid: best.xuid, name: best.name, title: "is the Weekly Bedwars Champion",
    detail: `${best.wins} Bedwars wins last week.`, icon: "trophy", dedupe: `bwchamp:${week}` }).catch(() => {});
}
