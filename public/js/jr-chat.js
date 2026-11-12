// The chat bubbles shared by the How to Join request chat and Control Panel > Join requests.
import { h } from "/js/dialog.js";

const when = (d) => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// mine: true for the owner's view (owner messages on the right), false for the requester's view.
export function renderThread(box, messages, ownerSide, { ownerName = "GalaxySMP", otherName = "" } = {}) {
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.replaceChildren(...messages.map((m) => {
    const mine = m.fromOwner === ownerSide;
    return h("div", { class: `dm-msg${mine ? " mine" : ""}` },
      h("div", { class: "dm-bubble" },
        !mine ? h("div", { class: "jr-from", text: m.fromOwner ? ownerName : otherName }) : null,
        h("div", { class: "dm-text", text: m.body }),
        h("div", { class: "dm-meta", text: when(m.at) })));
  }));
  if (atBottom || !box.dataset.seen) box.scrollTop = box.scrollHeight;
  box.dataset.seen = "1";
}

export function composer(onSend, placeholder) {
  const input = h("textarea", { class: "input dm-input", rows: 1, maxlength: 500, placeholder, "aria-label": "Message" });
  const send = h("button", { class: "btn btn-primary", type: "submit", text: "Send" });
  const form = h("form", { class: "dm-composer jr-composer" }, input, send);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    send.disabled = true;
    try { await onSend(text); input.value = ""; } finally { send.disabled = false; input.focus(); }
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  return form;
}
