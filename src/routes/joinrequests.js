// Join requests (How to Join > "Request to join"). No account needed: the person types their Xbox gamertag and
// gets a private chat with the owner, opened with a random token kept in their browser (and a private link).
// Only the owner sees requests (Control Panel > Join requests). Approving adds the gamertag to the server's
// allowlist through the plugin and sends a "You're in" message with the address.
import { getDb } from "../lib/db.js";
import { json, readJson, HttpError } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { limit as rateLimit, clientIp } from "../lib/ratelimit.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { isOwner } from "../lib/names.js";
import { notify } from "./notify.js";
import { voiceStub } from "./voice.js";
import config from "../../public/config.js";

const MAX_MSG = 500;

function token() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// Xbox gamertags: letters, numbers and single spaces, 1-16 characters (newer ones can end in #1234-style digits).
function cleanGamertag(v) {
  const g = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]{0,14}[A-Za-z0-9]$/.test(g) && !/^[A-Za-z0-9]$/.test(g)) return null;
  return g;
}
async function cleanText(sql, raw) {
  const check = checkMessage(String(raw ?? "").slice(0, MAX_MSG), compileWordList(await sql`SELECT word, match FROM filter_words`), { allowLinks: false });
  if (!check.ok) throw new HttpError(400, check.message || "That message isn't allowed.");
  return check.text;
}

async function ownerIds(env, sql) {
  const users = await sql`SELECT id, username, platform FROM users WHERE NOT banned`;
  return users.filter((u) => isOwner(env, u.username, u.platform === "bedrock")).map((u) => Number(u.id));
}
async function tellOwner(env, sql, title, body) {
  const ids = await ownerIds(env, sql);
  if (ids.length) await notify(env, ids, null, { title, body: body.slice(0, 140), url: "/staff#joins", tag: "join-requests" }).catch(() => {});
}

const msgOut = (m) => ({ id: Number(m.id), fromOwner: m.from_owner, body: m.body, at: m.created_at });
async function messagesOf(sql, id) {
  return (await sql`SELECT id, from_owner, body, created_at FROM join_request_messages WHERE request_id = ${id} ORDER BY id`).map(msgOut);
}
async function byToken(sql, t) {
  if (!/^[A-Za-z0-9_-]{24,48}$/.test(String(t || ""))) throw new HttpError(404, "We couldn't find that request.");
  const [r] = await sql`SELECT * FROM join_requests WHERE token = ${t}`;
  if (!r) throw new HttpError(404, "We couldn't find that request.");
  return r;
}

