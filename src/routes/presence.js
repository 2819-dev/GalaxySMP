// Rich presence on profile cards (like Discord's "Playing ..."). In order:
//   1. a custom status (Galaxy Pro+ members and the owner; set in Account > Profile)
//   2. playing on GalaxySMP right now (with how long)
//   3. Xbox Live presence from OpenXBL (what they're playing elsewhere, or "Online"), unless they hid it
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { isOwner } from "../lib/names.js";

const XBL_TTL_MS = 4 * 60_000;   // keep an Xbox answer for 4 minutes
const XBL_MAX_PER_5MIN = 40;     // OpenXBL's free plan allows 60 requests per 5 minutes (gamerpics use some too)
export const CUSTOM_ICONS = ["star", "crown", "pickaxe", "castle", "sword", "gem", "music", "moon", "flame", "heart", "megaphone", "tools", "comet", "minigames", "survival", "trophy"];
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const DEVICES = {
  Scarlett: "Xbox Series X|S", XboxOne: "Xbox One", Xbox360: "Xbox 360", Win32: "PC", WindowsOneCore: "PC", PC: "PC",
  iOS: "iPhone or iPad", Android: "Android", Nintendo: "Nintendo Switch", PlayStation: "PlayStation", Web: "the web",
};
const SKIP_TITLES = new Set(["home", "xbox app", "xbox", "online", "xbox dashboard"]);

// The answer from OpenXBL -> { title, details, device, state } or null
export function readXbl(data) {
  const p = Array.isArray(data) ? data[0] : Array.isArray(data?.people) ? data.people[0] : data;
  if (!p) return null;
  const state = String(p.state || "").toLowerCase();
  if (state === "online" || state === "away") {
    for (const d of p.devices || []) {
      const device = DEVICES[d.type] || d.type || null;
      const titles = (d.titles || []).filter((t) => t?.name && !SKIP_TITLES.has(String(t.name).toLowerCase()));
      const t = titles.find((x) => String(x.placement || "").toLowerCase() === "full") || titles[0];
      if (t) return { title: String(t.name).slice(0, 60), details: t.activity?.richPresence ? String(t.activity.richPresence).slice(0, 80) : null, device, online: true, away: state === "away" };
    }
    const d = (p.devices || [])[0];
    return { title: null, device: d ? DEVICES[d.type] || d.type : null, online: true, away: state === "away" };
  }
  if (p.lastSeen?.timestamp) {
    return { online: false, lastSeen: p.lastSeen.timestamp, lastTitle: p.lastSeen.titleName && !SKIP_TITLES.has(String(p.lastSeen.titleName).toLowerCase()) ? String(p.lastSeen.titleName).slice(0, 60) : null };
  }
  return null;
}

async function xblPresence(env, sql, xuid) {
  const [cached] = await sql`SELECT data, fetched_at FROM xbl_presence WHERE xuid = ${xuid}`;
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < XBL_TTL_MS) return cached.data;
  if (!env.XBL_API_KEY) return cached?.data || null;
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM xbl_presence WHERE fetched_at > now() - interval '5 minutes'`;
  if (n >= XBL_MAX_PER_5MIN) return cached?.data || null; // too many lately: show the older answer
  let data = null;
  try {
    const res = await fetch(`https://xbl.io/api/v2/${encodeURIComponent(xuid)}/presence`, {
      headers: { "X-Authorization": env.XBL_API_KEY, Accept: "application/json", "Accept-Language": "en-US" },
    });
    if (res.ok) data = readXbl(await res.json());
    else if (res.status !== 429) console.error("xbl presence", res.status);
  } catch (e) {
    console.error("xbl presence failed", e.message);
  }
  await sql`INSERT INTO xbl_presence (xuid, data, fetched_at) VALUES (${xuid}, ${JSON.stringify(data)}::jsonb, now())
            ON CONFLICT (xuid) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`;
  return data;
}

const liveCustom = (c) => c && c.title && (!c.until || new Date(c.until) > new Date()) ? c : null;

