// Play Sessions (in #Events): a member posts a plan like "Bedwars at 7 pm, who's in?". Others tap I'm in; the
// poster can set a player limit (extra people go on a waitlist and move up when someone leaves). Each plan has a
// small chat. Everyone who joined gets a reminder 10 minutes before it starts. (Voted yes in #Suggestions.)
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { can } from "../lib/perms.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { headUrlFor } from "./heads.js";
import { notify } from "./notify.js";

export const GAMES = ["Survival", "Bedwars", "Skyblock", "Creative", "Minigames", "Build together", "Exploring", "Other"];
const MAX_OPEN_PER_USER = 3;

async function words(sql) {
  return compileWordList(await sql`SELECT word, match FROM filter_words WHERE NOT EXISTS (SELECT 1 FROM economy_config WHERE key = 'chatfilter_off')`);
}
async function clean(sql, text, max) {
  const check = checkMessage(String(text || ""), await words(sql), { allowLinks: false, maxLength: max });
  if (!check.ok) throw new HttpError(400, check.message || "That isn't allowed.");
  return check.text.replace(/\s+/g, " ").trim();
}

function sessionOut(r, members, me) {
  const going = members.filter((m) => !m.waiting);
  const waiting = members.filter((m) => m.waiting);
  return {
    id: Number(r.id), game: r.game, note: r.note, startsAt: r.starts_at, max: r.max_players ? Number(r.max_players) : null,
    host: { id: Number(r.user_id), name: r.host_name, head: headUrlFor({ xuid: r.host_xuid, head_at: r.host_head_at, gamerpic_at: r.host_gamerpic_at }) },
    going: going.map((m) => ({ id: Number(m.user_id), name: m.name, head: m.head })),
    waiting: waiting.map((m) => ({ id: Number(m.user_id), name: m.name })),
    me: { in: going.some((m) => Number(m.user_id) === Number(me.id)), waiting: waiting.some((m) => Number(m.user_id) === Number(me.id)), host: Number(r.user_id) === Number(me.id) },
    messages: Number(r.messages || 0),
  };
}

// GET /api/sessions
export async function list(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const rows = await sql`
    SELECT s.*, u.username AS host_name, p.xuid AS host_xuid, p.head_at AS host_head_at, p.gamerpic_at AS host_gamerpic_at,
           (SELECT count(*)::int FROM play_session_messages m WHERE m.session_id = s.id) AS messages
      FROM play_sessions s JOIN users u ON u.id = s.user_id LEFT JOIN players p ON p.uuid = u.mc_uuid
     WHERE s.cancelled_at IS NULL AND s.starts_at > now() - interval '2 hours'
     ORDER BY s.starts_at LIMIT 30`;
  const ids = rows.map((r) => r.id);
  const mem = ids.length ? await sql`
    SELECT m.session_id, m.user_id, m.waiting, u.username AS name, p.xuid, p.head_at, p.gamerpic_at
      FROM play_session_members m JOIN users u ON u.id = m.user_id LEFT JOIN players p ON p.uuid = u.mc_uuid
     WHERE m.session_id = ANY(${ids}) ORDER BY m.joined_at` : [];
  const by = new Map();
  for (const m of mem) {
    const k = String(m.session_id);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ ...m, head: headUrlFor(m) });
  }
  return json({ ok: true, games: GAMES, canModerate: can(user, "delete_messages"),
    sessions: rows.map((r) => sessionOut(r, by.get(String(r.id)) || [], user)) }, 200, { "Cache-Control": "no-store" });
}

async function members(sql, id) {
  return sql`SELECT user_id, waiting FROM play_session_members WHERE session_id = ${id} ORDER BY joined_at`;
}

