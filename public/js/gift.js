// galaxymc.us/gift?c=CODE: a gift card someone sent you. Tap the box to open it, then redeem the credits.
import { h, getJson, postJson } from "/js/dialog.js";
import { toast } from "/js/site.js";
import { giftBox } from "/js/giftcards.js";

const root = document.getElementById("gift-root");
const usd = (c) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;

function codeForm(message) {
  const input = h("input", { class: "input gift-code-in", id: "gift-code", placeholder: "GALX-XXXX-XXXX-XXXX", autocapitalize: "characters", spellcheck: "false", maxlength: 24 });
  const go = h("button", { class: "btn btn-primary", type: "submit", text: "Open gift card" });
  const form = h("form", { class: "gift-code" }, input, go);
  form.addEventListener("submit", (e) => { e.preventDefault(); location.href = `/gift?c=${encodeURIComponent(input.value.trim())}`; });
  root.replaceChildren(h("section", { class: "gift-empty" },
    h("h1", { text: "Redeem a gift card" }),
    h("p", { class: "text-2", text: message || "Enter the code from your GalaxySMP gift card." }), form));
}

async function load() {
  const code = new URLSearchParams(location.search).get("c");
  if (!code) return codeForm();
  let d;
  try { d = await getJson(`/api/giftcards/open?c=${encodeURIComponent(code)}`); } catch (e) { return codeForm(e.message); }
  const c = d.card;
  let me = null;
  try { me = (await getJson("/api/me")).user; } catch { /* signed out */ }
  const info = h("section", { class: "gift-info", hidden: true });
  const redeemed = c.status === "redeemed";
  const action = redeemed
    ? h("p", { class: "gift-note", text: `This gift card has already been redeemed${c.redeemedBy ? ` by ${c.redeemedBy}` : ""}.` })
    : me
      ? h("button", { class: "btn btn-primary gift-redeem", type: "button", text: `Add ${usd(c.amount)} to my account`, onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await postJson("/api/giftcards/redeem", { code });
          info.replaceChildren(h("div", { class: "gift-thanks" }, h("h2", { text: "It's yours!" }), h("p", { class: "text-2", text: r.message }),
            h("a", { class: "btn btn-primary", href: "/store", text: "Go to the Store" })));
        } catch (err) { toast(err.message); e.target.disabled = false; }
      } })
      : h("div", { class: "gift-signin" }, h("p", { class: "text-2", text: "Sign in to your GalaxySMP account to add these credits." }),
        h("a", { class: "btn btn-primary", href: "/community", text: "Sign in to redeem", onclick: () => {
          try { localStorage.setItem("gx_return", JSON.stringify({ url: location.pathname + location.search, at: Date.now() })); } catch { /* storage blocked */ }
        } }));
  info.append(...[
    h("p", { class: "gift-from", text: `From ${c.from}${c.to ? ` to ${c.to}` : ""}` }),
    c.message ? h("blockquote", { class: "gift-msg", text: c.message }) : null,
    h("p", { class: "gift-amt" }, h("b", { text: usd(c.amount) }), " in Galaxy Credits"),
    h("p", { class: "text-3 small", style: "margin:0", text: "Spend them on anything in the GalaxySMP Store." }),
    action].filter(Boolean));
  const { el } = giftBox(c, { onOpened: () => { info.hidden = false; } });
  root.replaceChildren(h("div", { class: "gift-page" },
    h("p", { class: "gift-kicker", text: redeemed ? "A GalaxySMP gift card" : `${c.from} sent you a gift` }), el, info));
}
load();
