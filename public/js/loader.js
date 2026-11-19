// Page loading animation: a block breaks apart into the GalaxySMP letters (still with the block's texture),
// which then fill with the logo's colors. Usually it's a grass block. Sometimes it's a special one:
//   Rare (each 0.3%, about 1 in 333):        Diamond, Gold, Emerald, Netherite, Amethyst, Lava, Ice
//   Super rare (each 0.15%, about 1 in 667): Galaxy, Ender
//   Mythic (0.1%, 1 in 1,000):               Rainbow
// On Jewish holidays, New Year and the first day of each season, a holiday block replaces most grass blocks.
// Seen screens are saved to your profile (Loading screens), so collect them all.
// Plays in full the first time someone opens the site (per tab session); after that it only appears when a
// page takes a while to load. Loaded as a normal script at the top of <body> so it covers the page right away.
// Testing: ?loader plays it every time, ?loader=<name> picks one (e.g. rainbow, chanukah), &loadert=900 freezes at 900 ms.
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
  var RARE = ["diamond", "gold", "emerald", "netherite", "amethyst", "lava", "ice"], SUPER = ["galaxy", "ender"];
  var loaded = document.readyState === "complete";
  window.addEventListener("load", function () { loaded = true; });


  function pickTheme() {
    var asked = params.get("loader");
    if (asked && THEMES[asked]) return asked;
    var r = Math.random();
    if (r < 0.001) return "rainbow";                                         // mythic: 1 in 1,000
    if (r < 0.004) return SUPER[Math.floor((r - 0.001) / 0.0015) % 2];       // super rare: 0.15% each
    if (r < 0.025) return RARE[Math.floor((r - 0.004) / 0.003) % 7];         // rare: 0.3% each
    var hol = holiday();
    return hol && Math.random() < 0.75 ? hol : "grass";                      // holidays: most grass blocks
  }

  // Jewish holidays (from the Hebrew calendar built into the browser), New Year, and the first day of each season
  function holiday() {
    var now = new Date(), m = now.getMonth() + 1, d = now.getDate();
    if ((m === 12 && d === 31) || (m === 1 && d <= 2)) return "newyear";
    if (m === 3 && (d === 20 || d === 21)) return "spring";
    if (m === 6 && (d === 20 || d === 21)) return "summer";
    if (m === 9 && (d === 22 || d === 23)) return "autumn";
    if (m === 12 && (d === 21 || d === 22)) return "winter";
    try {
      var fmt = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long" });
      var heb = function (t) { var parts = fmt.formatToParts(t), o = {}; parts.forEach(function (p) { o[p.type] = p.value; }); return { day: Number(o.day), month: o.month || "" }; };
      var h = heb(now), is = function (mo, a, b) { return h.month === mo && h.day >= a && h.day <= (b || a); };
      if (is("Elul", 29) || is("Tishri", 1, 2)) return "rosh";
      if (is("Tishri", 14, 23)) return "sukkot";
      for (var k = 0; k < 8; k++) { var b = heb(new Date(now.getTime() - k * 864e5)); if (b.month === "Kislev" && b.day === 24) return "chanukah"; }
      if (is("Shevat", 14, 15)) return "tubishvat";
      if (is("Adar", 13, 15) || is("Adar II", 13, 15)) return "purim";
      if (is("Nisan", 14, 22)) return "pesach";
      if (is("Iyar", 17, 18)) return "lagbaomer";
      if (is("Sivan", 5, 7)) return "shavuot";
    } catch (e) { /* no Hebrew calendar in this browser */ }
    return null;
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
  var LOGO_STEP = { img: "logo", shine: ["rgba(120,230,255,0)", "rgba(170,240,255,.55)", "rgba(150,120,255,0)"] };
  // A themed block: base colors, an accent that comes in little clumps, a gradient for the letters, and a glow color.
  function block(label, glow, base, accent, stops, opts) {
    opts = opts || {};
    return {
      label: label, labelColor: glow, bits: accent.concat(base, accent), stars: opts.stars, snow: opts.snow,
      color: opts.color || function (tx, ty) {
        var cluster = rnd(Math.floor(tx / 2) * 3.7 + Math.floor(ty / 2) * 11.3 + (opts.seed || 0)) < (opts.amount || 0.32);
        var r = rnd(tx * 17.7 + ty * 29.3 + (opts.seed || 0));
        return cluster && r < 0.75 ? pick(accent, rnd(tx * 3 + ty * 5)) : pick(base, r);
      },
      steps: [{ img: "mid", shine: [glow + "00", glow + "bb", glow + "00"],
        paint: opts.paint || function (x, y, W, H) { return lerpStops(stops, y / H + (x / W - 0.5) * 0.15); } }, LOGO_STEP],
    };
  }
  var RAINBOW = ["#ff4d4d", "#ff9f40", "#ffe14d", "#5ce65c", "#4dc3ff", "#7a6bff", "#d65cff"];
  var more = {
    // ---- rare ----
    emerald: block("Rare: Emerald", "#4dff8a", STONE, ["#17dd62", "#41f084", "#0fa84a", "#98ffbe"], [[0, "#c9ffd9"], [0.4, "#3ee87d"], [1, "#0b8a3d"]]),
    netherite: block("Rare: Netherite", "#c77dff", ["#3a3236", "#2f282c", "#463c40", "#26201f"], ["#5c4a52", "#6b4f5d", "#7d5f6e"],
      [[0, "#a48a96"], [0.45, "#4d3b44"], [1, "#1d1619"]], { amount: 0.2 }),
    amethyst: block("Rare: Amethyst", "#d49cff", ["#6a3fa8", "#7d4fc0", "#5b3392", "#8d5fd0"], ["#c99bff", "#e7ccff", "#b07cf0"],
      [[0, "#f3e3ff"], [0.45, "#b77cff"], [1, "#5d2ea3"]]),
    lava: block("Rare: Lava", "#ff8a3d", ["#3a1408", "#511b0a", "#2a0e05", "#62210b"], ["#ff6a00", "#ffae2b", "#ff3d00", "#ffd65c"],
      [[0, "#fff0a8"], [0.35, "#ffb02e"], [0.7, "#ff5a14"], [1, "#a8200a"]], { amount: 0.45 }),
    ice: block("Rare: Ice", "#a9e6ff", ["#8fc7ff", "#9fd2ff", "#7eb8f5", "#b3dcff"], ["#e6f6ff", "#ffffff", "#cbeaff"],
      [[0, "#ffffff"], [0.5, "#b8e4ff"], [1, "#5aa7e8"]], { amount: 0.25 }),
    // ---- super rare ----
    ender: block("Super rare: Ender", "#5df5c9", ["#dddca0", "#e6e5ad", "#cfcd8e", "#d8d69a"], ["#1c6b57", "#0b3d33", "#3fd6a8"],
      [[0, "#b8fff0"], [0.45, "#28b88f"], [1, "#0a3d33"]], { stars: true, amount: 0.18, seed: 4 }),
    // ---- mythic ----
    rainbow: block("Mythic: Rainbow", "#ffffff", RAINBOW, RAINBOW, null, {
      color: function (tx, ty) { return RAINBOW[Math.floor(tx / 2 + ty / 2) % RAINBOW.length]; },
      paint: function (x, y, W) { return lerpStops(RAINBOW.map(function (c, i) { return [i / (RAINBOW.length - 1), c]; }), (x / W + y / 400) % 1); },
      stars: true }),
    // ---- holidays and seasons ----
    rosh: block("Shanah Tovah", "#ff6b6b", ["#b51f2e", "#d12b3b", "#9c1625", "#c0283a"], ["#ffd36b", "#f5b83a", "#ffe9a8"], [[0, "#ffe9a8"], [0.5, "#e0a23a"], [1, "#a8222e"]]),
    sukkot: block("Chag Sameach", "#a6e36b", ["#5f9a34", "#6fae3e", "#4f8a2c", "#7bbb47"], ["#f3d453", "#ffe27a", "#d9b73a"], [[0, "#fff4b0"], [0.5, "#9bd157"], [1, "#4a7f27"]]),
    chanukah: block("Happy Chanukah", "#7fb8ff", ["#2b5fbf", "#3a72d6", "#21509f", "#4b85e8"], ["#ffffff", "#e9f2ff", "#ffd36b"], [[0, "#ffffff"], [0.45, "#7fb8ff"], [1, "#1f4fa8"]], { stars: true }),
    tubishvat: block("Happy Tu BiShvat", "#ffb3d1", ["#6a4a2b", "#7a5634", "#5e4126"], ["#ffc4dc", "#ffffff", "#ff9cc4", "#7fc463"], [[0, "#fff0f6"], [0.5, "#ff9cc4"], [1, "#6a8f3d"]], { amount: 0.5 }),
    purim: block("Purim Sameach", "#ff7ad9", ["#5b2a86", "#6b33a0", "#4a2270"], ["#ff5ca8", "#ffd23f", "#3fe0d0", "#7cff6b"], [[0, "#ffd23f"], [0.5, "#ff5ca8"], [1, "#6b33a0"]], { amount: 0.55 }),
    pesach: block("Chag Pesach Sameach", "#ffd9a0", ["#e9c88f", "#dcb77a", "#f2d6a2", "#cfa868"], ["#8a5a2b", "#a06a35"], [[0, "#fff1d6"], [0.5, "#e9c88f"], [1, "#9a6a33"]], { amount: 0.15 }),
    lagbaomer: block("Happy Lag BaOmer", "#ffa04d", ["#3a2416", "#4a2e1b", "#2c1b10"], ["#ff8a1f", "#ffc23d", "#ff5a14"], [[0, "#fff0a8"], [0.5, "#ff9a2e"], [1, "#b8410e"]], { amount: 0.45 }),
    shavuot: block("Chag Shavuot Sameach", "#f5d76b", ["#d9b04a", "#e6c15e", "#c99e3a", "#f0cf72"], ["#7fb84f", "#9bd16a", "#ffffff"], [[0, "#fff6c9"], [0.5, "#f0cf72"], [1, "#7a9a3a"]]),
    newyear: block("Happy New Year", "#ffe066", ["#111633", "#171d42", "#0c1027"], ["#ff5ca8", "#ffd23f", "#3fe0d0", "#a98bff", "#ffffff"], [[0, "#fff6c2"], [0.5, "#ffd23f"], [1, "#d16a00"]], { stars: true, amount: 0.2 }),
    spring: block("First day of spring", "#ff9cc4", GREENS, ["#ff9cc4", "#ffffff", "#ffe14d", "#c38bff"], [[0, "#fff0f6"], [0.5, "#ff9cc4"], [1, "#5fae3a"]], { amount: 0.35 }),
    summer: block("First day of summer", "#ffd23f", ["#f2d06b", "#e8c25a", "#f7dc84"], ["#4dc3ff", "#2f9be0", "#ffffff"], [[0, "#fffbe0"], [0.5, "#ffd23f"], [1, "#f08a24"]], { amount: 0.25 }),
    autumn: block("First day of autumn", "#ff9a3d", ["#c4561b", "#d9701f", "#a8401a", "#e38a2b"], ["#f5c242", "#8a2d12", "#6b8f2f"], [[0, "#ffe3a8"], [0.5, "#ff9a3d"], [1, "#8a2d12"]], { amount: 0.4 }),
    winter: block("First day of winter", "#cfeaff", ["#f4f9ff", "#e6f1ff", "#ffffff", "#dceaf7"], ["#9fd2ff", "#7eb8f5"], [[0, "#ffffff"], [0.5, "#cfeaff"], [1, "#6fa9e0"]], { snow: true, amount: 0.18 }),
  };
  for (var key in more) THEMES[key] = more[key];

  // Saved to your profile's "Loading screens" collection (signed-in members; quietly ignored otherwise)
  function remember(name) {
    try { if (sessionStorage.getItem("gsmp-ldr-" + name)) return; sessionStorage.setItem("gsmp-ldr-" + name, "1"); } catch (e) { /* ignore */ }
    if (force) return;
    setTimeout(function () {
      try { fetch("/api/me/loading-screens", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screen: name }) }).catch(function () {}); } catch (e) { /* ignore */ }
    }, 1500);
  }

  function start(slow) {
    var name = pickTheme(), theme = THEMES[name], rare = name !== "grass";
    remember(name);
    var DURATION = rare ? BASE * 2300 / 1600 : BASE;
    if (reduce) DURATION = 1;  // no movement: just show the finished logo briefly

    var wrap = document.createElement("div");
    wrap.className = "gsmp-loader";
    wrap.setAttribute("role", "status");
    wrap.setAttribute("aria-label", "Loading");
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;" +
      "background:radial-gradient(120% 90% at 50% 40%," + ({ galaxy: "#241850", ender: "#0e2b27", rainbow: "#2a1850", lava: "#2b1208", newyear: "#1a1440", chanukah: "#122a55", winter: "#1b2b45" }[name] || "#151a3d") + " 0%,#0a0c1b 60%,#06070f 100%);" +
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

      if (theme.snow) {                                                      // winter: falling snow
        ctx.fillStyle = "#ffffff";
        for (var sn = 0; sn < twinkles.length; sn++) {
          var flake = twinkles[sn];
          ctx.globalAlpha = 0.5 + 0.4 * flake.x;
          ctx.fillRect(flake.x * cw + Math.sin(t / 600 + flake.p) * 6, ((flake.y * ch) + t * (0.02 + flake.x * 0.03)) % ch, flake.s, flake.s);
        }
        ctx.globalAlpha = 1;
      }
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
