// CallHub: private calls between friends (2.92), separate from voice chat.
//
// A call is like a phone call: one person calls a friend (the owner can call anyone) and anyone in the call can add
// more friends, up to CALL_MAX people. Only the people in a call hear each other. The call bar lives on the website's
// Community page (DMs) and on profiles; players can also call, answer and hang up in game with /call (they talk from
// the website on their phone or computer). Audio goes through Cloudflare Realtime like voice chat (nobody sees anyone's
// internet address); this object only decides who is in which call. Each call leaves a line in the DM conversation:
// "Call · 12 min", "Missed call" or "Declined".
import { DurableObject } from "cloudflare:workers";
import { flooding, closeFlooder } from "../lib/flood.js";
import { getDb } from "../lib/db.js";
import { isOwner } from "../lib/names.js";
import { hubStub } from "../routes/chat.js";
import { notify } from "../routes/notify.js";
import { voiceStub } from "../routes/voice.js";

export const CALL_MAX = 4;
const RING_MS = 30_000;          // nobody answers in 30 seconds: a missed call
const GONE_MS = 45_000;          // someone's call bar has been closed this long (page closed): they've left the call
const WAIT_MS = 3 * 60_000;      // someone who answered (or called) in game has 3 minutes to open the website
const RTC_BASE = "https://rtc.live.cloudflare.com/v1/apps";

const minutes = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 1 ? "less than a minute" : `${m} min`;
};

