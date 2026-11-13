// The staff panel (Control Panel for owners, Admin Panel for admins, Staff Panel for staff):
// the Overview tab (live numbers + quick controls) and player management (one card per player
// with everything about them, staff notes and in-game actions).
import { can } from "../lib/perms.js";
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { isOwner } from "../lib/names.js";
import { voiceStub } from "./voice.js";
import { toPlugin } from "./economy.js";
import { openTicketCount } from "./support.js";
import { headUrlFor, setPicture } from "./heads.js";
import { sendPlans } from "./plans.js";
import { SHOP_ITEMS, SHOP } from "../store/shop.js";

const MOD = 50;
export const LATEST_PLUGIN = "2.38.0"; // the GalaxyLink version made for this website
export const LATEST_ICONS = "1.9.0"; // the GalaxySMP Icons resource pack version that goes with it
const older = (a, b) => { const x = String(a).split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
const ADMIN = 100;
const KEY_KINDS = ["common", "rare", "galaxy"];
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

// need: a website permission, or MOD / ADMIN for Mod Panel / Admin Panel access.
async function requireStaff(request, env, need = MOD) {
  const user = await requireUser(request, env);
  const key = need === MOD ? "mod_panel" : need === ADMIN ? "admin_panel" : need;
  if (!can(user, key)) throw new HttpError(403, "Your rank doesn't have permission to do that.");
  user.owner = isOwner(env, user.username, user.platform === "bedrock");
  return user;
}

async function audit(sql, actorId, action, details) {
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${actorId}, ${action}, ${JSON.stringify(details)}::jsonb)`;
}

const headUrl = headUrlFor;
const isOnline = (p) => Boolean(p.online_at && Date.now() - new Date(p.online_at).getTime() < 3 * 60_000);

async function serverInfo(env) {
  try { return await voiceStub(env).fetch("https://voice/internal/server").then((r) => r.json()); } catch { return null; }
}

// ---------- Overview ----------
export async function overview(request, env) {
  const user = await requireStaff(request, env);
  const sql = getDb(env);
  const [[counts], recent, server] = await Promise.all([
    sql`SELECT
          (SELECT count(*)::int FROM users) AS members,
          (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new_members,
          (SELECT count(*)::int FROM players) AS players,
          (SELECT count(*)::int FROM players WHERE first_seen > now() - interval '7 days') AS new_players,
          (SELECT count(*)::int FROM players WHERE last_seen > now() - interval '1 day') AS active_today,
          (SELECT count(*)::int FROM tickets WHERE status = 'open') AS open_tickets,
          (SELECT count(*)::int FROM tickets WHERE status = 'open' AND priority IN ('high', 'urgent')) AS urgent_tickets,
          (SELECT count(*)::int FROM game_reports WHERE status = 'open') AS game_reports,
          (SELECT count(DISTINCT message_id)::int FROM reports WHERE status = 'open') AS chat_reports,
          (SELECT count(*)::int FROM game_punishments WHERE created_at > now() - interval '7 days') AS punishments_week,
          (SELECT count(*)::int FROM subscriptions WHERE expires_at IS NULL OR expires_at > now()) AS plans`,
    sql`SELECT a.action, a.details, a.created_at, u.username AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
         ORDER BY a.id DESC LIMIT 8`,
    serverInfo(env),
  ]);
  const online = await sql`SELECT xuid, gamertag, head_at, gamerpic_at FROM players WHERE online_at > now() - interval '3 minutes' ORDER BY gamertag LIMIT 60`;
  // Server map health: chunks stored, and what the plugin last reported.
  const [[mapRow], mapLive, [mapOn]] = await Promise.all([
    sql`SELECT count(*)::int AS chunks, max(updated_at) AS last FROM map_chunks`,
    voiceStub(env).fetch("https://voice/internal/map").then((r) => r.json()).catch(() => ({})),
    sql`SELECT value FROM economy_config WHERE key = 'map_enabled'`,
  ]);
  return json({
    ok: true,
    owner: user.owner,
    power: Number(user.role_power),
    panel: user.owner ? "Control Panel" : Number(user.role_power) >= ADMIN ? "Admin Panel" : "Staff Panel",
    server: server ? { online: true, players: server.online ?? online.length, max: server.max ?? null, version: server.version || "",
        plugin: server.plugin || null, latest: LATEST_PLUGIN, outdated: !server.plugin || older(server.plugin, LATEST_PLUGIN),
        iconsPack: server.iconsPack || null, latestIcons: LATEST_ICONS, iconConflicts: Array.isArray(server.iconConflicts) ? server.iconConflicts.slice(0, 5).map(String) : [],
        iconsOutdated: Boolean(server.iconsPack) && (server.iconsPack === "missing" || older(server.iconsPack, LATEST_ICONS)) } : { online: false },
    counts: {
      members: counts.members, newMembers: counts.new_members, players: counts.players, newPlayers: counts.new_players,
      activeToday: counts.active_today, openTickets: counts.open_tickets, urgentTickets: counts.urgent_tickets,
      reports: counts.game_reports + counts.chat_reports, punishmentsWeek: counts.punishments_week, plans: counts.plans,
    },
    online: online.map((p) => ({ xuid: p.xuid, name: p.gamertag, head: headUrl(p) })),
    map: { enabled: mapOn?.value === true, chunks: mapRow.chunks, lastChunk: mapRow.last, liveAt: mapLive.playersAt || null, error: mapLive.status?.error || null, reportAt: mapLive.statusAt || null },
    recent: recent.map((r) => ({ action: r.action, details: r.details, at: r.created_at, actor: r.actor || "System" })),
  });
}

// Voice rooms (Admins): GET lists them; POST { action: add|rename|move|delete, id, name, description, dir }
export async function voiceRooms(request, env) {
  const user = await requireStaff(request, env, "voice_rooms");
  const init = request.method === "POST" ? { method: "POST", body: JSON.stringify(await readJson(request)) } : {};
  const data = await voiceStub(env).fetch("https://voice/internal/rooms", init).then((r) => r.json());
  if (!data.ok) throw new HttpError(400, data.error || "That didn't work.");
  if (request.method === "POST") {
    await getDb(env)`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'voice.rooms', ${JSON.stringify({ action: JSON.parse(init.body).action })}::jsonb)`;
  }
  return json(data);
}

// GET /api/voice/rooms (members): the rooms, for the Voice page's Join screen.
export async function publicVoiceRooms(request, env) {
  await requireUser(request, env);
  const data = await voiceStub(env).fetch("https://voice/internal/rooms").then((r) => r.json()).catch(() => ({ ok: true, rooms: [] }));
  return json({ ok: true, rooms: data.rooms || [] });
}

// POST /api/panel/map { enabled } (Admins): show the server map on the website and let the server draw it.
export async function setMap(request, env) {
  const user = await requireStaff(request, env, "server_map");
  const body = await readJson(request);
  const enabled = Boolean(body.enabled);
  const sql = getDb(env);
  await sql`INSERT INTO economy_config (key, value, updated_by) VALUES ('map_enabled', ${JSON.stringify(enabled)}::jsonb, ${user.username})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, ${enabled ? "map.on" : "map.off"}, '{}'::jsonb)`;
  try { await toPlugin(env, { type: "map", enabled }); } catch { /* server offline: it's told when it connects */ }
  return json({ ok: true, enabled });
}

export async function announce(request, env) {
  const user = await requireStaff(request, env);
  const body = await readJson(request);
  const text = clean(body.text, 200);
  if (text.length < 2) throw new HttpError(400, "Type the announcement first.");
  const sent = await toPlugin(env, { type: "announce", text, by: user.username });
  if (!sent) throw new HttpError(409, "The Minecraft server isn't connected right now. Try again when it's online.");
  const sql = getDb(env);
  await audit(sql, user.id, "game.announce", { text });
  return json({ ok: true });
}

// ---------- Players ----------
export async function searchPlayers(request, env, ctx, url) {
  await requireStaff(request, env);
  const q = clean(url.searchParams.get("q"), 32).toLowerCase();
  const filter = url.searchParams.get("filter") || "all";
  const sql = getDb(env);
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const rows = await sql`
    SELECT p.xuid, p.gamertag, p.is_op, p.balance_cents, p.last_seen, p.online_at, p.head_at, p.gamerpic_at, p.playtime_s,
           rk.name AS rank_name, rk.color AS rank_color, s.plan, s.expires_at,
           u.id AS user_id, u.username, u.banned, u.muted_until,
           (SELECT kind FROM game_punishments g WHERE g.xuid = p.xuid AND g.kind IN ('ban', 'unban') ORDER BY g.id DESC LIMIT 1) AS ban_state,
           (SELECT count(*)::int FROM game_punishments g WHERE g.xuid = p.xuid AND g.kind = 'warn') AS warns
      FROM players p
      LEFT JOIN player_top_rank pr ON pr.xuid = p.xuid LEFT JOIN ranks rk ON rk.id = pr.rank_id
      LEFT JOIN subscriptions s ON s.xuid = p.xuid AND (s.expires_at IS NULL OR s.expires_at > now())
      LEFT JOIN users u ON u.mc_uuid = p.uuid
     WHERE (${q} = '' OR lower(p.gamertag) LIKE ${like} OR lower(coalesce(u.username, '')) LIKE ${like})
       AND (${filter} = 'all'
            OR (${filter} = 'online' AND p.online_at > now() - interval '3 minutes')
            OR (${filter} = 'staff' AND (p.is_op OR rk.website_role IN (3, 4)))
            OR (${filter} = 'plans' AND s.plan IS NOT NULL)
            OR (${filter} = 'web-muted' AND (u.banned OR u.muted_until > now()))
            OR (${filter} = 'voice-muted' AND u.voice_muted_until > now())
            OR (${filter} = 'punished' AND EXISTS (SELECT 1 FROM game_punishments g WHERE g.xuid = p.xuid AND g.kind IN ('mute', 'ban', 'warn'))))
     ORDER BY (p.online_at > now() - interval '3 minutes') DESC NULLS LAST, p.last_seen DESC NULLS LAST
     LIMIT 60`;
  return json({ ok: true, players: rows.map(rowOut) });
}

function rowOut(p) {
  return {
    xuid: p.xuid, name: p.gamertag, op: p.is_op, head: headUrl(p), online: isOnline(p), lastSeen: p.last_seen,
    money: p.balance_cents == null ? null : Number(p.balance_cents) / 100,
    rank: p.rank_name ? { name: p.rank_name, color: p.rank_color } : null,
    plan: p.plan || null, planExpires: p.expires_at || null,
    account: p.user_id ? { id: Number(p.user_id), username: p.username, banned: p.banned, mutedUntil: p.muted_until && new Date(p.muted_until) > new Date() ? p.muted_until : null } : null,
    banned: p.ban_state === "ban", warns: p.warns ?? 0, playtimeH: Math.round(Number(p.playtime_s || 0) / 360) / 10,
  };
}

export async function playerCard(request, env, ctx, url, params) {
  await requireStaff(request, env);
  const sql = getDb(env);
  const xuid = String(params.xuid);
  const rows = await sql`
    SELECT p.*, rk.name AS rank_name, rk.color AS rank_color, rk.id AS rank_id, pr.assigned_by,
           (SELECT array_agg(x.rank_id ORDER BY r2.priority, r2.position) FROM player_ranks x JOIN ranks r2 ON r2.id = x.rank_id WHERE x.xuid = p.xuid) AS rank_ids, s.plan, s.expires_at,
           u.id AS user_id, u.username, u.banned, u.ban_reason, u.muted_until, u.mute_reason, u.voice_muted_until, u.voice_mute_reason, u.global_mic, u.created_at AS joined_site, r.name AS role_name, r.power AS role_power,
           (SELECT kind FROM game_punishments g WHERE g.xuid = p.xuid AND g.kind IN ('ban', 'unban') ORDER BY g.id DESC LIMIT 1) AS ban_state,
           (SELECT count(*)::int FROM game_punishments g WHERE g.xuid = p.xuid AND g.kind = 'warn') AS warns
      FROM players p
      LEFT JOIN player_top_rank pr ON pr.xuid = p.xuid LEFT JOIN ranks rk ON rk.id = pr.rank_id
      LEFT JOIN subscriptions s ON s.xuid = p.xuid AND (s.expires_at IS NULL OR s.expires_at > now())
      LEFT JOIN users u ON u.mc_uuid = p.uuid LEFT JOIN roles r ON r.id = u.role_id
     WHERE p.xuid = ${xuid}`;
  const p = rows[0];
  if (!p) throw new HttpError(404, "That player hasn't joined the server yet.");
  const [history, reports, notes, tickets, orders] = await Promise.all([
    sql`SELECT kind, reason, minutes, by_name, created_at FROM game_punishments WHERE xuid = ${xuid} ORDER BY id DESC LIMIT 30`,
    sql`SELECT reporter_name, reason, details, status, created_at FROM game_reports WHERE target_xuid = ${xuid} ORDER BY id DESC LIMIT 15`,
    sql`SELECT id, author, body, created_at FROM player_notes WHERE xuid = ${xuid} ORDER BY id DESC LIMIT 50`,
    p.user_id ? sql`SELECT id, subject, status, priority, label, last_message_at FROM tickets WHERE user_id = ${p.user_id} ORDER BY id DESC LIMIT 10` : [],
    sql`SELECT item, option, given_by, source, created_at FROM shop_orders WHERE xuid = ${xuid} ORDER BY id DESC LIMIT 30`,
  ]);
  return json({
    ok: true,
    player: {
      ...rowOut(p),
      rankId: p.rank_id ? Number(p.rank_id) : null, rankIds: (p.rank_ids || []).map(Number), rankBy: p.assigned_by || null,
      picSource: p.pic_source || "auto", hasHead: Boolean(p.head), hasCustomPic: Boolean(p.custom_pic),
      firstSeen: p.first_seen, extraPlots: p.extra_plots,
      stats: { playtimeH: Math.round(Number(p.playtime_s || 0) / 360) / 10, mined: Number(p.mined || 0), placed: Number(p.placed || 0), kills: Number(p.kills || 0), deaths: Number(p.deaths || 0), quests: p.quests_done, streak: p.streak, achievements: (p.achievements || []).length },
      // exact numbers for "Edit stats" (owner)
      editStats: { playtime: Math.round(Number(p.playtime_s || 0) / 36) / 100, mined: Number(p.mined || 0), placed: Number(p.placed || 0), kills: Number(p.kills || 0),
        deaths: Number(p.deaths || 0), quests: Number(p.quests_done || 0), streak: Number(p.streak || 0), best_streak: Number(p.best_streak || 0),
        bw_games: Number(p.bw_games || 0), bw_wins: Number(p.bw_wins || 0), bw_kills: Number(p.bw_kills || 0), bw_finals: Number(p.bw_finals || 0), bw_beds: Number(p.bw_beds || 0) },
      account: p.user_id ? {
        id: Number(p.user_id), username: p.username, role: p.role_name, power: Number(p.role_power), joined: p.joined_site,
        ...(await sql`SELECT u.real_name, u.real_name_hidden, u.found_via, u.bio, u.interests, u.onboarded_at, inv.username AS invited_by
                        FROM users u LEFT JOIN users inv ON inv.id = u.invited_by WHERE u.id = ${p.user_id}`.then(([r]) => ({
          realName: r?.real_name || null, realNameHidden: Boolean(r?.real_name_hidden),
          welcome: r?.onboarded_at ? { foundVia: r.found_via || null, invitedBy: r.invited_by || null, bio: r.bio || null, interests: r.interests || [], at: r.onboarded_at } : null,
        }))),
        credits: Number((await sql`SELECT credit_cents FROM users WHERE id = ${p.user_id}`)[0]?.credit_cents || 0) / 100,
        banned: p.banned, banReason: p.ban_reason,
        mutedUntil: p.muted_until && new Date(p.muted_until) > new Date() ? p.muted_until : null, muteReason: p.mute_reason,
        voiceMutedUntil: p.voice_muted_until && new Date(p.voice_muted_until) > new Date() ? p.voice_muted_until : null,
        voiceMuteReason: p.voice_mute_reason, globalMic: Boolean(p.global_mic),
      } : null,
    },
    history: history.map((h) => ({ kind: h.kind, reason: h.reason, minutes: h.minutes, by: h.by_name, at: h.created_at })),
    reports: reports.map((r) => ({ by: r.reporter_name, reason: r.reason, details: r.details, status: r.status, at: r.created_at })),
    notes: notes.map((n) => ({ id: Number(n.id), author: n.author, body: n.body, at: n.created_at })),
    tickets: tickets.map((t) => ({ id: Number(t.id), subject: t.subject, status: t.status, priority: t.priority, label: t.label, at: t.last_message_at })),
    shop: {
      cosmetics: p.cosmetics || [], extraShopPlots: p.extra_shop_plots || 0,
      nightVisionUntil: p.night_vision_until && new Date(p.night_vision_until) > new Date() ? p.night_vision_until : null,
      orders: orders.map((o) => ({ item: SHOP_ITEMS[o.item]?.name || o.item, option: o.option, by: o.given_by, source: o.source, at: o.created_at })),
      catalog: SHOP.map((c) => ({ id: c.id, name: c.name, items: c.items.map((i) => ({ id: i.id, name: i.name, limit: i.limit || null, options: i.options?.map((o) => ({ id: o.id, name: o.name })) })) })),
    },
  });
}

// Leaderboard stats the owner can set: website name -> [players column, multiplier] (playtime is typed in hours).
// The plugin uses the same names (progress.py set_stats), with playtime in seconds.
export const STAT_FIELDS = {
  playtime: ["playtime_s", 3600], mined: ["mined", 1], placed: ["placed", 1], kills: ["kills", 1], deaths: ["deaths", 1],
  quests: ["quests_done", 1], streak: ["streak", 1], best_streak: ["best_streak", 1],
  bw_games: ["bw_games", 1], bw_wins: ["bw_wins", 1], bw_kills: ["bw_kills", 1], bw_finals: ["bw_finals", 1], bw_beds: ["bw_beds", 1],
};

const GAME_ACTIONS = { warn: MOD, mute: "mute_members", unmute: "mute_members", kick: MOD, ban: "ban_members", unban: "ban_members" };

export async function playerAction(request, env, ctx, url, params) {
  const action = String(params.action);
  const needed = ["givekey", "note-delete", "shopgive", "setop", "picture", "stats"].includes(action) ? ADMIN : GAME_ACTIONS[action] ?? (action === "note" ? MOD : null);
  if (needed == null) throw new HttpError(400, "Unknown action.");
  const user = await requireStaff(request, env, needed);
  const body = await readJson(request, action === "picture" ? 400_000 : 8192);
  const sql = getDb(env);
  const [p] = await sql`
    SELECT p.xuid, p.gamertag, p.is_op, u.username, u.platform, rk.website_role
      FROM players p LEFT JOIN users u ON u.mc_uuid = p.uuid
      LEFT JOIN player_top_rank pr ON pr.xuid = p.xuid LEFT JOIN ranks rk ON rk.id = pr.rank_id
     WHERE p.xuid = ${String(params.xuid)}`;
  if (!p) throw new HttpError(404, "That player hasn't joined the server yet.");

  if (action === "note") {
    const text = clean(body.body, 500);
    if (!text) throw new HttpError(400, "Write the note first.");
    await sql`INSERT INTO player_notes (xuid, author, body) VALUES (${p.xuid}, ${user.username}, ${text})`;
    return json({ ok: true });
  }
  if (action === "note-delete") {
    await sql`DELETE FROM player_notes WHERE id = ${Number(body.id)} AND xuid = ${p.xuid}`;
    return json({ ok: true });
  }
  if (action === "shopgive") return json(await giveShopItem(env, sql, p, body, user));
  if (action === "stats") {  // the owner sets leaderboard stats; play keeps counting up from them
    if (!user.owner) throw new HttpError(403, "Only the owner can change stats.");
    const want = {};
    for (const [key, [col, mult]] of Object.entries(STAT_FIELDS)) {
      const v = body.stats?.[key];
      if (v === undefined || v === null || v === "") continue;
      const n = Math.round(Number(v) * mult);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new HttpError(400, "Stats must be 0 or more.");
      want[key] = { col, value: n };
    }
    if (!Object.keys(want).length) throw new HttpError(400, "Change at least one number.");
    const [cur] = await sql.query(`SELECT ${Object.values(want).map((w) => w.col).join(", ")} FROM players WHERE xuid = $1`, [p.xuid]);
    const delta = {};
    for (const [k, w] of Object.entries(want)) delta[w.col] = w.value - Number(cur?.[w.col] || 0);
    await sql.query(`UPDATE players SET ${Object.values(want).map((w, i) => `${w.col} = $${i + 2}`).join(", ")} WHERE xuid = $1`, [p.xuid, ...Object.values(want).map((w) => w.value)]);
    // what was set by hand doesn't count for the season pass or a running server goal
    const { currentSeason } = await import("./season.js");
    const season = await currentSeason(sql);
    const d = (c) => delta[c] || 0;
    await sql`INSERT INTO season_progress (season_id, xuid, base_play, base_quests, base_bw)
              VALUES (${season.id}, ${p.xuid}, ${d("playtime_s")}, ${d("quests_done")}, ${d("bw_wins")})
              ON CONFLICT (season_id, xuid) DO UPDATE SET base_play = season_progress.base_play + ${d("playtime_s")},
                base_quests = season_progress.base_quests + ${d("quests_done")}, base_bw = season_progress.base_bw + ${d("bw_wins")}`;
    const { STATS } = await import("./goals.js");
    const [goal] = await sql`SELECT id, stat FROM server_goals WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1`;
    if (goal && d(STATS[goal.stat][0])) {
      await sql`INSERT INTO server_goal_base (goal_id, xuid, value) VALUES (${goal.id}, ${p.xuid}, ${d(STATS[goal.stat][0])})
                ON CONFLICT (goal_id, xuid) DO UPDATE SET value = server_goal_base.value + ${d(STATS[goal.stat][0])}`;
    }
    const { queueReward, sendRewards } = await import("./rewards.js");
    await queueReward(sql, { xuid: p.xuid, name: p.gamertag, stats: Object.fromEntries(Object.entries(want).map(([k, w]) => [k, w.value])), reason: "Stats set by the owner" });
    const sent = await sendRewards(env, sql).catch(() => 0);
    await audit(sql, user.id, "player.stats", { player: p.gamertag, stats: Object.fromEntries(Object.entries(want).map(([k, w]) => [k, w.value])) });
    return json({ ok: true, message: sent ? `${p.gamertag}'s stats are updated.` : `Saved. The server is offline, so the game gets the new numbers when it's back.` });
  }
  if (action === "picture") {  // profile picture: Minecraft head, Xbox picture or a custom upload
    await setPicture(env, sql, p.xuid, { source: String(body.source || ""), image: body.image || null, refreshXbox: Boolean(body.refreshXbox) });
    await audit(sql, user.id, "player.picture", { player: p.gamertag, source: body.source });
    return json({ ok: true });
  }
  if (action === "givekey") {
    const kind = KEY_KINDS.includes(body.kind) ? body.kind : null;
    const amount = Number(body.amount || 1);
    if (!kind) throw new HttpError(400, "Choose Common, Rare or Galaxy.");
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) throw new HttpError(400, "Choose 1 to 100 keys.");
    const sent = await toPlugin(env, { type: "givekey", name: p.gamertag, kind, amount, by: user.username });
    if (!sent) throw new HttpError(409, "The Minecraft server isn't connected right now. Try again when it's online.");
    await audit(sql, user.id, "game.givekey", { player: p.gamertag, kind, amount });
    return json({ ok: true });
  }

  // operator on/off (owner only). Works on operator status left over from a Realm, which /deop can't remove.
  if (action === "setop") {
    if (!user.owner) throw new HttpError(403, "Only the owner can change operators.");
    const op = Boolean(body.op);
    const sent = await toPlugin(env, { type: "setop", xuid: p.xuid, name: p.gamertag, op, by: user.username });
    if (!sent) throw new HttpError(409, "The Minecraft server isn't connected right now. Try again when it's online.");
    await sql`UPDATE players SET is_op = ${op} WHERE xuid = ${p.xuid}`;
    await audit(sql, user.id, op ? "game.op" : "game.deop", { player: p.gamertag });
    return json({ ok: true, message: op ? `${p.gamertag} is now an operator.` : `${p.gamertag} is no longer an operator. If they're offline, it happens when they next join.` });
  }

  // in-game moderation
  const targetOwner = p.username && isOwner(env, p.username, p.platform === "bedrock");
  if (targetOwner) throw new HttpError(403, "Server owners can't be moderated.");
  const targetPower = { 3: MOD, 4: ADMIN }[Number(p.website_role)] || 0;
  if (!user.owner && (p.is_op || targetPower >= Number(user.role_power))) {
    throw new HttpError(403, "You can only moderate players below your own staff level. Ask an owner.");
  }
  const reason = clean(body.reason, 200);
  let minutes = body.minutes == null || body.minutes === "" ? null : Number(body.minutes);
  if (minutes != null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 525600)) throw new HttpError(400, "Choose how long it lasts.");
  if (action === "mute" && !minutes) minutes = 60;
  if (["warn", "kick"].includes(action) && !reason) throw new HttpError(400, "Give a reason, so the player knows what they did.");
  const sent = await toPlugin(env, { type: "mod_action", action, xuid: p.xuid, name: p.gamertag, reason, minutes, by: user.username });
  if (!sent) throw new HttpError(409, "The Minecraft server isn't connected right now, so in-game actions can't be done. Try again when it's online.");
  await audit(sql, user.id, `game.${action}`, { player: p.gamertag, reason, minutes });
  return json({ ok: true });
}

