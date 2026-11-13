// Galaxy Wrapped: a Spotify-style story of your time on GalaxySMP. Full-screen slides that play by themselves
// (tap the right side for next, the left side for back, hold to pause), with music made right in the browser,
// a few slides about the whole server, and a share card at the end. All text goes in with textContent.
import { iconEl, toast } from "/js/site.js";
import { h, getJson, postJson } from "/js/dialog.js";

const root = document.getElementById("wr-root");
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const usd = (c) => {
  const d = Math.abs(Number(c) / 100);
  for (const [s, u] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (d >= s) return `$${(d / s).toFixed(d / s >= 100 ? 0 : 1).replace(/\.0$/, "")}${u}`;
  return `$${d.toFixed(d % 1 ? 2 : 0)}`;
};
const PARTS = {
  morning: ["sun", "Morning player", "You started your days on GalaxySMP."],
  afternoon: ["sun", "Afternoon player", "After school or work, you logged in."],
  evening: ["moon", "Evening player", "Your evenings belonged to GalaxySMP."],
  night: ["moon", "Night Owl", "When everyone else was asleep, you were playing."],
};
// "More than 87% of players" (or "More than anyone else!" when they're the top)
const beat = (pct) => (pct >= 100 ? "More than anyone else!" : `More than ${pct}% of players`);
const longDay = (s) => new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" });
let muted = false;
try { muted = localStorage.getItem("wr-muted") === "1"; } catch { /* private mode */ }

// ===================================================================
// Music: a calm loop made with the Web Audio API (nothing is downloaded).
// Chords Am - F - C - G, a soft pad, a plucked arpeggio, light drums.
// ===================================================================
class Music {
  constructor() { this.ctx = null; this.timer = null; this.step = 0; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    // a little echo
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.32;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(wet).connect(this.master);
    this.setMuted(muted);
    this.bpm = 92;
    this.next = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  }
  setMuted(m) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 0.55, t, m ? 0.08 : 0.8);
  }
  stop() {
    if (!this.ctx) return;
    clearInterval(this.timer);
    const ctx = this.ctx;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    setTimeout(() => ctx.close(), 1500);
    this.ctx = null;
  }
  note(freq, at, len, { type = "triangle", vol = 0.2, cutoff = 2400, echo = false } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = freq;
    f.type = "lowpass"; f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.02, len / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(f).connect(g).connect(this.master);
    if (echo) g.connect(this.delay);
    o.start(at); o.stop(at + len + 0.05);
  }
  pad(freqs, at, len) {
    for (const fq of freqs) for (const det of [-6, 6]) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = "sawtooth"; o.frequency.value = fq; o.detune.value = det;
      f.type = "lowpass"; f.frequency.setValueAtTime(500, at); f.frequency.linearRampToValueAtTime(1100, at + len / 2); f.frequency.linearRampToValueAtTime(500, at + len);
      g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.028, at + 0.6); g.gain.linearRampToValueAtTime(0.0001, at + len + 0.3);
      o.connect(f).connect(g).connect(this.master);
      o.start(at); o.stop(at + len + 0.4);
    }
  }
  kick(at) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(120, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.18);
    g.gain.setValueAtTime(0.5, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    o.connect(g).connect(this.master); o.start(at); o.stop(at + 0.32);
  }
  hat(at, vol = 0.05) {
    const ctx = this.ctx;
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; f.type = "highpass"; f.frequency.value = 7000;
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    s.connect(f).connect(g).connect(this.master); s.start(at); s.stop(at + 0.06);
  }
  schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    const sixteenth = 60 / this.bpm / 4;
    const hz = (n) => 440 * 2 ** ((n - 69) / 12);
    // Am, F, C, G (MIDI notes)
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    const arp = [0, 1, 2, 1, 2, 0, 1, 2];
    while (this.next < ctx.currentTime + 0.25) {
      const s = this.step, bar = Math.floor(s / 16) % 4, inBar = s % 16;
      const ch = chords[bar];
      const t = this.next;
      if (inBar === 0) { this.pad(ch.map((n) => hz(n)), t, sixteenth * 16); this.note(hz(ch[0] - 12), t, sixteenth * 14, { type: "sine", vol: 0.16, cutoff: 600 }); }
      if (inBar % 2 === 0) this.note(hz(ch[arp[(inBar / 2) % 8]] + 12), t, sixteenth * 3, { vol: 0.07, cutoff: 3200, echo: true });
      const groove = Math.floor(s / 64) % 4 !== 0; // the first bars are quiet, then the beat comes in
      if (groove && (inBar === 0 || inBar === 8 || inBar === 10)) this.kick(t);
      if (groove && inBar % 4 === 2) this.hat(t, 0.045);
      if (groove && inBar % 4 === 0 && inBar) this.hat(t, 0.02);
      this.next += sixteenth;
      this.step++;
    }
  }
}

