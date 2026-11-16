// Things that make Community livelier:
//   - Chat levels: chatting earns XP (once a minute, capped per day so spam doesn't pay). Level-ups are announced
//     in #Bot Commands, where players can also type !level, !rank, !top and !help.
//   - @GalaxySMP posts: the Question of the Day (6:30 AM New York time, answered in a thread), welcome cards for
//     new players (with a Wave button) and level-ups. They're normal messages with no author and a "kind".
//   - Website activity for Friend Streaks: 15 minutes with Community open + at least 1 message in a day counts
//     as "played" that day.
import { loadMessage } from "./messages.js";

export const BOT_NAME = "GalaxySMP";
export const BOT_CHANNEL = "bot-commands";
export const GENERAL = "chat";
const TZ = "America/New_York";
const XP_MIN = 15, XP_MAX = 25, XP_COOLDOWN_MS = 60_000, XP_DAILY_CAP = 1500;
export const ACTIVE_MINUTES = 15;

// XP needed to go from level l to l + 1 (like most chat bots: it gets a little harder each level)
export const needFor = (l) => 5 * l * l + 50 * l + 100;
export function levelFor(xp) {
  let l = 0, left = xp;
  while (left >= needFor(l)) { left -= needFor(l); l++; }
  return { level: l, into: left, next: needFor(l) };
}
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

// Posts a message as @GalaxySMP. Returns the message (the caller sends it to everyone).
export async function botPost(sql, { slug, channelId, content, kind, meta = null, replyTo = null, threadRoot = null }) {
  const [ch] = channelId ? [{ id: channelId }] : await sql`SELECT id FROM channels WHERE slug = ${slug}`;
  if (!ch) return null;
  const [row] = await sql`INSERT INTO messages (channel_id, user_id, content, kind, meta, game_name, reply_to, thread_root)
                          VALUES (${ch.id}, NULL, ${String(content).slice(0, 2000)}, ${kind}, ${meta ? JSON.stringify(meta) : null}::jsonb, ${BOT_NAME}, ${replyTo}, ${threadRoot})
                          RETURNING id`;
  return loadMessage(sql, row.id);
}

// After a member sends a message in a channel. `broadcast(message)` sends a new bot message to everyone.
export async function afterMessage(env, sql, user, channelId, message, broadcast) {
  const [ch] = await sql`SELECT slug FROM channels WHERE id = ${channelId}`;
  await countActivity(env, sql, user.id, { message: true });
  if (ch?.slug === BOT_CHANNEL && /^![a-z]/i.test(message.content || "")) {
    await command(sql, user, channelId, message, broadcast);
    return;  // commands don't earn XP
  }
  await giveXp(sql, user, broadcast);
}

async function giveXp(sql, user, broadcast) {
  const gain = XP_MIN + Math.floor(Math.random() * (XP_MAX - XP_MIN + 1));
  const day = today();
  const [row] = await sql`
    INSERT INTO chat_xp (user_id, xp, level, last_at, day, day_xp) VALUES (${user.id}, ${gain}, 0, now(), ${day}::date, ${gain})
    ON CONFLICT (user_id) DO UPDATE SET
      xp = chat_xp.xp + ${gain}, last_at = now(),
      day_xp = CASE WHEN chat_xp.day = ${day}::date THEN chat_xp.day_xp + ${gain} ELSE ${gain} END,
      day = ${day}::date
    WHERE (chat_xp.last_at IS NULL OR chat_xp.last_at < now() - make_interval(secs => ${XP_COOLDOWN_MS / 1000}))
      AND (chat_xp.day IS DISTINCT FROM ${day}::date OR chat_xp.day_xp < ${XP_DAILY_CAP})
    RETURNING xp, level`;
  if (!row) return;  // too soon, or the daily cap
  const { level } = levelFor(Number(row.xp));
  if (level <= Number(row.level)) return;
  await sql`UPDATE chat_xp SET level = ${level} WHERE user_id = ${user.id}`;
  const m = await botPost(sql, { slug: BOT_CHANNEL, kind: "levelup", meta: { userId: Number(user.id), level },
    content: `🎉 **${user.username}** reached chat level **${level}**! Keep chatting to level up.` });
  if (m) await broadcast(m);
}

