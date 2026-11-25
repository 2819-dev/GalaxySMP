// Someone is calling you (2.90): a banner at the top of the Community page with Answer and Decline, and a soft ring.
// Answer opens the call on the Voice page; Decline tells the caller. It goes away by itself after 30 seconds.
import { h, postJson } from "/js/dialog.js";
import { iconEl } from "/js/site.js";

let current = null;

function ringOnce(ctx) {
  const t0 = ctx.currentTime;
  [880, 660].forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f;
    const start = t0 + i * 0.43;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.14, start + 0.02);
    g.gain.linearRampToValueAtTime(0, start + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start(start);
    o.stop(start + 0.4);
  });
}

export function endRing(data) {
  if (!current || (data?.id && current.id !== data.id)) return;
  clearInterval(current.timer);
  clearTimeout(current.timeout);
  current.ctx?.close().catch(() => {});
  current.el.remove();
  current = null;
}

export function showRing(data) {
  endRing();
  const answer = h("a", { class: "btn btn-primary call-answer", href: `/voice?answer=${encodeURIComponent(data.id)}` }, iconEl("phone"), "Answer");
  const decline = h("button", { class: "btn btn-danger", type: "button", text: "Decline" });
  const el = h("div", { class: "call-banner", role: "alertdialog", "aria-label": `${data.from} is calling you` },
    h("span", { class: "call-ring", "aria-hidden": "true", text: "📞" }),
    h("div", { class: "call-banner-text" }, h("b", { text: data.from }),
      h("span", { class: "text-3 small", text: data.with?.length ? `is calling you, with ${data.with.join(", ")}` : "is calling you" })),
    h("div", { class: "call-banner-actions" }, decline, answer));
  document.body.append(el);
  current = { id: data.id, el };
  decline.addEventListener("click", () => {
    postJson("/api/calls/decline", { id: data.id }).catch(() => {});
    endRing();
  });
  try {   // browsers only allow sound after you've used the page; if not, the banner still shows
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    current.ctx = ctx;
    ringOnce(ctx);
    current.timer = setInterval(() => ringOnce(ctx), 2000);
  } catch { /* no sound */ }
  current.timeout = setTimeout(() => endRing({ id: data.id }), 32000);
}
