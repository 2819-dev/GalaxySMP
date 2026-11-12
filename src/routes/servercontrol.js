// Control Panel > Server control (owner only): maintenance mode with a website banner, a one-time scheduled
// restart (countdown in game, then the server stops), and the welcome kit for brand-new players.
// Saved in economy_config and sent to the plugin (also every time it connects).
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { isOwner } from "../lib/names.js";
import { toPlugin } from "./economy.js";

export const DEFAULT_KIT = {
  enabled: true, money: 25000, message: "Welcome to GalaxySMP! Here's a starter kit to get you going.",
  items: [{ id: "minecraft:stone_sword", count: 1 }, { id: "minecraft:stone_pickaxe", count: 1 }, { id: "minecraft:stone_axe", count: 1 },
    { id: "minecraft:bread", count: 16 }, { id: "minecraft:red_bed", count: 1 }],
};
const DEFAULT_BANNER = "GalaxySMP is down for maintenance. We'll be back soon!";

async function getKey(sql, key) {
  const [r] = await sql`SELECT value FROM economy_config WHERE key = ${key}`;
  return r ? r.value : null;
}
async function setKey(sql, key, value, by) {
  await sql`INSERT INTO economy_config (key, value, updated_by) VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${by})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
}

export async function loadServerControl(sql) {
  const [maintenance, restart, kit] = await Promise.all([getKey(sql, "maintenance"), getKey(sql, "restart_plan"), getKey(sql, "welcome_kit")]);
  const r = restart && restart.at && restart.at * 1000 > Date.now() - 120e3 ? restart : null;
  return {
    maintenance: { on: Boolean(maintenance?.on), message: maintenance?.message || DEFAULT_BANNER, since: maintenance?.since || null },
    restart: r,
    kit: kit || DEFAULT_KIT,
  };
}

// What the plugin needs, including the owner's Minecraft account (the only one allowed in during maintenance).
export async function pluginMessage(env, sql) {
  const state = await loadServerControl(sql);
  const users = await sql`SELECT u.username, u.platform, p.xuid FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE NOT u.banned`;
  const owners = users.filter((u) => isOwner(env, u.username, u.platform === "bedrock")).map((u) => u.xuid);
  return { type: "server_control", owners, maintenance: state.maintenance, restart: state.restart, kit: state.kit };
}

// GET /api/site-notice (public): the banner shown on every page.
export async function siteNotice(request, env) {
  const s = await loadServerControl(getDb(env));
  const soon = s.restart && s.restart.at * 1000 - Date.now() < 24 * 3600e3 && s.restart.at * 1000 > Date.now() ? s.restart : null;
  return json({
    ok: true,
    maintenance: s.maintenance.on ? { message: s.maintenance.message } : null,
    restart: soon ? { at: new Date(soon.at * 1000).toISOString(), reason: soon.reason || "" } : null,
  }, 200, { "Cache-Control": "public, max-age=20" });
}

async function requireOwner(request, env) {
  const user = await requireUser(request, env);
  if (!isOwner(env, user.username, user.platform === "bedrock")) throw new HttpError(403, "Only the owner can use server controls.");
  return user;
}

// GET /api/panel/server-control
export async function getServerControl(request, env) {
  await requireOwner(request, env);
  const sql = getDb(env);
  const s = await loadServerControl(sql);
  const [owner] = (await pluginMessage(env, sql)).owners;
  return json({ ok: true, ...s, restart: s.restart && s.restart.at * 1000 > Date.now() ? { at: new Date(s.restart.at * 1000).toISOString(), reason: s.restart.reason || "" } : null, ownerLinked: Boolean(owner) });
}

const cleanText = (v, max) => String(v ?? "").replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f]/g, "").trim().slice(0, max);

// POST /api/panel/server-control { action: "maintenance" | "restart" | "cancel-restart" | "kit", ... }
export async function saveServerControl(request, env) {
  const user = await requireOwner(request, env);
  const sql = getDb(env);
  const b = await readJson(request);
  let message;
  if (b.action === "maintenance") {
    const on = Boolean(b.on);
    const cur = await loadServerControl(sql);
    const text = cleanText(b.message, 300) || cur.maintenance.message || DEFAULT_BANNER;  // keep the last message
    if (on) {
      const [owner] = (await pluginMessage(env, sql)).owners;
      if (!owner) throw new HttpError(409, "Link your Minecraft account first (Account > Link), or you'd be locked out of the server too.");
    }
    await setKey(sql, "maintenance", { on, message: text, since: on ? cur.maintenance.since || new Date().toISOString() : null }, user.username);
    message = on ? "Maintenance mode is on. Only you can join the server, and the website shows your message." : "Maintenance mode is off. Everyone can join again.";
  } else if (b.action === "restart") {
    const at = Math.floor(new Date(b.at).getTime() / 1000);
    if (!Number.isFinite(at)) throw new HttpError(400, "Pick a date and time.");
    if (at * 1000 < Date.now() + 60e3) throw new HttpError(400, "Pick a time at least 1 minute from now.");
    if (at * 1000 > Date.now() + 14 * 864e5) throw new HttpError(400, "Pick a time within the next 2 weeks.");
    await setKey(sql, "restart_plan", { at, reason: cleanText(b.reason, 120) }, user.username);
    message = "Restart scheduled. Players get warnings before it happens.";
  } else if (b.action === "cancel-restart") {
    await setKey(sql, "restart_plan", null, user.username);
    message = "Scheduled restart cancelled.";
  } else if (b.action === "kit") {
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 12).map((it) => ({
      id: String(it.id || "").trim().toLowerCase().replace(/\s+/g, "_").replace(/^(?!minecraft:)/, "minecraft:"),
      count: Math.max(1, Math.min(640, Math.floor(Number(it.count) || 1))),
    })).filter((it) => /^minecraft:[a-z0-9_]{2,60}$/.test(it.id));
    const money = Math.max(0, Math.min(100_000_000, Math.round(Number(b.money) * 100) || 0));
    await setKey(sql, "welcome_kit", { enabled: Boolean(b.enabled), money, message: cleanText(b.message, 200) || DEFAULT_KIT.message, items }, user.username);
    message = "Welcome kit saved.";
  } else {
    throw new HttpError(400, "Unknown action.");
  }
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, ${`server_control.${b.action}`}, ${JSON.stringify({ by: user.username })}::jsonb)`;
  const sent = await toPlugin(env, await pluginMessage(env, sql));
  return json({ ok: true, sent, message: sent ? message : `${message} The Minecraft server isn't connected right now; it gets this as soon as it connects.` });
}
