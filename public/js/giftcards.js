// Gift cards on the website: the card itself (built from the parts in giftcard-designs.js), the card builder
// in the Store, your sent cards, and the gift box that opens on galaxymc.us/gift.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { toast, iconEl } from "/js/site.js";
import { AMOUNTS, BACKGROUNDS, ARTWORK, FOILS, PATTERNS, GREETINGS, TEMPLATES, GREETING_MAX, styleOf, renderParts } from "/js/giftcard-designs.js";

const usd = (c) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;

// The card: 1.586:1 like a real gift card. Background, artwork, foil lines, greeting and amount.
// `look` is a style ({ bg, art, foil, pattern, greeting }) or a template id.
export function cardEl(look, amount, { to = "", from = "", size = "" } = {}) {
  const r = renderParts(look);
  const card = h("div", { class: `gc-card${r.foil.stops ? ` has-foil foil-${r.foil.id}` : ""}${size ? ` ${size}` : ""}`, role: "img", "aria-label": `GalaxySMP gift card, ${usd(amount)}` });
  card.style.background = r.bg.bg;
  card.style.color = r.bg.ink;
  card.style.setProperty("--gc-accent", r.bg.accent);
  if (r.foil.stops) card.style.setProperty("--foil", `linear-gradient(135deg, ${r.foil.stops.join(", ")})`);
  const artEl = h("div", { class: "gc-art" });
  artEl.innerHTML = r.svg; // drawn from our own fixed parts list
  card.append(
    artEl,
    h("div", { class: "gc-gloss" }),
    h("div", { class: "gc-top" }, h("span", { class: "gc-brand" }, h("b", { text: "GalaxySMP" }), h("span", { text: "GIFT CARD" }))),
    h("div", { class: "gc-bottom" },
      h("div", {}, h("div", { class: "gc-greet", text: r.style.greeting }), to ? h("div", { class: "gc-to", text: `For ${to}` }) : from ? h("div", { class: "gc-to", text: `From ${from}` }) : null),
      h("div", { class: "gc-amount", text: usd(amount) })),
    h("div", { class: "gc-shine" }));
  // tilts toward the pointer, like holding a real card (the foil catches the light)
  card.addEventListener("pointermove", (e) => {
    const b = card.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width - 0.5, y = (e.clientY - b.top) / b.height - 0.5;
    card.style.transform = `perspective(900px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
    card.style.setProperty("--gx", `${(x + 0.5) * 100}%`);
  });
  card.addEventListener("pointerleave", () => { card.style.transform = ""; });
  return card;
}

// The card builder: start from a template (optional), then pick each part.
export function giftCardDialog({ me = {}, design = "galaxy", onDone } = {}) {
  if (!me.signedIn) { location.href = "/community"; return; }
  let template = design;
  const style = styleOf(design);
  let amount = 1000;
  const preview = h("div", { class: "gcb-preview" });
  const to = h("input", { class: "input", id: "gc-to", maxlength: 32, placeholder: "Their name (optional)" });
  const msg = h("textarea", { class: "input", id: "gc-msg", rows: 2, maxlength: 160, placeholder: "Write a short message (optional)" });
  const draw = () => preview.replaceChildren(cardEl(style, amount, { to: to.value.trim() }));
  const pickers = [];
  const refresh = () => { draw(); pickers.forEach((f) => f()); };
  to.addEventListener("input", draw);

  // one row of choices for a part
  const row = (key, items, visual) => {
    const el = h("div", { class: "gcb-opts" });
    const sync = () => el.querySelectorAll("[data-id]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === style[key])));
    items.forEach((it) => {
      const b = h("button", { class: "gcb-opt", type: "button", "data-id": it.id, title: it.name }, visual(it), h("span", { text: it.name }));
      b.addEventListener("click", () => { style[key] = it.id; template = null; refresh(); });
      el.append(b);
    });
    pickers.push(sync);
    sync();
    return el;
  };
  const swatch = (b) => { const s = h("span", { class: "gcb-sw" }); s.style.background = b.bg; return s; };
  const artTile = (a) => { const t = h("span", { class: "gcb-tile" }); const p = renderParts({ ...style, art: a.id, foil: "none" }); t.style.background = p.bg.bg; t.innerHTML = p.svg; return t; };
  const foilChip = (f) => { const s = h("span", { class: "gcb-sw foil" }); s.style.background = f.stops ? `linear-gradient(135deg, ${f.stops.join(", ")})` : "repeating-linear-gradient(45deg, var(--surface-3) 0 6px, var(--surface-2) 6px 12px)"; return s; };
  const patTile = (pt) => { const t = h("span", { class: "gcb-tile" }); const p = renderParts({ ...style, art: "none", foil: style.foil === "none" ? "gold" : style.foil, pattern: pt.id }); t.style.background = "#14152a"; t.innerHTML = p.svg; return t; };

  // the artwork tiles and pattern tiles follow the chosen background and foil, so redraw them when those change
  const artRow = h("div");
  const patRow = h("div");
  const drawArt = () => artRow.replaceChildren(row("art", ARTWORK, artTile));
  const drawPat = () => patRow.replaceChildren(style.foil === "none" ? h("p", { class: "text-3 small", style: "margin:0", text: "Pick a foil color to add foil lines." }) : row("pattern", PATTERNS, patTile));
  let lastBg = style.bg, lastFoil = style.foil;
  pickers.push(() => { if (style.bg !== lastBg) { lastBg = style.bg; drawArt(); } if (style.foil !== lastFoil) { lastFoil = style.foil; drawPat(); } });

  // greeting: presets or your own
  const custom = h("input", { class: "input", id: "gc-greet", maxlength: GREETING_MAX, placeholder: "Or write your own" });
  const greetRow = h("div", { class: "gcb-chips" }, ...GREETINGS.map((g) => h("button", { class: "gcb-chip", type: "button", "data-g": g, text: g,
    onclick: () => { style.greeting = g; custom.value = ""; template = null; refresh(); } })));
  pickers.push(() => greetRow.querySelectorAll("[data-g]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.g === style.greeting))));
  custom.addEventListener("input", () => { const v = custom.value.replace(/\s+/g, " ").trimStart(); if (v.trim()) { style.greeting = v; template = null; refresh(); } });

  // quick starts
  const starts = h("div", { class: "gcb-starts" }, ...TEMPLATES.map((t) => {
    const b = h("button", { class: "gcb-start", type: "button", title: t.name }, cardEl(t.id, amount, { size: "mini" }), h("span", { text: t.name }));
    b.addEventListener("click", () => { Object.assign(style, styleOf(t.id)); template = t.id; custom.value = ""; refresh(); });
    return b;
  }));

  const amounts = h("div", { class: "seg gcb-amounts", role: "group", "aria-label": "Amount" }, ...AMOUNTS.map((a) => {
    const b = h("button", { type: "button", "aria-pressed": String(a === amount), text: usd(a) });
    b.addEventListener("click", () => { amount = a; amounts.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); });
    return b;
  }));
  drawArt(); drawPat(); refresh();
  const section = (title, ...kids) => h("section", { class: "gcb-sec" }, h("h4", { text: title }), ...kids);
  const pay = async (method) => {
    const r = await postJson("/api/giftcards", { template, style, amount, toName: to.value, message: msg.value, method });
    if (r.url) { location.href = r.url; return; }
    if (r.comingSoon) throw new Error(r.message);
    sentDialog(r.card);
    onDone?.();
  };
  const credits = me.infinite ? "Unlimited" : usd(Math.round((me.credits || 0) * 100));
  openDialog({
    title: "Design your gift card",
    body: h("div", { class: "gcb" }, h("div", { class: "gcb-stage" }, preview),
      section("Start from", starts),
      section("Background", row("bg", BACKGROUNDS, swatch)),
      section("Artwork", artRow),
      section("Foil", row("foil", FOILS, foilChip), patRow),
      section("Greeting", greetRow, custom),
      section("Amount and message", h("div", { class: "form" }, field("Amount (Galaxy Credits)", amounts), field("To", to), field("Message", msg),
        h("p", { class: "text-3 small", style: "margin:0", text: `You'll get a private link to share. Whoever opens it can redeem the credits. Your balance: ${credits}.` })))),
    actions: [{ label: "Cancel" }, { label: "Pay by card", onClick: () => pay("card") }, { label: "Pay with credits", kind: "primary", onClick: () => pay("credits") }],
  });
}

