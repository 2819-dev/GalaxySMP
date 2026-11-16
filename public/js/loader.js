// Page loading animation: a grass block breaks apart into the GalaxySMP letters (still grass), which then
// fill with the logo's colors. Plays in full the first time someone opens the site (per tab session);
// after that it only appears when a page takes a while to load.
// Loaded as a normal (non-module) script at the very top of <body> so it can cover the page right away.
(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  var force = params.has("loader");
  var fixedT = params.has("loadert") ? Number(params.get("loadert")) : null;  // freeze at one moment (testing)  // ?loader plays it every time (for testing)
  if (!force && (params.has("embed") || navigator.webdriver)) return;

  var seen = false;
  try { seen = sessionStorage.getItem("gsmp-intro") === "1"; sessionStorage.setItem("gsmp-intro", "1"); } catch (e) { /* private mode */ }
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var SLOW_MS = 400;          // later pages: only show if loading takes longer than this
  var DURATION = 2400;        // the full animation
  var loaded = document.readyState === "complete";
  window.addEventListener("load", function () { loaded = true; });

  if (seen && !force) {
    setTimeout(function () { if (!loaded) start(true); }, SLOW_MS);
  } else {
    start(false);
  }

  function start(slow) {
    var wrap = document.createElement("div");
    wrap.className = "gsmp-loader";
    wrap.setAttribute("role", "status");
    wrap.setAttribute("aria-label", "Loading");
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;" +
      "background:radial-gradient(120% 90% at 50% 40%,#151a3d 0%,#0a0c1b 60%,#06070f 100%);" +
      "transition:opacity .28s ease;opacity:" + (slow ? "0" : "1");
    var canvas = document.createElement("canvas");
    canvas.style.cssText = "width:min(86vw,520px);height:auto;image-rendering:pixelated;display:block";
    wrap.appendChild(canvas);
    (document.body || document.documentElement).appendChild(wrap);
    if (slow) requestAnimationFrame(function () { wrap.style.opacity = "1"; });

    var logo = new Image();
    var began = 0, finishedAt = 0, gone = false;
    logo.onload = function () { setup(); };
    logo.onerror = function () { finish(true); };
    logo.src = "/img/wordmark.png";
    // never hold the page hostage
    if (fixedT === null) setTimeout(function () { finish(true); }, 8000);

    var W, H, S = 2, ctx, letters = [], grassLogo, sparks = [];

    function setup() {
      W = logo.naturalWidth; H = logo.naturalHeight;            // 582 x 101
      var padY = Math.round(W * 0.42);                           // room above/below for the block and the pieces
      canvas.width = W * S; canvas.height = (H + padY) * S;
      ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      grassLogo = makeGrassLogo();
      letters = findLetters();
      for (var i = 0; i < 26; i++) sparks.push({ a: Math.random() * Math.PI * 2, v: 0.6 + Math.random() * 1.2, s: 3 + Math.random() * 5, c: Math.random() < 0.55 ? 0 : 1 });
      began = performance.now();
      requestAnimationFrame(frame);
    }

    // ---------- textures (drawn here, pixel by pixel) ----------
    function rnd(seed) { var x = Math.sin(seed * 127.1) * 43758.5453; return x - Math.floor(x); }
    var GREENS = ["#5fae3a", "#6cbf43", "#4f9a30", "#79c94f", "#58a537"];
    var DIRTS = ["#8a5a35", "#7a4e2d", "#9b6a40", "#6e4428", "#85573a"];
    function grassColor(tx, ty, rows) {
      var r = rnd(tx * 31 + ty * 17);
      var edge = rows + (rnd(tx * 7.3) < 0.45 ? 1 : 0) + (rnd(tx * 3.1) < 0.18 ? 1 : 0);   // uneven grass edge
      if (ty < edge) return GREENS[Math.floor(r * GREENS.length)];
      return DIRTS[Math.floor(r * DIRTS.length)];
    }
    function tile(size, rows, top) {
      var c = document.createElement("canvas"); c.width = c.height = size;
      var g = c.getContext("2d");
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        g.fillStyle = top ? GREENS[Math.floor(rnd(x * 13 + y * 29 + 5) * GREENS.length)] : grassColor(x, y, rows);
        g.fillRect(x, y, 1, 1);
      }
      return c;
    }
    var TOP = tile(16, 0, true), SIDE = tile(16, 4, false);

    // The logo's letter shapes, with the grass texture instead of the blue (outline and shadow kept dark).
    function makeGrassLogo() {
      var c = document.createElement("canvas"); c.width = W; c.height = H;
      var g = c.getContext("2d");
      g.drawImage(logo, 0, 0);
      var img = g.getImageData(0, 0, W, H), d = img.data, T = 6;   // one texture pixel = 6 logo pixels
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var i = (y * W + x) * 4;
        if (d[i + 3] < 10) continue;
        var lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        if (lum < 70) continue;                                  // black outline / dark bottom stays as it is
        var col = grassColor(Math.floor(x / T), Math.floor((y - 6) / T), 3);
        var shade = Math.min(1.15, Math.max(0.75, lum / 150));   // keep a hint of the logo's lighting
        d[i] = Math.min(255, parseInt(col.substr(1, 2), 16) * shade);
        d[i + 1] = Math.min(255, parseInt(col.substr(3, 2), 16) * shade);
        d[i + 2] = Math.min(255, parseInt(col.substr(5, 2), 16) * shade);
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
      // The outline touches between some letters: if we found too few pieces, cut into 9 equal ones.
      if (out.length < 6) { out = []; for (var k = 0; k < 9; k++) out.push([Math.round(k * W / 9), Math.round((k + 1) * W / 9)]); }
      return out.map(function (p, idx) { return { x0: p[0], x1: p[1], i: idx, rot: (rnd(idx + 3) - 0.5) * 1.2 }; });
    }

    // ---------- drawing ----------
    function ease(t) { return 1 - Math.pow(1 - t, 3); }
    function back(t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
    function clamp(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

    // An isometric grass block centered on (cx, cy). size = the length of one edge on screen.
    function drawBlock(cx, cy, size, shake, alpha) {
      var s = size / 16, x0 = cx + shake;
      var ux = 0.866 * s, uy = 0.5 * s;                         // one texture pixel to the right-down / left-down
      ctx.save();
      ctx.globalAlpha = alpha;
      function face(a, b, c, d, e, f, dark) {
        ctx.setTransform(S * a, S * b, S * c, S * d, S * e, S * f);
        ctx.drawImage(face.tex, 0, 0);
        if (dark) { ctx.fillStyle = "rgba(0,0,0," + dark + ")"; ctx.fillRect(0, 0, 16, 16); }
      }
      face.tex = TOP;  face(ux, uy, -ux, uy, x0, cy - size, 0);                  // top
      face.tex = SIDE; face(ux, uy, 0, s, x0 - 16 * ux, cy - size + 16 * uy, 0.18); // left
      face(ux, -uy, 0, s, x0, cy, 0.38);                                          // right
      ctx.restore();
    }

    function frame(now) {
      if (gone) return;
      var t = fixedT !== null ? fixedT : now - began, k = DURATION / 1600;
      var cw = canvas.width / S, ch = canvas.height / S, cx = cw / 2, cy = ch / 2;
      ctx.setTransform(S, 0, 0, S, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = false;
      var logoX = (cw - W) / 2, logoY = (ch - H) / 2;

      // 1) the grass block drops in, then wobbles (0 - 520 ms)
      var tA = clamp(t / (300 * k)), tShake = clamp((t - 330 * k) / (190 * k));
      var tB = clamp((t - 520 * k) / (520 * k));                       // 2) it breaks into the letters
      var tC = clamp((t - 1080 * k) / (420 * k));                      // 3) the letters fill with the logo colors
      if (tB < 0.35) {
        var drop = (1 - back(tA)) * -40;
        var shake = tShake > 0 && tShake < 1 ? Math.sin(tShake * 40) * 3 * (1 - tShake) : 0;
        var pop = tB > 0 ? 1 + tB * 0.6 : 1;
        drawBlock(cx, cy + drop, H * 0.9 * pop * (0.6 + 0.4 * ease(tA)), shake, tB > 0 ? 1 - tB / 0.35 : ease(tA));
      }
      if (tB > 0) {
        // little block bits flying out
        if (tB < 1) for (var i = 0; i < sparks.length; i++) {
          var p = sparks[i], dist = ease(tB) * 150 * p.v;
          ctx.globalAlpha = 1 - tB;
          ctx.fillStyle = p.c ? DIRTS[i % DIRTS.length] : GREENS[i % GREENS.length];
          ctx.fillRect(cx + Math.cos(p.a) * dist, cy + Math.sin(p.a) * dist * 0.7 + tB * tB * 40, p.s, p.s);
        }
        ctx.globalAlpha = 1;
        // the letters fly from the block to their places in the logo (each a little later than the last)
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
          ctx.drawImage(grassLogo, L.x0, 0, lw, H, -lw / 2, -H / 2, lw, H);
          // 3) colors sweep in from left to right
          if (tC > 0) {
            var sweep = (tC * 1.25) * W - L.x0;   // how far the color has reached into this letter
            if (sweep > 0) {
              var vis = Math.min(lw, sweep);
              ctx.drawImage(logo, L.x0, 0, vis, H, -lw / 2, -H / 2, vis, H);
            }
          }
          ctx.restore();
        }
        // a bright shine line that rides the color sweep
        if (tC > 0 && tC < 1) {
          var sx = logoX + tC * 1.25 * W;
          var grd = ctx.createLinearGradient(sx - 30, 0, sx + 30, 0);
          grd.addColorStop(0, "rgba(120,230,255,0)"); grd.addColorStop(0.5, "rgba(170,240,255,.55)"); grd.addColorStop(1, "rgba(150,120,255,0)");
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = grd;
          ctx.fillRect(sx - 30, logoY - 6, 60, H + 12);
          ctx.globalCompositeOperation = "source-over";
        }
      }
      if (t >= DURATION && !finishedAt) finishedAt = now;
      // Finish when the page is ready (first visit: after the whole animation; slow loads: as soon as it's ready)
      if (fixedT === null && (finishedAt || (slow && t > 500)) && loaded) return finish(false);
      if (t > DURATION + 300 && !loaded && tC >= 1) {
        // still loading: gently pulse the finished logo
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

    if (reduce) {  // no movement: just show the logo briefly
      DURATION = 1;
    }
  }
})();
