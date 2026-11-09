// VoiceHub: one Durable Object that coordinates website voice chat.
//
// Audio never passes through here. Each browser sends its microphone to Cloudflare
// Realtime (an audio relay, so players never see each other's IP address) and
// receives the voices it is allowed to hear. This object decides who may hear whom:
//   - players near each other in game (proximity, same dimension, within range)
//   - players in the same voice group
//   - anyone using the Global Mic
// The GalaxyLink Endstone plugin connects here too, sending player positions and
// receiving the voice icons shown before players' names in game.
import { DurableObject } from "cloudflare:workers";
import { getDb } from "../lib/db.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { sha256 } from "../lib/crypto.js";
import { loadRanksState, recordPlayers } from "../routes/ranks.js";
import { loadShop, recordBalances } from "../routes/economy.js";
import { loadHelp } from "../routes/help.js";
import { planMessage } from "../routes/plans.js";

export const RANGE = 48; // blocks
const PULL_RANGE = RANGE * 1.3; // a little slack so walking to the edge doesn't cut out
const POSITION_STALE_MS = 5000;
const MAX_GROUPS = 30;
const RTC_BASE = "https://rtc.live.cloudflare.com/v1/apps";

export class VoiceHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.positions = new Map(); // mcUuid -> { x, y, z, yaw, dim, at }
    this.words = null;
    this.wordsAt = 0;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      this.groups = (await ctx.storage.get("groups")) || {};
    });
  }

  // ---------- helpers ----------
  voiceSockets() {
    return this.ctx.getWebSockets("voice").filter((ws) => !ws.deserializeAttachment()?.gone);
  }

  pluginSocket() {
    return this.ctx.getWebSockets("plugin")[0] || null;
  }

  members() {
    // One entry per user (a user may have one voice tab open; newest wins).
    const byId = new Map();
    for (const ws of this.voiceSockets()) {
      const a = ws.deserializeAttachment();
      if (a && !a.gone) byId.set(a.id, { ws, a });
    }
    return byId;
  }

  send(ws, data) {
    try { ws.send(JSON.stringify(data)); } catch { /* gone */ }
  }

  broadcast(data) {
    const text = JSON.stringify(data);
    for (const ws of this.voiceSockets()) {
      try { ws.send(text); } catch { /* gone */ }
    }
  }

  update(ws, patch) {
    const a = { ...ws.deserializeAttachment(), ...patch };
    ws.serializeAttachment(a);
    return a;
  }

  isVoiceMuted(a) {
    return Boolean(a.voiceMutedUntil && new Date(a.voiceMutedUntil) > new Date());
  }

  position(a) {
    const p = a.mcUuid && this.positions.get(a.mcUuid);
    return p && Date.now() - p.at < POSITION_STALE_MS ? p : null;
  }

  publicGroups() {
    return Object.values(this.groups).map((g) => ({ id: g.id, name: g.name, locked: Boolean(g.passwordHash) }));
  }

  rosterEntry(a) {
    const p = this.position(a);
    return {
      id: a.id,
      username: a.username,
      role: a.role,
      color: a.color,
      inGame: Boolean(p),
      dim: p ? p.dim : null,
      group: a.groupId,
      mic: Boolean(a.micOn),
      deafened: Boolean(a.deafened),
      talking: Boolean(a.talking && a.micOn && !this.isVoiceMuted(a)),
      voiceMuted: this.isVoiceMuted(a),
      global: Boolean(a.global),
      canGlobal: Boolean(a.canGlobal),
      published: Boolean(a.trackName),
    };
  }

  sendRoster() {
    const users = [...this.members().values()].map(({ a }) => this.rosterEntry(a));
    this.broadcast({ type: "roster", users, groups: this.publicGroups() });
    this.sendIcons();
    this.sendActive();
  }

  // Icon shown before each player's name in game (like Simple Voice Chat).
  iconFor(a) {
    if (this.isVoiceMuted(a)) return "voice_muted";
    if (a.deafened) return "deafened";
    if (!a.micOn) return "muted";
    if (a.talking) return a.global && a.canGlobal ? "talking_global" : a.groupId ? "talking_group" : "talking";
    return "connected"; // in voice and quiet: no icon, like Simple Voice Chat
  }

  sendIcons() {
    const plugin = this.pluginSocket();
    if (!plugin) return;
    const icons = {};
    for (const { a } of this.members().values()) if (a.mcUuid) icons[a.mcUuid] = this.iconFor(a);
    this.send(plugin, { type: "icons", icons });
  }

  sendActive() {
    const plugin = this.pluginSocket();
    if (plugin) this.send(plugin, { type: "active", on: this.voiceSockets().length > 0 });
  }

  async wordList() {
    if (this.words && Date.now() - this.wordsAt < 60_000) return this.words;
    const rows = await getDb(this.env)`SELECT word, match FROM filter_words`;
    this.words = compileWordList(rows);
    this.wordsAt = Date.now();
    return this.words;
  }

  async saveGroups() {
    await this.ctx.storage.put("groups", this.groups);
  }

  async cleanupGroups() {
    const used = new Set([...this.members().values()].map(({ a }) => a.groupId).filter(Boolean));
    let changed = false;
    for (const id of Object.keys(this.groups)) {
      if (!used.has(id)) { delete this.groups[id]; changed = true; }
    }
    if (changed) await this.saveGroups();
  }

  // ---------- Cloudflare Realtime API ----------
  async rtc(method, path, body) {
    const res = await fetch(`${RTC_BASE}/${this.env.REALTIME_APP_ID}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.env.REALTIME_APP_SECRET}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.errorCode) throw new Error(data.errorDescription || `voice relay error ${res.status}`);
    return data;
  }

  // May `listener` hear `speaker` right now?
  canHear(listener, speaker) {
    if (listener.id === speaker.id || !speaker.trackName || this.isVoiceMuted(speaker)) return false;
    if (speaker.global && speaker.canGlobal) return true;
    if (listener.groupId && listener.groupId === speaker.groupId) return true;
    const p = this.position(listener);
    const q = this.position(speaker);
    if (!p || !q || p.dim !== q.dim) return false;
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) <= PULL_RANGE;
  }

  // ---------- connections ----------
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/internal/server") {
      const info = await this.ctx.storage.get("server");
      if (info && Date.now() - info.at < 45_000) return Response.json(info);
      // Older plugin versions don't send player counts, but if the plugin is connected the server is up.
      if (this.ctx.getWebSockets("plugin").some((ws) => !ws.deserializeAttachment()?.gone)) {
        const counted = [...this.positions.values()].filter((p) => Date.now() - p.at < POSITION_STALE_MS).length;
        return Response.json({ at: Date.now(), online: counted || null, max: null, version: "" });
      }
      return Response.json(null);
    }
    if (url.pathname === "/internal/chatfilter") {
      return Response.json((await this.ctx.storage.get("chatfilter")) || { enabled: null, at: null });
    }
    if (url.pathname === "/internal/events") {
      return Response.json((await this.ctx.storage.get("events")) || { events: [], at: null });
    }
    if (url.pathname === "/internal/ah") {
      return Response.json((await this.ctx.storage.get("ah")) || { listings: [], at: null });
    }
    if (url.pathname === "/internal/ask") {
      // Ask the server something and wait for its answer (e.g. buy an Auction House item).
      const plugin = this.pluginSocket();
      if (!plugin) return Response.json({ ok: false, message: "The Minecraft server isn't connected right now." });
      const body = await request.json();
      const req = crypto.randomUUID();
      this.waiting = this.waiting || new Map();
      const answer = new Promise((resolve) => {
        const timer = setTimeout(() => { this.waiting.delete(req); resolve({ ok: false, message: "The server didn't answer. Please try again." }); }, 8000);
        this.waiting.set(req, (msg) => { clearTimeout(timer); this.waiting.delete(req); resolve(msg); });
      });
      this.send(plugin, { ...body, req });
      return Response.json(await answer);
    }
    if (url.pathname === "/internal/plugin") {
      const plugin = this.pluginSocket();
      if (!plugin) return Response.json({ sent: false });
      this.send(plugin, await request.json());
      return Response.json({ sent: true });
    }
    if (url.pathname === "/internal/event") {
      await this.handleInternal(await request.json());
      return new Response("ok");
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (request.headers.get("X-GSMP-Plugin") === "1") {
      for (const old of this.ctx.getWebSockets("plugin")) { try { old.close(1000, "replaced"); } catch { /* gone */ } }
      this.ctx.acceptWebSocket(server, ["plugin"]);
      server.serializeAttachment({ kind: "plugin" });
      this.send(server, { type: "active", on: this.voiceSockets().length > 0 });
      this.sendIcons();
      this.ctx.waitUntil(this.sendRanks());
      this.ctx.waitUntil(this.sendShop());
      return new Response(null, { status: 101, webSocket: client });
    }

    const user = JSON.parse(request.headers.get("X-GSMP-User"));
    // One voice connection per user: close an older tab.
    for (const old of this.ctx.getWebSockets(`user:${user.id}`)) {
      this.send(old, { type: "closed", reason: "You joined voice in another tab." });
      try { old.close(4003, "replaced"); } catch { /* gone */ }
    }
    this.ctx.acceptWebSocket(server, ["voice", `user:${user.id}`]);
    server.serializeAttachment({
      kind: "voice", ...user,
      micOn: false, deafened: false, talking: false, global: false, groupId: null, sessionId: null, trackName: null,
    });
    this.send(server, { type: "hello", you: user.id, range: RANGE, voiceMutedUntil: user.voiceMutedUntil });
    this.sendRoster();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketClose(ws) {
    await this.leave(ws);
  }

  async webSocketError(ws) {
    await this.leave(ws);
  }

  async leave(ws) {
    const a = ws.deserializeAttachment();
    if (a && a.kind === "voice") ws.serializeAttachment({ ...a, gone: true });
    try { ws.close(1000, "bye"); } catch { /* gone */ }
    if (!a || a.kind !== "voice") {
      if (a && a.kind === "plugin" && this.ctx.getWebSockets("plugin").every((s) => s === ws)) {
        this.positions.clear();
        await this.ctx.storage.delete("server"); // server went away: status shows offline right away
      }
      return;
    }
    this.broadcast({ type: "left", id: a.id });
    await this.cleanupGroups();
    this.sendRoster();
  }

  // ---------- messages ----------
  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const a = ws.deserializeAttachment();
    if (!a) return;
    try {
      if (a.kind === "plugin") return this.onPlugin(msg);
      await this.onVoice(ws, a, msg);
    } catch (e) {
      console.error("voice error", e);
      if (msg.req) this.send(ws, { type: "reply", req: msg.req, error: e.message || "Something went wrong." });
    }
  }

  onPlugin(msg) {
    if (msg.type === "answer" && msg.req) {
      const done = this.waiting?.get(msg.req);
      if (done) done(msg);
      return;
    }
    if (msg.type === "chatfilter_state") {
      return this.ctx.storage.put("chatfilter", { enabled: Boolean(msg.enabled), at: Date.now() });
    }
    if (msg.type === "events") {
      const events = (Array.isArray(msg.events) ? msg.events : []).slice(0, 50);
      return this.ctx.storage.put("events", { events, at: Date.now() });
    }
    if (msg.type === "ah") {
      const listings = (Array.isArray(msg.listings) ? msg.listings : []).slice(0, 300);
      return this.ctx.storage.put("ah", { listings, at: Date.now() });
    }
    if (msg.type === "seen") {
      return recordPlayers(this.env, msg.players).catch((e) => console.error("record players failed", e));
    }
    if (msg.type === "balances") {
      return recordBalances(this.env, msg.players).catch((e) => console.error("record balances failed", e));
    }
    if (msg.type === "server") {
      const info = {
        at: Date.now(),
        online: Math.max(0, Number(msg.online) || 0),
        max: Math.max(0, Number(msg.max) || 0),
        version: String(msg.version || "").slice(0, 40),
      };
      return this.ctx.storage.put("server", info);
    }
    if (msg.type !== "positions" || !Array.isArray(msg.players)) return;
    const now = Date.now();
    for (const p of msg.players.slice(0, 500)) {
      if (!p || typeof p.uuid !== "string") continue;
      this.positions.set(p.uuid.toLowerCase(), {
        x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0,
        yaw: Number(p.yaw) || 0, dim: String(p.dim || "Overworld"), at: now,
      });
    }
    for (const [k, v] of this.positions) if (now - v.at > POSITION_STALE_MS * 4) this.positions.delete(k);

    // Send each voice user's position (never coordinates of people not in voice).
    const list = [];
    let inGameChanged = false;
    for (const { a } of this.members().values()) {
      const p = this.position(a);
      if (p) list.push([a.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10, Math.round(p.yaw), p.dim]);
      const inGame = Boolean(p);
      if (inGame !== Boolean(a._wasInGame)) inGameChanged = true;
    }
    if (inGameChanged) {
      for (const { ws, a } of this.members().values()) this.update(ws, { _wasInGame: Boolean(this.position(a)) });
      this.sendRoster();
    }
    this.broadcast({ type: "pos", list });
  }

  async onVoice(ws, a, msg) {
    const reply = (data) => this.send(ws, { type: "reply", req: msg.req, ...data });
    switch (msg.type) {
      case "state": {
        const patch = {};
        if (typeof msg.mic === "boolean") patch.micOn = msg.mic && !this.isVoiceMuted(a);
        if (typeof msg.deafened === "boolean") patch.deafened = msg.deafened;
        if (typeof msg.talking === "boolean") patch.talking = msg.talking;
        const b = this.update(ws, patch);
        if ("talking" in patch && Object.keys(patch).length === 1) {
          this.broadcast({ type: "talk", id: b.id, on: Boolean(b.talking && b.micOn && !this.isVoiceMuted(b)) });
          this.sendIcons();
        } else {
          this.sendRoster();
        }
        return;
      }
      case "rtc.session": {
        const data = await this.rtc("POST", "/sessions/new");
        this.update(ws, { sessionId: data.sessionId, trackName: null });
        return reply({ ok: true });
      }
      case "rtc.push": {
        if (!a.sessionId) throw new Error("No voice session.");
        const trackName = `u${a.id}`;
        const data = await this.rtc("POST", `/sessions/${a.sessionId}/tracks/new`, {
          sessionDescription: { type: "offer", sdp: String(msg.sdp) },
          tracks: [{ location: "local", mid: String(msg.mid), trackName }],
        });
        this.update(ws, { trackName });
        this.sendRoster();
        return reply({ ok: true, answer: data.sessionDescription });
      }
      case "rtc.pull": {
        if (!a.sessionId) throw new Error("No voice session.");
        const members = this.members();
        const wanted = (Array.isArray(msg.owners) ? msg.owners : []).slice(0, 40);
        const allowed = [];
        for (const id of wanted) {
          const m = members.get(Number(id));
          if (m && this.canHear(a, m.a)) allowed.push(m.a);
        }
        if (!allowed.length) return reply({ ok: true, tracks: [] });
        const data = await this.rtc("POST", `/sessions/${a.sessionId}/tracks/new`, {
          tracks: allowed.map((s) => ({ location: "remote", sessionId: s.sessionId, trackName: s.trackName })),
        });
        const tracks = (data.tracks || [])
          .filter((t) => !t.errorCode && t.mid)
          .map((t) => ({ mid: t.mid, owner: allowed.find((s) => s.trackName === t.trackName && s.sessionId === t.sessionId)?.id }))
          .filter((t) => t.owner);
        return reply({ ok: true, tracks, offer: data.requiresImmediateRenegotiation ? data.sessionDescription : null });
      }
      case "rtc.renegotiate": {
        await this.rtc("PUT", `/sessions/${a.sessionId}/renegotiate`, {
          sessionDescription: { type: "answer", sdp: String(msg.sdp) },
        });
        return reply({ ok: true });
      }
      case "rtc.close": {
        const mids = (Array.isArray(msg.mids) ? msg.mids : []).map(String).slice(0, 40);
        if (!mids.length || !a.sessionId) return reply({ ok: true });
        const data = await this.rtc("PUT", `/sessions/${a.sessionId}/tracks/close`, {
          tracks: mids.map((mid) => ({ mid })),
          sessionDescription: msg.sdp ? { type: "offer", sdp: String(msg.sdp) } : undefined,
          force: !msg.sdp,
        });
        return reply({ ok: true, answer: data.sessionDescription || null });
      }
      case "global": {
        if (msg.on && !a.canGlobal) throw new Error("You don't have the Global Mic.");
        this.update(ws, { global: Boolean(msg.on) });
        this.sendRoster();
        return reply({ ok: true });
      }
      case "group.create": {
        if (Object.keys(this.groups).length >= MAX_GROUPS) throw new Error("There are too many groups right now.");
        const name = String(msg.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
        if (name.length < 2) throw new Error("Group names need at least 2 characters.");
        const check = checkMessage(name, await this.wordList());
        if (!check.ok) throw new Error("That group name isn't allowed.");
        const password = String(msg.password || "");
        if (password && password.length < 3) throw new Error("Group passwords need at least 3 characters.");
        const id = crypto.randomUUID().slice(0, 8);
        this.groups[id] = { id, name, passwordHash: password ? await sha256(`${id}:${password}`) : null, createdBy: a.id };
        await this.saveGroups();
        this.update(ws, { groupId: id });
        await this.cleanupGroups();
        this.sendRoster();
        return reply({ ok: true, group: id });
      }
      case "group.join": {
        const g = this.groups[String(msg.id)];
        if (!g) throw new Error("That group no longer exists.");
        const staff = (a.power || 0) >= 50;
        if (g.passwordHash && !staff && (await sha256(`${g.id}:${String(msg.password || "")}`)) !== g.passwordHash) {
          throw new Error("Wrong group password.");
        }
        this.update(ws, { groupId: g.id });
        await this.cleanupGroups();
        this.sendRoster();
        return reply({ ok: true });
      }
      case "group.leave": {
        this.update(ws, { groupId: null });
        await this.cleanupGroups();
        this.sendRoster();
        return reply({ ok: true });
      }
    }
  }

  async sendRanks() {
    const plugin = this.pluginSocket();
    if (!plugin) return;
    try {
      const state = await loadRanksState(getDb(this.env));
      this.send(plugin, { type: "ranks", ...state });
    } catch (e) {
      console.error("ranks load failed", e);
    }
  }

  async sendShop() {
    const plugin = this.pluginSocket();
    if (!plugin) return;
    try {
      const sql = getDb(this.env);
      this.send(plugin, { type: "shop", shop: await loadShop(sql) });
      this.send(plugin, { type: "help", help: (await loadHelp(sql)).help });
      this.send(plugin, await planMessage(sql));
      await this.sendWords();
    } catch (e) {
      console.error("shop load failed", e);
    }
  }

  // The in-game chat filter uses the same word list as the website.
  async sendWords() {
    const plugin = this.pluginSocket();
    if (!plugin) return;
    const rows = await getDb(this.env)`SELECT word, match FROM filter_words`;
    this.send(plugin, { type: "words", words: rows.map((r) => ({ word: r.word, match: r.match })) });
  }

  // ---------- staff actions (from the website's moderation API) ----------
  async handleInternal(event) {
    const targets = this.ctx.getWebSockets(`user:${event.userId}`);
    if (event.type === "voice_mute") {
      for (const ws of targets) {
        this.update(ws, { voiceMutedUntil: event.until, micOn: false, talking: false, global: false });
        this.send(ws, { type: "voice_muted", until: event.until, reason: event.reason || "" });
      }
      this.broadcast({ type: "revoke", owner: event.userId });
      this.sendRoster();
    } else if (event.type === "voice_unmute") {
      for (const ws of targets) {
        this.update(ws, { voiceMutedUntil: null });
        this.send(ws, { type: "voice_muted", until: null });
      }
      this.sendRoster();
    } else if (event.type === "voice_kick") {
      for (const ws of targets) {
        this.send(ws, { type: "closed", reason: event.reason || "A staff member removed you from voice." });
        try { ws.close(4004, "kicked"); } catch { /* gone */ }
      }
      this.broadcast({ type: "revoke", owner: event.userId });
      await this.cleanupGroups();
      this.sendRoster();
    } else if (event.type === "global_mic") {
      for (const ws of targets) {
        const a = this.update(ws, { canGlobal: Boolean(event.allowed) || (ws.deserializeAttachment().power || 0) >= 50 });
        if (!a.canGlobal && a.global) this.update(ws, { global: false });
      }
      this.sendRoster();
    } else if (event.type === "role_changed" || event.type === "banned") {
      for (const ws of targets) {
        this.send(ws, { type: "closed", reason: event.type === "banned" ? "Your account has been banned." : "Your role changed. Please rejoin voice." });
        try { ws.close(4005, "changed"); } catch { /* gone */ }
      }
      this.sendRoster();
    } else if (event.type === "words_changed") {
      this.words = null;
      await this.sendWords();
    } else if (event.type === "ranks_changed") {
      await this.sendRanks();
    }
  }
}
