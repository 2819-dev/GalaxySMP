// Community extras: chat levels next to names, Thank (25 thanks = the Helpful badge), the Question of the Day card
// (answer in a thread), welcome cards with a Wave button, @GalaxySMP's BOT tag, "While you were away", and a
// once-a-minute "Community is open" ping (15 minutes + 1 message a day keeps Friend Streaks going).
import { toast, iconEl } from "/js/site.js";
import { h, getJson, postJson, openDialog } from "/js/dialog.js";
import { chatState as state, chatSend, messageHeadHooks, messageBodyHooks, messageActionHooks, rerenderMessage, openAt, botTag } from "/js/chat.js";
import { openThread } from "/js/chat-threads.js";

const me = () => state.me?.id;

// ---------- names: BOT tag and chat level ----------
messageHeadHooks.push((m, head) => {
  if (m.bot) { head.append(botTag()); return; }
  if (m.author.level) head.append(h("span", { class: "lvl-pill", title: `Chat level ${m.author.level}`, text: `Lv ${m.author.level}` }));
});

// ---------- message extras ----------
messageBodyHooks.push((m, body) => {
  if (m.kind === "qotd") {
    body.classList.add("qotd-card");
    const n = m.thread?.count || 0;
    body.append(h("div", { class: "qotd-foot" },
      h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: (e) => { e.stopPropagation(); openThread(m.id); } }, iconEl("chat"), n ? "Answer" : "Be the first to answer"),
      h("span", { class: "text-3 small", text: n ? `${n} answer${n === 1 ? "" : "s"}` : "A new question every morning" })));
  }
  if (m.kind === "welcome") {
    body.classList.add("welcome-card");
    const waves = m.waves || [];
    const mine = waves.includes(me());
    const self = m.meta?.userId && m.meta.userId === me();
    const btn = h("button", { class: `btn btn-sm ${mine ? "btn-secondary" : "btn-primary"} wave-btn`, type: "button", disabled: mine || self,
      onclick: async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        try { await postJson(`/api/chat/messages/${m.id}/wave`, {}); m.waves = [...waves, me()]; rerenderMessage(m.id); } catch (err) { toast(err.message); btn.disabled = false; }
      } }, h("span", { class: "wave-hand", text: "👋" }), mine ? "Waved" : self ? "Your welcome!" : "Wave");
    body.append(h("div", { class: "welcome-foot" }, btn,
      h("span", { class: "text-3 small", text: waves.length ? `${waves.length} ${waves.length === 1 ? "person" : "people"} waved` : "Be the first to say hi" })));
  }
  if (m.kind === "support" && m.meta?.support) supportCard(m, body);
  if (!m.bot && m.thanks?.length) {
    const mine = m.thanks.includes(me());
    body.append(h("button", { class: `thanks-chip${mine ? " mine" : ""}`, type: "button", title: mine ? "You thanked this message (tap to undo)" : "Thank this message",
      onclick: (e) => { e.stopPropagation(); thank(m); } }, "🙏 ", h("b", { text: String(m.thanks.length) }), m.thanks.length === 1 ? " thank" : " thanks"));
  }
});

messageActionHooks.push((m, actions, actionBtn) => {
  if (m.bot || !m.author.id || m.author.id === me()) return;
  const b = actionBtn("handshake", m.thanks?.includes(me()) ? "Take back your thanks" : "Thank (helps them earn the Helpful badge)", () => thank(m));
  if (m.thanks?.includes(me())) b.classList.add("on");
  actions.append(b);
});

async function thank(m) {
  if (m.author.id === me()) return;
  try {
    const r = await postJson(`/api/chat/messages/${m.id}/thank`, {});
    const set = new Set(m.thanks || []);
    if (r.thanked) set.add(me()); else set.delete(me());
    m.thanks = [...set];
    rerenderMessage(m.id);
    if (r.thanked) toast("Thanks sent 🙏");
  } catch (e) { toast(e.message); }
}

// ---------- "Community is open" once a minute (only while the page is on screen) ----------
setInterval(() => {
  if (document.hidden || !state.me) return;
  try { chatSend({ type: "active" }); } catch { /* not connected right now */ }
}, 60_000);

