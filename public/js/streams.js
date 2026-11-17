// Community > Voice & Stages > #Stages, like Discord Stages: speakers talk, and can share their screen or turn
// on their camera; the audience listens, chats, reacts and can raise their hand to ask to speak. Great for
// podcasts, shows and build tours. The list (live now, coming up, your crew), "Start a stage", and the stage view.
// Voice and video go through Cloudflare Realtime (like voice chat): one connection to send (speakers) and one to
// receive (everyone). The server (src/streams/room.js) decides who may speak and who receives what.
import { h, getJson, postJson, openDialog, field } from "/js/dialog.js";
import { iconEl } from "/js/site.js";
import { faceSvg } from "/js/face.js";
import { eventHooks } from "/js/chat.js";

const ICE = [{ urls: "stun:stun.cloudflare.com:3478" }];
let active = null;          // the rendered #Stages view ({ reload })

eventHooks.push((data) => { if (data.type === "streams_changed" && active?.listing) active.reload(); });

const face = (src, name, size = 32) => {
  const img = h("img", { class: "st-face", alt: "", width: size, height: size, src: src || faceSvg(name || "?") });
  img.onerror = () => { img.onerror = null; img.src = faceSvg(name || "?"); };
  return img;
};
const hostLabel = (s) => (s.host.type === "team"
  ? h("span", { class: "st-host" }, h("span", { class: "team-tag", text: `[${s.host.tag}]` }), h("b", { text: s.host.name }))
  : h("span", { class: "st-host" }, face(s.host.head, s.host.name, 22), h("b", { text: s.host.name })));
