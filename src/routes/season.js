// Season pass: 8-week seasons. Everyone earns season XP by playing (1 XP a minute), finishing quests (30),
// unlocking achievements (50) and winning Bedwars (40). Each tier has a free reward, and a better
// Galaxy Pro+ reward. Rewards (in-game money and crate keys) are claimed on galaxymc.us/season and given in game.
// A new season starts by itself when the last one ends.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { queueReward } from "./rewards.js";
import { tierUnlock } from "../../public/js/looks-catalog.js";
import { giveUnlock } from "./looks.js";

// Each tier's rewards, plus the website look it unlocks (themes, titles, frames: see looks-catalog.js).
const withUnlocks = (s) => (s.tiers || []).map((t, i) => ({ ...t,
  free: { ...t.free, unlock: tierUnlock("free", i + 1, s.id) }, pro: { ...t.pro, unlock: tierUnlock("pro", i + 1, s.id) } }));

export const XP = { minute: 1, quest: 30, achievement: 50, bw_win: 40 };
const TIERS = 30;
const XP_PER_TIER = 120;
const WEEKS = 8;

export function defaultTiers() {
  const out = [];
  for (let i = 1; i <= TIERS; i++) {
    const free = { cents: (200 + 50 * i) * 100, keys: {} };
    const pro = { cents: (500 + 100 * i) * 100, keys: {} };
    if (i % 5 === 0) { free.keys.common = 1; pro.keys.rare = 1; }
    if (i === 15) free.keys.rare = 1;
    if (i === 30) free.keys.galaxy = 1;
    if (i % 10 === 0) pro.keys.galaxy = 1;
    out.push({ xp: i * XP_PER_TIER, free, pro });
  }
  return out;
}

// The season running now (starting a new one when there is none).
export async function currentSeason(sql) {
  const [s] = await sql`SELECT * FROM seasons WHERE starts_at <= now() AND ends_at > now() ORDER BY id DESC LIMIT 1`;
  if (s) return s;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM seasons`;
  const [made] = await sql`INSERT INTO seasons (name, ends_at, tiers)
                            SELECT ${`Season ${n + 1}`}, now() + make_interval(weeks => ${WEEKS}), ${JSON.stringify(defaultTiers())}::jsonb
                             WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE starts_at <= now() AND ends_at > now())
                            RETURNING *`;
  if (!made) return (await sql`SELECT * FROM seasons WHERE starts_at <= now() AND ends_at > now() ORDER BY id DESC LIMIT 1`)[0];
  // XP only counts what's done from now on
  await sql`INSERT INTO season_progress (season_id, xuid, base_play, base_quests, base_ach, base_bw)
            SELECT ${made.id}, xuid, playtime_s, quests_done, cardinality(achievements), bw_wins FROM players ON CONFLICT DO NOTHING`;
  return made;
}

const XP_SQL = `GREATEST(0, (p.playtime_s - coalesce(sp.base_play, 0)) / 60)
                + 30 * GREATEST(0, p.quests_done - coalesce(sp.base_quests, 0))
                + 50 * GREATEST(0, cardinality(p.achievements) - coalesce(sp.base_ach, 0))
                + 40 * GREATEST(0, p.bw_wins - coalesce(sp.base_bw, 0))`;

async function myPlayer(sql, user) {
  const [p] = await sql`SELECT p.xuid, p.gamertag,
                               (SELECT s.plan FROM subscriptions s WHERE s.xuid = p.xuid AND (s.expires_at IS NULL OR s.expires_at > now())) AS plan
                          FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  return p || null;
}

