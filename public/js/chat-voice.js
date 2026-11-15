// Voice messages (Galaxy+, Galaxy Pro+ and staff with picture rights): the microphone button next to the message
// box in chat and DMs records up to 1 minute, lets you listen back, then sends it. Everyone can play them.
import { toast, iconEl } from "/js/site.js";
import { h, getJson, postJson, openDialog } from "/js/dialog.js";
import { chatState as state, chatSend, currentChannel, messageBodyHooks, composerHooks } from "/js/chat.js";

const MAX_MS = 60_000;
let rightsP = null;
export const voiceRights = () => (rightsP ||= getJson("/api/uploads/rights").catch(() => ({})));

const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>';
const STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.2" fill="currentColor"/></svg>';

// Bars that look like a waveform; the same message always gets the same shape.
function bars(seed, n = 28) {
  let x = (Number(seed) || 7) * 9301 + 49297;
  return Array.from({ length: n }, (_, i) => {
    x = (x * 9301 + 49297) % 233280;
    const env = Math.sin(Math.PI * (i + 0.5) / n) * 0.55 + 0.45;
    return Math.round((0.25 + (x / 233280) * 0.75) * env * 100);
  });
}

// ---------- the player ----------
export function voicePlayer({ src, ms, seed }) {
  const audio = new Audio();
  audio.preload = "none";
  audio.src = src;
  const btn = h("button", { class: "vp-btn", type: "button", "aria-label": "Play voice message" });
  btn.innerHTML = PLAY;
  const wave = h("span", { class: "vp-wave", "aria-hidden": "true" }, ...bars(seed).map((v) => h("i", { style: `height:${v}%` })));
  const time = h("span", { class: "vp-time", text: fmt(ms) });
  const box = h("div", { class: "vp" }, btn, wave, time);
  const draw = () => {
    const dur = (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : ms) || 1;
    const p = Math.min(1, (audio.currentTime * 1000) / dur);
    const lit = Math.round(p * wave.children.length);
    [...wave.children].forEach((b, i) => b.classList.toggle("on", i < lit));
    time.textContent = audio.paused && !audio.currentTime ? fmt(ms) : fmt(audio.currentTime * 1000);
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (audio.paused) {
      document.querySelectorAll(".vp.playing").forEach((o) => o !== box && o.dispatchEvent(new Event("vp-stop")));
      audio.play().catch(() => toast("This voice message couldn't play on this device."));
    } else audio.pause();
  });
  box.addEventListener("vp-stop", () => audio.pause());
  wave.addEventListener("click", (e) => { // tap the waveform to jump
    e.stopPropagation();
    const r = wave.getBoundingClientRect();
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : ms / 1000;
    const go = () => { audio.currentTime = Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur)); draw(); };
    if (audio.readyState >= 1) go(); else { audio.addEventListener("loadedmetadata", go, { once: true }); audio.load(); }
  });
  audio.addEventListener("play", () => { box.classList.add("playing"); btn.innerHTML = PAUSE; btn.setAttribute("aria-label", "Pause"); });
  audio.addEventListener("pause", () => { box.classList.remove("playing"); btn.innerHTML = PLAY; btn.setAttribute("aria-label", "Play voice message"); });
  audio.addEventListener("timeupdate", draw);
  audio.addEventListener("ended", () => { audio.currentTime = 0; draw(); });
  return box;
}

// ---------- the recorder ----------
function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/aac"]) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* try the next */ }
  }
  return "";
}

const toBase64 = (blob) => new Promise((ok, bad) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] || "");
  r.onerror = () => bad(new Error("The recording couldn't be read."));
  r.readAsDataURL(blob);
});

