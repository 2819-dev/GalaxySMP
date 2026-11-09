// In-game ranks: managed by website Admins (Staff Tools → Ranks) and by server
// operators in game (/ranks, through the GalaxyLink plugin). Stored here, sent to
// the server instantly over GalaxyLink's live connection.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { safeEqual } from "../lib/crypto.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { isOwner } from "../lib/names.js";
import { hubBroadcast } from "./chat.js";
import { voiceEvent } from "./voice.js";

const ADMIN = 100;
const COLORS = "0123456789abcdef";
const ROLE_POWER = { 2: 20, 3: 50, 4: 100 };

// Rank icons (drawn by the GalaxySMP Icons resource pack; pictures in /img/ranks/).
export const ICONS = ["crown", "star", "shield", "sword", "gem", "heart", "hammer", "flame", "bolt", "rocket", "planet", "leaf",
                       "pickaxe", "axe", "bow", "potion", "book", "key", "trophy", "medal", "code", "music", "paw", "fish",
                       "mushroom", "flower", "moon", "sun", "snowflake", "skull", "ghost", "eye", "coin", "moneybag", "gift", "cake",
                       "cookie", "apple", "bell", "lightbulb", "magnet", "compass", "clock", "hourglass", "flag", "anchor", "feather", "droplet",
                       "tree", "cactus", "cloud", "rainbow", "cat", "slime", "dice", "gamepad", "redstone", "diamond", "emerald", "netherite",
                       "goldingot", "ironingot", "amethyst", "lapis", "shootingstar", "wingeddiamond"];

// Admins type command names (like "time" or "/gamemode"); each becomes the permission
// that allows the whole command, so "time" also allows "/time set day".
// Same rules as the plugin (endstone_galaxylink/ranks.py).
const ENDSTONE_COMMANDS = new Set(["ban", "banip", "banlist", "plugins", "reload", "seed", "status", "unban", "unbanip", "version"]);
const PLUGIN_COMMANDS = new Set(["link", "ranks", "money", "pay", "baltop", "setmoney", "addmoney", "takemoney", "shop", "sell", "ah", "shopnpc",
  "guide", "tpa", "tpahere", "tpaccept", "tpdeny", "spawn", "setspawn", "home", "sethome", "delhome", "homes", "back"]);
const ALIASES = { tp: "teleport", msg: "tell", w: "tell", bal: "money", balance: "money", auction: "ah", menu: "guide", tpyes: "tpaccept", tpno: "tpdeny", "ban-ip": "banip", "unban-ip": "unbanip", pardon: "unban" };

export function commandPermission(text) {
  let name = String(text).trim().replace(/^\/+/, "").split(/\s+/)[0].toLowerCase();
  name = ALIASES[name] || name;
  if (!/^[a-z0-9_-]{1,40}$/.test(name)) return null;
  if (ENDSTONE_COMMANDS.has(name)) return `endstone.command.${name}`;
  if (PLUGIN_COMMANDS.has(name)) return `galaxylink.command.${name}`;
  return `minecraft.command.${name}`;
}

// ---------- shared ----------
function formatRank(r) {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    color: r.color,
    icon: r.icon || null,
    permissions: r.permissions || [],
    websiteRole: r.website_role ? Number(r.website_role) : null,
    position: r.position,
  };
}

export async function loadRanksState(sql) {
  const [ranks, assigned] = await Promise.all([
    sql`SELECT * FROM ranks ORDER BY position, lower(name)`,
    sql`SELECT xuid, rank_id FROM player_ranks`,
  ]);
  return {
    ranks: ranks.map(formatRank),
    assignments: Object.fromEntries(assigned.map((a) => [a.xuid, a.rank_id])),
  };
}

async function validRank(env, sql, body) {
  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  const prefix = String(body.prefix || "").trim().replace(/§./g, "").replace(/\s+/g, " ");
  const color = String(body.color || "f").toLowerCase();
  if (!/^[A-Za-z0-9 _-]{1,24}$/.test(name)) throw new HttpError(400, "Rank names are 1 to 24 letters, numbers, spaces, - or _.");
  if (prefix.length < 1 || prefix.length > 16) throw new HttpError(400, "Prefixes are 1 to 16 characters.");
  if (/[{}\[\]]/.test(prefix)) throw new HttpError(400, "Prefixes can't contain brackets; they're added automatically.");
  if (color.length !== 1 || !COLORS.includes(color)) throw new HttpError(400, "Choose a color.");
  const words = compileWordList(await sql`SELECT word, match FROM filter_words`);
  for (const text of [name, prefix]) {
    if (!checkMessage(text, words).ok) throw new HttpError(400, `"${text}" isn't allowed.`);
  }
  const commands = Array.isArray(body.commands) ? body.commands : [];
  const badCommand = commands.find((c) => String(c).trim() && !commandPermission(c));
  if (badCommand) throw new HttpError(400, `"${String(badCommand).slice(0, 30)}" isn't a command name.`);
  const perms = [...new Set((Array.isArray(body.permissions) ? body.permissions : []).map((p) => String(p).trim().toLowerCase())
    .concat(commands.map(commandPermission)).filter(Boolean))];
  const icon = body.icon ? String(body.icon) : null;
  if (icon && !ICONS.includes(icon)) throw new HttpError(400, "Unknown icon.");
  if (perms.length > 40 || perms.some((p) => !/^[a-z0-9_.-]{3,60}$/.test(p))) throw new HttpError(400, "One of the permissions isn't valid.");
  const role = body.websiteRole == null || body.websiteRole === "" ? null : Number(body.websiteRole);
  if (role !== null && !ROLE_POWER[role]) throw new HttpError(400, "Unknown website role.");
  return { name, prefix, color, icon, permissions: perms, websiteRole: role };
}