const whenText = (iso) => {
  const d = new Date(iso);
  const day = d.toDateString() === new Date().toDateString() ? "Today" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return `${day}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};
const STAGE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.5"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/></svg>';
const stageIcon = () => { const s = h("span", { class: "ic", "aria-hidden": "true" }); s.innerHTML = STAGE_SVG; return s; };

export function renderStreams(root, helpers) {
  const toast = helpers.toast;
  const box = h("div", { class: "st-wrap" });
  root.append(box);
  let stream = null;   // the open stage (if any)
  const view = { listing: true, reload: () => showList() };
  active = view;
  helpers.setCleanup?.(() => { stream?.close(); stream = null; if (active === view) active = null; });

  const act = async (body, after) => {
    try { const r = await postJson("/api/streams", body); if (r.message) toast(r.message); await after?.(r); return r; }
    catch (e) { toast(e.message); return null; }
  };

  // ---------- the list ----------
  async function showList() {
    view.listing = true;
    stream?.close(); stream = null;
    try { history.replaceState(null, "", "#stages"); } catch { /* ignore */ }
    let d;
    try { d = await getJson("/api/streams"); } catch (e) { box.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    if (!view.listing) return;
    const parts = [];
    parts.push(h("header", { class: "st-head" },
      h("div", {}, h("h2", { text: "Stages" }), h("p", { class: "text-2", text: "Live talks, podcasts and screen shares from players and teams. Listen in, chat, and raise your hand to speak." })),
      d.canHost ? h("button", { class: "btn btn-primary", type: "button", onclick: () => goLiveDialog(d) }, stageIcon(), "Start a stage") : null));
    if (d.banned) parts.push(h("p", { class: "st-note st-note-bad", text: `Staff stopped you from hosting stages until ${whenText(d.banned.until)}${d.banned.reason ? ` (${d.banned.reason})` : ""}.` }));
    else if (!d.canHost) parts.push(h("p", { class: "st-note", text: d.hasTeam
      ? "Your team's organizer and Admins can start team stages. Hosting your own stage is a Galaxy+ and Galaxy Pro+ perk."
      : "Hosting your own stage is a Galaxy+ and Galaxy Pro+ perk. Teams can host stages too: make or join one in Friends > Team." }));

    parts.push(h("h3", { class: "st-h" }, h("span", { class: "st-dot" }), "Live now"));
    if (!d.live.length) parts.push(h("p", { class: "text-3 st-empty", text: "No stages are live right now." }));
    else parts.push(h("div", { class: "st-grid" }, ...d.live.map((s) => liveCard(s))));

    parts.push(h("h3", { class: "st-h", text: "Coming up" }));
    if (!d.upcoming.length) parts.push(h("p", { class: "text-3 st-empty", text: "No stages scheduled yet." }));
    else parts.push(h("div", { class: "st-list" }, ...d.upcoming.map((s) => upcomingRow(s))));

    parts.push(h("section", { class: "st-soon" }, iconEl("headphones"),
      h("div", {}, h("b", { text: "Recorded episodes" }), h("span", { class: "chip", text: "Coming soon" }),
        h("p", { class: "text-3", text: "Save podcasts and shows so people can listen any time." }))));

    if (d.crew) parts.push(crewBox(d.crew));
    if (d.crewOf.length) {
      parts.push(h("section", { class: "panel st-box" }, h("h3", { class: "st-h", style: "margin-top:0", text: "Crews you're on" }),
        ...d.crewOf.map((c) => h("div", { class: "st-row" },
          h("span", {}, h("b", { text: c.username }), h("small", { class: "text-3", text: c.role === "editor" ? " · Editor: you can start and run their stages" : " · Speaker: you can speak on their stages" })),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Leave", onclick: () => act({ action: "crew-remove", hostId: c.hostId }, showList) })))));
    }
    if (d.recent.length) {
      parts.push(h("h3", { class: "st-h", text: "Recently live" }));
      parts.push(h("div", { class: "st-list" }, ...d.recent.map((s) => h("div", { class: "st-row st-past" },
        h("span", { class: "st-row-main" }, h("b", { text: s.title }), hostLabel(s)),
        h("small", { class: "text-3", text: `${s.peak} listening at most · ${whenText(s.endedAt || s.startedAt)}` })))));
    }
    box.replaceChildren(...parts);
    if (helpers.sub && /^\d+$/.test(helpers.sub)) { const id = Number(helpers.sub); helpers.sub = null; openStream(id); }
  }

  function followBtn(s) {
    let on = Boolean(s.following);
    const b = h("button", { class: "btn btn-ghost btn-sm", type: "button" });
    const draw = () => { b.replaceChildren(iconEl(on ? "check" : "plus"), on ? "Following" : "Follow"); };
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const r = await act({ action: "follow", on: !on, ...(s.host.type === "team" ? { teamId: s.host.id } : { userId: s.host.id }) });
      if (r) { on = !on; draw(); }
    });
    draw();
    return b;
  }

  function liveCard(s) {
    return h("article", { class: "st-card", tabindex: "0", onclick: () => openStream(s.id), onkeydown: (e) => { if (e.key === "Enter") openStream(s.id); } },
      h("div", { class: "st-thumb" },
        h("span", { class: "st-live", text: "LIVE" }),
        h("span", { class: "st-viewers" }, iconEl("headphones"), String(s.viewers)),
        h("span", { class: "st-thumb-ic" }, stageIcon())),
      h("div", { class: "st-card-body" },
        h("b", { class: "st-title", text: s.title }),
        hostLabel(s),
        s.onStage.length ? h("small", { class: "text-3", text: `Speaking: ${s.onStage.slice(0, 4).join(", ")}${s.onStage.length > 4 ? "…" : ""}` }) : null,
        h("div", { class: "st-card-actions" }, followBtn(s),
          h("button", { class: "btn btn-primary btn-sm", type: "button", text: s.manage ? "Open" : "Join" }))));
  }

  function upcomingRow(s) {
    let on = Boolean(s.reminding);
    const remind = h("button", { class: "btn btn-ghost btn-sm", type: "button" });
    const draw = () => remind.replaceChildren(iconEl(on ? "check" : "bell"), on ? "Reminder set" : "Notify me");
    remind.addEventListener("click", async () => { if (await act({ action: "remind", id: s.id, on: !on })) { on = !on; draw(); } });
    draw();
    return h("div", { class: "st-row" },
      h("span", { class: "st-when" }, h("b", { text: whenText(s.scheduledAt) })),
      h("span", { class: "st-row-main" }, h("b", { text: s.title }), hostLabel(s)),
      h("span", { class: "st-row-btns" },
        s.manage ? h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Start now", onclick: () => act({ action: "start", id: s.id }, (r) => openStream(r.id, { autoStage: true })) }) : remind,
        s.manage ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Cancel", onclick: () => act({ action: "cancel", id: s.id }, showList) }) : followBtn(s)));
  }

  function crewBox(crew) {
    const name = h("input", { class: "input", id: "st-crew-name", maxlength: 32, placeholder: "Member name" });
    const role = h("select", { class: "input", id: "st-crew-role" }, h("option", { value: "streamer", text: "Speaker" }), h("option", { value: "editor", text: "Editor" }));
    const form = h("form", { class: "st-crew-add" }, name, role, h("button", { class: "btn btn-primary", type: "submit" }, iconEl("userPlus"), "Add"));
    form.addEventListener("submit", (e) => { e.preventDefault(); if (name.value.trim()) act({ action: "crew-add", name: name.value, role: role.value }, showList); });
    return h("section", { class: "panel st-box" },
      h("h3", { class: "st-h", style: "margin-top:0", text: "Your stage crew" }),
      h("p", { class: "text-3", style: "margin:0 0 8px", text: "Speakers can speak on your stages any time. Editors can also start and end them, change the topic, run the chat and bring people up to speak." }),
      ...crew.map((c) => h("div", { class: "st-row" },
        h("span", {}, h("b", { text: c.username }), h("span", { class: "tm-role", text: c.role === "editor" ? "Editor" : "Speaker" })),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": `Remove ${c.username}`, onclick: () => act({ action: "crew-remove", userId: c.id }, showList) }, iconEl("trash")))),
      form);
  }

  function goLiveDialog(d) {
    const as = h("select", { class: "input", id: "st-as" }, ...d.as.map((a) => h("option", { value: a.key, text: a.label })));
    const title = h("input", { class: "input", id: "st-title", maxlength: 80, placeholder: "e.g. Survival podcast: our best builds" });
    const when = h("select", { class: "input", id: "st-when" }, h("option", { value: "now", text: "Now" }), h("option", { value: "later", text: "Schedule for later" }));
    const at = h("input", { class: "input", id: "st-at", type: "datetime-local" });
    const atField = field("Date and time", at);
    atField.hidden = true;
    when.addEventListener("change", () => { atField.hidden = when.value !== "later"; });
    openDialog({ title: "Start a stage", body: h("div", { class: "form" },
      d.as.length > 1 ? field("Who's hosting", as) : null, field("Topic", title), field("When", when), atField,
      h("p", { class: "text-3 small", style: "margin:0", text: "Speakers can talk, share their screen and turn on their camera. Be kind and follow the rules: staff can end any stage. Don't share personal information like your address, school or full name." })),
    actions: [{ label: "Cancel" }, { label: "Continue", kind: "primary", onClick: async () => {
      const body = { action: "create", as: d.as.length > 1 ? as.value : d.as[0].key, title: title.value };
      if (when.value === "later") { if (!at.value) throw new Error("Pick a date and time."); body.at = new Date(at.value).toISOString(); }
      const r = await postJson("/api/streams", body);
      toast(r.message);
      if (r.live) openStream(r.id, { autoStage: true }); else showList();
    } }] });
  }

  // ---------- one stage ----------
  async function openStream(id, opts = {}) {
    view.listing = false;
    stream?.close();
    try { history.replaceState(null, "", `#stages/${id}`); } catch { /* ignore */ }
    let d;
    try { d = await getJson(`/api/streams/${id}`); } catch (e) { toast(e.message); return showList(); }
    const s = d.stream;
    const back = h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => showList() }, iconEl("arrow", "flip"), "All stages");
    if (s.status !== "live") {
      box.replaceChildren(back, h("section", { class: "panel st-box st-over" },
        h("h2", { text: s.title }), hostLabel(s),
        h("p", { class: "text-2", text: s.status === "ended" ? "This stage has ended." : `Starts ${whenText(s.scheduledAt)}.` }),
        followBtn(s)));
      return;
    }
    stream = new Player(s, d.rights, { toast, back, box, followBtn, autoStage: opts.autoStage });
  }

  showList();
}

