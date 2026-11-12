// Live server map: regions of 256 x 256 blocks drawn by the server, plus plots, shops, spawn and
// the heads of online players. Drag (or arrow keys) to move, wheel/pinch (or + and -) to zoom.
import "/js/site.js";
import { faceSvg } from "/js/face.js";

const $ = (id) => document.getElementById(id);
const canvas = $("map-view");
const g = canvas.getContext("2d");
const view = { x: 0, z: 0, scale: 2 };  // centre (blocks) and pixels per block
const MIN = 0.25, MAX = 12;
let info = { regions: [], players: [], markers: [], plots: [], regionSize: 256 };
const regions = new Map();      // "rx,rz" -> { v, img (canvas) | null, loading }
const heads = new Map();        // xuid -> Image
let follow = null;
let firstLoad = true;
let dirty = true;

const COLORS = { plot: "rgba(109, 220, 140, .9)", shop: "rgba(255, 196, 60, .95)", area: "rgba(111, 170, 255, .9)" };

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  dirty = true;
}
const toScreen = (x, z) => {
  const dpr = window.devicePixelRatio || 1;
  return [canvas.width / 2 + (x - view.x) * view.scale * dpr, canvas.height / 2 + (z - view.z) * view.scale * dpr];
};
const toWorld = (sx, sy) => {
  const dpr = window.devicePixelRatio || 1;
  return [view.x + (sx * dpr - canvas.width / 2) / (view.scale * dpr), view.z + (sy * dpr - canvas.height / 2) / (view.scale * dpr)];
};

async function loadRegion(r) {
  const key = `${r.rx},${r.rz}`;
  const have = regions.get(key);
  if (have && (have.v === r.v || have.loading)) return;
  regions.set(key, { v: r.v, img: have?.img || null, loading: true });
  try {
    const buf = await fetch(`/api/map/region/${r.rx}/${r.rz}?v=${r.v}`).then((x) => x.arrayBuffer());
    const size = info.regionSize;
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(buf), size, size), 0, 0);
    regions.set(key, { v: r.v, img: c, loading: false });
    dirty = true;
  } catch {
    regions.set(key, { v: 0, img: have?.img || null, loading: false });
  }
}

function visibleRegions() {
  const size = info.regionSize;
  const [x0, z0] = toWorld(0, 0);
  const r = canvas.getBoundingClientRect();
  const [x1, z1] = toWorld(r.width, r.height);
  return info.regions.filter((rg) => rg.rx * size < x1 && (rg.rx + 1) * size > x0 && rg.rz * size < z1 && (rg.rz + 1) * size > z0);
}

function head(p) {
  let img = heads.get(p.xuid);
  if (!img) {
    img = new Image();
    img.onload = () => { dirty = true; };
    img.onerror = () => { img.onerror = null; img.src = faceSvg(p.name); };
    img.src = p.xuid ? `/api/head/${p.xuid}` : faceSvg(p.name);
    heads.set(p.xuid, img);
  }
  return img;
}

function draw() {
  dirty = false;
  const dpr = window.devicePixelRatio || 1;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#0b0e1f";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingEnabled = view.scale < 1;
  const size = info.regionSize;
  for (const rg of visibleRegions()) {
    loadRegion(rg);
    const have = regions.get(`${rg.rx},${rg.rz}`);
    if (!have?.img) continue;
    const [sx, sy] = toScreen(rg.rx * size, rg.rz * size);
    g.drawImage(have.img, Math.floor(sx), Math.floor(sy), Math.ceil(size * view.scale * dpr) + 1, Math.ceil(size * view.scale * dpr) + 1);
  }
  // plots and shops
  g.lineWidth = Math.max(1, dpr * (view.scale >= 2 ? 2 : 1));
  for (const p of info.plots) {
    const [ax, az] = toScreen(Math.min(p.x1, p.x2), Math.min(p.z1, p.z2));
    const [bx, bz] = toScreen(Math.max(p.x1, p.x2) + 1, Math.max(p.z1, p.z2) + 1);
    if (bx < 0 || bz < 0 || ax > canvas.width || az > canvas.height) continue;
    g.strokeStyle = COLORS[p.kind] || COLORS.plot;
    g.fillStyle = (COLORS[p.kind] || COLORS.plot).replace(/[\d.]+\)$/, ".12)");
    g.fillRect(ax, az, bx - ax, bz - az);
    g.strokeRect(ax, az, bx - ax, bz - az);
    if (p.label && view.scale >= 1.5 && bx - ax > 60 * dpr) label(p.label, (ax + bx) / 2, az + 14 * dpr, 11);
  }
  // spawn and other markers
  for (const m of info.markers) {
    const [x, y] = toScreen(m.x, m.z);
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(x, y, 7 * dpr, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#8a5cff";
    g.beginPath(); g.arc(x, y, 4.5 * dpr, 0, Math.PI * 2); g.fill();
    label(m.label, x, y - 14 * dpr, 12);
  }
  // players (heads), drawn last so they sit on top
  for (const p of info.players) {
    const [x, y] = toScreen(p.x, p.z);
    const s = 22 * dpr;
    g.fillStyle = "rgba(0,0,0,.55)";
    g.fillRect(x - s / 2 - 2 * dpr, y - s / 2 - 2 * dpr, s + 4 * dpr, s + 4 * dpr);
    const img = head(p);
    if (img.complete && img.naturalWidth) { g.imageSmoothingEnabled = false; g.drawImage(img, x - s / 2, y - s / 2, s, s); }
    label(p.name, x, y + s / 2 + 14 * dpr, 12);
  }
  $("map-empty").hidden = info.regions.length > 0;
}

