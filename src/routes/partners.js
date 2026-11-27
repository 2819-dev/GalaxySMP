// Partners (/partner page): applications to partner with GalaxySMP or to run a Network Server.
// Like join requests: no account needed, the applicant gets a private chat opened with a random token kept in their
// browser (and a private link). In that chat everything the owner writes is labeled just "Staff". Only the owner sees
// applications (Control Panel > Join requests > Partners).
//
// A Network Server is a server someone fully owns that joins the Northwork Games Network. Once an application is
// accepted, the owner sets up the server here: it gets its own token (stored only as a hash, shown once, can be
// reset or paused), so the plugin secret is never shared. The partner plugin calls /api/partner/sync every minute with
// that token: it sends the gamertags online, and gets back their GalaxySMP ranks and who on GalaxySMP's admin team
// should be an operator on that server. Nothing else leaves the partner's server (no chat, items or locations).
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { limit as rateLimit, clientIp } from "../lib/ratelimit.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { isOwner } from "../lib/names.js";
import { notify } from "./notify.js";
import { displayRank, loadPlanPriority } from "./ranks.js";
import { rankOf } from "../chat/messages.js";
import PLANS from "../../endstone-plugin/src/endstone_galaxylink/plans.json";
import config from "../../public/config.js";

const MAX_MSG = 500;
const KINDS = { partner: "Partner", network: "Network Server" };
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _'&.!+-]{0,38}[\p{L}\p{N}!.]$/u;
const ONLINE_SECONDS = 180;

function token(prefix = "", bytes = 24) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return prefix + btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

async function cleanText(sql, raw, max = MAX_MSG) {
  const check = checkMessage(String(raw ?? "").slice(0, max), compileWordList(await sql`SELECT word, match FROM filter_words WHERE NOT EXISTS (SELECT 1 FROM economy_config WHERE key = 'chatfilter_off')`), { allowLinks: false });
  if (!check.ok) throw new HttpError(400, check.message || "That isn't allowed. Please reword it.");
  return check.text;
}
async function ownerIds(env, sql) {
  const users = await sql`SELECT id, username, platform FROM users WHERE NOT banned`;
  return users.filter((u) => isOwner(env, u.username, u.platform === "bedrock")).map((u) => Number(u.id));
}
async function tellOwner(env, sql, title, body) {
  const ids = await ownerIds(env, sql);
  if (ids.length) await notify(env, ids, null, { title, body: String(body).slice(0, 140), url: "/staff#joins", tag: "partner-requests" }).catch(() => {});
}
async function requireOwner(request, env) {
  const user = await requireUser(request, env);
  if (!isOwner(env, user.username, user.platform === "bedrock")) throw new HttpError(403, "Only the owner can see partner applications.");
  return user;
}

const msgOut = (m) => ({ id: Number(m.id), fromOwner: m.from_owner, body: m.body, at: m.created_at });
async function messagesOf(sql, id) {
  return (await sql`SELECT id, from_owner, body, created_at FROM partner_request_messages WHERE request_id = ${id} ORDER BY id`).map(msgOut);
}
async function byToken(sql, t) {
  if (!/^[A-Za-z0-9_-]{24,48}$/.test(String(t || ""))) throw new HttpError(404, "We couldn't find that application.");
  const [r] = await sql`SELECT * FROM partner_requests WHERE token = ${t}`;
  if (!r) throw new HttpError(404, "We couldn't find that application.");
  return r;
}

