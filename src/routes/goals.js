// Server-wide goals: the owner sets one (Control Panel), e.g. "Mine 1,000,000 blocks together in 7 days".
// Progress = what everyone did since the goal started. At 25/50/75% and when it's done, the server and
// the website hear about it; everyone who helped gets the reward (in-game money, via the rewards queue).
import { can } from "../lib/perms.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser, getUser } from "../lib/auth.js";
import { toPlugin } from "./economy.js";
import { queueReward } from "./rewards.js";

// stat -> [players column, divide by, unit]
export const STATS = {
  mined: ["mined", 1, "blocks mined"], placed: ["placed", 1, "blocks placed"], playtime: ["playtime_s", 3600, "hours played"],
  kills: ["kills", 1, "mobs defeated"], quests: ["quests_done", 1, "quests completed"], bw_wins: ["bw_wins", 1, "Bedwars wins"],
  bw_games: ["bw_games", 1, "Bedwars games played"],
};
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const money = (c) => `$${Math.round(c / 100).toLocaleString("en-US")}`;

async function active(sql) {
  const [g] = await sql`SELECT * FROM server_goals WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1`;
  return g || null;
}

// Each player's part (value now minus value when the goal started), biggest first.
async function contributions(sql, g, limit = 100000) {
  const [col, div] = STATS[g.stat];
  const rows = await sql.query(
    `SELECT p.xuid, p.gamertag, GREATEST(0, p.${col} - coalesce(b.value, 0))::bigint AS v
       FROM players p LEFT JOIN server_goal_base b ON b.goal_id = $1 AND b.xuid = p.xuid
      WHERE p.${col} - coalesce(b.value, 0) > 0 ORDER BY v DESC LIMIT ${Number(limit)}`, [g.id]);
  return rows.map((r) => ({ xuid: r.xuid, name: r.gamertag, value: Math.floor(Number(r.v) / div), raw: Number(r.v) }));
}

async function progressOf(sql, g) {
  const [col, div] = STATS[g.stat];
  const [{ total }] = await sql.query(
    `SELECT coalesce(sum(GREATEST(0, p.${col} - coalesce(b.value, 0))), 0)::bigint AS total
       FROM players p LEFT JOIN server_goal_base b ON b.goal_id = $1 AND b.xuid = p.xuid`, [g.id]);
  return Math.floor(Number(total) / div);
}

function left(ms) {
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  return h >= 48 ? `${Math.floor(h / 24)} days` : h >= 1 ? `${h} hours` : `${Math.max(1, Math.round(ms / 60000))} minutes`;
}

async function summary(sql, g, withNames) {
  const progress = g.closed_at && g.done_at ? Number(g.target) : await progressOf(sql, g);
  return {
    id: g.id, title: g.title, stat: g.stat, unit: STATS[g.stat][2], target: Number(g.target), progress: Math.min(progress, Number(g.target)),
    rewardCents: Number(g.reward_cents), startsAt: g.starts_at, endsAt: g.ends_at, finished: Boolean(g.done_at), closed: Boolean(g.closed_at),
    endsIn: left(new Date(g.ends_at) - Date.now()),
    ...(withNames ? { top: (await contributions(sql, g, 5)).map(({ name, value }) => ({ name, value })) } : {}),
  };
}

// GET /api/goals/current  (anyone; top helpers only for signed-in members)
export async function current(request, env) {
  const sql = getDb(env);
  const me = await getUser(request, env).catch(() => null);
  const g = (await active(sql)) || (await sql`SELECT * FROM server_goals WHERE closed_at > now() - interval '3 days' ORDER BY id DESC LIMIT 1`)[0];
  return json({ ok: true, goal: g ? await summary(sql, g, Boolean(me)) : null }, 200, { "Cache-Control": "no-store" });
}

