// CommunityHub: one Cloudflare Durable Object that every open chat tab connects to.
// It checks and saves each new message, then sends it to everyone instantly.
// Uses the WebSocket Hibernation API, so it costs almost nothing while chat is quiet.
import { DurableObject } from "cloudflare:workers";
import { getDb } from "../lib/db.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { REACTIONS, loadMessage, loadReactions } from "./messages.js";
import { notify } from "../routes/notify.js";

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
    if (url.pathname === "/internal/viewing") { // is this member looking at this chat right now?
      const viewers = this.viewersOf(url.searchParams.get("view") || "");
      return Response.json({ viewing: viewers.has(Number(url.searchParams.get("user"))) });
    }
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

  // Members who have this chat open on screen right now ("chat", "dm:12"...): they don't need a
  // notification for it. Pages say what they show when it changes, and again every few minutes.
  viewersOf(view) {
    const ids = new Set();
    if (!view) return ids;
    const fresh = Date.now() - 10 * 60_000;
    for (const ws of this.ctx.getWebSockets()) {
      const u = ws.deserializeAttachment();
      if (u?.viewing === view && (u.viewingAt || 0) > fresh) ids.add(Number(u.id));
    }
    return ids;
  }

  onViewing(ws, user, msg) {
    const view = typeof msg.view === "string" && /^[a-z0-9:_-]{1,40}$/.test(msg.view) ? msg.view : null;
    ws.serializeAttachment({ ...user, viewing: view, viewingAt: Date.now() });
  }

  // "player1 is typing…": in a channel to everyone else, in a DM only to the other person.
  // Not stored anywhere; browsers send it at most every few seconds and hide it after 6 seconds.
  onTyping(ws, user, msg) {
    if (user.muted_until && new Date(user.muted_until) > new Date()) return;
    const now = Date.now();
    const key = msg.dm != null ? `dm:${Number(msg.dm)}` : `ch:${Number(msg.channelId)}`;
    const last = (this.typingAt ||= new Map());
    const k = `${user.id}|${key}`;
    if (now - (last.get(k) || 0) < 2000) return;
    last.set(k, now);
    if (last.size > 5000) last.clear();
    const who = { userId: Number(user.id), username: user.username };
    if (msg.dm != null) {
      const to = Number(msg.dm);
      if (!Number.isInteger(to) || to === Number(user.id)) return;
      const text = JSON.stringify({ type: "typing", dm: Number(user.id), ...who });
      for (const s of this.socketsFor(to)) { try { s.send(text); } catch { /* gone */ } }
      return;
    }
    const channelId = Number(msg.channelId);
    if (!Number.isInteger(channelId)) return;
    const text = JSON.stringify({ type: "typing", channelId, ...who });
    for (const s of this.ctx.getWebSockets()) {
      if (Number(s.deserializeAttachment()?.id) === Number(user.id)) continue;
      try { s.send(text); } catch { /* gone */ }
    }
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
    if (event.type === "dm" || event.type === "dm_read" || event.type === "dm_edit") { // only the sender and the recipient get these
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
      else if (msg.type === "seen") await this.onSeen(user, msg);
      else if (msg.type === "edit") await this.onEdit(ws, user, msg);
      else if (msg.type === "viewing") this.onViewing(ws, user, msg);
      else if (msg.type === "typing") this.onTyping(ws, user, msg);
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
    this.ctx.waitUntil(this.pushFor(sql, user, channelId, r.id, check.text).catch((e) => console.error("push failed", e)));
  }

  // Phone/computer notifications: #announcements posts (Updates), and @mentions / replies.
  async pushFor(sql, user, channelId, messageId, text) {
    const [ch] = await sql`SELECT slug, name FROM channels WHERE id = ${channelId}`;
    if (!ch) return;
    if (ch.slug === "updates") { // minor announcements: only members who turned "Minor updates" on
      await notify(this.env, "all", "minor", { title: "New in #Updates", body: text, url: "/community#updates", tag: `upd-${messageId}`, ttl: 24 * 3600 },
        { exclude: [user.id, ...this.viewersOf(ch.slug)] });
      return;
    }
    if (ch.slug === "announcements") {
      await notify(this.env, "all", "updates", { title: `New in #${ch.name}`, body: text, url: `/community#${ch.slug}`, tag: `ann-${messageId}`, ttl: 24 * 3600 },
        { exclude: [user.id, ...this.viewersOf(ch.slug)] });
      return;
    }
    const lower = text.toLowerCase();
    // staff: @everyone pings every member, @here everyone online (website or in game)
    if ((user.power || 0) >= 50 && /@(everyone|here)\b/.test(lower)) {
      const everyone = /@everyone\b/.test(lower);
      const ids = everyone ? "all" : [...new Set([...this.onlineUserIds(),
        ...(await sql`SELECT u.id FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE p.online_at > now() - interval '150 seconds'`).map((r) => Number(r.id))])]
        .filter((id) => id !== user.id);
      await notify(this.env, ids, "mentions", { title: `${user.username} in #${ch.name}`, body: text, url: `/community#${ch.slug}`, tag: `chat-${ch.slug}` },
        { exclude: [user.id, ...this.viewersOf(ch.slug)] });
      return;
    }
    const targets = await sql`
      SELECT DISTINCT u.id FROM users u
       WHERE u.id <> ${user.id} AND NOT u.banned
         AND (position('@' || lower(u.username) in ${lower}) > 0
              OR u.id = (SELECT m.user_id FROM messages m JOIN messages me ON me.reply_to = m.id WHERE me.id = ${messageId}))
       LIMIT 25`;
    if (targets.length) {
      await notify(this.env, targets.map((t) => t.id), "mentions", {
        title: `${user.username} in #${ch.name}`, body: text, url: `/community#${ch.slug}`, tag: `chat-${ch.slug}`,
      }, { exclude: [...this.viewersOf(ch.slug)] });
    }
  }

  // Someone saw these messages on screen: their authors can't edit them any more.
  async onSeen(user, msg) {
    const ids = (Array.isArray(msg.ids) ? msg.ids : []).map(Number).filter(Number.isInteger).slice(0, 100);
    if (!ids.length) return;
    const sql = getDb(this.env);
    const rows = await sql`
      UPDATE messages SET seen_at = now()
       WHERE id = ANY(${ids}::bigint[]) AND user_id <> ${user.id} AND seen_at IS NULL AND deleted_at IS NULL
       RETURNING id`;
    if (rows.length) this.broadcast({ type: "seen", ids: rows.map((r) => Number(r.id)) });
  }

  // Edit your own message, only while nobody has seen it yet.
  async onEdit(ws, user, msg) {
    const reject = (message) => this.send(ws, { type: "rejected", nonce: msg.nonce, message });
    const id = Number(msg.messageId);
    if (!Number.isInteger(id)) return reject("Unknown message.");
    const sql = getDb(this.env);
    const [m] = await sql`SELECT user_id, seen_at, deleted_at FROM messages WHERE id = ${id}`;
    if (!m || m.deleted_at) return reject("That message no longer exists.");
    if (Number(m.user_id) !== Number(user.id)) return reject("You can only edit your own messages.");
    if (m.seen_at) return reject("Someone has already read this message, so it can't be edited. You can delete it instead.");
    const check = checkMessage(msg.content, await this.wordList(), { allowLinks: (user.power || 0) >= 100 });
    if (!check.ok) return reject(check.message);
    const [u] = await sql`SELECT banned, muted_until FROM users WHERE id = ${user.id}`;
    if (u?.banned || (u?.muted_until && new Date(u.muted_until) > new Date())) return reject("You can't edit messages right now.");
    const done = await sql`UPDATE messages SET content = ${check.text}, edited_at = now() WHERE id = ${id} AND seen_at IS NULL RETURNING id`;
    if (!done.length) return reject("Someone has just read this message, so it can't be edited any more.");
    const message = await loadMessage(sql, id);
    this.send(ws, { type: "edited", nonce: msg.nonce, id });
    this.broadcast({ type: "message_updated", message });
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