// ---------- the person applying ----------
// POST /api/partner-requests { kind, name, contact, about, link, message }
export async function createRequest(request, env) {
  await rateLimit(env, "AUTH_LIMITER", `partnerreq:${clientIp(request)}`);
  const b = await readJson(request);
  const kind = KINDS[b.kind] ? b.kind : null;
  if (!kind) throw new HttpError(400, "Choose Partner or Network Server.");
  const name = clip(b.name, 40);
  if (!NAME_RE.test(name)) throw new HttpError(400, "Enter your server or community's name (2 to 40 letters, numbers and spaces).");
  const contact = clip(b.contact, 40);
  if (!NAME_RE.test(contact)) throw new HttpError(400, "Enter the name we should call you (2 to 40 letters, numbers and spaces).");
  const link = clip(b.link, 200);
  if (link && !/^https:\/\/[^\s"'<>]{4,190}$/.test(link)) throw new HttpError(400, "The link has to start with https:// (your website or Discord invite), or leave it empty.");
  const sql = getDb(env);
  const about = clip(await cleanText(sql, clip(b.about, 400), 400), 400);
  if (about.length < 10) throw new HttpError(400, "Tell us a little about your server (at least a sentence), so we know what to make your logo about.");
  const extraRaw = clip(b.message, MAX_MSG);   // optional: only checked when they wrote something
  const extra = extraRaw ? clip(await cleanText(sql, extraRaw), MAX_MSG) : "";
  const ip = await sha(`${clientIp(request)}:${env.PLUGIN_SECRET || ""}`);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM partner_requests WHERE ip_hash = ${ip} AND created_at > now() - interval '1 day'`;
  if (n >= 3) throw new HttpError(429, "You've sent a few applications today. Please wait for an answer to the one you sent.");
  const [open] = await sql`SELECT id FROM partner_requests WHERE lower(name) = lower(${name}) AND status = 'open'`;
  if (open) throw new HttpError(409, "There's already an application for this name. Open it from the browser or link you used.");
  const t = token();
  const [r] = await sql`INSERT INTO partner_requests (token, kind, name, contact, about, link, ip_hash, owner_unread)
                        VALUES (${t}, ${kind}, ${name}, ${contact}, ${about}, ${link || null}, ${ip}, 1) RETURNING id`;
  const first = [`${KINDS[kind]} application`, `Server: ${name}`, `From: ${contact}`, `About: ${about}`, link ? `Link: ${link}` : null, extra ? `\n${extra}` : null].filter(Boolean).join("\n");
  await sql`INSERT INTO partner_request_messages (request_id, from_owner, body) VALUES (${r.id}, false, ${first})`;
  await tellOwner(env, sql, `${KINDS[kind]} application: ${name}`, about);
  return json({ ok: true, token: t });
}

// GET /api/partner-requests/:token
export async function getRequest(request, env, ctx, url, params) {
  await rateLimit(env, "POLL_LIMITER", `partnerget:${clientIp(request)}`);
  const sql = getDb(env);
  const r = await byToken(sql, params.token);
  if (r.req_unread) await sql`UPDATE partner_requests SET req_unread = 0 WHERE id = ${r.id}`;
  return json({
    ok: true,
    request: { kind: r.kind, kindName: KINDS[r.kind], name: r.name, status: r.status, createdAt: r.created_at, decidedAt: r.decided_at },
    messages: await messagesOf(sql, r.id),   // from_owner messages are shown as "Staff" by the page: nobody's name is ever sent
  });
}

// POST /api/partner-requests/:token/messages { body }
export async function postMessage(request, env, ctx, url, params) {
  await rateLimit(env, "AUTH_LIMITER", `partnermsg:${clientIp(request)}`);
  const sql = getDb(env);
  const r = await byToken(sql, params.token);
  if (r.status === "declined") throw new HttpError(409, "This application was closed.");
  const text = await cleanText(sql, (await readJson(request)).body);
  if (!text.trim()) throw new HttpError(400, "Write a message.");
  await sql.transaction([
    sql`INSERT INTO partner_request_messages (request_id, from_owner, body) VALUES (${r.id}, false, ${text})`,
    sql`UPDATE partner_requests SET owner_unread = owner_unread + 1, last_at = now() WHERE id = ${r.id}`,
  ]);
  await tellOwner(env, sql, `${r.name} (${KINDS[r.kind].toLowerCase()} application)`, text);
  return json({ ok: true });
}

// ---------- the owner (Control Panel > Join requests > Partners) ----------
const requestOut = (r) => ({ id: Number(r.id), kind: r.kind, kindName: KINDS[r.kind], name: r.name, contact: r.contact, about: r.about, link: r.link || null,
  status: r.status, createdAt: r.created_at, decidedAt: r.decided_at });

// GET /api/panel/partner-requests?status=open|accepted|declined
export async function listRequests(request, env, ctx, url) {
  await requireOwner(request, env);
  const status = ["open", "accepted", "declined"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "open";
  const sql = getDb(env);
  const rows = await sql`
    SELECT r.*, (SELECT body FROM partner_request_messages m WHERE m.request_id = r.id ORDER BY m.id DESC LIMIT 1) AS last_body,
           (SELECT count(*)::int FROM partner_servers s WHERE s.request_id = r.id) AS servers
      FROM partner_requests r WHERE r.status = ${status} ORDER BY r.last_at DESC LIMIT 100`;
  const [{ attention }] = await sql`SELECT count(*) FILTER (WHERE status = 'open' OR owner_unread > 0)::int AS attention FROM partner_requests`;
  return json({ ok: true, attention, requests: rows.map((r) => ({ ...requestOut(r), unread: r.owner_unread, lastAt: r.last_at, last: r.last_body, servers: r.servers })) });
}

// GET /api/panel/partner-requests/:id
export async function getRequestOwner(request, env, ctx, url, params) {
  await requireOwner(request, env);
  const sql = getDb(env);
  const [r] = await sql`UPDATE partner_requests SET owner_unread = 0 WHERE id = ${Number(params.id) || 0} RETURNING *`;
  if (!r) throw new HttpError(404, "That application no longer exists.");
  const servers = await sql`SELECT id, name FROM partner_servers WHERE request_id = ${r.id} ORDER BY id`;
  return json({ ok: true, request: { ...requestOut(r), servers: servers.map((s) => ({ id: Number(s.id), name: s.name })) }, messages: await messagesOf(sql, r.id) });
}

// POST /api/panel/partner-requests/:id/messages { body }  (the applicant sees it as "Staff")
export async function ownerMessage(request, env, ctx, url, params) {
  await requireOwner(request, env);
  const sql = getDb(env);
  const body = String((await readJson(request)).body || "").replace(/\r/g, "").trim().slice(0, 1000);
  if (!body) throw new HttpError(400, "Write a message.");
  const [r] = await sql`UPDATE partner_requests SET req_unread = req_unread + 1, last_at = now() WHERE id = ${Number(params.id) || 0} RETURNING id`;
  if (!r) throw new HttpError(404, "That application no longer exists.");
  await sql`INSERT INTO partner_request_messages (request_id, from_owner, body) VALUES (${r.id}, true, ${body})`;
  return json({ ok: true });
}

// POST /api/panel/partner-requests/:id/decide { status: "accepted" | "declined", message }
export async function decide(request, env, ctx, url, params) {
  const user = await requireOwner(request, env);
  const b = await readJson(request);
  const status = ["accepted", "declined"].includes(b.status) ? b.status : null;
  if (!status) throw new HttpError(400, "Accept or decline the application.");
  const sql = getDb(env);
  const [r] = await sql`SELECT id, name, kind, status FROM partner_requests WHERE id = ${Number(params.id) || 0}`;
  if (!r) throw new HttpError(404, "That application no longer exists.");
  if (r.status === status) throw new HttpError(409, `This application is already ${status}.`);
  const note = String(b.message || "").replace(/\r/g, "").trim().slice(0, 1000)
    || (status === "accepted"
      ? (r.kind === "network" ? "Welcome to the network! We'll send your setup details (the plugin, your logo and your setup file) in this chat shortly." : "Welcome aboard! We'll be in touch here to get the partnership going.")
      : "Thank you for your interest. We aren't able to partner right now.");
  await sql.transaction([
    sql`UPDATE partner_requests SET status = ${status}, decided_at = now(), last_at = now(), req_unread = req_unread + 1 WHERE id = ${r.id}`,
    sql`INSERT INTO partner_request_messages (request_id, from_owner, body) VALUES (${r.id}, true, ${note})`,
    sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, ${`partner_request.${status}`}, ${JSON.stringify({ name: r.name, kind: r.kind })}::jsonb)`,
  ]);
  return json({ ok: true, message: status === "accepted" ? `${r.name} was accepted.` : "Application declined." });
}

