// GalaxySMP voice chat (browser side).
// Your microphone goes to Cloudflare's voice relay; you receive only the voices you're
// allowed to hear (nearby players, your group, Global Mic). Volume and left/right
// direction follow positions sent by the server plugin.
import { toast, config } from "/js/site.js";
import { h, openDialog, getJson, postJson, select, field, MUTE_LABELS } from "/js/dialog.js";

const $ = (id) => document.getElementById(id);
const STAFF = 50;
const ADMIN = 100;
const FULL_VOLUME_WITHIN = 8; // blocks

// ---------- Icons (same meaning as the icons before names in game) ----------
const VICONS = {
  talking: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  connected: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  muted: '<path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7"/><path d="M19 11a7 7 0 0 1-.8 3.2M5 11a7 7 0 0 0 11.3 5.5M12 18v3M3 3l18 18"/>',
  "mic-off": '<path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7"/><path d="M19 11a7 7 0 0 1-.8 3.2M5 11a7 7 0 0 0 11.3 5.5M12 18v3M3 3l18 18"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  deafened: '<path d="M3 14v-2a9 9 0 0 1 14.5-7.1M21 12v2"/><path d="M3 14h3v6H4a1 1 0 0 1-1-1zM21 14h-3v6h2a1 1 0 0 0 1-1zM3 3l18 18"/>',
  headphones: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M3 14h3v6H4a1 1 0 0 1-1-1zM21 14h-3v6h2a1 1 0 0 0 1-1z"/>',
  voice_muted: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  broadcast: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>',
  leave: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  group: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};
const vicon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${VICONS[name] || ""}</svg>`;

// Same pixel icons players see above heads in game (resource pack), like Simple Voice Chat.
function stateOf(u) {
  if (u.voiceMuted) return { icon: "voice_muted", cls: "bad", label: "Muted by staff" };
  if (u.deafened) return { icon: "deafened", cls: "bad", label: "Deafened" };
  if (!u.mic) return { icon: "muted", cls: "bad", label: "Muted" };
  if (u.talking) {
    if (u.global && u.canGlobal) return { icon: "talking_global", cls: "ok", label: "Talking on the Global Mic" };
    if (u.group) return { icon: "talking_group", cls: "ok", label: "Talking in a group" };
    return { icon: "talking", cls: "ok", label: "Talking" };
  }
  return { icon: "talking", cls: "idle", label: "In voice" };
}

function pixelIcon(name, label) {
  const img = new Image(16, 16);
  img.src = `/img/voice/${name}.png`;
  img.alt = label;
  img.className = "pixel";
  return img;
}

// ---------- State ----------
const S = {
  me: null,
  myId: null,
  range: 48,
  ws: null,
  reqId: 0,
  pending: new Map(),
  users: new Map(),
  groups: [],
  pos: new Map(),
  pc: null,
  stream: null,
  track: null,
  ctx: null,
  analyser: null,
  micOn: false,
  deafened: false,
  ptt: false,
  pttDown: false,
  talking: false,
  talkUntil: 0,
  voiceMutedUntil: null,
  subs: new Map(), // ownerId -> { mid, gain, pan, audio }
  midOwner: new Map(),
  inflight: new Set(),
  queue: Promise.resolve(),
  timers: [],
  leaving: false,
  volumes: {},
};
try { S.volumes = JSON.parse(localStorage.getItem("gsmp-voice-volumes") || "{}"); } catch { /* private mode */ }

// ---------- Views ----------
function show(id) {
  for (const v of ["v-loading", "v-signin", "v-realm", "v-join", "v-app"]) $(v).hidden = v !== id;
  $("v-about").hidden = id === "v-app";
}

function notice(text, info) {
  const n = $("v-notice");
  n.textContent = text || "";
  n.classList.toggle("info", Boolean(info));
  n.hidden = !text;
}

function setConn(text, cls) {
  const c = $("v-conn");
  c.classList.remove("is-online", "is-offline", "is-maintenance");
  if (cls) c.classList.add(cls);
  c.querySelector("span:last-child").textContent = text;
}

// ---------- Connection to the voice server ----------
function request(type, data = {}) {
  return new Promise((resolve, reject) => {
    if (!S.ws || S.ws.readyState !== WebSocket.OPEN) return reject(new Error("Not connected."));
    const req = ++S.reqId;
    S.pending.set(req, { resolve, reject });
    S.ws.send(JSON.stringify({ type, req, ...data }));
    setTimeout(() => {
      if (S.pending.has(req)) { S.pending.delete(req); reject(new Error("The voice server didn't answer.")); }
    }, 15000);
  });
}

function sendState(patch) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify({ type: "state", ...patch }));
}

function connectSocket() {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/voice/connect`);
    S.ws = ws;
    let opened = false;
    ws.addEventListener("open", () => { opened = true; });
    ws.addEventListener("message", (e) => {
      if (e.data === "pong") return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === "hello") {
        S.myId = m.you;
        S.range = m.range;
        S.voiceMutedUntil = m.voiceMutedUntil;
        resolve();
      }
      onMessage(m);
    });
    ws.addEventListener("close", (e) => {
      if (!opened) return reject(new Error("Couldn't connect to voice. Make sure you're signed in."));
      if (!S.leaving) disconnected(e.code);
    });
  });
}

