// Support tickets: the live conversation view, shared by the community Support channel
// (players) and the panel's Tickets tab (staff). All text goes in with textContent.
import { faceSvg } from "/js/face.js";
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { iconEl } from "/js/site.js";

export const LABELS = {
  question: { name: "Question", icon: "help" },
  bug: { name: "Bug", icon: "bug" },
  report: { name: "Player report", icon: "flag" },
  appeal: { name: "Ban/mute appeal", icon: "scale" },
  store: { name: "Store / plans", icon: "card" },
  other: { name: "Other", icon: "message" },
};
export const PRIORITIES = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
export const STATUSES = { open: "Needs staff", waiting: "Waiting for player", resolved: "Resolved", closed: "Closed" };
const PLAYER_STATUS = { open: "Waiting for staff", waiting: "Staff replied", resolved: "Resolved", closed: "Closed" };

const listeners = new Set();
// chat.js passes every live "ticket" event here
export function ticketEvent(data) {
  for (const fn of listeners) fn(data);
}
export function onTicketEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function when(at) {
  const d = new Date(at);
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString();
}

export function chip(kind, value, staff) {
  if (kind === "label") {
    const l = LABELS[value] || LABELS.other;
    return h("span", { class: `tk-chip tk-label ${value}` }, iconEl(l.icon), l.name);
  }
  if (kind === "priority") return h("span", { class: `tk-chip tk-prio ${value}`, text: PRIORITIES[value] });
  return h("span", { class: `tk-chip tk-status ${value}`, text: (staff ? STATUSES : PLAYER_STATUS)[value] });
}

function face(src, name) {
  const img = h("img", { class: "tk-face", alt: "", width: 32, height: 32, loading: "lazy" });
  img.src = src || faceSvg(name || "?");
  img.addEventListener("error", () => { img.src = faceSvg(name || "?"); }, { once: true });
  img.title = name || "";
  return img;
}

// The conversation for one ticket. Returns a cleanup function.
// opts: { staff, onBack, toast, onChange }
export function ticketChat(box, id, opts) {
  const { staff, toast } = opts;
  let stopped = false;
  let lastCount = -1;
  const head = h("div", { class: "tk-head" });
  const log = h("div", { class: "tk-log", role: "log", "aria-live": "polite" });
  const input = h("textarea", { class: "input tk-input", rows: 2, maxlength: staff ? 2000 : 500, placeholder: staff ? "Reply as staff..." : "Write a message to staff...", "aria-label": "Message" });
  const send = h("button", { class: "btn btn-primary", type: "button", text: "Send" });
  const composer = h("div", { class: "tk-composer" }, input, send);
  const controls = h("div", { class: "tk-controls" });
  box.replaceChildren(h("div", { class: "tk-chat panel" }, head, controls, log, composer));

  async function load() {
    let data;
    try { data = await getJson(`/api/support/tickets/${id}`); } catch (e) { log.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    if (stopped) return;
    const t = data.ticket;
    head.replaceChildren(
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "← Back", onclick: () => opts.onBack?.() }),
      h("div", { class: "tk-head-main" },
        h("h3", { class: "tk-subject", text: t.subject }),
        h("div", { class: "tk-chips" }, chip("status", t.status, staff), chip("label", t.label), staff ? chip("priority", t.priority) : null,
          staff && t.user ? h("span", { class: "text-3 small", text: `from ${t.user.username}` }) : null,
          staff && t.assignedTo ? h("span", { class: "text-3 small", text: `· handled by ${t.assignedTo}` }) : null)),
      ...(t.status !== "closed" ? [h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Close ticket", onclick: closeIt })] : []));
    if (staff) renderControls(t);
    const closed = t.status === "closed";
    composer.hidden = closed && !staff;
    if (closed && !staff && !box.querySelector(".tk-closed")) log.after(h("p", { class: "text-3 small tk-closed", text: "This ticket is closed. Open a new one if you still need help." }));
    if (data.messages.length === lastCount) return;
    const first = lastCount < 0;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    lastCount = data.messages.length;
    log.replaceChildren(...data.messages.map((m) => h("div", { class: `tk-msg${m.fromStaff ? " staff" : ""}` },
      face(m.head, m.author),
      h("div", { class: "tk-bubble" },
        h("div", { class: "tk-meta" }, h("strong", { text: m.author }), m.fromStaff ? h("span", { class: "tk-staff-tag", text: "STAFF" }) : null, h("span", { class: "text-3", text: when(m.at) })),
        h("div", { class: "tk-text", text: m.body })))));
    if (first || atBottom) log.scrollTop = log.scrollHeight;
    opts.onChange?.();
  }

  function renderControls(t) {
    const mk = (name, options, value, key) => {
      const sel = h("select", { class: "input tk-select", "aria-label": name });
      for (const [k, n] of Object.entries(options)) sel.append(h("option", { value: k, text: typeof n === "string" ? n : n.name, selected: k === value }));
      sel.addEventListener("change", () => update({ [key]: sel.value }));
      return h("label", { class: "tk-ctl" }, h("span", { text: name }), sel);
    };
    controls.replaceChildren(
      mk("Status", STATUSES, t.status, "status"),
      mk("Priority", PRIORITIES, t.priority, "priority"),
      mk("Label", Object.fromEntries(Object.entries(LABELS)), t.label, "label"),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: t.assignedTo ? "Unassign" : "Take it", onclick: () => update({ assign: t.assignedTo ? "none" : "me" }) }));
  }

  async function update(change) {
    try { await postJson(`/api/mod/tickets/${id}/update`, change); lastCount = -1; load(); }
    catch (e) { toast(e.message); }
  }

  async function sendIt() {
    const text = input.value.trim();
    if (!text) return;
    send.disabled = true;
    try {
      await postJson(`/api/support/tickets/${id}/messages`, { body: text });
      input.value = "";
      await load();
      log.scrollTop = log.scrollHeight;
    } catch (e) { toast(e.message); }
    send.disabled = false;
    input.focus();
  }

  function closeIt() {
    openDialog({
      title: "Close this ticket?",
      body: h("p", { class: "text-2", text: staff ? "The player can't reply to a closed ticket (they can open a new one)." : "Only close it if you don't need more help." }),
      actions: [{ label: "Cancel" }, { label: "Close ticket", kind: "danger", onClick: async () => { await postJson(`/api/support/tickets/${id}/close`, {}); lastCount = -1; load(); } }],
    });
  }

  send.addEventListener("click", sendIt);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(hover: hover)").matches) { e.preventDefault(); sendIt(); }
  });
  const off = onTicketEvent((d) => { if (Number(d.ticketId) === Number(id)) load(); });
  const timer = setInterval(load, 20000); // backup in case the live connection drops
  load();
  return () => { stopped = true; off(); clearInterval(timer); };
}