export async function levelInfo(sql, userId) {
  const [row] = await sql`SELECT xp FROM chat_xp WHERE user_id = ${userId}`;
  const xp = Number(row?.xp || 0);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM chat_xp WHERE xp > ${xp}`;
  return { xp, rank: n + 1, ...levelFor(xp) };
}

async function command(sql, user, channelId, message, broadcast) {
  const [cmd, ...args] = message.content.trim().slice(1).split(/\s+/);
  const reply = async (content) => {
    const m = await botPost(sql, { channelId, content, kind: "bot", replyTo: message.id });
    if (m) await broadcast(m);
  };
  const c = cmd.toLowerCase();
  if (c === "level" || c === "rank" || c === "lvl") {
    let who = { id: user.id, username: user.username };
    if (args[0]) {
      const name = args.join(" ").replace(/^@/, "").toLowerCase();
      const [u] = await sql`SELECT u.id, u.username FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
                             WHERE (u.username_lower = ${name} OR lower(p.gamertag) = ${name}) AND NOT u.banned LIMIT 1`;
      if (!u) return reply(`I couldn't find a member called "${args.join(" ").slice(0, 32)}".`);
      who = u;
    }
    const i = await levelInfo(sql, who.id);
    const bar = "▰".repeat(Math.round((i.into / i.next) * 10)).padEnd(10, "▱");
    return reply(`**${who.username}** is chat level **${i.level}** (#${i.rank} on the server)\n${bar} ${i.into.toLocaleString("en-US")} / ${i.next.toLocaleString("en-US")} XP to level ${i.level + 1}`);
  }
  if (c === "top" || c === "leaderboard") {
    const rows = await sql`SELECT u.username, x.xp FROM chat_xp x JOIN users u ON u.id = x.user_id WHERE NOT u.banned ORDER BY x.xp DESC LIMIT 10`;
    if (!rows.length) return reply("Nobody has any chat XP yet. Start chatting!");
    const medal = ["🥇", "🥈", "🥉"];
    return reply("**Top chatters**\n" + rows.map((r, i) => `${medal[i] || `${i + 1}.`} ${r.username}: level ${levelFor(Number(r.xp)).level} (${Number(r.xp).toLocaleString("en-US")} XP)`).join("\n"));
  }
  if (c === "help" || c === "commands") {
    return reply("**Commands**\n`!level` your chat level\n`!level name` someone else's level\n`!top` the top 10 chatters\n\nYou earn chat XP for chatting in any channel (once a minute).");
  }
  return reply(`I don't know \`!${c.slice(0, 20)}\`. Type \`!help\` to see what I can do.`);
}

// ---------- website activity (Friend Streaks) ----------
// minute: one more minute with Community open on screen; message: they sent a message.
export async function countActivity(env, sql, userId, { minute = false, message = false }) {
  const day = today();
  const [row] = await sql`
    INSERT INTO web_activity (user_id, day, minutes, messages) VALUES (${userId}, ${day}::date, ${minute ? 1 : 0}, ${message ? 1 : 0})
    ON CONFLICT (user_id, day) DO UPDATE SET minutes = web_activity.minutes + ${minute ? 1 : 0}, messages = web_activity.messages + ${message ? 1 : 0}
    RETURNING minutes, messages`;
  // the moment today starts counting: update their Friend Streaks
  const crossed = (minute && row.minutes === ACTIVE_MINUTES && row.messages >= 1) || (message && row.messages === 1 && row.minutes >= ACTIVE_MINUTES);
  if (crossed) await import("../routes/friendstreaks.js").then((m) => m.update(env, sql, [Number(userId)])).catch((e) => console.error("friend streak (web) failed", e));
}

// ---------- Question of the Day ----------
// Every 5 minutes: at 6:30 AM New York time (or later that day, if the site was asleep), post today's question.
export async function qotdTick(env, sql, broadcast) {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  if (parts.hour * 60 + parts.minute < 6 * 60 + 30) return;
  const day = today();
  const [claimed] = await sql`INSERT INTO economy_config (key, value, updated_by) VALUES (${`qotd:${day}`}, ${JSON.stringify(now.toISOString())}::jsonb, 'server')
                              ON CONFLICT (key) DO NOTHING RETURNING key`;
  if (!claimed) return;
  // the question used longest ago (new ones first), so they don't repeat until all have been asked
  const [q] = await sql`SELECT id, text FROM qotd_questions ORDER BY used_at ASC NULLS FIRST, random() LIMIT 1`;
  if (!q) return;
  await sql`UPDATE qotd_questions SET used_at = now() WHERE id = ${q.id}`;
  const m = await botPost(sql, { slug: GENERAL, kind: "qotd", meta: { questionId: Number(q.id), day },
    content: `**Question of the Day**\n${q.text}` });
  if (m) await broadcast(m);
}

// ---------- welcome cards ----------
export async function welcomeCard(sql, { xuid, name }, broadcast) {
  const [u] = await sql`SELECT u.id FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE p.xuid = ${xuid} LIMIT 1`;
  const m = await botPost(sql, { slug: GENERAL, kind: "welcome", meta: { xuid, name, userId: u ? Number(u.id) : null },
    content: `👋 **${name}** just joined GalaxySMP for the first time! Give them a wave.` });
  if (m) await broadcast(m);
}
