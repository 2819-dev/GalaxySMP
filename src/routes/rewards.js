// In-game rewards (money and crate keys) from the website: referrals, the season pass and server goals.
// They wait in game_rewards until the plugin confirms it gave them, so players get them even if the server
// was offline or they weren't playing. The plugin remembers which ones it gave, so nothing is given twice.
import { getDb } from "../lib/db.js";
import { toPlugin } from "./economy.js";

export const KEY_KINDS = ["common", "rare", "galaxy"];

export function cleanKeys(keys) {
  const out = {};
  for (const k of KEY_KINDS) {
    const n = Math.max(0, Math.min(100, Math.floor(Number(keys?.[k]) || 0)));
    if (n) out[k] = n;
  }
  return out;
}

// Adds a reward to the queue (it's sent with the next batch). Returns its id.
export async function queueReward(sql, { xuid, name, cents = 0, keys = {}, stats = null, reason }) {
  const k = cleanKeys(keys);
  const c = Math.max(0, Math.round(Number(cents) || 0));
  const st = stats && Object.keys(stats).length ? stats : null;  // leaderboard stats set by the owner
  if (!xuid || (!c && !Object.keys(k).length && !st)) return null;
  const [r] = await sql`INSERT INTO game_rewards (xuid, name, cents, keys, stats, reason)
                         VALUES (${String(xuid)}, ${String(name || "").slice(0, 32)}, ${c}, ${JSON.stringify(k)}::jsonb, ${st ? JSON.stringify(st) : null}::jsonb, ${String(reason).slice(0, 120)}) RETURNING id`;
  return Number(r.id);
}

// Sends everything that's waiting to the plugin (it answers with "rewards_done"). Safe to call often.
export async function sendRewards(env, sql = getDb(env), send = null) {
  const rows = await sql`SELECT id, xuid, name, cents, keys, stats, reason FROM game_rewards WHERE sent_at IS NULL ORDER BY id LIMIT 100`;
  if (!rows.length) return 0;
  const msg = { type: "rewards", list: rows.map((r) => ({ id: Number(r.id), xuid: r.xuid, name: r.name, cents: Number(r.cents), keys: r.keys || {}, ...(r.stats ? { stats: r.stats } : {}), reason: r.reason })) };
  const sent = send ? send(msg) : await toPlugin(env, msg).catch(() => false);
  return sent ? rows.length : 0;
}

// The plugin gave these.
export async function rewardsDone(env, ids) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  if (list.length) await getDb(env)`UPDATE game_rewards SET sent_at = now() WHERE id = ANY(${list}::bigint[]) AND sent_at IS NULL`;
}