export class CallHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      this.calls = (await ctx.storage.get("calls")) || {};
    });
  }

  // ---------- helpers ----------
  send(ws, data) {
    try { ws.send(JSON.stringify(data)); } catch { /* gone */ }
  }

  update(ws, patch) {
    const a = { ...ws.deserializeAttachment(), ...patch };
    ws.serializeAttachment(a);
    return a;
  }

  socketsOf(userId) {
    return this.ctx.getWebSockets(`user:${Number(userId)}`).filter((ws) => !ws.deserializeAttachment()?.gone);
  }

  connected(userId) {
    return this.socketsOf(userId).length > 0;
  }

  // talking in the call right now (their audio is connected)
  live(userId) {
    return this.socketsOf(userId).some((ws) => ws.deserializeAttachment()?.trackName);
  }

  async saveCalls() {
    await this.ctx.storage.put("calls", this.calls);
  }

  async wakeAt(at) {
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || at < cur) await this.ctx.storage.setAlarm(at);
  }

  // a message for the Minecraft server (through the voice hub, which the plugin is connected to)
  async game(msg) {
    try {
      await voiceStub(this.env).fetch("https://voice/internal/plugin", { method: "POST", body: JSON.stringify(msg) });
    } catch { /* server offline */ }
  }

  async rtc(method, path, body) {
    const res = await fetch(`${RTC_BASE}/${this.env.REALTIME_APP_ID}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.env.REALTIME_APP_SECRET}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.errorCode) throw new Error(data.errorDescription || `call relay error ${res.status}`);
    return data;
  }

  callOf(userId) {
    return Object.values(this.calls).find((c) => c.people[Number(userId)]?.state === "in") || null;
  }

  publicCall(c) {
    return {
      id: c.id, startedAt: c.startedAt, max: CALL_MAX,
      people: Object.values(c.people).filter((p) => p.state === "in" || p.state === "ringing").map((p) => {
        const a = this.socketsOf(p.id)[0]?.deserializeAttachment();
        return { id: p.id, username: p.username, state: p.state, live: Boolean(a?.trackName), mic: a ? a.mic !== false : true, talking: Boolean(a?.talking) };
      }),
    };
  }

  sendCall(c) {
    const data = { type: "call", call: this.publicCall(c) };
    for (const p of Object.values(c.people)) if (p.state === "in") for (const ws of this.socketsOf(p.id)) this.send(ws, data);
  }

  // a short line for the people in the call: on the website and in game chat
  callNote(c, text, gameText, skipId) {
    for (const p of Object.values(c.people)) {
      if (p.state !== "in" || p.id === skipId) continue;
      for (const ws of this.socketsOf(p.id)) this.send(ws, { type: "call.note", text });
      if (p.xuid) this.ctx.waitUntil(this.game({ type: "call_note", toXuid: p.xuid, text: gameText || `§7📞 ${text}` }));
    }
  }

  // a member by id, name or Xbox id: { id, username, xuid, owner }
  async person(sql, q) {
    let rows = [];
    if (q.xuid) {
      rows = await sql`SELECT u.id, u.username, u.platform, p.xuid FROM users u JOIN players p ON p.uuid = u.mc_uuid
                        WHERE p.xuid = ${String(q.xuid)} AND NOT u.banned LIMIT 1`;
    } else if (q.id) {
      rows = await sql`SELECT u.id, u.username, u.platform, p.xuid FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
                        WHERE u.id = ${Number(q.id)} AND NOT u.banned AND NOT coalesce(u.is_bot, false)`;
    } else {
      const name = String(q.name || "").trim().replace(/^@/, "").toLowerCase().slice(0, 32);
      if (!name) return null;
      rows = await sql`SELECT u.id, u.username, u.platform, p.xuid FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
                        WHERE NOT u.banned AND NOT coalesce(u.is_bot, false) AND (lower(u.username) = ${name} OR lower(p.gamertag) = ${name}) LIMIT 1`;
      if (!rows.length) {
        rows = await sql`SELECT u.id, u.username, u.platform, p.xuid FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
                          WHERE NOT u.banned AND NOT coalesce(u.is_bot, false)
                            AND lower(u.username) LIKE ${name.replace(/[\\%_]/g, (ch) => "\\" + ch) + "%"} LIMIT 2`;
        if (rows.length > 1) throw new Error(`More than one member's name starts with "${q.name}". Type their full name.`);
      }
    }
    const r = rows[0];
    return r ? { id: Number(r.id), username: r.username, xuid: r.xuid ? String(r.xuid) : null, owner: isOwner(this.env, r.username, r.platform === "bedrock") } : null;
  }

  // friends only (the owner can call anyone); never someone who blocked you or whom you blocked
  async mayCall(sql, from, to) {
    if (from.id === to.id) throw new Error("You can't call yourself.");
    const [blocked] = await sql`SELECT 1 FROM dm_blocks WHERE (user_id = ${to.id} AND blocked_id = ${from.id}) OR (user_id = ${from.id} AND blocked_id = ${to.id})`;
    if (blocked) throw new Error(`You can't call ${to.username}.`);
    if (from.owner) return;
    const [a, b] = from.id < to.id ? [from.id, to.id] : [to.id, from.id];
    const [f] = await sql`SELECT 1 FROM friends WHERE a = ${a} AND b = ${b} AND status = 'accepted'`;
    if (!f) throw new Error(`You can only call friends. Add ${to.username} as a friend first.`);
  }

  putInCall(userId, c) {
    for (const ws of this.socketsOf(userId)) this.update(ws, { callId: c.id });
    const p = c.people[userId];
    if (p) {
      p.goneAt = null;
      p.waitUntil = this.connected(userId) ? null : Date.now() + WAIT_MS;
    }
  }

  // ---------- calls ----------
  async callStart(from, target) {
    const existing = this.callOf(from.id);
    if (existing) return this.callAdd(existing, from, target);
    await this.mayCall(getDb(this.env), from, target);
    if (this.callOf(target.id)) throw new Error(`${target.username} is in another call right now.`);
    const id = crypto.randomUUID().slice(0, 8);
    const c = { id, createdAt: Date.now(), startedAt: null, people: {} };
    c.people[from.id] = { id: from.id, username: from.username, xuid: from.xuid || null, state: "in", by: null, joinedAt: Date.now() };
    this.calls[id] = c;
    this.putInCall(from.id, c);
    if (c.people[from.id].waitUntil) await this.wakeAt(c.people[from.id].waitUntil + 500);
    await this.ring(c, from, target);
    return c;
  }

  async callAdd(c, from, target) {
    await this.mayCall(getDb(this.env), from, target);
    const other = this.callOf(target.id);
    if (other && other.id !== c.id) throw new Error(`${target.username} is in another call right now.`);
    await this.ring(c, from, target);
    return c;
  }

  async ring(c, by, target) {
    const live = Object.values(c.people).filter((p) => p.state === "in" || p.state === "ringing");
    const old = c.people[target.id];
    if (old && (old.state === "in" || old.state === "ringing")) throw new Error(`${target.username} is already in this call.`);
    if (live.length >= CALL_MAX) throw new Error(`A call can have up to ${CALL_MAX} people.`);
    c.people[target.id] = { id: target.id, username: target.username, xuid: target.xuid || null, state: "ringing", by: by.id, byName: by.username,
      invitedAt: Date.now() };
    await this.saveCalls();
    const withNames = live.filter((p) => p.state === "in" && p.id !== by.id).map((p) => p.username);
    const note = { type: "call.incoming", id: c.id, from: by.username, fromId: by.id, with: withNames };
    for (const ws of this.socketsOf(target.id)) this.send(ws, note);
    try {   // the Community page rings (the call bar shows Answer / Decline)
      await hubStub(this.env).fetch("https://hub/internal/broadcast", { method: "POST", body: JSON.stringify({ ...note, type: "call_ring", to: target.id }) });
    } catch { /* best effort */ }
    try {   // their phone or computer too, if they turned on notifications
      await notify(this.env, [target.id], "calls", {
        title: `${by.username} is calling you`,
        body: withNames.length ? `With ${withNames.join(", ")}. Tap to answer.` : "Tap to answer on galaxymc.us.",
        url: `/community?answer=${c.id}#messages`, tag: `call-${c.id}`, ttl: 30, urgent: true,
      }, { noInbox: true });
    } catch { /* best effort */ }
    if (target.xuid) await this.game({ type: "call_ring", toXuid: target.xuid, from: by.username, id: c.id });
    await this.wakeAt(Date.now() + RING_MS + 500);
    this.callNote(c, `Calling ${target.username}…`, null, by.id);
    this.sendCall(c);
  }

  async stopRing(c, p) {
    for (const ws of this.socketsOf(p.id)) this.send(ws, { type: "call.ring_end", id: c.id });
    try {
      await hubStub(this.env).fetch("https://hub/internal/broadcast", { method: "POST", body: JSON.stringify({ type: "call_ring_end", to: p.id, id: c.id }) });
    } catch { /* best effort */ }
    if (p.xuid) await this.game({ type: "call_ring_end", toXuid: p.xuid });
  }

  ringingCall(userId, callId) {
    const c = callId ? this.calls[String(callId)] : Object.values(this.calls).find((x) => x.people[Number(userId)]?.state === "ringing");
    return c && c.people[Number(userId)]?.state === "ringing" ? c : null;
  }

  async callAccept(userId, callId) {
    const c = this.ringingCall(userId, callId);
    if (!c) throw new Error("That call has ended.");
    const cur = this.callOf(userId);
    if (cur && cur.id !== c.id) await this.callLeave(userId, "You joined another call.");
    const p = c.people[Number(userId)];
    p.state = "in";
    p.joinedAt = Date.now();
    if (!c.startedAt) c.startedAt = Date.now();
    this.putInCall(p.id, c);
    await this.stopRing(c, p);
    await this.saveCalls();
    if (p.waitUntil) await this.wakeAt(p.waitUntil + 500);
    this.callNote(c, `${p.username} joined the call.`, `§a📞 ${p.username} joined the call.`, p.id);
    this.sendCall(c);
    return c;
  }

  async callDecline(userId, callId) {
    const c = this.ringingCall(userId, callId);
    if (!c) return false;
    const p = c.people[Number(userId)];
    p.state = "declined";
    p.leftAt = Date.now();
    await this.stopRing(c, p);
    await this.history(c, p);
    this.callNote(c, `${p.username} declined the call.`);
    await this.maybeEnd(c);
    return true;
  }

  async callLeave(userId, why) {
    const c = this.callOf(userId);
    if (!c) return false;
    const p = c.people[Number(userId)];
    p.state = "left";
    p.leftAt = Date.now();
    for (const ws of this.socketsOf(p.id)) {
      this.update(ws, { callId: null });
      this.send(ws, { type: "call.ended", id: c.id, reason: why || "You left the call." });
    }
    await this.history(c, p);
    this.callNote(c, `${p.username} left the call.`);
    await this.maybeEnd(c);
    return true;
  }

  // fewer than two people left (and nobody ringing): the call is over
  async maybeEnd(c) {
    if (!this.calls[c.id]) return;
    const inn = Object.values(c.people).filter((p) => p.state === "in");
    const ringing = Object.values(c.people).filter((p) => p.state === "ringing");
    if (inn.length >= 2 || (inn.length === 1 && ringing.length)) {
      await this.saveCalls();
      this.sendCall(c);
      return;
    }
    const now = Date.now();
    for (const p of ringing) {
      p.state = "missed";
      p.leftAt = now;
      await this.stopRing(c, p);
      await this.history(c, p);
    }
    for (const p of inn) {
      p.state = "left";
      p.leftAt = now;
      const reason = c.startedAt ? `The call ended (${minutes(now - c.startedAt)}).` : "Nobody answered.";
      for (const ws of this.socketsOf(p.id)) {
        this.update(ws, { callId: null });
        this.send(ws, { type: "call.ended", id: c.id, reason });
      }
      if (p.xuid) await this.game({ type: "call_note", toXuid: p.xuid, text: `§7📞 ${reason}` });
      await this.history(c, p);
    }
    delete this.calls[c.id];
    await this.saveCalls();
  }

  // the call's line in the DM conversation (once per person who was called or added)
  async history(c, p) {
    if (!p.by || p.logged) return;
    p.logged = true;
    const status = p.state === "declined" ? "declined" : p.joinedAt ? "ended" : "missed";
    const seconds = p.joinedAt ? ((p.leftAt || Date.now()) - p.joinedAt) / 1000 : 0;
    const group = Object.keys(c.people).length > 2;
    try {
      const { logCall } = await import("../routes/dms.js");
      await logCall(this.env, p.by, p.id, { status, seconds, group });
    } catch (e) {
      console.error("call history failed", e);
    }
    if (status === "missed") {
      notify(this.env, [p.id], "calls", { title: `Missed call from ${p.byName}`, body: "Call them back from your messages.", url: "/community#messages", tag: `missed-${c.id}` })
        .catch(() => {});
      if (p.xuid) await this.game({ type: "call_note", toXuid: p.xuid, text: `§c📞 Missed call from ${p.byName}.` });
    }
  }

  // calls nobody answered, and people whose call bar stayed closed (runs from the alarm)
  async sweepCalls() {
    const now = Date.now();
    let next = null;
    const soon = (t) => { next = next === null ? t : Math.min(next, t); };
    for (const c of Object.values(this.calls)) {
      for (const p of Object.values(c.people)) {
        if (!this.calls[c.id]) break;
        if (p.state === "ringing") {
          if (now - p.invitedAt >= RING_MS) {
            p.state = "missed";
            p.leftAt = now;
            await this.stopRing(c, p);
            await this.history(c, p);
            this.callNote(c, `${p.username} didn't answer.`);
          } else soon(p.invitedAt + RING_MS);
        } else if (p.state === "in") {
          if (this.connected(p.id)) {
            p.goneAt = null;
            p.waitUntil = null;
            continue;
          }
          if (!p.waitUntil && !p.goneAt) p.goneAt = now;
          const deadline = p.waitUntil || p.goneAt + GONE_MS;
          if (now >= deadline) await this.callLeave(p.id, "You left the call because the page was closed.");
          else soon(deadline);
        }
      }
      if (this.calls[c.id]) await this.maybeEnd(c);
    }
    await this.saveCalls();
    return next;
  }

  async alarm() {
    const next = await this.sweepCalls().catch((e) => { console.error("calls sweep", e); return null; });
    if (next) await this.wakeAt(next + 200);
  }

  // ---------- connections ----------
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/internal/state") {   // on page load: are you in a call, or is someone calling you?
      const id = Number(url.searchParams.get("user"));
      const c = this.callOf(id);
      const r = Object.values(this.calls).find((x) => x.people[id]?.state === "ringing");
      const p = r?.people[id];
      return Response.json({
        call: c ? this.publicCall(c) : null,
        incoming: r ? { id: r.id, from: p.byName, fromId: p.by, with: Object.values(r.people).filter((x) => x.state === "in" && x.id !== p.by).map((x) => x.username) } : null,
      });
    }
    if (url.pathname === "/internal/decline") {
      const b = await request.json();
      await this.callDecline(Number(b.userId), b.id || null);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/internal/leave") {
      const b = await request.json();
      await this.callLeave(Number(b.userId));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/internal/game") {   // /call in game (sent on by the voice hub)
      await this.fromGame(await request.json());
      return Response.json({ ok: true });
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const user = JSON.parse(request.headers.get("X-GSMP-User"));
    for (const old of this.ctx.getWebSockets(`user:${user.id}`)) {   // one call bar per member: the newest tab wins
      this.send(old, { type: "closed", reason: "Your call moved to another tab." });
      try { old.serializeAttachment({ ...(old.deserializeAttachment() || {}), gone: true }); } catch { /* gone */ }
      try { old.close(4003, "replaced"); } catch { /* gone */ }
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [`user:${user.id}`]);
    server.serializeAttachment({ ...user, mic: true, talking: false, callId: null, sessionId: null, trackName: null });
    this.send(server, { type: "hello", you: user.id });
    const c = this.callOf(user.id);
    if (c) {   // back in their call (a new page, or they answered in game)
      this.update(server, { callId: c.id });
      c.people[user.id].goneAt = null;
      c.people[user.id].waitUntil = null;
      this.ctx.waitUntil(this.saveCalls());
      this.sendCall(c);
    }
    for (const r of Object.values(this.calls)) {
      const p = r.people[user.id];
      if (p?.state === "ringing") {
        this.send(server, { type: "call.incoming", id: r.id, from: p.byName, fromId: p.by,
          with: Object.values(r.people).filter((x) => x.state === "in" && x.id !== p.by).map((x) => x.username) });
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketClose(ws) {
    await this.gone(ws);
  }

  async webSocketError(ws) {
    await this.gone(ws);
  }

  async gone(ws) {
    const a = ws.deserializeAttachment();
    if (a) ws.serializeAttachment({ ...a, gone: true });
    try { ws.close(1000, "bye"); } catch { /* gone */ }
    if (!a?.id) return;
    const c = this.callOf(a.id);
    if (!c || this.connected(a.id)) return;
    for (const p of Object.values(c.people)) if (p.state === "in") for (const s of this.socketsOf(p.id)) this.send(s, { type: "left", id: a.id });
    const p = c.people[a.id];
    if (!p.goneAt) p.goneAt = Date.now();
    await this.saveCalls();
    await this.wakeAt(p.goneAt + GONE_MS + 500);
    this.sendCall(c);
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const a = ws.deserializeAttachment();
    if (!a || a.gone) return;
    try {
      if (flooding(ws)) return closeFlooder(ws);
      await this.onMessage(ws, a, msg);
    } catch (e) {
      console.error("call error", e);
      if (msg.req) this.send(ws, { type: "reply", req: msg.req, error: e.message || "Something went wrong." });
    }
  }

  isVoiceMuted(a) {   // a staff voice mute also applies to calls
    return Boolean(a.voiceMutedUntil && new Date(a.voiceMutedUntil) > new Date());
  }

  async onMessage(ws, a, msg) {
    const reply = (data) => this.send(ws, { type: "reply", req: msg.req, ...data });
    switch (msg.type) {
      case "state": {   // mic on/off and talking (the people in the call see who's talking)
        const patch = {};
        if (typeof msg.mic === "boolean") patch.mic = msg.mic && !this.isVoiceMuted(a);
        if (typeof msg.talking === "boolean") patch.talking = msg.talking && !this.isVoiceMuted(a);
        const b = this.update(ws, patch);
        const c = b.callId && this.calls[b.callId];
        if (c) {
          const data = { type: "talk", id: b.id, talking: Boolean(b.talking && b.mic !== false), mic: b.mic !== false };
          for (const p of Object.values(c.people)) if (p.state === "in" && p.id !== b.id) for (const s of this.socketsOf(p.id)) this.send(s, data);
        }
        return;
      }
      case "call.start":
      case "call.add": {
        if (flooding(ws, "call", 0.2, 3)) throw new Error("Slow down a little.");
        const sql = getDb(this.env);
        const me = (await this.person(sql, { id: a.id })) || { id: a.id, username: a.username, xuid: null };
        me.owner = Boolean(a.owner) || me.owner;
        const to = /^\d+$/.test(String(msg.to ?? "")) ? { id: Number(msg.to) } : { name: msg.to };
        const target = await this.person(sql, to);
        if (!target) throw new Error("No member with that name. They need a galaxymc.us account (/link in game).");
        const cur = this.callOf(a.id);
        if (msg.type === "call.add" && !cur) throw new Error("You're not in a call.");
        const c = cur ? await this.callAdd(cur, me, target) : await this.callStart(me, target);
        return reply({ ok: true, call: this.publicCall(c), calling: target.username });
      }
      case "call.accept": {
        const c = await this.callAccept(a.id, msg.id);
        return reply({ ok: true, call: this.publicCall(c) });
      }
      case "call.decline":
        await this.callDecline(a.id, msg.id);
        return reply({ ok: true });
      case "call.leave":
        await this.callLeave(a.id);
        return reply({ ok: true });
      // ---- audio (the same relay as voice chat) ----
      case "rtc.session": {
        const data = await this.rtc("POST", "/sessions/new");
        this.update(ws, { sessionId: data.sessionId, trackName: null });
        return reply({ ok: true });
      }
      case "rtc.push": {
        if (!a.sessionId) throw new Error("No call session.");
        const trackName = `c${a.id}`;
        const data = await this.rtc("POST", `/sessions/${a.sessionId}/tracks/new`, {
          sessionDescription: { type: "offer", sdp: String(msg.sdp) },
          tracks: [{ location: "local", mid: String(msg.mid), trackName }],
        });
        const b = this.update(ws, { trackName });
        const c = b.callId && this.calls[b.callId];
        if (c) this.sendCall(c);   // the others can hear them now
        return reply({ ok: true, answer: data.sessionDescription });
      }
      case "rtc.pull": {
        if (!a.sessionId) throw new Error("No call session.");
        const c = a.callId && this.calls[a.callId];
        const allowed = [];
        for (const id of (Array.isArray(msg.owners) ? msg.owners : []).slice(0, CALL_MAX)) {
          if (!c || c.people[Number(id)]?.state !== "in" || Number(id) === a.id) continue;
          const s = this.socketsOf(id).map((x) => x.deserializeAttachment()).find((x) => x.trackName && x.callId === c.id);
          if (s && !this.isVoiceMuted(s)) allowed.push(s);
        }
        if (!allowed.length) return reply({ ok: true, tracks: [] });
        const data = await this.rtc("POST", `/sessions/${a.sessionId}/tracks/new`, {
          tracks: allowed.map((s) => ({ location: "remote", sessionId: s.sessionId, trackName: s.trackName })),
        });
        const tracks = (data.tracks || []).filter((t) => !t.errorCode && t.mid)
          .map((t) => ({ mid: t.mid, owner: allowed.find((s) => s.trackName === t.trackName && s.sessionId === t.sessionId)?.id }))
          .filter((t) => t.owner);
        return reply({ ok: true, tracks, offer: data.requiresImmediateRenegotiation ? data.sessionDescription : null });
      }
      case "rtc.renegotiate":
        await this.rtc("PUT", `/sessions/${a.sessionId}/renegotiate`, { sessionDescription: { type: "answer", sdp: String(msg.sdp) } });
        return reply({ ok: true });
      case "rtc.close": {
        const mids = (Array.isArray(msg.mids) ? msg.mids : []).map(String).slice(0, CALL_MAX * 2);
        if (!mids.length || !a.sessionId) return reply({ ok: true });
        const data = await this.rtc("PUT", `/sessions/${a.sessionId}/tracks/close`, {
          tracks: mids.map((mid) => ({ mid })),
          sessionDescription: msg.sdp ? { type: "offer", sdp: String(msg.sdp) } : undefined,
          force: !msg.sdp,
        });
        return reply({ ok: true, answer: data.sessionDescription || null });
      }
    }
  }

  // the Endstone plugin: /call <name>, /call accept, /call decline, /call add <name>, /call hangup
  async fromGame(msg) {
    const sql = getDb(this.env);
    const say = (text) => this.game({ type: "call_note", toXuid: String(msg.xuid), text });
    const me = await this.person(sql, { xuid: msg.xuid });
    if (!me) return say("§cLink your account first (type /link). Then you can call your friends.");
    const site = "§7Open your §bDMs on galaxymc.us§7 (phone or computer) to talk.";
    try {
      if (msg.type === "call_start" || msg.type === "call_add") {
        const c = this.callOf(me.id);
        if (msg.type === "call_add" && !c) return say("§7You're not in a call. Start one with §e/call <name>§7.");
        const target = await this.person(sql, { name: msg.to });
        if (!target) return say(`§cNo member called ${String(msg.to || "").slice(0, 32)}. They need a galaxymc.us account (/link).`);
        if (c) await this.callAdd(c, me, target);
        else await this.callStart(me, target);
        await say(`§a📞 Calling ${target.username}...` + (this.live(me.id) ? "" : ` ${site}`));
      } else if (msg.type === "call_accept") {
        await this.callAccept(me.id, msg.id || null);
        await say(this.live(me.id) ? "§a📞 You're in the call." : `§a📞 Answered! ${site} §8(The call waits 3 minutes.)`);
      } else if (msg.type === "call_decline") {
        await say((await this.callDecline(me.id, msg.id || null)) ? "§7Call declined." : "§7Nobody is calling you right now.");
      } else if (msg.type === "call_leave") {
        await say((await this.callLeave(me.id)) ? "§7You left the call." : "§7You're not in a call.");
      }
    } catch (e) {
      await say(`§c${e.message || "Something went wrong."}`);
    }
  }
}
