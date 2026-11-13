// 3D view of the live map: the same colours as the flat map, but every column of the world stands at its
// real height, drawn as blocks (like a diorama of the world around where you're looking). Plain WebGL,
// no libraries. Drag to turn, two fingers (or right-drag / Shift-drag) to move, pinch or wheel to zoom.
// Players, spawn and plots are drawn on a 2D layer on top. Heights come from plugin 2.42+, so places
// nobody has visited since then aren't in 3D yet.

const WINDOW = 256;          // blocks across the area drawn in 3D
const REBUILD_AT = 72;       // rebuild once the view moves this far from the middle of the drawn area
const SKY = [0.66, 0.79, 0.92];

// ---------- small matrix helpers (column-major, like WebGL) ----------
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(e, t, up) {
  let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

// ---------- a growing vertex buffer ----------
class Mesh {
  constructor() { this.n = 0; this.cap = 1 << 16; this.alloc(); }
  alloc(old) {
    const p = new Float32Array(this.cap * 3), nr = new Int8Array(this.cap * 3), c = new Uint8Array(this.cap * 3);
    if (old) { p.set(old.p); nr.set(old.nr); c.set(old.c); }
    Object.assign(this, { p, nr, c });
  }
  vert(x, y, z, nx, ny, nz, r, g, b) {
    if (this.n >= this.cap) { const old = { p: this.p, nr: this.nr, c: this.c }; this.cap *= 2; this.alloc(old); }
    const i = this.n++ * 3;
    this.p[i] = x; this.p[i + 1] = y; this.p[i + 2] = z;
    this.nr[i] = nx; this.nr[i + 1] = ny; this.nr[i + 2] = nz;
    this.c[i] = r; this.c[i + 1] = g; this.c[i + 2] = b;
  }
  // a quad from 4 corners (counter-clockwise seen from the front)
  quad(a, b, c, d, n, col) {
    for (const v of [a, b, c, a, c, d]) this.vert(v[0], v[1], v[2], n[0], n[1], n[2], col[0], col[1], col[2]);
  }
}

const VS = `
attribute vec3 p; attribute vec3 n; attribute vec3 c;
uniform mat4 mvp; uniform vec3 eye; uniform float fogStart; uniform float fogEnd;
varying vec3 vc; varying float vf;
void main() {
  vec3 L = normalize(vec3(0.45, 0.85, 0.3));
  float light = 0.58 + 0.42 * max(dot(n, L), 0.0) + (n.y < -0.5 ? -0.2 : 0.0);
  vc = c * light;
  vf = clamp((length(p - eye) - fogStart) / (fogEnd - fogStart), 0.0, 1.0);
  gl_Position = mvp * vec4(p, 1.0);
}`;
const FS = `
precision mediump float;
uniform vec3 fog; varying vec3 vc; varying float vf;
void main() { gl_FragColor = vec4(mix(vc, fog, vf * vf), 1.0); }`;

export function createMap3D({ stage, info: getInfo, head, onPlotTap }) {
  const canvas = document.createElement("canvas");
  canvas.className = "map3d-gl";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "3D map. Drag to turn, two fingers to move, pinch to zoom.");
  const layer = document.createElement("canvas");
  layer.className = "map3d-layer";
  layer.setAttribute("aria-hidden", "true");
  const note = document.createElement("div");
  note.className = "map3d-note";
  note.hidden = true;
  const hint = document.createElement("div");
  hint.className = "map3d-hint";
  hint.textContent = matchMedia("(pointer: coarse)").matches ? "Drag to turn · two fingers to move · pinch to zoom" : "Drag to turn · right-drag or Shift-drag to move · scroll to zoom";
  hint.hidden = true;
  stage.append(canvas, layer, note, hint);
  const g2 = layer.getContext("2d");
  const gl = canvas.getContext("webgl", { antialias: true }) || canvas.getContext("experimental-webgl");
  if (!gl) return null;

  // ---------- GL setup ----------
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const loc = { p: gl.getAttribLocation(prog, "p"), n: gl.getAttribLocation(prog, "n"), c: gl.getAttribLocation(prog, "c") };
  const uni = (k) => gl.getUniformLocation(prog, k);
  const U = { mvp: uni("mvp"), eye: uni("eye"), fog: uni("fog"), fogStart: uni("fogStart"), fogEnd: uni("fogEnd") };
  const buf = { p: gl.createBuffer(), n: gl.createBuffer(), c: gl.createBuffer() };
  let count = 0;
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);

  // ---------- data ----------
  const regions = new Map(); // "rx,rz" -> { v, rgba, h } | { v, loading }
  const size = () => getInfo().regionSize || 256;
  async function loadRegion(r) {
    const key = `${r.rx},${r.rz}`;
    const have = regions.get(key);
    if (have && (have.v === r.v || have.loading)) return have.rgba ? false : null;
    regions.set(key, { ...(have || {}), v: r.v, loading: true });
    try {
      const [a, b] = await Promise.all([
        fetch(`/api/map/region/${r.rx}/${r.rz}?v=${r.v}`).then((x) => x.arrayBuffer()),
        fetch(`/api/map/heights/${r.rx}/${r.rz}?v=${r.v}`).then((x) => x.arrayBuffer()),
      ]);
      regions.set(key, { v: r.v, rgba: new Uint8Array(a), h: new Uint16Array(b), loading: false });
      return true;
    } catch {
      regions.set(key, { v: 0, loading: false });
      return false;
    }
  }
  function column(x, z) {  // [top y + 1, r, g, b] or null
    const S = size(), rx = Math.floor(x / S), rz = Math.floor(z / S);
    const rg = regions.get(`${rx},${rz}`);
    if (!rg?.h) return null;
    const i = (z - rz * S) * S + (x - rx * S);
    const hv = rg.h[i];
    if (!hv || !rg.rgba[i * 4 + 3]) return null;
    return [hv - 64, rg.rgba[i * 4], rg.rgba[i * 4 + 1], rg.rgba[i * 4 + 2]];
  }
  const groundAt = (x, z) => column(Math.floor(x), Math.floor(z))?.[0] ?? null;

  // ---------- building the blocks ----------
  let win = null;  // { ox, oz, base, cols }
  function build(cx, cz) {
    const ox = Math.floor(cx) - WINDOW / 2, oz = Math.floor(cz) - WINDOW / 2;
    const cols = new Array(WINDOW * WINDOW);
    let lo = Infinity, any = 0;
    for (let z = 0; z < WINDOW; z++) for (let x = 0; x < WINDOW; x++) {
      const c = column(ox + x, oz + z);
      cols[z * WINDOW + x] = c;
      if (c) { any++; if (c[0] < lo) lo = c[0]; }
    }
    const base = any ? lo - 4 : 60;
    const m = new Mesh();
    const at = (x, z) => (x < 0 || z < 0 || x >= WINDOW || z >= WINDOW ? null : cols[z * WINDOW + x]);
    for (let z = 0; z < WINDOW; z++) {
      // tops: runs of the same height and colour become one long quad
      let x = 0;
      while (x < WINDOW) {
        const c = at(x, z);
        if (!c) { x++; continue; }
        let e = x + 1;
        while (e < WINDOW) {
          const d = at(e, z);
          if (!d || d[0] !== c[0] || d[1] !== c[1] || d[2] !== c[2] || d[3] !== c[3]) break;
          e++;
        }
        const y = c[0];
        m.quad([x, y, z + 1], [e, y, z + 1], [e, y, z], [x, y, z], [0, 127, 0], [c[1], c[2], c[3]]);
        x = e;
      }
      // sides: walls wherever the neighbour is lower (or not mapped: down to the bottom of the diorama)
      for (let x2 = 0; x2 < WINDOW; x2++) {
        const c = at(x2, z);
        if (!c) continue;
        const y = c[0];
        const col = [c[1] * 0.86, c[2] * 0.86, c[3] * 0.86];
        const down = (n) => (n ? n[0] : base);
        let ny = down(at(x2 + 1, z));
        if (ny < y) m.quad([x2 + 1, ny, z + 1], [x2 + 1, ny, z], [x2 + 1, y, z], [x2 + 1, y, z + 1], [127, 0, 0], col);
        ny = down(at(x2 - 1, z));
        if (ny < y) m.quad([x2, ny, z], [x2, ny, z + 1], [x2, y, z + 1], [x2, y, z], [-127, 0, 0], col);
        ny = down(at(x2, z + 1));
        if (ny < y) m.quad([x2, ny, z + 1], [x2 + 1, ny, z + 1], [x2 + 1, y, z + 1], [x2, y, z + 1], [0, 0, 127], col);
        ny = down(at(x2, z - 1));
        if (ny < y) m.quad([x2 + 1, ny, z], [x2, ny, z], [x2, y, z], [x2 + 1, y, z], [0, 0, -127], col);
      }
    }
    count = m.n;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.p); gl.bufferData(gl.ARRAY_BUFFER, m.p.subarray(0, m.n * 3), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.n); gl.bufferData(gl.ARRAY_BUFFER, m.nr.subarray(0, m.n * 3), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.c); gl.bufferData(gl.ARRAY_BUFFER, m.c.subarray(0, m.n * 3), gl.STATIC_DRAW);
    win = { ox, oz, base, cols, cx, cz, any };
    note.hidden = any > 0;
    note.textContent = "This area isn't in 3D yet. The 3D map fills in as players explore after the latest server update.";
    dirty = true;
  }

  async function ensure(force = false) {
    const S = size();
    const x0 = Math.floor((cam.tx - WINDOW / 2) / S), x1 = Math.floor((cam.tx + WINDOW / 2) / S);
    const z0 = Math.floor((cam.tz - WINDOW / 2) / S), z1 = Math.floor((cam.tz + WINDOW / 2) / S);
    const wanted = getInfo().regions.filter((r) => r.rx >= x0 && r.rx <= x1 && r.rz >= z0 && r.rz <= z1);
    const changed = (await Promise.all(wanted.map(loadRegion))).some(Boolean);
    const far = !win || Math.abs(cam.tx - win.cx) > REBUILD_AT || Math.abs(cam.tz - win.cz) > REBUILD_AT;
    if (force || changed || far) build(cam.tx, cam.tz);
    const gy = groundAt(cam.tx, cam.tz);
    if (gy != null) { cam.ty += (gy - cam.ty) * 0.5; dirty = true; }
  }
  let ensureTimer = null;
  const ensureSoon = () => { clearTimeout(ensureTimer); ensureTimer = setTimeout(() => ensure(), 250); };

  // ---------- camera ----------
  const cam = { tx: 0, ty: 64, tz: 0, yaw: -0.7, pitch: 0.75, dist: 160 };
  let dirty = true, active = false, mvp = null, eye = [0, 0, 0];
  function matrices() {
    const w = canvas.width, h = canvas.height;
    const cp = Math.cos(cam.pitch);
    eye = [cam.tx + Math.sin(cam.yaw) * cp * cam.dist, cam.ty + Math.sin(cam.pitch) * cam.dist, cam.tz + Math.cos(cam.yaw) * cp * cam.dist];
    const proj = perspective(50 * Math.PI / 180, w / Math.max(1, h), 1, 3000);
    mvp = mul(proj, lookAt(eye, [cam.tx, cam.ty, cam.tz], [0, 1, 0]));
  }
  function project(x, y, z) {  // world -> screen pixels (device), or null when behind the camera
    const v = [x, y, z, 1];
    const o = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) o[r] = mvp[r] * v[0] + mvp[4 + r] * v[1] + mvp[8 + r] * v[2] + mvp[12 + r];
    if (o[3] <= 0.5) return null;
    return [(o[0] / o[3] * 0.5 + 0.5) * canvas.width, (1 - (o[1] / o[3] * 0.5 + 0.5)) * canvas.height, o[3]];
  }

  function draw() {
    dirty = false;
    matrices();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(SKY[0], SKY[1], SKY[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (win && count) {
      // the mesh is in window coordinates: shift by the window origin
      const shift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, win.ox, 0, win.oz, 1];
      gl.uniformMatrix4fv(U.mvp, false, new Float32Array(mul(mvp, shift)));
      gl.uniform3f(U.eye, eye[0] - win.ox, eye[1], eye[2] - win.oz);
      gl.uniform3f(U.fog, SKY[0], SKY[1], SKY[2]);
      gl.uniform1f(U.fogStart, cam.dist * 0.9);
      gl.uniform1f(U.fogEnd, cam.dist * 0.9 + WINDOW * 0.9);
      const attr = (b, l, type, norm) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, type, norm, 0, 0); };
      attr(buf.p, loc.p, gl.FLOAT, false);
      attr(buf.n, loc.n, gl.BYTE, true);
      attr(buf.c, loc.c, gl.UNSIGNED_BYTE, true);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    }
    drawLayer();
  }

  // ---------- players, spawn and plots on top ----------
  const inWin = (x, z) => win && x >= win.ox && z >= win.oz && x < win.ox + WINDOW && z < win.oz + WINDOW;
  const yAt = (x, z) => groundAt(x, z) ?? cam.ty;
  function label(text, x, y, px) {
    const dpr = window.devicePixelRatio || 1;
    g2.font = `600 ${px * dpr}px Inter, system-ui, sans-serif`;
    g2.textAlign = "center";
    g2.lineWidth = 3 * dpr;
    g2.strokeStyle = "rgba(5, 7, 18, .85)";
    g2.strokeText(text, x, y);
    g2.fillStyle = "#fff";
    g2.fillText(text, x, y);
  }
  let plotShapes = [];
  function drawLayer() {
    const dpr = window.devicePixelRatio || 1;
    g2.clearRect(0, 0, layer.width, layer.height);
    const info = getInfo();
    plotShapes = [];
    for (const p of info.plots) {
      if (!drawable(p)) continue;
      const x1 = Math.min(p.x1, p.x2), x2 = Math.max(p.x1, p.x2) + 1, z1 = Math.min(p.z1, p.z2), z2 = Math.max(p.z1, p.z2) + 1;
      if (!inWin(x1, z1) && !inWin(x2 - 1, z2 - 1)) continue;
      const pts = [[x1, z1], [x2, z1], [x2, z2], [x1, z2]].map(([x, z]) => project(x, yAt(Math.min(x, x2 - 1), Math.min(z, z2 - 1)) + 0.6, z));
      if (pts.some((q) => !q)) continue;
      const col = plotColor(p);
      g2.beginPath();
      pts.forEach((q, i) => (i ? g2.lineTo(q[0], q[1]) : g2.moveTo(q[0], q[1])));
      g2.closePath();
      g2.fillStyle = col.replace(/[\d.]+\)$/, p.public ? ".22)" : ".12)");
      g2.fill();
      g2.lineWidth = 2 * dpr;
      g2.strokeStyle = col;
      g2.stroke();
      plotShapes.push({ p, pts });
      const text = p.kind === "plot" ? (p.public ? p.label || `${p.owner}'s plot` : p.mine ? "Your plot (private)" : "") : p.label;
      const w = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      if (text && w > 60 * dpr) label(text, (pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2, 11);
    }
    for (const m of info.markers) {
      if (!inWin(m.x, m.z)) continue;
      const q = project(m.x, yAt(m.x, m.z) + 3, m.z);
      if (!q) continue;
      g2.fillStyle = "#fff"; g2.beginPath(); g2.arc(q[0], q[1], 7 * dpr, 0, Math.PI * 2); g2.fill();
      g2.fillStyle = "#8a5cff"; g2.beginPath(); g2.arc(q[0], q[1], 4.5 * dpr, 0, Math.PI * 2); g2.fill();
      label(m.label, q[0], q[1] - 14 * dpr, 12);
    }
    for (const p of info.players) {
      if (!inWin(p.x, p.z)) continue;
      const q = project(p.x, yAt(p.x, p.z) + 3, p.z);
      if (!q) continue;
      const s = 22 * dpr;
      g2.fillStyle = "rgba(0,0,0,.55)";
      g2.fillRect(q[0] - s / 2 - 2 * dpr, q[1] - s - 2 * dpr, s + 4 * dpr, s + 4 * dpr);
      const img = head(p);
      if (img.complete && img.naturalWidth) { g2.imageSmoothingEnabled = false; g2.drawImage(img, q[0] - s / 2, q[1] - s, s, s); }
      label(p.name, q[0], q[1] + 14 * dpr, 12);
    }
  }
  const inside = (pt, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };

  // ---------- input ----------
  const pointers = new Map();
  let gesture = null, downAt = null;
  const pan = (dx, dy) => {  // screen pixels -> move along the ground
    const k = cam.dist / 600;
    const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
    cam.tx -= (dx * c + dy * s) * k * 1.4;
    cam.tz -= (-dx * s + dy * c) * k * 1.4;
    dirty = true;
    ensureSoon();
  };
  const rotate = (dx, dy) => {
    cam.yaw -= dx * 0.008;
    cam.pitch = Math.min(1.45, Math.max(0.12, cam.pitch + dy * 0.006));
    dirty = true;
  };
  const zoomBy = (f) => { cam.dist = Math.min(600, Math.max(18, cam.dist / f)); dirty = true; };
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
    downAt = pointers.size === 1 ? { x: e.clientX, y: e.clientY } : null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { ...prev, x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && gesture) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ang = Math.atan2(b.y - a.y, b.x - a.x);
      zoomBy(d / gesture.d);
      pan(mx - gesture.mx, my - gesture.my);
      cam.yaw += ang - gesture.ang;
      gesture = { d, mx, my, ang };
      return;
    }
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    if (prev.button === 2 || prev.shift) pan(dx, dy); else rotate(dx, dy);
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) gesture = null;
    if (e.type === "pointerup" && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) {
      const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const pt = [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
      const hit = plotShapes.find((s) => inside(pt, s.pts));
      if (hit) onPlotTap(hit.p);
    }
    downAt = null;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  canvas.addEventListener("keydown", (e) => {
    const k = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[e.key];
    if (k) { (e.shiftKey ? rotate : pan)(k[0], k[1]); e.preventDefault(); }
    else if (e.key === "+" || e.key === "=") { zoomBy(1.3); e.preventDefault(); }
    else if (e.key === "-" || e.key === "_") { zoomBy(1 / 1.3); e.preventDefault(); }
  });

  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [canvas, layer]) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    dirty = true;
  }
  new ResizeObserver(resize).observe(canvas);

  function loop() {
    if (!active) return;
    if (dirty) draw();
    requestAnimationFrame(loop);
  }

  return {
    show(x, z) {
      active = true;
      for (const c of [canvas, layer]) c.hidden = false;
      cam.tx = x; cam.tz = z;
      resize();
      ensure(true);
      canvas.focus({ preventScroll: true });
      hint.hidden = false;
      hint.classList.remove("fade");
      clearTimeout(hint.t);
      hint.t = setTimeout(() => hint.classList.add("fade"), 4500);
      requestAnimationFrame(loop);
    },
    hide() {
      active = false;
      note.hidden = true;
      hint.hidden = true;
      for (const c of [canvas, layer]) c.hidden = true;
      return { x: cam.tx, z: cam.tz };
    },
    goTo(x, z) { cam.tx = x; cam.tz = z; dirty = true; ensure(); },
    zoom(f) { zoomBy(f); },
    update() { dirty = true; ensureSoon(); },
    get target() { return { x: cam.tx, z: cam.tz }; },
  };
}

// shared with the flat map
const COLORS = { plot: "rgba(109, 220, 140, .9)", shop: "rgba(255, 196, 60, .95)", area: "rgba(111, 170, 255, .9)", public: "rgba(190, 140, 255, .95)", mine: "rgba(220, 225, 240, .8)" };
const drawable = (p) => p.kind !== "plot" || p.available || p.public || p.mine;
const plotColor = (p) => (p.kind !== "plot" ? COLORS[p.kind] || COLORS.plot : p.public ? COLORS.public : p.mine ? COLORS.mine : COLORS.plot);