// POST /api/sessions { action, ... }
export async function act(request, env) {
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  if (user.muted_until && new Date(user.muted_until) > new Date()) throw new HttpError(403, "You're muted, so you can't do that right now.");
  await rateLimit(env, "AUTH_LIMITER", `sessions:${user.id}`);
  const b = await readJson(request);
  const sql = getDb(env);
  const need = async () => {
    const [s] = await sql`SELECT * FROM play_sessions WHERE id = ${Number(b.id) || 0} AND cancelled_at IS NULL`;
    if (!s) throw new HttpError(404, "That session isn't there any more.");
    return s;
  };

  switch (b.action) {
    case "create": {   // { game, note, at, max }
      const game = GAMES.includes(b.game) ? b.game : null;
      if (!game) throw new HttpError(400, "Pick what you'll play.");
      const note = b.note ? await clean(sql, b.note, 120) : "";
      const at = new Date(b.at);
      if (isNaN(at) || at < new Date(Date.now() - 5 * 60_000) || at > new Date(Date.now() + 14 * 86400_000)) throw new HttpError(400, "Pick a time in the next 2 weeks.");
      const max = b.max ? Math.round(Number(b.max)) : null;
      if (max !== null && (max < 2 || max > 50)) throw new HttpError(400, "The player limit can be 2 to 50.");
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM play_sessions WHERE user_id = ${user.id} AND cancelled_at IS NULL AND starts_at > now()`;
      if (n >= MAX_OPEN_PER_USER) throw new HttpError(409, `You can have up to ${MAX_OPEN_PER_USER} upcoming sessions.`);
      const [row] = await sql`INSERT INTO play_sessions (user_id, game, note, starts_at, max_players) VALUES (${user.id}, ${game}, ${note}, ${at.toISOString()}, ${max}) RETURNING id`;
      await sql`INSERT INTO play_session_members (session_id, user_id) VALUES (${row.id}, ${user.id})`;
      return json({ ok: true, id: Number(row.id), message: "Posted! People can tap I'm in." });
    }
    case "join": {
      const s = await need();
      if (new Date(s.starts_at) < new Date(Date.now() - 60 * 60_000)) throw new HttpError(409, "That session already happened.");
      const list = await members(sql, s.id);
      if (list.some((m) => Number(m.user_id) === Number(user.id))) return json({ ok: true, message: "You're already in." });
      const going = list.filter((m) => !m.waiting).length;
      const waiting = Boolean(s.max_players && going >= Number(s.max_players));
      await sql`INSERT INTO play_session_members (session_id, user_id, waiting) VALUES (${s.id}, ${user.id}, ${waiting}) ON CONFLICT DO NOTHING`;
      if (!waiting && Number(s.user_id) !== Number(user.id)) {
        await notify(env, [Number(s.user_id)], "events", { title: `${user.username} is in`, body: `${s.game} · ${new Date(s.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} (New York)`, url: "/community#events", tag: `ps-${s.id}` }).catch(() => {});
      }
      return json({ ok: true, message: waiting ? "It's full, so you're on the waitlist. You'll move up if someone leaves." : "You're in! We'll remind you 10 minutes before." });
    }
    case "leave": {
      const s = await need();
      if (Number(s.user_id) === Number(user.id)) throw new HttpError(400, "You posted this session. Cancel it instead.");
      const [gone] = await sql`DELETE FROM play_session_members WHERE session_id = ${s.id} AND user_id = ${user.id} RETURNING waiting`;
      if (gone && !gone.waiting && s.max_players) {   // first person on the waitlist moves up
        const [next] = await sql`UPDATE play_session_members SET waiting = false WHERE (session_id, user_id) =
                                   (SELECT session_id, user_id FROM play_session_members WHERE session_id = ${s.id} AND waiting ORDER BY joined_at LIMIT 1)
                                 RETURNING user_id`;
        if (next) await notify(env, [Number(next.user_id)], "events", { title: "A spot opened up!", body: `You're in for ${s.game}.`, url: "/community#events", tag: `ps-${s.id}` }).catch(() => {});
      }
      return json({ ok: true, message: "You left the session." });
    }
    case "cancel": {
      const s = await need();
      if (Number(s.user_id) !== Number(user.id) && !can(user, "delete_messages")) throw new HttpError(403, "Only the person who posted it can cancel it.");
      await sql`UPDATE play_sessions SET cancelled_at = now() WHERE id = ${s.id}`;
      const ids = (await members(sql, s.id)).map((m) => Number(m.user_id)).filter((id) => id !== Number(user.id));
      await notify(env, ids, "events", { title: `${s.game} session cancelled`, body: "The plan you joined was cancelled.", url: "/community#events", tag: `ps-${s.id}` }).catch(() => {});
      return json({ ok: true, message: "Session cancelled." });
    }
    case "chat": {   // { id, body }
      const s = await need();
      const body = await clean(sql, b.body, 200);
      if (!body) throw new HttpError(400, "Type a message first.");
      await sql`INSERT INTO play_session_messages (session_id, user_id, body) VALUES (${s.id}, ${user.id}, ${body})`;
      return json({ ok: true });
    }
  }
  throw new HttpError(400, "Unknown action.");
}

// GET /api/sessions/:id/chat
export async function chat(request, env, ctx, url, params) {
  await requireUser(request, env);
  const rows = await getDb(env)`
    SELECT m.id, m.body, m.created_at, u.username, p.xuid, p.head_at, p.gamerpic_at
      FROM play_session_messages m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN players p ON p.uuid = u.mc_uuid
     WHERE m.session_id = ${Number(params.id) || 0} ORDER BY m.id DESC LIMIT 60`;
  return json({ ok: true, messages: rows.reverse().map((r) => ({ id: Number(r.id), body: r.body, at: r.created_at, name: r.username || "Someone", head: headUrlFor(r) })) }, 200, { "Cache-Control": "no-store" });
}

// Every 5 minutes: "starts in 10 minutes" to everyone who's in.
export async function tick(env) {
  const sql = getDb(env);
  const soon = await sql`UPDATE play_sessions SET reminded = true
                          WHERE cancelled_at IS NULL AND NOT reminded AND starts_at <= now() + interval '12 minutes' AND starts_at > now() - interval '5 minutes'
                          RETURNING id, game, starts_at`;
  for (const s of soon) {
    const ids = (await sql`SELECT user_id FROM play_session_members WHERE session_id = ${s.id} AND NOT waiting`).map((r) => Number(r.user_id));
    const mins = Math.max(0, Math.round((new Date(s.starts_at) - Date.now()) / 60000));
    await notify(env, ids, "events", { title: `${s.game} ${mins ? `in ${mins} minutes` : "is starting"}`, body: "Your play session is about to start. Hop on GalaxySMP!", url: "/community#events", tag: `ps-${s.id}`, urgent: true }).catch(() => {});
  }
}
