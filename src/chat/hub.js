import { flooding, closeFlooder } from "../lib/flood.js";
// CommunityHub: one Cloudflare Durable Object that every open chat tab connects to.
// It checks and saves each new message, then sends it to everyone instantly.
// Uses the WebSocket Hibernation API, so it costs almost nothing while chat is quiet.
// a permission of a chat user ({ perms, owner } from the website when they connected)
const hubCan = (u, key) => Boolean(u && (u.owner || (Array.isArray(u.perms) && u.perms.includes(key))));
import { DurableObject } from "cloudflare:workers";
import { getDb } from "../lib/db.js";
import { checkMessage, compileWordList, normalize, maxLengthFor } from "../lib/filter.js";
import { SpamTracker, LIMITS } from "../lib/spam.js";
import { REACTIONS, loadMessage, loadReactions } from "./messages.js";
import { notify } from "../routes/notify.js";

const WORDS_TTL_MS = 60_000;
const BURST = { count: 5, windowMs: 10_000 };
const SUSTAINED = { count: 20, windowMs: 60_000 };
const DUPLICATE_MS = 60_000;
const REPEAT_WINDOW_MS = 120_000;

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
    if (url.pathname === "/internal/viewers") { // who has this open on screen right now
      return Response.json({ ids: [...this.viewersOf(url.searchParams.get("view") || "")] });
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

  // The page says "I'm open on screen" about once a minute: counts minutes on Community (for Friend Streaks).
  async onActive(user) {
    if (!user?.id || user.readOnly) return;
    this.activeAt ||= new Map();
    const last = this.activeAt.get(user.id) || 0;
    if (Date.now() - last < 55_000) return;  // several tabs open still count once a minute
    this.activeAt.set(user.id, Date.now());
    if (this.activeAt.size > 5000) this.activeAt.clear();
    const { countActivity } = await import("./engage.js");
    await countActivity(this.env, getDb(this.env), user.id, { minute: true });
  }

  // "player1 is typing…": in a channel to everyone else, in a DM only to the other person.
  // Not stored anywhere; browsers send it at most every few seconds and hide it after 6 seconds.
  async onTyping(ws, user, msg) {
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
    const staffOnly = (await this.staffChannels()).has(channelId);
    if (staffOnly && !hubCan(user, "staff_chat")) return;
    const text = JSON.stringify({ type: "typing", channelId, ...who });
    for (const s of this.ctx.getWebSockets()) {
      const u = s.deserializeAttachment();
      if (Number(u?.id) === Number(user.id) || (staffOnly && !hubCan(u, "staff_chat"))) continue;
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

  // Channels only staff can see (the Staff category): their messages, edits, reactions and typing only go to staff.
  async staffChannels() {
    if (this.staffSet && Date.now() - this.staffSetAt < 60_000) return this.staffSet;
    const rows = await getDb(this.env)`SELECT id FROM channels WHERE staff_only`;
    this.staffSet = new Set(rows.map((r) => Number(r.id)));
    this.staffSetAt = Date.now();
    return this.staffSet;
  }

  // Send to everyone who can see this channel.
  async broadcastChannel(channelId, data, except) {
    if (!(await this.staffChannels()).has(Number(channelId))) return this.broadcast(data, except);
    const text = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || !hubCan(ws.deserializeAttachment(), "staff_chat")) continue;
      try { ws.send(text); } catch { /* socket gone */ }
    }
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
    if (event.type === "dm" || event.type === "dm_read" || event.type === "dm_edit" || event.type === "dm_form") { // only the sender and the recipient get these
      const text = JSON.stringify(event);
      for (const id of [event.from, event.to]) for (const ws of this.socketsFor(id)) { try { ws.send(text); } catch { /* gone */ } }
      return;
    }
    if (event.type === "ticket") { // support ticket changed: tell its owner and every staff member
      const text = JSON.stringify(event);
      for (const ws of this.ctx.getWebSockets()) {
        const u = ws.deserializeAttachment();
        if (u && (hubCan(u, "answer_tickets") || Number(u.id) === Number(event.ownerId))) {
          try { ws.send(text); } catch { /* gone */ }
        }
      }
      return;
    }
    if (event.type === "words_changed") {
      this.words = null;
      return;
    }
    if (event.type === "channels_changed") {
      this.staffSet = null;
      return;
    }
    if ((event.type === "message" || event.type === "message_updated") && event.message) {
      this.ctx.waitUntil(this.broadcastChannel(event.message.channelId, event));
      return;
    }
    if (event.staffOnly) {
      const text = JSON.stringify(event);
      for (const ws of this.ctx.getWebSockets()) {
        if (hubCan(ws.deserializeAttachment(), "mod_panel")) {
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
    if (flooding(ws)) return closeFlooder(ws);
    try {
      // "Act as Member" (look-only): nothing is sent, edited, reacted to or marked as seen
      if (user?.readOnly && ["send", "react", "seen", "edit", "typing", "delete"].includes(msg.type)) {
        if (msg.type === "send" || msg.type === "edit") this.send(ws, { type: "rejected", nonce: msg.nonce, message: "You're looking at the site as another member, so you can't send messages." });
        return;
      }
      if (msg.type === "send") await this.onSend(ws, user, msg);
      else if (msg.type === "react") await this.onReact(ws, user, msg);
      else if (msg.type === "seen") await this.onSeen(user, msg);
      else if (msg.type === "edit") await this.onEdit(ws, user, msg);
      else if (msg.type === "viewing") this.onViewing(ws, user, msg);
      else if (msg.type === "typing") await this.onTyping(ws, user, msg);
      else if (msg.type === "active") await this.onActive(user);
    } catch (e) {
      console.error("hub error", e);
      this.send(ws, { type: "error", nonce: msg.nonce, message: "Something went wrong. Please try again." });
    }
  }

  async wordList() {
    if (this.words && Date.now() - this.wordsAt < WORDS_TTL_MS) return this.words;
    const sql = getDb(this.env);
    const rows = await sql`SELECT word, match FROM filter_words WHERE NOT EXISTS (SELECT 1 FROM economy_config WHERE key = 'chatfilter_off')`;
    this.words = compileWordList(rows);
    this.wordsAt = Date.now();
    return this.words;
  }

  // Spam (see lib/spam.js): too fast, near-copies of recent messages ("hi1" "hi2" count as the same), lots of
  // one-word messages, repeated words, mention or emoji floods. Returns null or { message, strike, mute }.
  rateCheck(userId, text) {
    const now = Date.now();
    let r = this.recent.get(userId);
    if (!(r instanceof SpamTracker)) { r = new SpamTracker(); this.recent.set(userId, r); }
    const res = r.check(text, now);
    if (this.recent.size > 2000) {   // forget members who haven't written for 10 minutes
      for (const [k, v] of this.recent) if (!(v instanceof SpamTracker) || v.idle(now, 600_000)) this.recent.delete(k);
    }
    return res;
  }

  // Too much spam in a short time: a 10-minute chat mute (staff who moderate are never auto-muted).
  async autoMute(sql, user, reason) {
    const mins = LIMITS.strikes.muteMinutes;
    const [u] = await sql`UPDATE users SET muted_until = now() + make_interval(mins => ${mins}), mute_reason = ${"Automatic: spam"}
                           WHERE id = ${user.id} AND (muted_until IS NULL OR muted_until < now() + make_interval(mins => ${mins}))
                       RETURNING muted_until, username, (SELECT key FROM roles WHERE id = users.role_id) AS role`;
    if (!u) return;
    await sql`INSERT INTO audit_log (actor_id, action, target_user_id, details) VALUES (NULL, 'user.mute', ${user.id}, ${JSON.stringify({ minutes: mins, reason: `Automatic: ${reason}`, by: "Spam filter" })}::jsonb)`;
    this.broadcast({ type: "member_updated", member: { id: Number(user.id), username: u.username, role: u.role }, mutedUntil: u.muted_until });
  }

  async onSend(ws, user, msg) {
    const reject = (message) => this.send(ws, { type: "rejected", nonce: msg.nonce, message });
    const channelId = Number(msg.channelId);
    if (!Number.isInteger(channelId)) return reject("Unknown channel.");

    // A picture (uploaded first with POST /api/chat/images) can be sent on its own or with text.
    const imageId = Number.isInteger(Number(msg.imageId)) && Number(msg.imageId) > 0 ? Number(msg.imageId) : null;
    // A voice message (uploaded first with POST /api/chat/voice; Galaxy+ and Pro+)
    const audioId = Number.isInteger(Number(msg.audioId)) && Number(msg.audioId) > 0 ? Number(msg.audioId) : null;
    // A reply in a thread (the message that started the thread)
    const threadRoot = Number.isInteger(Number(msg.threadRoot)) && Number(msg.threadRoot) > 0 ? Number(msg.threadRoot) : null;
    // Admins (owners included) may post links anywhere; everyone may post web links in channels that allow them.
    const sql0 = getDb(this.env);
    const [chOpts] = await sql0`SELECT slug, allow_links, slow_seconds FROM channels WHERE id = ${channelId}`;
    // #Bot Commands is for commands only (they're run with /, which never comes here); staff can still post
    if (chOpts?.slug === "bot-commands" && !hubCan(user, "delete_messages") && !threadRoot) {
      return reject("Only commands work in #Bot Commands. Type / to pick one, or tap + › Commands.");
    }
    const check = (imageId || audioId) && !String(msg.content || "").trim()
      ? { ok: true, text: "" }
      : checkMessage(msg.content, await this.wordList(), { allowLinks: hubCan(user, "post_links"), allowUrls: Boolean(chOpts?.allow_links), maxLength: maxLengthFor(user) });
    const logIt = (reason, detail) => this.ctx.waitUntil(import("../routes/mod.js").then((m) => m.logBlock(this.env, { userId: user.id, place: `chat:${channelId}`, content: msg.content, reason, detail })));
    if (!check.ok) { logIt(check.reason, check.detail); return reject(check.message); }
    const limited = this.rateCheck(user.id, check.text || `[media ${imageId || audioId}]`);
    if (limited) {
      if (limited.strike) logIt("spam", limited.message);
      if (limited.mute && !hubCan(user, "delete_messages")) {
        await this.autoMute(sql0, user, limited.message);
        return reject(`You've been muted for ${LIMITS.strikes.muteMinutes} minutes for spamming. Please don't flood the chat.`);
      }
      return reject(limited.message);
    }

    const replyTo = msg.replyTo ? Number(msg.replyTo) : null;
    const sql = getDb(this.env);
    // Slow mode (set by staff): one message every N seconds per member; staff who moderate aren't limited
    const slow = Number(chOpts?.slow_seconds || 0);
    if (slow > 0 && !hubCan(user, "delete_messages")) {
      const key = `${user.id}:${channelId}`;
      this.slowSeen ||= new Map();
      let last = this.slowSeen.get(key) || 0;
      if (slow >= 300 && !threadRoot) {  // long slow modes survive restarts: check their last message too
        const [lm] = await sql`SELECT max(created_at) AS at FROM messages WHERE channel_id = ${channelId} AND user_id = ${user.id} AND thread_root IS NULL`;
        if (lm?.at) last = Math.max(last, new Date(lm.at).getTime());
      }
      const wait = Math.ceil((last + slow * 1000 - Date.now()) / 1000);
      const when = wait >= 120 ? `${Math.ceil(wait / 60)} minutes` : `${wait} second${wait === 1 ? "" : "s"}`;
      if (wait > 0) return reject(`Slow mode is on: you can send another message in ${when}.`);
      this.slowSeen.set(key, Date.now());
      if (this.slowSeen.size > 5000) { const cut = Date.now() - 3_600_000; for (const [k, t] of this.slowSeen) if (t < cut) this.slowSeen.delete(k); }
    }
    // One statement that also re-checks, fresh from the database, that the sender
    // isn't banned or muted and is allowed to post in this channel.
    const rows = await sql`
      WITH who AS (
        SELECT u.id, u.banned, u.muted_until, u.mute_shown, r.power
          FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ${user.id}
      ), ch AS (
        SELECT id, min_post_power FROM channels WHERE id = ${channelId} AND kind = 'text' AND NOT hidden
           AND (NOT staff_only OR ${hubCan(user, "staff_chat")})
      ), ins AS (
        INSERT INTO messages (channel_id, user_id, content, reply_to, image_id, audio_id, thread_root)
        SELECT ch.id, who.id, ${check.text},
               (SELECT id FROM messages WHERE id = ${replyTo} AND channel_id = ${channelId} AND deleted_at IS NULL),
               (SELECT i.id FROM message_images i WHERE i.id = ${imageId} AND i.user_id = who.id
                   AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.image_id = i.id)),
               (SELECT a.id FROM message_audio a WHERE a.id = ${audioId} AND a.user_id = who.id
                   AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.audio_id = a.id) AND NOT EXISTS (SELECT 1 FROM dm_messages y WHERE y.audio_id = a.id)),
               (SELECT id FROM messages WHERE id = ${threadRoot} AND channel_id = ${channelId} AND thread_root IS NULL AND deleted_at IS NULL)
          FROM who, ch
         WHERE NOT who.banned
           AND (who.muted_until IS NULL OR who.muted_until <= now())
           AND (ch.min_post_power <= 10 OR ${hubCan(user, "post_staff_channels")})
           AND (${threadRoot}::bigint IS NULL OR EXISTS (SELECT 1 FROM messages r WHERE r.id = ${threadRoot} AND r.channel_id = ch.id AND r.thread_root IS NULL AND r.deleted_at IS NULL))
        RETURNING id
      )
      SELECT (SELECT id FROM ins) AS id,
             (SELECT banned FROM who) AS banned,
             (SELECT muted_until FROM who) AS muted_until,
             (SELECT mute_shown FROM who) AS mute_shown,
             (SELECT power FROM who) AS power,
             (SELECT min_post_power FROM ch) AS min_post_power`;
    const r = rows[0];
    if (!r.id) {
      if (r.banned) return reject("Your account has been banned.");
      if (r.muted_until && new Date(r.muted_until) > new Date()) {
        return reject(`You are muted until ${new Date(r.muted_until).toUTCString().replace(" GMT", " UTC")}.${r.mute_shown ? ` Reason: ${r.mute_shown}` : ""}`);
      }
      if (r.min_post_power == null) return reject("Unknown channel.");
      return reject("Your rank can't post in this channel.");
    }
    const message = await loadMessage(sql, r.id);
    this.send(ws, { type: "sent", nonce: msg.nonce, id: message.id });
    await this.broadcastChannel(channelId, { type: "message", message });
    // chat XP, level-ups, !commands in #Bot Commands, and website activity for Friend Streaks
    this.ctx.waitUntil(import("./engage.js").then((e) => e.afterMessage(this.env, sql, user, channelId, message,
      (m) => this.broadcastChannel(m.channelId, { type: "message", message: m }))).catch((err) => console.error("engage failed", err)));
    if (message.threadRoot) {
      // the thread's reply count on the message that started it, and a notification for whoever started it
      const root = await loadMessage(sql, message.threadRoot);
      if (root) await this.broadcastChannel(channelId, { type: "thread_update", rootId: root.id, thread: root.thread });
      const rootAuthor = root?.author?.id;
      if (rootAuthor && rootAuthor !== user.id) {
        this.ctx.waitUntil(notify(this.env, [rootAuthor], "mentions", { title: `${user.username} replied in your thread`, body: check.text || "🎤 Voice message",
          url: `/community#thread-${root.id}`, tag: `thread-${root.id}` }).catch(() => {}));
      }
      return;  // thread replies stay on the website (not sent to game chat)
    }
    if (check.text) this.ctx.waitUntil(import("../routes/gamechat.js").then((m) => m.toGame(this.env, sql, channelId, user.id, check.text)).catch(() => {}));
    this.ctx.waitUntil(this.pushFor(sql, user, channelId, r.id, check.text || (audioId ? "🎤 Voice message" : "📷 Sent a picture")).catch((e) => console.error("push failed", e)));
  }

  // Phone/computer notifications: #announcements posts (Updates), and @mentions / replies.
  async pushFor(sql, user, channelId, messageId, text) {
    const [ch] = await sql`SELECT slug, name, staff_only FROM channels WHERE id = ${channelId}`;
    if (!ch) return;
    if (ch.staff_only) return this.pushStaff(sql, user, ch, messageId, text);
    if (ch.slug === "announcements") {
      await notify(this.env, "all", "updates", { title: `New in #${ch.name}`, body: text, url: `/community#${ch.slug}`, tag: `ann-${messageId}`, ttl: 24 * 3600 },
        { exclude: [user.id, ...this.viewersOf(ch.slug)] });
      return;
    }
    const lower = text.toLowerCase();
    // staff: @everyone pings every member, @here everyone online (website or in game)
    if (hubCan(user, "mention_everyone") && /@(everyone|here)\b/.test(lower)) {
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

  // Staff channels: @mentions, replies and @everyone / @here only ever reach staff.
  async pushStaff(sql, user, ch, messageId, text) {
    const { staffMemberIds } = await import("../routes/staffroom.js");
    const staff = new Set(await staffMemberIds(this.env, sql));
    const lower = text.toLowerCase();
    let ids;
    if ((/@(everyone|here)\b/.test(lower) && hubCan(user, "mention_everyone")) || /@staff\b/.test(lower)) {
      ids = [...staff];
      if (/@here\b/.test(lower)) { const on = new Set(this.onlineUserIds().map(Number)); ids = ids.filter((id) => on.has(id)); }
    } else {
      ids = (await sql`
        SELECT DISTINCT u.id FROM users u
         WHERE NOT u.banned AND (position('@' || lower(u.username) in ${lower}) > 0
               OR u.id = (SELECT m.user_id FROM messages m JOIN messages me ON me.reply_to = m.id WHERE me.id = ${messageId}))
         LIMIT 25`).map((r) => Number(r.id));
    }
    ids = ids.filter((id) => staff.has(id) && id !== Number(user.id));
    if (!ids.length) return;
    await notify(this.env, ids, "mentions", { title: `${user.username} in #${ch.name}`, body: text, url: `/community#${ch.slug}`, tag: `chat-${ch.slug}` },
      { exclude: [...this.viewersOf(ch.slug)] });
  }

  // Someone saw these messages on screen: their authors can't edit them any more.
  async onSeen(user, msg) {
    const ids = (Array.isArray(msg.ids) ? msg.ids : []).map(Number).filter(Number.isInteger).slice(0, 100);
    if (!ids.length) return;
    const sql = getDb(this.env);
    const rows = await sql`
      UPDATE messages SET seen_at = now()
       WHERE id = ANY(${ids}::bigint[]) AND user_id <> ${user.id} AND seen_at IS NULL AND deleted_at IS NULL
         AND channel_id IN (SELECT id FROM channels WHERE NOT staff_only OR ${hubCan(user, "staff_chat")})
       RETURNING id, channel_id`;
    const byChannel = new Map();
    for (const r of rows) byChannel.set(Number(r.channel_id), [...(byChannel.get(Number(r.channel_id)) || []), Number(r.id)]);
    for (const [ch, list] of byChannel) await this.broadcastChannel(ch, { type: "seen", ids: list });
  }

  // Edit your own message, only while nobody has seen it yet.
  async onEdit(ws, user, msg) {
    const reject = (message) => this.send(ws, { type: "rejected", nonce: msg.nonce, message });
    const id = Number(msg.messageId);
    if (!Number.isInteger(id)) return reject("Unknown message.");
    const sql = getDb(this.env);
    const [m] = await sql`SELECT m.user_id, m.seen_at, m.deleted_at, c.allow_links FROM messages m LEFT JOIN channels c ON c.id = m.channel_id WHERE m.id = ${id}`;
    if (!m || m.deleted_at) return reject("That message no longer exists.");
    if (Number(m.user_id) !== Number(user.id)) return reject("You can only edit your own messages.");
    if (m.seen_at) return reject("Someone has already read this message, so it can't be edited. You can delete it instead.");
    const check = checkMessage(msg.content, await this.wordList(), { allowLinks: hubCan(user, "post_links"), allowUrls: Boolean(m.allow_links), maxLength: maxLengthFor(user) });
    if (!check.ok) return reject(check.message);
    const [u] = await sql`SELECT banned, muted_until FROM users WHERE id = ${user.id}`;
    if (u?.banned || (u?.muted_until && new Date(u.muted_until) > new Date())) return reject("You can't edit messages right now.");
    const done = await sql`UPDATE messages SET content = ${check.text}, edited_at = now() WHERE id = ${id} AND seen_at IS NULL AND poll_id IS NULL RETURNING id`;
    if (!done.length) return reject("Someone has just read this message, so it can't be edited any more.");
    const message = await loadMessage(sql, id);
    this.send(ws, { type: "edited", nonce: msg.nonce, id });
    await this.broadcastChannel(message.channelId, { type: "message_updated", message });
  }

  async onReact(ws, user, msg) {
    const messageId = Number(msg.messageId);
    if (!Number.isInteger(messageId) || typeof msg.emoji !== "string") return;
    const sql = getDb(this.env);
    const [target] = await sql`SELECT m.channel_id, c.staff_only FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.id = ${messageId}`;
    if (!target || (target.staff_only && !hubCan(user, "staff_chat"))) return;
    if (!REACTIONS.includes(msg.emoji)) {  // a custom emoji: ":name:" that exists
      const name = /^:([a-z0-9_]{2,24}):$/.exec(msg.emoji)?.[1];
      if (!name) return;
      if (!this.emojiAt || Date.now() - this.emojiAt > 60_000) {
        this.emojiSet = new Set((await sql`SELECT name FROM emoji`).map((r) => r.name));
        this.emojiAt = Date.now();
      }
      if (!this.emojiSet.has(name)) return;
    }
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
    await this.broadcastChannel(target.channel_id, { type: "reactions", messageId, reactions });
  }
}
