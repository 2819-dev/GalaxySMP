// CommunityHub: one Cloudflare Durable Object that every open chat tab connects to.
// It checks and saves each new message, then sends it to everyone instantly.
// Uses the WebSocket Hibernation API, so it costs almost nothing while chat is quiet.
import { DurableObject } from "cloudflare:workers";
import { getDb } from "../lib/db.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { REACTIONS, loadMessage, loadReactions } from "./messages.js";

const WORDS_TTL_MS = 60_000;
const BURST = { count: 5, windowMs: 10_000 };
const SUSTAINED = { count: 20, windowMs: 60_000 };
const DUPLICATE_MS = 60_000;

export class CommunityHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.recent = new Map(); // userId -> { times: number[], lastText, lastAt }
    this.words = null;
    this.wordsAt = 0;
    // Answer keep-alive pings without waking the object up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---------- Connections ----------
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/internal/broadcast") {
      const event = await request.json();
      this.handleInternal(event);
      return new Response("ok");
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });

    const user = JSON.parse(request.headers.get("X-GSMP-User"));
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [`user:${user.id}`]);
    server.serializeAttachment(user);

    const wasOnline = this.socketsFor(user.id).length > 1;
    this.send(server, { type: "hello", online: this.onlineUserIds() });
    if (!wasOnline) this.broadcast({ type: "presence", userId: user.id, online: true }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  socketsFor(userId) {
    return this.ctx.getWebSockets(`user:${userId}`);
  }

  onlineUserIds() {
    const ids = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      const u = ws.deserializeAttachment();
      if (u) ids.add(u.id);
    }
    return [...ids];
  }

  async webSocketClose(ws) {
    this.leave(ws);
  }

  async webSocketError(ws) {
    this.leave(ws);
  }

  leave(ws) {
    const user = ws.deserializeAttachment();
    try { ws.close(1000, "bye"); } catch { /* already closed */ }
    if (user && this.socketsFor(user.id).filter((s) => s !== ws).length === 0) {
      this.broadcast({ type: "presence", userId: user.id, online: false });
    }
  }

  send(ws, data) {
    try { ws.send(JSON.stringify(data)); } catch { /* socket gone */ }
  }

  broadcast(data, except) {
    const text = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(text); } catch { /* socket gone */ }
    }
  }

  // Events from the website itself (staff actions in stage D use this).
  handleInternal(event) {
    if (event.type === "kick") {
      for (const ws of this.socketsFor(event.userId)) {
        this.send(ws, { type: "kicked", reason: event.reason || "" });
        try { ws.close(4001, "removed"); } catch { /* gone */ }
      }
      this.broadcast({ type: "presence", userId: event.userId, online: false });
      return;
    }
    if (event.type === "voice_invite") { // only the invited member
      const text = JSON.stringify(event);
      for (const ws of this.socketsFor(event.to)) { try { ws.send(text); } catch { /* gone */ } }
      return;
    }
    if (event.type === "dm") { // a direct message: only its sender and recipient get it
      const text = JSON.stringify(event);
      for (const id of [event.from, event.to]) for (const ws of this.socketsFor(id)) { try { ws.send(text); } catch { /* gone */ } }
      return;
    }
    if (event.type === "ticket") { // support ticket changed: tell its owner and every staff member
      const text = JSON.stringify(event);
      for (const ws of this.ctx.getWebSockets()) {
        const u = ws.deserializeAttachment();
        if (u && ((u.power || 0) >= 50 || Number(u.id) === Number(event.ownerId))) {
          try { ws.send(text); } catch { /* gone */ }
        }
      }
      return;
    }
    if (event.type === "words_changed") {
      this.words = null;
      return;
    }
    if (event.staffOnly) {
      const text = JSON.stringify(event);
      for (const ws of this.ctx.getWebSockets()) {
        if ((ws.deserializeAttachment()?.power || 0) >= 50) {
          try { ws.send(text); } catch { /* gone */ }
        }
      }
      return;
    }
    this.broadcast(event);
  }

  // ---------- Messages from browsers ----------
  async webSocketMessage(ws, raw) {
    const user = ws.deserializeAttachment();
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    try {
      if (msg.type === "send") await this.onSend(ws, user, msg);
      else if (msg.type === "react") await this.onReact(ws, user, msg);
    } catch (e) {
      console.error("hub error", e);
      this.send(ws, { type: "error", nonce: msg.nonce, message: "Something went wrong. Please try again." });
    }
  }

  async wordList() {
    if (this.words && Date.now() - this.wordsAt < WORDS_TTL_MS) return this.words;
    const sql = getDb(this.env);
    const rows = await sql`SELECT word, match FROM filter_words`;
    this.words = compileWordList(rows);
    this.wordsAt = Date.now();
    return this.words;
  }

  rateCheck(userId, text) {
    const now = Date.now();
    const r = this.recent.get(userId) || { times: [], lastText: "", lastAt: 0 };
    r.times = r.times.filter((t) => now - t < SUSTAINED.windowMs);
    const burst = r.times.filter((t) => now - t < BURST.windowMs).length;
    if (burst >= BURST.count || r.times.length >= SUSTAINED.count) {
      return "You're sending messages too quickly. Please slow down.";
    }
    if (text.toLowerCase() === r.lastText && now - r.lastAt < DUPLICATE_MS) {
      return "You just sent that message.";
    }
    r.times.push(now);
    r.lastText = text.toLowerCase();
    r.lastAt = now;
    this.recent.set(userId, r);
    return null;
  }

  async onSend(ws, user, msg) {
    const reject = (message) => this.send(ws, { type: "rejected", nonce: msg.nonce, message });
    const channelId = Number(msg.channelId);
    if (!Number.isInteger(channelId)) return reject("Unknown channel.");

    // Admins (owners included) may post links; everyone else can't.
    const check = checkMessage(msg.content, await this.wordList(), { allowLinks: (user.power || 0) >= 100 });
    if (!check.ok) return reject(check.message);
    const limited = this.rateCheck(user.id, check.text);
    if (limited) return reject(limited);

    const replyTo = msg.replyTo ? Number(msg.replyTo) : null;
    const sql = getDb(this.env);
    // One statement that also re-checks, fresh from the database, that the sender
    // isn't banned or muted and is allowed to post in this channel.
    const rows = await sql`
      WITH who AS (
        SELECT u.id, u.banned, u.muted_until, r.power
          FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ${user.id}
      ), ch AS (
        SELECT id, min_post_power FROM channels WHERE id = ${channelId} AND kind = 'text' AND NOT hidden
      ), ins AS (
        INSERT INTO messages (channel_id, user_id, content, reply_to)
        SELECT ch.id, who.id, ${check.text},
               (SELECT id FROM messages WHERE id = ${replyTo} AND channel_id = ${channelId} AND deleted_at IS NULL)
          FROM who, ch
         WHERE NOT who.banned
           AND (who.muted_until IS NULL OR who.muted_until <= now())
           AND who.power >= ch.min_post_power
        RETURNING id
      )
      SELECT (SELECT id FROM ins) AS id,
             (SELECT banned FROM who) AS banned,
             (SELECT muted_until FROM who) AS muted_until,
             (SELECT power FROM who) AS power,
             (SELECT min_post_power FROM ch) AS min_post_power`;
    const r = rows[0];
    if (!r.id) {
      if (r.banned) return reject("Your account has been banned.");
      if (r.muted_until && new Date(r.muted_until) > new Date()) {
        return reject(`You are muted until ${new Date(r.muted_until).toUTCString().replace(" GMT", " UTC")}.`);
      }
      if (r.min_post_power == null) return reject("Unknown channel.");
      return reject("Only staff can post in this channel.");
    }
    const message = await loadMessage(sql, r.id);
    this.send(ws, { type: "sent", nonce: msg.nonce, id: message.id });
    this.broadcast({ type: "message", message });
  }

  async onReact(ws, user, msg) {
    const messageId = Number(msg.messageId);
    if (!Number.isInteger(messageId) || !REACTIONS.includes(msg.emoji)) return;
    const sql = getDb(this.env);
    const removed = await sql`
      DELETE FROM reactions WHERE message_id = ${messageId} AND user_id = ${user.id} AND emoji = ${msg.emoji}
      RETURNING message_id`;
    if (!removed.length) {
      const added = await sql`
        INSERT INTO reactions (message_id, user_id, emoji)
        SELECT id, ${user.id}, ${msg.emoji} FROM messages WHERE id = ${messageId} AND deleted_at IS NULL
        ON CONFLICT DO NOTHING RETURNING message_id`;
      if (!added.length) return;
    }
    const reactions = await loadReactions(sql, messageId);
    this.broadcast({ type: "reactions", messageId, reactions });
  }
}