// GET /api/season
export async function season(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const s = await currentSeason(sql);
  const me = await myPlayer(sql, user);
  let mine = null;
  if (me) {
    const [r] = await sql.query(`SELECT ${XP_SQL} AS xp, sp.claimed_free, sp.claimed_pro FROM players p
                                  LEFT JOIN season_progress sp ON sp.season_id = $1 AND sp.xuid = p.xuid WHERE p.xuid = $2`, [s.id, me.xuid]);
    mine = { xp: Number(r?.xp || 0), claimedFree: r?.claimed_free || [], claimedPro: r?.claimed_pro || [], pro: me.plan === "pro" || Boolean(user.owner), name: me.gamertag };
  }
  const top = await sql.query(`SELECT p.gamertag, ${XP_SQL} AS xp FROM players p LEFT JOIN season_progress sp ON sp.season_id = $1 AND sp.xuid = p.xuid
                                ORDER BY xp DESC LIMIT 10`, [s.id]);
  return json({
    ok: true, xpRules: XP,
    season: { id: s.id, name: s.name, startsAt: s.starts_at, endsAt: s.ends_at, tiers: withUnlocks(s) },
    me: mine, top: top.filter((t) => Number(t.xp) > 0).map((t) => ({ name: t.gamertag, xp: Number(t.xp) })),
  }, 200, { "Cache-Control": "private, no-store" });
}

// POST /api/season/claim { tier: 1..30, track: "free" | "pro" }
export async function claim(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const s = await currentSeason(sql);
  const me = await myPlayer(sql, user);
  if (!me) throw new HttpError(400, "Link your Minecraft account first (Account > Link) so we know who to give rewards to.");
  const tier = Number(body.tier);
  const track = body.track === "pro" ? "pro" : "free";
  const t = Number.isInteger(tier) ? s.tiers[tier - 1] : null;
  if (!t) throw new HttpError(400, "Unknown tier.");
  if (track === "pro" && me.plan !== "pro" && !user.owner) throw new HttpError(403, "The second reward track is a Galaxy Pro+ perk.");
  const [r] = await sql.query(`SELECT ${XP_SQL} AS xp FROM players p LEFT JOIN season_progress sp ON sp.season_id = $1 AND sp.xuid = p.xuid WHERE p.xuid = $2`, [s.id, me.xuid]);
  if (Number(r?.xp || 0) < t.xp) throw new HttpError(409, `Reach ${t.xp} XP to unlock tier ${tier}.`);
  // new players since the season started have no row yet: their XP starts at 0
  await sql`INSERT INTO season_progress (season_id, xuid) VALUES (${s.id}, ${me.xuid}) ON CONFLICT DO NOTHING`;
  const done = track === "pro"
    ? await sql`UPDATE season_progress SET claimed_pro = array_append(claimed_pro, ${tier}) WHERE season_id = ${s.id} AND xuid = ${me.xuid} AND NOT (${tier} = ANY(claimed_pro)) RETURNING 1`
    : await sql`UPDATE season_progress SET claimed_free = array_append(claimed_free, ${tier}) WHERE season_id = ${s.id} AND xuid = ${me.xuid} AND NOT (${tier} = ANY(claimed_free)) RETURNING 1`;
  if (!done.length) throw new HttpError(409, "You already claimed that reward.");
  const reward = t[track];
  await queueReward(sql, { xuid: me.xuid, name: me.gamertag, cents: reward.cents, keys: reward.keys, reason: `${s.name} tier ${tier}${track === "pro" ? " (Pro+)" : ""}` });
  const { sendRewards } = await import("./rewards.js");
  await sendRewards(env, sql).catch(() => {});
  const unlock = tierUnlock(track, tier, s.id);
  if (unlock) await giveUnlock(sql, user.id, unlock.kind, unlock.id, `season:${s.id}:${tier}:${track}`);
  return json({ ok: true, unlock,
    message: unlock ? `Reward claimed. You unlocked the ${unlock.name}${unlock.kind === "title" ? " title" : unlock.kind === "theme" ? " theme" : ""}. Choose it in Account settings > Looks. Any money or keys will be delivered in game.`
      : "Reward claimed. It will be delivered in game (the next time you join, if you're offline)." });
}
