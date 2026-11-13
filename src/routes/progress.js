// Player stats (sent by the server), leaderboards and public player profiles.
import { can } from "../lib/perms.js";
import { bannerUrl } from "./uploads.js";
import { postTimeline } from "./feed.js";
import { badgesFor } from "./badges.js";
import { rankOf } from "../chat/messages.js";
import { displayRank, loadPlanPriority } from "./ranks.js";
import PLANS from "../../endstone-plugin/src/endstone_galaxylink/plans.json";
import { INTEREST_NAME } from "./onboarding.js";
import { requireUser, getUser } from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { json, HttpError } from "../lib/http.js";
import { headUrlFor } from "./heads.js";

const BOARDS = {
  money: { col: "balance_cents", title: "Richest Players" },
  playtime: { col: "playtime_s", title: "Most Playtime" },
  mined: { col: "mined", title: "Top Miners" },
  placed: { col: "placed", title: "Top Builders" },
  streak: { col: "best_streak", title: "Longest Daily Streak" },
  achievements: { col: "cardinality(achievements)", title: "Most Achievements" },
  bw_wins: { col: "bw_wins", title: "Bedwars Wins" },
  bw_finals: { col: "bw_finals", title: "Bedwars Final Kills" },
  bw_beds: { col: "bw_beds", title: "Bedwars Beds Broken" },
};
const ONLINE_SECONDS = 150;
const n = (v) => Math.max(0, Math.round(Number(v) || 0));

