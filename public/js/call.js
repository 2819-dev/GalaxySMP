// Calls (2.92): the call bar on the Community page (DMs) and on profiles. Separate from voice chat.
//   startCall(userId)   call a friend (from a DM's Call button or a profile)
//   showIncoming(data)  someone is calling you: Answer / Decline (from the Community page's live connection)
//   initCalls()         on page load: rejoin a call you're in, or answer one that's ringing
// The microphone connects only once you call, answer or rejoin. Audio goes through the same relay as voice chat.
import { h, getJson, postJson, openDialog, field } from "/js/dialog.js";
import { toast, iconEl } from "/js/site.js";

const C = {
  ws: null, reqId: 0, pending: new Map(), myId: null,
  pc: null, stream: null, track: null, ctx: null, analyser: null,
  mic: true, talking: false, talkUntil: 0,
  subs: new Map(),        // person id -> { mid, audio }
  midOwner: new Map(), inflight: new Set(), queue: Promise.resolve(),
  call: null,             // { id, startedAt, max, people: [{ id, username, state, live, mic, talking }] }
  incoming: null,         // { id, from, fromId, with }
  rejoin: null,           // you're in a call but this page isn't connected yet
  timers: [], leaving: false,
};
let dock = null;

// ---------- connection ----------
function request(type, data = {}) {
  return new Promise((resolve, reject) => {
    if (!C.ws || C.ws.readyState !== WebSocket.OPEN) return reject(new Error("Not connected."));
    const req = ++C.reqId;
    C.pending.set(req, { resolve, reject });
    C.ws.send(JSON.stringify({ type, req, ...data }));
    setTimeout(() => { if (C.pending.has(req)) { C.pending.delete(req); reject(new Error("The call server didn't answer.")); } }, 15000);
  });
}

function sendState(patch) {
  if (C.ws?.readyState === WebSocket.OPEN) C.ws.send(JSON.stringify({ type: "state", ...patch }));
}

function connectSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/calls/connect`);
    C.ws = ws;
    let opened = false;
    ws.addEventListener("open", () => { opened = true; });
    ws.addEventListener("message", (e) => {
      if (e.data === "pong") return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === "hello") { C.myId = m.you; resolve(); }
      onMessage(m);
    });
    ws.addEventListener("close", (e) => {
      if (!opened) return reject(new Error("Couldn't connect the call. Make sure you're signed in."));
      if (!C.leaving) {
        hangupLocal();
        if (e.code === 4003) toast("Your call moved to another tab.");
      }
    });
  });
}

// the microphone, the audio link, and the "who's talking" meter (only inside a tap: browsers need it for sound)
async function connect() {
  if (C.ws?.readyState === WebSocket.OPEN && C.pc) return;
  C.leaving = false;
  try {
    C.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await C.ctx.resume().catch(() => {});
    C.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .catch(() => { throw new Error("Microphone access was blocked. Allow the microphone for galaxymc.us, then try again."); });
    C.track = C.stream.getAudioTracks()[0];
    C.track.enabled = C.mic;
    await connectSocket();
    await setupRtc();
    startMeter();
    C.timers.push(setInterval(syncSubs, 800));
  } catch (e) {
    hangupLocal();
    throw e;
  }
}

async function setupRtc() {
  await request("rtc.session");
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], bundlePolicy: "max-bundle" });
  C.pc = pc;
  pc.addEventListener("track", (e) => attachTrack(e.transceiver.mid, e.track));
  const tx = pc.addTransceiver(C.track, { direction: "sendonly" });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await request("rtc.push", { sdp: offer.sdp, mid: tx.mid });
  await pc.setRemoteDescription(res.answer);
}

function attachTrack(mid, track) {
  const owner = C.midOwner.get(mid);
  const sub = owner != null && C.subs.get(owner);
  if (!sub) return;
  const audio = new Audio();
  audio.autoplay = true;
  audio.setAttribute("playsinline", "");
  audio.srcObject = new MediaStream([track]);
  audio.play().catch(() => {});
  sub.audio = audio;
}

function startMeter() {
  try {
    const src = C.ctx.createMediaStreamSource(C.stream);
    C.analyser = C.ctx.createAnalyser();
    C.analyser.fftSize = 512;
    src.connect(C.analyser);
  } catch { return; }
  const buf = new Float32Array(C.analyser.fftSize);
  C.timers.push(setInterval(() => {
    C.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const rms = Math.sqrt(sum / buf.length);
    const now = Date.now();
    if (C.mic && rms > 0.02) C.talkUntil = now + 400;
    const talking = C.mic && now < C.talkUntil;
    if (talking !== C.talking) {
      C.talking = talking;
      sendState({ talking });
      render();
    }
  }, 90));
}

// hear everyone in the call whose audio is connected (and stop hearing people who left)
function syncSubs() {
  if (!C.pc || C.pc.connectionState !== "connected" || !C.call) return;
  const want = new Set(C.call.people.filter((p) => p.state === "in" && p.live && p.id !== C.myId).map((p) => p.id));
  const add = [...want].filter((id) => !C.subs.has(id) && !C.inflight.has(id));
  const remove = [...C.subs.keys()].filter((id) => !want.has(id));
  if (add.length) enqueue(() => pull(add));
  if (remove.length) enqueue(() => closeSubs(remove));
}

function enqueue(fn) {
  C.queue = C.queue.then(fn).catch((e) => console.warn("call:", e.message));
}

async function pull(owners) {
  owners.forEach((o) => C.inflight.add(o));
  try {
    const res = await request("rtc.pull", { owners });
    for (const t of res.tracks) {
      C.midOwner.set(t.mid, t.owner);
      C.subs.set(t.owner, { mid: t.mid });
    }
    if (res.offer) {
      await C.pc.setRemoteDescription(res.offer);
      const answer = await C.pc.createAnswer();
      await C.pc.setLocalDescription(answer);
      await request("rtc.renegotiate", { sdp: answer.sdp });
    }
  } finally {
    owners.forEach((o) => C.inflight.delete(o));
  }
}

async function closeSubs(owners) {
  const mids = [];
  for (const o of owners) {
    const sub = C.subs.get(o);
    if (!sub) continue;
    C.subs.delete(o);
    if (sub.audio) sub.audio.srcObject = null;
    if (sub.mid) {
      mids.push(sub.mid);
      C.midOwner.delete(sub.mid);
      const t = C.pc.getTransceivers().find((x) => x.mid === sub.mid);
      if (t && !t.stopped) t.stop();
    }
  }
  if (!mids.length) return;
  const offer = await C.pc.createOffer();
  await C.pc.setLocalDescription(offer);
  const res = await request("rtc.close", { mids, sdp: offer.sdp });
  if (res.answer) await C.pc.setRemoteDescription(res.answer);
}

// everything on this page stops (the call itself may go on for the others)
function hangupLocal() {
  C.leaving = true;
  C.timers.forEach(clearInterval);
  C.timers = [];
  for (const sub of C.subs.values()) if (sub.audio) sub.audio.srcObject = null;
  C.subs.clear();
  C.midOwner.clear();
  C.inflight.clear();
  C.pending.forEach((p) => p.reject(new Error("Disconnected.")));
  C.pending.clear();
  try { C.pc?.close(); } catch { /* ignore */ }
  C.pc = null;
  C.stream?.getTracks().forEach((t) => t.stop());
  C.stream = null;
  C.track = null;
  try { C.ctx?.close(); } catch { /* ignore */ }
  C.ctx = null;
  try { C.ws?.close(1000, "bye"); } catch { /* ignore */ }
  C.ws = null;
  C.call = null;
  C.talking = false;
  stopRing();
  render();
}

function onMessage(m) {
  switch (m.type) {
    case "reply": {
      const p = C.pending.get(m.req);
      if (!p) return;
      C.pending.delete(m.req);
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m);
      return;
    }
    case "call":
      C.call = m.call;
      C.rejoin = null;
      syncSubs();
      render();
      return;
    case "talk": {
      const p = C.call?.people.find((x) => x.id === m.id);
      if (p) { p.talking = m.talking; p.mic = m.mic; render(); }
      return;
    }
    case "left":
      enqueue(() => closeSubs([m.id]));
      return;
    case "call.incoming":
      showIncoming(m);
      return;
    case "call.ring_end":
      endRing(m);
      return;
    case "call.ended":
      toast(m.reason || "The call ended.");
      hangupLocal();
      return;
    case "call.note":
      toast(m.text);
      return;
    case "closed":
      return;
  }
}

// ---------- ringing ----------
const ring = { timer: null, kind: null, ctx: null };
function tone(freqs, len) {
  const ctx = C.ctx || (ring.ctx ||= new (window.AudioContext || window.webkitAudioContext)());
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const t0 = ctx.currentTime;
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f;
    const start = t0 + i * (len + 0.08);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.14, start + 0.02);
    g.gain.setValueAtTime(0.14, start + len - 0.05);
    g.gain.linearRampToValueAtTime(0, start + len);
    o.connect(g).connect(ctx.destination);
    o.start(start);
    o.stop(start + len + 0.05);
  });
}
function startRing(kind) {
  if (ring.kind === kind) return;
  stopRing();
  ring.kind = kind;
  const play = () => { try { kind === "incoming" ? tone([880, 660], 0.35) : tone([440], 0.9); } catch { /* no sound allowed yet */ } };
  play();
  ring.timer = setInterval(play, kind === "incoming" ? 2000 : 3000);
}
function stopRing() {
  clearInterval(ring.timer);
  ring.timer = null;
  ring.kind = null;
}

export function showIncoming(data) {
  if (C.call?.id === data.id) return;
  C.incoming = { id: data.id, from: data.from, fromId: data.fromId, with: data.with || [] };
  clearTimeout(C.incomingTimer);
  C.incomingTimer = setTimeout(() => endRing({ id: data.id }), 32000);
  startRing("incoming");
  render();
}

export function endRing(data) {
  if (!C.incoming || (data?.id && C.incoming.id !== data.id)) return;
  C.incoming = null;
  if (ring.kind === "incoming") stopRing();
  render();
}

// ---------- actions ----------
export async function startCall(to) {
  if (C.call && C.ws) return addPerson(to);
  try {
    await connect();
    const r = await request("call.start", { to });
    C.call = r.call;
    render();
  } catch (e) {
    toast(e.message);
  }
}

async function addPerson(to) {
  try {
    await request("call.add", { to });
    toast("Calling…");
  } catch (e) { toast(e.message); }
}

async function answer() {
  const inc = C.incoming;
  if (!inc) return;
  C.incoming = null;
  stopRing();
  render();
  try {
    await connect();
    const r = await request("call.accept", { id: inc.id });
    C.call = r.call;
    syncSubs();
    render();
  } catch (e) { toast(e.message); }
}

function decline() {
  const inc = C.incoming;
  if (!inc) return;
  endRing({ id: inc.id });
  if (C.ws?.readyState === WebSocket.OPEN) request("call.decline", { id: inc.id }).catch(() => {});
  else postJson("/api/calls/decline", { id: inc.id }).catch(() => {});
}

async function rejoin() {
  try {
    await connect();   // the server puts you back in your call as soon as you connect
  } catch (e) { toast(e.message); }
}

async function hangup() {
  if (C.ws?.readyState === WebSocket.OPEN) await request("call.leave").catch(() => {});
  else await postJson("/api/calls/leave", {}).catch(() => {});
  C.rejoin = null;
  hangupLocal();
}

function toggleMic() {
  C.mic = !C.mic;
  if (C.track) C.track.enabled = C.mic;
  if (!C.mic) C.talking = false;
  sendState({ mic: C.mic, talking: false });
  render();
}

function addDialog() {
  const name = h("input", { class: "input", id: "call-add-name", maxlength: 32, placeholder: "Friend's name", autocomplete: "off" });
  const list = h("div", { class: "call-add-list" }, h("p", { class: "text-3 small", style: "margin:0", text: "Loading your friends…" }));
  let dlg = null;
  getJson("/api/friends").then((d) => {
    const here = new Set((C.call?.people || []).map((p) => p.id));
    const friends = (d.friends || []).filter((f) => !here.has(f.id));
    list.replaceChildren(...(friends.length ? friends.map((f) => h("div", { class: "vinvite" },
      h("span", {}, f.username, f.inGame ? h("span", { class: "text-3 small", text: " · playing" }) : null),
      h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Add", onclick: () => { addPerson(f.id); dlg?.close(); } })))
      : [h("p", { class: "text-3 small", style: "margin:0", text: "No other friends to add. Type a name below." })]));
  }).catch(() => list.replaceChildren(h("p", { class: "text-3 small", style: "margin:0", text: "Type their name below." })));
  dlg = openDialog({
    title: "Add someone to the call",
    body: h("div", { class: "form" }, h("p", { class: "text-2 small", style: "margin:0", text: `Up to ${C.call?.max || 4} people. They need to be your friend.` }),
      list, field("Or type a name", name)),
    actions: [{ label: "Close" }, { label: "Call", kind: "primary", onClick: async () => { await request("call.add", { to: name.value }); toast("Calling…"); } }],
  });
}

// ---------- the call bar ----------
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${hh ? `${hh}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}`;
};
const btn = (cls, icon, label, onclick, extra = {}) =>
  h("button", { class: `call-dock-btn ${cls}`, type: "button", "aria-label": label, title: label, onclick, ...extra }, iconEl(icon));

function render() {
  clearInterval(render.t);
  const showing = C.incoming || C.call || C.rejoin;
  if (!showing) {
    dock?.remove();
    dock = null;
    return;
  }
  if (!dock) {
    dock = h("div", { class: "call-dock", role: "region", "aria-label": "Call" });
    document.body.append(dock);
  }
  if (C.incoming && !C.call) {   // someone is calling you
    const inc = C.incoming;
    dock.className = "call-dock incoming";
    dock.replaceChildren(
      h("span", { class: "call-ring", "aria-hidden": "true" }, iconEl("phone")),
      h("div", { class: "call-dock-text" }, h("b", { text: inc.from }),
        h("span", { class: "text-3 small", text: inc.with.length ? `is calling you, with ${inc.with.join(", ")}` : "is calling you" })),
      h("div", { class: "call-dock-actions" },
        h("button", { class: "btn btn-danger btn-sm", type: "button", text: "Decline", onclick: decline }),
        h("button", { class: "btn btn-primary btn-sm call-answer", type: "button", onclick: answer }, iconEl("phone"), "Answer")));
    return;
  }
  if (C.rejoin && !C.call) {   // in a call, but this page isn't connected (you opened a new page)
    const others = C.rejoin.people.filter((p) => p.id !== C.rejoin.me && p.state === "in").map((p) => p.username);
    dock.className = "call-dock";
    dock.replaceChildren(
      h("span", { class: "call-ring still", "aria-hidden": "true" }, iconEl("phone")),
      h("div", { class: "call-dock-text" }, h("b", { text: others.length ? `Call with ${others.join(", ")}` : "You're in a call" }),
        h("span", { class: "text-3 small", text: "Tap Join to talk on this page" })),
      h("div", { class: "call-dock-actions" },
        h("button", { class: "btn btn-danger btn-sm", type: "button", text: "Hang up", onclick: hangup }),
        h("button", { class: "btn btn-primary btn-sm call-answer", type: "button", text: "Join", onclick: rejoin })));
    return;
  }
  const c = C.call;
  const others = c.people.filter((p) => p.id !== C.myId);
  const inCall = others.filter((p) => p.state === "in");
  const ringing = others.filter((p) => p.state === "ringing");
  const status = () => {
    if (!inCall.length) return ringing.length ? `Calling ${ringing.map((p) => p.username).join(", ")}…` : "Waiting…";
    return [c.startedAt ? clock(Date.now() - c.startedAt) : "", ringing.length ? `calling ${ringing.map((p) => p.username).join(", ")}…` : ""]
      .filter(Boolean).join(" · ");
  };
  const statusEl = h("span", { class: "text-3 small call-dock-status", text: status() });
  render.t = setInterval(() => { statusEl.textContent = status(); }, 1000);
  const faces = h("div", { class: "call-faces" }, ...c.people.map((p) => {
    const me = p.id === C.myId;
    const talking = me ? C.talking : p.talking && p.state === "in";
    const off = me ? !C.mic : p.state === "in" && p.mic === false;
    return h("span", { class: `call-face${talking ? " talking" : ""}${p.state === "ringing" ? " ringing" : ""}${off ? " muted" : ""}`,
      title: `${me ? "You" : p.username}${p.state === "ringing" ? " (ringing)" : !me && !p.live ? " (connecting)" : off ? " (muted)" : ""}`,
      text: (p.username || "?").slice(0, 1).toUpperCase() });
  }));
  dock.className = "call-dock active";
  dock.replaceChildren(faces,
    h("div", { class: "call-dock-text" }, h("b", { text: others.length ? others.map((p) => p.username).join(", ") : "Call" }), statusEl),
    h("div", { class: "call-dock-actions" },
      btn(C.mic ? "" : "off", C.mic ? "mic" : "micOff", C.mic ? "Mute" : "Unmute", toggleMic, { "aria-pressed": String(!C.mic) }),
      btn("", "userPlus", "Add someone", addDialog, { disabled: c.people.length >= c.max }),
      btn("end", "phone", "Hang up", hangup)));
  if (!inCall.length && ringing.length) startRing("outgoing");
  else if (ring.kind === "outgoing") stopRing();
}

// ---------- page load ----------
let started = false;
export async function initCalls() {
  if (started) return;
  started = true;
  window.addEventListener("pagehide", () => { if (C.ws) { C.leaving = true; try { C.ws.close(1000, "bye"); } catch { /* ignore */ } } });
  let d;
  try { d = await getJson("/api/calls/state"); } catch { return; }   // signed out
  const answerId = new URLSearchParams(location.search).get("answer");
  if (answerId) history.replaceState(null, "", location.pathname + location.hash);
  if (d.incoming) showIncoming(d.incoming);
  else if (answerId) toast("That call has ended.");
  if (d.call && !C.call) {
    C.rejoin = { ...d.call, me: Number((await getJson("/api/me").catch(() => ({})))?.user?.id) };
    render();
  }
}