function label(text, x, y, px) {
  const dpr = window.devicePixelRatio || 1;
  g.font = `600 ${px * dpr}px Inter, system-ui, sans-serif`;
  g.textAlign = "center";
  g.lineWidth = 3 * dpr;
  g.strokeStyle = "rgba(5, 7, 18, .85)";
  g.strokeText(text, x, y);
  g.fillStyle = "#fff";
  g.fillText(text, x, y);
}

function loop() {
  if (follow) {
    const p = info.players.find((q) => q.name === follow);
    if (p && (Math.abs(p.x - view.x) > 0.5 || Math.abs(p.z - view.z) > 0.5)) { view.x += (p.x - view.x) * 0.2; view.z += (p.z - view.z) * 0.2; dirty = true; }
  }
  if (dirty) draw();
  requestAnimationFrame(loop);
}

function goTo(x, z, scale) {
  view.x = x; view.z = z;
  if (scale) view.scale = scale;
  dirty = true;
}

function zoom(f, sx, sy) {
  const r = canvas.getBoundingClientRect();
  sx ??= r.width / 2; sy ??= r.height / 2;
  const [wx, wz] = toWorld(sx, sy);
  view.scale = Math.min(MAX, Math.max(MIN, view.scale * f));
  const [nx, nz] = toWorld(sx, sy);
  view.x += wx - nx; view.z += wz - nz;
  dirty = true;
}

// ---------- side lists ----------
function sideButton(text, sub, onClick, img) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "map-item";
  if (img) b.append(img);
  const t = document.createElement("span");
  const n = document.createElement("b"); n.textContent = text;
  t.append(n);
  if (sub) { const s = document.createElement("small"); s.textContent = sub; t.append(s); }
  b.append(t);
  b.addEventListener("click", onClick);
  return b;
}

function renderSide() {
  $("map-online-n").textContent = info.players.length ? String(info.players.length) : "";
  const pl = $("map-players");
  pl.replaceChildren(...(info.players.length ? info.players.map((p) => {
    const img = document.createElement("img");
    img.className = "map-face"; img.alt = ""; img.width = 24; img.height = 24;
    img.src = p.xuid ? `/api/head/${p.xuid}` : faceSvg(p.name);
    img.onerror = () => { img.onerror = null; img.src = faceSvg(p.name); };
    const b = sideButton(p.name, follow === p.name ? "Following · tap to stop" : `${Math.round(p.x)}, ${Math.round(p.z)}`, () => {
      follow = follow === p.name ? null : p.name;
      if (follow) goTo(p.x, p.z, Math.max(view.scale, 3));
      renderSide();
      closeSide();
    }, img);
    if (follow === p.name) b.classList.add("on");
    return b;
  }) : [Object.assign(document.createElement("p"), { className: "text-3 small", textContent: "Nobody is online in the Overworld." })]));
  const places = [
    ...info.markers.map((m) => ({ name: m.label, sub: "Spawn", x: m.x, z: m.z })),
    ...info.plots.filter((p) => p.label).map((p) => ({ name: p.label, sub: p.kind === "shop" ? `Shop${p.owner ? ` · ${p.owner}` : ""}` : p.kind === "area" ? "Area" : `Plot · ${p.owner}`, x: (p.x1 + p.x2) / 2, z: (p.z1 + p.z2) / 2 })),
  ];
  $("map-places").replaceChildren(...(places.length ? places.slice(0, 60).map((p) => sideButton(p.name, p.sub, () => { follow = null; goTo(p.x, p.z, Math.max(view.scale, 2.5)); closeSide(); })) :
    [Object.assign(document.createElement("p"), { className: "text-3 small", textContent: "No places yet." })]));
  const at = info.playersAt ? new Date(info.playersAt) : null;
  $("map-sub").textContent = info.regions.length ? `${info.regions.reduce((n, r) => n + r.chunks, 0).toLocaleString()} chunks mapped${at ? ` · live` : ""}. The world fills in as players explore.` : "The world fills in as players explore.";
}

