// Stages (Community > Voice & Stages > #Stages), like Discord Stages: speakers talk (and can share their screen or
// camera), the audience listens, chats, reacts and can raise their hand to speak. Good for podcasts and shows.
//   - A member with Galaxy+ / Galaxy Pro+ (or staff) can stream on their own, and pick a crew: Editors run their
//     streams (start, end, title, chat, bring viewers on), Streamers can be on them.
//   - A team streams as the team: the organizer and Admins run it, every team member can be on it.
//   - Streams can be scheduled ("Notify me"; they show in #Events too). Followers get a notification (and an
//     in-game message) when someone they follow goes live.
//   - Staff with "Moderate streams" see every live stream, can end any of them and stop members from streaming.
// The live part (video relay, chat, reactions, stage) is the StreamRoom Durable Object (src/streams/room.js).
// Episodes and other posts are files in R2 (src/routes/recordings.js).
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { can } from "../lib/perms.js";
import { limit as rateLimit } from "../lib/ratelimit.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { headUrlFor } from "./heads.js";
import { notify } from "./notify.js";
import { toPlugin } from "./economy.js";
import { isOwner } from "../lib/names.js";

const MAX_LIVE = 6;                  // streams live at the same time, site-wide (keeps relay usage low)
const MAX_SCHEDULED = 5;             // upcoming streams per member / team
const MAX_CREW = 12;
// Two kinds of live stage: a Podcast (voice only, saved as an episode when it ends) and a Live Stream (voice, camera,
// screen; gone when it ends unless the host chose "Save as a video"). Episodes: podcast (uploaded or a saved live
// podcast), video (a saved live stream), more (other videos or audio, e.g. a team's rules).
export const CATEGORIES = ["Talk", "Survival", "Bedwars", "Skyblock", "Creative", "Building", "Minigames", "Tutorial", "News", "Other"];
const stageKind = (k) => (k === "podcast" ? "podcast" : "live");
const roomInfo = (s, status) => ({ id: Number(s.id), title: s.title, kind: stageKind(s.kind), status: status || s.status, speakMode: s.speak_mode || "hand", chatOn: s.chat_on !== false });

export { me as memberInfo };
export const roomStub = (env, id) => env.STREAMS.get(env.STREAMS.idFromName(`stream:${id}`));
// Hosting your own stage, and posting episodes (even for a team), is for Galaxy Pro+ members and members the
// Owner has allowed (Control Panel > Reports > Allowed to host). The Owner can always. Team stages are open to the
// team's organizer and Admins.
const isMod = (user) => Boolean(user.owner) || can(user, "moderate_streams");

async function me(sql, user) {
  const [r] = await sql`
    SELECT u.stream_banned_until, u.stream_ban_reason, u.stream_allowed, p.xuid, p.gamertag, p.head_at, p.gamerpic_at,
           (SELECT s.plan FROM subscriptions s WHERE s.xuid = p.xuid AND (s.expires_at IS NULL OR s.expires_at > now())) AS plan,
           m.team_id, m.role AS team_role, t.leader_xuid, t.name AS team_name, t.tag AS team_tag
      FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
      LEFT JOIN team_members m ON m.xuid = p.xuid LEFT JOIN teams t ON t.id = m.team_id
     WHERE u.id = ${user.id}`;
  const banned = r?.stream_banned_until && new Date(r.stream_banned_until) > new Date();
  const teamManager = Boolean(r?.team_id) && (r.leader_xuid === r.xuid || r.team_role === "admin");
  return {
    ...r, banned: banned ? { until: r.stream_banned_until, reason: r.stream_ban_reason || "" } : null,
    head: r?.xuid ? headUrlFor(r) : null,
    soloHost: !banned && (Boolean(user.owner) || r?.plan === "pro" || Boolean(r?.stream_allowed)),
    team: r?.team_id ? { id: Number(r.team_id), name: r.team_name, tag: r.team_tag, manage: teamManager } : null,
  };
}

// Can this member host on their own? (used for a crew Editor starting a stream for their host)
async function hostAllowed(env, sql, hostId) {
  const [h] = await sql`
    SELECT u.stream_banned_until, u.stream_allowed, u.username, u.platform,
           (SELECT s.plan FROM subscriptions s JOIN players p ON p.xuid = s.xuid WHERE p.uuid = u.mc_uuid AND (s.expires_at IS NULL OR s.expires_at > now()) LIMIT 1) AS plan
      FROM users u WHERE u.id = ${hostId}`;
  if (!h) return false;
  if (h.stream_banned_until && new Date(h.stream_banned_until) > new Date()) return false;
  return h.plan === "pro" || Boolean(h.stream_allowed) || isOwner(env, h.username, h.platform === "bedrock");
}

// What `user` may do on `s` (a streams row): manage (run it), stage (be on it), mod (staff)
async function rightsFor(sql, user, s, m) {
  const mod = isMod(user);
  if (m.banned) return { manage: false, stage: false, mod };
  if (s.team_id) {
    const mine = m.team && m.team.id === Number(s.team_id);
    return { manage: Boolean(mine && m.team.manage), stage: Boolean(mine), mod };
  }
  if (Number(s.host_user_id) === Number(user.id)) return { manage: true, stage: true, mod };
  const [c] = await sql`SELECT role FROM stream_crew WHERE host_user_id = ${s.host_user_id} AND user_id = ${user.id}`;
  return { manage: c?.role === "editor", stage: Boolean(c), mod };
}

