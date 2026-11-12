// Small SVG charts: daily bars, a line over time and the server timeline. One series each (the
// title names it, so no legend), thin marks, recessive axes, and a hover/tap tooltip on every mark.
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
const html = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

// A tooltip shared by one chart; follows the pointer, also opens on focus/tap for keyboard and touch.
function tooltip(wrap) {
  const tip = html("div", "ch-tip");
  tip.hidden = true;
  wrap.append(tip);
  return {
    show(x, y, lines) {
      tip.replaceChildren(...lines.map((l, i) => html(i ? "span" : "b", null, l)));
      tip.hidden = false;
      const w = wrap.clientWidth;
      tip.style.left = `${Math.min(Math.max(x, 60), w - 60)}px`;
      tip.style.top = `${y}px`;
    },
    hide() { tip.hidden = true; },
  };
}

// days: [{ label, value, tip: [line1, line2] }]
// width: the pixel width it will be shown at (so text stays its normal size); defaults to 600.
export function barChart({ title, days, format, height = 150, width = 600 }) {
  const wrap = html("figure", "ch");
  wrap.append(html("figcaption", "ch-title", title));
  const W = Math.max(300, Math.round(width)), H = height, L = 44, B = 22, T = 8;
  const max = niceMax(Math.max(0, ...days.map((d) => d.value)));
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "ch-svg", role: "img", "aria-label": title });
  for (const f of [0, 0.5, 1]) {
    const y = T + (H - T - B) * (1 - f);
    svg.append(el("line", { x1: L, x2: W, y1: y, y2: y, class: f ? "ch-grid" : "ch-base" }));
    const t = el("text", { x: L - 6, y: y + 4, class: "ch-axis", "text-anchor": "end" });
    t.textContent = format(max * f);
    svg.append(t);
  }
  const n = days.length || 1;
  const slot = (W - L) / n;
  const bw = Math.max(2, Math.min(18, slot - 2));
  const tip = tooltip(wrap);
  days.forEach((d, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    const hgt = d.value > 0 ? Math.max(2, (H - T - B) * (d.value / max)) : 0;
    const y = H - B - hgt;
    if (hgt) {
      const r = Math.min(4, bw / 2, hgt);
      svg.append(el("path", { class: "ch-bar", d: `M${x},${H - B} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - B} Z` }));
    }
    const hit = el("rect", { x: L + i * slot, y: T, width: slot, height: H - T - B, class: "ch-hit", tabindex: 0, "aria-label": `${d.label}: ${d.tip[1] || ""}` });
    const show = () => tip.show(((L + i * slot + slot / 2) / W) * wrap.clientWidth, ((y - 6) / H) * svg.clientHeight + 28, d.tip);
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", () => tip.hide());
    hit.addEventListener("blur", () => tip.hide());
    svg.append(hit);
  });
  [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i && days[v]).forEach((i) => {
    const t = el("text", { x: L + i * slot + slot / 2, y: H - 6, class: "ch-axis", "text-anchor": "middle" });
    t.textContent = days[i].label;
    svg.append(t);
  });
  wrap.append(svg);
  return wrap;
}

