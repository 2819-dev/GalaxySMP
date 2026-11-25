import { flooding, closeFlooder } from "../lib/flood.js";
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
import { recordStats, recordAchievementDefs } from "../routes/progress.js";
import { recordHead, recordHeadError } from "../routes/heads.js";
import { DurableObject } from "cloudflare:workers";
import { getDb } from "../lib/db.js";
import { checkMessage, compileWordList } from "../lib/filter.js";
import { sha256 } from "../lib/crypto.js";
import { loadRanksState, recordPlayers } from "../routes/ranks.js";
import { loadShop, recordBalances } from "../routes/economy.js";
import { loadHelp, welcomeMessage } from "../routes/help.js";
import { planMessage } from "../routes/plans.js";
import { pluginMessage as serverControlMessage } from "../routes/servercontrol.js";
import { hubStub } from "../routes/chat.js";
import { notify } from "../routes/notify.js";
import { recordChunks } from "../routes/map.js";
import { tradeFromGame } from "../routes/trades.js";

const DOWN_AFTER_MS = 3 * 60 * 1000; // quick restarts (under 3 minutes) don't send notifications

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
      // The locked Staff group: always there, only members with the Staff category permission can join
      if (!this.groups.staff) this.groups.staff = { id: "staff", name: "Staff", description: "Staff only", room: true, staffOnly: true, passwordHash: null, createdBy: null, position: 0 };
    });
  }

  // ---------- helpers ----------
  voiceSockets() {
    return this.ctx.getWebSockets("voice").filter((ws) => !ws.deserializeAttachment()?.gone);
  }

  pluginSocket() {
    // The newest live connection. After a crash or reconnect the old one can still be listed for a while:
    // never send to it (ranks, shop and settings sent there were lost, so ranks fell back to plan tags).
    const live = this.ctx.getWebSockets("plugin").filter((ws) => !ws.deserializeAttachment()?.gone);
    return live[live.length - 1] || null;
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
    return Object.values(this.groups).map((g) => ({
      id: g.id, name: g.name, locked: Boolean(g.passwordHash), saved: Boolean(g.saved), owner: g.createdBy,
      room: Boolean(g.room), staffOnly: Boolean(g.staffOnly), position: g.position ?? 0, description: g.description || "",
      members: (g.members || []).map((m) => ({ id: m.id, username: m.username })),
    }));
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

  // The server stopped suddenly and is back: tell the linked players who were online then (a notification + phone alert).
  async backOnline(names) {
    try {
      names = (names || []).map((n) => String(n).toLowerCase()).filter(Boolean);
      if (!names.length) return;
      const sql = getDb(this.env);
      const rows = await sql`SELECT u.id FROM users u JOIN players p ON p.uuid = u.mc_uuid WHERE lower(p.gamertag) = ANY(${names}) AND NOT u.banned`;
      if (!rows.length) return;
      const { notify } = await import("../routes/notify.js");
      await notify(this.env, rows.map((r) => Number(r.id)), "community", {
        title: "GalaxySMP is back online!", body: "Sorry about that. The server is running again, jump back in!", url: "/status", tag: "server-back" });
    } catch (e) { console.error("back online alert failed", e); }
  }

  async wordList() {
    if (this.words && Date.now() - this.wordsAt < 60_000) return this.words;
    const rows = await getDb(this.env)`SELECT word, match FROM filter_words WHERE NOT EXISTS (SELECT 1 FROM economy_config WHERE key = 'chatfilter_off')`;
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
      if (!used.has(id) && !this.groups[id].saved && !this.groups[id].room) { delete this.groups[id]; changed = true; } // saved groups and rooms stay
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
    if (this.groups[speaker.groupId]?.staffOnly) return false; // the Staff group is private: no one nearby hears it
    const p = this.position(listener);
    const q = this.position(speaker);
    if (!p || !q || p.dim !== q.dim) return false;
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) <= PULL_RANGE;
  }

  // ---------- connections ----------
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/internal/bwlive") {
      return Response.json((await this.ctx.storage.get("bwlive")) || {});
    }
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
    if (url.pathname === "/internal/rooms") {
      // Voice rooms made by Admins (Control Panel): permanent groups anyone can join.
      if (request.method === "POST") {
        const body = await request.json();
        const rooms = Object.values(this.groups).filter((g) => g.room && !g.staffOnly);
        if (body.action === "add") {
          if (rooms.length >= 12) return Response.json({ ok: false, error: "You can have up to 12 rooms." });
          const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
          if (name.length < 2) return Response.json({ ok: false, error: "Room names need at least 2 characters." });
          const id = `room-${crypto.randomUUID().slice(0, 6)}`;
          this.groups[id] = { id, name, description: String(body.description || "").trim().slice(0, 80), room: true, passwordHash: null, createdBy: null,
            position: rooms.length ? Math.max(...rooms.map((r) => r.position || 0)) + 1 : 1 };
        } else {
          const g = this.groups[String(body.id)];
          if (!g?.room || g.staffOnly) return Response.json({ ok: false, error: "That room no longer exists." });
          if (body.action === "rename") {
            const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 24);
            if (name.length < 2) return Response.json({ ok: false, error: "Room names need at least 2 characters." });
            g.name = name;
            g.description = String(body.description ?? g.description ?? "").trim().slice(0, 80);
          } else if (body.action === "move") {
            const list = rooms.sort((x, y) => (x.position || 0) - (y.position || 0));
            const i = list.indexOf(g), j = i + (body.dir < 0 ? -1 : 1);
            if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
            list.forEach((r, k) => { r.position = k + 1; });
          } else if (body.action === "delete") {
            for (const { ws, a } of this.members().values()) if (a.groupId === g.id) this.update(ws, { groupId: null });
            delete this.groups[g.id];
          } else return Response.json({ ok: false, error: "Unknown action." });
        }
        await this.saveGroups();
        this.sendRoster();
      }
      const list = Object.values(this.groups).filter((g) => g.room && !g.staffOnly).sort((x, y) => (x.position || 0) - (y.position || 0))
        .map((g) => ({ id: g.id, name: g.name, description: g.description || "", inRoom: [...this.members().values()].filter(({ a }) => a.groupId === g.id).length }));
      return Response.json({ ok: true, rooms: list });
    }
    if (url.pathname === "/internal/map") {
      const [live, marks] = await Promise.all([this.ctx.storage.get("map_live"), this.ctx.storage.get("map_markers")]);
      const fresh = live && Date.now() - live.at < 30_000;
      return Response.json({ players: fresh ? live.players : [], playersAt: live?.at || null, markers: marks?.markers || [], plots: marks?.plots || [],
        status: marks?.status || null, statusAt: marks?.at || null });
    }
    if (url.pathname === "/internal/shopchests") {
      return Response.json((await this.ctx.storage.get("shopchests")) || { shops: [], at: null });
    }
    if (url.pathname === "/internal/plots") {
      return Response.json((await this.ctx.storage.get("plot_listings")) || { plots: [], at: null });
    }
    if (url.pathname === "/internal/orders") {
      return Response.json((await this.ctx.storage.get("buy_orders")) || { orders: [], at: null });
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

    if (request.headers.get("X-GSMP-Plugin") === "1" && !request.headers.get("X-GSMP-User")) {
      for (const old of this.ctx.getWebSockets("plugin")) {
        try { old.serializeAttachment({ ...(old.deserializeAttachment() || {}), kind: "plugin", gone: true }); } catch { /* gone */ }
        try { old.close(1000, "replaced"); } catch { /* gone */ }
      }
      this.ctx.acceptWebSocket(server, ["plugin"]);
      server.serializeAttachment({ kind: "plugin" });
      this.ctx.waitUntil(this.serverUp());
      this.send(server, { type: "active", on: this.voiceSockets().length > 0 });
      this.sendIcons();
      this.ctx.waitUntil(this.sendRanks());
      this.ctx.waitUntil(this.sendShop());
      this.ctx.waitUntil(import("../routes/rewards.js").then((m) => m.sendRewards(this.env, undefined, (msg) => { this.send(server, msg); return true; })).catch(() => {}));
      this.ctx.waitUntil(this.sendMapSetting());
      this.ctx.waitUntil(import("../routes/teams.js").then(async (m) => this.send(server, await m.teamsState(getDb(this.env)))).catch(() => {}));
      this.ctx.waitUntil(import("../routes/potm.js").then(async (m) => this.send(server, await m.potmState(getDb(this.env)))).catch(() => {}));
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
        await this.ctx.storage.put("pluginGoneAt", Date.now());
        await this.wakeAt(Date.now() + DOWN_AFTER_MS); // still gone in 3 minutes: tell members
      }
      return;
    }
    this.broadcast({ type: "left", id: a.id });
    await this.cleanupGroups();
    this.sendRoster();
  }

  // the hub has one alarm: never put it later than it already is
  async wakeAt(at) {
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || at < cur) await this.ctx.storage.setAlarm(at);
  }

  // ---------- server online / offline notifications ----------
  async alarm() {
    const goneAt = await this.ctx.storage.get("pluginGoneAt");
    if (!goneAt || this.pluginSocket()) return;
    if (await this.ctx.storage.get("downNotified")) return;
    if (Date.now() - goneAt < DOWN_AFTER_MS - 1000) return this.wakeAt(goneAt + DOWN_AFTER_MS);   // woken early
    await this.ctx.storage.put("downNotified", goneAt);
    await notify(this.env, "all", "server", {
      title: "GalaxySMP is offline", body: "The server is restarting or down. We'll let you know when it's back.", url: "/status", tag: "server", ttl: 3600,
    }).catch(() => {});
  }

  async serverUp() {
    await this.ctx.storage.delete("pluginGoneAt");
    const notified = await this.ctx.storage.get("downNotified");
    if (!notified) return;
    await this.ctx.storage.delete("downNotified");
    await notify(this.env, "all", "server", {
      title: "GalaxySMP is back online", body: "Come play! galaxymc.smp.live", url: "/", tag: "server", ttl: 3600, urgent: true,
    }).catch(() => {});
  }

  // ---------- messages ----------
  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    const a = ws.deserializeAttachment();
    if (!a) return;
    try {
      if (a.kind === "plugin") return await this.onPlugin(msg);
      if (flooding(ws)) return closeFlooder(ws);
      if (msg.type === "rtc.session" && flooding(ws, "rtc", 0.4, 4)) throw new Error("Slow down a little.");
      await this.onVoice(ws, a, msg);
    } catch (e) {
      console.error("voice error", e);
      if (msg.req) this.send(ws, { type: "reply", req: msg.req, error: e.message || "Something went wrong." });
    }
  }

  onPlugin(msg) {
    if (["call_start", "call_add", "call_accept", "call_decline", "call_leave"].includes(msg.type) && msg.xuid) {
      // /call in game: calls have their own hub (src/calls/hub.js)
      return import("../routes/calls.js").then((m) => m.callsStub(this.env).fetch("https://calls/internal/game", { method: "POST", body: JSON.stringify(msg) }))
        .catch((e) => console.error("call from game", e));
    }
    if (msg.type === "answer" && msg.req) {
      const done = this.waiting?.get(msg.req);
      if (done) done(msg);
      return;
    }
    if (msg.type === "announcement") { // a staff announcement in game: notify members who want them
      const text = String(msg.text || "").slice(0, 200);
      if (text) {
        const by = String(msg.by || "").toLowerCase().slice(0, 40);
        this.ctx.waitUntil((async () => {
          // not the person who made it (their website account, or the account linked to their Minecraft name)
          const sql = getDb(this.env);
          const own = by ? await sql`SELECT u.id FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
                                     WHERE u.username_lower = ${by} OR lower(p.gamertag) = ${by}` : [];
          await notify(this.env, "all", "announcements", { title: "GalaxySMP announcement", body: text, url: "/", tag: "announcement", ttl: 3 * 3600 },
            { exclude: own.map((r) => Number(r.id)) });
        })().catch(() => {}));
      }
      return;
    }
    if (msg.type === "server_crash") {  // the server didn't stop properly last time: show it in #Staff Logs
      const clip = (v, n) => String(v ?? "").slice(0, n);
      const details = {
        by: "Server", lastSeen: clip(msg.lastSeen, 40), uptimeMinutes: Number(msg.uptimeMinutes) || null, doing: clip(msg.doing, 200),
        players: (Array.isArray(msg.players) ? msg.players : []).slice(0, 40).map((p) => clip(p, 32)),
        logFile: msg.log?.file ? clip(msg.log.file, 120) : null,
        log: (Array.isArray(msg.log?.lines) ? msg.log.lines : []).slice(-150).map((l) => clip(l, 300)),
        cause: msg.cause ? clip(msg.cause, 300) : null, downSeconds: Number(msg.downSeconds) || null,
        containerRestarted: Boolean(msg.containerRestarted),
        lastHealth: msg.lastHealth && typeof msg.lastHealth === "object" && JSON.stringify(msg.lastHealth).length < 4000 ? msg.lastHealth : null,
        cgroup: msg.cgroup && typeof msg.cgroup === "object" ? Object.fromEntries(Object.entries(msg.cgroup).slice(0, 8).map(([k, v]) => [clip(k, 20), Number(v) || 0])) : {},
        traceback: (Array.isArray(msg.traceback) ? msg.traceback : []).slice(0, 80).map((l) => clip(l, 300)),
        memory: Object.fromEntries(Object.entries(msg.memory && typeof msg.memory === "object" ? msg.memory : {}).slice(0, 8).map(([k, v]) => [clip(k, 20), Number(v) || 0])),
        // memory every 2 seconds for the last 2 minutes: [seconds since start, MB]
        memTrail: (Array.isArray(msg.memTrail) ? msg.memTrail : []).slice(-60).filter(Array.isArray).map(([s, m]) => [Number(s) || 0, Number(m) || 0]),
        endstoneCrash: msg.endstoneCrash && typeof msg.endstoneCrash === "object" ? { file: clip(msg.endstoneCrash.file, 120),
          lines: (Array.isArray(msg.endstoneCrash.lines) ? msg.endstoneCrash.lines : []).slice(-80).map((l) => clip(l, 300)) } : null,
      };
      this.backOnline(details.players);   // (in the background; it catches its own errors)
      return getDb(this.env)`INSERT INTO audit_log (actor_id, action, details) VALUES (NULL, 'server.crash', ${JSON.stringify(details)}::jsonb)`
        .catch((e) => console.error("crash report failed", e));
    }
    // Diagnostics (troubleshooting): the console, grouped errors, health readings, start/stop. Stored only.
    if (msg.type === "diag_console") {
      const lines = (Array.isArray(msg.lines) ? msg.lines : []).slice(0, 500).filter((l) => Array.isArray(l) && l.length >= 3);
      if (Number(msg.dropped) > 0) lines.push([Date.now(), "WARNING", `(${Number(msg.dropped)} console lines were skipped while the website was unreachable)`]);
      if (!lines.length) return;
      const at = lines.map((l) => new Date(Number(l[0]) || Date.now()).toISOString());
      const level = lines.map((l) => String(l[1] || "INFO").slice(0, 12));
      const text = lines.map((l) => String(l[2] ?? "").slice(0, 4000));
      return getDb(this.env)`INSERT INTO server_console (at, level, text) SELECT * FROM unnest(${at}::timestamptz[], ${level}::text[], ${text}::text[])`
        .catch((e) => console.error("console save failed", e));
    }
    if (msg.type === "diag_errors") {
      const sql = getDb(this.env);
      return (async () => {
        for (const e of (Array.isArray(msg.errors) ? msg.errors : []).slice(0, 50)) {
          const sig = String(e.sig || "").slice(0, 32);
          if (!sig) continue;
          const first = new Date(Number(e.first) || Date.now()).toISOString(), last = new Date(Number(e.last) || Date.now()).toISOString();
          // an error that comes back after being marked fixed is shown as new again
          await sql`INSERT INTO server_errors (sig, level, message, detail, count, first_at, last_at)
                    VALUES (${sig}, ${String(e.level || "ERROR").slice(0, 12)}, ${String(e.message || "").slice(0, 300)}, ${String(e.detail || "").slice(0, 4000)}, ${Math.max(1, Number(e.count) || 1)}, ${first}, ${last})
                    ON CONFLICT (sig) DO UPDATE SET count = server_errors.count + EXCLUDED.count, last_at = EXCLUDED.last_at, detail = EXCLUDED.detail, fixed_at = NULL`;
        }
      })().catch((e) => console.error("errors save failed", e));
    }
    if (msg.type === "diag_health") {
      const data = JSON.stringify(msg.health && typeof msg.health === "object" ? msg.health : {}).slice(0, 6000);
      return getDb(this.env)`INSERT INTO server_health (data) VALUES (${data.endsWith("}") ? data : "{}"}::jsonb)`.catch((e) => console.error("health save failed", e));
    }
    if (msg.type === "diag_event") {
      const data = JSON.stringify(msg.data && typeof msg.data === "object" ? msg.data : {}).slice(0, 6000);
      return getDb(this.env)`INSERT INTO server_events (kind, data) VALUES (${String(msg.event || "event").slice(0, 20)}, ${data.endsWith("}") ? data : "{}"}::jsonb)`.catch((e) => console.error("event save failed", e));
    }
    if (msg.type === "ah_sale") {  // for the Auction House price history
      return import("../routes/community.js").then((m) => m.recordAhSale(this.env, msg)).catch((e) => console.error("ah sale failed", e));
    }
    if (msg.type === "gamechat") {  // someone chatted in Minecraft: show it in #Chat
      return import("../routes/gamechat.js").then((m) => m.fromGame(this.env, msg)).catch((e) => console.error("game chat failed", e));
    }
    if (msg.type === "rewards_done") {  // the plugin gave these rewards (money, crate keys)
      return import("../routes/rewards.js").then((m) => m.rewardsDone(this.env, msg.ids)).catch((e) => console.error("rewards done failed", e));
    }
    if (msg.type === "chatfilter_state") {
      // the word filter is one switch for the game and the website
      return import("../routes/mod.js").then((m) => m.setWebFilter(this.env, Boolean(msg.enabled)))
        .then(() => this.ctx.storage.put("chatfilter", { enabled: Boolean(msg.enabled), at: Date.now() }))
        .catch((e) => console.error("chat filter sync failed", e));
    }
    if (msg.type === "events") {
      const events = (Array.isArray(msg.events) ? msg.events : []).slice(0, 50);
      return this.ctx.storage.put("events", { events, at: Date.now() });
    }
    if (msg.type === "trade_update") {  // accepted / declined / cancelled with /trade in game
      return tradeFromGame(this.env, msg).catch((e) => console.error("trade update failed", e));
    }
    if (msg.type === "map_chunks") {
      return recordChunks(this.env, msg).catch((e) => console.error("map chunks failed", e));
    }
    if (msg.type === "map_live") {
      const players = (Array.isArray(msg.players) ? msg.players : []).slice(0, 200).map((p) => ({
        name: String(p.name || "").slice(0, 32), xuid: String(p.xuid || "").slice(0, 20), x: Number(p.x) || 0, z: Number(p.z) || 0, yaw: Number(p.yaw) || 0 }));
      return this.ctx.storage.put("map_live", { players, at: Date.now() });
    }
    if (msg.type === "map_markers") {
      const markers = (Array.isArray(msg.markers) ? msg.markers : []).slice(0, 250).map((m) => ({
        kind: String(m.kind || "").slice(0, 12), label: String(m.label || "").slice(0, 40), owner: String(m.owner || "").slice(0, 32) || undefined,
        x: Number(m.x) || 0, z: Number(m.z) || 0 }));
      const plots = (Array.isArray(msg.plots) ? msg.plots : []).slice(0, 2000).map((p) => ({
        kind: String(p.kind || "plot").slice(0, 8), label: String(p.label || "").slice(0, 40), owner: String(p.owner || "").slice(0, 32),
        id: p.id != null ? String(p.id).slice(0, 20) : null, ownerXuid: p.owner_xuid ? String(p.owner_xuid).slice(0, 20) : null, public: Boolean(p.public),
        visibility: ["public", "location", "hidden"].includes(p.visibility) ? p.visibility : (p.public ? "public" : "hidden"),
        x1: Number(p.x1) || 0, z1: Number(p.z1) || 0, x2: Number(p.x2) || 0, z2: Number(p.z2) || 0 }));
      const st = msg.status && typeof msg.status === "object" ? msg.status : {};
      const status = { sent: Number(st.sent) || 0, error: st.error ? String(st.error).slice(0, 200) : null, method: st.method ? String(st.method).slice(0, 10) : null };
      return this.ctx.storage.put("map_markers", { markers, plots, status, at: Date.now() });
    }
    if (msg.type === "shopchests") {
      const shops = (Array.isArray(msg.shops) ? msg.shops : []).slice(0, 1000).map((x) => ({
        id: Number(x.id) || 0, owner: String(x.owner || "").slice(0, 20), ownerName: String(x.ownerName || "").slice(0, 32),
        item: String(x.item || "").slice(0, 80), name: String(x.name || "").slice(0, 60), amount: Number(x.amount) || 1,
        price: Number(x.price) || 0, stock: Number(x.stock) || 0, shop: String(x.shop || "").slice(0, 40),
        dim: String(x.dim || "").slice(0, 20), x: Number(x.x) || 0, y: Number(x.y) || 0, z: Number(x.z) || 0 }));
      // price alerts also look at player shops
      return this.ctx.storage.put("shopchests", { shops, at: Date.now() }).then(() => import("../routes/community.js")).then((m) => m.checkShopAlerts(this.env, shops)).then((hits) => {
        const plugin = this.pluginSocket();
        if (plugin && hits.length) this.send(plugin, { type: "ah_alert", alerts: hits.slice(0, 50) });
      }).catch((e) => console.error("shop alerts failed", e));
    }
    if (msg.type === "parkour_courses" || msg.type === "parkour_time") {  // parkour courses and best times (Leaderboards > Parkour)
      return import("../routes/progress.js").then((m) => m.parkourFromGame(this.env, msg)).catch((e) => console.error("parkour failed", e));
    }
    if (msg.type === "plot_listings") {  // plots for sale or rent (Marketplace > Plots)
      const plots = (Array.isArray(msg.plots) ? msg.plots : []).slice(0, 300).map((p) => ({
        id: Number(p.id) || 0, label: String(p.label || "").slice(0, 40), owner: String(p.owner || "").slice(0, 32), ownerXuid: String(p.ownerXuid || "").slice(0, 20),
        shop: Boolean(p.shop), dim: String(p.dim || "").slice(0, 20), x: Number(p.x) || 0, z: Number(p.z) || 0, w: Number(p.w) || 0, l: Number(p.l) || 0, h: Number(p.h) || 0,
        type: p.type === "rent" ? "rent" : "sell", price: Number(p.price) || 0, maxDays: Number(p.maxDays) || 1, rentedUntil: Number(p.rentedUntil) || null }));
      return this.ctx.storage.put("plot_listings", { plots, at: Date.now() });
    }
    if (msg.type === "pets") {  // a player's tamed pets (My Pets on profiles)
      return import("../routes/progress.js").then((m) => m.petsFromGame(this.env, msg)).catch((e) => console.error("pets save failed", e));
    }
    if (msg.type === "collection") {  // new item types a player collected (Collection book on profiles)
      return import("../routes/progress.js").then((m) => m.collectionFromGame(this.env, msg)).catch((e) => console.error("collection save failed", e));
    }
    if (msg.type === "market_sale") {  // a Marketplace sale: the buyer can rate the seller
      return import("../routes/community.js").then((m) => m.recordPurchase(this.env, msg)).catch((e) => console.error("purchase save failed", e));
    }
    if (msg.type === "buy_orders") {  // Marketplace buy orders (kept by the plugin, shown on the website)
      const orders = (Array.isArray(msg.orders) ? msg.orders : []).slice(0, 300).map((o) => ({
        id: Number(o.id) || 0, buyer: String(o.buyer || "").slice(0, 32), buyerXuid: String(o.buyerXuid || "").slice(0, 20),
        item: String(o.item || "").slice(0, 80), label: String(o.label || "").slice(0, 80), want: Number(o.want) || 0,
        filled: Number(o.filled) || 0, each: Number(o.each) || 0, expires: Number(o.expires) || 0 }));
      return this.ctx.storage.put("buy_orders", { orders, at: Date.now() });
    }
    if (msg.type === "ah") {
      const listings = (Array.isArray(msg.listings) ? msg.listings : []).slice(0, 300);
      // price alerts: tell players about new listings at or below their price
      return this.ctx.storage.put("ah", { listings, at: Date.now() }).then(() => import("../routes/community.js")).then((m) => m.checkAhAlerts(this.env, listings)).then((hits) => {
        const plugin = this.pluginSocket();
        if (plugin && hits.length) this.send(plugin, { type: "ah_alert", alerts: hits.slice(0, 50) });
      }).catch((e) => console.error("ah alerts failed", e));
    }
    if (msg.type === "seen") {
      // friends first (it needs to know who was already online), then the usual player update
      return import("../routes/friends.js").then((m) => m.friendsJoined(this.env, msg.players)).catch((e) => console.error("friend alerts failed", e))
        .then(() => recordPlayers(this.env, msg.players)).catch((e) => console.error("record players failed", e));
    }
    if (msg.type === "need_ranks") {  // the plugin didn't get the ranks: send them again
      return this.sendRanks();
    }
    if (msg.type === "bw_live") {  // the Bedwars game running now, for the live view on the website
      return this.ctx.storage.put("bwlive", { ...msg, at: Date.now() });
    }
    if (msg.type === "bw_match") {  // a Bedwars game finished: match history
      return import("../routes/bedwars.js").then((m) => m.recordMatch(this.env, msg)).catch((e) => console.error("bw match failed", e));
    }
    if (msg.type === "pvp_match") {  // a PvP match finished: match history
      return import("../routes/pvp.js").then((m) => m.recordMatch(this.env, msg)).catch((e) => console.error("pvp match failed", e));
    }
    if (msg.type === "bw_lobby") {  // players waiting for Bedwars: alerts for members who want them
      return import("../routes/bedwars.js").then((m) => m.lobbyAlert(this.env, this.ctx.storage, msg)).catch((e) => console.error("bw lobby failed", e));
    }
    if (msg.type === "potm_vote" || msg.type === "potm_set" || msg.type === "potm_mine") {  // Player of the Month (Voting Computers)
      return import("../routes/potm.js").then((m) => m.fromGame(this.env, msg)).catch((e) => console.error("potm failed", e));
    }
    if (msg.type === "teamchat") {  // /tc in game: into the team chat on the website
      return import("../routes/teams.js").then((m) => m.fromGame(this.env, msg)).catch((e) => console.error("team chat failed", e));
    }
    if (msg.type === "crates") {  // what's inside each crate, for the Crate Odds page
      const clip = (v, n) => String(v ?? "").slice(0, n);
      const crates = (Array.isArray(msg.crates) ? msg.crates : []).slice(0, 6).map((c) => ({
        key: clip(c.key, 20), name: clip(c.name, 40),
        prizes: (Array.isArray(c.prizes) ? c.prizes : []).slice(0, 60).map((p) => ({
          label: clip(p.label, 60), kind: clip(p.kind, 10), item: p.item ? clip(p.item, 60) : null, key: p.key ? clip(p.key, 20) : null,
          count: Number(p.count) || 1, cents: p.cents == null ? null : Number(p.cents) || 0, chance: Math.max(0, Math.min(100, Number(p.chance) || 0)),
        })),
      }));
      const value = { crates, keyPrice: Math.max(0, Number(msg.keyPrice) || 0), at: new Date().toISOString() };
      return getDb(this.env)`INSERT INTO economy_config (key, value, updated_by) VALUES ('crate_odds', ${JSON.stringify(value)}::jsonb, 'server')
                              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = 'server'`.catch((e) => console.error("crate odds failed", e));
    }
    if (msg.type === "build_contest") {  // a Build Contest finished: wins on profiles + #Timeline
      return import("../routes/friends.js").then((m) => m.recordContest(this.env, msg)).catch((e) => console.error("build contest failed", e));
    }
    if (msg.type === "head_error") {
      return recordHeadError(this.env, msg).catch((e) => console.error("record head error failed", e));
    }
    if (msg.type === "head") {
      return recordHead(this.env, msg).catch((e) => console.error("record head failed", e));
    }
    if (msg.type === "stats") {
      return recordStats(this.env, msg.players, msg.online).catch((e) => console.error("record stats failed", e));
    }
    if (msg.type === "achievement_defs") {
      return recordAchievementDefs(this.env, msg.list).catch((e) => console.error("record achievements failed", e));
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
        plugin: String(msg.plugin || "").slice(0, 20),
        iconsPack: String(msg.iconsPack || "").slice(0, 20),
        iconConflicts: Array.isArray(msg.iconConflicts) ? msg.iconConflicts.slice(0, 5).map((x) => String(x).slice(0, 80)) : [],
        players: Array.isArray(msg.players) ? msg.players.slice(0, 60).filter((p) => p && /^\d{1,20}$/.test(String(p.xuid || "")))
          .map((p) => ({ xuid: String(p.xuid), name: String(p.name || "").slice(0, 32), doing: String(p.doing || "").slice(0, 40) })) : null,
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
        // only temporary groups count (saved groups and staff rooms have their own limits)
        if (Object.values(this.groups).filter((x) => !x.saved && !x.room).length >= MAX_GROUPS) throw new Error("There are too many groups right now.");
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
        if (g.staffOnly && !a.staffChat) throw new Error("Only staff can join the Staff group.");
        const staff = (a.power || 0) >= 50;
        const invited = g.createdBy === a.id || (g.members || []).some((m) => m.id === a.id); // invited players skip the password
        if (g.passwordHash && !staff && !invited && (await sha256(`${g.id}:${String(msg.password || "")}`)) !== g.passwordHash) {
          throw new Error("Wrong group password.");
        }
        this.update(ws, { groupId: g.id });
        await this.cleanupGroups();
        this.sendRoster();
        return reply({ ok: true });
      }
      case "group.invite": {
        if (this.groups[String(msg.id)]?.room) throw new Error("Rooms are open to everyone: no invites needed.");
        // The group's creator invites a member by name: the group is saved so they can join any time.
        const g = this.groups[String(msg.id)];
        if (!g) throw new Error("That group no longer exists.");
        if (g.createdBy !== a.id && (a.power || 0) < 100) throw new Error("Only the person who made this group can invite players.");
        const name = String(msg.name || "").trim().toLowerCase().slice(0, 32);
        if (!name) throw new Error("Type the player's name.");
        const sql = getDb(this.env);
        const [u] = await sql`
          SELECT u.id, u.username, p.xuid FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
           WHERE NOT u.banned AND (lower(u.username) = ${name} OR lower(p.gamertag) = ${name})
           UNION ALL
          SELECT u.id, u.username, p.xuid FROM users u LEFT JOIN players p ON p.uuid = u.mc_uuid
           WHERE NOT u.banned AND lower(u.username) LIKE ${name.replace(/[\\%_]/g, (c) => "\\" + c) + "%"}
           LIMIT 1`;
        if (!u) throw new Error(`No community member called ${msg.name}. They need a galaxymc.us account (/link in game).`);
        if (Number(u.id) === a.id) throw new Error("You're already in your own group.");
        g.members = g.members || [];
        if (g.members.length >= 20) throw new Error("A group can have up to 20 invited players.");
        const savedMine = Object.values(this.groups).filter((x) => x.saved && x.createdBy === a.id && x.id !== g.id);
        if (!g.saved && savedMine.length >= 3) throw new Error("You can keep up to 3 saved groups. Delete one first.");
        if (!g.saved && Object.values(this.groups).filter((x) => x.saved).length >= 500) throw new Error("There are too many saved groups right now.");
        if (!g.members.some((m) => m.id === Number(u.id))) g.members.push({ id: Number(u.id), username: u.username });
        g.saved = true;
        await this.saveGroups();
        // tell them: on the website (community/voice pages) and in game
        const note = { type: "voice_invite", to: Number(u.id), from: a.username, groupId: g.id, group: g.name };
        try { await hubStub(this.env).fetch("https://hub/internal/broadcast", { method: "POST", body: JSON.stringify(note) }); } catch { /* best effort */ }
        for (const ws of this.voiceSockets()) {
          if (ws.deserializeAttachment()?.id === Number(u.id)) this.send(ws, note);
        }
        const plugin = this.pluginSocket();
        if (plugin && u.xuid) this.send(plugin, { type: "voice_invite", toXuid: String(u.xuid), from: a.username, group: g.name });
        this.sendRoster();
        return reply({ ok: true, invited: u.username });
      }
      case "group.uninvite": {
        const g = this.groups[String(msg.id)];
        if (!g) throw new Error("That group no longer exists.");
        if (g.createdBy !== a.id && (a.power || 0) < 100) throw new Error("Only the person who made this group can change it.");
        g.members = (g.members || []).filter((m) => m.id !== Number(msg.userId));
        await this.saveGroups();
        this.sendRoster();
        return reply({ ok: true });
      }
      case "group.delete": {
        const g = this.groups[String(msg.id)];
        if (!g) throw new Error("That group no longer exists.");
        if (g.room) throw new Error("Rooms are managed in the Control Panel.");
        if (g.createdBy !== a.id && (a.power || 0) < 100) throw new Error("Only the person who made this group can delete it.");
        for (const { ws, a: other } of this.members().values()) if (other.groupId === g.id) this.update(ws, { groupId: null });
        delete this.groups[g.id];
        await this.saveGroups();
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

  // The server map is drawn only while it's switched on (Control Panel > Overview).
  async sendMapSetting() {
    const plugin = this.pluginSocket();
    if (!plugin) return;
    try {
      const [row] = await getDb(this.env)`SELECT value FROM economy_config WHERE key = 'map_enabled'`;
      this.send(plugin, { type: "map", enabled: row?.value === true });
    } catch (e) {
      console.error("map setting failed", e);
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
      this.send(plugin, await welcomeMessage(sql));   // the welcome screen's text, latest news and next event
      this.send(plugin, await planMessage(sql));
      this.send(plugin, await serverControlMessage(this.env, sql));  // maintenance, scheduled restart, welcome kit
      await this.sendWords();
    } catch (e) {
      console.error("shop load failed", e);
    }
  }

  // The in-game chat filter uses the same word list as the website.
  async sendWords() {
    const plugin = this.pluginSocket();
    if (!plugin) return;
    const rows = await getDb(this.env)`SELECT word, match FROM filter_words WHERE match <> 'safe'`;
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
        this.send(ws, { type: "closed", reason: event.type === "banned" ? "Your account has been banned." : "Your permissions changed. Please rejoin voice." });
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
