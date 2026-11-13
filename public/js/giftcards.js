// Gift cards on the website: the card itself (drawn from giftcard-designs.js), the "Send a gift card" window
// in the Store, your sent cards, and the gift box that opens on galaxymc.us/gift.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { toast, iconEl } from "/js/site.js";
import { DESIGNS, DESIGN, AMOUNTS } from "/js/giftcard-designs.js";

const usd = (c) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;

// The card: 1.586:1 like a real gift card, with a pattern, the design's motif, greeting and amount.
export function cardEl(designId, amount, { to = "", from = "", size = "" } = {}) {
  const d = DESIGN[designId] || DESIGNS[0];
  const card = h("div", { class: `gc-card p-${d.pattern}${size ? ` ${size}` : ""}`, role: "img", "aria-label": `${d.name} gift card, ${usd(amount)}` });
  card.style.background = d.bg;
  card.style.color = d.ink;
  card.style.setProperty("--gc-accent", d.accent);
  const motif = h("div", { class: "gc-motif" });
  motif.innerHTML = d.motif; // fixed SVG from our own design list
  card.append(
    h("div", { class: "gc-pattern" }),
    h("div", { class: "gc-top" }, h("span", { class: "gc-brand" }, h("b", { text: "GalaxySMP" }), h("span", { text: "GIFT CARD" }))),
    motif,
    h("div", { class: "gc-bottom" },
      h("div", {}, h("div", { class: "gc-greet", text: d.greeting }), to ? h("div", { class: "gc-to", text: `For ${to}` }) : from ? h("div", { class: "gc-to", text: `From ${from}` }) : null),
      h("div", { class: "gc-amount", text: usd(amount) })),
    h("div", { class: "gc-shine" }));
  // tilts toward the pointer, like holding a real card
  card.addEventListener("pointermove", (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(900px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
    card.style.setProperty("--gx", `${(x + 0.5) * 100}%`);
  });
  card.addEventListener("pointerleave", () => { card.style.transform = ""; });
  return card;
}

// "Send a gift card": pick a design and amount, add a message, pay with credits or a card.
export function giftCardDialog({ me = {}, design = "galaxy", onDone } = {}) {
  if (!me.signedIn) { location.href = "/community"; return; }
  const state = { design, amount: 1000 };
  const preview = h("div", { class: "gcb-preview" });
  const to = h("input", { class: "input", id: "gc-to", maxlength: 32, placeholder: "Their name (optional)" });
  const msg = h("textarea", { class: "input", id: "gc-msg", rows: 2, maxlength: 160, placeholder: "Write a short message (optional)" });
  const draw = () => preview.replaceChildren(cardEl(state.design, state.amount, { to: to.value.trim() }));
  to.addEventListener("input", draw);
  const groups = [...new Set(DESIGNS.map((d) => d.group))];
  const picker = h("div", { class: "gcb-designs" }, ...groups.map((g) => h("div", { class: "gcb-group" }, h("span", { class: "gcb-group-k", text: g }),
    h("div", { class: "gcb-row" }, ...DESIGNS.filter((d) => d.group === g).map((d) => {
      const b = h("button", { class: "gcb-design", type: "button", "aria-pressed": String(d.id === state.design), title: d.name },
        cardEl(d.id, state.amount, { size: "mini" }), h("span", { text: d.name }));
      b.addEventListener("click", () => { state.design = d.id; picker.querySelectorAll(".gcb-design").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); });
      return b;
    })))));
  const amounts = h("div", { class: "seg gcb-amounts", role: "group", "aria-label": "Amount" }, ...AMOUNTS.map((a) => {
    const b = h("button", { type: "button", "aria-pressed": String(a === state.amount), text: usd(a) });
    b.addEventListener("click", () => { state.amount = a; amounts.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); });
    return b;
  }));
  draw();
  const pay = async (method) => {
    const r = await postJson("/api/giftcards", { design: state.design, amount: state.amount, toName: to.value, message: msg.value, method });
    if (r.url) { location.href = r.url; return; }
    if (r.comingSoon) throw new Error(r.message);
    sentDialog(r.card);
    onDone?.();
  };
  const credits = me.infinite ? "Unlimited" : usd(Math.round((me.credits || 0) * 100));
  openDialog({
    title: "Send a gift card",
    body: h("div", { class: "gcb" }, preview, h("div", { class: "form" },
      field("Design", picker), field("Amount (Galaxy Credits)", amounts), field("To", to), field("Message", msg),
      h("p", { class: "text-3 small", style: "margin:0", text: `You'll get a private link to share. Whoever opens it can redeem the credits. Your balance: ${credits}.` }))),
    actions: [{ label: "Cancel" }, { label: "Pay by card", onClick: () => pay("card") }, { label: "Pay with credits", kind: "primary", onClick: () => pay("credits") }],
  });
}

// After buying: the link to share
export function sentDialog(card) {
  const url = `${location.origin}${card.link}`;
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast("Link copied."); } catch { prompt("Gift card link:", url); } };
  openDialog({
    title: "Your gift card is ready",
    body: h("div", { class: "gcb-done" }, cardEl(card.design, card.amount, { to: card.to }),
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
    ...d.cards.map((c) => h("div", { class: "gc-mine-row" }, cardEl(c.design, c.amount, { size: "mini" }),
      h("div", { class: "gc-mine-main" }, h("b", { text: `${usd(c.amount)}${c.to ? ` for ${c.to}` : ""}` }),
        h("span", { class: "text-3 small", text: c.status === "redeemed" && c.redeemedBy ? `Redeemed by ${c.redeemedBy}` : STATUS[c.status] || c.status })),
      c.status === "active" ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Link", onclick: () => sentDialog(c) }) : null)));
}

// ---------- the gift box (galaxymc.us/gift) ----------
export function giftBox(card, { onOpened } = {}) {
  const d = DESIGN[card.design] || DESIGNS[0];
  const scene = h("div", { class: "gb-scene" });
  scene.style.setProperty("--box-a", d.box[0]);
  scene.style.setProperty("--box-b", d.box[1]);
  scene.style.setProperty("--ribbon", d.ribbon);
  const cardWrap = h("div", { class: "gb-card" }, cardEl(card.design, card.amount, { from: card.from }));
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
    setTimeout(() => { scene.classList.add("opened"); onOpened?.(); }, 1900);
  };
  box.addEventListener("click", open);
  hint.addEventListener("click", open);
  scene.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  scene.tabIndex = 0;
  return { el: scene, open };
}
