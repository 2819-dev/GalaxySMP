// /partner: apply to partner with GalaxySMP or to run a Network Server, then chat with our staff.
// No account needed. The private token is kept in this browser (and in a link you can save).
// Everything the owner writes shows up here as just "Staff".
import { toast } from "/js/site.js";
import { h, field } from "/js/dialog.js";
import { renderThread, composer } from "/js/jr-chat.js";

const KEY = "gx_partner_request";
const box = document.getElementById("pt-box");
const intro = document.getElementById("pt-intro");
const STATUS = { open: ["Waiting for an answer", "planned"], accepted: ["Accepted", "done"], declined: ["Closed", "declined"] };
const KINDS = { partner: "Partner", network: "Network Server" };

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

let kind = new URLSearchParams(location.search).get("type") === "network" ? "network" : "partner";

function showForm(preset) {
  if (preset) kind = preset;
  const seg = h("div", { class: "seg", role: "group", "aria-label": "I want to" },
    ...Object.entries(KINDS).map(([k, label]) => h("button", { type: "button", "aria-pressed": String(k === kind), text: label, onclick: () => { kind = k; refresh(); } })));
  const name = h("input", { class: "input", id: "pt-name", maxlength: 40, autocomplete: "organization", placeholder: "e.g. Retro Realm" });
  const contact = h("input", { class: "input", id: "pt-contact", maxlength: 40, autocomplete: "name", placeholder: "Your name" });
  const about = h("textarea", { class: "input", id: "pt-about", rows: 4, maxlength: 400 });
  const link = h("input", { class: "input", id: "pt-link", maxlength: 200, type: "url", inputmode: "url", placeholder: "https://" });
  const msg = h("textarea", { class: "input", id: "pt-message", rows: 3, maxlength: 500, placeholder: "Optional" });
  const send = h("button", { class: "btn btn-primary", type: "submit" });
  const aboutField = h("div", {});
  const form = h("form", { class: "form pt-form", style: "max-width:560px" },
    field("I want to", seg),
    field("Server or community name", name),
    field("Your name", contact, "Who should we talk to?"),
    aboutField,
    field("Website or Discord (optional)", link, "A link that starts with https://"),
    field("Anything else? (optional)", msg),
    h("div", {}, send));
  function refresh() {
    seg.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(Object.keys(KINDS)[i] === kind)));
    aboutField.replaceChildren(field(kind === "network" ? "What's your server about?" : "What's your community about?", about,
      kind === "network" ? "Tell us the theme, like retro games, survival or roleplay. We use it to design your network logo." : "A sentence or two is plenty."));
    about.placeholder = kind === "network" ? "e.g. A retro games server with arcade minigames and pixel-art builds." : "e.g. A friendly Discord community for Minecraft builders.";
    send.textContent = kind === "network" ? "Apply for a Network Server" : "Apply as a partner";
  }
  refresh();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    send.disabled = true;
    try {
      const d = await api("/api/partner-requests", { kind, name: name.value, contact: contact.value, about: about.value, link: link.value.trim() || undefined, message: msg.value.trim() || undefined });
      store.set(d.token);
      history.replaceState(null, "", `/partner?r=${d.token}#apply`);
      openChat(d.token);
    } catch (err) { toast(err.message); } finally { send.disabled = false; }
  });
  box.replaceChildren(form);
}

let timer = null;
async function openChat(token) {
  intro.textContent = "Our staff will answer you here. Save the private link below to come back from another device.";
  const log = h("div", { class: "dm-log jr-log", "aria-live": "polite" });
  const head = h("div", { class: "jr-head" });
  const link = `${location.origin}/partner?r=${token}`;
  const save = h("p", { class: "text-3 small", style: "margin:10px 0 0" }, "Save this private link: ",
    h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Copy link", onclick: async () => { try { await navigator.clipboard.writeText(link); toast("Link copied."); } catch { prompt("Your private link:", link); } } }));
  let data = null;
  const form = composer(async (text) => { await api(`/api/partner-requests/${token}/messages`, { body: text }); await load(); }, "Message our staff");
  box.replaceChildren(head, h("div", { class: "jr-chat" }, log, form), save);

  async function load() {
    try { data = await api(`/api/partner-requests/${token}`); } catch (e) {
      if (e.status === 404) {
        store.set(null); clearInterval(timer);
        box.replaceChildren(h("p", { class: "text-2", text: "That application couldn't be found." }), h("button", { class: "btn btn-primary", type: "button", text: "Start a new application", onclick: () => showForm() }));
      }
      return;
    }
    const r = data.request;
    const [label, cls] = STATUS[r.status];
    head.replaceChildren(h("b", { text: r.name }), h("span", { class: "text-3 small", text: r.kindName }), h("span", { class: `sg-status ${cls}`, text: label }));
    form.hidden = r.status === "declined";
    renderThread(log, data.messages, false, { ownerName: "Staff", otherName: "You" });
  }
  await load();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) load(); }, 8000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
}

// the two big buttons at the top: pick that option and go to the form
document.querySelectorAll("[data-apply]").forEach((b) => b.addEventListener("click", () => {
  const preset = b.dataset.apply;
  if (!store.get() || !box.querySelector(".jr-chat")) showForm(preset);
  document.getElementById("apply")?.scrollIntoView({ behavior: "smooth" });
}));

const fromLink = new URLSearchParams(location.search).get("r");
if (fromLink) store.set(fromLink);
const saved = fromLink || store.get();
if (saved) openChat(saved);
else showForm();
