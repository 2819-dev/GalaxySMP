// #Jobs: players pay other players (in-game money) to gather, build or craft for them.
//   1. Posting takes the reward from the poster's balance and holds it (the plugin does this, so the
//      server must be online). Operators aren't charged, so nothing is given back to them either.
//   2. Someone gets the job: "first" = the first player to press Take it; "pick" = players say "I can do it"
//      and the poster hires one.
//   3. The worker presses "Mark as done". The poster confirms (the worker is paid) or says "Not done yet".
//      If the poster doesn't answer in 3 days, the worker is paid anyway.
//   4. Unclaimed jobs end after 7 days and the money goes back. The poster can cancel an open job any time.
// Staff (the "Delete other people's messages" permission) can settle any job: pay the worker or refund the poster.
// Payments and refunds use the rewards queue, so they reach players even when they're offline.
import { can } from "../lib/perms.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { voiceStub } from "./voice.js";
import { notify } from "./notify.js";
import { queueReward, sendRewards } from "./rewards.js";

export const MIN_REWARD = 100;                 // $1
export const MAX_REWARD = 100_000_000_000;     // $1B
export const MAX_POSTED = 5;                   // open/taken/submitted jobs one player can have posted
export const MAX_WORKING = 3;                  // jobs one player can be doing at once
export const OPEN_DAYS = 7;
export const AUTO_PAY_DAYS = 3;
const ACTIVE = ["open", "taken", "submitted"];

