// How to Join > "Request to join": type your gamertag, then chat with the owner until you're added.
// No account needed. The private token is kept in this browser (and in a link you can save).
import { toast, inviteRef } from "/js/site.js";
import { h, field } from "/js/dialog.js";
import { renderThread, composer } from "/js/jr-chat.js";

const KEY = "gx_join_request";
const box = document.getElementById("jr-box");
const intro = document.getElementById("jr-intro");
const STATUS = { open: ["Waiting for an answer", "planned"], approved: ["You're in!", "done"], declined: ["Closed", "declined"] };

const store = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* private mode: the link still works */ } },
};

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.ok) throw Object.assign(new Error(d.error || "Something went wrong. Please try again."), { status: res.status });
  return d;
}

function showForm() {
  const tag = h("input", { class: "input", id: "jr-gamertag", maxlength: 16, autocomplete: "nickname", placeholder: "e.g. Steve1234" });
  const msg = h("textarea", { class: "input", id: "jr-message", rows: 3, maxlength: 500, placeholder: "Say hi! How did you hear about GalaxySMP? (optional)" });
  const send = h("button", { class: "btn btn-primary", type: "submit", text: "Send request" });
  const form = h("form", { class: "form", style: "max-width:520px" },
    field("Your Xbox gamertag", tag, "Exactly as it shows in Minecraft, including spaces."),
    field("Message", msg), h("div", {}, send));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    send.disabled = true;
    try {
      const d = await api("/api/join-requests", { gamertag: tag.value, message: msg.value.trim() || undefined, ref: inviteRef() || undefined });
      store.set(d.token);
      history.replaceState(null, "", `/join?r=${d.token}#join-request`);
      openChat(d.token);
    } catch (err) { toast(err.message); } finally { send.disabled = false; }
  });
  box.replaceChildren(form);
  tag.focus();
}

let timer = null;
async function openChat(token) {
  intro.hidden = true;
  const log = h("div", { class: "dm-log jr-log", "aria-live": "polite" });
  const head = h("div", { class: "jr-head" });
  const link = `${location.origin}/join?r=${token}`;
  const save = h("p", { class: "text-3 small", style: "margin:10px 0 0" }, "Save this private link to come back from another device: ",
    h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Copy link", onclick: async () => { try { await navigator.clipboard.writeText(link); toast("Link copied."); } catch { prompt("Your private link:", link); } } }));
  let data = null;
  const form = composer(async (text) => { await api(`/api/join-requests/${token}/messages`, { body: text }); await load(); }, "Message GalaxySMP");
  box.replaceChildren(head, h("div", { class: "jr-chat" }, log, form), save);

  async function load() {
    try { data = await api(`/api/join-requests/${token}`); } catch (e) {
      if (e.status === 404) { store.set(null); clearInterval(timer); box.replaceChildren(h("p", { class: "text-2", text: "That request couldn't be found." }), h("button", { class: "btn btn-primary", type: "button", text: "Request to join", onclick: showForm })); }
      return;
    }
    const [label, cls] = STATUS[data.request.status];
    head.replaceChildren(h("b", { text: data.request.gamertag }), h("span", { class: `sg-status ${cls}`, text: label }));
    form.hidden = data.request.status === "declined";
    renderThread(log, data.messages, false, { otherName: "GalaxySMP" });
  }
  await load();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) load(); }, 8000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
}

const fromLink = new URLSearchParams(location.search).get("r");
if (fromLink) store.set(fromLink);
const saved = fromLink || store.get();
if (saved) openChat(saved);
else document.getElementById("jr-start")?.addEventListener("click", showForm);

// Came with a friend's invite link: say who invited them. Everyone still asks to join and waits for the owner.
(async () => {
  const ref = inviteRef();
  if (!ref || !intro) return;
  try {
    const d = await api(`/api/referrals/who?ref=${encodeURIComponent(ref)}`);
    if (!d.name) return;
    intro.replaceChildren(h("b", { text: `${d.name} invited you to GalaxySMP!` }), " Send a request to join below. Every new player is approved by the owner before they can play.");
    if (location.hash !== "#join-request") document.getElementById("join-request")?.scrollIntoView({ behavior: "smooth" });
  } catch { /* the normal text stays */ }
})();