// For other files (recordings): what this member may do on a stage.
export async function rightsForUser(sql, user, s) { return rightsFor(sql, user, s, await me(sql, user)); }

async function clean(sql, text, max) {
  const check = checkMessage(String(text || ""), compileWordList(await sql`SELECT word, match FROM filter_words WHERE NOT EXISTS (SELECT 1 FROM economy_config WHERE key = 'chatfilter_off')`), { allowLinks: false, maxLength: max });
  if (!check.ok) throw new HttpError(400, check.message || "That isn't allowed.");
  return check.text.replace(/\s+/g, " ").trim();
}

// streams_v = streams + the host's name/picture fields and the team's name/tag (a view, see migration 0067)


function streamOut(r, extra = {}) {
  return {
    id: Number(r.id), title: r.title, kind: stageKind(r.kind), status: r.status,
    description: r.description || "", category: r.category || null, teamOnly: Boolean(r.team_only),
    scheduledAt: r.scheduled_at, startedAt: r.started_at, endedAt: r.ended_at, peak: Number(r.peak_viewers || 0),
    host: r.team_id ? { type: "team", id: Number(r.team_id), name: r.team_name, tag: r.team_tag }
      : { type: "user", id: Number(r.host_user_id), name: r.host_name, head: headUrlFor({ xuid: r.host_xuid, head_at: r.host_head_at, gamerpic_at: r.host_gamerpic_at }) },
    ...(r.speak_mode ? { speakMode: r.speak_mode, chatOn: r.chat_on !== false, saveVideo: Boolean(r.save_video) } : {}),
    ...extra,
  };
}

// Team-only stages and posts are for that team's members (and staff).
const visibleTo = (m, user) => (x) => !x.team_only || isMod(user) || (m.team && m.team.id === Number(x.team_id));
const parseChapters = (text) => String(text || "").split(/\n/).map((line) => {
  const mm = line.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–:]?\s*(.+)$/);
  if (!mm) return null;
  return { t: (Number(mm[1] || 0) * 3600) + Number(mm[2]) * 60 + Number(mm[3]), title: mm[4].trim().slice(0, 60) };
}).filter(Boolean).sort((a, b) => a.t - b.t).slice(0, 30);

async function loadStream(sql, id) {
  const [r] = await sql`SELECT s.* FROM streams_v s WHERE s.id = ${Number(id) || 0}`;
  return r || null;
}

// ---------- GET /api/streams ----------
export async function list(request, env) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const m = await me(sql, user);
  const [liveAll, upcomingAll, recentAll, follows, crew, crewOf, episodesAll, backstageAll] = await Promise.all([
    sql`SELECT s.* FROM streams_v s WHERE s.status = 'live' ORDER BY s.started_at DESC`,
    sql`SELECT s.*, (SELECT count(*)::int FROM stream_reminders r WHERE r.stream_id = s.id) AS reminders,
               EXISTS (SELECT 1 FROM stream_reminders r WHERE r.stream_id = s.id AND r.user_id = ${user.id}) AS reminding
          FROM streams_v s
         WHERE s.status = 'scheduled' AND s.scheduled_at > now() - interval '3 hours' ORDER BY s.scheduled_at LIMIT 20`,
    sql`SELECT s.* FROM streams_v s WHERE s.status = 'ended' AND s.started_at IS NOT NULL ORDER BY s.ended_at DESC LIMIT 30`,
    sql`SELECT host_user_id, team_id FROM stream_follows WHERE user_id = ${user.id}`,
    sql`SELECT c.user_id, c.role, u.username FROM stream_crew c JOIN users u ON u.id = c.user_id WHERE c.host_user_id = ${user.id} ORDER BY c.created_at`,
    sql`SELECT c.host_user_id, c.role, u.username FROM stream_crew c JOIN users u ON u.id = c.host_user_id WHERE c.user_id = ${user.id}`,
    sql`SELECT e.id, e.title, e.description, e.seconds, e.plays, e.created_at, e.host_user_id, e.team_id, e.created_by, e.kind, e.category, e.team_only, e.chapters, e.mime, e.r2_key,
               (SELECT count(*)::int FROM episode_comments c WHERE c.episode_id = e.id AND c.deleted_at IS NULL) AS comments,
               hu.username AS host_name, hp.xuid AS host_xuid, hp.head_at AS host_head_at, hp.gamerpic_at AS host_gamerpic_at, t.name AS team_name, t.tag AS team_tag
          FROM stream_episodes e LEFT JOIN users hu ON hu.id = e.host_user_id LEFT JOIN players hp ON hp.uuid = hu.mc_uuid LEFT JOIN teams t ON t.id = e.team_id
         WHERE e.deleted_at IS NULL AND e.status = 'ready' AND e.r2_key IS NOT NULL ORDER BY e.created_at DESC LIMIT 300`,
    sql`SELECT s.* FROM streams_v s WHERE s.status = 'backstage' ORDER BY s.created_at DESC`,
  ]);
  const vis = visibleTo(m, user);
  const [live, upcoming, recent, episodes] = [liveAll.filter(vis), upcomingAll.filter(vis), recentAll.filter(vis), episodesAll.filter(vis)];
  const backstage = [];
  for (const s of backstageAll) { const r = await rightsFor(sql, user, s, m); if (r.stage || r.manage) backstage.push(streamOut(s, { manage: r.manage })); }
  const counts = await Promise.all(live.map((s) => roomStub(env, s.id).fetch("https://stream/internal/count").then((r) => r.json()).catch(() => ({ viewers: 0, stage: [] }))));
  const followU = new Set(follows.filter((f) => f.host_user_id).map((f) => Number(f.host_user_id)));
  const followT = new Set(follows.filter((f) => f.team_id).map((f) => Number(f.team_id)));
  const following = (s) => (s.team_id ? followT.has(Number(s.team_id)) : followU.has(Number(s.host_user_id)));
  // where this member can start a stream: as themselves, as their team, for hosts they're an Editor for
  const as = [];
  if (m.soloHost) as.push({ key: "me", label: `Me (${user.username})` });
  if (m.team?.manage && !m.banned) as.push({ key: "team", label: `My team: ${m.team.name}` });
  if (!m.banned) for (const c of crewOf) if (c.role === "editor") as.push({ key: `host:${c.host_user_id}`, label: `${c.username} (you're an Editor)` });
  const manageable = async (s) => (await rightsFor(sql, user, s, m)).manage;
  return json({
    ok: true, now: new Date().toISOString(),
    canHost: as.length > 0, as, banned: m.banned, soloHost: m.soloHost, mod: isMod(user), owner: Boolean(user.owner),
    episodeAs: m.soloHost ? as : [],   // posting episodes: Pro+ or allowed members only (for themselves, their team or a host they edit for)
    hasTeam: Boolean(m.team), maxLive: MAX_LIVE, categories: CATEGORIES, teamAs: Boolean(m.team?.manage), backstage,
    live: await Promise.all(live.map(async (s, i) => streamOut(s, { viewers: counts[i].viewers || 0, onStage: counts[i].stage || [], following: following(s), manage: await manageable(s) }))),
    upcoming: await Promise.all(upcoming.map(async (s) => streamOut(s, { reminders: s.reminders, reminding: s.reminding, following: following(s), manage: await manageable(s) }))),
    recent: recent.map((s) => streamOut(s)),
    crew: m.soloHost ? crew.map((c) => ({ id: Number(c.user_id), username: c.username, role: c.role })) : null,
    crewOf: crewOf.map((c) => ({ hostId: Number(c.host_user_id), username: c.username, role: c.role })),
    episodes: await Promise.all(episodes.map(async (e) => streamOut(e, { kind: e.kind || "podcast", media: /^video\//.test(e.mime || "") ? "video" : "audio", description: e.description, audio: `/api/episodes/${e.id}/audio`,
      seconds: e.seconds, plays: Number(e.plays), createdAt: e.created_at, chapters: e.chapters || [], comments: Number(e.comments || 0),
      following: following(e), manage: isMod(user) || Number(e.created_by) === Number(user.id) || await manageable(e) }))),
  }, 200, { "Cache-Control": "no-store" });
}