function onMessage(m) {
  switch (m.type) {
    case "reply": {
      const p = S.pending.get(m.req);
      if (!p) return;
      S.pending.delete(m.req);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m);
      return;
    }
    case "roster":
      S.users = new Map(m.users.map((u) => [u.id, u]));
      S.groups = m.groups;
      renderRoster();
      renderGroups();
      renderControls();
      return;
    case "talk": {
      const u = S.users.get(m.id);
      if (u) { u.talking = m.on; updateRow(u); }
      return;
    }
    case "pos":
      S.pos = new Map(m.list.map(([id, x, y, z, yaw, dim]) => [id, { x, y, z, yaw, dim }]));
      renderWhere();
      return;
    case "left":
      closeSub(m.id);
      return;
    case "revoke":
      closeSub(m.owner);
      return;
    case "voice_muted":
      S.voiceMutedUntil = m.until;
      applyMic();
      notice(m.until ? `A staff member muted you in voice until ${new Date(m.until).toLocaleString()}.${m.reason ? ` Reason: ${m.reason}` : ""}` : "", true);
      if (!m.until) toast("You've been unmuted in voice.");
      return;
    case "closed":
      S.closedReason = m.reason;
      return;
  }
}

function disconnected(code) {
  cleanup();
  show("v-join");
  $("v-join-error").textContent = S.closedReason || "You were disconnected from voice. Select Join voice to reconnect.";
  S.closedReason = null;
}

// ---------- Microphone and talking detection ----------
function voiceMuted() {
  return Boolean(S.voiceMutedUntil && new Date(S.voiceMutedUntil) > new Date());
}

function applyMic() {
  if (voiceMuted()) S.micOn = false;
  const transmit = S.micOn && !S.deafened && !voiceMuted() && (!S.ptt || S.pttDown);
  if (S.track) S.track.enabled = transmit;
  renderControls();
}

function startMeter() {
  const src = S.ctx.createMediaStreamSource(S.stream);
  S.analyser = S.ctx.createAnalyser();
  S.analyser.fftSize = 512;
  src.connect(S.analyser);
  const buf = new Float32Array(S.analyser.fftSize);
  S.timers.push(setInterval(() => {
    S.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const rms = Math.sqrt(sum / buf.length);
    const live = S.track && S.track.enabled;
    $("v-meter").style.width = live ? `${Math.min(100, rms * 600)}%` : "0%";
    const now = Date.now();
    if (live && rms > 0.02) S.talkUntil = now + 400;
    const talking = live && now < S.talkUntil;
    if (talking !== S.talking) {
      S.talking = talking;
      sendState({ talking });
    }
  }, 80));
}

