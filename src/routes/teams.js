// Teams: a group of up to 8 players with a name and a short tag (up to 5 letters/numbers, shown gray before
// names in chat on the website and in game). The organizer invites players, manages the team and can hand it
// over. The organizer can make members Admins: Admins can invite, remove regular members, edit the name/tag and
// host the team's stages; only the organizer makes Admins, hands the team over or closes it. The site Owner's
// team tag can be longer (up to 32 letters, numbers and spaces). Teams have a private team chat (website + /tc in game), shared plot building in game, and a leaderboard.
// Lives in Community > Friends > Team (no separate page).
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { headUrlFor } from "./heads.js";
import { notify } from "./notify.js";
import { toPlugin } from "./economy.js";

const MAX_MEMBERS = 8;
const TAG_RE = /^[A-Za-z0-9]{1,5}$/;
const OWNER_TAG_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,31}$/;  // the site Owner: any length (up to 32 so names still fit)

async function myPlayer(sql, user) {
  const [p] = await sql`SELECT p.xuid, p.gamertag FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
  return p || null;
}
async function needPlayer(sql, user) {
  const p = await myPlayer(sql, user);
  if (!p) throw new HttpError(409, "Link your Minecraft account first (Account > Link), so your team works in game too.");
  return p;
}
async function teamOf(sql, xuid) {
  const [t] = await sql`SELECT t.*, m.role AS my_role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.xuid = ${xuid}`;
  return t || null;
}
async function filtered(sql, text, max) {
  const check = checkMessage(text, compileWordList(await sql`SELECT word, match FROM filter_words`), { allowLinks: false, maxLength: max });
  if (!check.ok) throw new HttpError(400, check.message || "That isn't allowed.");
  return check.text;
}
// user ids of a team's members (for notifications)
async function memberUserIds(sql, teamId, exceptXuid = null) {
  const rows = await sql`SELECT u.id FROM team_members m JOIN players p ON p.xuid = m.xuid JOIN users u ON u.mc_uuid = p.uuid
                          WHERE m.team_id = ${teamId} AND m.xuid IS DISTINCT FROM ${exceptXuid}`;
  return rows.map((r) => Number(r.id));
}

// Every team, for the plugin (also sent when it connects).
export async function teamsState(sql) {
  const rows = await sql`SELECT t.id, t.name, t.tag, t.leader_xuid, array_agg(m.xuid) AS members
                           FROM teams t JOIN team_members m ON m.team_id = t.id GROUP BY t.id`;
  return { type: "teams", teams: rows.map((t) => ({ id: Number(t.id), name: t.name, tag: t.tag, leader: t.leader_xuid, members: t.members })) };
}
async function sync(env, sql) {
  await toPlugin(env, await teamsState(sql)).catch(() => {});
  const { hubBroadcast } = await import("./chat.js");
  await hubBroadcast(env, { type: "teams_changed" }).catch(() => {});
}

// Tags for chat: Map(xuid -> tag)
export async function teamTags(sql, xuids) {
  if (!xuids.length) return new Map();
  const rows = await sql`SELECT m.xuid, t.tag FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.xuid = ANY(${xuids})`;
  return new Map(rows.map((r) => [r.xuid, r.tag]));
}

async function teamView(sql, t, meXuid) {
  const members = await sql`
    SELECT p.xuid, p.gamertag, p.head_at, p.gamerpic_at, p.playtime_s, p.balance_cents, cardinality(p.achievements) AS ach,
           (p.online_at > now() - interval '150 seconds') AS online, m.joined_at, m.role
      FROM team_members m JOIN players p ON p.xuid = m.xuid WHERE m.team_id = ${t.id}
     ORDER BY (p.xuid = ${t.leader_xuid}) DESC, (m.role = 'admin') DESC, m.joined_at`;
  const invites = await sql`SELECT p.xuid, p.gamertag FROM team_invites i JOIN players p ON p.xuid = i.xuid WHERE i.team_id = ${t.id} ORDER BY i.created_at`;
  const sum = (k) => members.reduce((a, m) => a + Number(m[k] || 0), 0);
  return {
    id: Number(t.id), name: t.name, tag: t.tag, isLeader: t.leader_xuid === meXuid, isAdmin: t.leader_xuid === meXuid || t.my_role === "admin",
    members: members.map((m) => ({ xuid: m.xuid, name: m.gamertag, head: headUrlFor(m), online: Boolean(m.online), leader: m.xuid === t.leader_xuid, admin: m.role === "admin" })),
    invites: t.leader_xuid === meXuid || t.my_role === "admin" ? invites.map((i) => ({ xuid: i.xuid, name: i.gamertag })) : [],
    stats: { playtime: sum("playtime_s"), money: sum("balance_cents") / 100, achievements: sum("ach") },
    max: MAX_MEMBERS,
  };
}

// GET /api/teams/mine
export async function mine(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const p = await myPlayer(sql, user);
  if (!p) return json({ ok: true, linked: false });
  const t = await teamOf(sql, p.xuid);
  const invites = t ? [] : await sql`
    SELECT t.id, t.name, t.tag, (SELECT count(*)::int FROM team_members x WHERE x.team_id = t.id) AS members
      FROM team_invites i JOIN teams t ON t.id = i.team_id WHERE i.xuid = ${p.xuid} ORDER BY i.created_at DESC`;
  return json({ ok: true, linked: true, longTags: Boolean(user.owner), team: t ? await teamView(sql, t, p.xuid) : null,
    invites: invites.map((i) => ({ id: Number(i.id), name: i.name, tag: i.tag, members: i.members })) }, 200, { "Cache-Control": "no-store" });
}

// GET /api/teams/leaderboard
export async function leaderboard(request, env) {
  await requireUser(request, env);
  const rows = await getDb(env)`
    SELECT t.id, t.name, t.tag, count(*)::int AS members, coalesce(sum(p.playtime_s), 0)::bigint AS playtime,
           coalesce(sum(cardinality(p.achievements)), 0)::int AS ach, coalesce(sum(p.contest_wins), 0)::int AS wins
      FROM teams t JOIN team_members m ON m.team_id = t.id JOIN players p ON p.xuid = m.xuid
     GROUP BY t.id ORDER BY playtime DESC LIMIT 50`;
  return json({ ok: true, teams: rows.map((t) => ({ id: Number(t.id), name: t.name, tag: t.tag, members: t.members, playtime: Number(t.playtime), achievements: t.ach, contestWins: t.wins })) });
}

// POST /api/teams { action, ... }
export async function act(request, env) {
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  await rateLimit(env, "AUTH_LIMITER", `teams:${user.id}`);
  const b = await readJson(request);
  const sql = getDb(env);
  const me = await needPlayer(sql, user);
  const t = await teamOf(sql, me.xuid);
  const leader = t && t.leader_xuid === me.xuid;
  const done = async (message) => { await sync(env, sql); return json({ ok: true, message }); };
  const admin = t && (leader || t.my_role === "admin");
  const needLeader = () => { if (!t) throw new HttpError(409, "You're not in a team."); if (!leader) throw new HttpError(403, "Only the team organizer can do that."); };
  const needAdmin = () => { if (!t) throw new HttpError(409, "You're not in a team."); if (!admin) throw new HttpError(403, "Only the team organizer and Admins can do that."); };
  const cleanName = async (v) => {
    const name = String(v || "").replace(/\s+/g, " ").trim().slice(0, 24);
    if (name.length < 2) throw new HttpError(400, "Give the team a name (2 to 24 characters).");
    return filtered(sql, name, 24);
  };
  const cleanTag = async (v) => {
    const tag = String(v || "").replace(/\s+/g, " ").trim();
    if (t && tag === t.tag) return tag;   // unchanged (an Owner's long tag stays when an Admin edits the name)
    if (user.owner) {
      if (!OWNER_TAG_RE.test(tag)) throw new HttpError(400, "The tag can be up to 32 letters, numbers and spaces.");
      await filtered(sql, tag, 32);
      return tag;
    }
    if (!TAG_RE.test(tag)) throw new HttpError(400, "The tag can be 1 to 5 letters and numbers (no spaces or symbols).");
    await filtered(sql, tag, 5);
    return tag;
  };

  switch (b.action) {
    case "create": {
      if (t) throw new HttpError(409, "Leave your team first.");
      const name = await cleanName(b.name), tag = await cleanTag(b.tag);
      try {
        const [nt] = await sql`INSERT INTO teams (name, tag, leader_xuid) VALUES (${name}, ${tag}, ${me.xuid}) RETURNING id`;
        await sql`INSERT INTO team_members (team_id, xuid) VALUES (${nt.id}, ${me.xuid})`;
        await sql`DELETE FROM team_invites WHERE xuid = ${me.xuid}`;
      } catch (e) {
        if (String(e.message).includes("unique") || String(e.code) === "23505") throw new HttpError(409, "Another team already has that name or tag.");
        throw e;
      }
      return done(`Team ${name} created. Invite players from here.`);
    }
    case "edit": {
      needAdmin();
      const name = await cleanName(b.name), tag = await cleanTag(b.tag);
      try { await sql`UPDATE teams SET name = ${name}, tag = ${tag} WHERE id = ${t.id}`; }
      catch (e) { if (String(e.code) === "23505" || String(e.message).includes("unique")) throw new HttpError(409, "Another team already has that name or tag."); throw e; }
      return done("Team updated.");
    }
    case "invite": {
      needAdmin();
      const name = String(b.name || "").trim().replace(/^\./, "").toLowerCase();
      const [p] = await sql`SELECT xuid, gamertag FROM players WHERE lower(gamertag) = ${name} ORDER BY last_seen DESC LIMIT 1`;
      if (!p) throw new HttpError(404, "No player with that name has joined GalaxySMP.");
      if (p.xuid === me.xuid) throw new HttpError(400, "You're already in your team.");
      if (await teamOf(sql, p.xuid)) throw new HttpError(409, `${p.gamertag} is already in a team.`);
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM team_members WHERE team_id = ${t.id}`;
      if (n >= MAX_MEMBERS) throw new HttpError(409, `A team can have up to ${MAX_MEMBERS} players.`);
      await sql`INSERT INTO team_invites (team_id, xuid, invited_by) VALUES (${t.id}, ${p.xuid}, ${me.xuid}) ON CONFLICT DO NOTHING`;
      const [u] = await sql`SELECT u.id FROM users u JOIN players x ON x.uuid = u.mc_uuid WHERE x.xuid = ${p.xuid}`;
      if (u) await notify(env, [Number(u.id)], "friends", { title: `Team invite: ${t.name}`, body: `${me.gamertag} invited you to join [${t.tag}] ${t.name}.`, url: "/community#friends", tag: `team-invite-${t.id}` }).catch(() => {});
      return json({ ok: true, message: u ? `Invite sent to ${p.gamertag}.` : `Invite saved. ${p.gamertag} sees it once they make a website account.` });
    }
    case "cancel-invite": {
      needAdmin();
      await sql`DELETE FROM team_invites WHERE team_id = ${t.id} AND xuid = ${String(b.xuid || "")}`;
      return json({ ok: true, message: "Invite cancelled." });
    }
    case "accept": {
      if (t) throw new HttpError(409, "Leave your team first.");
      const [inv] = await sql`SELECT i.team_id, x.name, x.tag FROM team_invites i JOIN teams x ON x.id = i.team_id WHERE i.team_id = ${Number(b.teamId) || 0} AND i.xuid = ${me.xuid}`;
      if (!inv) throw new HttpError(404, "That invite isn't there any more.");
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM team_members WHERE team_id = ${inv.team_id}`;
      if (n >= MAX_MEMBERS) throw new HttpError(409, "That team is full.");
      await sql`INSERT INTO team_members (team_id, xuid) VALUES (${inv.team_id}, ${me.xuid})`;
      await sql`DELETE FROM team_invites WHERE xuid = ${me.xuid}`;
      await notify(env, await memberUserIds(sql, inv.team_id, me.xuid), "friends", { title: `${me.gamertag} joined ${inv.name}`, body: "Say hi in the team chat.", url: "/community#friends", tag: `team-join-${inv.team_id}` }).catch(() => {});
      await sql`INSERT INTO team_messages (team_id, xuid, name, content) VALUES (${inv.team_id}, NULL, 'GalaxySMP', ${`${me.gamertag} joined the team.`})`;
      return done(`You joined ${inv.name}.`);
    }
    case "decline": {
      await sql`DELETE FROM team_invites WHERE team_id = ${Number(b.teamId) || 0} AND xuid = ${me.xuid}`;
      return json({ ok: true, message: "Invite declined." });
    }
    case "leave": {
      if (!t) throw new HttpError(409, "You're not in a team.");
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM team_members WHERE team_id = ${t.id}`;
      if (leader && n > 1) throw new HttpError(409, "Hand the team to someone else first (or remove everyone), then leave.");
      if (n <= 1) { await sql`DELETE FROM teams WHERE id = ${t.id}`; return done("You left, and the team was closed."); }
      await sql`DELETE FROM team_members WHERE xuid = ${me.xuid}`;
      await sql`INSERT INTO team_messages (team_id, xuid, name, content) VALUES (${t.id}, NULL, 'GalaxySMP', ${`${me.gamertag} left the team.`})`;
      return done(`You left ${t.name}.`);
    }
    case "kick": {
      needAdmin();
      const x = String(b.xuid || "");
      if (x === me.xuid) throw new HttpError(400, "Use Leave to leave your own team.");
      if (x === t.leader_xuid) throw new HttpError(403, "The organizer can't be removed.");
      if (!leader) {
        const [r] = await sql`SELECT role FROM team_members WHERE team_id = ${t.id} AND xuid = ${x}`;
        if (r?.role === "admin") throw new HttpError(403, "Only the organizer can remove an Admin.");
      }
      const [gone] = await sql`DELETE FROM team_members m USING players p WHERE m.team_id = ${t.id} AND m.xuid = ${x} AND p.xuid = m.xuid RETURNING p.gamertag`;
      if (!gone) throw new HttpError(404, "That player isn't in your team.");
      await sql`INSERT INTO team_messages (team_id, xuid, name, content) VALUES (${t.id}, NULL, 'GalaxySMP', ${`${gone.gamertag} was removed from the team.`})`;
      return done(`${gone.gamertag} was removed.`);
    }
    case "transfer": {
      needLeader();
      const x = String(b.xuid || "");
      const [m] = await sql`SELECT p.gamertag FROM team_members m JOIN players p ON p.xuid = m.xuid WHERE m.team_id = ${t.id} AND m.xuid = ${x}`;
      if (!m) throw new HttpError(404, "That player isn't in your team.");
      await sql`UPDATE teams SET leader_xuid = ${x} WHERE id = ${t.id}`;
      await sql`UPDATE team_members SET role = CASE WHEN xuid = ${x} THEN 'member' WHEN xuid = ${me.xuid} THEN 'admin' ELSE role END WHERE team_id = ${t.id}`;
      return done(`${m.gamertag} is now the team organizer. You're an Admin now.`);
    }
    case "admin":
    case "unadmin": {
      needLeader();
      const x = String(b.xuid || "");
      if (x === me.xuid) throw new HttpError(400, "You're the organizer.");
      const role = b.action === "admin" ? "admin" : "member";
      const [m] = await sql`UPDATE team_members m SET role = ${role} FROM players p WHERE m.team_id = ${t.id} AND m.xuid = ${x} AND p.xuid = m.xuid RETURNING p.gamertag`;
      if (!m) throw new HttpError(404, "That player isn't in your team.");
      if (role === "admin") {
        const [u] = await sql`SELECT u.id FROM users u JOIN players x ON x.uuid = u.mc_uuid WHERE x.xuid = ${x}`;
        if (u) await notify(env, [Number(u.id)], "friends", { title: `You're an Admin of ${t.name}`, body: "You can now invite and remove members, edit the team and host its stages.", url: "/community#friends", tag: `team-admin-${t.id}` }).catch(() => {});
      }
      return done(role === "admin" ? `${m.gamertag} is now an Admin.` : `${m.gamertag} is no longer an Admin.`);
    }
    case "disband": {
      needLeader();
      const ids = await memberUserIds(sql, t.id, me.xuid);
      await sql`DELETE FROM teams WHERE id = ${t.id}`;
      await notify(env, ids, "friends", { title: `${t.name} was closed`, body: "The organizer closed the team.", url: "/community#friends", tag: `team-closed-${t.id}` }).catch(() => {});
      return done("The team was closed.");
    }
  }
  throw new HttpError(400, "Unknown action.");
}