// ---------- GET /api/streams/:id ----------
export async function one(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const s = await loadStream(sql, params.id);
  if (!s) throw new HttpError(404, "That stage doesn't exist.");
  const m = await me(sql, user);
  if (!visibleTo(m, user)(s)) throw new HttpError(403, "This stage is for the team's members only.");
  const rights = await rightsFor(sql, user, s, m);
  if (s.status === "backstage" && !rights.stage && !rights.manage && !rights.mod) throw new HttpError(409, "This stage hasn't started yet.");
  const [f] = await sql`SELECT 1 FROM stream_follows WHERE user_id = ${user.id} AND (host_user_id = ${s.host_user_id} OR team_id = ${s.team_id})`;
  return json({ ok: true, stream: streamOut(s, { following: Boolean(f) }), rights: { ...rights, record: Boolean(rights.manage || user.owner) } }, 200, { "Cache-Control": "no-store" });
}

// ---------- GET /api/streams/:id/ws (WebSocket to the stream's room) ----------
export async function connect(request, env, ctx, url, params) {
  if (request.headers.get("Upgrade") !== "websocket") throw new HttpError(426, "Expected a WebSocket.");
  const origin = request.headers.get("Origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) throw new HttpError(403, "Forbidden.");
  if (!env.REALTIME_APP_ID || !env.REALTIME_APP_SECRET) throw new HttpError(503, "Stages aren't set up yet.");
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  const sql = getDb(env);
  const s = await loadStream(sql, params.id);
  if (!s || (s.status !== "live" && s.status !== "backstage")) throw new HttpError(409, "This stage isn't live.");
  const m = await me(sql, user);
  if (!visibleTo(m, user)(s)) throw new HttpError(403, "This stage is for the team's members only.");
  const rights = await rightsFor(sql, user, s, m);
  if (s.status === "backstage" && !rights.stage && !rights.manage && !rights.mod) throw new HttpError(409, "This stage hasn't started yet.");
  const head = m.head || null;
  return roomStub(env, s.id).fetch(new Request("https://stream/ws", {
    headers: { Upgrade: "websocket", "X-GSMP-User": JSON.stringify({ id: Number(user.id), username: user.username, head, ...rights, owner: Boolean(user.owner) }) },
  }));
}

// Tell followers (and the team / crew, and people who asked for a reminder) that a stream is live.
async function announceLive(env, sql, s) {
  const who = s.team_id ? `[${s.team_tag}] ${s.team_name}` : s.host_name;
  const what = stageKind(s.kind) === "podcast" ? "is live with a podcast" : "is live";
  const ids = s.team_only ? (await sql`SELECT u.id FROM team_members tm JOIN players p ON p.xuid = tm.xuid JOIN users u ON u.mc_uuid = p.uuid WHERE tm.team_id = ${s.team_id}`).map((r) => Number(r.id)) : (await sql`
    SELECT user_id AS id FROM stream_follows WHERE (host_user_id = ${s.host_user_id} OR team_id = ${s.team_id})
    UNION SELECT user_id FROM stream_reminders WHERE stream_id = ${s.id}
    UNION SELECT c.user_id FROM stream_crew c WHERE c.host_user_id = ${s.host_user_id}
    UNION SELECT u.id FROM team_members tm JOIN players p ON p.xuid = tm.xuid JOIN users u ON u.mc_uuid = p.uuid WHERE tm.team_id = ${s.team_id}`).map((r) => Number(r.id));
  await notify(env, ids, "streams", { title: `${who} ${what}`, body: s.title, url: `/community#stages/${s.id}`, tag: `stream-${s.id}` },
    { exclude: [s.created_by] }).catch(() => {});
  // in game: a message to followers who are online
  const xuids = (await sql`SELECT p.xuid FROM players p JOIN users u ON u.mc_uuid = p.uuid WHERE u.id = ANY(${ids})`).map((r) => r.xuid);
  if (xuids.length) await toPlugin(env, { type: "stream_live", xuids, text: `${who} ${what}: ${s.title}. Join on galaxymc.us (Community > Stages)` }).catch(() => {});
}

// Setup is done: the hosts and speakers meet backstage first (nobody else can join or see it), then Go Live.
async function toBackstage(env, sql, id) {
  const [row] = await sql`UPDATE streams SET status = 'backstage', created_at = now() WHERE id = ${id} AND status = 'scheduled' RETURNING id`;
  if (!row) throw new HttpError(409, "That stage already started or ended.");
  const s = await loadStream(sql, id);
  await roomStub(env, id).fetch("https://stream/internal/start", { method: "POST", body: JSON.stringify(roomInfo(s, "backstage")) });
  return s;
}

async function goLive(env, sql, id) {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM streams WHERE status = 'live'`;
  if (n >= MAX_LIVE) throw new HttpError(409, `${MAX_LIVE} stages are live right now, which is the most at once. Try again a little later.`);
  const [row] = await sql`UPDATE streams SET status = 'live', started_at = now() WHERE id = ${id} AND status = 'backstage' RETURNING id`;
  if (!row) throw new HttpError(409, "That stage already started or ended.");
  const s = await loadStream(sql, id);
  await roomStub(env, id).fetch("https://stream/internal/start", { method: "POST", body: JSON.stringify(roomInfo(s, "live")) });
  await announceLive(env, sql, s);
  const { hubBroadcast } = await import("./chat.js");
  await hubBroadcast(env, { type: "streams_changed" }).catch(() => {});
  return s;
}


// "me" | "team" | "host:<id>" -> who an episode or stage belongs to (same rules as starting a stage)
export async function whoHosts(sql, env, user, m, as) {
  if (!m.soloHost) throw new HttpError(403, "Posting episodes is a Galaxy Pro+ perk (or ask the Owner to allow you).");
  if (as === "me") return { hostId: user.id, teamId: null };
  if (as === "team") { if (!m.team?.manage) throw new HttpError(403, "Only your team's organizer and Admins can post for the team."); return { hostId: null, teamId: m.team.id }; }
  if (as.startsWith("host:")) {
    const hostId = Number(as.slice(5)) || 0;
    const [c] = await sql`SELECT role FROM stream_crew WHERE host_user_id = ${hostId} AND user_id = ${user.id}`;
    if (c?.role !== "editor") throw new HttpError(403, "You're not an Editor for them.");
    if (!(await hostAllowed(env, sql, hostId))) throw new HttpError(403, "They can't host right now.");
    return { hostId, teamId: null };
  }
  throw new HttpError(400, "Choose who it's from.");
}

// ---------- POST /api/streams { action, ... } ----------
export async function act(request, env) {
  const user = await requireUser(request, env);
  if (user.banned) throw new HttpError(403, "Your account has been banned.");
  await rateLimit(env, "AUTH_LIMITER", `streams:${user.id}`);
  const b = await readJson(request);
  const sql = getDb(env);
  const m = await me(sql, user);
  const changed = async () => { const { hubBroadcast } = await import("./chat.js"); await hubBroadcast(env, { type: "streams_changed" }).catch(() => {}); };
  const needStream = async (id) => { const s = await loadStream(sql, id); if (!s) throw new HttpError(404, "That stage doesn't exist."); return s; };

  switch (b.action) {
    case "create": {   // { as, kind: podcast|live, title, description, category, saveVideo, speakMode, chatOn, teamOnly, at? }
      if (m.banned) throw new HttpError(403, `You can't host stages right now${m.banned.reason ? ` (${m.banned.reason})` : ""}.`);
      let hostId = null, teamId = null;
      const as = String(b.as || "me");
      if (as === "me") { if (!m.soloHost) throw new HttpError(403, "Hosting your own stage is a Galaxy Pro+ perk (or ask the Owner to allow you). You can also host one with your team."); hostId = user.id; }
      else if (as === "team") { if (!m.team?.manage) throw new HttpError(403, "Only your team's organizer and Admins can start a team stage."); teamId = m.team.id; }
      else if (as.startsWith("host:")) {
        hostId = Number(as.slice(5)) || 0;
        const [c] = await sql`SELECT role FROM stream_crew WHERE host_user_id = ${hostId} AND user_id = ${user.id}`;
        if (c?.role !== "editor") throw new HttpError(403, "You're not an Editor for them.");
        if (!(await hostAllowed(env, sql, hostId))) throw new HttpError(403, "They can't host stages right now.");
      } else throw new HttpError(400, "Choose who's hosting.");
      const title = await clean(sql, b.title, 80);
      if (title.length < 3) throw new HttpError(400, "Give your stage a topic (at least 3 characters).");
      const kind = b.kind === "podcast" ? "podcast" : "live";
      const description = b.description ? await clean(sql, b.description, 300) : null;
      const category = CATEGORIES.includes(b.category) ? b.category : null;
      const saveVideo = kind === "live" && Boolean(b.saveVideo);
      const speakMode = b.speakMode === "invite" ? "invite" : "hand";
      const chatOn = b.chatOn !== false;
      const teamOnly = Boolean(teamId) && Boolean(b.teamOnly);
      const at = b.at ? new Date(b.at) : null;
      if (at && (isNaN(at) || at < new Date(Date.now() - 60_000) || at > new Date(Date.now() + 60 * 86400_000))) throw new HttpError(400, "Pick a time in the next 60 days.");
      const [busy] = await sql`SELECT id FROM streams WHERE status IN ('live', 'backstage') AND (host_user_id = ${hostId} OR team_id = ${teamId})`;
      if (!at && busy) throw new HttpError(409, "You already have a stage open. End it before starting another.");
      if (at) {
        const [{ n }] = await sql`SELECT count(*)::int AS n FROM streams WHERE status = 'scheduled' AND (host_user_id = ${hostId} OR team_id = ${teamId})`;
        if (n >= MAX_SCHEDULED) throw new HttpError(409, `You can have up to ${MAX_SCHEDULED} upcoming stages.`);
      }
      const [row] = await sql`INSERT INTO streams (host_user_id, team_id, title, kind, status, scheduled_at, created_by, description, category, save_video, speak_mode, chat_on, team_only)
                              VALUES (${hostId}, ${teamId}, ${title}, ${kind}, 'scheduled', ${at ? at.toISOString() : null}, ${user.id}, ${description}, ${category}, ${saveVideo}, ${speakMode}, ${chatOn}, ${teamOnly}) RETURNING id`;
      if (at) { await changed(); return json({ ok: true, id: Number(row.id), message: teamOnly ? "Scheduled. Your team can tap Notify me." : "Scheduled. People can tap Notify me, and it shows in #Events." }); }
      try { await toBackstage(env, sql, row.id); }
      catch (e) { await sql`DELETE FROM streams WHERE id = ${row.id}`; throw e; }
      return json({ ok: true, id: Number(row.id), backstage: true, message: "You're backstage. Press Go live when you're ready." });
    }
    case "golive": {   // backstage -> live (followers are told now)
      const s = await needStream(b.id);
      if (!(await rightsFor(sql, user, s, m)).manage) throw new HttpError(403, "Only the stage's hosts can start it.");
      await goLive(env, sql, s.id);
      return json({ ok: true, id: Number(s.id), live: true, message: "You're live!" });
    }
    case "start": {   // start a scheduled stream now
      const s = await needStream(b.id);
      if (!(await rightsFor(sql, user, s, m)).manage) throw new HttpError(403, "Only the stage's hosts can start it.");
      const [busy] = await sql`SELECT id FROM streams WHERE status IN ('live', 'backstage') AND (host_user_id = ${s.host_user_id} OR team_id = ${s.team_id})`;
      if (busy) throw new HttpError(409, "Another stage of yours is already open.");
      await toBackstage(env, sql, s.id);
      return json({ ok: true, id: Number(s.id), backstage: true, message: "You're backstage. Press Go live when you're ready." });
    }
    case "edit": {
      const s = await needStream(b.id);
      if (!(await rightsFor(sql, user, s, m)).manage) throw new HttpError(403, "Only the stage's hosts can change it.");
      const title = await clean(sql, b.title ?? s.title, 80);
      if (title.length < 3) throw new HttpError(400, "Give your stage a title (at least 3 characters).");
      const description = b.description !== undefined ? (b.description ? await clean(sql, b.description, 300) : null) : s.description;
      const category = b.category !== undefined ? (CATEGORIES.includes(b.category) ? b.category : null) : s.category;
      const speakMode = b.speakMode !== undefined ? (b.speakMode === "invite" ? "invite" : "hand") : s.speak_mode;
      const chatOn = b.chatOn !== undefined ? b.chatOn !== false : s.chat_on;
      await sql`UPDATE streams SET title = ${title}, description = ${description}, category = ${category}, speak_mode = ${speakMode}, chat_on = ${chatOn} WHERE id = ${s.id}`;
      if (s.status === "live" || s.status === "backstage") await roomStub(env, s.id).fetch("https://stream/internal/start", { method: "POST", body: JSON.stringify(roomInfo({ ...s, title, speak_mode: speakMode, chat_on: chatOn })) });
      await changed();
      return json({ ok: true, message: "Saved." });
    }
    case "end":
    case "cancel": {
      const s = await needStream(b.id);
      const r = await rightsFor(sql, user, s, m);
      if (!r.manage && !r.mod) throw new HttpError(403, "Only the stage's hosts and staff can do that.");
      if (s.status === "live" || s.status === "backstage") {
        await roomStub(env, s.id).fetch("https://stream/internal/end", { method: "POST", body: JSON.stringify({ reason: r.manage ? "The host ended the stage." : "Staff ended this stage.", by: user.username }) });
      } else if (s.status === "scheduled") {
        await sql`UPDATE streams SET status = 'ended', ended_by = ${user.username} WHERE id = ${s.id}`;
      }
      await changed();
      return json({ ok: true, message: s.status === "scheduled" ? "The stage was cancelled." : "The stage ended." });
    }
    case "remind": {
      const s = await needStream(b.id);
      if (b.on === false) await sql`DELETE FROM stream_reminders WHERE stream_id = ${s.id} AND user_id = ${user.id}`;
      else await sql`INSERT INTO stream_reminders (stream_id, user_id) VALUES (${s.id}, ${user.id}) ON CONFLICT DO NOTHING`;
      return json({ ok: true, message: b.on === false ? "Reminder removed." : "We'll let you know when it starts." });
    }
    case "episode-delete": {
      const [e] = await sql`SELECT * FROM stream_episodes WHERE id = ${Number(b.id) || 0} AND deleted_at IS NULL`;
      if (!e) throw new HttpError(404, "That episode isn't there any more.");
      const allowed = isMod(user) || Number(e.created_by) === Number(user.id) || (await rightsFor(sql, user, e, m)).manage;
      if (!allowed) throw new HttpError(403, "Only the host can remove this episode.");
      await sql`UPDATE stream_episodes SET deleted_at = now() WHERE id = ${e.id}`;  // the file stays in storage until the Owner deletes it for good (so a removed episode can be restored)
      await changed();
      return json({ ok: true, message: "Episode removed." });
    }
    case "episode-edit": {   // { id, title, description, chapters (text: "3:20 Bedwars tips" per line) }
      const [e] = await sql`SELECT * FROM stream_episodes WHERE id = ${Number(b.id) || 0} AND deleted_at IS NULL`;
      if (!e) throw new HttpError(404, "That isn't there any more.");
      if (!(isMod(user) || Number(e.created_by) === Number(user.id) || (await rightsFor(sql, user, e, m)).manage)) throw new HttpError(403, "Only the host can change this.");
      const title = b.title !== undefined ? await clean(sql, b.title, 80) : e.title;
      if (title.length < 3) throw new HttpError(400, "Give it a title (at least 3 characters).");
      const description = b.description !== undefined ? (b.description ? await clean(sql, b.description, 300) : "") : e.description;
      let chapters = e.chapters || [];
      if (b.chapters !== undefined) {
        chapters = parseChapters(b.chapters);
        for (const c of chapters) c.title = await clean(sql, c.title, 60);
      }
      await sql`UPDATE stream_episodes SET title = ${title}, description = ${description}, chapters = ${JSON.stringify(chapters)}::jsonb WHERE id = ${e.id}`;
      await changed();
      return json({ ok: true, message: "Saved.", chapters });
    }
    case "comment": {   // { id, body }
      const [e] = await sql`SELECT * FROM stream_episodes WHERE id = ${Number(b.id) || 0} AND deleted_at IS NULL AND status = 'ready'`;
      if (!e || !visibleTo(m, user)(e)) throw new HttpError(404, "That isn't there any more.");
      const body = await clean(sql, b.body, 300);
      if (!body) throw new HttpError(400, "Write a comment first.");
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM episode_comments WHERE user_id = ${user.id} AND created_at > now() - interval '1 minute'`;
      if (n >= 4) throw new HttpError(429, "Slow down a little.");
      await sql`INSERT INTO episode_comments (episode_id, user_id, body) VALUES (${e.id}, ${user.id}, ${body})`;
      if (Number(e.created_by) !== Number(user.id)) await notify(env, [Number(e.created_by)], "streams", { title: `${user.username} commented on "${e.title}"`, body: body.slice(0, 120), url: `/community#stages/ep-${e.id}`, tag: `epc-${e.id}` }, { exclude: [user.id] }).catch(() => {});
      return json({ ok: true });
    }
    case "comment-delete": {
      const [c] = await sql`SELECT c.*, e.created_by AS ep_by, e.host_user_id, e.team_id FROM episode_comments c JOIN stream_episodes e ON e.id = c.episode_id WHERE c.id = ${Number(b.id) || 0} AND c.deleted_at IS NULL`;
      if (!c) throw new HttpError(404, "That comment is gone.");
      const ok = Number(c.user_id) === Number(user.id) || isMod(user) || Number(c.ep_by) === Number(user.id) || (await rightsFor(sql, user, c, m)).manage;
      if (!ok) throw new HttpError(403, "You can't delete that comment.");
      await sql`UPDATE episode_comments SET deleted_at = now() WHERE id = ${c.id}`;
      return json({ ok: true, message: "Comment deleted." });
    }
    case "episode-play": {
      await sql`UPDATE stream_episodes SET plays = plays + 1 WHERE id = ${Number(b.id) || 0} AND deleted_at IS NULL`;
      return json({ ok: true });
    }
    case "follow": {   // { userId | teamId, on }
      const uid = Number(b.userId) || null, tid = Number(b.teamId) || null;
      if (!uid && !tid) throw new HttpError(400, "Follow who?");
      if (uid === Number(user.id)) throw new HttpError(400, "You can't follow yourself.");
      if (b.on === false) await sql`DELETE FROM stream_follows WHERE user_id = ${user.id} AND (host_user_id = ${uid} OR team_id = ${tid})`;
      else {
        const [{ n }] = await sql`SELECT count(*)::int AS n FROM stream_follows WHERE user_id = ${user.id}`;
        if (n >= 200) throw new HttpError(409, "You're following a lot of hosts already.");
        await sql`INSERT INTO stream_follows (user_id, host_user_id, team_id) VALUES (${user.id}, ${uid}, ${tid}) ON CONFLICT DO NOTHING`;
      }
      return json({ ok: true, message: b.on === false ? "Unfollowed." : "Following. You'll get a notification when they go live." });
    }
    case "crew-add": {   // { name, role }
      if (!m.soloHost) throw new HttpError(403, "A stage crew is for members who can host their own stage (Galaxy Pro+, or allowed by the Owner).");
      const name = String(b.name || "").trim().replace(/^@/, "").toLowerCase();
      const [u] = await sql`SELECT u.id, u.username FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
                             WHERE (u.username_lower = ${name} OR lower(p.gamertag) = ${name}) AND NOT u.banned AND NOT u.is_bot LIMIT 1`;
      if (!u) throw new HttpError(404, "No member with that name.");
      if (Number(u.id) === Number(user.id)) throw new HttpError(400, "You're already the host.");
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM stream_crew WHERE host_user_id = ${user.id}`;
      if (n >= MAX_CREW) throw new HttpError(409, `Your crew can have up to ${MAX_CREW} people.`);
      const role = b.role === "editor" ? "editor" : "streamer";
      await sql`INSERT INTO stream_crew (host_user_id, user_id, role) VALUES (${user.id}, ${u.id}, ${role})
                ON CONFLICT (host_user_id, user_id) DO UPDATE SET role = ${role}`;
      await notify(env, [Number(u.id)], "streams", { title: `You're on ${user.username}'s stage crew`,
        body: role === "editor" ? "As an Editor you can start their stages, run the chat and bring people up to speak." : "As a Speaker you can speak on their stages.",
        url: "/community#stages", tag: `crew-${user.id}` }).catch(() => {});
      return json({ ok: true, message: `${u.username} is now ${role === "editor" ? "an Editor" : "a Speaker"} on your crew.` });
    }
    case "crew-remove": {
      await sql`DELETE FROM stream_crew WHERE (host_user_id = ${user.id} AND user_id = ${Number(b.userId) || 0})
                                       OR (user_id = ${user.id} AND host_user_id = ${Number(b.hostId) || 0})`;
      return json({ ok: true, message: "Removed." });
    }
    case "report": {   // { id, reason, details } goes to the Reports queue
      const s = await needStream(b.id);
      const reason = String(b.reason || "Other").slice(0, 40);
      const details = String(b.details || "").trim().slice(0, 300);
      const [mine] = await sql`SELECT coalesce(p.gamertag, u.username) AS name, p.xuid FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${user.id}`;
      const [{ recent }] = await sql`SELECT count(*)::int AS recent FROM game_reports WHERE lower(reporter_name) = lower(${mine.name}) AND created_at > now() - interval '1 day'`;
      if (recent >= 5) throw new HttpError(429, "You've sent a lot of reports today. Please try again tomorrow, or open a ticket in #support.");
      const target = s.team_id ? `[${s.team_tag}] ${s.team_name} (team)` : s.host_name;
      await sql`INSERT INTO game_reports (reporter_xuid, reporter_name, target_xuid, target_name, reason, details, world)
                VALUES (${mine.xuid || null}, ${mine.name}, ${s.team_id ? null : s.host_xuid}, ${target}, ${reason},
                        ${`Stage "${s.title}" (#${s.id}). ${details}`.slice(0, 400)}, 'stream')`;
      await import("./gamemod.js").then((g) => g.notifyStaff(env, sql)).catch(() => {});
      return json({ ok: true, message: "Thanks. Your report was sent to staff." });
    }
    case "allow":
    case "disallow": {   // the Owner lets a member host stages and post episodes without Pro+ { name } / { userId }
      if (!user.owner) throw new HttpError(403, "Only the Owner can do that.");
      let uid = Number(b.userId) || 0;
      if (!uid && b.name) {
        const name = String(b.name).trim().replace(/^@/, "").toLowerCase();
        const [u] = await sql`SELECT u.id FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE (u.username_lower = ${name} OR lower(p.gamertag) = ${name}) AND NOT u.is_bot LIMIT 1`;
        if (!u) throw new HttpError(404, "No member with that name.");
        uid = Number(u.id);
      }
      const [u] = await sql`UPDATE users SET stream_allowed = ${b.action === "allow"} WHERE id = ${uid} RETURNING id, username`;
      if (!u) throw new HttpError(404, "No member with that name.");
      if (b.action === "allow") await notify(env, [uid], "streams", { title: "You can host stages now", body: "Start your own stage or post podcast episodes in #Stages.", url: "/community#stages", tag: "stream-allowed" }).catch(() => {});
      return json({ ok: true, message: b.action === "allow" ? `${u.username} can host stages and post episodes now.` : `${u.username} can't host their own stages any more.` });
    }
    case "ban":
    case "unban": {   // staff: stop a member from streaming { userId, days, reason }
      if (!isMod(user)) throw new HttpError(403, "Only staff can do that.");
      const uid = Number(b.userId) || 0;
      if (b.action === "unban") {
        await sql`UPDATE users SET stream_banned_until = NULL, stream_ban_reason = NULL WHERE id = ${uid}`;
        return json({ ok: true, message: "They can host stages again." });
      }
      const days = Math.min(3650, Math.max(1, Number(b.days) || 7));
      const reason = String(b.reason || "").trim().slice(0, 120);
      const [u] = await sql`UPDATE users SET stream_banned_until = now() + make_interval(days => ${days}), stream_ban_reason = ${reason || null}
                             WHERE id = ${uid} RETURNING username`;
      if (!u) throw new HttpError(404, "That member doesn't exist.");
      // end their live streams (their own)
      for (const s of await sql`SELECT id FROM streams WHERE status = 'live' AND host_user_id = ${uid}`) {
        await roomStub(env, s.id).fetch("https://stream/internal/end", { method: "POST", body: JSON.stringify({ reason: "Staff ended this stage.", by: user.username }) });
      }
      await changed();
      return json({ ok: true, message: `${u.username} can't host or speak on stages for ${days} day${days === 1 ? "" : "s"}.` });
    }
  }
  throw new HttpError(400, "Unknown action.");
}