// ===================================================================
// Slides
// ===================================================================
const THEMES = [
  ["#2b0f5e", "#ff4fd8", "#4febfd"], ["#08264a", "#3daaf4", "#9dff6a"], ["#3b0a1e", "#ff7a3d", "#ffd84f"],
  ["#0b2f2a", "#2fe0a8", "#4f7dff"], ["#26093f", "#8a5cff", "#ff5c8a"], ["#331d02", "#ffb020", "#ff4f6d"],
  ["#071a3a", "#4f9dff", "#c86bff"], ["#0f2f12", "#7dff5a", "#3ff0e6"],
];

function countUp(el, to, { decimals = 0, prefix = "", suffix = "", ms = 1400 } = {}) {
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / ms), e = 1 - (1 - k) ** 3;
    el.textContent = `${prefix}${(to * e).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
  return el;
}

const big = (to, opts = {}) => {
  const el = h("div", { class: "wr-big", text: "0" });
  el._count = () => countUp(el, to, opts);
  return el;
};
const kicker = (t) => h("p", { class: "wr-k", text: t });
const line = (t, cls = "") => h("p", { class: `wr-line ${cls}`, text: t });
const pill = (t) => h("span", { class: "wr-pill", text: t });

function blockCompare(n) {
  if (n >= 8848) return `Stacked up, that's taller than Mount Everest${n >= 17696 ? ` (${Math.floor(n / 8848)} times!)` : "!"}`;
  if (n >= 828) return `Stacked up, that's taller than ${Math.floor(n / 828) > 1 ? `${Math.floor(n / 828)} of the world's tallest building` : "the world's tallest building"}!`;
  if (n >= 330) return `Stacked up, that's taller than the Eiffel Tower!`;
  if (n >= 64) return `That's ${Math.floor(n / 64)} full stack${Math.floor(n / 64) === 1 ? "" : "s"} of blocks.`;
  return "Every block counts!";
}

