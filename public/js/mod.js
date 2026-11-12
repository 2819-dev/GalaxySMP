// Adds reporting and staff tools to the chat.
import { toast, icon } from "/js/site.js";
import {
  chatState as state, messageActionHooks, memberHooks, profileActionHooks, eventHooks,
  renderMembers, renderComposer, removeMessage, roleOf,
} from "/js/chat.js";
import { h, openDialog, postJson, getJson, field, select, REPORT_REASONS, MUTE_LABELS, reportPlayerDialog, muteDialog, banDialog } from "/js/dialog.js";
import { rankTag } from "/js/rank-paint.js";
import { ranksDialog } from "/js/rank-picker.js";

const STAFF = 50;
const ADMIN = 100;
const myPower = () => state.me?.role.power || 0;

// ---------- Message actions: Report and Delete ----------
messageActionHooks.push((m, actions, actionBtn) => {
  const mine = m.author.id === state.me.id;
  if (!mine) actions.append(actionBtn("flag", "Report", () => reportDialog(m)));
  const canDelete = mine || (myPower() >= STAFF && myPower() > roleOf(m.author.role).power);
  if (canDelete) actions.append(actionBtn("trash", "Delete", () => deleteDialog(m, mine)));
  if (myPower() >= STAFF) {
    actions.append(actionBtn("pushpin", m.pinned ? "Unpin" : "Pin to the channel", async () => {
      try { await postJson(`/api/chat/messages/${m.id}/pin`, { pinned: !m.pinned }); toast(m.pinned ? "Unpinned." : "Pinned. Everyone can find it under the pin button at the top."); }
      catch (e) { toast(e.message); }
    }));
  }
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
// Staff: a "Moderate" button on everyone's profile card (click a name, picture or member).
// Everyone: "Report" on other members' cards (staff use Moderate instead).
profileActionHooks.push((m, actions, close) => {
  if (!state.me || m.id === state.me.id || myPower() >= STAFF) return;
  const b = h("button", { class: "btn btn-ghost btn-sm", type: "button", title: "Report this player to staff" });
  b.innerHTML = icon("flag");
  b.append(" Report");
  b.addEventListener("click", () => { close(); reportPlayerDialog(m.username, { userId: m.id }); });
  actions.append(b);
});

profileActionHooks.push((m, actions, close) => {
  if (myPower() < STAFF || m.id === state.me.id) return;
  const b = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Moderate" });
  b.addEventListener("click", () => { close(); memberDialog(m); });
  actions.append(b);
});

async function memberDialog(m) {
  const role = roleOf(m.role);
  const body = h("div", { class: "form" });
  body.append(h("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" },
    m.rank ? rankTag(m.rank) : h("span", { class: "text-3", text: "No rank" })));

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
      // pictures: remove their banner or picture, or stop them uploading
      const pics = h("div", { class: "cx-row" }, h("span", { class: "field-label", style: "width:100%", text: "Pictures" }),
        ...[["remove-banner", "Remove banner"], ["remove-picture", "Remove profile picture"], ["block", "Stop uploads"], ["unblock", "Allow uploads"]].map(([action, label]) =>
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: label, onclick: async () => {
            try { const r = await postJson(`/api/mod/users/${m.id}/uploads`, { action }); toast(r.message); } catch (e) { toast(e.message); }
          } })));
      body.append(pics);
      if (myPower() >= ADMIN) {
        if (detail?.xuid) actions.push({ label: "Change ranks", onClick: () => { setTimeout(() => rankDialog(detail, done)); } });
        actions.push({ label: "Ban", kind: "danger", onClick: () => { setTimeout(() => banDialog(m, done)); } });
      }
    }
  }
  openDialog({ title: m.username, body, actions });
}

// Admins: give a member ranks (the same ranks as in game).
function rankDialog(member, done) {
  ranksDialog({ name: member.username, xuid: member.xuid, rankIds: member.rankIds || (member.rankId ? [member.rankId] : []), onSaved: done });
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
  } else if (data.type === "reports_open" || (data.type === "ticket" && myPower() >= STAFF)) {
    getJson("/api/mod/summary").then((d) => setReportBadge((d.openReports || 0) + (d.openTickets || 0))).catch(() => {});
  }
});

// ---------- Staff panel link in the sidebar ----------
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
  const label = h("span", { text: myPower() >= 100 ? "Admin Panel" : "Staff Panel" });
  link.append(label, h("span", { class: "count-badge", id: "staff-badge" }));
  panel.before(link);
  getJson("/api/mod/summary").then((d) => {
    if (d.panel) label.textContent = d.panel;
    setReportBadge((d.openReports || 0) + (d.openTickets || 0));
  }).catch(() => {});
});
observer.observe(document.getElementById("channel-list"), { childList: true });

export { MUTE_LABELS };