export function newTicketDialog(toast, done, quick = null) {
  const subject = h("input", { class: "input", id: "tk-subject", maxlength: 80, placeholder: "e.g. I lost my items after a crash" });
  if (quick?.subject) subject.value = quick.subject;
  const label = h("select", { class: "input", id: "tk-label" });
  for (const [k, l] of Object.entries(LABELS)) label.append(h("option", { value: k, text: l.name }));
  if (quick?.label) label.value = quick.label;
  const body = h("textarea", { class: "input", id: "tk-body", maxlength: 500, rows: 5, placeholder: "Explain what happened. Staff will answer here." });
  // answers from the Help Center that match what they're typing (they may not need a ticket at all)
  const tips = h("div", { class: "hc-tips", hidden: true, "aria-live": "polite" });
  let timer = null;
  const suggest = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const { helpData, matchArticles } = await import("/js/help-center.js");
        const d = await helpData();
        const found = matchArticles(d.articles, `${subject.value} ${body.value}`, 3);
        tips.hidden = !found.length;
        tips.replaceChildren(h("b", { class: "hc-tips-head", text: "Maybe this helps:" }), ...found.map((a) => {
          const ans = h("div", { class: "hc-answer" });
          import("/js/markdown.js").then((m) => ans.append(m.renderMarkdown(a.answer)));
          return h("details", { class: "hc-item" }, h("summary", { text: a.question }), ans);
        }));
      } catch { /* the Help Center is optional here */ }
    }, 350);
  };
  subject.addEventListener("input", suggest);
  body.addEventListener("input", suggest);
  openDialog({
    title: quick?.title || "Contact staff",
    body: h("div", { class: "form" }, field("Title", subject), field("What's it about?", label), field("Message", body), tips,
      h("p", { class: "text-3 small", text: "Only you and the staff team can see this ticket. Never share passwords." })),
    actions: [{ label: "Cancel" }, {
      label: "Open ticket", kind: "primary",
      onClick: async () => {
        const r = await postJson("/api/support/tickets", { subject: subject.value, label: label.value, body: body.value });
        toast("Ticket opened! Staff will reply here.");
        done(r.id);
      },
    }],
  });
}