// GET /api/presence/:id -> { activity } for that member's profile card
export async function getPresence(request, env, ctx, url, params) {
  await requireUser(request, env);
  const sql = getDb(env);
  const [u] = await sql`
    SELECT u.id, u.username, u.platform, u.show_activity, u.custom_presence, p.xuid, p.online_at, p.session_start,
           (SELECT s.plan FROM subscriptions s WHERE s.xuid = p.xuid AND (s.expires_at IS NULL OR s.expires_at > now())) AS plan
      FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid WHERE u.id = ${Number(params.id) || 0} AND NOT u.banned`;
  if (!u) throw new HttpError(404, "That member doesn't exist.");

  // only while they have Galaxy Pro+ (it comes back if they renew)
  const custom = u.plan === "pro" || isOwner(env, u.username, u.platform === "bedrock") ? liveCustom(u.custom_presence) : null;
  if (custom) {
    return json({ ok: true, activity: { kind: "custom", label: custom.label || "Status", title: custom.title, details: custom.details || null, state: custom.state || null, icon: custom.icon || "star", since: custom.timer ? custom.since : null } });
  }
  const inGame = u.online_at && Date.now() - new Date(u.online_at).getTime() < 150_000;
  if (inGame) {
    return json({ ok: true, activity: { kind: "server", label: "Playing", title: "Minecraft", details: "On GalaxySMP", state: null, icon: "pickaxe", since: u.session_start || null } });
  }
  if (u.xuid && u.show_activity) {
    const x = await xblPresence(env, sql, u.xuid);
    if (x?.online && x.title) {
      return json({ ok: true, activity: { kind: "xbox", label: "Playing", title: x.title, details: x.details || null, state: x.device ? `on ${x.device}` : null, icon: /minecraft/i.test(x.title) ? "pickaxe" : "minigames" } });
    }
    if (x?.online) {
      return json({ ok: true, activity: { kind: "xbox", label: x.away ? "Away" : "Online", title: "Xbox Live", details: x.device ? `on ${x.device}` : null, state: null, icon: "users" } });
    }
    if (x?.lastSeen) {
      return json({ ok: true, activity: { kind: "xbox-offline", label: "Last seen", title: x.lastTitle || "Xbox Live", details: null, state: null, icon: "clock", lastSeen: x.lastSeen } });
    }
  }
  return json({ ok: true, activity: null });
}

// ---------- your own custom status: a Galaxy Pro+ perk (and the owner) ----------
export async function canCustomStatus(env, sql, user) {
  if (isOwner(env, user.username, user.platform === "bedrock")) return true;
  const [r] = await sql`SELECT s.plan FROM users u JOIN players p ON p.uuid = u.mc_uuid
                          JOIN subscriptions s ON s.xuid = p.xuid AND (s.expires_at IS NULL OR s.expires_at > now())
                         WHERE u.id = ${user.id}`;
  return r?.plan === "pro";
}

async function requireOwner(request, env) {
  const user = await requireUser(request, env);
  if (!(await canCustomStatus(env, getDb(env), user))) throw new HttpError(403, "A custom status is a Galaxy Pro+ perk.");
  return user;
}

export async function getMyPresence(request, env) {
  const user = await requireOwner(request, env);
  const [u] = await getDb(env)`SELECT custom_presence FROM users WHERE id = ${user.id}`;
  return json({ ok: true, presence: u?.custom_presence || null, live: Boolean(liveCustom(u?.custom_presence)), icons: CUSTOM_ICONS });
}

// POST /api/panel/presence { title, details, state, label, icon, timer, hours } ; { clear: true } removes it
export async function setMyPresence(request, env) {
  const user = await requireOwner(request, env);
  const body = await readJson(request);
  const sql = getDb(env);
  if (body.clear) {
    await sql`UPDATE users SET custom_presence = NULL WHERE id = ${user.id}`;
    return json({ ok: true, presence: null });
  }
  const title = clean(body.title, 40);
  if (!title) throw new HttpError(400, "Type what you're doing.");
  const hours = Number(body.hours || 0);
  const presence = {
    label: ["Playing", "Building", "Watching", "Listening to", "Working on", "Status"].includes(body.label) ? body.label : "Status",
    title, details: clean(body.details, 60) || null, state: clean(body.state, 60) || null,
    icon: CUSTOM_ICONS.includes(body.icon) ? body.icon : "star",
    timer: Boolean(body.timer), since: new Date().toISOString(),
    until: hours > 0 && hours <= 24 * 30 ? new Date(Date.now() + hours * 3600_000).toISOString() : null,
  };
  await sql`UPDATE users SET custom_presence = ${JSON.stringify(presence)}::jsonb WHERE id = ${user.id}`;
  return json({ ok: true, presence });
}

// POST /api/account/activity { show } : Account > Privacy
export async function setShowActivity(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  await getDb(env)`UPDATE users SET show_activity = ${Boolean(body.show)} WHERE id = ${user.id}`;
  return json({ ok: true, show: Boolean(body.show) });
}
