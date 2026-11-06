// Adds reporting and staff tools to the chat.
import { toast, icon } from "/js/site.js";
import {
  chatState as state, messageActionHooks, memberHooks, eventHooks,
  renderMembers, renderComposer, removeMessage, roleOf,
} from "/js/chat.js";
import { h, openDialog, postJson, getJson, field, select, REPORT_REASONS, MUTE_LABELS, muteDialog, banDialog, roleDialog } from "/js/dialog.js";

const STAFF = 50;
const ADMIN = 100;
const myPower = () => state.me?.role.power || 0;

// ---------- Message actions: Report and Delete ----------
messageActionHooks.push((m, actions, actionBtn) => {
  const mine = m.author.id === state.me.id;
  if (!mine) actions.append(actionBtn("flag", "Report", () => reportDialog(m)));
  const canDelete = mine || (myPower() >= STAFF && myPower() > roleOf(m.author.role).power);
  if (canDelete) actions.append(actionBtn("trash", "Delete", () => deleteDialog(m, mine)));
});

function reportDialog(m) {
  const reason = select("report-reason", REPORT_REASONS.map((r) => [r, r]), REPORT_REASONS[0]);
  const details = h("textarea", { class: "input", id: "report-details", maxlength: 300, rows: 3, placeholder: "Optional: anything staff should know" });
  openDialog({
    title: "Report message",
    body: h("div", { class: "form" },
      h("div", { class: "quote", text: `${m.author.username}: ${m.content}` }),
      field("What's wrong?", reason),
      field("Details", details, "Only staff can see your report.")),
    actions: [
      { label: "Cancel" },
      {
        label: "Send report", kind: "primary",
        onClick: async () => {
          const r = await postJson("/api/reports", { messageId: m.id, reason: reason.value, details: details.value });
          toast(r.message);
        },
      },
    ],
  });
}

function deleteDialog(m, mine) {
  const reason = h("input", { class: "input", id: "delete-reason", maxlength: 300, placeholder: "Optional, shown in the audit log" });
  openDialog({
    title: "Delete message",
    body: h("div", { class: "form" },
      h("div", { class: "quote", text: `${m.author.username}: ${m.content}` }),
      mine ? h("p", { class: "text-2", text: "This removes your message for everyone." }) : field("Reason", reason)),
    actions: [
      { label: "Cancel" },
      {
        label: "Delete", kind: "danger",
        onClick: async () => {
          await postJson(`/api/messages/${m.id}/delete`, { reason: reason.value });
          removeMessage(m.id);
          toast("Message deleted.");
        },
      },
    ],
  });
}

// ---------- Member profiles (click a name in the member list) ----------
memberHooks.push((m, row) => {
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  const open = () => memberDialog(m);
  row.addEventListener("click", open);
  row.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
});

async function memberDialog(m) {
  const role = roleOf(m.role);
  const body = h("div", { class: "form" });
  const roleBadge = h("span", { class: "badge", text: role.name });
  roleBadge.style.color = role.color;
  body.append(h("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" }, roleBadge));

  const actions = [{ label: "Close" }];
  const canAct = myPower() >= STAFF && myPower() > role.power && m.id !== state.me.id;
  if (canAct) {
    let detail = null;
    try {
      const data = await getJson(`/api/mod/members?q=${encodeURIComponent(m.username.replace(/^\./, ""))}`);
      detail = data.members.find((x) => x.id === m.id);
    } catch { /* show basic actions */ }
    if (detail?.owner) {
      body.append(h("p", { class: "text-3", text: "This is a server owner and can't be moderated." }));
    } else {
      if (detail) {
        body.append(h("p", { class: "text-3 small", text: `Joined ${new Date(detail.joined).toLocaleDateString()} · ${detail.messages} message${detail.messages === 1 ? "" : "s"} · reported ${detail.reported} time${detail.reported === 1 ? "" : "s"}` }));
        if (detail.mutedUntil) body.append(h("p", { class: "note small", text: `Muted until ${new Date(detail.mutedUntil).toLocaleString()}${detail.muteReason ? ` (${detail.muteReason})` : ""}` }));
      }
      const done = (msg) => { toast(msg); };
      if (detail?.mutedUntil) {
        actions.push({ label: "Unmute", onClick: async () => { await postJson(`/api/mod/members/${m.id}/unmute`); done("Member unmuted."); } });
      } else {
        actions.push({ label: "Mute", onClick: () => { setTimeout(() => muteDialog(m, done)); } });
      }
      if (myPower() >= ADMIN) {
        actions.push({ label: "Change role", onClick: () => { setTimeout(() => roleDialog(m, done)); } });
        actions.push({ label: "Ban", kind: "danger", onClick: () => { setTimeout(() => banDialog(m, done)); } });
      }
    }
  }
  openDialog({ title: m.username, body, actions });
}

// ---------- Live updates from staff actions ----------
eventHooks.push((data) => {
  if (data.type === "member_updated") {
    const prev = state.members.get(data.member.id);
    state.members.set(data.member.id, data.member);
    if (data.member.id === state.me.id) {
      if (prev && prev.role !== data.member.role) {
        toast("Your role changed. Reloading…");
        setTimeout(() => location.reload(), 1200);
        return;
      }
      state.me.mutedUntil = data.mutedUntil;
      renderComposer();
      if (data.mutedUntil) toast("You have been muted by staff.");
    }
    renderMembers();
  } else if (data.type === "member_removed") {
    state.members.delete(data.userId);
    state.online.delete(data.userId);
    renderMembers();
  } else if (data.type === "reports_open") {
    setReportBadge(data.count);
  }
});

// ---------- Staff tools link in the sidebar ----------
function setReportBadge(n) {
  const b = document.getElementById("staff-badge");
  if (!b) return;
  b.textContent = n ? String(n) : "";
  b.dataset.n = String(n || 0);
}

const observer = new MutationObserver(() => {
  if (!state.me || document.getElementById("staff-link")) return;
  if (myPower() < STAFF) return;
  const panel = document.querySelector("#chat-side .me-panel");
  if (!panel) return;
  const link = h("a", { class: "btn btn-secondary btn-sm staff-link", id: "staff-link", href: "/staff" });
  link.innerHTML = icon("shield");
  link.append(h("span", { text: "Staff tools" }), h("span", { class: "count-badge", id: "staff-badge" }));
  panel.before(link);
  getJson("/api/mod/summary").then((d) => setReportBadge(d.openReports)).catch(() => {});
});
observer.observe(document.getElementById("channel-list"), { childList: true });

export { MUTE_LABELS };