// Gives or removes the website role that comes with a player's rank (if they linked an account).
async function syncWebsiteRole(env, sql, xuid) {
  const rows = await sql`
    SELECT u.id, u.username, u.platform, u.role_id, u.role_from_rank, ur.power AS current_power, rk.website_role
      FROM players p
      JOIN users u ON u.mc_uuid = p.uuid
      JOIN roles ur ON ur.id = u.role_id
      LEFT JOIN player_ranks pr ON pr.xuid = p.xuid
      LEFT JOIN ranks rk ON rk.id = pr.rank_id
     WHERE p.xuid = ${xuid}`;
  const u = rows[0];
  if (!u || isOwner(env, u.username, u.platform === "bedrock")) return;
  let target = null;
  if (u.website_role) {
    // Never lower a role that staff set by hand (e.g. an Admin who also has a VIP rank).
    if (u.role_from_rank || Number(u.current_power) <= ROLE_POWER[u.website_role]) target = Number(u.website_role);
  } else if (u.role_from_rank) {
    target = 1; // rank removed: back to Member
  }
  if (target === null || (target === Number(u.role_id) && (target !== 1) === u.role_from_rank)) return;
  await sql`UPDATE users SET role_id = ${target}, role_from_rank = ${target !== 1} WHERE id = ${u.id}`;
  const r = await sql`SELECT key FROM roles WHERE id = ${target}`;
  await hubBroadcast(env, { type: "member_updated", member: { id: Number(u.id), username: u.username, role: r[0].key }, mutedUntil: null });
  await voiceEvent(env, { type: "role_changed", userId: Number(u.id) });
}

