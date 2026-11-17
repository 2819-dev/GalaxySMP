// #Events > Play Sessions: "Bedwars at 7 pm, who's in?" Post a plan, tap I'm in, optional player limit with a
// waitlist, a small chat on each plan, and a reminder 10 minutes before it starts.
import { h, getJson, postJson, openDialog, field, select } from "/js/dialog.js";
import { iconEl } from "/js/site.js";
import { faceSvg } from "/js/face.js";

const face = (src, name, size = 26) => {
  const img = h("img", { class: "ps-face", alt: "", title: name, width: size, height: size, src: src || faceSvg(name || "?") });
  img.onerror = () => { img.onerror = null; img.src = faceSvg(name || "?"); };
  return img;
};
const when = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400_000);
  const day = d.toDateString() === today.toDateString() ? "Today" : d.toDateString() === tomorrow.toDateString() ? "Tomorrow" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return `${day} at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};
const GAME_ICONS = { Survival: "survival", Bedwars: "sword", Skyblock: "skyblock", Creative: "creative", Minigames: "minigames", "Build together": "bricks", Exploring: "compass", Other: "users" };

export function renderPlaySessions(box, { toast }) {
  const list = h("div", { class: "stack", style: "gap:10px" });
  let games = [];
  const plan = h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => planDialog() }, iconEl("plus"), "Plan a session");
  box.append(
    h("div", { class: "ps-head" },
      h("div", {}, h("h2", { class: "cx-h", style: "margin:0", text: "Play sessions" }),
        h("p", { class: "text-3 small", style: "margin:2px 0 0", text: "Plan a time to play together. Tap I'm in to join, and you'll get a reminder 10 minutes before." })),
      plan),
    list);
  const openChats = new Set();

  const act = async (body) => {
    try { const r = await postJson("/api/sessions", body); if (r.message) toast(r.message); load(); return r; } catch (e) { toast(e.message); return null; }
  };

  async function load() {
    let d;
    try { d = await getJson("/api/sessions"); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    games = d.games;
    list.replaceChildren(...(d.sessions.length ? d.sessions.map((s) => card(s, d.canModerate)) : [h("div", { class: "panel empty", text: "No plans yet. Be the first: tap Plan a session." })]));
  }

  function card(s, canModerate) {
    const started = new Date(s.startsAt) <= new Date();
    const full = s.max && s.going.length >= s.max;
    const spots = s.max ? (full ? `Full · ${s.waiting.length} waiting` : `${s.max - s.going.length} spot${s.max - s.going.length === 1 ? "" : "s"} left`) : `${s.going.length} going`;
    const btn = s.me.host ? null
      : s.me.in ? h("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: () => act({ action: "leave", id: s.id }) }, iconEl("check"), "You're in · Leave")
      : s.me.waiting ? h("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: () => act({ action: "leave", id: s.id }) }, "On the waitlist · Leave")
      : h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => act({ action: "join", id: s.id }) }, full ? "Join the waitlist" : "I'm in");
    const chatBox = h("div", { class: "ps-chat", hidden: !openChats.has(s.id) });
    const chatBtn = h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-expanded": String(openChats.has(s.id)) }, iconEl("message"), s.messages ? `Chat (${s.messages})` : "Chat");
    chatBtn.addEventListener("click", () => {
      const open = chatBox.hidden;
      chatBox.hidden = !open;
      chatBtn.setAttribute("aria-expanded", String(open));
      if (open) { openChats.add(s.id); loadChat(s, chatBox); } else openChats.delete(s.id);
    });
    if (openChats.has(s.id)) loadChat(s, chatBox);
    return h("article", { class: `panel ps-card${started ? " is-now" : ""}` },
      h("div", { class: "ps-top" },
        h("span", { class: "ps-game" }, iconEl(GAME_ICONS[s.game] || "users"), s.game),
        h("span", { class: "ps-when", text: started ? "Happening now" : when(s.startsAt) })),
      s.note ? h("p", { class: "ps-note", text: s.note }) : null,
      h("div", { class: "ps-people" },
        h("span", { class: "ps-faces" }, ...s.going.slice(0, 10).map((m) => face(m.head, m.name))),
        h("span", { class: "text-3 small", text: `${s.host.name}'s plan · ${spots}` })),
      h("div", { class: "ps-actions" }, btn, chatBtn,
        s.me.host || canModerate ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Cancel", onclick: () => openDialog({ title: "Cancel this session?", body: h("p", { class: "text-2", style: "margin:0", text: "Everyone who joined gets a notification." }),
          actions: [{ label: "Keep it" }, { label: "Cancel session", kind: "danger", onClick: () => act({ action: "cancel", id: s.id }) }] }) }) : null),
      chatBox);
  }

  async function loadChat(s, box) {
    let d;
    try { d = await getJson(`/api/sessions/${s.id}/chat`); } catch (e) { box.replaceChildren(h("p", { class: "text-3 small", text: e.message })); return; }
    const input = h("input", { class: "input", maxlength: 200, placeholder: "e.g. I'll bring the beds!", "aria-label": "Message" });
    const form = h("form", { class: "ps-chat-form" }, input, h("button", { class: "btn btn-primary btn-sm", type: "submit", "aria-label": "Send" }, iconEl("send")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      try { await postJson("/api/sessions", { action: "chat", id: s.id, body: input.value }); input.value = ""; loadChat(s, box); } catch (er) { toast(er.message); }
    });
    box.replaceChildren(
      h("div", { class: "ps-msgs" }, ...(d.messages.length ? d.messages.map((m) => h("div", { class: "ps-msg" }, face(m.head, m.name, 20), h("span", {}, h("b", { text: `${m.name} ` }), m.body)))
        : [h("p", { class: "text-3 small", style: "margin:0", text: "No messages yet." })])),
      form);
    const msgs = box.querySelector(".ps-msgs");
    msgs.scrollTop = msgs.scrollHeight;
  }

  function planDialog() {
    const game = select("ps-game", games.map((g) => [g, g]), "Bedwars");
    const at = h("input", { class: "input", id: "ps-at", type: "datetime-local" });
    const soon = new Date(Date.now() + 60 * 60_000); soon.setMinutes(0, 0, 0);
    at.value = new Date(soon.getTime() - soon.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    const max = h("input", { class: "input", id: "ps-max", type: "number", min: 2, max: 50, placeholder: "No limit" });
    const note = h("input", { class: "input", id: "ps-note", maxlength: 120, placeholder: "e.g. Doubles, beginners welcome!" });
    openDialog({ title: "Plan a session", body: h("div", { class: "form" },
      field("What will you play?", game), field("When", at), field("Player limit (optional)", max, "When it's full, others join a waitlist."), field("Note (optional)", note)),
    actions: [{ label: "Cancel" }, { label: "Post", kind: "primary", onClick: async () => {
      if (!at.value) throw new Error("Pick a time.");
      const r = await postJson("/api/sessions", { action: "create", game: game.value, at: new Date(at.value).toISOString(), max: max.value ? Number(max.value) : null, note: note.value });
      toast(r.message); load();
    } }] });
  }

  load();
  return { reload: load };
}