// ---------- Audio relay (WebRTC with Cloudflare Realtime) ----------
async function setupRtc() {
  await request("rtc.session");
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], bundlePolicy: "max-bundle" });
  S.pc = pc;
  pc.addEventListener("track", (e) => attachTrack(e.transceiver.mid, e.track));
  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "connected") setConn("Connected", "is-online");
    else if (pc.connectionState === "failed") setConn("Audio connection failed. Try leaving and rejoining.", "is-offline");
  });
  const tx = pc.addTransceiver(S.track, { direction: "sendonly" });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await request("rtc.push", { sdp: offer.sdp, mid: tx.mid });
  await pc.setRemoteDescription(res.answer);
}

function attachTrack(mid, track) {
  const owner = S.midOwner.get(mid);
  const sub = owner != null && S.subs.get(owner);
  if (!sub) return;
  const stream = new MediaStream([track]);
  // Some browsers only start remote audio when it's attached to a (muted) audio element.
  const audio = new Audio();
  audio.muted = true;
  audio.srcObject = stream;
  audio.play().catch(() => {});
  const source = S.ctx.createMediaStreamSource(stream);
  const gain = S.ctx.createGain();
  gain.gain.value = 0;
  const pan = S.ctx.createStereoPanner();
  source.connect(gain).connect(pan).connect(S.ctx.destination);
  Object.assign(sub, { audio, source, gain, pan });
}

// Mirrors the server's rules; the server double-checks every request.
function canHear(u, slack) {
  if (u.id === S.myId || !u.published || u.voiceMuted) return false;
  if (u.global && u.canGlobal) return true;
  const me = S.users.get(S.myId);
  if (me?.group && me.group === u.group) return true;
  const a = S.pos.get(S.myId);
  const b = S.pos.get(u.id);
  if (!a || !b || a.dim !== b.dim) return false;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= S.range * slack;
}

function updateSubscriptions() {
  if (!S.pc || S.pc.connectionState !== "connected") return; // wait for the audio link
  const add = [];
  const remove = [];
  for (const u of S.users.values()) {
    if (!S.subs.has(u.id) && !S.inflight.has(u.id) && canHear(u, 1.15)) add.push(u.id);
  }
  for (const [owner, sub] of S.subs) {
    const u = S.users.get(owner);
    if (sub.mid && (!u || !canHear(u, 1.3))) remove.push(owner);
  }
  if (add.length) enqueue(() => pull(add));
  if (remove.length) enqueue(() => closeSubs(remove));
}

function enqueue(fn) {
  S.queue = S.queue.then(fn).catch((e) => console.warn("voice:", e.message));
}

async function pull(owners) {
  owners.forEach((o) => S.inflight.add(o));
  try {
    const res = await request("rtc.pull", { owners });
    for (const t of res.tracks) {
      S.midOwner.set(t.mid, t.owner);
      S.subs.set(t.owner, { mid: t.mid });
    }
    if (res.offer) {
      await S.pc.setRemoteDescription(res.offer);
      const answer = await S.pc.createAnswer();
      await S.pc.setLocalDescription(answer);
      await request("rtc.renegotiate", { sdp: answer.sdp });
    }
  } finally {
    owners.forEach((o) => S.inflight.delete(o));
  }
}

function dropNodes(sub) {
  try { sub.source?.disconnect(); sub.gain?.disconnect(); sub.pan?.disconnect(); } catch { /* ignore */ }
  if (sub.audio) sub.audio.srcObject = null;
}

async function closeSubs(owners) {
  const mids = [];
  for (const o of owners) {
    const sub = S.subs.get(o);
    if (!sub) continue;
    S.subs.delete(o);
    dropNodes(sub);
    if (sub.mid) {
      mids.push(sub.mid);
      S.midOwner.delete(sub.mid);
      const t = S.pc.getTransceivers().find((x) => x.mid === sub.mid);
      if (t && !t.stopped) t.stop();
    }
  }
  if (!mids.length) return;
  const offer = await S.pc.createOffer();
  await S.pc.setLocalDescription(offer);
  const res = await request("rtc.close", { mids, sdp: offer.sdp });
  if (res.answer) await S.pc.setRemoteDescription(res.answer);
}