// After buying: the link to share
export function sentDialog(card) {
  const url = `${location.origin}${card.link}`;
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast("Link copied."); } catch { prompt("Gift card link:", url); } };
  openDialog({
    title: "Your gift card is ready",
    body: h("div", { class: "gcb-done" }, cardEl(card.style || card.design, card.amount, { to: card.to }),
      h("p", { class: "text-2", style: "margin:0", text: "Send this private link to the person you're gifting. When they open it, they'll unwrap the gift and can redeem the credits." }),
      h("div", { class: "gcb-link" }, h("code", { text: url }), h("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: copy }, iconEl("copy"), "Copy")),
      h("p", { class: "text-3 small", style: "margin:0", text: `Code: ${card.code}` })),
    actions: [
      { label: "Preview", onClick: () => { window.open(card.link, "_blank", "noopener"); return false; } },
      ...(navigator.share ? [{ label: "Share", onClick: async () => { try { await navigator.share({ title: "A GalaxySMP gift card for you", url }); } catch { /* cancelled */ } return false; } }] : []),
      { label: "Done", kind: "primary" }],
  });
}

// Your sent gift cards (in the Store)
export async function myCardsEl() {
  let d;
  try { d = await getJson("/api/giftcards/mine"); } catch { return null; }
  if (!d.cards.length) return null;
  const STATUS = { active: "Not opened yet", redeemed: "Redeemed", refunded: "Refunded" };
  return h("div", { class: "gc-mine" }, h("h3", { text: "Gift cards you've sent" }),
    ...d.cards.map((c) => h("div", { class: "gc-mine-row" }, cardEl(c.style || c.design, c.amount, { size: "mini" }),
      h("div", { class: "gc-mine-main" }, h("b", { text: `${usd(c.amount)}${c.to ? ` for ${c.to}` : ""}` }),
        h("span", { class: "text-3 small", text: c.status === "redeemed" && c.redeemedBy ? `Redeemed by ${c.redeemedBy}` : STATUS[c.status] || c.status })),
      c.status === "active" ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Link", onclick: () => sentDialog(c) }) : null)));
}

// ---------- the gift box (galaxymc.us/gift) ----------
export function giftBox(card, { onOpened } = {}) {
  const r = renderParts(card.style || card.design);
  const d = { box: r.bg.box, ribbon: r.ribbon, accent: r.bg.accent };
  const scene = h("div", { class: "gb-scene" });
  scene.style.setProperty("--box-a", d.box[0]);
  scene.style.setProperty("--box-b", d.box[1]);
  scene.style.setProperty("--ribbon", d.ribbon);
  // the card has a front and a back, so it can spin in 3D when it comes out of the box
  const back = h("div", { class: `gc-card gc-back${r.foil.stops ? " has-foil" : ""}` }, h("div", { class: "gc-gloss" }), h("b", { class: "gc-back-logo", text: "GalaxySMP" }), h("span", { class: "gc-back-sub", text: "GIFT CARD" }));
  back.style.background = r.bg.bg;
  back.style.color = r.bg.ink;
  if (r.foil.stops) back.style.setProperty("--foil", `linear-gradient(135deg, ${r.foil.stops.join(", ")})`);
  const backArt = h("div", { class: "gc-art blur" });
  backArt.innerHTML = renderParts({ ...r.style, foil: "none" }).svg;
  back.prepend(backArt);
  const cardWrap = h("div", { class: "gb-card" }, h("div", { class: "gb-flip" },
    h("div", { class: "gb-face front" }, cardEl(card.style || card.design, card.amount, { from: card.from })), h("div", { class: "gb-face backside" }, back)));
  const box = h("div", { class: "gb-box" },
    h("div", { class: "gb-base" }, h("span", { class: "gb-rib v" })),
    h("div", { class: "gb-lid" }, h("span", { class: "gb-rib v" }), h("span", { class: "gb-bow l" }), h("span", { class: "gb-bow r" }), h("span", { class: "gb-knot" })));
  const rays = h("div", { class: "gb-rays" });
  const burst = h("div", { class: "gb-burst" });
  const hint = h("button", { class: "gb-hint", type: "button", text: "Tap to open" });
  scene.append(rays, cardWrap, box, burst, hint);
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    scene.classList.add("opening");
    hint.remove();
    const colors = [d.ribbon, d.accent, "#ffffff", d.box[0], "#ffd84f"];
    for (let i = 0; i < 70; i++) {
      const p = h("i");
      const ang = Math.random() * Math.PI * 2, dist = 120 + Math.random() * 220;
      p.style.setProperty("--dx", `${Math.cos(ang) * dist}px`);
      p.style.setProperty("--dy", `${Math.sin(ang) * dist - 120}px`);
      p.style.setProperty("--r", `${Math.random() * 720 - 360}deg`);
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${0.35 + Math.random() * 0.25}s`;
      if (i % 3 === 0) p.style.borderRadius = "50%";
      burst.append(p);
    }
    setTimeout(() => { scene.classList.add("opened"); }, 1900);
    setTimeout(() => { onOpened?.(); }, 3300); // after the card has finished spinning
  };
  box.addEventListener("click", open);
  hint.addEventListener("click", open);
  scene.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  scene.tabIndex = 0;
  return { el: scene, open };
}