// ---------- team chat ----------
// GET /api/teams/chat?after=<id>
export async function chat(request, env, ctx, url) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const me = await needPlayer(sql, user);
  const t = await teamOf(sql, me.xuid);
  if (!t) throw new HttpError(409, "You're not in a team.");
  const after = Number(url.searchParams.get("after")) || 0;
  const rows = after
    ? await sql`SELECT id, xuid, name, content, from_game, created_at FROM team_messages WHERE team_id = ${t.id} AND id > ${after} ORDER BY id LIMIT 100`
    : (await sql`SELECT id, xuid, name, content, from_game, created_at FROM team_messages WHERE team_id = ${t.id} ORDER BY id DESC LIMIT 60`).reverse();
  return json({ ok: true, messages: rows.map((m) => ({ id: Number(m.id), xuid: m.xuid, name: m.name, text: m.content, fromGame: m.from_game, at: m.created_at, mine: m.xuid === me.xuid, system: !m.xuid })) },
    200, { "Cache-Control": "no-store" });
}

// POST /api/teams/chat { text }
export async function send(request, env) {
  const user = await requireUser(request, env);
  if (user.muted_until && new Date(user.muted_until) > new Date()) throw new HttpError(403, "You're muted right now.");
  await rateLimit(env, "POLL_LIMITER", `teamchat:${user.id}`);
  const sql = getDb(env);
  const me = await needPlayer(sql, user);
  const t = await teamOf(sql, me.xuid);
  if (!t) throw new HttpError(409, "You're not in a team.");
  const text = await filtered(sql, String((await readJson(request)).text || "").trim(), 300);
  if (!text) throw new HttpError(400, "Type a message.");
  await sql`INSERT INTO team_messages (team_id, xuid, name, content) VALUES (${t.id}, ${me.xuid}, ${me.gamertag}, ${text})`;
  await toPlugin(env, { type: "teamchat", teamId: Number(t.id), name: me.gamertag, text }).catch(() => {});
  return json({ ok: true });
}

// From the plugin: /tc in game
export async function fromGame(env, msg) {
  const sql = getDb(env);
  const xuid = String(msg.xuid || "");
  const t = await teamOf(sql, xuid);
  if (!t || Number(msg.teamId) !== Number(t.id)) return;
  const text = String(msg.text || "").slice(0, 300).trim();
  if (text) await sql`INSERT INTO team_messages (team_id, xuid, name, content, from_game) VALUES (${t.id}, ${xuid}, ${String(msg.name || "Player").slice(0, 32)}, ${text}, true)`;
}