// GET /api/mod/goals  POST /api/mod/goals { action: "create" | "end", ... }  (Admin Panel)
export async function manage(request, env) {
  const user = await requireUser(request, env);
  if (!can(user, "admin_panel")) throw new HttpError(403, "Only Admins can set server goals.");
  const sql = getDb(env);
  if (request.method === "GET") {
    const list = await sql`SELECT * FROM server_goals ORDER BY id DESC LIMIT 10`;
    return json({ ok: true, stats: Object.entries(STATS).map(([k, v]) => ({ key: k, unit: v[2] })), goals: await Promise.all(list.map((g) => summary(sql, g, true))) });
  }
  const b = await readJson(request);
  if (b.action === "end") {
    const g = await active(sql);
    if (!g) throw new HttpError(404, "There's no goal running.");
    await sql`UPDATE server_goals SET closed_at = now() WHERE id = ${g.id}`;
    await sendGoal(env, sql);
    return json({ ok: true });
  }
  if (await active(sql)) throw new HttpError(409, "A goal is already running. End it first.");
  const title = clean(b.title, 80);
  if (title.length < 3) throw new HttpError(400, "Give the goal a title, e.g. \"Mine a million blocks together\".");
  if (!STATS[b.stat]) throw new HttpError(400, "Choose what counts.");
  const target = Math.round(Number(b.target));
  if (!Number.isFinite(target) || target < 1 || target > 1e12) throw new HttpError(400, "Choose a target number.");
  const days = Math.round(Number(b.days));
  if (!Number.isInteger(days) || days < 1 || days > 60) throw new HttpError(400, "Choose 1 to 60 days.");
  const reward = Math.round(Number(b.rewardDollars || 0) * 100);
  if (!Number.isFinite(reward) || reward < 0 || reward > 1e11) throw new HttpError(400, "That reward isn't valid.");
  const [col] = STATS[b.stat];
  const [g] = await sql`INSERT INTO server_goals (title, stat, target, reward_cents, ends_at, created_by)
                         VALUES (${title}, ${b.stat}, ${target}, ${reward}, now() + make_interval(days => ${days}), ${user.id}) RETURNING *`;
  await sql.query(`INSERT INTO server_goal_base (goal_id, xuid, value) SELECT $1, xuid, ${col} FROM players`, [g.id]);
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'goal.create', ${JSON.stringify({ title, stat: b.stat, target })}::jsonb)`;
  const text = `New server goal: ${title}! ${target.toLocaleString("en-US")} ${STATS[b.stat][2]} in ${days} day${days === 1 ? "" : "s"}${reward ? `. Everyone who helps gets ${money(reward)}` : ""}. Type /goal to see it.`;
  await toPlugin(env, { type: "announce", text, by: "Server goal" }).catch(() => {});
  await sendGoal(env, sql);
  return json({ ok: true, goal: await summary(sql, g, true) });
}

async function sendGoal(env, sql) {
  const g = (await active(sql)) || (await sql`SELECT * FROM server_goals WHERE closed_at > now() - interval '3 days' ORDER BY id DESC LIMIT 1`)[0];
  await toPlugin(env, { type: "goal", goal: g ? await summary(sql, g, true) : null }).catch(() => {});
}

// Every 5 minutes: milestones, finishing (rewards), running out of time, and the latest numbers for /goal.
export async function goalsTick(env, sql) {
  const g = await active(sql);
  if (g) {
    const progress = await progressOf(sql, g);
    const pct = Math.floor((progress / Number(g.target)) * 100);
    if (progress >= Number(g.target)) {
      const [won] = await sql`UPDATE server_goals SET done_at = now(), closed_at = now() WHERE id = ${g.id} AND closed_at IS NULL RETURNING id`;
      if (won) {
        const helpers = await contributions(sql, g);
        if (Number(g.reward_cents) > 0) for (const h of helpers) await queueReward(sql, { xuid: h.xuid, name: h.name, cents: Number(g.reward_cents), reason: `Server goal: ${g.title}` });
        await toPlugin(env, { type: "announce", text: `Goal reached: ${g.title}! Thanks to all ${helpers.length} players who helped${Number(g.reward_cents) ? `. Your ${money(Number(g.reward_cents))} is on its way` : ""}.`, by: "Server goal" }).catch(() => {});
        const { notify } = await import("./notify.js");
        await notify(env, "all", "events", { title: "Server goal reached!", body: `${g.title}: done by ${helpers.length} players together.`, url: "/", tag: `goal-${g.id}` }).catch(() => {});
      }
    } else if (new Date(g.ends_at) <= new Date()) {
      await sql`UPDATE server_goals SET closed_at = now() WHERE id = ${g.id}`;
      await toPlugin(env, { type: "announce", text: `Time's up for the goal "${g.title}": ${progress.toLocaleString("en-US")} of ${Number(g.target).toLocaleString("en-US")}. So close! Next time.`, by: "Server goal" }).catch(() => {});
    } else {
      const step = [75, 50, 25].find((s) => pct >= s && s > g.milestone);
      if (step) {
        await sql`UPDATE server_goals SET milestone = ${step} WHERE id = ${g.id}`;
        await toPlugin(env, { type: "announce", text: `Server goal ${step}% done: ${g.title} (${progress.toLocaleString("en-US")} of ${Number(g.target).toLocaleString("en-US")}). Keep going! /goal`, by: "Server goal" }).catch(() => {});
      }
    }
  }
  await sendGoal(env, sql);
}
