// Weekly recap: every Monday (from about 10 AM US Eastern) an Updates post (card) in #Updates with last week's
// highlights: most playtime, richest players, Bedwars, Build of the Week, new members, server uptime
// and upcoming events. Posted under the owner's account and marked as automatic.
import { getDb } from "../lib/db.js";
import { isOwner } from "../lib/names.js";
import { notify } from "./notify.js";

const money = (c) => {
  const d = Number(c) / 100;
  for (const [v, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (d >= v) return `$${(d / v).toFixed(d / v >= 100 ? 0 : 1).replace(/\.0$/, "")}${s}`;
  return `$${Math.round(d).toLocaleString("en-US")}`;
};
const hours = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.max(1, Math.round(s / 60))}m`);
const day = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const utcDay = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function lastWeek(now = new Date()) {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return { from: new Date(monday.getTime() - 7 * 864e5), to: monday };
}

export async function buildRecap(sql, { from, to } = lastWeek()) {
  const [play, rich, bw, botw, newbies, up, events, potw] = await Promise.all([
    sql`SELECT p.gamertag, sum(extract(epoch FROM least(s.ended_at, ${to.toISOString()}::timestamptz) - greatest(s.started_at, ${from.toISOString()}::timestamptz)))::bigint AS secs
          FROM player_sessions s JOIN players p ON p.xuid = s.xuid
         WHERE s.ended_at > ${from.toISOString()}::timestamptz AND s.started_at < ${to.toISOString()}::timestamptz
         GROUP BY p.gamertag ORDER BY secs DESC LIMIT 3`,
    sql`SELECT gamertag, balance_cents FROM players WHERE balance_cents > 0 AND NOT coalesce(is_op, false) ORDER BY balance_cents DESC LIMIT 3`,
    sql`SELECT gamertag, bw_wins FROM players WHERE bw_wins > 0 ORDER BY bw_wins DESC LIMIT 3`,
    sql`SELECT b.title, u.username FROM builds b JOIN users u ON u.id = b.user_id WHERE b.botw_week = ${from.toISOString().slice(0, 10)}::date AND b.deleted_at IS NULL LIMIT 1`,
    sql`SELECT username FROM users WHERE created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz ORDER BY created_at`,
    sql`SELECT coalesce(sum(extract(epoch FROM least(ended_at, ${to.toISOString()}::timestamptz) - greatest(started_at, ${from.toISOString()}::timestamptz))), 0)::bigint AS secs,
               coalesce(max(peak), 0) AS peak
          FROM server_uptime WHERE ended_at > ${from.toISOString()}::timestamptz AND started_at < ${to.toISOString()}::timestamptz`,
    sql`SELECT title, starts_at FROM events WHERE deleted_at IS NULL AND starts_at > now() ORDER BY starts_at LIMIT 3`,
    sql`SELECT gamertag, secs FROM player_of_week WHERE week = ${from.toISOString().slice(0, 10)}::date`,
  ]);
  const end = new Date(to.getTime() - 864e5);
  const lines = [];
  const medal = ["🥇", "🥈", "🥉"];
  if (potw.length) lines.push("", `⭐ **Player of the Week: ${potw[0].gamertag}**, with ${hours(Number(potw[0].secs))} played. Congratulations!`);
  if (play.length) lines.push("", "**Most time played**", ...play.map((p, i) => `${medal[i]} ${p.gamertag}: ${hours(Number(p.secs))}`));
  if (rich.length) lines.push("", "**Richest players**", ...rich.map((p, i) => `${medal[i]} ${p.gamertag}: ${money(p.balance_cents)}`));
  if (bw.length) lines.push("", "**Bedwars wins (all time)**", ...bw.map((p, i) => `${medal[i]} ${p.gamertag}: ${p.bw_wins}`));
  if (botw.length) lines.push("", `**Build of the Week:** "${botw[0].title}" by ${botw[0].username}. See it in #builds!`);
  if (newbies.length) lines.push("", `**Welcome to our ${newbies.length} new member${newbies.length === 1 ? "" : "s"}:** ${newbies.slice(0, 8).map((n) => n.username).join(", ")}${newbies.length > 8 ? " and more" : ""}!`);
  const upSecs = Number(up[0]?.secs || 0);
  if (upSecs) lines.push("", `**Server:** online ${Math.min(100, Math.round((upSecs / (7 * 86400)) * 100))}% of the week, with up to ${up[0].peak} player${Number(up[0].peak) === 1 ? "" : "s"} at once.`);
  if (events.length) lines.push("", "**Coming up**", ...events.map((e) => `- ${e.title}: ${day(e.starts_at)}`));
  if (!lines.length) return null;  // nothing happened: no post
  lines.push("", "-# Posted automatically every Monday.");
  return { title: `Weekly recap: ${utcDay(from)} – ${utcDay(end)}`, body: lines.join("\n").trim() };
}

