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
// the mic and camera chosen in the setup check (remembered on this device)
const loadDevice = (k) => { try { return localStorage.getItem(`gsmp-stage-${k}`) || ""; } catch { return ""; } };
const saveDevice = (k, v) => { try { localStorage.setItem(`gsmp-stage-${k}`, v); } catch { /* ignore */ } };
const micConstraints = () => ({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(loadDevice("mic") ? { deviceId: { ideal: loadDevice("mic") } } : {}) });
const camConstraints = () => ({ width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24 }, ...(loadDevice("cam") ? { deviceId: { ideal: loadDevice("cam") } } : {}) });
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

  // ---------- the library ----------
  // Tabs: Podcasts (live podcasts, continue listening, every episode) · Live (live streams, coming up, saved streams)
  // · More (other videos and audio). Tap a name for that host's or team's show page; tap a title for its page
  // (video, chapters, comments). One mini player at the bottom plays audio and remembers where you stopped.
  const lib = { tab: null, q: "", sort: "new", show: null, item: null, d: null };
  const SPEEDS = [1, 1.25, 1.5, 2];
  const getSpeed = () => { try { const v = Number(localStorage.getItem("gsmp-speed")); return SPEEDS.includes(v) ? v : 1; } catch { return 1; } };
  const setSpeed = (v) => { try { localStorage.setItem("gsmp-speed", String(v)); } catch { /* ignore */ } };
  const player = miniPlayer();

  async function showList() {
    view.listing = true;
    stream?.close(); stream = null;
    let d;
    try { d = await getJson("/api/streams"); } catch (e) { box.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    if (!view.listing) return;
    lib.d = d;
    const sub = helpers.sub; helpers.sub = null;
    if (sub && /^\d+$/.test(sub)) return openStream(Number(sub));
    if (sub && /^ep-\d+$/.test(sub)) { lib.item = Number(sub.slice(3)); lib.show = null; }
    if (sub && /^show-[ut]\d+$/.test(sub)) { lib.show = sub.slice(5); lib.item = null; }
    if (!lib.tab) lib.tab = d.live.some((s) => s.kind !== "podcast") && !d.live.some((s) => s.kind === "podcast") ? "live" : "podcasts";
    draw();
  }

  function setHash() {
    const hsh = lib.item ? `#stages/ep-${lib.item}` : lib.show ? `#stages/show-${lib.show}` : "#stages";
    try { if (location.hash !== hsh) history.replaceState(history.state, "", hsh); } catch { /* ignore */ }
  }
  const parts = () => {
    const d = lib.d;
    return {
      livePods: d.live.filter((s) => s.kind === "podcast"), liveStreams: d.live.filter((s) => s.kind !== "podcast"),
      upPods: d.upcoming.filter((s) => s.kind === "podcast"), upStreams: d.upcoming.filter((s) => s.kind !== "podcast"),
      podcasts: d.episodes.filter((e) => e.kind === "podcast"), saved: d.episodes.filter((e) => e.kind === "video"), more: d.episodes.filter((e) => e.kind === "more"),
    };
  };

  function draw() {
    const d = lib.d, p = parts();
    setHash();
    const head = h("header", { class: "st-head" },
      h("div", {}, h("h2", { text: "Stages" }), h("p", { class: "text-2", text: "Podcasts, live streams and videos from players and teams." })),
      h("div", { class: "st-head-btns" },
        d.episodeAs.length ? h("button", { class: "btn btn-secondary", type: "button", onclick: () => postDialog(d) }, iconEl("plus"), "Post") : null,
        d.canHost ? h("button", { class: "btn btn-primary", type: "button", onclick: () => setupWizard(d) }, stageIcon(), "Go live") : null));
    const note = d.banned ? h("p", { class: "st-note st-note-bad", text: `Staff stopped you from hosting stages until ${whenText(d.banned.until)}${d.banned.reason ? ` (${d.banned.reason})` : ""}.` }) : null;
    const backstage = d.backstage?.length ? h("div", { class: "st-backstage-note" }, ...d.backstage.map((s) => h("div", { class: "st-row" },
      h("span", { class: "st-row-main" }, h("b", { text: `You're backstage: ${s.title}` }), h("small", { class: "text-3", text: "Nobody else can see it until a host presses Go live." })),
      h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Open", onclick: () => openStream(s.id, { autoStage: true }) })))) : null;
    const badge = (n, live) => (n ? h("span", { class: live ? "stl-tab-live" : "stl-tab-n", text: live ? "LIVE" : String(n) }) : null);
    const tab = (key, label, extra) => h("button", { class: "stl-tab", type: "button", role: "tab", "aria-selected": String(lib.tab === key),
      onclick: () => { lib.tab = key; lib.show = null; lib.item = null; lib.q = ""; draw(); } }, label, extra);
    const tabs = h("div", { class: "stl-tabs", role: "tablist" },
      tab("podcasts", "Podcasts", p.livePods.length ? badge(1, true) : badge(p.podcasts.length)),
      tab("live", "Live", p.liveStreams.length ? badge(1, true) : null),
      tab("more", "More", badge(p.more.length)));
    const search = h("input", { class: "input st-search", type: "search", placeholder: lib.tab === "more" ? "Search videos and audio" : "Search podcasts", "aria-label": "Search" });
    search.value = lib.q;
    let t = null;
    search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { lib.q = search.value.trim().toLowerCase(); drawBody(); }, 200); });
    const sorter = h("div", { class: "tabs-mini" }, ...[["new", "Newest"], ["popular", "Most played"]].map(([k, n]) =>
      h("button", { type: "button", "aria-pressed": String(lib.sort === k), text: n, onclick: (ev) => { lib.sort = k; ev.target.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === ev.target))); drawBody(); } })));
    const tools = h("div", { class: "st-tools", hidden: lib.tab === "live" || Boolean(lib.show) || Boolean(lib.item) }, search, sorter);
    const body = h("div", { class: "st-lib-body" });
    box.replaceChildren(...[head, note, backstage, tabs, tools, body, player.el].filter(Boolean));
    function drawBody() {
      body.replaceChildren(...(lib.item ? itemPage(lib.item) : lib.show ? showPage(lib.show) : lib.tab === "live" ? liveTab() : lib.tab === "more" ? moreTab() : podcastsTab()));
    }
    drawBody();
  }

  // ---------- covers (made from the show's name and the host's head) ----------
  function hues(name) {
    let x = 0;
    for (const c of String(name)) x = (x * 31 + c.codePointAt(0)) >>> 0;
    return [x % 360, (x >> 9) % 360];
  }
  function cover(host, size = "md", kind = "podcast") {
    const [a, b] = hues(host.name + (host.type || ""));
    const el = h("span", { class: `st-cover st-cover-${size}`, style: `background:linear-gradient(135deg,hsl(${a} 70% 42%),hsl(${(a + 60 + b % 80) % 360} 75% 30%))`, "aria-hidden": "true" });
    if (host.type === "team") el.append(h("span", { class: "st-cover-tag", text: host.tag }));
    else el.append(face(host.head, host.name, 64));
    el.append(h("span", { class: "st-cover-ic" }, iconEl(kind === "podcast" ? "headphones" : kind === "video" || kind === "live" ? "camera" : "image")));
    return el;
  }
  const hostKey = (x) => `${x.host.type === "team" ? "t" : "u"}${x.host.id}`;
  const hostName = (x) => (x.host.type === "team" ? `[${x.host.tag}] ${x.host.name}` : x.host.name);
  const fmtLen = (s) => (s ? `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}` : Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");
  const dateText = (iso) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const tags = (x) => [x.category ? h("span", { class: "st-chip", text: x.category }) : null, x.teamOnly ? h("span", { class: "st-chip st-chip-team", text: "Team only" }) : null].filter(Boolean);

  function shows() {
    const d = lib.d, map = new Map();
    const add = (x, list) => {
      const k = hostKey(x);
      if (!map.has(k)) map.set(k, { key: k, host: x.host, episodes: [], live: [], upcoming: [], past: [], following: false, last: 0, plays: 0 });
      const s = map.get(k);
      s[list].push(x);
      if (x.following) s.following = true;
      s.last = Math.max(s.last, new Date(x.createdAt || x.startedAt || x.scheduledAt || 0).getTime());
      if (list === "episodes") s.plays += x.plays || 0;
    };
    d.episodes.forEach((x) => add(x, "episodes")); d.live.forEach((x) => add(x, "live")); d.upcoming.forEach((x) => add(x, "upcoming")); d.recent.forEach((x) => add(x, "past"));
    return [...map.values()];
  }
  const openShow = (key) => { lib.show = key; lib.item = null; draw(); box.scrollIntoView({ block: "start" }); };
  const openItem = (id) => { lib.item = id; draw(); box.scrollIntoView({ block: "start" }); };

  function matches(e) {
    if (!lib.q) return true;
    return `${e.title} ${e.description || ""} ${e.host.name} ${e.host.tag || ""} ${e.category || ""}`.toLowerCase().includes(lib.q);
  }
  function sorted(list) {
    return [...list].sort((a, b) => (lib.sort === "popular" ? b.plays - a.plays : 0) || new Date(b.createdAt) - new Date(a.createdAt));
  }
  const empty = (icon, title, text) => h("div", { class: "st-empty-big" }, iconEl(icon), h("b", { text: title }), h("p", { class: "text-3", text }));

  // ---------- Podcasts tab ----------
  function podcastsTab() {
    const d = lib.d, p = parts(), out = [];
    if (p.livePods.length && !lib.q) {
      out.push(h("h3", { class: "st-h" }, h("span", { class: "st-dot" }), "Live podcasts"));
      out.push(h("div", { class: "st-grid" }, ...p.livePods.map((s) => liveCard(s))));
    }
    if (p.upPods.length && !lib.q) {
      out.push(h("h3", { class: "st-h", text: "Coming up" }));
      out.push(h("div", { class: "st-list" }, ...p.upPods.map((s) => upcomingRow(s))));
    }
    if (!p.podcasts.length) {
      out.push(empty("headphones", "No podcasts yet", d.episodeAs.length ? "Tap Go live to host a live podcast (it's saved as an episode when it ends), or Post to upload one." : "When hosts post podcasts, they show up here."));
      return out;
    }
    const prog = player.progress();
    const cont = lib.q ? [] : p.podcasts.filter((e) => prog[e.id] && prog[e.id].t > 5 && (!prog[e.id].d || prog[e.id].t < prog[e.id].d - 10))
      .sort((a, b) => prog[b.id].at - prog[a.id].at).slice(0, 10);
    if (cont.length) {
      out.push(h("h3", { class: "st-h", text: "Continue listening" }));
      out.push(h("div", { class: "st-shelf" }, ...cont.map((e) => tile(e, prog[e.id]))));
    }
    const list = sorted(p.podcasts.filter(matches));
    out.push(h("h3", { class: "st-h", text: lib.q ? `Results (${list.length})` : lib.sort === "popular" ? "Most played" : "All episodes" }));
    out.push(list.length ? h("div", { class: "st-tiles" }, ...list.map((e) => tile(e, prog[e.id]))) : h("p", { class: "text-3 st-empty", text: "Nothing matches your search." }));
    return out;
  }

  // ---------- Live tab ----------
  function liveTab() {
    const d = lib.d, p = parts(), out = [];
    if (!d.canHost && !d.banned) out.push(h("p", { class: "st-note", text: d.hasTeam
      ? "Your team's organizer and Admins can start team stages. Hosting your own stage and posting are Galaxy Pro+ perks."
      : "Hosting your own stage and posting are Galaxy Pro+ perks. Teams can host stages too: make or join one in Friends > Team." }));
    out.push(h("h3", { class: "st-h" }, h("span", { class: "st-dot" }), "Live now"));
    out.push(p.liveStreams.length ? h("div", { class: "st-grid" }, ...p.liveStreams.map((s) => liveCard(s))) : h("p", { class: "text-3 st-empty", text: "No live streams right now. Live streams can only be watched while they're live, unless the host saves them." }));
    out.push(h("h3", { class: "st-h", text: "Coming up" }));
    out.push(p.upStreams.length ? h("div", { class: "st-list" }, ...p.upStreams.map((s) => upcomingRow(s))) : h("p", { class: "text-3 st-empty", text: "No live streams scheduled yet." }));
    if (p.saved.length) {
      const prog = player.progress();
      out.push(h("h3", { class: "st-h", text: "Watch again" }));
      out.push(h("div", { class: "st-tiles" }, ...sorted(p.saved).map((e) => tile(e, prog[e.id]))));
    }
    if (d.crew) out.push(crewBox(d.crew));
    if (d.crewOf.length) {
      out.push(h("section", { class: "panel st-box" }, h("h3", { class: "st-h", style: "margin-top:0", text: "Crews you're on" }),
        ...d.crewOf.map((c) => h("div", { class: "st-row" },
          h("span", {}, h("b", { text: c.username }), h("small", { class: "text-3", text: c.role === "editor" ? " · Editor: you can start and run their stages" : " · Speaker: you can speak on their stages" })),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Leave", onclick: () => act({ action: "crew-remove", hostId: c.hostId }, showList) })))));
    }
    return out;
  }

  // ---------- More tab ----------
  function moreTab() {
    const d = lib.d, p = parts();
    if (!p.more.length) return [empty("image", "Nothing here yet", d.episodeAs.length ? "Tap Post to share a video or audio, like your team's rules or a build tour." : "Videos and audio from hosts and teams show up here.")];
    const prog = player.progress();
    const list = sorted(p.more.filter(matches));
    return [h("h3", { class: "st-h", text: lib.q ? `Results (${list.length})` : lib.sort === "popular" ? "Most played" : "Newest" }),
      list.length ? h("div", { class: "st-tiles" }, ...list.map((e) => tile(e, prog[e.id]))) : h("p", { class: "text-3 st-empty", text: "Nothing matches your search." })];
  }

  // one episode / video / audio tile
  function tile(e, pr) {
    const pct = pr?.d ? Math.min(100, Math.round((pr.t / pr.d) * 100)) : 0;
    const playing = player.current?.id === e.id;
    const isVideo = e.media === "video";
    return h("article", { class: `st-tile-ep${playing ? " is-playing" : ""}`, "data-ep": String(e.id) },
      h("button", { class: "st-tile-art", type: "button", "aria-label": `${isVideo ? "Watch" : "Play"} ${e.title}`, onclick: () => (isVideo ? openItem(e.id) : player.play(e)) },
        cover(e.host, "lg", e.kind === "more" ? (isVideo ? "video" : "more") : e.kind),
        h("span", { class: "st-tile-play" }, isVideo ? "▶" : iconEl("headphones")),
        e.seconds ? h("span", { class: "st-tile-len", text: fmtLen(e.seconds) }) : null,
        pct ? h("span", { class: "st-tile-bar", style: `width:${pct}%` }) : null),
      h("button", { class: "st-tile-title st-link", type: "button", text: e.title, onclick: () => openItem(e.id) }),
      h("button", { class: "st-tile-show", type: "button", onclick: () => openShow(hostKey(e)) }, hostName(e)),
      h("small", { class: "text-3", text: [dateText(e.createdAt), plural(e.plays, isVideo ? "view" : "play"), e.comments ? plural(e.comments, "comment") : null].filter(Boolean).join(" · ") }));
  }

  // ---------- one episode / video page (chapters, comments) ----------
  function itemPage(id) {
    const e = lib.d.episodes.find((x) => x.id === id);
    const back = h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { lib.item = null; draw(); } }, iconEl("arrow", "flip"), "Back");
    if (!e) return [back, h("p", { class: "text-3", text: "This isn't available any more." })];
    const isVideo = e.media === "video";
    let video = null;
    const seek = (t) => {
      if (video) { video.currentTime = t; video.play().catch(() => {}); }
      else player.seekTo(e, t);
    };
    let media;
    if (isVideo) {
      video = h("video", { class: "st-item-video", controls: true, playsinline: true, preload: "metadata", src: e.audio });
      video.playbackRate = getSpeed();
      let counted = false;
      video.addEventListener("play", () => { if (!counted) { counted = true; postJson("/api/streams", { action: "episode-play", id: e.id }).catch(() => {}); } });
      const sp = h("select", { class: "input st-speed-sel", "aria-label": "Speed" }, ...SPEEDS.map((v) => h("option", { value: String(v), text: `${v}x` })));
      sp.value = String(getSpeed());
      sp.addEventListener("change", () => { video.playbackRate = Number(sp.value); setSpeed(Number(sp.value)); player.syncSpeed(); });
      media = h("div", { class: "st-item-media" }, video, h("div", { class: "st-item-tools" }, h("span", { class: "text-3 small", text: "Speed" }), sp));
    } else {
      media = h("div", { class: "st-show-hero" }, cover(e.host, "xl", e.kind),
        h("div", { class: "st-show-info" },
          h("span", { class: "st-eyebrow", text: e.kind === "more" ? "Audio" : "Podcast episode" }),
          h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => player.play(e) }, iconEl("headphones"), player.current?.id === e.id ? "Playing" : "Play")));
    }
    const info = h("section", { class: "st-item-info" },
      h("h2", { class: "st-item-title", text: e.title }),
      h("div", { class: "st-item-meta" },
        h("button", { class: "st-tile-show", type: "button", onclick: () => openShow(hostKey(e)) }, hostName(e)),
        h("small", { class: "text-3", text: [dateText(e.createdAt), fmtLen(e.seconds), plural(e.plays, isVideo ? "view" : "play")].filter(Boolean).join(" · ") }),
        ...tags(e)),
      e.description ? h("p", { class: "text-2", style: "margin:6px 0 0", text: e.description }) : null,
      h("div", { class: "st-card-actions" },
        e.manage ? h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => editItemDialog(e) }, iconEl("pencil"), "Edit") : null,
        e.manage ? h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => openDialog({ title: "Remove this?", body: h("p", { class: "text-2", style: "margin:0", text: "It's taken off #Stages." }),
          actions: [{ label: "Cancel" }, { label: "Remove", kind: "danger", onClick: () => act({ action: "episode-delete", id: e.id }, () => { lib.item = null; showList(); }) }] }) }, iconEl("trash"), "Remove") : null));
    const chapters = e.chapters?.length ? h("section", { class: "st-chapters" }, h("h3", { class: "st-h", text: "Chapters" }),
      ...e.chapters.map((c) => h("button", { class: "st-chapter", type: "button", onclick: () => seek(c.t) }, h("span", { class: "st-chapter-t", text: fmtLen(c.t) || "0:00" }), h("span", { text: c.title })))) : null;
    return [back, media, info, chapters, commentsBox(e)].filter(Boolean);
  }

  function editItemDialog(e) {
    const title = h("input", { class: "input", id: "it-title", maxlength: 80 }); title.value = e.title;
    const desc = h("textarea", { class: "input", id: "it-desc", maxlength: 300, rows: 2 }); desc.value = e.description || "";
    const chap = h("textarea", { class: "input", id: "it-chap", rows: 5, placeholder: "0:00 Intro\n3:20 Bedwars tips\n12:05 Questions" });
    chap.value = (e.chapters || []).map((c) => `${fmtLen(c.t) || "0:00"} ${c.title}`).join("\n");
    openDialog({ title: "Edit", body: h("div", { class: "form" }, field("Title", title), field("Description", desc),
      field("Chapters (optional)", chap, "One per line: a time, then a name. Listeners tap a chapter to jump to it.")),
    actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => {
      await postJson("/api/streams", { action: "episode-edit", id: e.id, title: title.value, description: desc.value, chapters: chap.value });
      toast("Saved."); showList();
    } }] });
  }

  function commentsBox(e) {
    const list = h("div", { class: "st-comments" }, h("p", { class: "text-3 small", text: "Loading comments…" }));
    const input = h("input", { class: "input", id: `cm-${e.id}`, maxlength: 300, placeholder: "Add a comment", autocomplete: "off", "aria-label": "Comment" });
    const form = h("form", { class: "st-chat-form" }, input, h("button", { class: "btn btn-primary", type: "submit", "aria-label": "Post comment" }, iconEl("send")));
    const load = async () => {
      let r;
      try { r = await getJson(`/api/episodes/${e.id}/comments`); } catch (er) { list.replaceChildren(h("p", { class: "text-3 small", text: er.message })); return; }
      list.replaceChildren(...(r.comments.length ? r.comments.map((c) => h("div", { class: "st-comment" },
        face(c.head, c.name, 28),
        h("div", { class: "st-comment-main" }, h("div", {}, h("b", { text: c.name }), h("small", { class: "text-3", text: ` · ${dateText(c.at)}` })), h("p", { text: c.body })),
        c.canDelete ? h("button", { class: "icon-btn", type: "button", "aria-label": "Delete comment", onclick: () => act({ action: "comment-delete", id: c.id }, load) }, iconEl("trash")) : null))
        : [h("p", { class: "text-3 small", text: "No comments yet. Be the first!" })]));
    };
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (!input.value.trim()) return;
      try { await postJson("/api/streams", { action: "comment", id: e.id, body: input.value }); input.value = ""; load(); } catch (er) { toast(er.message); }
    });
    load();
    return h("section", { class: "st-comments-box" }, h("h3", { class: "st-h", text: "Comments" }), form, list);
  }

  // ---------- show pages ----------
  function showPage(key) {
    const s = shows().find((x) => x.key === key);
    const back = h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { lib.show = null; draw(); } }, iconEl("arrow", "flip"), "Back");
    if (!s) return [back, h("p", { class: "text-3", text: "This show doesn't have anything yet." })];
    const pods = sorted(s.episodes.filter((e) => e.kind === "podcast")), vids = sorted(s.episodes.filter((e) => e.kind !== "podcast"));
    const total = pods.reduce((n, e) => n + (e.seconds || 0), 0);
    const mine = [...s.episodes, ...s.live, ...s.upcoming].some((x) => x.manage);
    const out = [back,
      h("section", { class: "st-show-hero" }, cover(s.host, "xl"),
        h("div", { class: "st-show-info" },
          h("span", { class: "st-eyebrow", text: s.host.type === "team" ? "Team show" : "Show" }),
          h("h2", { text: hostName(s) }),
          h("p", { class: "text-3", text: [plural(pods.length, "episode"), vids.length ? plural(vids.length, "video") : null, total ? `${Math.round(total / 60)} min` : null, plural(s.plays, "play")].filter(Boolean).join(" · ") }),
          h("div", { class: "st-card-actions" },
            pods[0] ? h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => player.play(pods[0]) }, iconEl("headphones"), "Play latest") : null,
            mine ? null : followBtn({ host: s.host, following: s.following }))))];
    if (s.live.length) { out.push(h("h3", { class: "st-h" }, h("span", { class: "st-dot" }), "Live now")); out.push(h("div", { class: "st-grid" }, ...s.live.map((x) => liveCard(x)))); }
    if (s.upcoming.length) { out.push(h("h3", { class: "st-h", text: "Coming up" })); out.push(h("div", { class: "st-list" }, ...s.upcoming.map((x) => upcomingRow(x)))); }
    if (pods.length) { out.push(h("h3", { class: "st-h", text: "Podcast episodes" })); out.push(h("div", { class: "st-ep-list" }, ...pods.map((e) => episodeRow(e)))); }
    if (vids.length) { out.push(h("h3", { class: "st-h", text: "Videos and more" })); out.push(h("div", { class: "st-tiles" }, ...vids.map((e) => tile(e, player.progress()[e.id])))); }
    if (!pods.length && !vids.length && !s.live.length && !s.upcoming.length) out.push(h("p", { class: "text-3 st-empty", text: "Nothing posted yet." }));
    return out;
  }
  function episodeRow(e) {
    const p = player.progress()[e.id];
    const pct = p?.d ? Math.min(100, Math.round((p.t / p.d) * 100)) : 0;
    return h("div", { class: `st-ep-row${player.current?.id === e.id ? " is-playing" : ""}`, "data-ep": String(e.id) },
      h("button", { class: "st-ep-play", type: "button", "aria-label": `Play ${e.title}`, onclick: () => player.play(e) }, iconEl("headphones")),
      h("div", { class: "st-ep-row-main" },
        h("button", { class: "st-link st-ep-title", type: "button", text: e.title, onclick: () => openItem(e.id) }),
        e.description ? h("p", { class: "text-2 small", style: "margin:2px 0 0", text: e.description }) : null,
        h("small", { class: "text-3", text: [dateText(e.createdAt), fmtLen(e.seconds), plural(e.plays, "play"), pct ? `${pct}% listened` : null].filter(Boolean).join(" · ") })));
  }

  // ---------- the mini player (audio) ----------
  function miniPlayer() {
    const KEY = "gsmp-ep-progress";
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
    const write = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } };
    const audio = h("audio", { preload: "metadata" });
    const art = h("span", { class: "st-mp-art" });
    const title = h("button", { class: "st-mp-title st-link", type: "button" });
    const showName = h("small", { class: "text-3 st-mp-show" });
    const playBtn = h("button", { class: "st-mp-btn st-mp-main", type: "button", "aria-label": "Play" });
    const back = h("button", { class: "st-mp-btn", type: "button", "aria-label": "Back 15 seconds", text: "−15" });
    const fwd = h("button", { class: "st-mp-btn", type: "button", "aria-label": "Forward 30 seconds", text: "+30" });
    const speed = h("button", { class: "st-mp-btn st-mp-speed", type: "button", "aria-label": "Playback speed" });
    const bar = h("input", { class: "st-mp-bar", type: "range", min: 0, max: 1000, value: 0, "aria-label": "Position" });
    const time = h("small", { class: "text-3 st-mp-time", text: "0:00" });
    const chap = h("small", { class: "st-mp-chap" });
    const close = h("button", { class: "icon-btn st-mp-close", type: "button", "aria-label": "Close player" }, iconEl("x"));
    const el = h("div", { class: "st-mp", hidden: true }, art, h("div", { class: "st-mp-info" }, title, showName), h("div", { class: "st-mp-ctrl" }, back, playBtn, fwd, speed), h("div", { class: "st-mp-seek" }, bar, time), close, audio);
    const drawBtn = () => { playBtn.replaceChildren(audio.paused ? "▶" : "❚❚"); playBtn.setAttribute("aria-label", audio.paused ? "Play" : "Pause"); };
    const drawSpeed = () => { speed.textContent = `${getSpeed()}x`; audio.playbackRate = getSpeed(); };
    drawSpeed();
    const api = { el, current: null, progress: read, syncSpeed: drawSpeed };
    const counted = new Set();
    let lastSave = 0;
    api.load = (e) => {
      api.current = e;
      el.hidden = false;
      art.replaceChildren(cover(e.host, "sm", e.kind));
      title.textContent = e.title;
      title.onclick = () => openItem(e.id);
      showName.textContent = hostName(e);
      audio.src = e.audio;
      drawSpeed();
      const p = read()[e.id];
      audio.addEventListener("loadedmetadata", () => { if (p && p.t > 5 && (!audio.duration || p.t < audio.duration - 10)) audio.currentTime = p.t; audio.playbackRate = getSpeed(); }, { once: true });
      drawBtn();
      document.querySelectorAll(".is-playing").forEach((x) => x.classList.remove("is-playing"));
      document.querySelectorAll(`[data-ep="${e.id}"]`).forEach((x) => x.classList.add("is-playing"));
    };
    api.play = (e) => {
      if (api.current?.id !== e.id) api.load(e);
      audio.play().catch(() => {});
      if (!counted.has(e.id)) { counted.add(e.id); postJson("/api/streams", { action: "episode-play", id: e.id }).catch(() => {}); }
    };
    api.seekTo = (e, t) => {
      if (api.current?.id !== e.id) { api.load(e); audio.addEventListener("loadedmetadata", () => { audio.currentTime = t; }, { once: true }); }
      else audio.currentTime = t;
      api.play(e);
    };
    playBtn.addEventListener("click", () => { if (!api.current) return; audio.paused ? api.play(api.current) : audio.pause(); });
    back.addEventListener("click", () => { audio.currentTime = Math.max(0, audio.currentTime - 15); });
    fwd.addEventListener("click", () => { audio.currentTime = Math.min(audio.duration || 1e9, audio.currentTime + 30); });
    speed.addEventListener("click", () => { setSpeed(SPEEDS[(SPEEDS.indexOf(getSpeed()) + 1) % SPEEDS.length]); drawSpeed(); });
    bar.addEventListener("input", () => { if (audio.duration) audio.currentTime = (bar.value / 1000) * audio.duration; });
    close.addEventListener("click", () => { audio.pause(); el.hidden = true; api.current = null; document.querySelectorAll(".is-playing").forEach((x) => x.classList.remove("is-playing")); });
    audio.addEventListener("play", drawBtn);
    audio.addEventListener("pause", () => { drawBtn(); save(true); });
    audio.addEventListener("timeupdate", () => {
      if (audio.duration) bar.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
      const c = (api.current?.chapters || []).filter((x) => x.t <= audio.currentTime).pop();
      chap.textContent = c ? c.title : "";
      time.replaceChildren(`${fmtLen(Math.floor(audio.currentTime)) || "0:00"}${audio.duration && isFinite(audio.duration) ? ` / ${fmtLen(Math.floor(audio.duration))}` : ""}`, c ? h("span", { class: "st-mp-chap", text: ` · ${c.title}` }) : "");
      save(false);
    });
    audio.addEventListener("ended", () => { const p = read(); delete p[api.current?.id]; write(p); drawBtn(); });
    function save(now) {
      if (!api.current || (!now && Date.now() - lastSave < 5000)) return;
      lastSave = Date.now();
      const p = read();
      p[api.current.id] = { t: Math.floor(audio.currentTime), d: Math.floor(isFinite(audio.duration) ? audio.duration : 0), at: Date.now() };
      const keys = Object.keys(p);
      if (keys.length > 50) keys.sort((a, b) => p[a].at - p[b].at).slice(0, keys.length - 50).forEach((k) => delete p[k]);
      write(p);
    }
    return api;
  }

  // ---------- Post: a podcast episode (upload or record now) or something for More (video or audio) ----------
  function postDialog(d) {
    const opts = d.episodeAs;
    let kind = "podcast";
    const as = h("select", { class: "input", id: "ep-as" }, ...opts.map((a) => h("option", { value: a.key, text: a.label })));
    const title = h("input", { class: "input", id: "ep-title", maxlength: 80, placeholder: "e.g. Episode 1: Our first week on GalaxySMP" });
    const desc = h("textarea", { class: "input", id: "ep-desc", maxlength: 300, rows: 2, placeholder: "What's it about? (optional)" });
    const cat = h("select", { class: "input", id: "ep-cat" }, h("option", { value: "", text: "None" }), ...d.categories.map((c) => h("option", { value: c, text: c })));
    const chap = h("textarea", { class: "input", id: "ep-chap", rows: 3, placeholder: "0:00 Intro\n3:20 Bedwars tips" });
    const teamOnly = h("input", { type: "checkbox", id: "ep-team-only" });
    const teamOnlyRow = h("label", { class: "st-check", hidden: true }, teamOnly, h("span", {}, h("b", { text: "Team members only" }), h("small", { class: "text-3", text: "Only your team can see it. Good for team rules and plans." })));
    const syncAs = () => { teamOnlyRow.hidden = (opts.length > 1 ? as.value : opts[0].key) !== "team"; if (teamOnlyRow.hidden) teamOnly.checked = false; };
    as.addEventListener("change", syncAs); syncAs();
    let blob = null, seconds = 0;
    const fileIn = h("input", { type: "file", id: "ep-file" });
    const fileInfo = h("p", { class: "text-3 small", style: "margin:4px 0 0" });
    const fileHelp = h("small", { class: "text-3" });
    fileIn.addEventListener("change", () => {
      const f = fileIn.files[0];
      if (!f) return;
      blob = f;
      fileInfo.textContent = `${f.name} · ${(f.size / 1024 / 1024).toFixed(1)} MB`;
      const probe = document.createElement(/^video\//.test(f.type) ? "video" : "audio"); probe.preload = "metadata"; probe.src = URL.createObjectURL(f);
      probe.onloadedmetadata = () => { if (isFinite(probe.duration)) seconds = Math.round(probe.duration); URL.revokeObjectURL(probe.src); };
      if (!title.value) title.value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80);
    });
    // record now (voice)
    const recBtn = h("button", { class: "btn btn-secondary btn-sm", type: "button" }, iconEl("mic"), "Record now");
    const recInfo = h("span", { class: "text-3 small" });
    const preview = h("audio", { controls: true, hidden: true, style: "width:100%;margin-top:6px" });
    let rec = null, recTimer = null;
    recBtn.addEventListener("click", async () => {
      if (rec) { rec.stop(); return; }
      let st;
      try { st = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() }); }
      catch { toast("Allow the microphone to record."); return; }
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
      const chunks = [];
      rec = new MediaRecorder(st, { mimeType: type || undefined, audioBitsPerSecond: 64_000 });
      rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      const start = Date.now();
      rec.onstop = () => {
        clearInterval(recTimer); st.getTracks().forEach((t) => t.stop());
        blob = new Blob(chunks, { type: (rec.mimeType || "audio/webm").split(";")[0].replace("video/", "audio/") });
        seconds = Math.round((Date.now() - start) / 1000);
        preview.src = URL.createObjectURL(blob); preview.hidden = false;
        recInfo.textContent = `Recorded ${fmtLen(seconds) || "0:00"}. Listen back, or record again.`;
        recBtn.replaceChildren(iconEl("mic"), "Record again");
        fileIn.value = ""; fileInfo.textContent = "";
        rec = null;
      };
      rec.start(1000);
      recBtn.replaceChildren(h("span", { class: "st-rec-dot on" }), "Stop recording");
      recTimer = setInterval(() => { recInfo.textContent = `Recording ${fmtLen(Math.round((Date.now() - start) / 1000)) || "0:00"}`; }, 500);
    });
    const typeBtns = h("div", { class: "st-type-pick" });
    const fileField = field("Upload a file", fileIn);
    fileField.append(fileHelp);
    const drawKind = () => {
      typeBtns.replaceChildren(...[["podcast", "headphones", "Podcast episode", "Voice only"], ["more", "image", "More", "A video or audio, like your team's rules"]].map(([k, ic, n, sub]) =>
        h("button", { class: "st-type-card sm", type: "button", "aria-pressed": String(kind === k), onclick: () => { kind = k; blob = null; fileIn.value = ""; fileInfo.textContent = ""; drawKind(); } },
          iconEl(ic), h("b", { text: n }), h("small", { class: "text-3", text: sub }))));
      fileIn.accept = kind === "more" ? "video/*,audio/*,.mp4,.mov,.webm,.mp3,.m4a,.wav,.ogg" : "audio/*,.mp3,.m4a,.wav,.ogg,.webm,.aac,.opus";
      fileHelp.textContent = kind === "more" ? "A video (MP4, MOV, WEBM) or audio file, up to 300 MB. On a phone you can record a video right from here." : "MP3, M4A, WAV, OGG or WEBM, up to 300 MB.";
      title.placeholder = kind === "more" ? "e.g. Our team rules" : "e.g. Episode 1: Our first week on GalaxySMP";
    };
    drawKind();
    const progress = h("progress", { class: "st-ep-progress", max: 100, value: 0, hidden: true });
    openDialog({ title: "Post to Stages", body: h("div", { class: "form" }, typeBtns,
      h("div", { class: "st-ep-source" }, fileField, fileInfo,
        h("p", { class: "st-ep-or", text: "or" }),
        h("div", { class: "cx-row", style: "gap:8px;align-items:center;flex-wrap:wrap" }, recBtn, recInfo), preview),
      opts.length > 1 ? field("Who's it from", as) : null, field("Title", title), field("Description", desc), field("Category", cat),
      field("Chapters (optional)", chap, "One per line: a time, then a name."), teamOnlyRow, progress),
    actions: [{ label: "Cancel", onClick: () => { if (rec) rec.stop(); } }, { label: "Post", kind: "primary", onClick: async () => {
      if (rec) throw new Error("Stop the recording first.");
      if (!blob) throw new Error("Choose a file or record one.");
      progress.hidden = false;
      const r = await postJson("/api/episodes/start", { as: opts.length > 1 ? as.value : opts[0].key, kind, title: title.value, description: desc.value, category: cat.value,
        chapters: chap.value, teamOnly: teamOnly.checked, mime: blob.type || "audio/mpeg", size: blob.size, seconds });
      try {
        let n = 0;
        for (let off = 0; off < blob.size; off += r.partBytes) {
          const piece = blob.slice(off, off + r.partBytes);
          n += 1;
          let ok = false;
          for (let tries = 0; tries < 3 && !ok; tries++) {
            const res = await fetch(`/api/episodes/${r.id}/part?n=${n}`, { method: "PUT", body: piece, credentials: "same-origin", headers: { "Content-Type": "application/octet-stream" } }).catch(() => null);
            ok = Boolean(res?.ok);
            if (!ok) await new Promise((w) => setTimeout(w, 1500 * (tries + 1)));
          }
          if (!ok) throw new Error("The upload stopped. Check your internet and try again.");
          progress.value = Math.round(((off + piece.size) / blob.size) * 100);
        }
        const done = await postJson(`/api/episodes/${r.id}/finish`, {});
        toast(done.message || "Posted!");
        lib.tab = kind === "more" ? "more" : "podcasts"; lib.show = null; lib.item = null;
        showList();
      } catch (er) {
        postJson(`/api/episodes/${r.id}/cancel`, {}).catch(() => {});
        progress.hidden = true;
        throw er;
      }
    } }] });
  }

  // ---------- Go live: setup before the stage opens ----------
  // 1 What (Podcast or Live Stream) · 2 Details · 3 Rules · 4 Mic & camera check · then Backstage (only speakers),
  // where a host presses Go live (3, 2, 1). `only: "check"` = just the check, for starting a scheduled stage.
  function setupWizard(d, only = null) {
    const checkOnly = Boolean(only);
    view.listing = false;
    try { history.replaceState(history.state, "", "#stages"); } catch { /* ignore */ }
    const st = { step: checkOnly ? 3 : 0, kind: only?.kind || "podcast", as: d.as?.[0]?.key || "me", title: "", description: "", category: "", when: "now", at: "",
      saveVideo: false, speakMode: "hand", chatOn: true, teamOnly: false };
    let test = null;   // the running mic / camera test
    const stopTest = () => { if (!test) return; clearInterval(test.timer); test.stream?.getTracks().forEach((t) => t.stop()); test.ac?.close().catch(() => {}); test = null; };
    const leave = () => { stopTest(); showList(); };
    const steps = checkOnly ? ["Check"] : ["Type", "Details", "Rules", "Check"];
    const wrap = h("div", { class: "st-setup" });
    box.replaceChildren(wrap);

    function render() {
      stopTest();
      const idx = checkOnly ? 0 : st.step;
      const later = st.when === "later";
      const lastStep = checkOnly || (later ? st.step === 2 : st.step === 3);
      const head = h("header", { class: "st-setup-head" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: leave }, iconEl("x"), "Cancel"),
        h("ol", { class: "st-steps" }, ...steps.map((n, i) => h("li", { class: i < idx ? "done" : i === idx ? "on" : "", hidden: later && n === "Check" }, h("span", { text: String(i + 1) }), n))));
      const body = h("div", { class: "st-setup-body" }, ...(checkOnly ? checkStep() : [typeStep, detailsStep, rulesStep, checkStep][st.step]()));
      const next = h("button", { class: "btn btn-primary", type: "button" }, lastStep ? (later ? "Schedule" : checkOnly ? "Go backstage" : "Go backstage") : "Next", lastStep ? null : iconEl("arrow"));
      next.addEventListener("click", async () => {
        try {
          if (!lastStep) { validate(); st.step += 1; render(); return; }
          next.disabled = true;
          await finish();
        } catch (e) { toast(e.message); next.disabled = false; }
      });
      const backBtn = idx > 0 ? h("button", { class: "btn btn-ghost", type: "button", onclick: () => { st.step -= 1; render(); } }, iconEl("arrow", "flip"), "Back") : h("span");
      wrap.replaceChildren(head, body, h("footer", { class: "st-setup-foot" }, backBtn,
        lastStep && !later ? h("small", { class: "text-3", text: "Backstage is private: only you and your speakers. Nobody is told until you press Go live." }) : null, next));
    }
    function validate() {
      if (st.step === 1) {
        if (st.title.trim().length < 3) throw new Error("Give it a title (at least 3 characters).");
        if (st.when === "later" && !st.at) throw new Error("Pick a date and time.");
      }
    }
    async function finish() {
      if (checkOnly) {
        stopTest();
        await act({ action: "start", id: only.id }, (r) => openStream(r.id, { autoStage: true }));
        return;
      }
      const body = { action: "create", as: st.as, kind: st.kind, title: st.title, description: st.description, category: st.category || null,
        saveVideo: st.saveVideo, speakMode: st.speakMode, chatOn: st.chatOn, teamOnly: st.teamOnly };
      if (st.when === "later") body.at = new Date(st.at).toISOString();
      stopTest();
      const r = await postJson("/api/streams", body);
      toast(r.message);
      if (r.backstage) openStream(r.id, { autoStage: true }); else showList();
    }

    function typeStep() {
      const card = (k, icon, name, lines) => h("button", { class: "st-type-card", type: "button", "aria-pressed": String(st.kind === k), onclick: () => { st.kind = k; render(); } },
        icon, h("b", { text: name }), h("ul", {}, ...lines.map((l) => h("li", { text: l }))));
      return [h("h2", { class: "st-setup-h", text: "What are you going live with?" }),
        h("div", { class: "st-type-grid" },
          card("podcast", iconEl("headphones"), "Podcast", ["You and your speakers talk. Voice only, no video.", "Listeners can raise their hand to join in.", "Saved as an episode when it ends, so people can listen later."]),
          card("live", stageIcon(), "Live Stream", ["Show what you're doing: share your screen or turn on your camera.", "Only watchable while it's live…", "…unless you choose Save as a video."]))];
    }
    function detailsStep() {
      const inp = (key, el) => { el.value = st[key]; el.addEventListener("input", () => { st[key] = el.value; }); el.addEventListener("change", () => { st[key] = el.value; }); return el; };
      const as = inp("as", h("select", { class: "input", id: "su-as" }, ...d.as.map((a) => h("option", { value: a.key, text: a.label }))));
      as.addEventListener("change", () => { if (st.as !== "team") st.teamOnly = false; });
      const title = inp("title", h("input", { class: "input", id: "su-title", maxlength: 80, placeholder: st.kind === "podcast" ? "e.g. The Galaxy Talk, episode 3" : "e.g. Building a castle at spawn" }));
      const desc = inp("description", h("textarea", { class: "input", id: "su-desc", maxlength: 300, rows: 2, placeholder: "What's it about? (optional)" }));
      const cat = inp("category", h("select", { class: "input", id: "su-cat" }, h("option", { value: "", text: "Choose one (optional)" }), ...d.categories.map((c) => h("option", { value: c, text: c }))));
      const when = inp("when", h("select", { class: "input", id: "su-when" }, h("option", { value: "now", text: "Now" }), h("option", { value: "later", text: "Schedule for later" })));
      const at = inp("at", h("input", { class: "input", id: "su-at", type: "datetime-local" }));
      const atField = field("Date and time", at);
      atField.hidden = st.when !== "later";
      when.addEventListener("change", () => { atField.hidden = st.when !== "later"; render(); });
      const save = h("input", { type: "checkbox", id: "su-save" }); save.checked = st.saveVideo;
      save.addEventListener("change", () => { st.saveVideo = save.checked; });
      return [h("h2", { class: "st-setup-h", text: st.kind === "podcast" ? "Podcast details" : "Live stream details" }),
        h("div", { class: "form" },
          d.as.length > 1 ? field("Who's hosting", as) : null, field("Title", title), field("Description", desc), field("Category", cat), field("When", when), atField,
          st.kind === "live"
            ? h("label", { class: "st-check" }, save, h("span", {}, h("b", { text: "Save as a video when it ends" }), h("small", { class: "text-3", text: "It records while you're live (keep this page open) and shows in Live > Watch again after." })))
            : h("p", { class: "st-note", text: "Your podcast records while it's live and is saved as an episode when it ends. Keep this page open while you're live." }))];
    }
    function rulesStep() {
      const radio = (key, val, name, sub) => {
        const r = h("input", { type: "radio", name: `su-${key}`, value: String(val) });
        r.checked = st[key] === val;
        r.addEventListener("change", () => { st[key] = val; });
        return h("label", { class: "st-check" }, r, h("span", {}, h("b", { text: name }), h("small", { class: "text-3", text: sub })));
      };
      return [h("h2", { class: "st-setup-h", text: "Rules for the stage" }),
        h("h3", { class: "st-h", text: "Who can speak" }),
        radio("speakMode", "hand", "Anyone can ask", "Listeners can raise their hand, and you choose who comes up."),
        radio("speakMode", "invite", "Invite only", "Only your speakers, and people you invite from People."),
        h("h3", { class: "st-h", text: "Live chat" }),
        radio("chatOn", true, "Chat on", "Everyone can chat (the word filter is always on)."),
        radio("chatOn", false, "Chat off", "Only hosts can write in the chat."),
        st.as === "team" ? h("h3", { class: "st-h", text: "Who can join" }) : null,
        st.as === "team" ? radio("teamOnly", false, "Everyone", "Anyone on GalaxySMP can join and listen.") : null,
        st.as === "team" ? radio("teamOnly", true, "Team members only", "Only your team can see and join it.") : null,
        h("p", { class: "text-3 small", style: "margin:10px 0 0", text: "You can change the chat and who can speak during the stage, in Settings. Be kind and follow the rules: staff can end any stage. Don't share personal information." })];
    }
    function checkStep() {
      const kind = only?.kind || st.kind;
      const micSel = h("select", { class: "input", id: "su-mic" });
      const camSel = h("select", { class: "input", id: "su-cam" });
      const meter = h("span", { class: "st-meter-fill" });
      const status = h("p", { class: "text-3 small", style: "margin:4px 0 0", text: "Say something: the bar moves when your mic hears you." });
      const video = h("video", { class: "st-check-video", playsinline: true, autoplay: true, hidden: kind === "podcast" });
      video.muted = true;
      const start = async () => {
        stopTest();
        const t = { };
        test = t;
        try {
          t.stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(), video: kind === "podcast" ? false : camConstraints() });
        } catch {
          try { t.stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() }); status.textContent = "Couldn't start your camera. You can still go live with your mic and share your screen."; }
          catch { status.textContent = "Allow your microphone to go live (check your browser's site settings)."; return; }
        }
        if (test !== t) { t.stream.getTracks().forEach((x) => x.stop()); return; }
        const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        const fill = (sel, kindName, key, current) => {
          const list = devs.filter((x) => x.kind === kindName);
          sel.replaceChildren(...list.map((x, i) => h("option", { value: x.deviceId, text: x.label || `${kindName === "audioinput" ? "Microphone" : "Camera"} ${i + 1}` })));
          if (current) sel.value = current;
          sel.onchange = () => { saveDevice(key, sel.value); start(); };
        };
        fill(micSel, "audioinput", "mic", t.stream.getAudioTracks()[0]?.getSettings?.().deviceId);
        fill(camSel, "videoinput", "cam", t.stream.getVideoTracks()[0]?.getSettings?.().deviceId);
        if (t.stream.getVideoTracks().length) { video.srcObject = new MediaStream(t.stream.getVideoTracks()); video.hidden = false; video.play().catch(() => {}); }
        t.ac = new (window.AudioContext || window.webkitAudioContext)();
        const an = t.ac.createAnalyser(); an.fftSize = 512;
        t.ac.createMediaStreamSource(new MediaStream(t.stream.getAudioTracks())).connect(an);
        const buf = new Uint8Array(an.fftSize);
        t.timer = setInterval(() => {
          an.getByteTimeDomainData(buf);
          let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          meter.style.width = `${Math.min(100, Math.round((peak / 128) * 160))}%`;
        }, 80);
      };
      setTimeout(start, 0);
      return [h("h2", { class: "st-setup-h", text: "Mic & camera check" }),
        h("div", { class: "st-check-grid" },
          h("div", { class: "form" },
            field("Microphone", micSel), h("div", { class: "st-meter", "aria-hidden": "true" }, meter), status,
            kind === "podcast" ? null : field("Camera", camSel, "You can turn the camera on or share your screen once you're backstage.")),
          kind === "podcast" ? h("div", { class: "st-check-pod" }, iconEl("headphones"), h("p", { class: "text-3 small", text: "Podcasts are voice only. Use headphones so listeners don't hear an echo." })) : video)];
    }
    render();
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
      h("div", { class: `st-thumb${s.kind === "podcast" ? " is-pod" : ""}` },
        h("span", { class: "st-live", text: s.kind === "podcast" ? "LIVE PODCAST" : "LIVE" }),
        h("span", { class: "st-viewers" }, iconEl("headphones"), String(s.viewers)),
        h("span", { class: "st-thumb-ic" }, s.kind === "podcast" ? iconEl("headphones") : stageIcon())),
      h("div", { class: "st-card-body" },
        h("b", { class: "st-title", text: s.title }),
        hostLabel(s),
        s.category || s.teamOnly ? h("div", { class: "st-chips" }, ...tags(s)) : null,
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
      h("span", { class: "st-row-main" }, h("b", { text: s.title }), hostLabel(s), h("small", { class: "text-3", text: [s.kind === "podcast" ? "Podcast" : "Live stream", s.category, s.teamOnly ? "Team only" : null].filter(Boolean).join(" · ") })),
      h("span", { class: "st-row-btns" },
        s.manage ? h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Start now", onclick: () => setupWizard(lib.d, { kind: s.kind, id: s.id }) }) : remind,
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

  // ---------- one stage ----------
  async function openStream(id, opts = {}) {
    view.listing = false;
    stream?.close();
    try { history.replaceState(history.state, "", `#stages/${id}`); } catch { /* ignore */ }
    let d;
    try { d = await getJson(`/api/streams/${id}`); } catch (e) { toast(e.message); return showList(); }
    const s = d.stream;
    const back = h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => showList() }, iconEl("arrow", "flip"), "All stages");
    if (s.status !== "live" && s.status !== "backstage") {
      box.replaceChildren(back, h("section", { class: "panel st-box st-over" },
        h("h2", { text: s.title }), hostLabel(s),
        h("p", { class: "text-2", text: s.status === "ended" ? (s.kind === "podcast" ? "This podcast has ended. If it was saved, you'll find it in Podcasts." : "This live stream has ended.") : `Starts ${whenText(s.scheduledAt)}.` }),
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
      menu.push(h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => this.pollDialog() }, iconEl("poll"), "Poll"));
      menu.push(h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => this.settingsDialog() }, iconEl("wrench"), "Settings"));
    } else if (this.rights.mod) {
      menu.push(this.peopleBtn());
    }
    if (this.rights.mod && !this.rights.manage && s.host.type === "user") menu.push(h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => this.banDialog() }, iconEl("shield"), "Stop hosting"));
    if (this.rights.manage || this.rights.mod) menu.push(h("button", { class: "btn btn-danger btn-sm", type: "button", text: "End stage", onclick: () => this.endDialog() }));
    else menu.push(h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => this.reportDialog() }, iconEl("flag"), "Report"));
    if (this.rights.record) {
      this.recBtn = h("button", { class: "btn btn-ghost btn-sm st-rec-btn", type: "button", onclick: () => (this.recorder ? this.stopRecording() : this.startRecording()) });
      menu.unshift(this.recBtn);
    }
    this.ccOn = (() => { try { return localStorage.getItem("gsmp-cc") !== "0"; } catch { return true; } })();
    this.ccBtn = h("button", { class: "btn btn-ghost btn-sm st-cc-btn", type: "button", "aria-pressed": String(this.ccOn), title: "Live captions", onclick: () => this.toggleCC() }, "CC");
    menu.unshift(this.ccBtn);
    this.recBadge = h("span", { class: "st-rec", hidden: true }, "● Recording");
    this.titleEl = h("h2", { class: "st-ptitle", text: s.title });
    this.info = { status: s.status, kind: s.kind, speakMode: s.speakMode || "hand", chatOn: s.chatOn !== false };
    this.pillEl = h("span", { class: "st-live" });
    const head = h("header", { class: "st-phead" },
      h("div", { class: "st-phead-main" }, ui.back,
        h("div", {}, h("div", { class: "st-ptitle-row" }, this.pillEl, this.titleEl, this.viewersEl, this.recBadge), hostLabel(s))),
      h("div", { class: "st-phead-btns" }, this.rights.manage ? null : ui.followBtn(s), ...menu));
    this.stageEl = h("div", { class: "st-stage" });
    this.audienceEl = h("div", { class: "st-audience" });
    this.floatEl = h("div", { class: "st-floats", "aria-hidden": "true" });
    this.capEl = h("div", { class: "st-captions", "aria-live": "polite", hidden: !this.ccOn });
    this.captions = new Map();   // speaker id -> { username, text, at }
    const backstage = s.status === "backstage";
    const speaker = ui.autoStage || (backstage && this.rights.stage);
    this.startBtn = h("button", { class: "btn btn-primary st-start", type: "button", onclick: () => this.start(speaker) },
      iconEl(speaker ? "mic" : "headphones"), backstage ? "Join backstage" : speaker ? "Start speaking" : s.kind === "podcast" ? "Listen" : "Join the stream");
    this.gate = h("div", { class: "st-gate" }, this.startBtn, h("p", { class: "text-3 small", text: speaker
      ? (s.kind === "podcast" ? "Your browser will ask to use your microphone." : "Your browser will ask to use your microphone. You can share your screen or turn on your camera after.")
      : "You'll join the audience." }));
    this.bsEl = h("div", { class: "st-bs", hidden: true });
    this.cdEl = h("div", { class: "st-countdown", hidden: true, "aria-live": "assertive" });
    this.pollEl = h("div", { class: "st-poll", hidden: true });
    this.chatOffEl = h("p", { class: "text-3 small st-chat-off", hidden: true, text: "The hosts turned the chat off." });
    this.audioBox = h("div", { hidden: true });
    this.controls = h("div", { class: "st-controls" });
    this.chatList = h("div", { class: "st-chat-list", role: "log", "aria-live": "polite" });
    this.chatInput = h("input", { class: "input", id: "st-chat-input", maxlength: 200, placeholder: "Say something nice", autocomplete: "off" });
    const chatForm = h("form", { class: "st-chat-form" }, this.chatInput, h("button", { class: "btn btn-primary", type: "submit", "aria-label": "Send" }, iconEl("send")));
    chatForm.addEventListener("submit", (e) => { e.preventDefault(); this.sendChat(); });
    this.chatForm = chatForm;
    this.reactBar = h("div", { class: "st-react" });
    const stageWrap = h("div", { class: "st-stage-wrap" }, this.stageEl, this.floatEl, this.capEl, this.bsEl, this.cdEl, this.gate);
    ui.box.replaceChildren(h("div", { class: "st-player" }, head,
      h("div", { class: "st-body" },
        h("div", { class: "st-main" }, stageWrap, this.audienceEl, this.controls, this.reactBar),
        h("aside", { class: "st-chat" }, this.pollEl, h("h3", { class: "st-h", style: "margin:0 0 6px", text: "Live chat" }), this.chatList, this.chatOffEl, chatForm)),
      this.audioBox));
    this.renderStage();
    this.renderInfo();
  }

  // backstage / live, the pill, the chat on or off
  renderInfo() {
    const i = this.info;
    const backstage = i.status === "backstage";
    this.pillEl.textContent = backstage ? "BACKSTAGE" : i.kind === "podcast" ? "LIVE PODCAST" : "LIVE";
    this.pillEl.classList.toggle("st-pill-bs", backstage);
    this.bsEl.hidden = !backstage || !this.gate.hidden;   // shown once you've joined
    if (backstage) {
      this.bsEl.replaceChildren(
        h("b", { text: "You're backstage" }),
        h("p", { class: "small", text: "Only hosts and speakers are here. Test your mic, then go live when everyone's ready." }),
        this.rights.manage ? h("button", { class: "btn btn-primary st-golive", type: "button", onclick: (e) => this.goLiveNow(e.currentTarget) }, h("span", { class: "st-dot" }), "Go live") : h("small", { class: "text-3", text: "A host will start the stage." }));
    }
    const chatOff = i.chatOn === false && !this.rights.manage && !this.rights.mod;
    this.chatForm.hidden = chatOff;
    this.chatOffEl.hidden = !chatOff;
  }
  async goLiveNow(btn) {
    btn.disabled = true;
    try { await this.request("countdown"); }
    catch (e) { this.toast(e.message); btn.disabled = false; return; }
    this.goingLive = true;
    setTimeout(async () => {
      try {
        await postJson("/api/streams", { action: "golive", id: this.s.id });
        // a podcast, or a stream the host chose to save, records from this device and is saved when it ends
        if (this.s.kind === "podcast" || this.s.saveVideo) this.startRecording({ auto: true });
      } catch (e) { this.toast(e.message); btn.disabled = false; this.cdEl.hidden = true; }
      this.goingLive = false;
    }, 3100);
  }
  countdown() {
    let n = 3;
    this.cdEl.hidden = false;
    const tick = () => {
      if (n === 0) { this.cdEl.replaceChildren(h("span", { class: "st-cd-live", text: "LIVE" })); setTimeout(() => { this.cdEl.hidden = true; }, 900); return; }
      this.cdEl.replaceChildren(h("span", { class: "st-cd-n", text: String(n) }));
      n -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  }
  renderPoll(p) {
    this.poll = p;
    this.pollEl.hidden = !p;
    if (!p) return;
    const mine = this.myVote?.id === p.id ? this.myVote.i : null;
    const showResults = mine !== null || !p.open || this.rights.manage;
    this.pollEl.replaceChildren(
      h("div", { class: "st-poll-head" }, h("span", { class: "st-eyebrow", text: p.open ? "Poll" : "Poll closed" }), h("small", { class: "text-3", text: `${p.total} vote${p.total === 1 ? "" : "s"}` })),
      h("b", { class: "st-poll-q", text: p.q }),
      ...p.options.map((o, i) => {
        const pct = p.total ? Math.round((p.counts[i] / p.total) * 100) : 0;
        return h("button", { class: `st-poll-opt${mine === i ? " is-mine" : ""}`, type: "button", disabled: !p.open, onclick: () => this.vote(p.id, i) },
          showResults ? h("span", { class: "st-poll-bar", style: `width:${pct}%` }) : null,
          h("span", { class: "st-poll-label", text: o }), showResults ? h("span", { class: "st-poll-pct", text: `${pct}%` }) : null);
      }),
      this.rights.manage || this.rights.mod ? h("div", { class: "st-card-actions" },
        p.open ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "End poll", onclick: () => this.request("poll.end").catch((e) => this.toast(e.message)) }) : null,
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove", onclick: () => this.request("poll.end", { remove: true }).catch((e) => this.toast(e.message)) })) : null);
  }
  async vote(id, i) {
    try { await this.request("poll.vote", { id, i }); this.myVote = { id, i }; this.renderPoll(this.poll); } catch (e) { this.toast(e.message); }
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
      case "hello": this._self = m.you; this.rights = m.rights; this.reactions = m.reactions; this.myVote = m.myVote !== null && m.myVote !== undefined ? { id: null, i: m.myVote } : null; this.chatList.replaceChildren(); m.chat.forEach((c) => this.addChat(c)); this.renderReactions(); this.renderControls(); return;
      case "state": {
        this.state = m;
        if (m.info?.title) this.titleEl.textContent = m.info.title;
        if (m.info) { this.info = { ...this.info, ...m.info }; this.renderInfo(); }
        if (this.myVote && this.myVote.id === null && m.poll) this.myVote.id = m.poll.id;
        this.renderPoll(m.poll || null);
        this.viewersEl.lastChild.textContent = String(m.viewers);
        this.handUp = (m.hands || []).some((x) => x.id === this._self);
        this.renderStage(); this.renderControls(); this.drawPeopleBtn(); this.syncSubs();
        const rec = m.recording || [];
        this.recBadge.hidden = !rec.length;
        this.recBadge.title = rec.length ? `Recorded by ${rec.join(", ")}` : "";
        this.drawRecBtn();
        return;
      }
      case "countdown": this.countdown(); return;
      case "golive": this.toast(this.s.kind === "podcast" ? "Your podcast is live!" : "You're live!"); return;
      case "hand": this.toast(`✋ ${m.username} wants to speak. Open People to bring them up.`); return;
      case "hand.lowered": this.handUp = false; this.renderControls(); this.toast("A host lowered your hand."); return;
      case "chat": this.addChat(m.message); return;
      case "chat.deleted": this.chatList.querySelector(`[data-id="${CSS.escape(m.id)}"]`)?.remove(); return;
      case "react": this.floatReaction(m.emoji); return;
      case "caption": this.showCaption(m); return;
      case "invited": this.invitedDialog(m.by); return;
      case "removed": this.stopPublishing(); this.toast("A host moved you back to the audience."); return;
      case "ended": this.endedShown = true; this.finish(m.reason || "The stage ended."); return;
      case "closed": this.endedShown = true; this.finish(m.reason || "You left the stage."); return;
    }
  }

  // The first tap: create the receiving connection (and, for hosts who just went live, go on stage).
  async start(speaker = this.ui.autoStage) {
    this.startBtn.disabled = true;
    try {
      await this.ensureSub();
      this.gate.hidden = true;
      this.renderInfo();
      if (speaker) await this.goOnStage();
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
      this.local = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
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
    this.vTx = this.s.kind === "podcast" ? null : pc.addTransceiver("video", { direction: "sendonly" });   // filled by screen share or camera (not on podcasts)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    tracks.push({ mid: this.aTx.mid, kind: "audio" });
    if (this.vTx) tracks.push({ mid: this.vTx.mid, kind: "video" });
    const res = await this.request("rtc.push", { sdp: offer.sdp, tracks, cam: false });
    await pc.setRemoteDescription(res.answer);
    this.micOn = true; this.camOn = false; this.screenOn = false;
    if (asGuest) this.toast("You're a speaker now!");
    this.startCaptions();
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
  toggleMic() { this.micOn = !this.micOn; if (this.mic) this.mic.enabled = this.micOn; this.sendMedia(); this.micOn ? this.startCaptions() : this.stopCaptions(); }
  async toggleCam() {
    if (!this.vTx) return;
    if (this.screenOn) await this.stopScreen();
    if (this.camOn) { await this.vTx.sender.replaceTrack(null); this.cam?.stop(); this.cam = null; this.camOn = false; }
    else {
      try { const st = await navigator.mediaDevices.getUserMedia({ video: camConstraints() }); this.cam = st.getVideoTracks()[0]; }
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
    this.stopCaptions?.();
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
    this.audienceEl.replaceChildren(...[
      h("span", { class: "st-aud-count" }, iconEl("headphones"), `${listeners} in the audience`),
      hands.length ? h("span", { class: "st-aud-hands" }, `✋ ${hands.length} want${hands.length === 1 ? "s" : ""} to speak`) : null].filter(Boolean));
  }

  renderControls() {
    const c = [];
    if (this.onStage) {
      c.push(h("button", { class: `btn ${this.micOn ? "btn-secondary" : "btn-danger"} btn-sm`, type: "button", onclick: () => this.toggleMic() }, iconEl("mic"), this.micOn ? "Mute" : "Unmute"));
      if (this.s.kind !== "podcast") {
        c.push(h("button", { class: `btn ${this.screenOn ? "btn-primary" : "btn-secondary"} btn-sm`, type: "button", onclick: () => this.toggleScreen() }, iconEl("image"), this.screenOn ? "Stop sharing" : "Share screen"));
        c.push(h("button", { class: `btn ${this.camOn ? "btn-primary" : "btn-secondary"} btn-sm`, type: "button", onclick: () => this.toggleCam() }, iconEl("camera"), this.camOn ? "Camera off" : "Camera"));
      }
      c.push(h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Move to audience", onclick: () => this.leaveStage() }));
    } else if (this.rights.stage) {
      c.push(h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => this.goOnStage().catch((e) => this.toast(e.message)) }, iconEl("mic"), "Become a speaker"));
    } else if (this.info?.speakMode === "invite") {
      c.push(h("small", { class: "text-3", text: "On this stage, the hosts invite people to speak." }));
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

  // ---------- live captions ----------
  // Speakers: the browser's own speech recognition (free, on the device) turns your voice into text,
  // which goes to everyone on the stage. Listeners turn captions on or off with CC.
  startCaptions() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !this.onStage || !this.micOn || this.sr) {
      if (!SR && this.onStage && !this.srWarned) { this.srWarned = true; this.toast("Live captions of your voice need Chrome, Edge or Safari."); }
      return;
    }
    const sr = new SR();
    sr.continuous = true; sr.interimResults = true; sr.lang = navigator.language || "en-US";
    sr.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (!text) continue;
        try { this.ws.send(JSON.stringify({ type: "caption", text, final: r.isFinal })); } catch { /* ignore */ }
        this.showCaption({ id: this._self, username: "You", text, final: r.isFinal });
      }
    };
    sr.onend = () => { if (this.sr === sr && this.onStage && this.micOn && !this.closed) { try { sr.start(); } catch { /* ignore */ } } };
    sr.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { this.sr = null; } };
    this.sr = sr;
    try { sr.start(); } catch { this.sr = null; }
  }
  stopCaptions() {
    const sr = this.sr;
    this.sr = null;
    try { sr?.stop(); } catch { /* ignore */ }
  }
  showCaption(m) {
    this.captions.set(m.id, { username: m.username, text: m.text, at: Date.now() });
    this.drawCaptions();
    clearTimeout(this.capTimer);
    this.capTimer = setTimeout(() => this.drawCaptions(), 4200);
  }
  drawCaptions() {
    const now = Date.now();
    for (const [id, c] of this.captions) if (now - c.at > 4000) this.captions.delete(id);
    const lines = [...this.captions.values()].slice(-2);
    this.capEl.replaceChildren(...lines.map((c) => h("p", { class: "st-cap-line" }, h("b", { text: `${c.username}: ` }), c.text.slice(-140))));
  }
  toggleCC() {
    this.ccOn = !this.ccOn;
    try { localStorage.setItem("gsmp-cc", this.ccOn ? "1" : "0"); } catch { /* ignore */ }
    this.ccBtn.setAttribute("aria-pressed", String(this.ccOn));
    this.capEl.hidden = !this.ccOn;
  }

  // ---------- recording (hosts and the site Owner; saved to this device) ----------
  drawRecBtn() {
    if (!this.recBtn) return;
    this.recBtn.replaceChildren(h("span", { class: `st-rec-dot${this.recorder ? " on" : ""}` }), this.recorder ? `Stop recording ${this.recClock || ""}` : "Record");
  }
  // opts.auto: the automatic recording of a live podcast (voice only) or a stream saved as a video. It uploads
  // to GalaxySMP and becomes an episode when the stage ends; it isn't downloaded to this device.
  async startRecording(opts = {}) {
    if (this.recorder) return;
    if (!window.MediaRecorder) { this.toast(opts.auto ? "This browser can't record, so this stage won't be saved. Try Chrome, Edge or Safari." : "This browser can't record. Try Chrome, Edge or Safari on a computer."); return; }
    const audioOnly = this.s.kind === "podcast";
    this.gate.hidden = true;
    // join the stage's sound in the background; voices are added to the recording as they arrive
    if (!this.sub) this.ensureSub().then(() => this.renderControls()).catch(() => this.toast("Couldn't connect to the speakers' voices. The recording keeps going with what this device hears."));
    // the picture: the stage drawn onto a canvas (the screen share big, or everyone's tiles), with captions
    const W = 1280, H = 720;
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    canvas.style.cssText = "position:fixed;left:-10000px;top:0;width:2px;height:2px;pointer-events:none";   // on the page (browsers only capture attached canvases reliably)
    document.body.append(canvas);
    const g = canvas.getContext("2d");
    // the sound: every speaker's voice (and yours) mixed together
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ac.createMediaStreamDestination();
    // a silent tone keeps the audio track running even before anyone speaks (otherwise some browsers record nothing)
    const hush = ac.createGain(); hush.gain.value = 0;
    const osc = ac.createOscillator(); osc.connect(hush).connect(dest); osc.start();
    ac.resume?.().catch(() => {});
    const plugged = new Set();
    const plug = () => {
      const tracks = [];
      for (const [owner, m] of this.media) if (m.audio) tracks.push([`r${owner}:${m.audio.id}`, m.audio]);
      if (this.mic) tracks.push([`me:${this.mic.id}`, this.mic]);
      for (const [key, t] of tracks) {
        if (plugged.has(key) || t.readyState !== "live") continue;
        plugged.add(key);
        try { ac.createMediaStreamSource(new MediaStream([t])).connect(dest); } catch { /* ignore */ }
      }
    };
    plug();
    const draw = () => {
      plug();
      g.fillStyle = "#0a0c1b"; g.fillRect(0, 0, W, H);
      const tiles = [...this.stageEl.querySelectorAll(".st-tile")].filter((t) => !t.classList.contains("st-tile-empty"));
      const shared = tiles.find((t) => t.classList.contains("is-screen") && t.querySelector("video")?.videoWidth);
      const box = (el, x, y, w, hh) => {
        g.save(); g.fillStyle = "#1a1f45"; g.fillRect(x, y, w, hh);
        const v = el.querySelector("video");
        const img = el.querySelector("img");
        if (v && v.videoWidth) {
          const r = Math.min(w / v.videoWidth, hh / v.videoHeight);
          const vw = v.videoWidth * r, vh = v.videoHeight * r;
          g.drawImage(v, x + (w - vw) / 2, y + (hh - vh) / 2, vw, vh);
        } else if (img && img.complete && img.naturalWidth) {
          const s = Math.min(w, hh) * 0.35;
          g.imageSmoothingEnabled = false;
          g.drawImage(img, x + (w - s) / 2, y + (hh - s) / 2 - 14, s, s);
        }
        const name = el.querySelector(".st-tile-name > span:not(.ic)")?.textContent || "";
        g.font = "600 20px system-ui, sans-serif"; g.fillStyle = "rgba(0,0,0,.55)";
        const tw = g.measureText(name).width;
        g.fillRect(x + 10, y + hh - 40, tw + 20, 30); g.fillStyle = "#fff"; g.fillText(name, x + 20, y + hh - 18);
        g.restore();
      };
      if (shared) {
        box(shared, 0, 0, W, H - 120);
        const rest = tiles.filter((t) => t !== shared).slice(0, 6);
        rest.forEach((t, i) => box(t, i * (W / 6), H - 118, W / 6 - 4, 116));
      } else if (tiles.length) {
        const cols = tiles.length > 4 ? 3 : tiles.length > 1 ? 2 : 1;
        const rows = Math.ceil(Math.min(tiles.length, 9) / cols);
        const tw = W / cols, th = H / rows;
        tiles.slice(0, 9).forEach((t, i) => box(t, (i % cols) * tw + 3, Math.floor(i / cols) * th + 3, tw - 6, th - 6));
      } else {
        g.fillStyle = "#c9d0f0"; g.font = "600 28px system-ui, sans-serif"; g.textAlign = "center";
        g.fillText(this.titleEl.textContent, W / 2, H / 2); g.textAlign = "start";
      }
      // captions (always in the recording)
      const now = Date.now();
      const caps = [...this.captions.values()].filter((c) => now - c.at < 4000).slice(-2);
      g.font = "600 26px system-ui, sans-serif"; g.textAlign = "center";
      caps.forEach((c, i) => {
        const line = `${c.username}: ${c.text}`.slice(-90);
        const y = H - 40 - (caps.length - 1 - i) * 40;
        const w = g.measureText(line).width + 28;
        g.fillStyle = "rgba(0,0,0,.7)"; g.fillRect(W / 2 - w / 2, y - 30, w, 38);
        g.fillStyle = "#fff"; g.fillText(line, W / 2, y);
      });
      g.textAlign = "start";
      // a small GalaxySMP tag in the corner
      g.font = "700 18px system-ui, sans-serif"; g.fillStyle = "rgba(255,255,255,.7)"; g.fillText("galaxymc.us · Stages", 16, 30);
    };
    const tick = setInterval(audioOnly ? plug : draw, audioOnly ? 1000 : 1000 / 24);
    const stream = audioOnly ? new MediaStream(dest.stream.getAudioTracks()) : new MediaStream([...canvas.captureStream(24).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const type = (audioOnly ? ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"] : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]).find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
    let rec;
    try { rec = new MediaRecorder(stream, audioOnly ? { mimeType: type || undefined, audioBitsPerSecond: 64_000 } : { mimeType: type || undefined, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 }); }
    catch { clearInterval(tick); ac.close(); this.toast("This browser can't record the stage."); return; }
    const chunks = [];
    const started = Date.now();
    // Upload to GalaxySMP while recording (equal-size pieces), so the Owner and staff can watch it later.
    const up = { on: false, id: null, size: 0, n: 0, buf: [], bufBytes: 0, queue: Promise.resolve(), failed: false };
    const sendPart = (blob) => {
      const n = ++up.n;
      up.queue = up.queue.then(async () => {
        if (!up.on) return;
        for (let tries = 0; tries < 3; tries++) {
          try {
            const res = await fetch(`/api/recordings/${up.id}/part?n=${n}`, { method: "PUT", body: blob, credentials: "same-origin", headers: { "Content-Type": "application/octet-stream" } });
            if (res.status === 507) { up.on = false; this.toast("GalaxySMP's recording storage is full. The rest saves to your device only."); return; }
            if (res.ok) return;
          } catch { /* try again */ }
          await new Promise((r) => setTimeout(r, 1500 * (tries + 1)));
        }
        up.on = false; up.failed = true;
      });
    };
    const takeParts = (final) => {
      if (!up.on) return;
      while (up.bufBytes >= up.size || (final && up.bufBytes > 0)) {
        const all = new Blob(up.buf);
        const piece = all.slice(0, Math.min(up.size, all.size));
        const rest = all.slice(piece.size);
        up.buf = rest.size ? [rest] : []; up.bufBytes = rest.size;
        sendPart(piece);
      }
    };
    postJson("/api/recordings/start", { streamId: this.s.id, mime: rec.mimeType || type, publish: Boolean(opts.auto) }).then((r) => {
      up.id = r.id;
      if (r.upload) { up.on = true; up.size = r.partBytes; takeParts(false); }
      else if (r.reason) this.toast(r.reason);
    }).catch(() => {});
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      up.buf.push(e.data); up.bufBytes += e.data.size;
      if (up.on) takeParts(false);
    };
    rec.onstop = () => {
      clearInterval(tick); clearInterval(this.recClockTimer); canvas.remove();
      ac.close().catch(() => {});
      const blob = new Blob(chunks, { type: rec.mimeType || (audioOnly ? "audio/webm" : "video/webm") });
      const ext = /mp4/.test(blob.type) ? (audioOnly ? "m4a" : "mp4") : "webm";
      const name = `${this.titleEl.textContent.replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "stage"} ${new Date(started).toISOString().slice(0, 10)}.${ext}`;
      // a recording that isn't uploading (storage full, or a manual recording) is saved to this device
      if (!opts.auto || !up.on) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      }
      // finish the upload (the last piece can be smaller)
      takeParts(true);
      const seconds = Math.round((Date.now() - started) / 1000);
      up.queue.then(() => (up.id ? postJson(`/api/recordings/${up.id}/finish`, { seconds }) : null)).then((r) => {
        if (opts.auto) this.toast(r?.episode ? (audioOnly ? "Your podcast was saved as an episode." : "Your stream was saved. It's in Live > Watch again.") : `It couldn't be saved on GalaxySMP, so it was saved to this device: ${name}`);
        else this.toast(r?.uploaded ? `Recording saved to this device and uploaded to GalaxySMP.` : `Recording saved: ${name}`);
      }).catch(() => this.toast(`Recording saved: ${name}`));
    };
    rec.start(1000);
    this.recorder = rec;
    this.recClock = "0:00";
    this.recClockTimer = setInterval(() => { const s = Math.floor((Date.now() - started) / 1000); this.recClock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; this.drawRecBtn(); }, 1000);
    this.request("record", { on: true }).catch(() => {});
    this.drawRecBtn();
    this.toast(opts.auto ? (audioOnly ? "Recording your podcast. Keep this page open so it's saved when it ends." : "Saving your stream as a video. Keep this page open.") : "Recording. Everyone on the stage can see that you're recording.");
  }
  stopRecording() {
    const rec = this.recorder;
    this.recorder = null;
    try { rec?.stop(); } catch { /* ignore */ }
    if (!this.closed) this.request("record", { on: false }).catch(() => {});
    this.drawRecBtn();
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
  settingsDialog() {
    const input = h("input", { class: "input", id: "st-edit-title", maxlength: 80 });
    input.value = this.titleEl.textContent;
    const speak = h("select", { class: "input", id: "st-edit-speak" }, h("option", { value: "hand", text: "Anyone can ask (raise hand)" }), h("option", { value: "invite", text: "Invite only" }));
    speak.value = this.info.speakMode || "hand";
    const chat = h("select", { class: "input", id: "st-edit-chat" }, h("option", { value: "on", text: "On" }), h("option", { value: "off", text: "Off (only hosts)" }));
    chat.value = this.info.chatOn === false ? "off" : "on";
    openDialog({ title: "Stage settings", body: h("div", { class: "form" }, field("Title", input), field("Who can speak", speak), field("Live chat", chat)),
      actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => {
        await postJson("/api/streams", { action: "edit", id: this.s.id, title: input.value, speakMode: speak.value, chatOn: chat.value === "on" });
        this.toast("Saved.");
      } }] });
  }
  pollDialog() {
    const q = h("input", { class: "input", id: "st-poll-q", maxlength: 120, placeholder: "e.g. What should we build next?" });
    const opts = [0, 1, 2, 3].map((i) => h("input", { class: "input", id: `st-poll-o${i}`, maxlength: 40, placeholder: i < 2 ? `Answer ${i + 1}` : `Answer ${i + 1} (optional)` }));
    openDialog({ title: "Ask a poll", body: h("div", { class: "form" }, field("Question", q), ...opts.map((o, i) => field(i === 0 ? "Answers" : "", o)),
      h("p", { class: "text-3 small", style: "margin:0", text: "Everyone on the stage can vote and see the results live. A new poll replaces the old one." })),
      actions: [{ label: "Cancel" }, { label: "Ask", kind: "primary", onClick: async () => {
        await this.request("poll.start", { q: q.value, options: opts.map((o) => o.value.trim()).filter(Boolean) });
      } }] });
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
    if (this.recorder) this.stopRecording();   // the file still saves
    this.stopPublishing?.();
    try { this.sub?.close(); } catch { /* ignore */ }
    try { this.ws?.close(1000, "bye"); } catch { /* ignore */ }
    this.audioBox?.querySelectorAll("audio").forEach((a) => { a.srcObject = null; });
  }
}
