// Player of the Month: Voting Computers in game.
//  - One switch opens or closes voting on every Voting Computer (staff in game, or the owner in Control Panel).
//  - Players pick anyone who has ever joined the server (not banned, not themselves). One vote per round; voting
//    again while it's open replaces the old vote.
//  - Votes are secret: only the owner sees the totals and who voted for who (Control Panel > Server control).
//  - "New round" starts a fresh count for next month (old rounds are kept). Badges are given by hand.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { isOwner } from "../lib/names.js";
import { toPlugin } from "./economy.js";

const clip = (v, n) => String(v ?? "").slice(0, n);

export async function loadPotm(sql) {
  const [r] = await sql`SELECT value FROM economy_config WHERE key = 'potm'`;
  const v = r?.value || {};
  return { open: Boolean(v.open), round: Number(v.round) || 1, openedAt: v.openedAt || null, by: v.by || null };
}
async function savePotm(sql, state, by) {
  await sql`INSERT INTO economy_config (key, value, updated_by) VALUES ('potm', ${JSON.stringify(state)}::jsonb, ${by})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
}

// Everyone who has ever joined, minus anyone banned right now (in game or on the website).
const ELIGIBLE = `
  SELECT p.xuid, p.gamertag AS name FROM players p
   WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.mc_uuid = p.uuid AND u.banned)
     AND NOT EXISTS (
       SELECT 1 FROM game_punishments g
        WHERE g.id = (SELECT max(g2.id) FROM game_punishments g2 WHERE g2.xuid = p.xuid AND g2.kind IN ('ban', 'unban'))
          AND g.kind = 'ban' AND (g.minutes IS NULL OR g.created_at + g.minutes * interval '1 minute' > now()))`;

export async function candidates(sql) {
  const rows = await sql.query(`${ELIGIBLE} ORDER BY lower(p.gamertag) LIMIT 2000`);
  return rows.map((r) => ({ xuid: String(r.xuid), name: r.name }));
}

// What the plugin needs: open or closed, and the list to pick from (only while open).
export async function potmState(sql) {
  const s = await loadPotm(sql);
  return { type: "potm", open: s.open, round: s.round, candidates: s.open ? await candidates(sql) : [] };
}

async function setOpen(env, sql, open, by) {
  const cur = await loadPotm(sql);
  await savePotm(sql, { ...cur, open, openedAt: open ? cur.openedAt || new Date().toISOString() : cur.openedAt, by }, by);
  await toPlugin(env, await potmState(sql)).catch(() => false);
}

// Messages from the plugin: a vote, or staff opening/closing voting from a Voting Computer.
export async function fromGame(env, msg) {
  const sql = getDb(env);
  const reply = (ok, message, extra = {}) => toPlugin(env, { type: "potm_result", req: clip(msg.req, 40), xuid: clip(msg.xuid, 40), ok, message, ...extra }).catch(() => false);
  if (msg.type === "potm_set") {
    await setOpen(env, sql, Boolean(msg.open), `${clip(msg.name, 40)} (in game)`);
    return reply(true, msg.open ? "Voting is now open on every Voting Computer." : "Voting is now closed on every Voting Computer.");
  }
  if (msg.type === "potm_mine") {  // which player this voter picked this round (only shown to them)
    const s = await loadPotm(sql);
    const [v] = await sql`SELECT target_name FROM potm_votes WHERE round = ${s.round} AND voter_xuid = ${clip(msg.xuid, 40)}`;
    return reply(true, "", { mine: v?.target_name || null, open: s.open });
  }
  if (msg.type !== "potm_vote") return;
  const s = await loadPotm(sql);
  if (!s.open) return reply(false, "Voting is closed right now.");
  const voter = clip(msg.xuid, 40), target = clip(msg.target, 40);
  if (!voter || !target) return reply(false, "Pick a player first.");
  if (voter === target) return reply(false, "You can't vote for yourself.");
  const [t] = await sql.query(`${ELIGIBLE} AND p.xuid = $1`, [target]);
  if (!t) return reply(false, "That player can't be voted for.");
  const [okVoter] = await sql.query(`SELECT 1 FROM (${ELIGIBLE}) e WHERE e.xuid = $1`, [voter]);
  const [known] = await sql`SELECT 1 FROM players WHERE xuid = ${voter}`;
  if (known && !okVoter) return reply(false, "You can't vote right now.");  // banned
  const [old] = await sql`SELECT target_name FROM potm_votes WHERE round = ${s.round} AND voter_xuid = ${voter}`;
  await sql`INSERT INTO potm_votes (round, voter_xuid, voter_name, target_xuid, target_name) VALUES (${s.round}, ${voter}, ${clip(msg.name, 40)}, ${target}, ${t.name})
            ON CONFLICT (round, voter_xuid) DO UPDATE SET target_xuid = EXCLUDED.target_xuid, target_name = EXCLUDED.target_name, voter_name = EXCLUDED.voter_name, voted_at = now()`;
  return reply(true, old ? `Your vote is now for ${t.name}. Thanks for voting!` : `You voted for ${t.name}. Thanks for voting!`, { mine: t.name });
}

// ---------- Control Panel (owner only) ----------
async function requireOwner(request, env) {
  const user = await requireUser(request, env);
  if (!isOwner(env, user.username, user.platform === "bedrock")) throw new HttpError(403, "Only the owner can see Player of the Month votes.");
  return user;
}

// GET /api/panel/potm?round=N
export async function getPotm(request, env, ctx, url) {
  await requireOwner(request, env);
  const sql = getDb(env);
  const s = await loadPotm(sql);
  const round = Math.max(1, Math.min(s.round, Number(url.searchParams.get("round")) || s.round));
  const totals = await sql`SELECT target_xuid, target_name, count(*)::int AS votes, max(voted_at) AS last
                             FROM potm_votes WHERE round = ${round} GROUP BY target_xuid, target_name ORDER BY votes DESC, last ASC`;
  const votes = await sql`SELECT voter_name, target_name, voted_at FROM potm_votes WHERE round = ${round} ORDER BY voted_at DESC LIMIT 1000`;
  return json({ ok: true, ...s, viewing: round,
    totals: totals.map((t) => ({ xuid: t.target_xuid, name: t.target_name, votes: t.votes })),
    votes: votes.map((v) => ({ voter: v.voter_name, target: v.target_name, at: v.voted_at })) });
}

// POST /api/panel/potm { action: "open" | "close" | "new-round" }
export async function savePotmPanel(request, env) {
  const user = await requireOwner(request, env);
  const b = await readJson(request);
  const sql = getDb(env);
  if (b.action === "open" || b.action === "close") {
    await setOpen(env, sql, b.action === "open", user.username);
    return json({ ok: true, message: b.action === "open" ? "Voting is open on every Voting Computer." : "Voting is closed on every Voting Computer." });
  }
  if (b.action === "new-round") {
    const cur = await loadPotm(sql);
    await savePotm(sql, { open: false, round: cur.round + 1, openedAt: null, by: user.username }, user.username);
    await toPlugin(env, await potmState(sql)).catch(() => false);
    return json({ ok: true, message: `Round ${cur.round + 1} is ready. Voting is closed until you open it.` });
  }
  throw new HttpError(400, "Unknown action.");
}
