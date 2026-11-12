// Control Panel > Players > Join requests (owner only): people asking to join from the How to Join page.
// Chat with them, then Approve (adds their gamertag to the server's allowlist) or Decline.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { renderThread, composer } from "/js/jr-chat.js";

const when = (d) => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const STATUS = { open: ["Waiting", "planned"], approved: ["Approved", "done"], declined: ["Declined", "declined"] };

export function setupJoins({ loaders, toast, setBadge }) {
  let status = "open";
  let openId = null;
  const list = document.getElementById("joins-list");
  const pane = document.getElementById("joins-chat");
  document.querySelectorAll("#joins-filter button").forEach((b) => b.addEventListener("click", () => {
    status = b.dataset.status;
    document.querySelectorAll("#joins-filter button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    loaders.joins();
  }));

  loaders.joins = async () => {
    let d;
    try { d = await getJson(`/api/panel/join-requests?status=${status}`); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    setBadge("joins", d.attention);
    if (!d.requests.length) { list.replaceChildren(h("div", { class: "panel empty", text: status === "open" ? "No one is waiting." : "None yet." })); return; }
    list.replaceChildren(...d.requests.map((r) => {
      const row = h("button", { type: "button", class: `jr-row${r.id === openId ? " active" : ""}`, onclick: () => openChat(r.id) },
        h("div", { class: "jr-row-top" }, h("b", { text: r.gamertag }), r.unread ? h("span", { class: "count-badge", "data-n": String(r.unread), text: String(r.unread) }) : null),
        h("span", { class: "jr-row-last", text: r.last || "" }),
        h("span", { class: "jr-row-meta", text: `${when(r.lastAt)}${r.playedBefore ? " · has played before" : ""}` }));
      return row;
    }));
  };

  async function openChat(id) {
    openId = id;
    list.querySelectorAll(".jr-row").forEach((x) => x.classList.remove("active"));
    const log = h("div", { class: "dm-log jr-log" });
    const head = h("div", { class: "jr-head" });
    const actions = h("div", { class: "cx-row" });
    const form = composer(async (text) => { await postJson(`/api/panel/join-requests/${id}/messages`, { body: text }); await load(); }, "Reply");
    pane.replaceChildren(head, actions, log, form);
    let data;
    async function load() {
      try { data = await getJson(`/api/panel/join-requests/${id}`); } catch (e) { pane.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
      const r = data.request;
      const [label, cls] = STATUS[r.status];
      head.replaceChildren(h("b", { text: r.gamertag }), h("span", { class: `sg-status ${cls}`, text: label }), h("span", { class: "text-3 small", text: `Asked ${when(r.createdAt)}` }));
      actions.replaceChildren(...[
        r.status !== "approved" ? h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Approve and add to server", onclick: () => decide(r, "approved") }) : null,
        r.status === "open" ? h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Decline", onclick: () => decide(r, "declined") }) : null,
      ].filter(Boolean));
      actions.hidden = !actions.childElementCount;
      renderThread(log, data.messages, true, { otherName: r.gamertag });
      loaders.joins();
    }
    async function decide(r, st) {
      const note = h("textarea", { class: "input", id: "jr-note", rows: 3, maxlength: 1000,
        placeholder: st === "approved" ? "Optional. If empty, they get: You're in! + the server address." : "Optional. If empty, they get: Sorry, we can't add you right now." });
      openDialog({
        title: st === "approved" ? `Add ${r.gamertag} to the server?` : `Decline ${r.gamertag}?`,
        body: h("div", { class: "form" },
          st === "approved" ? h("p", { class: "text-2", style: "margin:0", text: "Their gamertag is added to the server's allowlist right away, so they can join." }) : null,
          field("Message to them", note)),
        actions: [{ label: "Cancel" }, { label: st === "approved" ? "Approve" : "Decline", kind: st === "approved" ? "primary" : "danger", onClick: async () => {
          const res = await postJson(`/api/panel/join-requests/${r.id}/decide`, { status: st, message: note.value });
          toast(res.message);
          await load();
        } }],
      });
    }
    await load();
  }

  // keep the list (and the open chat) fresh while the tab is open
  setInterval(() => {
    if (document.hidden || document.querySelector('[data-panel="joins"]')?.hidden) return;
    loaders.joins();
    if (openId && !document.querySelector("dialog[open]")) {
      const log = pane.querySelector(".jr-log");
      if (log) getJson(`/api/panel/join-requests/${openId}`).then((d) => renderThread(log, d.messages, true, { otherName: d.request.gamertag })).catch(() => {});
    }
  }, 10000);
  getJson("/api/panel/join-requests?status=open").then((d) => setBadge("joins", d.attention)).catch(() => {});
}