async function audit(sql, actorId, action, details) {
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${actorId}, ${action}, ${JSON.stringify(details)}::jsonb)`;
}

async function changed(env) {
  await voiceEvent(env, { type: "ranks_changed" });
}

// One place for every change, used by both the website and the in-game menu.
async function applyAction(env, sql, action, body, actor) {
  if (action === "create" || action === "update") {
    const r = await validRank(env, sql, body);
    let rank;
    try {
      if (action === "create") {
        [rank] = await sql`
          INSERT INTO ranks (name, prefix, color, icon, permissions, website_role, position)
          VALUES (${r.name}, ${r.prefix}, ${r.color}, ${r.icon}, ${r.permissions}, ${r.websiteRole},
                  (SELECT coalesce(max(position), 0) + 1 FROM ranks))
          RETURNING *`;
      } else {
        [rank] = await sql`
          UPDATE ranks SET name = ${r.name}, prefix = ${r.prefix}, color = ${r.color}, icon = ${r.icon}, permissions = ${r.permissions},
                 website_role = ${r.websiteRole}, updated_at = now()
           WHERE id = ${Number(body.id)} RETURNING *`;
        if (!rank) throw new HttpError(404, "That rank no longer exists.");
      }
    } catch (e) {
      if (String(e.message).includes("ranks_name_idx")) throw new HttpError(409, "A rank with that name already exists.");
      throw e;
    }
    await audit(sql, actor.id, `rank.${action}`, { by: actor.label, rank: r.name, prefix: r.prefix });
    if (action === "update") {
      const holders = await sql`SELECT xuid FROM player_ranks WHERE rank_id = ${rank.id}`;
      for (const h of holders) await syncWebsiteRole(env, sql, h.xuid);
    }
    await changed(env);
    return { rank: formatRank(rank) };
  }
  if (action === "delete") {
    const holders = await sql`SELECT xuid FROM player_ranks WHERE rank_id = ${Number(body.id)}`;
    const [gone] = await sql`DELETE FROM ranks WHERE id = ${Number(body.id)} RETURNING name`;
    if (!gone) throw new HttpError(404, "That rank no longer exists.");
    await audit(sql, actor.id, "rank.delete", { by: actor.label, rank: gone.name });
    for (const h of holders) await syncWebsiteRole(env, sql, h.xuid);
    await changed(env);
    return {};
  }
  if (action === "assign") {
    const xuid = String(body.xuid || "");
    const [player] = await sql`SELECT xuid, gamertag FROM players WHERE xuid = ${xuid}`;
    if (!player) throw new HttpError(404, "That player hasn't joined the server yet.");
    let rankName = null;
    if (body.rankId == null || body.rankId === "") {
      await sql`DELETE FROM player_ranks WHERE xuid = ${xuid}`;
    } else {
      const [rank] = await sql`SELECT id, name FROM ranks WHERE id = ${Number(body.rankId)}`;
      if (!rank) throw new HttpError(404, "That rank no longer exists.");
      rankName = rank.name;
      await sql`
        INSERT INTO player_ranks (xuid, rank_id, assigned_by) VALUES (${xuid}, ${rank.id}, ${actor.label})
        ON CONFLICT (xuid) DO UPDATE SET rank_id = EXCLUDED.rank_id, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`;
    }
    await audit(sql, actor.id, rankName ? "rank.assign" : "rank.remove", { by: actor.label, player: player.gamertag, rank: rankName });
    await syncWebsiteRole(env, sql, xuid);
    await changed(env);
    return {};
  }
  throw new HttpError(400, "Unknown action.");
}

// ---------- website (Admins) ----------
async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (Number(user.role_power) < ADMIN) throw new HttpError(403, "Only Admins can manage ranks.");
  return { id: Number(user.id), label: user.username };
}

export async function listRanks(request, env, ctx, url) {
  await requireAdmin(request, env);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 32);
  const sql = getDb(env);
  const state = await loadRanksState(sql);
  const players = await sql`
    SELECT p.xuid, p.gamertag, p.last_seen, pr.rank_id, u.username AS linked
      FROM players p
      LEFT JOIN player_ranks pr ON pr.xuid = p.xuid
      LEFT JOIN users u ON u.mc_uuid = p.uuid
     WHERE (${q} = '' OR lower(p.gamertag) LIKE '%' || ${q} || '%')
     ORDER BY (pr.rank_id IS NULL), p.last_seen DESC
     LIMIT 200`;
  const counts = {};
  for (const id of Object.values(state.assignments)) counts[id] = (counts[id] || 0) + 1;
  return json({
    ok: true,
    ranks: state.ranks.map((r) => ({ ...r, players: counts[r.id] || 0 })),
    icons: ICONS,
    players: players.map((p) => ({ xuid: p.xuid, gamertag: p.gamertag, lastSeen: p.last_seen, rankId: p.rank_id, linked: Boolean(p.linked) })),
  });
}

export async function websiteAction(request, env, ctx, url, params) {
  const actor = await requireAdmin(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const result = await applyAction(env, sql, params.action, body, actor);
  return json({ ok: true, ...result });
}

// ---------- in game (server operators, through the plugin) ----------
async function checkPlugin(request, env) {
  const header = request.headers.get("Authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!env.PLUGIN_SECRET || !given || !(await safeEqual(given, env.PLUGIN_SECRET))) throw new HttpError(401, "Wrong plugin secret.");
}

export async function pluginAction(request, env) {
  await checkPlugin(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  const by = body.by || {};
  const linked = by.xuid ? await sql`
    SELECT u.id FROM players p JOIN users u ON u.mc_uuid = p.uuid WHERE p.xuid = ${String(by.xuid)}` : [];
  const actor = { id: linked[0] ? Number(linked[0].id) : null, label: `${String(by.name || "Server").slice(0, 32)} (in game)` };
  try {
    const result = await applyAction(env, sql, String(body.action), body, actor);
    return json({ ok: true, message: "Saved.", ...result });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, message: e.message });
    throw e;
  }
}

// Records players the server has seen (sent by the plugin when someone joins).
export async function recordPlayers(env, list) {
  const players = (Array.isArray(list) ? list : [])
    .filter((p) => p && /^\d{1,20}$/.test(String(p.xuid || "")) && p.name)
    .slice(0, 100);
  if (!players.length) return;
  const sql = getDb(env);
  await sql.transaction(players.map((p) => sql`
    INSERT INTO players (xuid, uuid, gamertag) VALUES (${String(p.xuid)}, ${String(p.uuid || "") || null}::uuid, ${String(p.name).slice(0, 32)})
    ON CONFLICT (xuid) DO UPDATE SET gamertag = EXCLUDED.gamertag, uuid = coalesce(EXCLUDED.uuid, players.uuid), last_seen = now()`));
}

// When someone links with /link after already having a rank, give them its website role.
export async function syncRoleForUuid(env, uuid) {
  const sql = getDb(env);
  const rows = await sql`SELECT xuid FROM players WHERE uuid = ${uuid}::uuid`;
  for (const r of rows) await syncWebsiteRole(env, sql, r.xuid);
}
