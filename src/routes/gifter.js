// Gifter badges: Bronze (1-4 gifts), Silver (5-9), Gold (10-19), Galaxy (20+).
// Counts gifts made in the website Store (credits, items and plans) that the giver paid for, plus the
// owner's free gifts. Members show only their highest Gifter badge.
import { isOwner } from "../lib/names.js";
import { notify } from "./notify.js";

const TIERS = [[20, "Galaxy Gifter"], [10, "Gold Gifter"], [5, "Silver Gifter"], [1, "Bronze Gifter"]];

export async function recordGift(env, sql, { giverId, receiverId, kind, item = null, cents = 0, paid = true, ref = null }) {
  try {
    await sql`INSERT INTO store_gifts (giver_id, receiver_id, kind, item, cents, paid, source_ref)
              VALUES (${giverId}, ${receiverId}, ${kind}, ${item}, ${cents}, ${paid}, ${ref}) ON CONFLICT (source_ref) DO NOTHING`;
    await syncGifterBadge(env, sql, giverId);
  } catch (e) {
    console.error("gift record failed", e);
  }
}

// Gives the right Gifter badge (and removes the other Gifter badges). Returns the badge name or null.
export async function syncGifterBadge(env, sql, userId, { quiet = false } = {}) {
  const [u] = await sql`SELECT id, username, platform FROM users WHERE id = ${userId}`;
  if (!u) return null;
  const owner = isOwner(env, u.username, u.platform === "bedrock");
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM store_gifts WHERE giver_id = ${userId} AND (paid OR ${owner})`;
  const tierName = TIERS.find(([min]) => n >= min)?.[1] || null;
  const badges = await sql`SELECT id, name FROM badges WHERE name = ANY(${TIERS.map((t) => t[1])})`;
  const want = badges.find((b) => b.name === tierName);
  const others = badges.filter((b) => b !== want).map((b) => b.id);
  if (others.length) await sql`DELETE FROM user_badges WHERE user_id = ${userId} AND badge_id = ANY(${others}::bigint[])`;
  if (want) {
    const added = await sql`INSERT INTO user_badges (user_id, badge_id) VALUES (${userId}, ${want.id}) ON CONFLICT DO NOTHING RETURNING badge_id`;
    if (added.length && !quiet) {
      await notify(env, [Number(userId)], "community", { title: `You earned the ${tierName} badge!`, body: `Thanks for gifting ${n} time${n === 1 ? "" : "s"}. It's on your profile now.`, url: "/account", tag: "gifter" }).catch(() => {});
    }
  }
  return tierName;
}

// Everyone who has gifted (used once to hand out badges for gifts made before the badges existed).
export async function syncAllGifters(env, sql) {
  const givers = await sql`SELECT DISTINCT giver_id FROM store_gifts`;
  const out = [];
  for (const g of givers) out.push([Number(g.giver_id), await syncGifterBadge(env, sql, g.giver_id, { quiet: true })]);
  return out;
}
