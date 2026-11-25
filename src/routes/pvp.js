// PvP on the website (2.94): match history on profiles and weekly/monthly PvP leaderboards.
// The plugin sends each finished match (duels, ranked, party fights, events); stats come with the player stats.
import { getDb } from "../lib/db.js";
import { json } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";

const KITS = { potion: "Potion PvP", classic: "Classic", sumo: "Sumo", boxing: "Boxing", build: "Build" };
const MODES = ["duel", "ranked", "party", "event"];
const clip = (v, n) => String(v ?? "").slice(0, n);
const num = (v) => Math.max(0, Math.min(1e6, Math.round(Number(v) || 0)));
const rating = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(5000, Math.round(Number(v)))));

// ---------- from the plugin ----------
export async function recordMatch(env, msg) {
  const players = (Array.isArray(msg.players) ? msg.players : []).filter((p) => p && /^\d{1,20}$/.test(String(p.xuid || ""))).slice(0, 8);
  if (players.length < 2 || !KITS[msg.kit]) return;
  const sql = getDb(env);
  const started = new Date((Number(msg.started) || Date.now() / 1000) * 1000);
  const mode = MODES.includes(msg.mode) ? msg.mode : "duel";
  const [m] = await sql`INSERT INTO pvp_matches (started_at, seconds, mode, kit, arena, winner)
                        VALUES (${started.toISOString()}, ${num(msg.seconds)}, ${mode}, ${msg.kit}, ${clip(msg.arena, 32) || null}, ${clip(msg.winner, 8) || null})
                        RETURNING id`;
  await sql.transaction(players.map((p) => sql`
    INSERT INTO pvp_match_players (match_id, xuid, name, team, won, kills, hits, rating_before, rating_after)
    VALUES (${m.id}, ${String(p.xuid)}, ${clip(p.name, 32)}, ${clip(p.team, 8) || "a"}, ${Boolean(p.won)}, ${num(p.kills)}, ${num(p.hits)},
            ${rating(p.before)}, ${rating(p.after)})
    ON CONFLICT DO NOTHING`));
}

// GET /api/pvp/history?name=Player (signed-in members, like profiles)
export async function history(request, env, ctx, url) {
  await requireUser(request, env);
  const name = clip(url.searchParams.get("name"), 32).toLowerCase();
  const sql = getDb(env);
  const [p] = await sql`SELECT xuid FROM players WHERE lower(gamertag) = ${name}`;
  if (!p) return json({ ok: true, matches: [] });
  const rows = await sql`
    SELECT m.id, m.started_at, m.seconds, m.mode, m.kit, m.arena, mp.won, mp.kills, mp.hits, mp.rating_before, mp.rating_after, mp.team, m.winner,
           (SELECT string_agg(x.name, ', ') FROM pvp_match_players x WHERE x.match_id = m.id AND x.team <> mp.team) AS against
      FROM pvp_match_players mp JOIN pvp_matches m ON m.id = mp.match_id
     WHERE mp.xuid = ${p.xuid} ORDER BY m.started_at DESC LIMIT 15`;
  return json({ ok: true, matches: rows.map((r) => ({
    id: Number(r.id), startedAt: r.started_at, seconds: r.seconds, mode: r.mode, kit: r.kit, kitName: KITS[r.kit] || r.kit, arena: r.arena,
    won: r.won, draw: !r.winner, kills: r.kills, hits: r.hits, against: r.against || "",
    change: r.rating_before != null && r.rating_after != null ? r.rating_after - r.rating_before : null, rating: r.rating_after })) });
}

// GET /api/pvp/top?range=week|month: most duel wins (and kills in duels) this week or month
export async function top(request, env, ctx, url) {
  const range = url.searchParams.get("range") === "month" ? "month" : "week";
  const sql = getDb(env);
  const since = range === "month" ? "date_trunc('month', now())" : "date_trunc('week', now())";
  const rows = await sql.query(`
    SELECT mp.xuid, max(mp.name) AS name, count(*) FILTER (WHERE mp.won)::int AS wins, sum(mp.kills)::int AS kills, count(*)::int AS games
      FROM pvp_match_players mp JOIN pvp_matches m ON m.id = mp.match_id
     WHERE m.started_at >= ${since}
     GROUP BY mp.xuid ORDER BY wins DESC, kills DESC LIMIT 20`);
  return json({ ok: true, range, players: rows.map((r) => ({ name: r.name, wins: r.wins, kills: r.kills, games: r.games })) },
    200, { "Cache-Control": "public, max-age=60" });
}