async function refresh() {
  try {
    const d = await fetch("/api/map/info").then((r) => r.json());
    if (!d.ok) return;
    info = d;
    if (firstLoad) {
      firstLoad = false;
      const spawn = d.markers.find((m) => m.kind === "spawn");
      const p = d.players[0];
      if (spawn) goTo(spawn.x, spawn.z, 2);
      else if (p) goTo(p.x, p.z, 2);
      else if (d.regions.length) {
        const r = d.regions.reduce((a, b) => (b.chunks > a.chunks ? b : a));
        goTo((r.rx + 0.5) * d.regionSize, (r.rz + 0.5) * d.regionSize, 1);
      }
    }
    renderSide();
    dirty = true;
  } catch { /* try again next time */ }
}

// ---------- input ----------
const pointers = new Map();
let pinch = null;
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
  }
});
canvas.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect();
  const [wx, wz] = toWorld(e.clientX - r.left, e.clientY - r.top);
  $("map-coords").textContent = `X ${Math.floor(wx)}  Z ${Math.floor(wz)}`;
  hover(e.clientX - r.left, e.clientY - r.top, wx, wz);
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  if (pointers.size === 2 && pinch) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pointers.values()];
    const f = (pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d) / view.scale;
    zoom(f, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    return;
  }
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (dx || dy) { follow = null; view.x -= dx / view.scale; view.z -= dy / view.scale; dirty = true; }
});
const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
canvas.addEventListener("pointerup", up);
canvas.addEventListener("pointercancel", up);
canvas.addEventListener("pointerleave", () => { $("map-tip").hidden = true; });
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
canvas.addEventListener("keydown", (e) => {
  const step = 60 / view.scale;
  const keys = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (keys[e.key]) { follow = null; view.x += keys[e.key][0]; view.z += keys[e.key][1]; dirty = true; e.preventDefault(); }
  else if (e.key === "+" || e.key === "=") { zoom(1.4); e.preventDefault(); }
  else if (e.key === "-" || e.key === "_") { zoom(1 / 1.4); e.preventDefault(); }
});

// Hover: who owns the plot under the pointer.
function hover(sx, sy, wx, wz) {
  const tip = $("map-tip");
  const p = info.players.find((q) => Math.abs(q.x - wx) * view.scale < 14 && Math.abs(q.z - wz) * view.scale < 14);
  const plot = !p && info.plots.find((q) => wx >= Math.min(q.x1, q.x2) && wx <= Math.max(q.x1, q.x2) + 1 && wz >= Math.min(q.z1, q.z2) && wz <= Math.max(q.z1, q.z2) + 1);
  const lines = p ? [p.name, "Online now"] : plot ? [plot.label || (plot.owner ? `${plot.owner}'s plot` : "Unclaimed plot"), plot.kind === "shop" ? "Shop plot" : plot.kind === "area" ? "Protected area" : plot.owner ? `Owner: ${plot.owner}` : "Free to claim"] : null;
  if (!lines) { tip.hidden = true; return; }
  tip.replaceChildren(...lines.map((l, i) => Object.assign(document.createElement(i ? "span" : "b"), { textContent: l })));
  tip.style.left = `${sx}px`;
  tip.style.top = `${sy}px`;
  tip.hidden = false;
}

$("map-zoom-in").addEventListener("click", () => zoom(1.5));
$("map-zoom-out").addEventListener("click", () => zoom(1 / 1.5));
$("map-home").addEventListener("click", () => {
  follow = null;
  const s = info.markers.find((m) => m.kind === "spawn");
  goTo(s ? s.x : 0, s ? s.z : 0, 2);
});
function closeSide() { document.body.classList.remove("map-side-open"); $("map-toggle").setAttribute("aria-expanded", "false"); }
$("map-toggle").addEventListener("click", () => {
  const open = !document.body.classList.contains("map-side-open");
  document.body.classList.toggle("map-side-open", open);
  $("map-toggle").setAttribute("aria-expanded", String(open));
});

new ResizeObserver(resize).observe(canvas);
resize();
refresh();
setInterval(refresh, 5000);
requestAnimationFrame(loop);