// ---------- staff: GET /api/streams/staff (every live stream + who's stopped from streaming) ----------
export async function staffList(request, env) {
  const user = await requireUser(request, env);
  if (!isMod(user)) throw new HttpError(403, "Only staff can see this.");
  const sql = getDb(env);
  const [live, banned, allowed] = await Promise.all([
    sql`SELECT s.* FROM streams_v s WHERE s.status = 'live' ORDER BY s.started_at`,
    sql`SELECT id, username, stream_banned_until, stream_ban_reason FROM users WHERE stream_banned_until > now() ORDER BY stream_banned_until`,
    sql`SELECT id, username FROM users WHERE stream_allowed ORDER BY username_lower`,
  ]);
  const counts = await Promise.all(live.map((s) => roomStub(env, s.id).fetch("https://stream/internal/count").then((r) => r.json()).catch(() => ({ viewers: 0, stage: [] }))));
  return json({ ok: true, live: live.map((s, i) => streamOut(s, { viewers: counts[i].viewers, onStage: counts[i].stage })),
    banned: banned.map((u) => ({ id: Number(u.id), username: u.username, until: u.stream_banned_until, reason: u.stream_ban_reason || "" })),
    owner: Boolean(user.owner), allowed: allowed.map((u) => ({ id: Number(u.id), username: u.username })) });
}