// points: [{ label, value, tip }] evenly spaced in time order
export function lineChart({ title, points, format, height = 150, width = 600 }) {
  const wrap = html("figure", "ch");
  wrap.append(html("figcaption", "ch-title", title));
  const W = Math.max(300, Math.round(width)), H = height, L = 52, B = 22, T = 10;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const max = niceMax(hi || 1), min = lo >= 0 && lo > hi * 0.5 ? Math.floor(lo / (max / 10)) * (max / 10) : 0;
  const yOf = (v) => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  const xOf = (i) => L + ((W - L - 8) * i) / Math.max(1, points.length - 1);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "ch-svg", role: "img", "aria-label": title });
  for (const f of [0, 0.5, 1]) {
    const v = min + (max - min) * f;
    svg.append(el("line", { x1: L, x2: W, y1: yOf(v), y2: yOf(v), class: f ? "ch-grid" : "ch-base" }));
    const t = el("text", { x: L - 6, y: yOf(v) + 4, class: "ch-axis", "text-anchor": "end" });
    t.textContent = format(v);
    svg.append(t);
  }
  const d = points.map((p, i) => `${i ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ");
  svg.append(el("path", { d: `${d} L${xOf(points.length - 1)},${H - B} L${xOf(0)},${H - B} Z`, class: "ch-area" }));
  svg.append(el("path", { d, class: "ch-line" }));
  const last = points.length - 1;
  svg.append(el("circle", { cx: xOf(last), cy: yOf(points[last].value), r: 4, class: "ch-dot" }));
  const cross = el("line", { y1: T, y2: H - B, class: "ch-cross", visibility: "hidden" });
  const dot = el("circle", { r: 4.5, class: "ch-dot ch-hover", visibility: "hidden" });
  svg.append(cross, dot);
  const tip = tooltip(wrap);
  const at = (i) => {
    cross.setAttribute("x1", xOf(i)); cross.setAttribute("x2", xOf(i)); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", xOf(i)); dot.setAttribute("cy", yOf(points[i].value)); dot.setAttribute("visibility", "visible");
    tip.show((xOf(i) / W) * wrap.clientWidth, ((yOf(points[i].value) - 6) / H) * svg.clientHeight + 28, points[i].tip);
  };
  const hit = el("rect", { x: L, y: 0, width: W - L, height: H, class: "ch-hit", tabindex: 0, "aria-label": `${title}. Use the arrow keys to read values.` });
  let cur = last;
  hit.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    cur = Math.max(0, Math.min(last, Math.round(((x - L) / (W - L - 8)) * last)));
    at(cur);
  });
  const off = () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hide(); };
  hit.addEventListener("pointerleave", off);
  hit.addEventListener("focus", () => at(cur));
  hit.addEventListener("blur", off);
  hit.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { cur = Math.max(0, cur - 1); at(cur); e.preventDefault(); }
    if (e.key === "ArrowRight") { cur = Math.min(last, cur + 1); at(cur); e.preventDefault(); }
  });
  svg.append(hit);
  [0, Math.floor(last / 2), last].filter((v, i, a) => a.indexOf(v) === i).forEach((i) => {
    const t = el("text", { x: xOf(i), y: H - 6, class: "ch-axis", "text-anchor": i === 0 ? "start" : i === last ? "end" : "middle" });
    t.textContent = points[i].label;
    svg.append(t);
  });
  wrap.append(svg);
  return wrap;
}

// The server timeline, like a Realm's: a row for the server (when it was online) and one per
// player (when they played), across the last few days. Bars are one colour; identity is the row name.
export function timelineChart({ data, onName }) {
  const from = data.from, to = data.now, span = to - from;
  const wrap = html("div", "tl");
  const tip = html("div", "ch-tip");
  tip.hidden = true;
  const days = [];
  const d0 = new Date(from); d0.setHours(0, 0, 0, 0);
  for (let t = d0.getTime() + 864e5; t < to; t += 864e5) days.push(t);
  const pct = (t) => `${(Math.max(0, Math.min(1, (t - from) / span)) * 100).toFixed(3)}%`;
  const fmt = (t) => new Date(t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
  const head = html("div", "tl-row tl-head");
  head.append(html("div", "tl-name"));
  const scale = html("div", "tl-track");
  for (const t of days) {
    const tick = html("span", "tl-day", new Date(t).toLocaleDateString([], { weekday: "short" }));
    tick.style.left = pct(t);
    scale.append(tick);
  }
  head.append(scale);
  wrap.append(head);
  const row = (name, spans, cls, label) => {
    const r = html("div", `tl-row ${cls || ""}`);
    const n = html(onName && cls !== "tl-server" ? "a" : "div", "tl-name", name);
    if (onName && cls !== "tl-server") n.href = onName(name);
    const track = html("div", "tl-track");
    for (const t of days) { const g = html("span", "tl-grid"); g.style.left = pct(t); track.append(g); }
    for (const [a, b, extra] of spans) {
      if (b < from) continue;
      const bar = html("button", "tl-bar");
      bar.type = "button";
      bar.style.left = pct(a);
      bar.style.width = `max(3px, calc(${pct(b)} - ${pct(a)}))`;
      const lines = [label(name), `${fmt(a)} – ${fmt(b)}`, dur(b - Math.max(a, from)) + (extra != null ? ` · up to ${extra} online` : "")];
      bar.setAttribute("aria-label", lines.join(", "));
      const show = () => {
        tip.replaceChildren(...lines.map((l, i) => html(i ? "span" : "b", null, l)));
        tip.hidden = false;
        const wr = wrap.getBoundingClientRect(), br = bar.getBoundingClientRect();
        tip.style.left = `${Math.min(Math.max(br.left - wr.left + br.width / 2, 80), wr.width - 80)}px`;
        tip.style.top = `${br.top - wr.top - 8}px`;
      };
      bar.addEventListener("pointerenter", show);
      bar.addEventListener("focus", show);
      bar.addEventListener("pointerleave", () => (tip.hidden = true));
      bar.addEventListener("blur", () => (tip.hidden = true));
      track.append(bar);
    }
    r.append(n, track);
    return r;
  };
  wrap.append(row("Server online", data.uptime.map(([a, b, peak]) => [a, b, peak]), "tl-server", () => "Server online"));
  for (const p of data.players) wrap.append(row(p.name, p.sessions, "", (n) => n));
  if (!data.players.length) wrap.append(html("p", "text-3 small", "Nobody has played in this time yet."));
  wrap.append(tip);
  return wrap;
}

// Busiest hours: average players online per hour of the day (from the sessions).
export function busiestHours(data) {
  const counts = new Array(24).fill(0);
  const daysSeen = Math.max(1, (data.now - data.from) / 864e5);
  for (const p of data.players) {
    for (const [a, b] of p.sessions) {
      for (let t = Math.floor(a / 36e5) * 36e5; t < b; t += 36e5) {
        const overlap = Math.min(b, t + 36e5) - Math.max(a, t);
        if (overlap > 0) counts[new Date(t).getHours()] += overlap / 36e5;
      }
    }
  }
  return counts.map((c) => c / daysSeen);
}