function buildSlides(d, period) {
  const me = d.me, sv = d.server, slides = [];
  const year = period.kind === "year";
  const add = (theme, ...children) => slides.push({ theme: THEMES[theme % THEMES.length], children });
  if (!me) {
    add(0, kicker(period.title), h("h1", { class: "wr-title", text: year ? `GalaxySMP's ${period.short}` : `GalaxySMP in ${period.range}` }),
      line(d.linked ? "You didn't play in this period, but here's how the server did." : "Link your Minecraft account (type /link in game) to get your own recap. Here's how the server did."));
  } else {
    add(0, kicker(period.title), h("h1", { class: "wr-title", text: `${me.name}, ${year ? `this was your ${period.short}` : "here are your last 2 months"}` }),
      line(year ? "Let's look back at your year on GalaxySMP." : `${period.range} on GalaxySMP.`), h("div", { class: "wr-spark" }, iconEl("sparkles")));
    if (me.quiet) {
      add(1, kicker("A quiet one"), h("h2", { class: "wr-h", text: me.hours ? `You played ${me.hours} hour${me.hours === 1 ? "" : "s"}` : "You took a little break" }),
        line("Play more and your next recap will be packed with stats. We'll be here!"));
    } else {
      add(1, kicker("Time played"), big(me.hours, { decimals: me.hours < 100 && me.hours % 1 ? 1 : 0 }), h("p", { class: "wr-unit", text: "hours on GalaxySMP" }),
        me.playPct >= 50 ? line(`${beat(me.playPct)}${me.playPct >= 100 ? "" : "."}`, "hl") : line("Every hour counts."),
        h("div", { class: "wr-pills" }, pill(`${me.days} day${me.days === 1 ? "" : "s"} played`), pill(`${fmt(me.sessions)} sessions`)));
      if (me.partOfDay) {
        const [ic, title, text] = PARTS[me.partOfDay];
        add(2, kicker("When you play"), h("div", { class: "wr-icon" }, iconEl(ic)), h("h2", { class: "wr-h", text: title }), line(text),
          h("div", { class: "wr-pills" }, me.favoriteDay ? pill(`Favorite day: ${me.favoriteDay}`) : null, me.longestMin ? pill(`Longest session: ${me.longestMin >= 60 ? `${Math.floor(me.longestMin / 60)}h ${me.longestMin % 60}m` : `${me.longestMin} min`}`) : null));
      }
      if (me.mined) add(3, kicker("Blocks mined"), h("div", { class: "wr-icon" }, iconEl("pickaxe")), big(me.mined), line(blockCompare(me.mined)),
        me.minedPct >= 50 ? h("div", { class: "wr-pills" }, pill(beat(me.minedPct))) : null);
      if (me.placed) add(4, kicker("Blocks placed"), h("div", { class: "wr-icon" }, iconEl("bricks")), big(me.placed), line(me.placed > me.mined ? "You built more than you broke. A true builder!" : "Block by block, you left your mark."),
        me.placedPct >= 50 ? h("div", { class: "wr-pills" }, pill(beat(me.placedPct))) : null);
      if (me.kills || me.bwWins) add(5, kicker("In battle"), h("div", { class: "wr-icon" }, iconEl("sword")),
        h("div", { class: "wr-duo" },
          me.kills ? h("div", {}, big(me.kills), h("p", { class: "wr-unit", text: "mobs defeated" })) : null,
          me.bwWins ? h("div", {}, big(me.bwWins), h("p", { class: "wr-unit", text: `Bedwars win${me.bwWins === 1 ? "" : "s"}` })) : null),
        me.bwKills ? line(`Plus ${fmt(me.bwKills)} Bedwars kills.`) : null);
      if (me.money > 0 || me.web.jobsDone || me.quests) add(6, kicker("Money"), h("div", { class: "wr-icon" }, iconEl("coins")),
        me.money > 0 ? h("div", {}, h("div", { class: "wr-big", text: `+${usd(me.money)}` }), h("p", { class: "wr-unit", text: "added to your balance" })) : null,
        h("div", { class: "wr-pills" }, me.quests ? pill(`${fmt(me.quests)} quests done`) : null, me.web.jobsDone ? pill(`${me.web.jobsDone} #Jobs done (${usd(me.web.jobsEarned)})`) : null, me.web.trades ? pill(`${me.web.trades} trades`) : null));
      if (me.friends?.length) {
        const [f, ...rest] = me.friends;
        add(7, kicker("Your gaming partner"), h("div", { class: "wr-icon" }, iconEl("users")), h("h2", { class: "wr-h wr-name", text: f.name }),
          line(`You played together for ${f.hours} hour${f.hours === 1 ? "" : "s"}.`, "hl"),
          rest.length ? h("div", { class: "wr-pills" }, ...rest.map((r) => pill(`${r.name} · ${r.hours}h`))) : null);
      }
      if (me.achievements) add(0, kicker("Achievements"), h("div", { class: "wr-icon" }, iconEl("trophy2")), big(me.achievements), h("p", { class: "wr-unit", text: `achievement${me.achievements === 1 ? "" : "s"} unlocked` }),
        me.rarest ? line(`Your rarest: ${me.rarest.name}. Only ${me.rarest.pct}% of players have it.`, "hl") : null);
      if (me.web.messages || me.web.dms || me.web.builds) add(1, kicker("In the community"), h("div", { class: "wr-icon" }, iconEl("chat")),
        big(me.web.messages + me.web.dms), h("p", { class: "wr-unit", text: "messages sent on the website" }),
        h("div", { class: "wr-pills" }, me.web.channel ? pill(`Favorite channel: #${me.web.channel}`) : null, me.web.reactions ? pill(`${fmt(me.web.reactions)} reactions on your messages`) : null,
          me.web.emoji && me.web.emoji.length <= 8 ? pill(`Your emoji: ${me.web.emoji}`) : null, me.web.builds ? pill(`${me.web.builds} build${me.web.builds === 1 ? "" : "s"} shared`) : null));
      add(4, kicker("Your player type"), h("div", { class: "wr-type" }, h("div", { class: "wr-type-ic" }, iconEl(me.type.icon)), h("h2", { class: "wr-h", text: me.type.name })), line(me.type.line));
    }
  }
  // the whole server
  add(6, kicker("And together…"), h("h2", { class: "wr-h", text: "The whole server" }),
    h("div", { class: "wr-grid" },
      h("div", {}, big(sv.hours), h("p", { class: "wr-unit", text: "hours played" })),
      h("div", {}, big(sv.mined), h("p", { class: "wr-unit", text: "blocks mined" })),
      h("div", {}, big(sv.placed), h("p", { class: "wr-unit", text: "blocks placed" })),
      h("div", {}, big(sv.players), h("p", { class: "wr-unit", text: "players" }))),
    h("div", { class: "wr-pills" }, sv.newPlayers ? pill(`${sv.newPlayers} new player${sv.newPlayers === 1 ? "" : "s"} joined`) : null,
      sv.messages ? pill(`${fmt(sv.messages)} messages`) : null, sv.jobsDone ? pill(`${sv.jobsDone} jobs done`) : null, sv.bwWins ? pill(`${fmt(sv.bwWins)} Bedwars wins`) : null));
  if (sv.top?.length) add(7, kicker("Most time played"), h("h2", { class: "wr-h", text: "Top players" }),
    h("ol", { class: "wr-top" }, ...sv.top.map((t, i) => h("li", { class: me && t.name === me.name ? "me" : "" }, h("span", { class: "wr-rank", text: String(i + 1) }), h("b", { text: t.name }), h("span", { text: `${t.hours}h` })))),
    sv.busiestDay ? line(`Busiest day: ${longDay(sv.busiestDay.day)}, with ${sv.busiestDay.peak} players online at once.`) : null);
  slides.push({ theme: THEMES[2], share: true });
  return slides;
}