// ---------- the person asking ----------
// POST /api/join-requests { gamertag, message }
export async function createJoinRequest(request, env) {
  await rateLimit(env, "AUTH_LIMITER", `joinreq:${clientIp(request)}`);
  const body = await readJson(request);
  const gamertag = cleanGamertag(body.gamertag);
  if (!gamertag) throw new HttpError(400, "Enter your Xbox gamertag exactly as it shows in Minecraft (letters, numbers and spaces).");
  const sql = getDb(env);
  const text = await cleanText(sql, body.message || `Hi! I'd like to join. My gamertag is ${gamertag}.`);
  const ip = await sha(`${clientIp(request)}:${env.PLUGIN_SECRET || ""}`);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM join_requests WHERE ip_hash = ${ip} AND created_at > now() - interval '1 day'`;
  if (n >= 3) throw new HttpError(429, "You've sent a few requests today. Please wait for an answer to the one you sent.");
  const [open] = await sql`SELECT id FROM join_requests WHERE lower(gamertag) = lower(${gamertag}) AND status = 'open'`;
  if (open) throw new HttpError(409, "There's already a request for this gamertag. Open it from the browser or link you used.");
  const t = token();
  // invited with someone's invite link: remember who, so the owner sees it (they still have to be approved)
  const { inviterFor } = await import("./referrals.js");
  const inviter = body.ref ? await inviterFor(sql, String(body.ref)).catch(() => null) : null;
  const [r] = await sql`INSERT INTO join_requests (token, gamertag, ip_hash, owner_unread, invited_by) VALUES (${t}, ${gamertag}, ${ip}, 1, ${inviter}) RETURNING id`;
  await sql`INSERT INTO join_request_messages (request_id, from_owner, body) VALUES (${r.id}, false, ${text})`;
  const [inv] = inviter ? await sql`SELECT username FROM users WHERE id = ${inviter}` : [];
  await tellOwner(env, sql, `Join request: ${gamertag}${inv ? ` (invited by ${inv.username})` : ""}`, text);
  return json({ ok: true, token: t });
}

// GET /api/join-requests/:token
export async function getJoinRequest(request, env, ctx, url, params) {
  await rateLimit(env, "POLL_LIMITER", `joinreqget:${clientIp(request)}`);
  const sql = getDb(env);
  const r = await byToken(sql, params.token);
  if (r.req_unread) await sql`UPDATE join_requests SET req_unread = 0 WHERE id = ${r.id}`;
  return json({
    ok: true,
    request: { gamertag: r.gamertag, status: r.status, createdAt: r.created_at, decidedAt: r.decided_at },
    messages: await messagesOf(sql, r.id),
  });
}

// POST /api/join-requests/:token/messages { body }
export async function postJoinMessage(request, env, ctx, url, params) {
  await rateLimit(env, "AUTH_LIMITER", `joinreqmsg:${clientIp(request)}`);
  const sql = getDb(env);
  const r = await byToken(sql, params.token);
  if (r.status === "declined") throw new HttpError(409, "This request was closed.");
  const text = await cleanText(sql, (await readJson(request)).body);
  await sql.transaction([
    sql`INSERT INTO join_request_messages (request_id, from_owner, body) VALUES (${r.id}, false, ${text})`,
    sql`UPDATE join_requests SET owner_unread = owner_unread + 1, last_at = now() WHERE id = ${r.id}`,
  ]);
  await tellOwner(env, sql, `${r.gamertag} (join request)`, text);
  return json({ ok: true });
}

// ---------- the owner (Control Panel > Join requests) ----------
async function requireOwner(request, env) {
  const user = await requireUser(request, env);
  if (!isOwner(env, user.username, user.platform === "bedrock")) throw new HttpError(403, "Only the owner can see join requests.");
  return user;
}

// GET /api/panel/join-requests?status=open|approved|declined
export async function listJoinRequests(request, env, ctx, url) {
  await requireOwner(request, env);
  const status = ["open", "approved", "declined"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "open";
  const sql = getDb(env);
  const rows = await sql`
    SELECT r.id, r.gamertag, r.status, r.owner_unread, r.created_at, r.last_at, r.decided_at,
           (SELECT body FROM join_request_messages m WHERE m.request_id = r.id ORDER BY m.id DESC LIMIT 1) AS last_body,
           EXISTS (SELECT 1 FROM players p WHERE lower(p.gamertag) = lower(r.gamertag)) AS played_before,
           (SELECT username FROM users WHERE id = r.invited_by) AS invited_by_name
      FROM join_requests r WHERE r.status = ${status} ORDER BY r.last_at DESC LIMIT 100`;
  // the tab's badge: requests waiting for a decision, plus answered ones with new messages
  const [{ n, attention }] = await sql`SELECT count(*) FILTER (WHERE status = 'open')::int AS n,
                                             count(*) FILTER (WHERE status = 'open' OR owner_unread > 0)::int AS attention FROM join_requests`;
  return json({
    ok: true, open: n, attention,
    requests: rows.map((r) => ({ id: Number(r.id), gamertag: r.gamertag, status: r.status, unread: r.owner_unread, createdAt: r.created_at,
      lastAt: r.last_at, decidedAt: r.decided_at, last: r.last_body, playedBefore: r.played_before, invitedBy: r.invited_by_name || null })),
  });
}

// GET /api/panel/join-requests/:id
export async function getJoinRequestOwner(request, env, ctx, url, params) {
  await requireOwner(request, env);
  const sql = getDb(env);
  const [r] = await sql`UPDATE join_requests SET owner_unread = 0 WHERE id = ${Number(params.id) || 0} RETURNING id, gamertag, status, created_at, decided_at, invited_by`;
  if (!r) throw new HttpError(404, "That request no longer exists.");
  const [inv] = r.invited_by ? await sql`SELECT username FROM users WHERE id = ${r.invited_by}` : [];
  return json({ ok: true, request: { id: Number(r.id), gamertag: r.gamertag, status: r.status, createdAt: r.created_at, decidedAt: r.decided_at, invitedBy: inv?.username || null }, messages: await messagesOf(sql, r.id) });
}

// POST /api/panel/join-requests/:id/messages { body }
export async function ownerJoinMessage(request, env, ctx, url, params) {
  await requireOwner(request, env);
  const sql = getDb(env);
  const body = String((await readJson(request)).body || "").replace(/\r/g, "").trim().slice(0, 1000);
  if (!body) throw new HttpError(400, "Write a message.");
  const [r] = await sql`UPDATE join_requests SET req_unread = req_unread + 1, last_at = now() WHERE id = ${Number(params.id) || 0} RETURNING id`;
  if (!r) throw new HttpError(404, "That request no longer exists.");
  await sql`INSERT INTO join_request_messages (request_id, from_owner, body) VALUES (${r.id}, true, ${body})`;
  return json({ ok: true });
}

// POST /api/panel/join-requests/:id/decide { status: "approved" | "declined", message }
export async function decideJoinRequest(request, env, ctx, url, params) {
  const user = await requireOwner(request, env);
  const b = await readJson(request);
  const status = ["approved", "declined"].includes(b.status) ? b.status : null;
  if (!status) throw new HttpError(400, "Approve or decline the request.");
  const sql = getDb(env);
  const [r] = await sql`SELECT id, gamertag, status FROM join_requests WHERE id = ${Number(params.id) || 0}`;
  if (!r) throw new HttpError(404, "That request no longer exists.");
  if (r.status === status) throw new HttpError(409, `This request is already ${status}.`);
  if (status === "approved") {
    // Add them to the server's allowlist (the plugin runs "allowlist add" on the server).
    const answer = await voiceStub(env).fetch("https://voice/internal/ask", {
      method: "POST", body: JSON.stringify({ type: "allowlist", action: "add", name: r.gamertag, by: user.username }),
    }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!answer.ok) throw new HttpError(409, answer.message || "The Minecraft server isn't connected, so they can't be added right now. Try again when it's online.");
  }
  const address = `${config.bedrockAddress}${config.bedrockPort && Number(config.bedrockPort) !== 19132 ? ` (port ${config.bedrockPort})` : ""}`;
  const note = String(b.message || "").replace(/\r/g, "").trim().slice(0, 1000)
    || (status === "approved" ? `You're in! Open Minecraft, go to Servers > Add Server and enter ${address}. See you there!`
      : "Sorry, we can't add you right now.");
  await sql.transaction([
    sql`UPDATE join_requests SET status = ${status}, decided_at = now(), last_at = now(), req_unread = req_unread + 1 WHERE id = ${r.id}`,
    sql`INSERT INTO join_request_messages (request_id, from_owner, body) VALUES (${r.id}, true, ${note})`,
    sql`INSERT INTO audit_log (actor_id, action, details) VALUES (${user.id}, ${`join_request.${status}`}, ${JSON.stringify({ gamertag: r.gamertag })}::jsonb)`,
  ]);
  return json({ ok: true, message: status === "approved" ? `${r.gamertag} was added to the server.` : "Request declined." });
}