const isStaff = (u) => can(u, "delete_messages");
const dollars = (c) => `$${(Number(c) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const oneLine = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const text = (v, max) => String(v ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

async function ask(env, msg) {
  return voiceStub(env).fetch("https://voice/internal/ask", { method: "POST", body: JSON.stringify({ type: "job", ...msg }) })
    .then((r) => r.json()).catch(() => ({ ok: false, message: "The Minecraft server isn't connected right now." }));
}

async function filterOrThrow(sql, parts) {
  const list = compileWordList(await sql`SELECT word, match FROM filter_words`);
  for (const part of parts.filter(Boolean)) {
    const check = checkMessage(String(part).replace(/\n+/g, " ").toLowerCase(), list);
    if (!check.ok) throw new HttpError(400, check.message || "That isn't allowed.");
  }
}

async function player(sql, userId) {
  const [p] = await sql`SELECT p.xuid, p.gamertag FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${userId}`;
  return p || null;
}

function canAct(user) {
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  if (user.muted_until && new Date(user.muted_until) > new Date()) throw new HttpError(403, "You're muted, so you can't use #Jobs right now.");
}

const out = (j, user, applicants) => {
  const mine = Number(j.poster_id) === Number(user.id);
  const working = Number(j.worker_id) === Number(user.id);
  const list = applicants.filter((a) => Number(a.job_id) === Number(j.id));
  return {
    id: Number(j.id), title: j.title, details: j.details, reward: Number(j.reward_cents), mode: j.mode, status: j.status,
    poster: j.poster_name, posterId: Number(j.poster_id), worker: j.worker_name || null, workerId: j.worker_id ? Number(j.worker_id) : null,
    note: j.note || "", settledBy: j.settled_by || null,
    createdAt: j.created_at, takenAt: j.taken_at, submittedAt: j.submitted_at, finishedAt: j.finished_at,
    endsAt: j.status === "open" ? new Date(new Date(j.created_at).getTime() + OPEN_DAYS * 864e5).toISOString() : null,
    autoPayAt: j.status === "submitted" ? new Date(new Date(j.submitted_at).getTime() + AUTO_PAY_DAYS * 864e5).toISOString() : null,
    mine, working,
    applied: list.some((a) => Number(a.user_id) === Number(user.id)),
    applicantCount: list.length,
    // only the poster (and staff) see who offered
    applicants: mine || isStaff(user) ? list.map((a) => ({ userId: Number(a.user_id), name: a.name, note: a.note, at: a.created_at })) : [],
  };
};

// GET /api/jobs
export async function list(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const p = await player(sql, user.id);
  const jobs = await sql`
    SELECT * FROM jobs
     WHERE status = ANY(${ACTIVE}::text[])
        OR ((poster_id = ${user.id} OR worker_id = ${user.id}) AND status IN ('done', 'cancelled', 'expired') AND finished_at > now() - interval '30 days')
     ORDER BY (status = 'open') DESC, id DESC LIMIT 200`;
  const ids = jobs.map((j) => Number(j.id));
  const applicants = ids.length ? await sql`SELECT * FROM job_applicants WHERE job_id = ANY(${ids}::bigint[]) ORDER BY created_at` : [];
  const [stats] = await sql`SELECT count(*) FILTER (WHERE status = 'done')::int AS done, coalesce(sum(reward_cents) FILTER (WHERE status = 'done'), 0)::bigint AS paid
                              FROM jobs WHERE finished_at > now() - interval '30 days'`;
  return json({
    ok: true, linked: Boolean(p), me: p?.gamertag || user.username, userId: Number(user.id), staff: isStaff(user),
    limits: { min: MIN_REWARD, max: MAX_REWARD, openDays: OPEN_DAYS, autoPayDays: AUTO_PAY_DAYS },
    month: { done: stats.done, paid: Number(stats.paid) },
    jobs: jobs.map((j) => out(j, user, applicants)),
  });
}

// Takes the reward from the poster (idempotent in the plugin: asking twice for the same job charges once).
async function hold(env, sql, j) {
  const a = await ask(env, { op: "hold", id: Number(j.id), xuid: j.poster_xuid, name: j.poster_name, cents: Number(j.reward_cents) });
  if (a.ok) {
    await sql`UPDATE jobs SET status = 'open', charged = ${a.charged !== false}, created_at = now() WHERE id = ${j.id} AND status = 'creating'`;
  }
  return a;
}

// POST /api/jobs { title, details, reward (cents), mode }
export async function create(request, env) {
  const user = await requireUser(request, env);
  canAct(user);
  const sql = getDb(env);
  await rateLimit(env, "AUTH_LIMITER", `job:${user.id}`);
  const p = await player(sql, user.id);
  if (!p) throw new HttpError(400, "Link your Minecraft account first (type /link in game), so we know whose money to use.");
  const body = await readJson(request);
  const title = oneLine(body.title, 80);
  const details = text(body.details, 600);
  const reward = Math.round(Number(body.reward));
  const mode = body.mode === "first" ? "first" : "pick";
  if (title.length < 4) throw new HttpError(400, "Say what you need (at least 4 characters), e.g. \"64 oak logs\".");
  if (!Number.isFinite(reward) || reward < MIN_REWARD || reward > MAX_REWARD) throw new HttpError(400, "Choose a reward from $1 to $1B.");
  await filterOrThrow(sql, [title, details]);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM jobs WHERE poster_id = ${user.id} AND status = ANY(${ACTIVE}::text[])`;
  if (n >= MAX_POSTED) throw new HttpError(429, `You can have up to ${MAX_POSTED} jobs at a time. Finish or cancel one first.`);
  const [j] = await sql`INSERT INTO jobs (poster_id, poster_xuid, poster_name, title, details, reward_cents, mode)
                        VALUES (${user.id}, ${p.xuid}, ${p.gamertag}, ${title}, ${details}, ${reward}, ${mode}) RETURNING *`;
  const a = await hold(env, sql, j);
  if (!a.ok) {
    // didn't answer: the money may or may not have been taken, so keep it and let the timer ask again
    if (/didn't answer/i.test(a.message || "")) return json({ ok: true, pending: true, message: "The server is slow to answer. Your job will appear in a minute." });
    await sql`DELETE FROM jobs WHERE id = ${j.id} AND status = 'creating'`;
    throw new HttpError(409, /isn't connected/i.test(a.message || "") ? "The Minecraft server needs to be online to post a job (the reward is taken from your balance)." : a.message || "The job couldn't be posted.");
  }
  return json({ ok: true, id: Number(j.id), message: a.charged === false ? "Job posted." : `Job posted. ${dollars(reward)} is held until the job is done.` });
}

// Pays the worker (or refunds the poster). Marks the job finished first, so it can only happen once.
async function settle(env, sql, j, outcome, by, note = "") {
  const status = outcome === "pay" ? "done" : outcome === "expire" ? "expired" : "cancelled";
  const [row] = await sql`UPDATE jobs SET status = ${status}, finished_at = now(), settled_by = ${by}, note = ${note || ""}
                           WHERE id = ${j.id} AND status = ${j.status} RETURNING *`;
  if (!row) throw new HttpError(409, "This job just changed. Refresh and try again.");
  const cents = Number(row.reward_cents);
  if (outcome === "pay") {
    await queueReward(sql, { xuid: row.worker_xuid, name: row.worker_name, cents, reason: `Job: ${row.title}`.slice(0, 120) });
  } else if (row.charged) {
    await queueReward(sql, { xuid: row.poster_xuid, name: row.poster_name, cents, reason: `Job ${status}: ${row.title}`.slice(0, 120) });
  }
  await sql`DELETE FROM job_applicants WHERE job_id = ${row.id}`;
  await sendRewards(env, sql).catch(() => {});
  return row;
}

const push = (env, ids, title, body, jobId) => notify(env, ids.filter(Boolean), "jobs", { title, body, url: "/community#jobs", tag: `job-${jobId}` }).catch(() => {});

// POST /api/jobs/:id { action, userId?, note? }
export async function action(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  canAct(user);
  const sql = getDb(env);
  await rateLimit(env, "POLL_LIMITER", `jobact:${user.id}`);
  const body = await readJson(request);
  const act = String(body.action || "");
  const [j] = await sql`SELECT * FROM jobs WHERE id = ${Number(params.id) || 0}`;
  if (!j || j.status === "creating") throw new HttpError(404, "That job no longer exists.");
  const mine = Number(j.poster_id) === Number(user.id);
  const working = Number(j.worker_id) === Number(user.id);
  const need = (cond, msg) => { if (!cond) throw new HttpError(409, msg); };

  const startWork = async (workerId, workerXuid, workerName) => {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM jobs WHERE worker_id = ${workerId} AND status IN ('taken', 'submitted')`;
    need(n < MAX_WORKING, workerId === Number(user.id) ? `You can do up to ${MAX_WORKING} jobs at once. Finish one first.` : `${workerName} already has ${MAX_WORKING} jobs going.`);
    const [row] = await sql`UPDATE jobs SET status = 'taken', worker_id = ${workerId}, worker_xuid = ${workerXuid}, worker_name = ${workerName}, taken_at = now(), note = ''
                             WHERE id = ${j.id} AND status = 'open' RETURNING id`;
    need(row, "Someone else just got this job.");
    await sql`DELETE FROM job_applicants WHERE job_id = ${j.id}`;
  };

  switch (act) {
    case "take": { // first come
      need(j.status === "open", "This job isn't open any more.");
      need(j.mode === "first", "The poster picks who gets this job. Press \"I can do it\" instead.");
      need(!mine, "That's your own job.");
      const p = await player(sql, user.id);
      need(p, "Link your Minecraft account first (type /link in game), so you can be paid.");
      await startWork(Number(user.id), p.xuid, p.gamertag);
      await push(env, [Number(j.poster_id)], `${p.gamertag} took your job`, j.title, j.id);
      return json({ ok: true, message: `It's yours! Do the job in game, then press "Mark as done". You'll get ${dollars(j.reward_cents)}.` });
    }
    case "apply": {
      need(j.status === "open", "This job isn't open any more.");
      need(j.mode === "pick", "This job is first come, first served. Press \"Take job\".");
      need(!mine, "That's your own job.");
      const p = await player(sql, user.id);
      need(p, "Link your Minecraft account first (type /link in game), so you can be paid.");
      const note = oneLine(body.note, 160);
      if (note) await filterOrThrow(sql, [note]);
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM job_applicants WHERE job_id = ${j.id}`;
      need(n < 30, "Lots of players already offered. Try another job.");
      const added = await sql`INSERT INTO job_applicants (job_id, user_id, xuid, name, note) VALUES (${j.id}, ${user.id}, ${p.xuid}, ${p.gamertag}, ${note})
                              ON CONFLICT DO NOTHING RETURNING job_id`;
      if (added.length) await push(env, [Number(j.poster_id)], `${p.gamertag} can do your job`, `${j.title}${note ? `: "${note}"` : ""}`, j.id);
      return json({ ok: true, message: `Sent! ${j.poster_name} gets a notification and picks who does it.` });
    }
    case "unapply": {
      await sql`DELETE FROM job_applicants WHERE job_id = ${j.id} AND user_id = ${user.id}`;
      return json({ ok: true, message: "You took back your offer." });
    }
    case "hire": {
      need(mine, "Only the poster can pick who does the job.");
      need(j.status === "open", "This job isn't open any more.");
      const [a] = await sql`SELECT * FROM job_applicants WHERE job_id = ${j.id} AND user_id = ${Number(body.userId) || 0}`;
      need(a, "They took back their offer.");
      const others = (await sql`SELECT user_id FROM job_applicants WHERE job_id = ${j.id} AND user_id <> ${a.user_id}`).map((r) => Number(r.user_id));
      await startWork(Number(a.user_id), a.xuid, a.name);
      await push(env, [Number(a.user_id)], "You got the job!", `${j.poster_name} picked you for: ${j.title}. Reward: ${dollars(j.reward_cents)}`, j.id);
      if (others.length) await push(env, others, "Job filled", `${j.poster_name} picked someone else for: ${j.title}`, j.id);
      return json({ ok: true, message: `${a.name} is doing your job. You'll get a notification when they say it's done.` });
    }
    case "giveup": {
      need(working && j.status === "taken", "You're not doing this job.");
      await sql`UPDATE jobs SET status = 'open', worker_id = NULL, worker_xuid = NULL, worker_name = NULL, taken_at = NULL WHERE id = ${j.id} AND status = 'taken'`;
      await push(env, [Number(j.poster_id)], "A job is open again", `${j.worker_name} gave up on: ${j.title}`, j.id);
      return json({ ok: true, message: "You gave the job back. It's open for others again." });
    }
    case "release": {
      need(mine && j.status === "taken", "You can only remove the worker while they're still working on it.");
      await sql`UPDATE jobs SET status = 'open', worker_id = NULL, worker_xuid = NULL, worker_name = NULL, taken_at = NULL WHERE id = ${j.id} AND status = 'taken'`;
      await push(env, [Number(j.worker_id)], "You were taken off a job", `${j.poster_name} reopened: ${j.title}`, j.id);
      return json({ ok: true, message: "The job is open again." });
    }
    case "submit": {
      need(working && j.status === "taken", "You're not doing this job.");
      await sql`UPDATE jobs SET status = 'submitted', submitted_at = now() WHERE id = ${j.id} AND status = 'taken'`;
      await push(env, [Number(j.poster_id)], `${j.worker_name} finished your job`, `${j.title}. Check it, then confirm to pay them.`, j.id);
      return json({ ok: true, message: `Nice! ${j.poster_name} has ${AUTO_PAY_DAYS} days to check it. If they don't answer, you're paid automatically.` });
    }
    case "confirm": {
      need(mine && j.status === "submitted", "Only the poster can confirm, after the worker marks it done.");
      await settle(env, sql, j, "pay", "poster");
      await push(env, [Number(j.worker_id)], `You were paid ${dollars(j.reward_cents)}!`, `${j.poster_name} confirmed: ${j.title}`, j.id);
      return json({ ok: true, message: `Paid! ${j.worker_name} gets ${dollars(j.reward_cents)}.` });
    }
    case "reject": {
      need(mine && j.status === "submitted", "You can only say this after the worker marks it done.");
      const note = oneLine(body.note, 200);
      need(note.length >= 3, "Tell them what's missing.");
      await filterOrThrow(sql, [note]);
      await sql`UPDATE jobs SET status = 'taken', submitted_at = NULL, note = ${note} WHERE id = ${j.id} AND status = 'submitted'`;
      await push(env, [Number(j.worker_id)], "Not done yet", `${j.poster_name}: "${note}"`, j.id);
      return json({ ok: true, message: "Sent. They'll finish it and mark it done again." });
    }
    case "cancel": {
      need(mine || isStaff(user), "Only the poster can cancel this job.");
      need(j.status === "open" || (!mine && isStaff(user) && ACTIVE.includes(j.status)), "You can only cancel a job nobody is doing. Remove the worker first, or ask staff in #Support.");
      const row = await settle(env, sql, j, "refund", mine ? "poster" : `staff:${user.username}`);
      if (!mine) await push(env, [Number(j.poster_id)], "Staff cancelled your job", `${j.title}${row.charged ? `. ${dollars(j.reward_cents)} is back in your balance.` : ""}`, j.id);
      if (j.worker_id) await push(env, [Number(j.worker_id)], "A job was cancelled", j.title, j.id);
      return json({ ok: true, message: row.charged ? `Cancelled. ${dollars(j.reward_cents)} goes back to ${mine ? "you" : j.poster_name}.` : "Cancelled." });
    }
    case "staff_pay": {
      need(isStaff(user), "Only staff can do that.");
      need(j.worker_id && ["taken", "submitted"].includes(j.status), "Nobody is doing this job.");
      await settle(env, sql, j, "pay", `staff:${user.username}`, oneLine(body.note, 200));
      await push(env, [Number(j.worker_id)], `You were paid ${dollars(j.reward_cents)}!`, `Staff settled: ${j.title}`, j.id);
      await push(env, [Number(j.poster_id)], "Staff settled your job", `${j.worker_name} was paid for: ${j.title}`, j.id);
      return json({ ok: true, message: `${j.worker_name} was paid.` });
    }
    default:
      throw new HttpError(400, "Unknown action.");
  }
}

