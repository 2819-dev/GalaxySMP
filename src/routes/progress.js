// Player stats (sent by the server), leaderboards and public player profiles.
import { badgesFor } from "./badges.js";
import { rankOf } from "../chat/messages.js";
import { displayRank, loadPlanPriority } from "./ranks.js";
import PLANS from "../../endstone-plugin/src/endstone_galaxylink/plans.json";
import { INTEREST_NAME } from "./onboarding.js";
import { requireUser } from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { json, HttpError } from "../lib/http.js";
import { headUrlFor } from "./heads.js";

const BOARDS = {
  money: { col: "balance_cents", title: "Richest Players" },
  playtime: { col: "playtime_s", title: "Most Playtime" },
  mined: { col: "mined", title: "Top Miners" },
  placed: { col: "placed", title: "Top Builders" },
  kills: { col: "kills", title: "Top Mob Hunters" },
  quests: { col: "quests_done", title: "Most Quests" },
  streak: { col: "best_streak", title: "Longest Daily Streak" },
  achievements: { col: "cardinality(achievements)", title: "Most Achievements" },
};
const ONLINE_SECONDS = 150;
const n = (v) => Math.max(0, Math.round(Number(v) || 0));

// ---------- from the server (through the live connection) ----------
export async function recordStats(env, list, online) {
  const players = (Array.isArray(list) ? list : []).filter((p) => p && /^\d{1,20}$/.test(String(p.xuid || ""))).slice(0, 500);
  const onlineIds = (Array.isArray(online) ? online : []).map(String).filter((x) => /^\d{1,20}$/.test(x)).slice(0, 500);
  const sql = getDb(env);
  for (let i = 0; i < players.length; i += 100) {
    await sql.transaction(players.slice(i, i + 100).map((p) => {
      const ach = (Array.isArray(p.achievements) ? p.achievements : []).map((a) => String(a).slice(0, 40)).slice(0, 200);
      return sql`
        INSERT INTO players (xuid, gamertag, playtime_s, mined, placed, kills, deaths, quests_done, streak, best_streak, achievements, stats_at)
        VALUES (${String(p.xuid)}, ${String(p.name || "Player").slice(0, 32)}, ${n(p.playtime)}, ${n(p.mined)}, ${n(p.placed)}, ${n(p.kills)},
                ${n(p.deaths)}, ${n(p.quests)}, ${n(p.streak)}, ${n(p.best)}, ${ach}, now())
        ON CONFLICT (xuid) DO UPDATE SET playtime_s = EXCLUDED.playtime_s, mined = EXCLUDED.mined, placed = EXCLUDED.placed,
          kills = EXCLUDED.kills, deaths = EXCLUDED.deaths, quests_done = EXCLUDED.quests_done, streak = EXCLUDED.streak,
          best_streak = EXCLUDED.best_streak, achievements = EXCLUDED.achievements, stats_at = now(),
          gamertag = CASE WHEN ${Boolean(p.name)} THEN EXCLUDED.gamertag ELSE players.gamertag END,
          last_daily = coalesce(${/^\d{4}-\d{2}-\d{2}$/.test(String(p.lastDaily || "")) ? p.lastDaily : null}::date, players.last_daily)`;
    }));
  }
  if (onlineIds.length) {
    // session_start: when they joined this time (for "Playing for 1h 20m" on their profile)
    await sql`UPDATE players SET session_start = CASE WHEN online_at IS NULL OR online_at < now() - interval '150 seconds' OR session_start IS NULL
                                                     THEN now() ELSE session_start END,
                                 online_at = now() WHERE xuid = ANY(${onlineIds})`;
  }
}

export async function recordAchievementDefs(env, list) {
  const defs = (Array.isArray(list) ? list : []).slice(0, 200).map((a) => ({
    id: String(a.id || "").slice(0, 40), name: String(a.name || "").slice(0, 60), desc: String(a.desc || "").slice(0, 120), emoji: String(a.emoji || "").slice(0, 8),
  })).filter((a) => a.id);
  if (!defs.length) return;
  const sql = getDb(env);
  await sql`INSERT INTO economy_config (key, value, updated_by) VALUES ('achievements', ${JSON.stringify(defs)}::jsonb, 'server')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = 'server'`;
}

async function achievementDefs(sql) {
  const rows = await sql`SELECT value FROM economy_config WHERE key = 'achievements'`;
  return rows[0]?.value || [];
}

// ---------- public ----------
export async function leaderboards(request, env, ctx, url) {
  const key = url.searchParams.get("board") || "money";
  const board = BOARDS[key];
  if (!board) throw new HttpError(400, "Unknown leaderboard.");
  const sql = getDb(env);
  const rows = await sql.query(
    `SELECT gamertag, ${board.col} AS value, (online_at > now() - interval '${ONLINE_SECONDS} seconds') AS online FROM players
      WHERE ${board.col} IS NOT NULL AND ${board.col} > 0
      ORDER BY ${board.col} DESC, gamertag LIMIT 50`);
  const [totals] = await sql`
    SELECT count(*) FILTER (WHERE balance_cents IS NOT NULL)::int AS players, coalesce(sum(balance_cents), 0)::text AS money,
           coalesce(sum(playtime_s), 0)::text AS playtime, coalesce(sum(mined), 0)::text AS mined,
           count(*) FILTER (WHERE online_at > now() - interval '150 seconds')::int AS online
      FROM players`;
  return json({
    ok: true, board: key, title: board.title,
    boards: Object.entries(BOARDS).map(([k, b]) => ({ key: k, title: b.title })),
    players: rows.map((r) => ({ name: r.gamertag, value: Number(r.value), online: Boolean(r.online) })),
    totals: { players: totals.players, money: Number(totals.money), playtime: Number(totals.playtime), mined: Number(totals.mined), online: totals.online },
  }, 200, { "Cache-Control": "public, max-age=30" });
}

