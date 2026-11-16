// Page loading animation: a block breaks apart into the GalaxySMP letters (still with the block's texture),
// which then fill with the logo's colors. Usually it's a grass block. Rarely (1 in 50) it's a rare one:
//   Diamond: diamond ore -> gold gradient logo -> normal logo
//   Gold:    gold block  -> polished gold logo  -> normal logo
//   Galaxy:  starry block -> galaxy gradient logo -> normal logo (half as likely as the other two)
// Plays in full the first time someone opens the site (per tab session); after that it only appears when a
// page takes a while to load. Loaded as a normal script at the top of <body> so it covers the page right away.
// Testing: ?loader plays it every time, ?loader=diamond|gold|galaxy|grass picks one, &loadert=900 freezes at 900 ms.
(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  var force = params.has("loader");
  var fixedT = params.has("loadert") ? Number(params.get("loadert")) : null;
  if (!force && (params.has("embed") || navigator.webdriver)) return;

  var seen = false;
  try { seen = sessionStorage.getItem("gsmp-intro") === "1"; sessionStorage.setItem("gsmp-intro", "1"); } catch (e) { /* private mode */ }
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var SLOW_MS = 400;          // later pages: only show if loading takes longer than this
  var BASE = 2400;            // the normal animation (ms)
  var RARE_CHANCE = 1 / 50;
  var loaded = document.readyState === "complete";
  window.addEventListener("load", function () { loaded = true; });


  function pickTheme() {
    var asked = params.get("loader");
    if (asked && THEMES[asked]) return asked;
    if (Math.random() >= RARE_CHANCE) return "grass";
    var r = Math.random() * 5;              // diamond 2, gold 2, galaxy 1
    return r < 2 ? "diamond" : r < 4 ? "gold" : "galaxy";
  }

  // ---------- textures (all drawn here, pixel by pixel) ----------
  function rnd(seed) { var x = Math.sin(seed * 127.1) * 43758.5453; return x - Math.floor(x); }
  function pick(list, r) { return list[Math.floor(r * list.length) % list.length]; }
  function hex(c) { return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)]; }
  function lerpStops(stops, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    for (var i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
      var a = stops[i - 1], b = stops[i], f = (t - a[0]) / (b[0] - a[0] || 1), ca = hex(a[1]), cb = hex(b[1]);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
    }
    return hex(stops[stops.length - 1][1]);
  }

  var GREENS = ["#5fae3a", "#6cbf43", "#4f9a30", "#79c94f", "#58a537"];
  var DIRTS = ["#8a5a35", "#7a4e2d", "#9b6a40", "#6e4428", "#85573a"];
  var STONE = ["#8f8f8f", "#7d7d7d", "#9a9a9a", "#6f6f6f", "#868686"];
  var GEMS = ["#5decf5", "#2fc7d6", "#a8fbff", "#1aa5b3"];
  var GOLDS = ["#f9d849", "#f5c536", "#fce374", "#ecb92a", "#fbe089"];
  var SPACE = ["#1b1446", "#231a5c", "#2c1f6e", "#160f3a", "#3a2585"];
  var STARS = ["#ffffff", "#ff9ff3", "#9fe8ff", "#fff3a8"];

  var THEMES = {
    grass: {
      bits: GREENS.concat(DIRTS),
      // face: "top" | "side" | "letter"
      color: function (tx, ty, face) {
        var r = rnd(tx * 31 + ty * 17 + (face === "top" ? 5 : 0));
        if (face === "top") return pick(GREENS, r);
        var rows = face === "side" ? 4 : 3;
        var edge = rows + (rnd(tx * 7.3) < 0.45 ? 1 : 0) + (rnd(tx * 3.1) < 0.18 ? 1 : 0);   // uneven grass edge
        return ty < edge ? pick(GREENS, r) : pick(DIRTS, r);
      },
      steps: [{ img: "logo", shine: ["rgba(120,230,255,0)", "rgba(170,240,255,.55)", "rgba(150,120,255,0)"] }],
    },
    diamond: {
      label: "Rare: Diamond", labelColor: "#7ef3ff",
      bits: GEMS.concat(STONE, GEMS),
      color: function (tx, ty) {
        var cluster = rnd(Math.floor(tx / 2) * 3.7 + Math.floor(ty / 2) * 11.3) < 0.3;   // gems come in little clumps
        var r = rnd(tx * 17.7 + ty * 29.3);
        return cluster && r < 0.7 ? pick(GEMS, rnd(tx * 3 + ty * 5)) : pick(STONE, r);
      },
      steps: [
        { img: "mid", shine: ["rgba(255,220,120,0)", "rgba(255,240,170,.7)", "rgba(255,200,80,0)"],
          paint: function (x, y, W, H) { return lerpStops([[0, "#fff6c2"], [0.35, "#ffd34d"], [0.7, "#e09a1c"], [1, "#b86f0e"]], y / H + (x / W - 0.5) * 0.12); } },
        { img: "logo", shine: ["rgba(120,230,255,0)", "rgba(170,240,255,.55)", "rgba(150,120,255,0)"] },
      ],
    },
    gold: {
      label: "Rare: Gold", labelColor: "#ffd34d",
      bits: GOLDS.concat(["#c98a1a", "#fff6c2"]),
      color: function (tx, ty, face) {
        var m = face === "letter" ? 5 : 16;           // a darker line around each block
        if (tx % m === 0 || ty % m === 0) return "#d39a22";
        if ((tx % m) + (ty % m) === 4 || (tx % m) + (ty % m) === 5) return "#fff3b0";   // a light streak
        return pick(GOLDS, rnd(tx * 13.1 + ty * 7.9));
      },
      steps: [
        { img: "mid", shine: ["rgba(255,255,255,0)", "rgba(255,255,230,.85)", "rgba(255,255,255,0)"],
          paint: function (x, y, W, H) { var g = lerpStops([[0, "#fffbe0"], [0.4, "#ffe066"], [0.75, "#f0b429"], [1, "#c98a1a"]], y / H);
            var glint = Math.max(0, 1 - Math.abs(((x - y * 1.4) / W) * 9 - 3.2)) * 70;   // a diagonal glint
            return [g[0] + glint, g[1] + glint, g[2] + glint * 0.8]; } },
        { img: "logo", shine: ["rgba(120,230,255,0)", "rgba(170,240,255,.55)", "rgba(150,120,255,0)"] },
      ],
    },
    galaxy: {
      label: "Super rare: Galaxy", labelColor: "#d9a8ff",
      bits: STARS.concat(SPACE),
      stars: true,
      color: function (tx, ty) {
        var r = rnd(tx * 23.3 + ty * 41.9);
        return r < 0.07 ? pick(STARS, rnd(tx + ty * 3)) : pick(SPACE, rnd(tx * 5.1 + ty * 2.3));
      },
      steps: [
        { img: "mid", shine: ["rgba(200,120,255,0)", "rgba(240,190,255,.7)", "rgba(120,200,255,0)"],
          paint: function (x, y, W) {
            if (rnd(x * 1.31 + y * 7.77) < 0.012) return [255, 255, 255];   // tiny stars
            return lerpStops([[0, "#58e1ff"], [0.5, "#6d5bff"], [1, "#d14dff"]], x / W); } },
        { img: "logo", shine: ["rgba(120,230,255,0)", "rgba(170,240,255,.55)", "rgba(150,120,255,0)"] },
      ],
    },
  };

  function start(slow) {
    var name = pickTheme(), theme = THEMES[name], rare = name !== "grass";
    var DURATION = rare ? BASE * 2300 / 1600 : BASE;
    if (reduce) DURATION = 1;  // no movement: just show the finished logo briefly

    var wrap = document.createElement("div");
    wrap.className = "gsmp-loader";
    wrap.setAttribute("role", "status");
    wrap.setAttribute("aria-label", "Loading");
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;" +
      "background:radial-gradient(120% 90% at 50% 40%," + (name === "galaxy" ? "#241850" : "#151a3d") + " 0%,#0a0c1b 60%,#06070f 100%);" +
      "transition:opacity .28s ease;opacity:" + (slow ? "0" : "1");
    var canvas = document.createElement("canvas");
    canvas.style.cssText = "width:min(86vw,520px);height:auto;image-rendering:pixelated;display:block";
    wrap.appendChild(canvas);
    var label = null;
    if (rare) {
      label = document.createElement("div");
      label.textContent = theme.label;
      label.style.cssText = "font:800 13px/1 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.16em;text-transform:uppercase;" +
        "color:" + theme.labelColor + ";text-shadow:0 0 14px " + theme.labelColor + ";opacity:0;transition:opacity .4s ease;margin-top:-24px";
      wrap.appendChild(label);
    }
    (document.body || document.documentElement).appendChild(wrap);
    if (slow) requestAnimationFrame(function () { wrap.style.opacity = "1"; });

    var logo = new Image();
    var began = 0, finishedAt = 0, gone = false;
    logo.onload = function () { setup(); };
    logo.onerror = function () { finish(true); };
    logo.src = "/img/wordmark.png";
    if (fixedT === null) setTimeout(function () { finish(true); }, rare ? 10000 : 8000);   // never hold the page hostage

    var W, H, S = 2, ctx, letters = [], layers = [], sparks = [], twinkles = [];
    var TOP = tile("top"), SIDE = tile("side");

    function tile(face) {
      var c = document.createElement("canvas"); c.width = c.height = 16;
      var g = c.getContext("2d");
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        g.fillStyle = theme.color(x, y, face);
        g.fillRect(x, y, 1, 1);
      }
      return c;
    }

    function setup() {
      W = logo.naturalWidth; H = logo.naturalHeight;            // 582 x 101
      var padY = Math.round(W * 0.42);                           // room above/below for the block and the pieces
      canvas.width = W * S; canvas.height = (H + padY) * S;
      ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      // layers[0] = letters with the block's texture, then one layer per color step
      layers.push(recolor(function (x, y) { return hex(theme.color(Math.floor(x / 6), Math.floor((y - 6) / 6), "letter")); }));
      theme.steps.forEach(function (st) { layers.push(st.img === "logo" ? logo : recolor(function (x, y) { return st.paint(x, y, W, H); })); });
      letters = findLetters();
      for (var i = 0; i < 26; i++) sparks.push({ a: Math.random() * Math.PI * 2, v: 0.6 + Math.random() * 1.2, s: 3 + Math.random() * 5 });
      for (i = 0; i < 40; i++) twinkles.push({ x: Math.random(), y: Math.random(), p: Math.random() * 6.28, s: Math.random() < 0.3 ? 3 : 2 });
      began = performance.now();
      requestAnimationFrame(frame);
    }

    // The logo's letter shapes with new colors (outline and dark bottom kept; a hint of the original lighting kept).
    function recolor(paint) {
      var c = document.createElement("canvas"); c.width = W; c.height = H;
      var g = c.getContext("2d");
      g.drawImage(logo, 0, 0);
      var img = g.getImageData(0, 0, W, H), d = img.data;
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var i = (y * W + x) * 4;
        if (d[i + 3] < 10) continue;
        var lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        if (lum < 70) continue;
        var col = paint(x, y), shade = Math.min(1.15, Math.max(0.75, lum / 150));
        d[i] = Math.min(255, col[0] * shade); d[i + 1] = Math.min(255, col[1] * shade); d[i + 2] = Math.min(255, col[2] * shade);
      }
      g.putImageData(img, 0, 0);
      return c;
    }

    // Splits the logo into letters at the empty columns between them.
    function findLetters() {
      var c = document.createElement("canvas"); c.width = W; c.height = H;
      var g = c.getContext("2d"); g.drawImage(logo, 0, 0);
      var d = g.getImageData(0, 0, W, H).data, cols = [];
      for (var x = 0; x < W; x++) {
        var n = 0;
        for (var y = 0; y < H; y++) if (d[(y * W + x) * 4 + 3] > 40) n++;
        cols.push(n);
      }
      var out = [], s = -1;
      for (x = 0; x <= W; x++) {
        var on = x < W && cols[x] > 0;
        if (on && s < 0) s = x;
        if (!on && s >= 0) { out.push([s, x]); s = -1; }
      }
      if (out.length < 6) { out = []; for (var k = 0; k < 9; k++) out.push([Math.round(k * W / 9), Math.round((k + 1) * W / 9)]); }
      return out.map(function (p, idx) { return { x0: p[0], x1: p[1], i: idx, rot: (rnd(idx + 3) - 0.5) * 1.2 }; });
    }

    // ---------- drawing ----------
    function ease(t) { return 1 - Math.pow(1 - t, 3); }
    function back(t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
    function clamp(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

    // An isometric block centered on (cx, cy). size = the length of one edge on screen.
    function drawBlock(cx, cy, size, shake, alpha) {
      var s = size / 16, x0 = cx + shake;
      var ux = 0.866 * s, uy = 0.5 * s;
      ctx.save();
      ctx.globalAlpha = alpha;
      function face(tex, a, b, c, d, e, f, dark) {
        ctx.setTransform(S * a, S * b, S * c, S * d, S * e, S * f);
        ctx.drawImage(tex, 0, 0);
        if (dark) { ctx.fillStyle = "rgba(0,0,0," + dark + ")"; ctx.fillRect(0, 0, 16, 16); }
      }
      face(TOP, ux, uy, -ux, uy, x0, cy - size, 0);                          // top
      face(SIDE, ux, uy, 0, s, x0 - 16 * ux, cy - size + 16 * uy, 0.18);     // left
      face(SIDE, ux, -uy, 0, s, x0, cy, 0.38);                                // right
      ctx.restore();
      if (rare && alpha > 0.3) {                                             // rare blocks glow
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        var glow = ctx.createRadialGradient(cx, cy, size * 0.2, cx, cy, size * 1.6);
        glow.addColorStop(0, theme.labelColor + "44"); glow.addColorStop(1, theme.labelColor + "00");
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = glow;
        ctx.fillRect(cx - size * 2, cy - size * 2, size * 4, size * 4);
        ctx.restore();
      }
    }

    function frame(now) {
      if (gone) return;
      var t = fixedT !== null ? fixedT : now - began, k = BASE / 1600;
      if (reduce) t = 99999;
      var cw = canvas.width / S, ch = canvas.height / S, cx = cw / 2, cy = ch / 2;
      ctx.setTransform(S, 0, 0, S, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = false;
      var logoX = (cw - W) / 2, logoY = (ch - H) / 2;

      if (theme.stars) {                                                     // galaxy: twinkling stars behind
        for (var j = 0; j < twinkles.length; j++) {
          var tw = twinkles[j];
          ctx.globalAlpha = 0.25 + 0.6 * Math.abs(Math.sin(t / 380 + tw.p));
          ctx.fillStyle = STARS[j % STARS.length];
          ctx.fillRect(tw.x * cw, tw.y * ch, tw.s, tw.s);
        }
        ctx.globalAlpha = 1;
      }

      // 1) the block drops in and wobbles, 2) it breaks into the letters, 3+) color steps sweep across
      var tA = clamp(t / (300 * k)), tShake = clamp((t - 330 * k) / (190 * k));
      var tB = clamp((t - 520 * k) / (520 * k));
      var sweeps = theme.steps.map(function (st, n) { return clamp((t - (1080 + n * 650) * k) / (420 * k)); });
      if (label) label.style.opacity = tA > 0.6 ? "1" : "0";
      if (tB < 0.35) {
        var drop = (1 - back(tA)) * -40;
        var shake = tShake > 0 && tShake < 1 ? Math.sin(tShake * 40) * 3 * (1 - tShake) : 0;
        var pop = tB > 0 ? 1 + tB * 0.6 : 1;
        drawBlock(cx, cy + drop, H * 0.9 * pop * (0.6 + 0.4 * ease(tA)), shake, tB > 0 ? 1 - tB / 0.35 : ease(tA));
      }
      if (tB > 0) {
        if (tB < 1) for (var i = 0; i < sparks.length; i++) {               // little block bits flying out
          var p = sparks[i], dist = ease(tB) * 150 * p.v;
          ctx.globalAlpha = 1 - tB;
          ctx.fillStyle = theme.bits[i % theme.bits.length];
          ctx.fillRect(cx + Math.cos(p.a) * dist, cy + Math.sin(p.a) * dist * 0.7 + tB * tB * 40, p.s, p.s);
        }
        ctx.globalAlpha = 1;
        for (i = 0; i < letters.length; i++) {
          var L = letters[i], lw = L.x1 - L.x0;
          var lt = clamp((tB - i * 0.035) / (1 - letters.length * 0.035));
          var e = back(lt);
          var tx = logoX + L.x0 + lw / 2, ty = logoY + H / 2;
          var x = cx + (tx - cx) * e, y = cy + (ty - cy) * e - Math.sin(lt * Math.PI) * 18;
          var sc = 0.25 + 0.75 * e;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(L.rot * (1 - ease(lt)));
          ctx.scale(sc, sc);
          ctx.globalAlpha = clamp(lt * 4);
          // the newest layer that has fully covered this letter, then the next one sweeping in from the left
          var baseLayer = 0;
          for (var n = 0; n < sweeps.length; n++) if ((sweeps[n] * 1.25) * W - L.x0 >= lw) baseLayer = n + 1;
          ctx.drawImage(layers[baseLayer], L.x0, 0, lw, H, -lw / 2, -H / 2, lw, H);
          if (baseLayer < sweeps.length && sweeps[baseLayer] > 0) {
            var reach = (sweeps[baseLayer] * 1.25) * W - L.x0;
            if (reach > 0) ctx.drawImage(layers[baseLayer + 1], L.x0, 0, Math.min(lw, reach), H, -lw / 2, -H / 2, Math.min(lw, reach), H);
          }
          ctx.restore();
        }
        for (n = 0; n < sweeps.length; n++) {                                // a bright shine that rides each sweep
          var sw = sweeps[n];
          if (sw <= 0 || sw >= 1) continue;
          var sx = logoX + sw * 1.25 * W, c3 = theme.steps[n].shine;
          var grd = ctx.createLinearGradient(sx - 30, 0, sx + 30, 0);
          grd.addColorStop(0, c3[0]); grd.addColorStop(0.5, c3[1]); grd.addColorStop(1, c3[2]);
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = grd;
          ctx.fillRect(sx - 30, logoY - 6, 60, H + 12);
          if (rare) {                                                        // sparkles trailing the shine
            for (var q = 0; q < 6; q++) {
              var r1 = rnd(q * 9.1 + n * 3 + Math.floor(t / 70));
              ctx.fillStyle = theme.labelColor;
              ctx.fillRect(sx - 40 * r1, logoY + H * rnd(q * 4.7 + Math.floor(t / 70)), 3, 3);
            }
          }
          ctx.globalCompositeOperation = "source-over";
        }
      }
      var allDone = sweeps[sweeps.length - 1] >= 1;
      if (t >= DURATION && !finishedAt) finishedAt = now || 1;
      // Finish when the page is ready (full animation: after it ends; slow loads: as soon as the page is ready)
      if (fixedT === null && (finishedAt || (slow && t > 500)) && loaded) return finish(false);
      if (t > DURATION + 300 && !loaded && allDone) {                       // still loading: gently pulse the logo
        ctx.globalAlpha = 0.18 + 0.12 * Math.sin(t / 220);
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(logo, logoX, logoY);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
      requestAnimationFrame(frame);
    }

    function finish(now) {
      if (gone) return;
      gone = true;
      wrap.style.opacity = "0";
      setTimeout(function () { wrap.remove(); }, now ? 0 : 300);
    }
  }

  // (at the end, so the themes above are ready)
  if (seen && !force) {
    setTimeout(function () { if (!loaded) start(true); }, SLOW_MS);
  } else {
    start(false);
  }
})();