// Every 5 minutes: finish posting jobs the server was slow to confirm, pay workers the poster didn't answer,
// and end open jobs nobody took.
export async function jobsTick(env, sql = getDb(env)) {
  const waiting = await sql`SELECT * FROM jobs WHERE status = 'creating' ORDER BY id LIMIT 10`;
  for (const j of waiting) {
    const a = await hold(env, sql, j);
    const old = Date.now() - new Date(j.created_at).getTime() > 864e5;
    if (!a.ok && (old || !/didn't answer|isn't connected/i.test(a.message || ""))) {
      await sql`DELETE FROM jobs WHERE id = ${j.id} AND status = 'creating'`;
      await ask(env, { op: "forget", id: Number(j.id), xuid: j.poster_xuid, name: j.poster_name, cents: Number(j.reward_cents) }); // never posted: if the money was taken, the plugin gives it back
    }
  }
  const late = await sql`SELECT * FROM jobs WHERE status = 'submitted' AND submitted_at < now() - make_interval(days => ${AUTO_PAY_DAYS}) LIMIT 20`;
  for (const j of late) {
    await settle(env, sql, j, "pay", "auto").catch(() => null);
    await push(env, [Number(j.worker_id)], `You were paid ${dollars(j.reward_cents)}!`, `${j.title} (the poster didn't answer in ${AUTO_PAY_DAYS} days)`, j.id);
  }
  const stale = await sql`SELECT * FROM jobs WHERE status = 'open' AND created_at < now() - make_interval(days => ${OPEN_DAYS}) LIMIT 20`;
  for (const j of stale) {
    const row = await settle(env, sql, j, "expire", "auto").catch(() => null);
    if (row) await push(env, [Number(j.poster_id)], "Your job ended", `Nobody took "${j.title}" in ${OPEN_DAYS} days.${row.charged ? ` ${dollars(j.reward_cents)} is back in your balance.` : ""}`, j.id);
  }
}
