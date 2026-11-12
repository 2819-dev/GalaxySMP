// Polls inside chat channels. Galaxy+ and Galaxy Pro+ members (and staff) get a Poll button next to the
// message box; the poll is posted as a message, and everyone votes right there. Counts update live.
import { toast } from "/js/site.js";
import { h, openDialog, getJson } from "/js/dialog.js";
import { chatState as state, messageBodyHooks, composerHooks, eventHooks } from "/js/chat.js";
import { pollCard, pollDialog } from "/js/community-extra.js";

const cache = new Map();  // poll id -> latest poll data, so re-drawn messages show it at once

function canPoll() {
  if (!state.me) return false;
  if ((state.me.role?.power || 0) >= 50) return true;
  const plan = state.members.get(state.me.id)?.plan;
  return plan === "plus" || plan === "pro";
}

async function refresh(id) {
  try {
    const d = await getJson(`/api/chat/polls/${id}`);
    cache.set(id, d.poll);
  } catch {
    cache.set(id, null);
  }
  for (const slot of document.querySelectorAll(`.msg-poll[data-poll="${id}"]`)) draw(slot, id);
}

function draw(slot, id) {
  const pl = cache.get(id);
  if (pl === null) { slot.replaceChildren(h("p", { class: "text-3 small", text: "This poll was removed." })); return; }
  if (!pl) return;
  slot.replaceChildren(pollCard(pl, false, () => refresh(id), toast, { chat: true }));
}

// A poll message: show the poll card instead of the "📊 Poll: ..." text.
messageBodyHooks.push((m, body, text) => {
  if (!m.pollId) return;
  text.hidden = true;
  const slot = h("div", { class: "msg-poll", "data-poll": String(m.pollId) });
  body.append(slot);
  if (cache.has(m.pollId)) draw(slot, m.pollId);
  else { cache.set(m.pollId, undefined); refresh(m.pollId); }
});

// Someone voted or the poll closed: fetch the new counts (only if it's on screen).
eventHooks.push((data) => {
  if (data.type !== "poll") return;
  const id = Number(data.id);
  if (document.querySelector(`.msg-poll[data-poll="${id}"]`)) refresh(id);
  else cache.delete(id);
});

let channel = null;
composerHooks.push((ch, open) => {
  channel = ch;
  const btn = document.getElementById("composer-poll");
  if (btn) btn.hidden = !open;
});

document.getElementById("composer-poll")?.addEventListener("click", () => {
  if (!channel) return;
  if (!canPoll()) {
    openDialog({
      title: "Polls are a Galaxy+ perk",
      body: h("p", { class: "text-2", text: "Galaxy+ and Galaxy Pro+ members can post polls in any chat. Everyone can vote." }),
      actions: [{ label: "Close" }, { label: "See Galaxy+", kind: "primary", onClick: () => { location.href = "/store"; } }],
    });
    return;
  }
  pollDialog(() => {}, toast, { channelId: channel.id, channelName: channel.name });
});
