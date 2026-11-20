// Things that make Community livelier:
//   - Chat levels: chatting earns XP (once a minute, capped per day so spam doesn't pay). Level-ups are announced
//     in #Bot Commands. Commands like /level and /top are in routes/commands.js.
//   - @GalaxySMP posts: the Question of the Day (6:30 AM New York time, answered in a thread), welcome cards for
//     new players (with a Wave button) and level-ups. They're normal messages with no author and a "kind".
//   - Website activity for Friend Streaks: 15 minutes with Community open + at least 1 message in a day counts
//     as "played" that day.
import { loadMessage } from "./messages.js";
import { earnsXp, spamKey } from "../lib/spam.js";

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

// The GalaxySMP member account (a real member nobody can sign in to).
let botId = null;
export async function botUserId(sql) {
  if (botId) return botId;
  const [u] = await sql`SELECT id FROM users WHERE is_bot ORDER BY id LIMIT 1`;
  botId = u ? Number(u.id) : null;
  return botId;
}

// Posts a message as GalaxySMP. Returns the message (the caller sends it to everyone).
export async function botPost(sql, { slug, channelId, content, kind, meta = null, replyTo = null, threadRoot = null }) {
  const [ch] = channelId ? [{ id: channelId }] : await sql`SELECT id FROM channels WHERE slug = ${slug}`;
  if (!ch) return null;
  const uid = await botUserId(sql);
  const [row] = await sql`INSERT INTO messages (channel_id, user_id, content, kind, meta, game_name, reply_to, thread_root)
                          VALUES (${ch.id}, ${uid}, ${String(content).slice(0, 2000)}, ${kind}, ${meta ? JSON.stringify(meta) : null}::jsonb, ${uid ? null : BOT_NAME}, ${replyTo}, ${threadRoot})
                          RETURNING id`;
  return loadMessage(sql, row.id);
}

// After a member sends a message in a channel. `broadcast(message)` sends a new bot message to everyone.
export async function afterMessage(env, sql, user, channelId, message, broadcast) {
  const [ch] = await sql`SELECT slug FROM channels WHERE id = ${channelId}`;
  await countActivity(env, sql, user.id, { message: true });
  if (/^!(level|lvl|rank|top|leaderboard|help|commands)\b/i.test(message.content || "")) {
    // commands start with / now: answer once, pointing to the new way
    const m = await botPost(sql, { channelId, kind: "bot", replyTo: message.id,
      content: "Commands start with **/** now: type `/" + message.content.trim().slice(1).split(/\s+/)[0].toLowerCase().replace("lvl", "level").replace("rank", "level").replace("leaderboard", "top").replace("commands", "help") +
        "`, or tap **+** › **Commands** next to the message box." });
    if (m) await broadcast(m);
    return;  // commands don't earn XP
  }
  if (ch?.slug === BOT_CHANNEL) return;  // nothing in #Bot Commands earns XP
  await giveXp(sql, user, broadcast, message);
}

// XP for a real message: not "k" / "lol" / emojis only, not a copy of their last XP message,
// once a minute at most, capped per day. Each award is remembered so it's taken back if the message is deleted.
async function giveXp(sql, user, broadcast, message) {
  if ((await botUserId(sql)) === Number(user.id)) return;  // GalaxySMP doesn't level up
  const text = String(message?.content || "");
  const [cur] = await sql`SELECT last_key FROM chat_xp WHERE user_id = ${user.id}`;
  if (!earnsXp(text, cur?.last_key)) return;
  const key = spamKey(text).slice(0, 200);
  const gain = XP_MIN + Math.floor(Math.random() * (XP_MAX - XP_MIN + 1));
  const day = today();
  const [row] = await sql`
    INSERT INTO chat_xp (user_id, xp, level, last_at, day, day_xp, last_key) VALUES (${user.id}, ${gain}, 0, now(), ${day}::date, ${gain}, ${key})
    ON CONFLICT (user_id) DO UPDATE SET
      xp = chat_xp.xp + ${gain}, last_at = now(), last_key = ${key},
      day_xp = CASE WHEN chat_xp.day = ${day}::date THEN chat_xp.day_xp + ${gain} ELSE ${gain} END,
      day = ${day}::date
    WHERE (chat_xp.last_at IS NULL OR chat_xp.last_at < now() - make_interval(secs => ${XP_COOLDOWN_MS / 1000}))
      AND (chat_xp.day IS DISTINCT FROM ${day}::date OR chat_xp.day_xp < ${XP_DAILY_CAP})
    RETURNING xp, level`;
  if (!row) return;  // too soon, or the daily cap
  if (message?.id) await sql`INSERT INTO chat_xp_log (message_id, user_id, xp, day) VALUES (${message.id}, ${user.id}, ${gain}, ${day}::date) ON CONFLICT DO NOTHING`;
  const { level } = levelFor(Number(row.xp));
  if (level <= Number(row.level)) return;
  await sql`UPDATE chat_xp SET level = ${level} WHERE user_id = ${user.id}`;
  const m = await botPost(sql, { slug: BOT_CHANNEL, kind: "levelup", meta: { userId: Number(user.id), level },
    content: `🎉 **${user.username}** reached chat level **${level}**! Keep chatting to level up.` });
  if (m) await broadcast(m);
}

// A message was deleted: the XP it earned is taken back (and the level goes down if needed).
export async function takeBackXp(sql, messageId) {
  const [r] = await sql`DELETE FROM chat_xp_log WHERE message_id = ${Number(messageId) || 0} RETURNING user_id, xp, day`;
  if (!r) return;
  const [x] = await sql`UPDATE chat_xp SET xp = greatest(0, xp - ${r.xp}),
                          day_xp = CASE WHEN day = ${r.day}::date THEN greatest(0, day_xp - ${r.xp}) ELSE day_xp END
                         WHERE user_id = ${r.user_id} RETURNING xp, level`;
  if (x) {
    const { level } = levelFor(Number(x.xp));
    if (level < Number(x.level)) await sql`UPDATE chat_xp SET level = ${level} WHERE user_id = ${r.user_id}`;
  }
}

export async function levelInfo(sql, userId) {
  const [row] = await sql`SELECT xp FROM chat_xp WHERE user_id = ${userId}`;
  const xp = Number(row?.xp || 0);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM chat_xp WHERE xp > ${xp}`;
  return { xp, rank: n + 1, ...levelFor(xp) };
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