// ---------------------------------------------------------------------------------------------
// One open stage: WebSocket to its room, receiving voice/video, speaking, raising your hand, chat, reactions.
class Player {
  constructor(s, rights, ui) {
    Object.assign(this, { s, rights, ui, toast: ui.toast });
    this.req = 0; this.waiting = new Map();
    this.state = { stage: [], viewers: 0, invited: [], hands: [] };
    this.handUp = false;
    this.subs = new Map();      // owner -> { pub, mids: [] }
    this.midInfo = new Map();   // mid -> { owner, kind }
    this.media = new Map();     // owner -> { video: MediaStreamTrack, audio: MediaStreamTrack }
    this.queue = Promise.resolve();
    this.closed = false;
    this.onStage = false;
    this.build();
    this.connect();
  }

  // ---------- layout ----------
  build() {
    const { s, ui } = this;
    this.viewersEl = h("span", { class: "st-viewers st-viewers-inline" }, iconEl("headphones"), "0");
    const menu = [];
    if (this.rights.manage) {
      menu.push(this.peopleBtn());
      menu.push(h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => this.editTitle() }, iconEl("pencil"), "Topic"));
    } else if (this.rights.mod) {
      menu.push(this.peopleBtn());
    }
    if (this.rights.mod && !this.rights.manage && s.host.type === "user") menu.push(h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => this.banDialog() }, iconEl("shield"), "Stop hosting"));
    if (this.rights.manage || this.rights.mod) menu.push(h("button", { class: "btn btn-danger btn-sm", type: "button", text: "End stage", onclick: () => this.endDialog() }));
    else menu.push(h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => this.reportDialog() }, iconEl("flag"), "Report"));
    this.titleEl = h("h2", { class: "st-ptitle", text: s.title });
    const head = h("header", { class: "st-phead" },
      h("div", { class: "st-phead-main" }, ui.back,
        h("div", {}, h("div", { class: "st-ptitle-row" }, h("span", { class: "st-live", text: "LIVE" }), this.titleEl, this.viewersEl), hostLabel(s))),
      h("div", { class: "st-phead-btns" }, this.rights.manage ? null : ui.followBtn(s), ...menu));
    this.stageEl = h("div", { class: "st-stage" });
    this.audienceEl = h("div", { class: "st-audience" });
    this.floatEl = h("div", { class: "st-floats", "aria-hidden": "true" });
    this.startBtn = h("button", { class: "btn btn-primary st-start", type: "button", onclick: () => this.start() },
      iconEl(ui.autoStage ? "mic" : "headphones"), ui.autoStage ? "Start speaking" : "Join the stage");
    this.gate = h("div", { class: "st-gate" }, this.startBtn, h("p", { class: "text-3 small", text: ui.autoStage ? "Your browser will ask to use your microphone. You can share your screen or turn on your camera after." : "You'll join the audience. Raise your hand to ask to speak." }));
    this.audioBox = h("div", { hidden: true });
    this.controls = h("div", { class: "st-controls" });
    this.chatList = h("div", { class: "st-chat-list", role: "log", "aria-live": "polite" });
    this.chatInput = h("input", { class: "input", id: "st-chat-input", maxlength: 200, placeholder: "Say something nice", autocomplete: "off" });
    const chatForm = h("form", { class: "st-chat-form" }, this.chatInput, h("button", { class: "btn btn-primary", type: "submit", "aria-label": "Send" }, iconEl("send")));
    chatForm.addEventListener("submit", (e) => { e.preventDefault(); this.sendChat(); });
    this.reactBar = h("div", { class: "st-react" });
    const stageWrap = h("div", { class: "st-stage-wrap" }, this.stageEl, this.floatEl, this.gate);
    ui.box.replaceChildren(h("div", { class: "st-player" }, head,
      h("div", { class: "st-body" },
        h("div", { class: "st-main" }, stageWrap, this.audienceEl, this.controls, this.reactBar),
        h("aside", { class: "st-chat" }, h("h3", { class: "st-h", style: "margin:0 0 6px", text: "Live chat" }), this.chatList, chatForm)),
      this.audioBox));
    this.renderStage();
  }

  // ---------- connection ----------
  connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/streams/${this.s.id}/ws`);
    this.ws = ws;
    this.ping = setInterval(() => { try { ws.send("ping"); } catch { /* ignore */ } }, 25_000);
    ws.addEventListener("message", (e) => { if (e.data !== "pong") this.onMessage(JSON.parse(e.data)); });
    ws.addEventListener("close", (e) => {
      if (this.closed) return;
      if (e.code === 4003 || e.code === 4004 || this.endedShown) return;
      this.finish(e.reason && e.reason !== "bye" ? e.reason : "You were disconnected from the stage.");
    });
  }
  request(type, data = {}) {
    const req = ++this.req;
    return new Promise((resolve, reject) => {
      this.waiting.set(req, { resolve, reject });
      try { this.ws.send(JSON.stringify({ type, req, ...data })); } catch (e) { this.waiting.delete(req); reject(e); }
      setTimeout(() => { if (this.waiting.has(req)) { this.waiting.delete(req); reject(new Error("The stage didn't answer. Try again.")); } }, 15_000);
    });
  }
  enqueue(fn) { this.queue = this.queue.then(fn).catch((e) => console.warn("stream:", e.message)); }

  onMessage(m) {
    switch (m.type) {
      case "reply": { const w = this.waiting.get(m.req); if (!w) return; this.waiting.delete(m.req); m.error ? w.reject(new Error(m.error)) : w.resolve(m); return; }
      case "hello": this._self = m.you; this.rights = m.rights; this.reactions = m.reactions; this.chatList.replaceChildren(); m.chat.forEach((c) => this.addChat(c)); this.renderReactions(); this.renderControls(); return;
      case "state": {
        this.state = m;
        if (m.info?.title) this.titleEl.textContent = m.info.title;
        this.viewersEl.lastChild.textContent = String(m.viewers);
        this.handUp = (m.hands || []).some((x) => x.id === this._self);
        this.renderStage(); this.renderControls(); this.drawPeopleBtn(); this.syncSubs();
        return;
      }
      case "hand": this.toast(`✋ ${m.username} wants to speak. Open People to bring them up.`); return;
      case "hand.lowered": this.handUp = false; this.renderControls(); this.toast("A host lowered your hand."); return;
      case "chat": this.addChat(m.message); return;
      case "chat.deleted": this.chatList.querySelector(`[data-id="${CSS.escape(m.id)}"]`)?.remove(); return;
      case "react": this.floatReaction(m.emoji); return;
      case "invited": this.invitedDialog(m.by); return;
      case "removed": this.stopPublishing(); this.toast("A host moved you back to the audience."); return;
      case "ended": this.endedShown = true; this.finish(m.reason || "The stage ended."); return;
      case "closed": this.endedShown = true; this.finish(m.reason || "You left the stage."); return;
    }
  }

  // The first tap: create the receiving connection (and, for hosts who just went live, go on stage).
  async start() {
    this.startBtn.disabled = true;
    try {
      await this.ensureSub();
      this.gate.hidden = true;
      if (this.ui.autoStage) await this.goOnStage();
      this.renderControls();
    } catch (e) { this.toast(e.message); this.startBtn.disabled = false; }
  }

  async ensureSub() {
    if (this.sub) return;
    const pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: "max-bundle" });
    pc.addEventListener("track", (e) => this.gotTrack(e.transceiver.mid, e.track));
    pc.createDataChannel("hello");   // something to connect with before anyone's tracks are pulled
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await this.request("rtc.session", { role: "sub", sdp: offer.sdp });
    await pc.setRemoteDescription(res.answer);
    await new Promise((resolve, reject) => {
      if (pc.connectionState === "connected") return resolve();
      const t = setTimeout(() => reject(new Error("Couldn't connect to the stream. Check your internet and try again.")), 15_000);
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "connected") { clearTimeout(t); resolve(); }
        if (pc.connectionState === "failed") { clearTimeout(t); reject(new Error("Couldn't connect to the stream. Check your internet and try again.")); }
      });
    });
    this.sub = pc;
    this.syncSubs();
  }

  // Pull the tracks of everyone on stage; drop people who left or switched tracks.
  syncSubs() {
    if (!this.sub) return;
    const want = new Map(this.state.stage.filter((p) => p.pub && p.id !== this._self).map((p) => [p.id, p.pub]));
    const add = [], drop = [];
    for (const [owner, pub] of want) { const cur = this.subs.get(owner); if (!cur) add.push(owner); else if (cur.pub !== pub) { drop.push(owner); add.push(owner); } }
    for (const owner of this.subs.keys()) if (!want.has(owner)) drop.push(owner);
    if (drop.length) this.enqueue(() => this.closeSubs(drop));
    if (add.length) this.enqueue(() => this.pull(add, want));
  }

  async pull(owners, want) {
    owners = owners.filter((o) => !this.subs.has(o));
    if (!owners.length) return;
    const res = await this.request("rtc.pull", { owners });
    for (const o of owners) this.subs.set(o, { pub: want.get(o), mids: [] });
    for (const t of res.tracks) { this.midInfo.set(t.mid, { owner: t.owner, kind: t.kind }); this.subs.get(t.owner)?.mids.push(t.mid); }
    if (res.offer) {
      await this.sub.setRemoteDescription(res.offer);
      const answer = await this.sub.createAnswer();
      await this.sub.setLocalDescription(answer);
      await this.request("rtc.renegotiate", { sdp: answer.sdp });
    }
  }

  async closeSubs(owners) {
    const mids = [];
    for (const o of owners) {
      const sub = this.subs.get(o);
      if (!sub) continue;
      this.subs.delete(o);
      this.media.delete(o);
      for (const mid of sub.mids) {
        mids.push(mid); this.midInfo.delete(mid);
        const t = this.sub.getTransceivers().find((x) => x.mid === mid);
        if (t && !t.stopped) t.stop();
      }
    }
    this.renderStage();
    if (!mids.length) return;
    const offer = await this.sub.createOffer();
    await this.sub.setLocalDescription(offer);
    const res = await this.request("rtc.close", { mids, sdp: offer.sdp });
    if (res.answer) await this.sub.setRemoteDescription(res.answer);
  }

  gotTrack(mid, track) {
    const info = this.midInfo.get(mid);
    if (!info) return;
    const m = this.media.get(info.owner) || {};
    m[info.kind] = track;
    this.media.set(info.owner, m);
    if (info.kind === "audio") {
      let a = this.audioBox.querySelector(`audio[data-owner="${info.owner}"]`);
      if (!a) { a = h("audio", { "data-owner": String(info.owner) }); a.autoplay = true; this.audioBox.append(a); }
      a.srcObject = new MediaStream([track]);
      a.play().catch(() => {});
    }
    this.renderStage();
  }

  // ---------- going on stage ----------

  async goOnStage(asGuest = false) {
    if (this.onStage) return;
    await this.ensureSub();
    await this.request("stage.join");
    this.onStage = true;
    try {
      // speakers start with just their microphone; screen share and camera are buttons
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      await this.request("stage.leave").catch(() => {});
      this.onStage = false;
      throw new Error("Allow the microphone to speak on the stage (check your browser's site settings).");
    }
    this.mic = this.local.getAudioTracks()[0];
    this.cam = null;
    await this.request("rtc.session", { role: "pub" });
    const pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: "max-bundle" });
    this.pub = pc;
    this.aTx = pc.addTransceiver(this.mic, { direction: "sendonly" });
    const tracks = [];
    this.vTx = pc.addTransceiver("video", { direction: "sendonly" });   // filled by screen share or camera
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    tracks.push({ mid: this.aTx.mid, kind: "audio" });
    if (this.vTx) tracks.push({ mid: this.vTx.mid, kind: "video" });
    const res = await this.request("rtc.push", { sdp: offer.sdp, tracks, cam: false });
    await pc.setRemoteDescription(res.answer);
    this.micOn = true; this.camOn = false; this.screenOn = false;
    if (asGuest) this.toast("You're a speaker now!");
    this.renderControls(); this.renderStage();
  }

  limitVideo(bps) {
    const sender = this.vTx?.sender;
    if (!sender) return;
    const p = sender.getParameters();
    p.encodings = p.encodings?.length ? p.encodings : [{}];
    p.encodings[0].maxBitrate = bps;
    sender.setParameters(p).catch(() => {});
  }

  sendMedia() { this.request("media", { mic: this.micOn, cam: this.camOn, screen: this.screenOn }).catch(() => {}); this.renderControls(); this.renderStage(); }
  toggleMic() { this.micOn = !this.micOn; if (this.mic) this.mic.enabled = this.micOn; this.sendMedia(); }
  async toggleCam() {
    if (!this.vTx) return;
    if (this.screenOn) await this.stopScreen();
    if (this.camOn) { await this.vTx.sender.replaceTrack(null); this.cam?.stop(); this.cam = null; this.camOn = false; }
    else {
      try { const st = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24 } } }); this.cam = st.getVideoTracks()[0]; }
      catch { this.toast("Couldn't start your camera."); return; }
      await this.vTx.sender.replaceTrack(this.cam); this.camOn = true; this.limitVideo(900_000);
    }
    this.sendMedia();
  }
  async toggleScreen() {
    if (!this.vTx) return;
    if (this.screenOn) return this.stopScreen();
    if (!navigator.mediaDevices.getDisplayMedia) { this.toast("Screen sharing needs a computer (phones and tablets can't share their screen from a browser)."); return; }
    let st;
    try { st = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 24, max: 30 } }, audio: false }); } catch { return; }
    this.screen = st.getVideoTracks()[0];
    this.screen.addEventListener("ended", () => this.stopScreen());
    if (this.cam) { this.cam.stop(); this.cam = null; }
    await this.vTx.sender.replaceTrack(this.screen);
    this.limitVideo(1_500_000);
    this.screenOn = true; this.camOn = false;
    this.sendMedia();
  }
  async stopScreen() {
    this.screen?.stop(); this.screen = null; this.screenOn = false;
    await this.vTx?.sender.replaceTrack(null).catch(() => {});
    this.sendMedia();
  }
  async leaveStage() {
    await this.request("stage.leave").catch(() => {});
    this.stopPublishing();
  }
  stopPublishing() {
    this.onStage = false;
    for (const t of [this.mic, this.cam, this.screen]) t?.stop();
    this.local?.getTracks().forEach((t) => t.stop());
    this.mic = this.cam = this.screen = this.local = null;
    try { this.pub?.close(); } catch { /* ignore */ }
    this.pub = this.aTx = this.vTx = null;
    this.renderControls(); this.renderStage();
  }

  // ---------- drawing ----------
  renderStage() {
    const stage = this.state.stage || [];
    const tiles = stage.map((p) => {
      const mine = this.onStage && this._self === p.id;
      const m = this.media.get(p.id) || {};
      let vid = null;
      if (p.cam || p.screen) {
        vid = h("video", { class: p.screen ? "st-video st-screen" : "st-video", playsinline: true, autoplay: true });
        vid.muted = true;
        const track = mine ? (this.screen || this.cam) : m.video;
        if (track) { vid.srcObject = new MediaStream([track]); vid.play().catch(() => {}); }
      }
      return h("div", { class: `st-tile${vid ? " has-video" : ""}${p.screen ? " is-screen" : ""}${p.guest ? " is-guest" : ""}` },
        vid || h("div", { class: "st-avatar" }, face(p.head, p.username, 72)),
        h("div", { class: "st-tile-name" }, p.mic ? null : iconEl("mic", "st-muted-ic"), h("span", { text: p.username }),
          p.screen ? h("small", { text: "Sharing screen" }) : p.guest ? h("small", { text: "Guest" }) : null));
    });
    if (!tiles.length) tiles.push(h("div", { class: "st-tile st-tile-empty" }, h("p", { class: "text-2", text: "Starting soon. No one is speaking yet." })));
    // a screen share takes the big spot
    const shareIdx = stage.findIndex((p) => p.screen);
    if (shareIdx > 0) tiles.unshift(tiles.splice(shareIdx, 1)[0]);
    this.stageEl.dataset.n = String(Math.min(tiles.length, 4));
    this.stageEl.classList.toggle("has-share", shareIdx >= 0);
    this.stageEl.replaceChildren(...tiles);
    // the audience
    const listeners = Math.max(0, (this.state.viewers || 0) - stage.length);
    const hands = this.state.hands || [];
    this.audienceEl.replaceChildren(
      h("span", { class: "st-aud-count" }, iconEl("headphones"), `${listeners} in the audience`),
      hands.length ? h("span", { class: "st-aud-hands" }, `✋ ${hands.length} want${hands.length === 1 ? "s" : ""} to speak`) : null);
  }

  renderControls() {
    const c = [];
    if (this.onStage) {
      c.push(h("button", { class: `btn ${this.micOn ? "btn-secondary" : "btn-danger"} btn-sm`, type: "button", onclick: () => this.toggleMic() }, iconEl("mic"), this.micOn ? "Mute" : "Unmute"));
      c.push(h("button", { class: `btn ${this.screenOn ? "btn-primary" : "btn-secondary"} btn-sm`, type: "button", onclick: () => this.toggleScreen() }, iconEl("image"), this.screenOn ? "Stop sharing" : "Share screen"));
      c.push(h("button", { class: `btn ${this.camOn ? "btn-primary" : "btn-secondary"} btn-sm`, type: "button", onclick: () => this.toggleCam() }, iconEl("camera"), this.camOn ? "Camera off" : "Camera"));
      c.push(h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Move to audience", onclick: () => this.leaveStage() }));
    } else if (this.rights.stage) {
      c.push(h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => this.goOnStage().catch((e) => this.toast(e.message)) }, iconEl("mic"), "Become a speaker"));
    } else {
      c.push(this.handUp
        ? h("button", { class: "btn btn-secondary btn-sm st-hand on", type: "button", onclick: () => this.raiseHand(false) }, "✋ Hand raised · Lower")
        : h("button", { class: "btn btn-primary btn-sm st-hand", type: "button", onclick: () => this.raiseHand(true) }, "✋ Request to speak"));
    }
    this.controls.replaceChildren(...c);
    this.controls.hidden = !c.length;
  }
  async raiseHand(up) {
    try { await this.request("hand", { up }); this.handUp = up; this.renderControls(); if (up) this.toast("The hosts can see your raised hand."); }
    catch (e) { this.toast(e.message); }
  }
  peopleBtn() {
    this.peopleEl = h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => this.peopleDialog() });
    this.drawPeopleBtn();
    return this.peopleEl;
  }
  drawPeopleBtn() {
    if (!this.peopleEl) return;
    const n = (this.state.hands || []).length;
    this.peopleEl.replaceChildren(iconEl("users"), "People", n ? h("span", { class: "st-hand-count", text: `✋ ${n}` }) : "");
  }

  renderReactions() {
    this.reactBar.replaceChildren(...(this.reactions || []).map((e) => h("button", { class: "st-react-btn", type: "button", text: e, "aria-label": `React ${e}`,
      onclick: () => { try { this.ws.send(JSON.stringify({ type: "react", emoji: e })); } catch { /* ignore */ } } })));
  }
  floatReaction(emoji) {
    if (this.floatEl.childElementCount > 30) return;
    const el = h("span", { class: "st-float", text: emoji, style: `left:${10 + Math.random() * 80}%;animation-duration:${2.2 + Math.random() * 1.2}s` });
    el.addEventListener("animationend", () => el.remove());
    this.floatEl.append(el);
  }

  addChat(m) {
    const canDelete = this.rights.manage || this.rights.mod;
    const row = h("div", { class: `st-msg${m.host ? " is-host" : ""}`, "data-id": m.id },
      face(m.head, m.username, 22),
      h("span", { class: "st-msg-text" }, h("b", { text: m.username }), m.host ? h("span", { class: "st-badge", text: "Host" }) : null, " ", m.text),
      canDelete ? h("button", { class: "icon-btn st-msg-del", type: "button", "aria-label": "Delete message", onclick: () => this.request("chat.delete", { id: m.id }).catch((e) => this.toast(e.message)) }, iconEl("x")) : null);
    const stick = this.chatList.scrollTop + this.chatList.clientHeight >= this.chatList.scrollHeight - 30;
    this.chatList.append(row);
    while (this.chatList.childElementCount > 120) this.chatList.firstChild.remove();
    if (stick) this.chatList.scrollTop = this.chatList.scrollHeight;
  }
  async sendChat() {
    const text = this.chatInput.value.trim();
    if (!text) return;
    try { await this.request("chat", { text }); this.chatInput.value = ""; } catch (e) { this.toast(e.message); }
  }

  // ---------- dialogs ----------
  async peopleDialog() {
    let res;
    try { res = await this.request("viewers"); } catch (e) { this.toast(e.message); return; }
    const hands = new Set((this.state.hands || []).map((x) => x.id));
    const others = res.viewers.filter((v) => v.id !== this._self);
    const bringUp = (v) => h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Invite to speak", onclick: async (e) => { e.target.disabled = true; try { await this.request("stage.invite", { id: v.id }); this.toast(`Invited ${v.username} to speak.`); } catch (er) { this.toast(er.message); } } });
    const row = (v) => h("div", { class: "st-row" },
      h("span", { class: "st-host" }, face(v.head, v.username, 26), h("b", { text: v.username }),
        v.onStage ? h("span", { class: "tm-role", text: "Speaker" }) : hands.has(v.id) ? h("span", { class: "tm-role", text: "✋ Wants to speak" }) : v.host ? h("span", { class: "tm-role", text: "Crew" }) : null),
      h("span", { class: "st-row-btns" },
        this.rights.manage && !v.onStage ? bringUp(v) : null,
        this.rights.manage && hands.has(v.id) ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Dismiss", onclick: (e) => { e.target.disabled = true; this.request("hand.dismiss", { id: v.id }).catch((er) => this.toast(er.message)); } }) : null,
        v.onStage ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Move to audience", onclick: () => this.request("stage.remove", { id: v.id }).then(() => this.toast(`${v.username} is back in the audience.`)).catch((er) => this.toast(er.message)) }) : null,
        !v.host ? h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": `Remove ${v.username} from the stage`, onclick: () => this.request("kick", { id: v.id }).then(() => this.toast(`${v.username} was removed.`)).catch((er) => this.toast(er.message)) }, iconEl("trash")) : null));
    const groups = [
      ["Requests to speak", others.filter((v) => hands.has(v.id) && !v.onStage)],
      ["Speakers", others.filter((v) => v.onStage)],
      ["Audience", others.filter((v) => !v.onStage && !hands.has(v.id))],
    ].filter(([, list]) => list.length);
    openDialog({ title: `On this stage (${res.viewers.length})`, body: h("div", { class: "st-people" },
      ...(groups.length ? groups.flatMap(([name, list]) => [h("h4", { class: "st-people-h", text: name }), ...list.map(row)]) : [h("p", { class: "text-3", text: "Nobody else is here yet." })])),
    actions: [{ label: "Done" }] });
  }
  invitedDialog(by) {
    openDialog({ title: "Speak on the stage?", body: h("p", { class: "text-2", style: "margin:0", text: `${by} invited you to speak. Everyone on the stage will hear you. You can share your screen or turn on your camera if you want.` }),
      actions: [{ label: "No thanks", onClick: () => { this.request("stage.decline").catch(() => {}); } },
        { label: "Speak", kind: "primary", onClick: async () => { this.gate.hidden = true; await this.goOnStage(true); this.renderControls(); } }] });
  }
  editTitle() {
    const input = h("input", { class: "input", id: "st-edit-title", maxlength: 80 });
    input.value = this.titleEl.textContent;
    openDialog({ title: "Stage topic", body: field("Topic", input), actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => { await postJson("/api/streams", { action: "edit", id: this.s.id, title: input.value }); } }] });
  }
  endDialog() {
    openDialog({ title: "End the stage?", body: h("p", { class: "text-2", style: "margin:0", text: "Everyone on it will see that it ended." }),
      actions: [{ label: "Cancel" }, { label: "End stage", kind: "danger", onClick: async () => { await postJson("/api/streams", { action: "end", id: this.s.id }); } }] });
  }
  reportDialog() {
    const reason = h("select", { class: "input", id: "st-report-reason" }, ...["Inappropriate content", "Bullying or hate", "Sharing personal info", "Scam or spam", "Other"].map((r) => h("option", { value: r, text: r })));
    const details = h("textarea", { class: "input", id: "st-report-details", maxlength: 300, rows: 3, placeholder: "What happened? (optional)" });
    openDialog({ title: "Report this stage", body: h("div", { class: "form" }, field("Reason", reason), field("Details", details)),
      actions: [{ label: "Cancel" }, { label: "Send report", kind: "primary", onClick: async () => { const r = await postJson("/api/streams", { action: "report", id: this.s.id, reason: reason.value, details: details.value }); this.toast(r.message); } }] });
  }
  banDialog() {
    const days = h("select", { class: "input", id: "st-ban-days" }, ...[[1, "1 day"], [7, "1 week"], [30, "30 days"], [3650, "Permanently"]].map(([v, t]) => h("option", { value: String(v), text: t })));
    const reason = h("input", { class: "input", id: "st-ban-reason", maxlength: 120, placeholder: "Reason (they'll see it)" });
    openDialog({ title: `Stop ${this.s.host.name} from hosting stages`, body: h("div", { class: "form" }, field("For how long", days), field("Reason", reason),
      h("p", { class: "text-3 small", style: "margin:0", text: "Their live stage ends now. They can still listen to other stages." })),
    actions: [{ label: "Cancel" }, { label: "Stop hosting", kind: "danger", onClick: async () => { const r = await postJson("/api/streams", { action: "ban", userId: this.s.host.id, days: Number(days.value), reason: reason.value }); this.toast(r.message); } }] });
  }

  // ---------- the end ----------
  finish(reason) {
    if (this.closed) return;
    this.close();
    document.querySelectorAll("dialog.dialog").forEach((d) => { try { d.close(); } catch { /* ignore */ } d.remove(); });  // e.g. an open "Speak on the stage?"

    this.ui.box.replaceChildren(this.ui.back, h("section", { class: "panel st-box st-over" }, h("h2", { text: this.s.title }), hostLabel(this.s),
      h("p", { class: "text-2", text: reason }), this.ui.followBtn(this.s)));
  }
  close() {
    this.closed = true;
    clearInterval(this.ping);
    this.stopPublishing?.();
    try { this.sub?.close(); } catch { /* ignore */ }
    try { this.ws?.close(1000, "bye"); } catch { /* ignore */ }
    this.audioBox?.querySelectorAll("audio").forEach((a) => { a.srcObject = null; });
  }
}
