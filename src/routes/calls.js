// Calls (2.92): private calls between friends, separate from voice chat (src/calls/hub.js). The call bar is on the
// Community page (DMs) and on profiles.
import { getDb } from "../lib/db.js";
import { HttpError, json } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";

export function callsStub(env) {
  return env.CALLS.get(env.CALLS.idFromName("calls"));
}

// GET /api/calls/connect (WebSocket): the call bar connects only when you call, answer or rejoin a call
export async function callsConnect(request, env) {
  if (request.headers.get("Upgrade") !== "websocket") throw new HttpError(426, "Expected a WebSocket.");
  const origin = request.headers.get("Origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) throw new HttpError(403, "Forbidden.");
  if (!env.REALTIME_APP_ID || !env.REALTIME_APP_SECRET) throw new HttpError(503, "Calls aren't set up yet.");
  const user = await requireUser(request, env);
  const [u] = await getDb(env)`SELECT voice_muted_until FROM users WHERE id = ${user.id}`;
  const headers = new Headers(request.headers);
  headers.set("X-GSMP-User", JSON.stringify({
    id: Number(user.id), username: user.username, owner: Boolean(user.owner),
    voiceMutedUntil: u?.voice_muted_until && new Date(u.voice_muted_until) > new Date() ? u.voice_muted_until : null,
  }));
  return callsStub(env).fetch(new Request(request.url, { headers }));
}

// GET /api/calls/state: on page load, are you in a call (rejoin) or is someone calling you?
export async function callState(request, env) {
  const user = await requireUser(request, env);
  const r = await callsStub(env).fetch(`https://calls/internal/state?user=${Number(user.id)}`).then((x) => x.json());
  return json({ ok: true, ...r });
}

// POST /api/calls/decline { id } and POST /api/calls/leave: without opening the call bar
export async function declineCall(request, env) {
  const user = await requireUser(request, env);
  const body = await request.json().catch(() => ({}));
  await callsStub(env).fetch("https://calls/internal/decline", { method: "POST", body: JSON.stringify({ userId: Number(user.id), id: String(body.id || "").slice(0, 16) || null }) });
  return json({ ok: true });
}

export async function leaveCall(request, env) {
  const user = await requireUser(request, env);
  await callsStub(env).fetch("https://calls/internal/leave", { method: "POST", body: JSON.stringify({ userId: Number(user.id) }) });
  return json({ ok: true });
}
