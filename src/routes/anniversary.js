// Join anniversaries: on the day a player first joined GalaxySMP (1 year, 2 years...), they get an anniversary
// badge (the newest one replaces the last), a #Timeline post, a notification and an in-game gift.
// Runs from the 5-minute timer; each player's year is celebrated once (the anniversaries table).
import { postTimeline } from "./feed.js";
import { notify } from "./notify.js";

const GIFT_CENTS_PER_YEAR = 50000; // $500 for each year
const LOOK = (n) => (n >= 5 ? { style: "galaxy", finish: "holo" } : n === 4 ? { style: "amethyst", finish: "sparkle" }
  : n === 3 ? { style: "gold", finish: "sparkle" } : n === 2 ? { style: "silver", finish: "glow" } : { style: "bronze", finish: "none" });
const yearsText = (n) => `${n} Year${n === 1 ? "" : "s"}`;

async function badgeFor(sql, years) {
  const key = `anniversary:${years}`;
  const look = LOOK(years);
  const [b] = await sql`
    INSERT INTO badges (name, description, icon, style, finish, auto_key)
    VALUES (${`${yearsText(years)} on GalaxySMP`}, ${`Has been part of GalaxySMP for ${years === 1 ? "a year" : `${years} years`}.`}, 'cake', ${look.style}, ${look.finish}, ${key})
    ON CONFLICT (auto_key) WHERE auto_key IS NOT NULL DO UPDATE SET auto_key = EXCLUDED.auto_key RETURNING id`;
  return Number(b.id);
}

export async function anniversaryTick(env, sql) {
  const due = await sql`
    SELECT p.xuid, p.gamertag, p.first_seen, u.id AS user_id,
           (extract(year FROM now() AT TIME ZONE 'UTC') - extract(year FROM p.first_seen AT TIME ZONE 'UTC'))::int AS years
      FROM players p LEFT JOIN users u ON u.mc_uuid = p.uuid AND NOT u.banned
     WHERE to_char(p.first_seen AT TIME ZONE 'UTC', 'MM-DD') = to_char(now() AT TIME ZONE 'UTC', 'MM-DD')
       AND p.first_seen < now() - interval '360 days'
       AND NOT EXISTS (SELECT 1 FROM anniversaries a WHERE a.xuid = p.xuid
                       AND a.years = (extract(year FROM now() AT TIME ZONE 'UTC') - extract(year FROM p.first_seen AT TIME ZONE 'UTC'))::int)
     LIMIT 100`;
  for (const p of due) {
    const years = Number(p.years);
    if (years < 1) continue;
    const [claimed] = await sql`INSERT INTO anniversaries (xuid, years) VALUES (${p.xuid}, ${years}) ON CONFLICT DO NOTHING RETURNING xuid`;
    if (!claimed) continue;
    const name = p.gamertag || "A player";
    if (p.user_id) {
      const badgeId = await badgeFor(sql, years);
      // only the newest anniversary badge shows
      await sql`DELETE FROM user_badges WHERE user_id = ${p.user_id} AND badge_id IN (SELECT id FROM badges WHERE auto_key LIKE 'anniversary:%' AND id <> ${badgeId})`;
      await sql`INSERT INTO user_badges (user_id, badge_id) VALUES (${p.user_id}, ${badgeId}) ON CONFLICT DO NOTHING`;
      await notify(env, [Number(p.user_id)], "community", {
        title: `Happy ${yearsText(years)} on GalaxySMP!`,
        body: `Thanks for being part of the server. You got a new badge and $${(GIFT_CENTS_PER_YEAR * years / 100).toLocaleString("en-US")} in game.`,
        url: `/player/${encodeURIComponent(name)}`, tag: `anniversary-${years}`,
      }).catch(() => {});
    }
    const { queueReward } = await import("./rewards.js");
    await queueReward(sql, { xuid: p.xuid, name, cents: GIFT_CENTS_PER_YEAR * years, reason: `GalaxySMP anniversary (${yearsText(years)})` });
    await postTimeline(sql, {
      kind: "anniversary", xuid: p.xuid, name, title: `celebrates ${yearsText(years).toLowerCase()} on GalaxySMP`,
      detail: `First joined ${new Date(p.first_seen).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
      icon: "cake", dedupe: `anniversary:${p.xuid}:${years}`,
    });
  }
}
