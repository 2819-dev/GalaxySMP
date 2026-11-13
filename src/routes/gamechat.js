// #Chat and Minecraft chat are one conversation: what players say in game shows in #Chat, and what members
// write in #Chat shows in game, looking the same as normal game chat. The chat filter applies both ways.
import { getDb } from "../lib/db.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { loadMessage } from "../chat/messages.js";
import { hubBroadcast } from "./chat.js";
import { toPlugin } from "./economy.js";

export const BRIDGED_SLUG = "chat";
const strip = (t) => String(t || "").replace(/§./g, "").replace(/\s+/g, " ").trim().slice(0, 500);

// From the plugin: someone chatted in game.
export async function fromGame(env, msg) {
  const text = strip(msg.text);
  const xuid = String(msg.xuid || "");
  const name = String(msg.name || "").slice(0, 32);
  if (!text || !/^\d+$/.test(xuid) || !name) return;
  const sql = getDb(env);
  const [ch] = await sql`SELECT id FROM channels WHERE slug = ${BRIDGED_SLUG} AND kind = 'text'`;
  if (!ch) return;
  const check = checkMessage(text, compileWordList(await sql`SELECT word, match FROM filter_words`), { allowLinks: false, maxLength: 500 });
  if (!check.ok) return; // the game filter already handled it in game; the website keeps it out
  const [u] = await sql`SELECT u.id, u.banned FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE p.xuid = ${xuid} LIMIT 1`;
  if (u?.banned) return;
  const [row] = await sql`INSERT INTO messages (channel_id, user_id, content, game_xuid, game_name)
                          VALUES (${ch.id}, ${u ? u.id : null}, ${check.text}, ${xuid}, ${name}) RETURNING id`;
  const message = await loadMessage(sql, row.id);
  if (message) await hubBroadcast(env, { type: "message", message });
}

// To the plugin: a member wrote in #Chat on the website.
export async function toGame(env, sql, channelId, userId, text) {
  if (!text) return;
  const [ch] = await sql`SELECT slug FROM channels WHERE id = ${channelId}`;
  if (ch?.slug !== BRIDGED_SLUG) return;
  const [u] = await sql`SELECT u.username, p.xuid, p.gamertag FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${userId}`;
  if (!u) return;
  await toPlugin(env, { type: "webchat", xuid: u.xuid || null, name: u.gamertag || u.username, text: strip(text) }).catch(() => {});
}