// Called by the 5-minute timer: posts once per week, on Monday from 15:00 UTC.
export async function weeklyRecap(env, force = false) {
  const now = new Date();
  if (!force && (now.getUTCDay() !== 1 || now.getUTCHours() < 15)) return;
  const sql = getDb(env);
  const week = lastWeek(now).from.toISOString().slice(0, 10);
  const [done] = await sql`SELECT value FROM economy_config WHERE key = 'recap_last'`;
  if (!force && done?.value === week) return;
  await sql`INSERT INTO economy_config (key, value, updated_by) VALUES ('recap_last', ${JSON.stringify(week)}::jsonb, 'server')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = 'server'`;
  await pickPlayerOfWeek(env, sql, lastWeek(now));
  const recap = await buildRecap(sql);
  if (!recap) return;
  const owners = await sql`SELECT id, username, platform FROM users WHERE NOT banned ORDER BY id`;
  const author = owners.find((u) => isOwner(env, u.username, u.platform === "bedrock"));
  await sql`INSERT INTO news_posts (title, body, tag, author_id) VALUES (${recap.title}, ${recap.body}, 'recap', ${author?.id || null})`;
  await notify(env, "all", "news", { title: recap.title, body: "Last week's top players, Build of the Week and more in #Updates.", url: "/community#updates", tag: `recap-${week}` });
}

// Player of the Week: whoever played the most last week (staff not included, at least 1 hour).
// They get the Player of the Week badge on their profile (if they have a website account) and a notification.
export async function pickPlayerOfWeek(env, sql, { from, to }) {
  const week = from.toISOString().slice(0, 10);
  const [done] = await sql`SELECT 1 FROM player_of_week WHERE week = ${week}::date`;
  if (done) return null;
  const [top] = await sql`
    SELECT p.xuid, p.gamertag, u.id AS user_id,
           sum(extract(epoch FROM least(s.ended_at, ${to.toISOString()}::timestamptz) - greatest(s.started_at, ${from.toISOString()}::timestamptz)))::bigint AS secs
      FROM player_sessions s JOIN players p ON p.xuid = s.xuid LEFT JOIN users u ON u.mc_uuid = p.uuid
     WHERE s.ended_at > ${from.toISOString()}::timestamptz AND s.started_at < ${to.toISOString()}::timestamptz
       AND NOT coalesce(p.is_op, false) AND NOT coalesce(u.banned, false)
     GROUP BY p.xuid, p.gamertag, u.id ORDER BY secs DESC LIMIT 1`;
  if (!top || Number(top.secs) < 3600) return null;
  await sql`INSERT INTO player_of_week (week, xuid, gamertag, secs) VALUES (${week}::date, ${top.xuid}, ${top.gamertag}, ${top.secs}) ON CONFLICT DO NOTHING`;
  if (top.user_id) {
    let [badge] = await sql`SELECT id FROM badges WHERE name = 'Player of the Week' ORDER BY id LIMIT 1`;
    if (!badge) [badge] = await sql`INSERT INTO badges (name, description, icon, style) VALUES ('Player of the Week', 'Played the most in a week on GalaxySMP.', 'star', 'galaxy') RETURNING id`;
    await sql`INSERT INTO user_badges (user_id, badge_id) VALUES (${top.user_id}, ${badge.id}) ON CONFLICT DO NOTHING`;
    await notify(env, [top.user_id], "community", { title: "You're Player of the Week!", body: `You played the most on GalaxySMP last week (${hours(Number(top.secs))}). It's on your profile now.`, url: `/player/${encodeURIComponent(top.gamertag)}`, tag: "potw" });
  }
  return top;
}