// ===================================================================
// The share card (a 1080x1920 picture)
// ===================================================================
function shareCanvas(d, period) {
  const c = document.createElement("canvas");
  c.width = 1080; c.height = 1920;
  const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, 1080, 1920);
  bg.addColorStop(0, "#1a0b3d"); bg.addColorStop(0.55, "#0b1d4a"); bg.addColorStop(1, "#04060f");
  g.fillStyle = bg; g.fillRect(0, 0, 1080, 1920);
  const blob = (x, y, r, col) => { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col); rg.addColorStop(1, "transparent"); g.fillStyle = rg; g.fillRect(0, 0, 1080, 1920); };
  blob(900, 250, 600, "rgba(255,79,216,.45)"); blob(150, 1200, 700, "rgba(79,235,253,.32)"); blob(800, 1750, 600, "rgba(138,92,255,.4)");
  g.fillStyle = "rgba(255,255,255,.9)";
  for (let i = 0; i < 90; i++) { const x = (i * 397) % 1080, y = (i * 733) % 1920, r = (i % 3) + 1; g.globalAlpha = 0.25 + (i % 5) / 10; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  g.globalAlpha = 1;
  const font = (w, s) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  g.textAlign = "left";
  g.fillStyle = "#4febfd"; g.font = font(800, 44); g.fillText("GALAXY WRAPPED", 90, 170);
  g.fillStyle = "#fff"; g.font = font(900, 92); g.fillText(period.kind === "year" ? period.short : period.short, 90, 280);
  const me = d.me;
  g.font = font(800, 64); g.fillStyle = "#fff";
  const name = me ? me.name : "GalaxySMP";
  g.fillText(name.length > 22 ? `${name.slice(0, 21)}…` : name, 90, 420);
  const rows = me && !me.quiet ? [
    ["Hours played", String(me.hours)], ["Blocks mined", fmt(me.mined)], ["Blocks placed", fmt(me.placed)],
    me.friends?.[0] ? ["Played most with", me.friends[0].name] : ["Days played", String(me.days)],
    ["Player type", me.type.name.replace(/^The /, "")],
  ] : [["Server hours", fmt(d.server.hours)], ["Blocks mined", fmt(d.server.mined)], ["Players", fmt(d.server.players)]];
  let y = 600;
  for (const [k, v] of rows) {
    g.fillStyle = "rgba(255,255,255,.08)";
    g.beginPath(); g.roundRect(70, y - 30, 940, 200, 36); g.fill();
    g.fillStyle = "rgba(255,255,255,.65)"; g.font = font(700, 38); g.fillText(k.toUpperCase(), 120, y + 40);
    g.fillStyle = "#fff"; g.font = font(900, 78);
    let val = v; while (g.measureText(val).width > 840 && val.length > 3) val = `${val.slice(0, -2)}…`;
    g.fillText(val, 120, y + 130);
    y += 240;
  }
  g.fillStyle = "rgba(255,255,255,.75)"; g.font = font(700, 40); g.fillText("galaxymc.us/wrapped", 90, 1830);
  return c;
}