// ---------- While you were away ----------
let awayShown = false;
export async function showAway() {
  if (awayShown) return;
  awayShown = true;
  let d;
  try { d = await getJson("/api/community/away"); } catch { return; }
  if (!d.show) return;
  const days = Math.max(1, Math.round((Date.now() - new Date(d.since)) / 864e5));
  const sec = (title, ...kids) => h("section", { class: "away-sec" }, h("h3", { text: title }), ...kids);
  const jump = (channelId, id) => { document.querySelector("dialog[open]")?.close(); openAt(channelId, id).catch(() => {}); };
  openDialog({
    title: "While you were away",
    body: h("div", { class: "away" },
      h("p", { class: "text-2", style: "margin:0", text: `Here's what happened in the last ${days} day${days === 1 ? "" : "s"}.` }),
      d.mentions ? h("p", { class: "away-mention" }, iconEl("at"), `${d.mentions} message${d.mentions === 1 ? "" : "s"} mentioned or replied to you.`) : null,
      d.channels.length ? sec("Busiest channels", h("div", { class: "away-chips" }, ...d.channels.map((c) => h("span", { class: "away-chip" }, `#${c.name}`, h("b", { text: ` ${c.messages}` }))))) : null,
      d.top.length ? sec("Most loved messages", ...d.top.map((t) => h("button", { class: "away-msg", type: "button", onclick: () => jump(t.channelId, t.id) },
        h("span", { class: "text-3 small", text: `${t.author} in #${t.channel} · ${t.reactions} reaction${t.reactions === 1 ? "" : "s"}` }), h("span", { class: "away-quote", text: t.content })))) : null,
      d.newMembers.count ? sec("New players", h("p", { class: "text-2", style: "margin:0", text: `${d.newMembers.count} new player${d.newMembers.count === 1 ? "" : "s"} joined${d.newMembers.names.length ? `: ${d.newMembers.names.join(", ")}${d.newMembers.count > d.newMembers.names.length ? " and more" : ""}` : ""}. Say hi in #Chat!` })) : null,
      d.events.length ? sec("Coming up", ...d.events.map((e) => h("p", { class: "away-ev" }, iconEl("calendar"), h("b", { text: e.title }), h("span", { class: "text-3 small", text: ` · ${new Date(e.startsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` })))) : null,
      d.level?.level ? h("p", { class: "text-3 small", style: "margin:0", text: `You're chat level ${d.level.level} (#${d.level.rank} on the server). Type !level in #Bot Commands.` }) : null),
    actions: [{ label: "Let's go", kind: "primary" }],
  });
}
// shown shortly after Community opens (once the chat has loaded)
setTimeout(() => { if (state.me) showAway(); }, 2500);
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.me) showAway(); });

// ---------- /support requests in #Staff Chat: "I'm on it" and Reply (the player sees both in game) ----------
function supportCard(m, body) {
  const sup = m.meta.support;
  body.classList.add("support-card");
  const act = async (payload, btn) => {
    if (btn) btn.disabled = true;
    try {
      const r = await postJson(`/api/chat/messages/${m.id}/support`, payload);
      toast(r.message || "Done.");
    } catch (err) { toast(err.message); if (btn) btn.disabled = false; }
  };
  const mine = sup.claimedBy && sup.claimedBy === state.me?.username;
  const status = h("span", { class: `support-status${sup.claimedBy ? " on" : ""}`,
    text: sup.claimedBy ? (mine ? "You're on it" : `${sup.claimedBy} is on it`) : "Waiting for staff" });
  const claim = h("button", { class: "btn btn-primary btn-sm", type: "button", hidden: Boolean(sup.claimedBy), text: "I'm on it",
    onclick: (e) => { e.stopPropagation(); act({ action: "claim" }, claim); } });
  const reply = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Reply in game",
    onclick: (e) => {
      e.stopPropagation();
      const input = h("textarea", { class: "input", id: "support-reply", rows: 3, maxlength: 300, placeholder: "e.g. I'm teleporting to you now" });
      openDialog({
        title: `Reply to ${sup.name}`,
        body: h("div", { class: "form" }, h("p", { class: "text-2", style: "margin:0", text: `${sup.name} sees this in game (or the next time they join).` }), input),
        actions: [{ label: "Cancel" }, { label: "Send", kind: "primary", onClick: async () => {
          if (!input.value.trim()) throw new Error("Write a reply first.");
          const r = await postJson(`/api/chat/messages/${m.id}/support`, { action: "reply", text: input.value.trim() });
          toast(r.message || "Sent.");
        } }],
      });
      setTimeout(() => input.focus(), 50);
    } });
  const replies = (sup.replies || []).map((r) => h("div", { class: "support-reply" }, h("b", { text: `${r.by}: ` }), r.text));
  body.append(h("div", { class: "support-foot" }, h("div", { class: "support-actions" }, status, claim, reply), replies.length ? h("div", { class: "support-replies" }, replies) : null));
}