function closeSub(owner) {
  if (S.subs.has(owner)) enqueue(() => closeSubs([owner]));
}

// Volume by distance, left/right by direction you're facing in game.
function updateMix() {
  if (!S.ctx) return;
  const me = S.users.get(S.myId);
  const a = S.pos.get(S.myId);
  for (const [owner, sub] of S.subs) {
    if (!sub.gain) continue;
    const u = S.users.get(owner);
    let g = 0;
    let p = 0;
    if (u && !S.deafened) {
      if ((u.global && u.canGlobal) || (me?.group && me.group === u.group)) {
        g = 1;
      } else {
        const b = S.pos.get(owner);
        if (a && b && a.dim === b.dim) {
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const d = Math.hypot(dx, b.y - a.y, dz);
          g = d <= FULL_VOLUME_WITHIN ? 1 : Math.max(0, 1 - (d - FULL_VOLUME_WITHIN) / (S.range - FULL_VOLUME_WITHIN));
          const yaw = (a.yaw * Math.PI) / 180;
          const len = Math.hypot(dx, dz) || 1;
          p = Math.max(-1, Math.min(1, ((dx / len) * -Math.cos(yaw) + (dz / len) * -Math.sin(yaw)))) * 0.75;
        }
      }
      g *= (S.volumes[owner] ?? 100) / 100;
    }
    const t = S.ctx.currentTime;
    sub.gain.gain.setTargetAtTime(g, t, 0.08);
    sub.pan.pan.setTargetAtTime(p, t, 0.08);
  }
}

// ---------- Rendering ----------
function distanceTo(id) {
  const a = S.pos.get(S.myId);
  const b = S.pos.get(id);
  if (!a || !b || a.dim !== b.dim) return null;
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
}

function groupName(id) {
  return S.groups.find((g) => g.id === id)?.name || "a group";
}

function detail(u) {
  const me = S.users.get(S.myId);
  if (u.global && u.canGlobal) return "Global Mic";
  if (u.id !== S.myId && me?.group && me.group === u.group) return `In your group`;
  const parts = [];
  if (u.group) parts.push(`Group: ${groupName(u.group)}`);
  if (!u.inGame) parts.push("Not in game");
  else if (u.id !== S.myId) {
    const d = distanceTo(u.id);
    parts.push(d == null ? "Other dimension" : d <= S.range ? `Nearby · ${d} blocks` : `${d} blocks away`);
  } else parts.push("In game");
  return parts.join(" · ");
}

function rowFor(u) {
  const st = stateOf(u);
  const row = h("div", { class: "vrow", "data-id": u.id });
  const ic = h("span", { class: `vstate ${st.cls}`, title: st.label });
  ic.append(pixelIcon(st.icon, st.label));
  const name = h("span", { class: "vname", text: u.username });
  name.style.color = u.color;
  const info = h("div", { class: "vinfo" }, h("div", {}, name, u.id === S.myId ? h("span", { class: "text-3 small", text: " (you)" }) : null), h("div", { class: "vdetail", text: detail(u) }));
  row.append(ic, info);
  if (u.id !== S.myId) {
    const vol = h("input", { type: "range", min: 0, max: 200, step: 10, value: S.volumes[u.id] ?? 100, class: "vvol", "aria-label": `Volume for ${u.username}` });
    vol.addEventListener("input", () => {
      S.volumes[u.id] = Number(vol.value);
      try { localStorage.setItem("gsmp-voice-volumes", JSON.stringify(S.volumes)); } catch { /* ignore */ }
    });
    row.append(vol);
    if ((S.me.role.power || 0) >= STAFF) {
      const more = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Manage", onclick: () => staffDialog(u) });
      row.append(more);
    }
  }
  return row;
}