export async function profile(request, env, ctx, url, params) {
  const name = String(params.name || "").trim().replace(/^\./, "").toLowerCase().slice(0, 32);
  if (!name) throw new HttpError(404, "No player with that name.");
  const sql = getDb(env);
  const rows = await sql`
    SELECT p.xuid, p.gamertag, p.first_seen, p.last_seen, p.balance_cents, p.is_op, p.playtime_s, p.mined, p.placed, p.kills, p.deaths,
           p.quests_done, p.streak, p.best_streak, p.achievements, p.online_at, p.extra_plots, p.head_at, p.gamerpic_at,
           (p.online_at > now() - interval '150 seconds') AS online,
           rk.name AS rank_name, rk.prefix AS rank_prefix, rk.color AS rank_color, rk.icon AS rank_icon, rk.gradient AS rank_gradient,
           rk.position AS rank_position, rk.priority AS rank_priority,
           s.plan, s.expires_at, u.id AS user_id, u.username AS user_name, u.platform AS user_platform
      FROM players p
      LEFT JOIN player_ranks pr ON pr.xuid = p.xuid LEFT JOIN ranks rk ON rk.id = pr.rank_id
      LEFT JOIN subscriptions s ON s.xuid = p.xuid AND (s.expires_at IS NULL OR s.expires_at > now())
      LEFT JOIN users u ON u.mc_uuid = p.uuid
     WHERE lower(p.gamertag) = ${name}
     ORDER BY p.last_seen DESC LIMIT 1`;
  if (!rows.length) throw new HttpError(404, "No player with that name has joined GalaxySMP yet.");
  const p = rows[0];
  const defs = await achievementDefs(sql);
  const have = new Set(p.achievements || []);
  const rankAt = async (col, value) => {
    if (!value) return null;
    const [r] = await sql.query(`SELECT count(*)::int + 1 AS pos FROM players WHERE ${col} > $1`, [value]);
    return r.pos;
  };
  return json({
    ok: true,
    player: {
      name: p.gamertag, online: Boolean(p.online), lastOnline: p.online_at || p.last_seen, firstSeen: p.first_seen,
      head: headUrlFor(p),
      // the rank shown everywhere else (a paid plan's tag when it's the more important one)
      rank: displayRank(rankOf(p), p.plan, await loadPlanPriority(sql), PLANS),
      plan: p.plan || "free", linked: Boolean(p.user_id), staff: Boolean(p.is_op),
      money: p.balance_cents == null ? null : Number(p.balance_cents),
      stats: { playtime: Number(p.playtime_s), mined: Number(p.mined), placed: Number(p.placed), kills: Number(p.kills), deaths: Number(p.deaths),
               quests: p.quests_done, streak: p.streak, bestStreak: p.best_streak },
      positions: {
        money: await rankAt("balance_cents", Number(p.balance_cents)), playtime: await rankAt("playtime_s", Number(p.playtime_s)),
        mined: await rankAt("mined", Number(p.mined)),
      },
      achievements: defs.map((a) => ({ ...a, unlocked: have.has(a.id) })),
      badges: p.user_id ? (await badgesFor(env, sql, [{ id: p.user_id, username: p.user_name, platform: p.user_platform }])).get(Number(p.user_id)) : [],
    },
  }, 200, { "Cache-Control": "public, max-age=30" });
}

export async function searchPlayers(request, env, ctx, url) {
  const q = String(url.searchParams.get("q") || "").trim().replace(/^\./, "").toLowerCase().slice(0, 32);
  if (q.length < 2) return json({ ok: true, players: [] });
  const sql = getDb(env);
  const like = q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const rows = await sql`SELECT gamertag, (online_at > now() - interval '150 seconds') AS online FROM players
                          WHERE lower(gamertag) LIKE ${like} ORDER BY last_seen DESC LIMIT 10`;
  return json({ ok: true, players: rows.map((r) => ({ name: r.gamertag, online: Boolean(r.online) })) });
}

// GET /api/players/:name/social (signed-in members): name, bio, likes, color, for the full profile page
export async function socialProfile(request, env, ctx, url, params) {
  const viewer = await requireUser(request, env);
  const name = String(params.name || "").trim().replace(/^\./, "").toLowerCase().slice(0, 32);
  const sql = getDb(env);
  const [u] = await sql`
    SELECT u.id, u.username, u.created_at, u.real_name, u.real_name_hidden, u.bio, u.interests, u.profile_color
      FROM players p JOIN users u ON u.mc_uuid = p.uuid
     WHERE lower(p.gamertag) = ${name} AND NOT u.banned
     ORDER BY p.last_seen DESC LIMIT 1`;
  if (!u) return json({ ok: true, member: null });
  const me = Number(u.id) === Number(viewer.id);
  const staff = Number(viewer.role_power) >= 50;
  return json({
    ok: true,
    member: {
      id: Number(u.id), username: u.username, since: u.created_at, isMe: me,
      realName: u.real_name && (!u.real_name_hidden || me || staff) ? u.real_name : null, realNameHidden: Boolean(u.real_name_hidden),
      bio: u.bio || null, interests: (u.interests || []).map((i) => INTEREST_NAME[i]).filter(Boolean), color: u.profile_color || null,
    },
  }, 200, { "Cache-Control": "no-store" });
}
