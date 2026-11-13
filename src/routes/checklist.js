// New player checklist: a few first steps that help new members settle in. Finishing all of them gives an
// in-game reward (once). Shown on the home page and in Account settings for the first 30 days.
import { getDb } from "../lib/db.js";
import { json, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { queueReward, sendRewards } from "./rewards.js";

export const REWARD_CENTS = 2500_00; // $2,500 in game
const SHOW_DAYS = 30;

async function steps(sql, user) {
  const [r] = await sql`
    SELECT u.created_at, u.checklist_claimed_at, (u.bio IS NOT NULL OR cardinality(coalesce(u.interests, '{}')) > 0) AS profile,
           p.xuid, p.gamertag, p.last_daily IS NOT NULL AS daily, coalesce(p.quests_done, 0) > 0 AS quest, coalesce(p.playtime_s, 0) >= 3600 AS hour,
           EXISTS (SELECT 1 FROM messages m WHERE m.user_id = u.id AND m.deleted_at IS NULL) AS chatted,
           EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id) AS notifications
      FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  const list = [
    { id: "daily", title: "Claim your daily reward", hint: "Type /daily in game.", done: r.daily },
    { id: "quest", title: "Finish a quest", hint: "Type /quests in game to see today's quests.", done: r.quest },
    { id: "hour", title: "Play for an hour", hint: "Explore, build, or try a minigame.", done: r.hour },
    { id: "chat", title: "Say hi in the community", hint: "Send a message in #Chat.", done: r.chatted, href: "/community#chat" },
    { id: "profile", title: "Set up your profile", hint: "Add a short bio and what you like to play.", done: r.profile, href: "/account#profile" },
    { id: "notify", title: "Turn on notifications", hint: "Get event reminders and messages on your phone.", done: r.notifications, href: "/account#notifications" },
  ];
  return { r, list };
}

// GET /api/checklist
export async function get(request, env) {
  const user = await requireUser(request, env);
  const { r, list } = await steps(getDb(env), user);
  const fresh = Date.now() - new Date(r.created_at).getTime() < SHOW_DAYS * 864e5;
  return json({ ok: true, show: fresh && !r.checklist_claimed_at, claimed: Boolean(r.checklist_claimed_at), reward: REWARD_CENTS,
    steps: list.map(({ done, ...s }) => ({ ...s, done: Boolean(done) })), done: list.every((s) => s.done) });
}

// POST /api/checklist/claim
export async function claim(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const { r, list } = await steps(sql, user);
  if (!list.every((s) => s.done)) throw new HttpError(409, "Finish every step first.");
  if (!r.xuid) throw new HttpError(400, "Link your Minecraft account first.");
  const [ok] = await sql`UPDATE users SET checklist_claimed_at = now() WHERE id = ${user.id} AND checklist_claimed_at IS NULL RETURNING id`;
  if (!ok) throw new HttpError(409, "You've already claimed this reward.");
  await queueReward(sql, { xuid: r.xuid, name: r.gamertag, cents: REWARD_CENTS, reason: "New player checklist" });
  await sendRewards(env, sql).catch(() => {});
  return json({ ok: true, message: "Reward claimed. $2,500 is on its way to you in game. Welcome to GalaxySMP!" });
}
