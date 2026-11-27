// Control Panel > Join requests > Partners (owner only): applications from the /partner page, and the Network
// Servers set up from them. Whatever you reply, the applicant sees "Staff". Each Network Server connects with its own
// token (shown once), which can be reset or paused without touching anything else.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { renderThread, composer } from "/js/jr-chat.js";

const when = (d) => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const STATUS = { open: ["Waiting", "planned"], accepted: ["Accepted", "done"], declined: ["Declined", "declined"] };
const counts = { joins: 0, partners: 0 };

// The tab's badge is join requests + partner applications waiting.
export function setJoinsBadge(setBadge, which, n) {
  counts[which] = Number(n) || 0;
  setBadge("joins", counts.joins + counts.partners);
  for (const [k, id] of [["joins", "mode-joins-count"], ["partners", "mode-partners-count"]]) {
    const el = document.getElementById(id);
    if (el) { el.textContent = counts[k] ? String(counts[k]) : ""; el.dataset.n = String(counts[k]); }
  }
}

export function setupPartners({ loaders, toast, setBadge }) {
  let status = "open";
  let openId = null;
  const list = document.getElementById("partners-list");
  const pane = document.getElementById("partners-chat");
  const serversBox = document.getElementById("partner-servers");
  const joinsView = document.getElementById("joins-view");
  const partnersView = document.getElementById("partners-view");

  document.querySelectorAll("#joins-mode button").forEach((b) => b.addEventListener("click", () => {
    const partners = b.dataset.mode === "partners";
    document.querySelectorAll("#joins-mode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    joinsView.hidden = partners;
    partnersView.hidden = !partners;
    if (partners) loadAll(); else loaders.joins?.();
  }));
  document.querySelectorAll("#partners-filter button").forEach((b) => b.addEventListener("click", () => {
    status = b.dataset.status;
    document.querySelectorAll("#partners-filter button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    loadList();
  }));
  document.getElementById("partner-server-new")?.addEventListener("click", () => newServer());

  async function loadList() {
    let d;
    try { d = await getJson(`/api/panel/partner-requests?status=${status}`); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    setJoinsBadge(setBadge, "partners", d.attention);
    if (!d.requests.length) { list.replaceChildren(h("div", { class: "panel empty", text: status === "open" ? "No one is waiting." : "None yet." })); return; }
    list.replaceChildren(...d.requests.map((r) => h("button", { type: "button", class: `jr-row${r.id === openId ? " active" : ""}`, onclick: () => openChat(r.id) },
      h("div", { class: "jr-row-top" }, h("b", { text: r.name }), h("span", { class: "text-3 small", text: r.kindName }), r.unread ? h("span", { class: "count-badge", "data-n": String(r.unread), text: String(r.unread) }) : null),
      h("span", { class: "jr-row-last", text: r.last ? r.last.split("\n").slice(-1)[0] : "" }),
      h("span", { class: "jr-row-meta", text: `${when(r.lastAt)} · ${r.contact}` }))));
  }

  async function loadServers() {
    let d;
    try { d = await getJson("/api/panel/partner-servers"); } catch (e) { serversBox.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    if (!d.servers.length) { serversBox.replaceChildren(h("div", { class: "panel empty", text: "No Network Servers yet. Accept an application, then set one up here." })); return; }
    serversBox.replaceChildren(...d.servers.map((s) => {
      const state = !s.active ? ["Paused", "declined"] : s.online ? ["Online", "done"] : ["Offline", "planned"];
      return h("div", { class: "panel", style: "margin-bottom:10px" },
        h("div", { class: "cx-row", style: "justify-content:space-between;flex-wrap:wrap;gap:8px" },
          h("div", {}, h("b", { text: s.name }), " ", h("span", { class: `sg-status ${state[1]}`, text: state[0] }),
            h("div", { class: "text-3 small", text: s.lastSeen ? `Seen ${when(s.lastSeen)} · ${s.players} online · plugin ${s.version || "?"} · token ends ${s.hint}` : `Not connected yet · token ends ${s.hint}` })),
          h("div", { class: "cx-row", style: "gap:6px;flex-wrap:wrap" },
            h("button", { class: "btn btn-secondary btn-sm", type: "button", text: s.opsEnabled ? "Admins are operators: on" : "Admins are operators: off", onclick: () => update(s, { opsEnabled: !s.opsEnabled }) }),
            h("button", { class: "btn btn-secondary btn-sm", type: "button", text: s.active ? "Pause" : "Resume", onclick: () => update(s, { active: !s.active }) }),
            h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Reset token", onclick: () => reset(s) }))));
    }));
  }
  async function update(s, body) {
    try { await postJson(`/api/panel/partner-servers/${s.id}`, body); toast("Saved."); await loadServers(); } catch (e) { toast(e.message); }
  }
  function showSetup(title, res) {
    const box = h("textarea", { class: "input", rows: 5, readonly: true, style: "font-family:monospace;font-size:.85rem" });
    box.value = res.setup;
    openDialog({
      title,
      body: h("div", { class: "form" },
        h("p", { class: "text-2", style: "margin:0" }, "This is the server's setup file (", h("code", { text: "config.json" }), "). ", h("b", { text: "It's shown only once." }), " Copy it now and send it to them privately."),
        box,
        h("p", { class: "text-3 small", style: "margin:0" }, "If it gets out or is lost, use Reset token: the old one stops working right away.")),
      actions: [{ label: "Copy setup file", kind: "primary", onClick: async () => { try { await navigator.clipboard.writeText(res.setup); toast("Copied."); } catch { box.select(); toast("Select the text and copy it."); } return false; } }, { label: "Done" }],
    });
  }
  function newServer(req) {
    const name = h("input", { class: "input", maxlength: 40, value: req?.name || "", placeholder: "Server name" });
    openDialog({
      title: "Set up a Network Server",
      body: h("div", { class: "form" }, field("Server name", name), h("p", { class: "text-3 small", style: "margin:0" }, "You get a setup file with a private token for this server. It's shown once.")),
      actions: [{ label: "Cancel" }, { label: "Create", kind: "primary", onClick: async () => {
        const res = await postJson("/api/panel/partner-servers", { name: name.value, requestId: req?.id });
        await loadServers();
        showSetup(`${res.server.name}: setup file`, res);
      } }],
    });
  }
  function reset(s) {
    openDialog({
      title: `Reset ${s.name}'s token?`,
      body: h("p", { class: "text-2", style: "margin:0" }, "The old token stops working right away. You'll get a new setup file to send them."),
      actions: [{ label: "Cancel" }, { label: "Reset", kind: "danger", onClick: async () => { const res = await postJson(`/api/panel/partner-servers/${s.id}/reset`, {}); await loadServers(); showSetup(`${s.name}: new setup file`, res); } }],
    });
  }

  async function openChat(id) {
    openId = id;
    list.querySelectorAll(".jr-row").forEach((x) => x.classList.remove("active"));
    const log = h("div", { class: "dm-log jr-log" });
    const head = h("div", { class: "jr-head" });
    const about = h("div", { class: "text-2 small", style: "margin:6px 0" });
    const actions = h("div", { class: "cx-row" });
    const form = composer(async (text) => { await postJson(`/api/panel/partner-requests/${id}/messages`, { body: text }); await load(); }, "Reply (they see \"Staff\")");
    pane.replaceChildren(head, about, actions, log, form);
    async function load() {
      let data;
      try { data = await getJson(`/api/panel/partner-requests/${id}`); } catch (e) { pane.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
      const r = data.request;
      const [label, cls] = STATUS[r.status];
      head.replaceChildren(h("b", { text: r.name }), h("span", { class: "text-3 small", text: r.kindName }), h("span", { class: `sg-status ${cls}`, text: label }), h("span", { class: "text-3 small", text: `Sent ${when(r.createdAt)}` }));
      about.replaceChildren(`${r.contact}: ${r.about}`, ...(r.link ? [" ", h("a", { href: r.link, target: "_blank", rel: "noopener noreferrer", text: "Their link" })] : []));
      actions.replaceChildren(...[
        r.status !== "accepted" ? h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Accept", onclick: () => decide(r, "accepted") }) : null,
        r.status === "open" ? h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Decline", onclick: () => decide(r, "declined") }) : null,
        r.status === "accepted" && r.kind === "network" && !r.servers.length ? h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Set up their server", onclick: () => newServer(r) }) : null,
        r.servers.length ? h("span", { class: "text-3 small", text: `Server: ${r.servers.map((s) => s.name).join(", ")}` }) : null,
      ].filter(Boolean));
      actions.hidden = !actions.childElementCount;
      renderThread(log, data.messages, true, { otherName: r.contact });
      loadList();
    }
    function decide(r, st) {
      const note = h("textarea", { class: "input", rows: 3, maxlength: 1000, placeholder: st === "accepted" ? "Optional. If empty, they get a welcome message." : "Optional. If empty, they get a polite no." });
      openDialog({
        title: st === "accepted" ? `Accept ${r.name}?` : `Decline ${r.name}?`,
        body: h("div", { class: "form" }, field("Message to them (shown as Staff)", note)),
        actions: [{ label: "Cancel" }, { label: st === "accepted" ? "Accept" : "Decline", kind: st === "accepted" ? "primary" : "danger", onClick: async () => {
          const res = await postJson(`/api/panel/partner-requests/${r.id}/decide`, { status: st, message: note.value });
          toast(res.message);
          await load();
        } }],
      });
    }
    await load();
  }

  async function loadAll() { await Promise.all([loadList(), loadServers()]); }
  loaders.partners = loadAll;

  setInterval(() => {
    if (document.hidden || partnersView.hidden || document.querySelector('[data-panel="joins"]')?.hidden) return;
    loadList();
    if (openId && !document.querySelector("dialog[open]")) {
      const log = pane.querySelector(".jr-log");
      if (log) getJson(`/api/panel/partner-requests/${openId}`).then((d) => renderThread(log, d.messages, true, { otherName: d.request.contact })).catch(() => {});
    }
  }, 10000);
  getJson("/api/panel/partner-requests?status=open").then((d) => setJoinsBadge(setBadge, "partners", d.attention)).catch(() => {});
}