function updateRow(u) {
  const old = document.querySelector(`.vrow[data-id="${u.id}"]`);
  if (old) old.replaceWith(rowFor(u));
}

function renderRoster() {
  if (document.activeElement?.classList.contains("vvol")) return; // don't interrupt a volume drag
  const list = $("v-roster");
  const users = [...S.users.values()].sort((a, b) => {
    if (a.id === S.myId) return -1;
    if (b.id === S.myId) return 1;
    return (distanceTo(a.id) ?? 1e9) - (distanceTo(b.id) ?? 1e9) || a.username.localeCompare(b.username);
  });
  list.replaceChildren(...users.map(rowFor));
  $("v-count").textContent = `· ${users.length}`;
}

function renderGroups() {
  const box = $("v-groups");
  const me = S.users.get(S.myId);
  box.replaceChildren();
  if (!S.groups.length) box.append(h("p", { class: "text-3 small", style: "margin:0", text: "No groups right now." }));
  for (const g of S.groups) {
    const members = [...S.users.values()].filter((u) => u.group === g.id);
    const mine = me?.group === g.id;
    const ic = h("span", { class: "vstate" });
    ic.innerHTML = vicon(g.locked ? "lock" : "group");
    const row = h("div", { class: "vrow" + (mine ? " mine" : "") }, ic,
      h("div", { class: "vinfo" }, h("div", { class: "vname", text: g.name }), h("div", { class: "vdetail", text: `${members.length} in group · ${members.map((m) => m.username).join(", ")}` })),
      mine
        ? h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Leave", onclick: () => request("group.leave").catch((e) => toast(e.message)) })
        : h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Join", onclick: () => joinGroup(g) }));
    box.append(row);
  }
}

function renderControls() {
  const me = S.users.get(S.myId);
  const mic = $("v-mic");
  mic.setAttribute("aria-pressed", String(S.micOn));
  mic.querySelector(".vico").innerHTML = vicon(S.micOn ? "mic" : "mic-off");
  mic.querySelector(".vlabel").textContent = S.micOn ? "Mute" : "Unmute";
  mic.classList.toggle("off", !S.micOn);
  mic.disabled = voiceMuted();
  const deaf = $("v-deafen");
  deaf.setAttribute("aria-pressed", String(S.deafened));
  deaf.querySelector(".vico").innerHTML = vicon(S.deafened ? "deafened" : "headphones");
  deaf.querySelector(".vlabel").textContent = S.deafened ? "Undeafen" : "Deafen";
  deaf.classList.toggle("off", S.deafened);
  const glob = $("v-global");
  glob.hidden = !me?.canGlobal;
  glob.setAttribute("aria-pressed", String(Boolean(me?.global)));
  glob.classList.toggle("on", Boolean(me?.global));
  glob.querySelector(".vlabel").textContent = me?.global ? "Global Mic on" : "Global Mic";
  $("v-ptt-btn").hidden = !S.ptt;
  $("v-leave").querySelector(".vico").innerHTML = vicon("leave");
}

function renderWhere() {
  const me = S.users.get(S.myId);
  const a = S.pos.get(S.myId);
  $("v-where").textContent = a ? `In game · ${a.dim}` : me ? "Not in game: you'll hear your group and the Global Mic" : "";
  // Distances change as people move; refresh the roster text a few times a second at most.
  if (!renderWhere.t) renderWhere.t = setTimeout(() => { renderWhere.t = null; renderRoster(); }, 1000);
}

// ---------- Groups ----------
function joinGroup(g) {
  if (!g.locked || (S.me.role.power || 0) >= STAFF) {
    request("group.join", { id: g.id }).catch((e) => toast(e.message));
    return;
  }
  const pw = h("input", { class: "input", id: "group-pw", type: "password", maxlength: 40, autocomplete: "off" });
  openDialog({
    title: `Join ${g.name}`,
    body: h("div", { class: "form" }, field("Group password", pw)),
    actions: [{ label: "Cancel" }, { label: "Join", kind: "primary", onClick: () => request("group.join", { id: g.id, password: pw.value }) }],
  });
}

function newGroup() {
  const name = h("input", { class: "input", id: "group-name", maxlength: 24, placeholder: "e.g. Build Team" });
  const pw = h("input", { class: "input", id: "group-pw", type: "password", maxlength: 40, autocomplete: "off", placeholder: "Leave empty for an open group" });
  openDialog({
    title: "New group",
    body: h("div", { class: "form" }, field("Group name", name), field("Password (optional)", pw, "Staff can always see and join every group.")),
    actions: [{ label: "Cancel" }, { label: "Create", kind: "primary", onClick: () => request("group.create", { name: name.value, password: pw.value }) }],
  });
}

// ---------- Staff tools ----------
async function staffDialog(u) {
  const body = h("div", { class: "form" });
  const st = stateOf(u);
  body.append(h("p", { class: "text-2", style: "margin:0", text: `${st.label} · ${detail(u)}` }));
  let member = null;
  try {
    const data = await getJson(`/api/mod/members?q=${encodeURIComponent(u.username)}`);
    member = data.members.find((m) => m.id === u.id);
  } catch { /* basic actions only */ }
  const power = S.me.role.power || 0;
  const canAct = member && !member.owner && power > member.power;
  const actions = [{ label: "Close" }];
  if (!canAct) body.append(h("p", { class: "text-3 small", style: "margin:0", text: member?.owner ? "Server owners can't be moderated." : "You can only manage members with a lower role than yours." }));
  if (canAct) {
    if (member.voiceMutedUntil) {
      body.append(h("p", { class: "note small", style: "margin:0", text: `Voice muted until ${new Date(member.voiceMutedUntil).toLocaleString()}` }));
      actions.push({ label: "Unmute in voice", onClick: async () => { await postJson(`/api/mod/members/${u.id}/voice-unmute`); toast("Unmuted in voice."); } });
    } else {
      actions.push({ label: "Mute in voice", onClick: () => setTimeout(() => voiceMuteDialog(u)) });
    }
    actions.push({ label: "Remove from voice", kind: "danger", onClick: async () => { await postJson(`/api/mod/members/${u.id}/voice-kick`, {}); toast("Removed from voice."); } });
  }
  if (member && power >= ADMIN && member.power < STAFF) {
    actions.push(member.globalMic
      ? { label: "Take Global Mic", onClick: async () => { await postJson(`/api/mod/members/${u.id}/global-mic`, { allowed: false }); toast("Global Mic removed."); } }
      : { label: "Give Global Mic", onClick: async () => { await postJson(`/api/mod/members/${u.id}/global-mic`, { allowed: true }); toast("Global Mic given."); } });
  }
  openDialog({ title: u.username, body, actions });
}

function voiceMuteDialog(u) {
  const len = select("vmute-len", Object.entries(MUTE_LABELS), 60);
  const reason = h("input", { class: "input", id: "vmute-reason", maxlength: 300, placeholder: "Optional, shown in the audit log" });
  openDialog({
    title: `Mute ${u.username} in voice`,
    body: h("div", { class: "form" }, h("p", { class: "text-2", style: "margin:0", text: "They can still listen, but nobody will hear them until the mute ends." }), field("Length", len), field("Reason", reason)),
    actions: [{ label: "Cancel" }, {
      label: "Mute", kind: "primary",
      onClick: async () => { await postJson(`/api/mod/members/${u.id}/voice-mute`, { minutes: Number(len.value), reason: reason.value }); toast("Muted in voice."); },
    }],
  });
}

// ---------- Join / leave ----------
async function join() {
  $("v-join-error").textContent = "";
  $("v-join-btn").disabled = true;
  try {
    S.leaving = false;
    S.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await S.ctx.resume();
    S.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }).catch(() => { throw new Error("Microphone access was blocked. Allow the microphone for galaxymc.us in your browser settings, then try again."); });
    S.track = S.stream.getAudioTracks()[0];
    S.micOn = false;
    applyMic();
    show("v-app");
    setConn("Connecting…", "is-maintenance");
    await connectSocket();
    if (voiceMuted()) notice(`A staff member muted you in voice until ${new Date(S.voiceMutedUntil).toLocaleString()}.`, true);
    await setupRtc();
    startMeter();
    S.timers.push(setInterval(updateSubscriptions, 700));
    S.timers.push(setInterval(updateMix, 100));
  } catch (e) {
    cleanup();
    show("v-join");
    $("v-join-error").textContent = e.message || "Couldn't join voice.";
  } finally {
    $("v-join-btn").disabled = false;
  }
}