// Shows the recording bar in place of `composer`; calls onSend(audioId) once the recording is uploaded.
export async function recordVoice(composer, onSend) {
  const mime = pickMime();
  if (mime === null || !navigator.mediaDevices?.getUserMedia) { toast("Voice messages aren't supported in this browser."); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { toast("Allow microphone access to record a voice message."); return; }
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };

  // a live level meter while recording
  let ctx = null, analyser = null, raf = 0;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
  } catch { analyser = null; }

  const meter = h("span", { class: "vr-meter", "aria-hidden": "true" }, ...Array.from({ length: 24 }, () => h("i")));
  const clock = h("span", { class: "vr-time", text: "0:00" });
  const cancel = h("button", { class: "icon-btn", type: "button", "aria-label": "Delete recording", title: "Delete" }, iconEl("trash"));
  const stop = h("button", { class: "vr-stop", type: "button", "aria-label": "Stop recording" });
  stop.innerHTML = STOP;
  const bar = h("div", { class: "vr-bar", role: "group", "aria-label": "Recording a voice message" },
    cancel, h("span", { class: "vr-dot", "aria-hidden": "true" }), clock, meter, h("span", { class: "vr-max text-3", text: "/ 1:00" }), stop);
  composer.hidden = true;
  composer.after(bar);

  const started = Date.now();
  let elapsed = 0, cancelled = false;
  const levels = new Uint8Array(128);
  const tick = () => {
    elapsed = Date.now() - started;
    clock.textContent = fmt(elapsed);
    if (analyser) {
      analyser.getByteTimeDomainData(levels);
      let peak = 0;
      for (const v of levels) peak = Math.max(peak, Math.abs(v - 128));
      const kids = meter.children;
      for (let i = 0; i < kids.length - 1; i++) kids[i].style.height = kids[i + 1].style.height || "12%";
      kids[kids.length - 1].style.height = `${Math.max(12, Math.min(100, (peak / 64) * 100))}%`;
    }
    if (elapsed >= MAX_MS) { finish(); return; }
    raf = requestAnimationFrame(tick);
  };
  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
  };
  const restore = () => { bar.remove(); composer.hidden = false; composer.querySelector("textarea")?.focus(); };
  function finish() { if (rec.state !== "inactive") rec.stop(); }
  cancel.addEventListener("click", () => { cancelled = true; finish(); });
  stop.addEventListener("click", finish);
  rec.onstop = () => {
    cleanup();
    if (cancelled) { restore(); return; }
    const ms = Math.min(MAX_MS, elapsed);
    if (ms < 700) { restore(); toast("That was too short. Hold on a little longer."); return; }
    const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
    const url = URL.createObjectURL(blob);
    const del = h("button", { class: "icon-btn", type: "button", "aria-label": "Delete recording", title: "Delete" }, iconEl("trash"));
    const sendBtn = h("button", { class: "btn btn-primary send", type: "button", "aria-label": "Send voice message" }, iconEl("send"));
    bar.classList.add("review");
    bar.replaceChildren(del, voicePlayer({ src: url, ms, seed: blob.size }), sendBtn);
    del.addEventListener("click", () => { URL.revokeObjectURL(url); restore(); });
    sendBtn.addEventListener("click", async () => {
      sendBtn.disabled = del.disabled = true;
      sendBtn.classList.add("busy");
      try {
        const r = await postJson("/api/chat/voice", { mime: blob.type, data: await toBase64(blob), ms });
        await onSend(r.id);
        URL.revokeObjectURL(url);
        restore();
      } catch (e) {
        toast(e.message);
        sendBtn.disabled = del.disabled = false;
        sendBtn.classList.remove("busy");
      }
    });
  };
  rec.start(250);
  raf = requestAnimationFrame(tick);
}

function perkDialog() {
  openDialog({
    title: "Voice messages are a Galaxy+ perk",
    body: h("p", { class: "text-2", text: "Galaxy+ and Galaxy Pro+ members can send voice messages of up to 1 minute in chat and DMs. Everyone can listen to them." }),
    actions: [{ label: "Close" }, { label: "See Galaxy+", kind: "primary", onClick: () => { location.href = "/store"; } }],
  });
}

// A mic button for any message box. `composer` is the element hidden while recording.
export function micButton(composer, onSend) {
  const b = h("button", { class: "icon-btn composer-mic", type: "button", "aria-label": "Record a voice message", title: "Voice message" }, iconEl("mic"));
  b.addEventListener("click", async () => {
    const r = await voiceRights();
    if (r.blocked) return toast("Staff turned off uploads for your account.");
    if (!r.voice) return perkDialog();
    recordVoice(composer, onSend);
  });
  return b;
}

// ---------- in channels ----------
// (registered after chat.js has loaded: chat.js and the DM panel import each other)
queueMicrotask(() => {
  messageBodyHooks.push((m, body, text) => {
    if (!m.audio) return;
    if (!m.content) text.hidden = true;
    body.append(voicePlayer({ src: `/api/chat/voice/${m.audio.id}`, ms: m.audio.ms, seed: m.audio.id }));
  });

  const form = document.getElementById("composer");
  let mic = null;
  composerHooks.push((ch, open) => {
    if (!form) return;
    if (!mic) {
      mic = micButton(form, (audioId) => {
        const nonce = Math.random().toString(36).slice(2);
        chatSend({ type: "send", channelId: state.channelId, content: "", audioId, nonce, replyTo: state.replyTo?.id || null });
      });
      form.querySelector(".send")?.before(mic);
    }
    mic.hidden = !open || !currentChannel();
  });
});