// ===================================================================
// The player
// ===================================================================
const DURATION = 7000;

function play(d, period) {
  const slides = buildSlides(d, period);
  const music = new Music();
  let i = 0, timer = null, started = 0, left = DURATION, paused = false;
  const bars = h("div", { class: "wr-bars" }, ...slides.map(() => h("span", {}, h("i"))));
  const stage = h("div", { class: "wr-stage" });
  const bg = h("div", { class: "wr-bg" }, h("i", { class: "b1" }), h("i", { class: "b2" }), h("i", { class: "b3" }), h("div", { class: "wr-stars" }));
  const muteBtn = h("button", { class: "wr-ctl", type: "button", "aria-label": "Mute music" });
  const closeBtn = h("button", { class: "wr-ctl", type: "button", "aria-label": "Close" }, iconEl("close"));
  const drawMute = () => { muteBtn.replaceChildren(h("span", { class: "wr-mute-ic", text: muted ? "Music off" : "Music on" })); muteBtn.setAttribute("aria-pressed", String(!muted)); };
  drawMute();
  const top = h("div", { class: "wr-top-bar" }, bars, h("div", { class: "wr-ctls" }, h("span", { class: "wr-brand" }, iconEl("sparkles"), period.title), muteBtn, closeBtn));
  const ov = h("div", { class: "wr-overlay", role: "dialog", "aria-modal": "true", "aria-label": period.title }, bg, top, stage,
    h("button", { class: "wr-tap prev", type: "button", "aria-label": "Previous" }), h("button", { class: "wr-tap next", type: "button", "aria-label": "Next" }));
  document.body.append(ov);
  document.body.classList.add("wr-open");

  const setBars = () => [...bars.children].forEach((b, k) => {
    const fill = b.firstChild;
    fill.style.transition = "none";
    fill.style.width = k < i ? "100%" : "0%";
  });
  const runBar = (ms) => {
    const fill = bars.children[i].firstChild;
    void fill.offsetWidth;
    fill.style.transition = `width ${ms}ms linear`;
    fill.style.width = "100%";
  };
  const freezeBar = () => {
    const fill = bars.children[i].firstChild, w = getComputedStyle(fill).width;
    fill.style.transition = "none"; fill.style.width = w;
  };

  function show(k) {
    clearTimeout(timer);
    i = Math.max(0, Math.min(slides.length - 1, k));
    const s = slides[i];
    const [c0, c1, c2] = s.theme;
    ov.style.setProperty("--c0", c0); ov.style.setProperty("--c1", c1); ov.style.setProperty("--c2", c2);
    const card = h("div", { class: "wr-slide" });
    if (s.share) card.append(...shareSlide());
    else card.append(...s.children.filter(Boolean));
    stage.replaceChildren(card);
    card.querySelectorAll(".wr-big").forEach((el) => el._count?.());
    setBars();
    left = DURATION;
    if (!s.share && i > 0) { started = Date.now(); runBar(left); timer = setTimeout(() => show(i + 1), left); }
    if (i === 0) {
      card.append(h("button", { class: "btn wr-go", type: "button", text: "Let's go", onclick: (e) => { e.stopPropagation(); music.start(); show(1); } }));
    }
  }

  function shareSlide() {
    const canvas = shareCanvas(d, period);
    const img = h("img", { class: "wr-card-img", alt: "Your recap card" });
    img.src = canvas.toDataURL("image/png");
    const saveBtn = h("button", { class: "btn wr-btn", type: "button" }, iconEl("share"), "Share picture");
    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      canvas.toBlob(async (blob) => {
        const file = new File([blob], `galaxy-wrapped-${period.key}.png`, { type: "image/png" });
        try {
          if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: period.title }); return; }
        } catch (err) { if (err?.name === "AbortError") return; }
        const a = h("a", { href: URL.createObjectURL(blob), download: file.name });
        document.body.append(a); a.click(); a.remove();
        toast("Picture saved.");
      }, "image/png");
    });
    const postBtn = h("button", { class: "btn wr-btn ghost", type: "button" }, iconEl("send"), "Post on #Timeline");
    postBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try { const r = await postJson(`/api/wrapped/${period.key}/share`, {}); toast(r.message); postBtn.disabled = true; } catch (err) { toast(err.message); }
    });
    const again = h("button", { class: "btn wr-btn ghost", type: "button" }, iconEl("arrow"), "Watch again");
    again.addEventListener("click", (e) => { e.stopPropagation(); show(1); });
    return [kicker("That's a wrap!"), h("div", { class: "wr-card" }, img),
      h("div", { class: "wr-share" }, saveBtn, d.me && !period.preview ? postBtn : null, again)];
  }

  function pause() {
    if (paused || slides[i].share || i === 0) return;
    paused = true; clearTimeout(timer); freezeBar(); left -= Date.now() - started;
  }
  function resume() {
    if (!paused) return;
    paused = false; started = Date.now(); runBar(Math.max(200, left)); timer = setTimeout(() => show(i + 1), Math.max(200, left));
  }
  function close() {
    clearTimeout(timer); music.stop(); ov.remove(); document.body.classList.remove("wr-open");
    document.removeEventListener("keydown", onKey);
  }
  const onKey = (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); show(i + 1); }
    else if (e.key === "ArrowLeft") show(i - 1);
  };
  document.addEventListener("keydown", onKey);
  closeBtn.addEventListener("click", close);
  muteBtn.addEventListener("click", () => {
    muted = !muted; drawMute();
    try { localStorage.setItem("wr-muted", muted ? "1" : "0"); } catch { /* private mode */ }
    if (!muted) music.start();
    music.setMuted(muted);
  });
  // tap left/right; holding pauses (like stories)
  let downAt = 0;
  for (const side of ov.querySelectorAll(".wr-tap")) {
    side.addEventListener("pointerdown", () => { downAt = Date.now(); setTimeout(() => { if (downAt) pause(); }, 220); });
    side.addEventListener("pointerup", () => {
      const held = Date.now() - downAt; downAt = 0;
      if (held > 220) { resume(); return; }
      if (i === 0) music.start();
      show(i + (side.classList.contains("next") ? 1 : -1));
    });
    side.addEventListener("pointerleave", () => { if (downAt) { downAt = 0; resume(); } });
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  show(0);
}