// Scheduled streams for #Events (upcoming, not started yet).
export async function upcomingForEvents(sql) {
  const rows = await sql`SELECT s.* FROM streams_v s WHERE s.status = 'scheduled' AND s.scheduled_at > now() - interval '1 hour'
                          ORDER BY s.scheduled_at LIMIT 10`;
  return rows.map((s) => streamOut(s));
}

// Every 5 minutes: scheduled streams that never started 3 hours after their time are closed.
export async function tick(env) {
  const sql = getDb(env);
  await sql`UPDATE streams SET status = 'ended', ended_by = 'expired' WHERE status = 'scheduled' AND scheduled_at < now() - interval '3 hours'`;
  // backstage for 2 hours without going live: closed
  for (const s of await sql`SELECT id FROM streams WHERE status = 'backstage' AND created_at < now() - interval '2 hours'`) {
    await roomStub(env, s.id).fetch("https://stream/internal/end", { method: "POST", body: JSON.stringify({ reason: "The stage never went live, so it closed.", by: "expired" }) }).catch(() => {});
    await sql`UPDATE streams SET status = 'ended', ended_by = 'expired' WHERE id = ${s.id} AND status = 'backstage'`;
  }
  await import("./recordings.js").then((r) => r.finishStale(env, sql)).catch((e) => console.error("recordings tick", e));
}