// ---------- from the server (through the live connection) ----------
export async function recordStats(env, list, online) {
  const players = (Array.isArray(list) ? list : []).filter((p) => p && /^\d{1,20}$/.test(String(p.xuid || ""))).slice(0, 500);
  const onlineIds = (Array.isArray(online) ? online : []).map(String).filter((x) => /^\d{1,20}$/.test(x)).slice(0, 500);
  const sql = getDb(env);
  // achievements they didn't have before go on #Timeline
  const before = new Map((await sql`SELECT xuid, achievements FROM players WHERE xuid = ANY(${players.map((p) => String(p.xuid))})`)
    .map((r) => [r.xuid, new Set(r.achievements || [])]));
  for (let i = 0; i < players.length; i += 100) {
    await sql.transaction(players.slice(i, i + 100).map((p) => {
      const ach = (Array.isArray(p.achievements) ? p.achievements : []).map((a) => String(a).slice(0, 40)).slice(0, 200);
      const bw = p.bedwars && typeof p.bedwars === "object" ? p.bedwars : {};
      return sql`
        INSERT INTO players (xuid, gamertag, playtime_s, mined, placed, kills, deaths, quests_done, streak, best_streak, achievements, stats_at,
                             bw_games, bw_wins, bw_kills, bw_finals, bw_beds)
        VALUES (${String(p.xuid)}, ${String(p.name || "Player").slice(0, 32)}, ${n(p.playtime)}, ${n(p.mined)}, ${n(p.placed)}, ${n(p.kills)},
                ${n(p.deaths)}, ${n(p.quests)}, ${n(p.streak)}, ${n(p.best)}, ${ach}, now(),
                ${n(bw.games)}, ${n(bw.wins)}, ${n(bw.kills)}, ${n(bw.finals)}, ${n(bw.beds)})
        ON CONFLICT (xuid) DO UPDATE SET playtime_s = EXCLUDED.playtime_s, mined = EXCLUDED.mined, placed = EXCLUDED.placed,
          bw_games = EXCLUDED.bw_games, bw_wins = EXCLUDED.bw_wins, bw_kills = EXCLUDED.bw_kills, bw_finals = EXCLUDED.bw_finals, bw_beds = EXCLUDED.bw_beds,
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
  await recordHistory(sql, players.map((p) => String(p.xuid)), onlineIds).catch((e) => console.error("history failed", e));
  const defs = new Map((await achievementDefs(sql)).map((a) => [a.id, a]));
  for (const p of players) {
    const had = before.get(String(p.xuid));
    if (!had) continue;  // first time we hear about them: their first join is posted instead
    const fresh = (Array.isArray(p.achievements) ? p.achievements : []).map(String).filter((a) => !had.has(a) && a !== "welcome" && defs.has(a));
    if (!fresh.length) continue;
    const name = String(p.name || "A player").slice(0, 32);
    if (fresh.length === 1) {
      const a = defs.get(fresh[0]);
      await postTimeline(sql, { kind: "achievement", xuid: String(p.xuid), name, title: `unlocked ${a.name}`, detail: a.desc || "", icon: "trophy2", dedupe: `ach:${p.xuid}:${a.id}` });
    } else {
      await postTimeline(sql, { kind: "achievement", xuid: String(p.xuid), name, title: `unlocked ${fresh.length} achievements`,
        detail: fresh.map((x) => defs.get(x).name).join(", "), icon: "trophy2", dedupe: `ach:${p.xuid}:${fresh.sort().join(",")}` });
    }
  }
}

// Timeline and charts: one stats row per player per day, play sessions, and server uptime.
// The server sends stats every minute while it's running (even with nobody online).
async function recordHistory(sql, changed, onlineIds) {
  const ids = [...new Set([...changed, ...onlineIds])];
  if (ids.length) {
    await sql`
      INSERT INTO player_stats_daily (xuid, day, playtime_s, balance_cents, mined, placed, kills, quests, achievements, bw_wins, bw_kills)
      SELECT xuid, (now() AT TIME ZONE 'America/New_York')::date, coalesce(playtime_s, 0), coalesce(balance_cents, 0), coalesce(mined, 0), coalesce(placed, 0),
             coalesce(kills, 0), coalesce(quests_done, 0), coalesce(cardinality(achievements), 0), coalesce(bw_wins, 0), coalesce(bw_kills, 0)
        FROM players WHERE xuid = ANY(${ids})
      ON CONFLICT (xuid, day) DO UPDATE SET playtime_s = EXCLUDED.playtime_s, balance_cents = EXCLUDED.balance_cents, mined = EXCLUDED.mined, placed = EXCLUDED.placed,
        kills = EXCLUDED.kills, quests = EXCLUDED.quests, achievements = EXCLUDED.achievements, bw_wins = EXCLUDED.bw_wins, bw_kills = EXCLUDED.bw_kills`;
  }
  if (onlineIds.length) {
    const extended = await sql`
      UPDATE player_sessions s SET ended_at = now()
        FROM (SELECT DISTINCT ON (xuid) id, ended_at FROM player_sessions WHERE xuid = ANY(${onlineIds}) ORDER BY xuid, ended_at DESC) last
       WHERE s.id = last.id AND last.ended_at > now() - interval '150 seconds'
      RETURNING s.xuid`;
    const have = new Set(extended.map((r) => r.xuid));
    const fresh = onlineIds.filter((x) => !have.has(x));
    if (fresh.length) {
      await sql`INSERT INTO player_sessions (xuid, started_at, ended_at)
                SELECT x, now(), now() FROM unnest(${fresh}::text[]) x WHERE EXISTS (SELECT 1 FROM players p WHERE p.xuid = x)`;
    }
  }
  const [up] = await sql`
    UPDATE server_uptime SET ended_at = now(), peak = greatest(peak, ${onlineIds.length})
     WHERE id = (SELECT id FROM server_uptime ORDER BY ended_at DESC LIMIT 1) AND ended_at > now() - interval '150 seconds'
    RETURNING id`;
  if (!up) await sql`INSERT INTO server_uptime (started_at, ended_at, peak) VALUES (now(), now(), ${onlineIds.length})`;
}

// GET /api/players/:name/history: daily playtime, money, mined and placed (last 60 days).
export async function playerHistory(request, env, ctx, url, params) {
  await requireUser(request, env);  // profiles are for signed-in members
  const sql = getDb(env);
  const rows = await sql`
    SELECT d.day, d.playtime_s, d.balance_cents, d.mined, d.placed FROM player_stats_daily d JOIN players p ON p.xuid = d.xuid
     WHERE lower(p.gamertag) = lower(${String(params.name).replace(/^\./, "").slice(0, 32)}) AND d.day > now()::date - 60
     ORDER BY d.day`;
  return json({ ok: true, days: rows.map((r) => ({ day: String(r.day instanceof Date ? r.day.toISOString() : r.day).slice(0, 10), playtime: Number(r.playtime_s), money: Number(r.balance_cents), mined: Number(r.mined), placed: Number(r.placed) })) });
}

// GET /api/timeline?days=7: server uptime, who played when, and busiest hours (like a Realm's timeline).
export async function timeline(request, env, ctx, url) {
  const signedIn = Boolean(await getUser(request, env));
  const days = Math.min(14, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const sql = getDb(env);
  const [uptime, sessions] = await Promise.all([
    sql`SELECT started_at, ended_at, peak FROM server_uptime WHERE ended_at > now() - make_interval(days => ${days}) ORDER BY started_at`,
    sql`SELECT s.xuid, p.gamertag, s.started_at, s.ended_at FROM player_sessions s JOIN players p ON p.xuid = s.xuid
         WHERE s.ended_at > now() - make_interval(days => ${days}) ORDER BY s.started_at LIMIT 5000`,
  ]);
  const players = new Map();
  for (const s of sessions) {
    if (!players.has(s.xuid)) players.set(s.xuid, { name: s.gamertag, sessions: [], total: 0 });
    const p = players.get(s.xuid);
    const a = new Date(s.started_at).getTime(), b = Math.max(a + 60e3, new Date(s.ended_at).getTime());
    p.sessions.push([a, b]);
    p.total += b - a;
  }
  return json({
    ok: true, now: Date.now(), from: Date.now() - days * 864e5,
    uptime: uptime.map((u) => [new Date(u.started_at).getTime(), Math.max(new Date(u.started_at).getTime() + 60e3, new Date(u.ended_at).getTime()), u.peak]),
    // Who played when is for signed-in members only; others get the same bars without names.
    signedIn,
    players: [...players.values()].sort((x, y) => y.total - x.total).slice(0, 40).map((p, i) => (signedIn ? p : { ...p, name: `Player ${i + 1}` })),
  }, 200, { "Cache-Control": "private, no-store" });
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

export async function achievementDefs(sql) {
  const rows = await sql`SELECT value FROM economy_config WHERE key = 'achievements'`;
  return rows[0]?.value || [];
}

// ---------- public ----------
export async function leaderboards(request, env, ctx, url) {
  const signedIn = Boolean(await getUser(request, env));
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
    signedIn,
    boards: Object.entries(BOARDS).map(([k, b]) => ({ key: k, title: b.title })),
    players: signedIn ? rows.map((r) => ({ name: r.gamertag, value: Number(r.value), online: Boolean(r.online) })) : [],
    totals: { players: totals.players, money: Number(totals.money), playtime: Number(totals.playtime), mined: Number(totals.mined), online: totals.online },
  }, 200, { "Cache-Control": "private, no-store" });
}

export async function profile(request, env, ctx, url, params) {
  const me = await requireUser(request, env);  // profiles are for signed-in members
  const name = String(params.name || "").trim().replace(/^\./, "").toLowerCase().slice(0, 32);
  if (!name) throw new HttpError(404, "No player with that name.");
  const sql = getDb(env);
  const rows = await sql`
    SELECT p.xuid, p.gamertag, p.first_seen, p.last_seen, p.balance_cents, p.is_op, p.playtime_s, p.mined, p.placed, p.kills, p.deaths,
           p.quests_done, p.streak, p.best_streak, p.achievements, p.online_at, p.extra_plots, p.head_at, p.gamerpic_at,
           p.pic_source, (p.head IS NOT NULL) AS has_head, (p.custom_pic IS NOT NULL) AS has_custom,
           (p.online_at > now() - interval '150 seconds') AS online,
           rk.name AS rank_name, rk.prefix AS rank_prefix, rk.color AS rank_color, rk.icon AS rank_icon, rk.gradient AS rank_gradient,
           rk.position AS rank_position, rk.priority AS rank_priority, p.bw_games, p.bw_wins, p.bw_kills, p.bw_finals, p.bw_beds,
           s.plan, s.expires_at, u.id AS user_id, u.username AS user_name, u.platform AS user_platform
      FROM players p
      LEFT JOIN player_top_rank pr ON pr.xuid = p.xuid LEFT JOIN ranks rk ON rk.id = pr.rank_id
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
      bedwars: { games: Number(p.bw_games || 0), wins: Number(p.bw_wins || 0), kills: Number(p.bw_kills || 0), finals: Number(p.bw_finals || 0), beds: Number(p.bw_beds || 0) },
      stats: { playtime: Number(p.playtime_s), mined: Number(p.mined), placed: Number(p.placed), kills: Number(p.kills), deaths: Number(p.deaths),
               quests: p.quests_done, streak: p.streak, bestStreak: p.best_streak },
      positions: {
        money: await rankAt("balance_cents", Number(p.balance_cents)), playtime: await rankAt("playtime_s", Number(p.playtime_s)),
        mined: await rankAt("mined", Number(p.mined)),
      },
      achievements: defs.map((a) => ({ ...a, unlocked: have.has(a.id) })),
      // the owner can pick this player's picture: Xbox picture or player head (their own Pro+ picture comes first)
      ...(me.owner ? { picture: { xuid: p.xuid, source: p.pic_source || "auto", hasHead: Boolean(p.has_head), custom: p.pic_source === "custom" && Boolean(p.has_custom) } } : {}),
      badges: p.user_id ? (await badgesFor(env, sql, [{ id: p.user_id, username: p.user_name, platform: p.user_platform }])).get(Number(p.user_id)) : [],
    },
  }, 200, { "Cache-Control": "private, no-store" });
}

export async function searchPlayers(request, env, ctx, url) {
  await requireUser(request, env);  // profiles are for signed-in members
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
    SELECT u.id, u.username, u.created_at, u.real_name, u.real_name_hidden, u.bio, u.interests, u.profile_color, u.banner_at, (u.banner IS NOT NULL) AS has_banner,
           u.showcase, u.wishlist_hidden, u.look_title, u.look_frame
      FROM players p JOIN users u ON u.mc_uuid = p.uuid
     WHERE lower(p.gamertag) = ${name} AND NOT u.banned
     ORDER BY p.last_seen DESC LIMIT 1`;
  if (!u) return json({ ok: true, member: null });
  const me = Number(u.id) === Number(viewer.id);
  const staff = can(viewer, "see_real_names");
  return json({
    ok: true,
    member: {
      id: Number(u.id), username: u.username, since: u.created_at, isMe: me,
      realName: u.real_name && (!u.real_name_hidden || me || staff) ? u.real_name : null, realNameHidden: Boolean(u.real_name_hidden),
      bio: u.bio || null, interests: (u.interests || []).map((i) => INTEREST_NAME[i]).filter(Boolean), color: u.profile_color || null,
      banner: bannerUrl(u),
      showcase: await (await import("./showcase.js")).showcaseFor(sql, u.id, u.showcase),
      wishlist: u.wishlist_hidden && !me ? null : await (await import("./wishlist.js")).wishlistFor(sql, u.id),
      wishlistHidden: Boolean(u.wishlist_hidden),
      ...(await import("./looks.js")).looksOut(u),
    },
  }, 200, { "Cache-Control": "no-store" });
}
