// Calls (2.90): private voice calls. One person calls a friend (the owner can call anyone); anyone in the call can
// add more friends, up to CALL_MAX people. Only the people in a call hear each other (nobody nearby in game does).
// Audio uses the same relay as voice chat; a call is answered on the website's Voice page (or in game with /call accept,
// then the Voice page on the player's phone or computer). Each call leaves a line in the DM conversation:
// "Call · 12 min", "Missed call" or "Declined".
// These methods are added to the VoiceHub class (hub.js): `this` is the hub.
import { getDb } from "../lib/db.js";
import { isOwner } from "../lib/names.js";
import { hubStub } from "../routes/chat.js";
import { notify } from "../routes/notify.js";

export const CALL_MAX = 4;
const RING_MS = 30_000;          // nobody answers in 30 seconds: a missed call
const GONE_MS = 45_000;          // someone's Voice page has been closed this long: they've left the call
const WAIT_MS = 3 * 60_000;      // someone who answered (or called) in game has 3 minutes to open the Voice page

const minutes = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 1 ? "less than a minute" : `${m} min`;
};

export const CallMixin = {
  async saveCalls() {
    await this.ctx.storage.put("calls", this.calls);
  },

  // the call this member is in (answered), or null
  callOf(userId) {
    return Object.values(this.calls).find((c) => c.people[Number(userId)]?.state === "in") || null;
  },

  socketsOf(userId) {
    return this.voiceSockets().filter((ws) => ws.deserializeAttachment()?.id === Number(userId));
  },

  connected(userId) {
    return this.socketsOf(userId).length > 0;
  },

  publicCall(c) {
    return {
      id: c.id, startedAt: c.startedAt, max: CALL_MAX,
      people: Object.values(c.people).filter((p) => p.state === "in" || p.state === "ringing")
        .map((p) => ({ id: p.id, username: p.username, state: p.state, connected: this.connected(p.id) })),
    };
  },

  // the call's state to everyone in it (their Voice page)
  sendCall(c) {
    const data = { type: "call", call: this.publicCall(c) };
    for (const p of Object.values(c.people)) if (p.state === "in") for (const ws of this.socketsOf(p.id)) this.send(ws, data);
  },

  // a short line for people in the call: on the Voice page and in game chat
  callNote(c, text, gameText, skipId) {
    const plugin = this.pluginSocket();
    for (const p of Object.values(c.people)) {
      if (p.state !== "in" || p.id === skipId) continue;
      for (const ws of this.socketsOf(p.id)) this.send(ws, { type: "call.note", text });
      if (plugin && p.xuid) this.send(plugin, { type: "call_note", toXuid: p.xuid, text: gameText || `§7📞 ${text}` });
    }
  },

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
  },

  // friends only (the owner can call anyone); never someone who blocked you or whom you blocked
  async mayCall(sql, from, to) {
    if (from.id === to.id) throw new Error("You can't call yourself.");
    const [blocked] = await sql`SELECT 1 FROM dm_blocks WHERE (user_id = ${to.id} AND blocked_id = ${from.id}) OR (user_id = ${from.id} AND blocked_id = ${to.id})`;
    if (blocked) throw new Error(`You can't call ${to.username}.`);
    if (from.owner) return;
    const [a, b] = from.id < to.id ? [from.id, to.id] : [to.id, from.id];
    const [f] = await sql`SELECT 1 FROM friends WHERE a = ${a} AND b = ${b} AND status = 'accepted'`;
    if (!f) throw new Error(`You can only call friends. Add ${to.username} as a friend first.`);
  },

  // puts this member's Voice page in the call (they hear the call; their voice goes only to the call)
  putInCall(userId, c) {
    for (const ws of this.socketsOf(userId)) this.update(ws, { callId: c.id, groupId: null });
    const p = c.people[userId];
    if (p) {
      p.goneAt = null;
      p.waitUntil = this.connected(userId) ? null : Date.now() + WAIT_MS;
    }
  },

  async callStart(from, target) {
    const sql = getDb(this.env);
    const existing = this.callOf(from.id);
    if (existing) return this.callAdd(existing, from, target);
    await this.mayCall(sql, from, target);
    if (this.callOf(target.id)) throw new Error(`${target.username} is in another call right now.`);
    const id = crypto.randomUUID().slice(0, 8);
    const c = { id, createdAt: Date.now(), startedAt: null, people: {} };
    c.people[from.id] = { id: from.id, username: from.username, xuid: from.xuid || null, state: "in", by: null, joinedAt: Date.now() };
    this.calls[id] = c;
    this.putInCall(from.id, c);
    if (c.people[from.id].waitUntil) await this.wakeAt(c.people[from.id].waitUntil + 500);
    await this.ring(c, from, target);
    this.sendRoster();
    return c;
  },

  async callAdd(c, from, target) {
    const sql = getDb(this.env);
    await this.mayCall(sql, from, target);
    const other = this.callOf(target.id);
    if (other && other.id !== c.id) throw new Error(`${target.username} is in another call right now.`);
    await this.ring(c, from, target);
    return c;
  },

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
    try {
      await hubStub(this.env).fetch("https://hub/internal/broadcast", { method: "POST", body: JSON.stringify({ ...note, type: "call_ring", to: target.id }) });
    } catch { /* best effort */ }
    try { // their phone or computer rings too (if they turned on notifications)
      await notify(this.env, [target.id], "calls", {
        title: `${by.username} is calling you`,
        body: withNames.length ? `With ${withNames.join(", ")}. Tap to answer.` : "Tap to answer on galaxymc.us.",
        url: `/voice?answer=${c.id}`, tag: `call-${c.id}`, ttl: 30, urgent: true,
      }, { noInbox: true });
    } catch { /* best effort */ }
    const plugin = this.pluginSocket();
    if (plugin && target.xuid) this.send(plugin, { type: "call_ring", toXuid: target.xuid, from: by.username, id: c.id });
    await this.wakeAt(Date.now() + RING_MS + 500);
    this.callNote(c, `Calling ${target.username}…`, null, by.id);
    this.sendCall(c);
  },

  async stopRing(c, p) {
    for (const ws of this.socketsOf(p.id)) this.send(ws, { type: "call.ring_end", id: c.id });
    try {
      await hubStub(this.env).fetch("https://hub/internal/broadcast", { method: "POST", body: JSON.stringify({ type: "call_ring_end", to: p.id, id: c.id }) });
    } catch { /* best effort */ }
    const plugin = this.pluginSocket();
    if (plugin && p.xuid) this.send(plugin, { type: "call_ring_end", toXuid: p.xuid });
  },

  ringingCall(userId, callId) {
    const c = callId ? this.calls[String(callId)] : Object.values(this.calls).find((x) => x.people[Number(userId)]?.state === "ringing");
    return c && c.people[Number(userId)]?.state === "ringing" ? c : null;
  },

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
    this.sendRoster();
    return c;
  },

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
  },

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
    this.sendRoster();
    return true;
  },

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
    const plugin = this.pluginSocket();
    for (const p of inn) {
      p.state = "left";
      p.leftAt = now;
      const reason = c.startedAt ? `The call ended (${minutes(now - c.startedAt)}).` : "Nobody answered.";
      for (const ws of this.socketsOf(p.id)) {
        this.update(ws, { callId: null });
        this.send(ws, { type: "call.ended", id: c.id, reason });
      }
      if (plugin && p.xuid) this.send(plugin, { type: "call_note", toXuid: p.xuid, text: `§7📞 ${reason}` });
      await this.history(c, p);
    }
    delete this.calls[c.id];
    await this.saveCalls();
    this.sendRoster();
  },

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
      const plugin = this.pluginSocket();
      if (plugin && p.xuid) this.send(plugin, { type: "call_note", toXuid: p.xuid, text: `§c📞 Missed call from ${p.byName}.` });
    }
  },

  // runs from the hub's alarm: calls nobody answered, and people whose Voice page stayed closed
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
          if (now >= deadline) await this.callLeave(p.id, "You left the call because your Voice page was closed.");
          else soon(deadline);
        }
      }
      if (this.calls[c.id]) await this.maybeEnd(c);
    }
    await this.saveCalls();
    return next;
  },

  // a member's Voice page connected: back in their call, or their phone is ringing
  callOnConnect(ws, userId) {
    const c = this.callOf(userId);
    if (c) {
      this.update(ws, { callId: c.id });
      const p = c.people[Number(userId)];
      p.goneAt = null;
      p.waitUntil = null;
      this.ctx.waitUntil(this.saveCalls());
      this.sendCall(c);
    }
    for (const r of Object.values(this.calls)) {
      const p = r.people[Number(userId)];
      if (p?.state === "ringing") {
        this.send(ws, { type: "call.incoming", id: r.id, from: p.byName, fromId: p.by,
          with: Object.values(r.people).filter((x) => x.state === "in" && x.id !== p.by).map((x) => x.username) });
      }
    }
  },

  // a member's Voice page closed: they have a little while to come back before they leave the call
  async callOnDisconnect(userId) {
    const c = this.callOf(userId);
    if (!c || this.connected(userId)) return;
    const p = c.people[Number(userId)];
    if (!p.goneAt) p.goneAt = Date.now();
    await this.saveCalls();
    await this.wakeAt(p.goneAt + GONE_MS + 500);
    this.sendCall(c);
  },

  // the Endstone plugin: /call <name>, /call accept, /call decline, /call add <name>, /call hangup
  async callFromGame(msg) {
    const sql = getDb(this.env);
    const say = (text) => {
      const plugin = this.pluginSocket();
      if (plugin) this.send(plugin, { type: "call_note", toXuid: String(msg.xuid), text });
    };
    const me = await this.person(sql, { xuid: msg.xuid });
    if (!me) return say("§cLink your account first (type /link). Then you can call your friends.");
    const voicePage = "§7Open §bgalaxymc.us/voice§7 on your phone or computer to talk.";
    try {
      if (msg.type === "call_start" || msg.type === "call_add") {
        const c = this.callOf(me.id);
        if (msg.type === "call_add" && !c) return say("§7You're not in a call. Start one with §e/call <name>§7.");
        const target = await this.person(sql, { name: msg.to });
        if (!target) return say(`§cNo member called ${String(msg.to || "").slice(0, 32)}. They need a galaxymc.us account (/link).`);
        if (c) await this.callAdd(c, me, target);
        else await this.callStart(me, target);
        say(`§a📞 Calling ${target.username}...` + (this.connected(me.id) ? "" : ` ${voicePage}`));
      } else if (msg.type === "call_accept") {
        await this.callAccept(me.id, msg.id || null);
        say(this.connected(me.id) ? "§a📞 You're in the call." : `§a📞 Answered! ${voicePage} §8(The call waits 3 minutes.)`);
      } else if (msg.type === "call_decline") {
        say((await this.callDecline(me.id, msg.id || null)) ? "§7Call declined." : "§7Nobody is calling you right now.");
      } else if (msg.type === "call_leave") {
        say((await this.callLeave(me.id)) ? "§7You left the call." : "§7You're not in a call.");
      }
    } catch (e) {
      say(`§c${e.message || "Something went wrong."}`);
    }
  },

  // the hub has one alarm: never put it later than it already is
  async wakeAt(at) {
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || at < cur) await this.ctx.storage.setAlarm(at);
  },
};
