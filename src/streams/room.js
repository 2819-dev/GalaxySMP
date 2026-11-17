// StreamRoom: one Durable Object per live Stage (like Discord Stages: speakers talk, share their screen or
// camera; the audience listens, chats, reacts and can raise their hand to speak).
//
// Video and audio never pass through here. People on the stream ("on stage") send their mic, camera or
// screen to Cloudflare Realtime, and viewers receive them from there (the same relay voice chat uses).
// This object only coordinates: who is on stage, who may pull which tracks, the live chat, reactions,
// bringing a viewer on stage, and ending the stream. The stream itself is a row in Postgres (streams).
import { DurableObject } from "cloudflare:workers";
import { getDb } from "../lib/db.js";
import { checkMessage, compileWordList } from "../lib/filter.js";

const RTC_BASE = "https://rtc.live.cloudflare.com/v1/apps";
const CHAT_KEEP = 80;
const MAX_STAGE = 8;
const MAX_VIEWERS = 150;                 // keeps relay usage (and cost) in check
const IDLE_END_MS = 10 * 60 * 1000;      // nobody on stage for 10 minutes: the stream ends by itself
export const REACTIONS = ["❤️", "😂", "🔥", "👏", "😮", "🎉"];

export class StreamRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      this.info = (await ctx.storage.get("info")) || null;   // { id, title, kind, status }
      this.chat = (await ctx.storage.get("chat")) || [];
      this.idleSince = (await ctx.storage.get("idleSince")) || null;
    });
  }

  // ---------- helpers ----------
  sockets() { return this.ctx.getWebSockets("viewer").filter((ws) => !ws.deserializeAttachment()?.gone); }
  people() {
    const byId = new Map();  // one entry per member (newest tab wins)
    for (const ws of this.sockets()) { const a = ws.deserializeAttachment(); if (a) byId.set(a.id, { ws, a }); }
    return byId;
  }
  send(ws, data) { try { ws.send(JSON.stringify(data)); } catch { /* gone */ } }
  broadcast(data) { const t = JSON.stringify(data); for (const ws of this.sockets()) { try { ws.send(t); } catch { /* gone */ } } }
  update(ws, patch) { const a = { ...ws.deserializeAttachment(), ...patch }; ws.serializeAttachment(a); return a; }

  async rtc(method, path, body) {
    const res = await fetch(`${RTC_BASE}/${this.env.REALTIME_APP_ID}${path}`, {
      method, headers: { Authorization: `Bearer ${this.env.REALTIME_APP_SECRET}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.errorCode) throw new Error(data.errorDescription || `stream relay error ${res.status}`);
    return data;
  }

  stageEntry(a) {
    return { id: a.id, username: a.username, head: a.head, mic: Boolean(a.mic), cam: Boolean(a.cam), screen: Boolean(a.screen),
      guest: Boolean(a.guest), tracks: (a.tracks || []).map((t) => t.kind), pub: (a.tracks || []).map((t) => t.name).join(",") };
  }
  state() {
    const all = [...this.people().values()].map(({ a }) => a);
    return {
      type: "state", info: this.info,
      stage: all.filter((a) => a.onStage).map((a) => this.stageEntry(a)),
      viewers: all.length,
      invited: all.filter((a) => a.invited).map((a) => a.id),
      hands: all.filter((a) => a.hand && !a.onStage).map((a) => ({ id: a.id, username: a.username, head: a.head })),
    };
  }
  sendState() { this.broadcast(this.state()); this.ctx.waitUntil(this.trackIdle()); }

  // Remember when the stage went empty; the alarm ends the stream after a while.
  async trackIdle() {
    if (this.info?.status !== "live") return;
    const anyone = [...this.people().values()].some(({ a }) => a.onStage);
    if (anyone && this.idleSince) { this.idleSince = null; await this.ctx.storage.delete("idleSince"); }
    if (!anyone && !this.idleSince) { this.idleSince = Date.now(); await this.ctx.storage.put("idleSince", this.idleSince); }
    await this.ensureAlarm();
  }
  async ensureAlarm() {
    if (this.info?.status === "live" && !(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 60_000);
  }
  async alarm() {
    if (this.info?.status !== "live") return;
    const anyone = [...this.people().values()].some(({ a }) => a.onStage);
    if (!anyone && this.idleSince && Date.now() - this.idleSince > IDLE_END_MS) return this.end("Nobody spoke for 10 minutes, so the stage closed.", "auto");
    // keep the peak viewer count up to date
    const n = this.people().size;
    if (n) await getDb(this.env)`UPDATE streams SET peak_viewers = greatest(peak_viewers, ${n}) WHERE id = ${this.info.id}`.catch(() => {});
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
  }

  async end(reason, by) {
    if (!this.info || this.info.status === "ended") return;
    this.info = { ...this.info, status: "ended" };
    await this.ctx.storage.put("info", this.info);
    await this.ctx.storage.delete("chat");
    this.chat = [];
    const n = this.people().size;
    await getDb(this.env)`UPDATE streams SET status = 'ended', ended_at = now(), ended_by = ${String(by || "").slice(0, 40)},
                           peak_viewers = greatest(peak_viewers, ${n}) WHERE id = ${this.info.id} AND status <> 'ended'`.catch((e) => console.error("stream end", e));
    this.broadcast({ type: "ended", reason });
    for (const ws of this.sockets()) { try { ws.close(1000, "ended"); } catch { /* gone */ } }
  }

  // ---------- connections ----------
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/internal/start") {          // the stream went live (or its details changed)
      const info = await request.json();
      this.info = { id: info.id, title: info.title, kind: info.kind, status: info.status };
      await this.ctx.storage.put("info", this.info);
      if (info.status === "live") {
        this.idleSince = this.idleSince || Date.now();   // until someone goes on stage
        await this.ctx.storage.put("idleSince", this.idleSince);
        await this.ensureAlarm();
      }
      this.sendState();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/internal/end") {
      const b = await request.json();
      await this.end(b.reason || "The stage ended.", b.by);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/internal/count") {
      return Response.json({ viewers: this.people().size, stage: [...this.people().values()].filter(({ a }) => a.onStage).map(({ a }) => a.username) });
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const user = JSON.parse(request.headers.get("X-GSMP-User"));
    if (!this.info || this.info.status !== "live") return new Response("This stage isn't live.", { status: 409 });
    const people = this.people();
    if (!people.has(user.id) && people.size >= MAX_VIEWERS && !user.manage && !user.stage && !user.mod) {
      return new Response("This stage is full right now.", { status: 409 });
    }
    for (const old of this.ctx.getWebSockets(`user:${user.id}`)) {
      this.send(old, { type: "closed", reason: "You opened this stage in another tab." });
      try { old.serializeAttachment({ ...(old.deserializeAttachment() || {}), gone: true }); old.close(4003, "replaced"); } catch { /* gone */ }
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["viewer", `user:${user.id}`]);
    server.serializeAttachment({ ...user, onStage: false, invited: false, guest: false, sessionId: null, tracks: [], mic: false, cam: false, screen: false, lastChat: 0 });
    this.send(server, { type: "hello", you: user.id, rights: { manage: user.manage, stage: user.stage, mod: user.mod }, chat: this.chat, reactions: REACTIONS });
    this.sendState();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketClose(ws) { await this.leave(ws); }
  async webSocketError(ws) { await this.leave(ws); }
  async leave(ws) {
    const a = ws.deserializeAttachment();
    if (a) ws.serializeAttachment({ ...a, gone: true });
    try { ws.close(1000, "bye"); } catch { /* gone */ }
    this.sendState();
  }

  // ---------- messages ----------
  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const a = ws.deserializeAttachment();
    if (!a || a.gone) return;
    const reply = (data) => this.send(ws, { type: "reply", req: msg.req, ...data });
    try {
      await this.onMessage(ws, a, msg, reply);
    } catch (e) {
      console.error("stream error", e);
      if (msg.req) reply({ error: e.message || "Something went wrong." });
    }
  }

  async onMessage(ws, a, msg, reply) {
    const people = this.people();
    const target = (id) => people.get(Number(id));
    switch (msg.type) {
      // --- media relay ---
      case "rtc.session": {   // "sub": receiving (everyone), "pub": sending (people on stage). One connection each.
        // a receive-only connection sends a first offer (a data channel) so the session is connected before pulling
        const data = await this.rtc("POST", "/sessions/new", msg.sdp ? { sessionDescription: { type: "offer", sdp: String(msg.sdp) } } : undefined);
        if (msg.role === "pub") {
          if (!a.onStage) throw new Error("You're not a speaker.");
          this.update(ws, { pubSessionId: data.sessionId, tracks: [] });
        } else this.update(ws, { sessionId: data.sessionId });
        return reply({ ok: true, answer: data.sessionDescription || null });
      }
      case "rtc.push": {   // go on stage: send mic (+ camera/screen for video streams)
        if (!a.onStage) throw new Error("You're not a speaker.");
        if (!a.pubSessionId) throw new Error("No stage connection.");
        const want = (Array.isArray(msg.tracks) ? msg.tracks : []).slice(0, 2)
          .map((t) => ({ mid: String(t.mid), kind: t.kind === "video" ? "video" : "audio" }))
          ;
        if (!want.length) throw new Error("Nothing to send.");
        const tracks = want.map((t) => ({ ...t, name: `${t.kind[0]}${a.id}-${Date.now().toString(36)}` }));
        const data = await this.rtc("POST", `/sessions/${a.pubSessionId}/tracks/new`, {
          sessionDescription: { type: "offer", sdp: String(msg.sdp) },
          tracks: tracks.map((t) => ({ location: "local", mid: t.mid, trackName: t.name })),
        });
        this.update(ws, { tracks: tracks.map((t) => ({ kind: t.kind, name: t.name })), mic: true, cam: Boolean(msg.cam), screen: Boolean(msg.screen) });
        this.sendState();
        return reply({ ok: true, answer: data.sessionDescription });
      }
      case "rtc.pull": {   // receive the tracks of people on stage
        if (!a.sessionId) throw new Error("No stage connection.");
        const wanted = (Array.isArray(msg.owners) ? msg.owners : []).slice(0, MAX_STAGE);
        const list = [];
        for (const id of wanted) {
          const p = target(id);
          if (!p || !p.a.onStage || p.a.id === a.id || !p.a.pubSessionId) continue;
          for (const t of p.a.tracks || []) list.push({ owner: p.a.id, kind: t.kind, sessionId: p.a.pubSessionId, trackName: t.name });
        }
        if (!list.length) return reply({ ok: true, tracks: [] });
        const data = await this.rtc("POST", `/sessions/${a.sessionId}/tracks/new`, {
          tracks: list.map((t) => ({ location: "remote", sessionId: t.sessionId, trackName: t.trackName })),
        });
        const tracks = (data.tracks || []).filter((t) => !t.errorCode && t.mid).map((t) => {
          const src = list.find((s) => s.trackName === t.trackName && s.sessionId === t.sessionId);
          return src ? { mid: t.mid, owner: src.owner, kind: src.kind } : null;
        }).filter(Boolean);
        return reply({ ok: true, tracks, offer: data.requiresImmediateRenegotiation ? data.sessionDescription : null });
      }
      case "rtc.renegotiate": {
        await this.rtc("PUT", `/sessions/${a.sessionId}/renegotiate`, { sessionDescription: { type: "answer", sdp: String(msg.sdp) } });
        return reply({ ok: true });
      }
      case "rtc.close": {
        const mids = (Array.isArray(msg.mids) ? msg.mids : []).map(String).slice(0, 20);
        if (!mids.length || !a.sessionId) return reply({ ok: true });
        const data = await this.rtc("PUT", `/sessions/${a.sessionId}/tracks/close`, {
          tracks: mids.map((mid) => ({ mid })), sessionDescription: msg.sdp ? { type: "offer", sdp: String(msg.sdp) } : undefined, force: !msg.sdp,
        });
        return reply({ ok: true, answer: data.sessionDescription || null });
      }
      case "media": {      // mic / camera / screen switched on or off (for the tiles everyone sees)
        if (!a.onStage) return reply({ ok: true });
        this.update(ws, { mic: Boolean(msg.mic), cam: Boolean(msg.cam), screen: Boolean(msg.screen) });
        this.sendState();
        return reply({ ok: true });
      }

      // --- the stage ---
      case "stage.join": {
        if (!a.stage && !a.invited) throw new Error("Only the stage's hosts can speak. Raise your hand to ask.");
        const onStage = [...people.values()].filter(({ a: x }) => x.onStage).length;
        if (onStage >= MAX_STAGE) throw new Error(`Up to ${MAX_STAGE} people can speak at once.`);
        this.update(ws, { onStage: true, guest: !a.stage, invited: false, hand: false });
        this.sendState();
        return reply({ ok: true });
      }
      case "stage.leave": {
        this.update(ws, { onStage: false, guest: false, tracks: [], pubSessionId: null, mic: false, cam: false, screen: false });
        this.sendState();
        return reply({ ok: true });
      }
      case "stage.invite": {   // bring a viewer on stage (a call-in)
        if (!a.manage) throw new Error("Only the stage's hosts can do that.");
        const p = target(msg.id);
        if (!p) throw new Error("They're not watching any more.");
        if (p.a.onStage) return reply({ ok: true });
        this.update(p.ws, { invited: true });
        this.send(p.ws, { type: "invited", by: a.username });
        this.sendState();
        return reply({ ok: true });
      }
      case "stage.decline": {
        this.update(ws, { invited: false, hand: false });
        this.sendState();
        return reply({ ok: true });
      }
      case "hand": {   // raise / lower your hand to ask to speak
        if (a.onStage) return reply({ ok: true });
        this.update(ws, { hand: Boolean(msg.up) });
        this.sendState();
        if (msg.up) for (const { ws: w, a: x } of people.values()) if (x.manage) this.send(w, { type: "hand", username: a.username });
        return reply({ ok: true });
      }
      case "hand.dismiss": {
        if (!a.manage && !a.mod) throw new Error("Only the stage's hosts can do that.");
        const p = target(msg.id);
        if (p) { this.update(p.ws, { hand: false }); this.send(p.ws, { type: "hand.lowered" }); }
        this.sendState();
        return reply({ ok: true });
      }
      case "stage.remove": {
        if (!a.manage && !a.mod) throw new Error("Only the stage's hosts can do that.");
        const p = target(msg.id);
        if (p) {
          this.update(p.ws, { onStage: false, guest: false, invited: false, tracks: [], pubSessionId: null, mic: false, cam: false, screen: false });
          this.send(p.ws, { type: "removed" });
        }
        this.sendState();
        return reply({ ok: true });
      }

      // --- chat and reactions ---
      case "chat": {
        const now = Date.now();
        if (now - (a.lastChat || 0) < 1200) throw new Error("Slow down a little.");
        const sql = getDb(this.env);
        const words = compileWordList(await sql`SELECT word, match FROM filter_words WHERE NOT EXISTS (SELECT 1 FROM economy_config WHERE key = 'chatfilter_off')`);
        const check = checkMessage(String(msg.text || ""), words, { allowLinks: false, maxLength: 200 });
        if (!check.ok) throw new Error(check.message || "That message isn't allowed.");
        if (!check.text.trim()) return reply({ ok: true });
        this.update(ws, { lastChat: now });
        const m = { id: crypto.randomUUID().slice(0, 8), userId: a.id, username: a.username, head: a.head, text: check.text, at: now,
          host: Boolean(a.manage || a.stage), staff: Boolean(a.mod) };
        this.chat = [...this.chat, m].slice(-CHAT_KEEP);
        await this.ctx.storage.put("chat", this.chat);
        this.broadcast({ type: "chat", message: m });
        return reply({ ok: true });
      }
      case "chat.delete": {
        if (!a.manage && !a.mod) throw new Error("Only the stage's hosts and staff can do that.");
        this.chat = this.chat.filter((m) => m.id !== String(msg.id));
        await this.ctx.storage.put("chat", this.chat);
        this.broadcast({ type: "chat.deleted", id: String(msg.id) });
        return reply({ ok: true });
      }
      case "kick": {   // remove a viewer from this stream
        if (!a.manage && !a.mod) throw new Error("Only the stage's hosts and staff can do that.");
        const p = target(msg.id);
        if (p && !p.a.manage) {
          this.send(p.ws, { type: "closed", reason: "A host removed you from this stage." });
          this.update(p.ws, { gone: true });
          try { p.ws.close(4004, "removed"); } catch { /* gone */ }
        }
        this.sendState();
        return reply({ ok: true });
      }
      case "react": {
        if (!REACTIONS.includes(msg.emoji)) return;
        const now = Date.now();
        if (now - (a.lastReact || 0) < 300) return;
        this.update(ws, { lastReact: now });
        this.broadcast({ type: "react", emoji: msg.emoji });
        return;
      }
      case "end": {
        if (!a.manage && !a.mod) throw new Error("Only the stage's hosts and staff can end it.");
        await this.end(a.manage ? "The host ended the stage." : "Staff ended this stage.", a.username);
        return;
      }
      case "viewers": {   // the list of people watching (for hosts: bring on stage, remove)
        if (!a.manage && !a.mod) throw new Error("Only the stage's hosts can see that.");
        return reply({ ok: true, viewers: [...people.values()].map(({ a: x }) => ({ id: x.id, username: x.username, head: x.head, onStage: Boolean(x.onStage), host: Boolean(x.stage || x.manage) })) });
      }
    }
  }
}