// Give a Store item (what a payment will do automatically once payments open).
export async function giveShopItem(env, sql, p, body, user, source = "staff") {
  const item = SHOP_ITEMS[String(body.item || "")];
  if (!item) throw new HttpError(400, "Choose a Shop item.");
  const option = item.options ? item.options.find((o) => o.id === body.option) : null;
  if (item.options && !option) throw new HttpError(400, "Choose how long.");
  if (item.limit) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM shop_orders WHERE xuid = ${p.xuid} AND item = ${item.id}`;
    if (n >= item.limit) throw new HttpError(409, item.limit === 1 ? `${p.gamertag} already has ${item.name}.` : `${p.gamertag} already has the most (${item.limit}) of ${item.name}.`);
  }
  if (item.category === "money") {
    const sent = await toPlugin(env, { type: "eco", action: "add", xuid: p.xuid, name: p.gamertag, cents: item.cents, by: user.username });
    if (!sent) throw new HttpError(409, "The Minecraft server isn't connected right now, so money can't be added. Try again when it's online.");
    await sql`UPDATE players SET balance_cents = coalesce(balance_cents, 0) + ${item.cents}, balance_at = now() WHERE xuid = ${p.xuid}`;
  } else if (item.id === "extra_plot") {
    await sql`UPDATE players SET extra_plots = extra_plots + 1 WHERE xuid = ${p.xuid}`;
  } else if (item.id === "extra_shop_plot") {
    await sql`UPDATE players SET extra_shop_plots = extra_shop_plots + 1 WHERE xuid = ${p.xuid}`;
  } else if (item.id === "night_vision") {
    await sql`UPDATE players SET night_vision_until = greatest(coalesce(night_vision_until, now()), now()) + make_interval(days => ${option.days}) WHERE xuid = ${p.xuid}`;
  } else if (item.category === "cosmetics") {
    await sql`UPDATE players SET cosmetics = array_append(cosmetics, ${item.id}) WHERE xuid = ${p.xuid} AND NOT (${item.id} = ANY(cosmetics))`;
  }
  const price = option ? option.price : item.price;
  await sql`INSERT INTO shop_orders (xuid, item, option, price_cents, source, given_by) VALUES (${p.xuid}, ${item.id}, ${option?.id || null}, ${price || 0}, ${source}, ${user.username})`;
  await audit(sql, user.id, "shop.give", { player: p.gamertag, item: item.name, option: option?.name || null });
  const sent = item.category === "money" ? true : await sendPlans(env, sql);
  return { ok: true, sent };
}

// POST /api/panel/members/:id/real-name { name } (Admins): empty removes it
export async function setRealName(request, env, ctx, url, params) {
  const user = await requireStaff(request, env, ADMIN);
  const body = await readJson(request);
  const sql = getDb(env);
  const name = clean(body.name, 60).replace(/\s+/g, " ") || null;
  const [u] = await sql`UPDATE users SET real_name = ${name} WHERE id = ${Number(params.id)} RETURNING username`;
  if (!u) throw new HttpError(404, "That member doesn't exist.");
  await audit(sql, user.id, "member.real_name", { member: u.username, set: Boolean(name) });
  return json({ ok: true, realName: name });
}
