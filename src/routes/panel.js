// The staff panel (Control Panel for owners, Admin Panel for admins, Staff Panel for staff):
// the Overview tab (live numbers + quick controls) and player management (one card per player
// with everything about them, staff notes and in-game actions).
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { isOwner } from "../lib/names.js";
import { voiceStub } from "./voice.js";
import { toPlugin } from "./economy.js";
import { openTicketCount } from "./support.js";
import { headUrlFor } from "./heads.js";
import { sendPlans } from "./plans.js";
import { SHOP_ITEMS, SHOP } from "../store/shop.js";

const MOD = 50;
export const LATEST_PLUGIN = "2.22.0"; // the GalaxyLink version made for this website
export const LATEST_ICONS = "1.8.0"; // the GalaxySMP Icons resource pack version that goes with it
const older = (a, b) => { const x = String(a).split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
const ADMIN = 100;
const KEY_KINDS = ["common", "rare", "galaxy"];
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

async function requireStaff(request, env, power = MOD) {
  const user = await requireUser(request, env);
  if (Number(user.role_power) < power) throw new HttpError(403, power >= ADMIN ? "Only Admins can do that." : "Only staff can do that.");
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
  return json({
    ok: true,
    owner: user.owner,
    power: Number(user.role_power),
    panel: user.owner ? "Control Panel" : Number(user.role_power) >= ADMIN ? "Admin Panel" : "Staff Panel",
    server: server ? { online: true, players: server.online ?? online.length, max: server.max ?? null, version: server.version || "",
        plugin: server.plugin || null, latest: LATEST_PLUGIN, outdated: !server.plugin || older(server.plugin, LATEST_PLUGIN),
        iconsPack: server.iconsPack || null, latestIcons: LATEST_ICONS,
        iconsOutdated: Boolean(server.iconsPack) && (server.iconsPack === "missing" || older(server.iconsPack, LATEST_ICONS)) } : { online: false },
    counts: {
      members: counts.members, newMembers: counts.new_members, players: counts.players, newPlayers: counts.new_players,
      activeToday: counts.active_today, openTickets: counts.open_tickets, urgentTickets: counts.urgent_tickets,
      reports: counts.game_reports + counts.chat_reports, punishmentsWeek: counts.punishments_week, plans: counts.plans,
    },
    online: online.map((p) => ({ xuid: p.xuid, name: p.gamertag, head: headUrl(p) })),
    recent: recent.map((r) => ({ action: r.action, details: r.details, at: r.created_at, actor: r.actor || "System" })),
  });
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
      LEFT JOIN player_ranks pr ON pr.xuid = p.xuid LEFT JOIN ranks rk ON rk.id = pr.rank_id
      LEFT JOIN subscriptions s ON s.xuid = p.xuid AND (s.expires_at IS NULL OR s.expires_at > now())
      LEFT JOIN users u ON u.mc_uuid = p.uuid
     WHERE (${q} = '' OR lower(p.gamertag) LIKE ${like} OR lower(coalesce(u.username, '')) LIKE ${like})
       AND (${filter} = 'all'
            OR (${filter} = 'online' AND p.online_at > now() - interval '3 minutes')
            OR (${filter} = 'staff' AND (p.is_op OR rk.website_role IN (3, 4)))
            OR (${filter} = 'plans' AND s.plan IS NOT NULL)
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
    SELECT p.*, rk.name AS rank_name, rk.color AS rank_color, rk.id AS rank_id, pr.assigned_by, s.plan, s.expires_at,
           u.id AS user_id, u.username, u.banned, u.ban_reason, u.muted_until, u.mute_reason, u.created_at AS joined_site, r.name AS role_name, r.power AS role_power,
           (SELECT kind FROM game_punishments g WHERE g.xuid = p.xuid AND g.kind IN ('ban', 'unban') ORDER BY g.id DESC LIMIT 1) AS ban_state,
           (SELECT count(*)::int FROM game_punishments g WHERE g.xuid = p.xuid AND g.kind = 'warn') AS warns
      FROM players p
      LEFT JOIN player_ranks pr ON pr.xuid = p.xuid LEFT JOIN ranks rk ON rk.id = pr.rank_id
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
      rankId: p.rank_id ? Number(p.rank_id) : null, rankBy: p.assigned_by || null,
      firstSeen: p.first_seen, extraPlots: p.extra_plots,
      stats: { playtimeH: Math.round(Number(p.playtime_s || 0) / 360) / 10, mined: Number(p.mined || 0), placed: Number(p.placed || 0), kills: Number(p.kills || 0), deaths: Number(p.deaths || 0), quests: p.quests_done, streak: p.streak, achievements: (p.achievements || []).length },
      account: p.user_id ? {
        id: Number(p.user_id), username: p.username, role: p.role_name, power: Number(p.role_power), joined: p.joined_site,
        banned: p.banned, banReason: p.ban_reason,
        mutedUntil: p.muted_until && new Date(p.muted_until) > new Date() ? p.muted_until : null, muteReason: p.mute_reason,
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

const GAME_ACTIONS = { warn: MOD, mute: MOD, unmute: MOD, kick: MOD, ban: ADMIN, unban: ADMIN };

export async function playerAction(request, env, ctx, url, params) {
  const action = String(params.action);
  const needed = ["givekey", "note-delete", "shopgive"].includes(action) ? ADMIN : GAME_ACTIONS[action] ?? (action === "note" ? MOD : null);
  if (needed == null) throw new HttpError(400, "Unknown action.");
  const user = await requireStaff(request, env, needed);
  const body = await readJson(request);
  const sql = getDb(env);
  const [p] = await sql`
    SELECT p.xuid, p.gamertag, p.is_op, u.username, u.platform, rk.website_role
      FROM players p LEFT JOIN users u ON u.mc_uuid = p.uuid
      LEFT JOIN player_ranks pr ON pr.xuid = p.xuid LEFT JOIN ranks rk ON rk.id = pr.rank_id
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