// GET /api/episodes/:id/comments
export async function comments(request, env, ctx, url, params) {
  const user = await requireUser(request, env);
  const sql = getDb(env);
  const [e] = await sql`SELECT * FROM stream_episodes WHERE id = ${Number(params.id) || 0} AND deleted_at IS NULL`;
  const m = await me(sql, user);
  if (!e || !visibleTo(m, user)(e)) throw new HttpError(404, "That isn't there any more.");
  const canMod = isMod(user) || Number(e.created_by) === Number(user.id) || (await rightsFor(sql, user, e, m)).manage;
  const rows = await sql`SELECT c.id, c.body, c.created_at, c.user_id, u.username, p.xuid, p.head_at, p.gamerpic_at
                           FROM episode_comments c JOIN users u ON u.id = c.user_id LEFT JOIN players p ON p.uuid = u.mc_uuid
                          WHERE c.episode_id = ${e.id} AND c.deleted_at IS NULL ORDER BY c.created_at LIMIT 200`;
  return json({ ok: true, comments: rows.map((c) => ({ id: Number(c.id), body: c.body, at: c.created_at, name: c.username, head: c.xuid ? headUrlFor(c) : null,
    mine: Number(c.user_id) === Number(user.id), canDelete: canMod || Number(c.user_id) === Number(user.id) })) }, 200, { "Cache-Control": "no-store" });
}