// ===================================================================
// The page: the newest recap, older ones, and the owner's preview
// ===================================================================
async function open(key) {
  try {
    const d = await getJson(`/api/wrapped/${key}`);
    play(d, d.period);
  } catch (e) { toast(e.message); }
}

async function load() {
  let d;
  try { d = await getJson("/api/wrapped"); } catch (e) {
    const signIn = h("a", { href: "/community", text: "Sign in" });
    root.replaceChildren(h("section", { class: "panel" }, h("p", { class: "text-2", style: "margin:0" }, "Sign in to see your Galaxy Wrapped. ", signIn)));
    return;
  }
  const featured = d.periods.find((p) => p.key === d.featured);
  const hero = h("section", { class: "wr-hero" }, h("div", { class: "wr-hero-bg" }, h("i"), h("i"), h("i")),
    h("div", { class: "wr-hero-in" },
      h("span", { class: "wr-hero-k" }, iconEl("sparkles"), "Galaxy Wrapped"),
      featured ? h("h1", { text: featured.kind === "year" ? `Your ${featured.short} is here` : `Your ${featured.short} recap is here` })
        : h("h1", { text: "Your time on GalaxySMP, wrapped up" }),
      h("p", { text: featured ? `${featured.range}: your playtime, blocks, best friend on the server, your player type and the whole server's story.`
        : "Every 2 months you get a recap of what you did on GalaxySMP, and every December a big one for the whole year. With music, and a card to share." }),
      featured ? h("button", { class: "btn wr-play", type: "button", onclick: () => open(featured.key) }, iconEl("sparkles"), "Play my recap")
        : d.next ? h("p", { class: "wr-next", text: `Next: ${d.next.title}, out ${new Date(`${d.next.release}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" })}` }) : null));
  const others = d.periods.filter((p) => p.key !== d.featured);
  const past = others.length ? h("section", { class: "panel wr-past" }, h("h2", { text: "Past recaps" }),
    h("div", { class: "wr-past-list" }, ...others.map((p) => h("button", { class: `wr-past-item${p.kind === "year" ? " year" : ""}`, type: "button", onclick: () => open(p.key) },
      h("span", { class: "wr-past-ic" }, iconEl(p.kind === "year" ? "star" : "sparkles")), h("span", {}, h("b", { text: p.title }), h("small", { text: p.range })))))) : null;
  const preview = d.canPreview ? h("section", { class: "panel wr-preview" }, h("h2", { text: "Owner preview" }),
    h("p", { class: "text-3 small", text: "Watch the recap for the period that's still going (with the numbers so far). Only you can see this. Players get theirs when it comes out." }),
    h("div", { class: "wr-share" }, h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Preview this 2-month recap", onclick: () => open("preview") }),
      h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Preview this year's Wrapped", onclick: () => open("preview-year") }))) : null;
  const when = h("section", { class: "panel wr-when" }, h("h2", { text: "When do recaps come out?" }),
    h("ul", {}, h("li", { text: "Every 2 months, on the 1st: Jan+Feb on March 1, Mar+Apr on May 1, May+Jun on July 1, Jul+Aug on September 1, Sep+Oct on November 1, Nov+Dec on January 1." }),
      h("li", { text: "The big yearly Wrapped comes out on December 1." }),
      h("li", { text: "You get a notification when yours is ready." })));
  root.replaceChildren(...[hero, past, preview, when].filter(Boolean));
  if (new URLSearchParams(location.search).get("play") && featured) open(featured.key);
}

load();