// ---------- network servers (the owner) ----------
const serverOut = (s) => ({
  id: Number(s.id), name: s.name, requestId: s.request_id ? Number(s.request_id) : null, active: s.active, opsEnabled: s.ops_enabled,
  hint: s.token_hint, createdAt: s.created_at, lastSeen: s.last_seen_at, players: s.players_online, version: s.plugin_version || null,
  online: Boolean(s.last_seen_at) && Date.now() - new Date(s.last_seen_at).getTime() < ONLINE_SECONDS * 1000,
});
const setupFile = (tok) => JSON.stringify({ token: tok, website: config.website || "https://galaxymc.us" }, null, 2) + "\n";

// GET /api/panel/partner-servers
export async function listServers(request, env) {
  await requireOwner(request, env);
  const rows = await getDb(env)`SELECT * FROM partner_servers ORDER BY id DESC`;
  return json({ ok: true, servers: rows.map(serverOut) });
}

// POST /api/panel/partner-servers { name, requestId }: sets up a Network Server. The token is shown once.
export async function createServer(request, env) {
  const user = await requireOwner(request, env);
  const b = await readJson(request);
  const name = clip(b.name, 40);
  if (!NAME_RE.test(name)) throw new HttpError(400, "Enter the server's name (2 to 40 letters, numbers and spaces).");
  const sql = getDb(env);
  let requestId = null;
  if (b.requestId) {
    const [r] = await sql`SELECT id, kind, status FROM partner_requests WHERE id = ${Number(b.requestId) || 0}`;
    if (!r) throw new HttpError(404, "That application no longer exists.");
    if (r.kind !== "network" || r.status !== "accepted") throw new HttpError(409, "Accept a Network Server application first.");
    requestId = r.id;
  }
  const tok = token("gp_", 32);
  const [s] = await sql`INSERT INTO partner_servers (request_id, name, token_hash, token_hint) VALUES (${requestId}, ${name}, ${await sha(tok)}, ${tok.slice(-4)}) RETURNING *`;
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'partner_server.create', ${JSON.stringify({ name })}::jsonb)`;
  return json({ ok: true, server: serverOut(s), token: tok, setup: setupFile(tok) });
}

// POST /api/panel/partner-servers/:id/reset: a new token (the old one stops working right away)
export async function resetServer(request, env, ctx, url, params) {
  const user = await requireOwner(request, env);
  const sql = getDb(env);
  const tok = token("gp_", 32);
  const [s] = await sql`UPDATE partner_servers SET token_hash = ${await sha(tok)}, token_hint = ${tok.slice(-4)} WHERE id = ${Number(params.id) || 0} RETURNING *`;
  if (!s) throw new HttpError(404, "That server no longer exists.");
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'partner_server.reset', ${JSON.stringify({ name: s.name })}::jsonb)`;
  return json({ ok: true, server: serverOut(s), token: tok, setup: setupFile(tok) });
}