function cleanup() {
  S.timers.forEach(clearInterval);
  S.timers = [];
  for (const sub of S.subs.values()) dropNodes(sub);
  S.subs.clear();
  S.midOwner.clear();
  S.inflight.clear();
  S.pending.forEach((p) => p.reject(new Error("Disconnected.")));
  S.pending.clear();
  try { S.pc?.close(); } catch { /* ignore */ }
  S.pc = null;
  S.stream?.getTracks().forEach((t) => t.stop());
  S.stream = null;
  S.track = null;
  try { S.ctx?.close(); } catch { /* ignore */ }
  S.ctx = null;
  S.users.clear();
  S.pos.clear();
  S.talking = false;
}

function leave() {
  S.leaving = true;
  try { S.ws?.close(1000, "bye"); } catch { /* ignore */ }
  cleanup();
  show("v-join");
}

// ---------- Wire up controls ----------
$("v-join-btn").addEventListener("click", join);
$("v-leave").addEventListener("click", leave);
$("v-mic").addEventListener("click", () => {
  S.micOn = !S.micOn;
  if (S.micOn && S.deafened) { S.deafened = false; sendState({ deafened: false }); }
  applyMic();
  sendState({ mic: S.micOn });
});
$("v-deafen").addEventListener("click", () => {
  S.deafened = !S.deafened;
  applyMic();
  sendState({ deafened: S.deafened });
  updateMix();
});
$("v-global").addEventListener("click", () => {
  const me = S.users.get(S.myId);
  request("global", { on: !me?.global }).catch((e) => toast(e.message));
});
$("v-group-new").addEventListener("click", newGroup);
$("v-ptt").addEventListener("change", (e) => {
  S.ptt = e.target.checked;
  if (S.ptt && !S.micOn) { S.micOn = true; sendState({ mic: true }); }
  applyMic();
});
const pttBtn = $("v-ptt-btn");
const pttSet = (down) => { S.pttDown = down; pttBtn.classList.toggle("active", down); applyMic(); };
pttBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); pttBtn.setPointerCapture(e.pointerId); pttSet(true); });
pttBtn.addEventListener("pointerup", () => pttSet(false));
pttBtn.addEventListener("pointercancel", () => pttSet(false));
const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
document.addEventListener("keydown", (e) => { if (S.ptt && e.key.toLowerCase() === "v" && !e.repeat && !typing(e)) pttSet(true); });
document.addEventListener("keyup", (e) => { if (S.ptt && e.key.toLowerCase() === "v") pttSet(false); });
document.querySelectorAll("[data-vicon]").forEach((el) => (el.innerHTML = vicon(el.getAttribute("data-vicon"))));
document.querySelectorAll("[data-check]").forEach((el) => (el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'));
window.addEventListener("pagehide", () => { if (S.ws) leave(); });

// ---------- Start ----------
(async () => {
  let user = null;
  try { user = (await getJson("/api/me")).user; } catch { /* signed out */ }
  if (config.hosting === "realm") return show("v-realm");
  if (!user) return show("v-signin");
  S.me = user;
  $("v-name").textContent = user.username;
  show("v-join");
})();

// Local testing only: expose state to automated tests on this computer.
if (["127.0.0.1", "localhost"].includes(location.hostname)) window.__voice = S;