// POST /api/panel/partner-servers/:id { active, opsEnabled }
export async function updateServer(request, env, ctx, url, params) {
  const user = await requireOwner(request, env);
  const b = await readJson(request);
  const sql = getDb(env);
  const [s] = await sql`UPDATE partner_servers SET active = coalesce(${typeof b.active === "boolean" ? b.active : null}, active),
                               ops_enabled = coalesce(${typeof b.opsEnabled === "boolean" ? b.opsEnabled : null}, ops_enabled)
                         WHERE id = ${Number(params.id) || 0} RETURNING *`;
  if (!s) throw new HttpError(404, "That server no longer exists.");
  await sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, 'partner_server.update', ${JSON.stringify({ name: s.name, active: s.active, opsEnabled: s.ops_enabled })}::jsonb)`;
  return json({ ok: true, server: serverOut(s) });
}

// ---------- the partner plugin (token, not a login) ----------
async function serverFromToken(request, sql) {
  const m = /^Bearer (gp_[A-Za-z0-9_-]{30,64})$/.exec(request.headers.get("Authorization") || "");
  if (!m) throw new HttpError(401, "Missing server token.");
  const [s] = await sql`SELECT * FROM partner_servers WHERE token_hash = ${await sha(m[1])}`;
  if (!s || !s.active) throw new HttpError(401, "This server isn't connected to the network (ask GalaxySMP for a new setup file).");
  return s;
}

// GalaxySMP's admin team: players whose rank has Admin Panel access, and the owners (through their linked accounts).
export async function adminTeamXuids(env, sql) {
  const rows = await sql`SELECT DISTINCT p.xuid FROM players p JOIN player_ranks pr ON pr.xuid = p.xuid JOIN ranks r ON r.id = pr.rank_id WHERE 'admin_panel' = ANY(r.web_perms)`;
  const out = new Set(rows.map((r) => r.xuid));
  const names = String(env.OWNER_USERNAMES || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (names.length) {
    const linked = await sql`SELECT p.xuid, u.username, u.platform FROM players p JOIN users u ON u.mc_uuid = p.uuid
                              WHERE NOT u.banned AND lower(regexp_replace(u.username, '^[^A-Za-z0-9_]+', '')) = ANY(${names.map((n) => n.replace(/^[^A-Za-z0-9_]+/, "").replace(/ /g, "_").toLowerCase())})`;
    for (const u of linked) if (isOwner(env, u.username, u.platform === "bedrock")) out.add(u.xuid);
  }
  return [...out];
}

// POST /api/partner/sync { version, players: [{ xuid, name }] } -> { server, tags: { xuid: { name, prefix, color } }, operators: [xuid] }
export async function sync(request, env) {
  const sql = getDb(env);
  const s = await serverFromToken(request, sql);
  await rateLimit(env, "POLL_LIMITER", `partnersync:${s.id}`);
  const b = await readJson(request, 32_000);
  const xuids = [...new Set((Array.isArray(b.players) ? b.players : []).map((p) => String(p?.xuid ?? "")).filter((x) => /^\d{1,20}$/.test(x)))].slice(0, 300);
  const rows = xuids.length ? await sql`
    SELECT p.xuid, rk.name AS rank_name, rk.prefix AS rank_prefix, rk.color AS rank_color, rk.icon AS rank_icon, rk.gradient AS rank_gradient,
           rk.position AS rank_position, rk.priority AS rank_priority, sub.plan
      FROM players p
      LEFT JOIN player_top_rank pr ON pr.xuid = p.xuid LEFT JOIN ranks rk ON rk.id = pr.rank_id
      LEFT JOIN LATERAL (SELECT plan FROM subscriptions WHERE xuid = p.xuid AND (expires_at IS NULL OR expires_at > now()) ORDER BY expires_at DESC NULLS FIRST LIMIT 1) sub ON true
     WHERE p.xuid = ANY(${xuids})` : [];
  const planPriority = await loadPlanPriority(sql);
  const tags = {};
  for (const r of rows) {
    const rank = displayRank(rankOf(r), r.plan, planPriority, PLANS);
    if (rank?.prefix) tags[r.xuid] = { name: rank.name, prefix: String(rank.prefix).slice(0, 16), color: /^[0-9a-f]$/.test(String(rank.color)) ? rank.color : "f" };
  }
  const operators = s.ops_enabled ? await adminTeamXuids(env, sql) : [];
  await sql`UPDATE partner_servers SET last_seen_at = now(), players_online = ${xuids.length}, plugin_version = ${clip(b.version, 20) || null} WHERE id = ${s.id}`;
  return json({ ok: true, server: { name: s.name, opsEnabled: s.ops_enabled }, tags, operators }, 200, { "Cache-Control": "no-store" });
}
