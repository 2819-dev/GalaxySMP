// Small, accessible pop-up dialogs built on the native <dialog> element.

export function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "style") e.style.cssText = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

// openDialog({ title, body, actions: [{ label, kind, onClick }] })
// onClick may return a promise; returning false keeps the dialog open.
export function openDialog({ title, body, actions = [] }) {
  const err = h("p", { class: "form-error", role: "alert" });
  const dlg = h("dialog", { class: "dialog" });
  const close = () => { dlg.close(); dlg.remove(); };
  const footer = h("div", { class: "dialog-actions" });
  for (const a of actions) {
    const btn = h("button", { type: "button", class: `btn btn-${a.kind || "secondary"}`, text: a.label });
    btn.addEventListener("click", async () => {
      err.textContent = "";
      if (!a.onClick) return close();
      footer.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        const keep = await a.onClick();
        if (keep !== false) close();
      } catch (e) {
        err.textContent = e.message || "Something went wrong.";
      } finally {
        footer.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
    });
    footer.append(btn);
  }
  dlg.append(
    h("div", { class: "dialog-head" }, h("h2", { text: title }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: close, text: "✕" })),
    h("div", { class: "dialog-body" }, body, err),
    footer
  );
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
  return { close, dialog: dlg };
}

export async function postJson(path, body = {}) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || data.message || "Something went wrong.");
  return data;
}

export async function getJson(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export const MUTE_LABELS = { 10: "10 minutes", 60: "1 hour", 1440: "1 day", 10080: "7 days", 43200: "30 days" };
export const REPORT_REASONS = ["Bad language", "Bullying or harassment", "Personal information", "Spam", "Inappropriate content", "Other"];
export const ROLE_OPTIONS = [["member", "Member"], ["vip", "VIP"], ["moderator", "Moderator"], ["admin", "Admin"]];

export function select(id, options, value) {
  const s = h("select", { class: "input", id });
  for (const [v, label] of options) s.append(h("option", { value: v, text: label, selected: String(v) === String(value) }));
  return s;
}

export function field(label, control, hint) {
  return h("div", { class: "field" }, h("label", { class: "field-label", for: control.id, text: label }), control, hint ? h("p", { class: "hint", text: hint }) : null);
}

// Shared staff actions, used by both the chat and the Staff page.
export function muteDialog(member, onDone) {
  const len = select("mute-len", Object.entries(MUTE_LABELS), 60);
  const reason = h("input", { class: "input", id: "mute-reason", maxlength: 300, placeholder: "Optional, shown in the audit log" });
  openDialog({
    title: `Mute ${member.username}`,
    body: h("div", { class: "form" }, h("p", { class: "text-2", text: "Muted members can still read chat, but can't send messages until the mute ends." }), field("Length", len), field("Reason", reason)),
    actions: [
      { label: "Cancel" },
      { label: "Mute", kind: "primary", onClick: async () => { await postJson(`/api/mod/members/${member.id}/mute`, { minutes: Number(len.value), reason: reason.value }); onDone?.("Member muted."); } },
    ],
  });
}

export function banDialog(member, onDone) {
  const reason = h("input", { class: "input", id: "ban-reason", maxlength: 300, required: true, placeholder: "Required" });
  openDialog({
    title: `Ban ${member.username}`,
    body: h("div", { class: "form" }, h("p", { class: "text-2", text: "Banned members are signed out immediately and can't use the community until an Admin unbans them." }), field("Reason", reason)),
    actions: [
      { label: "Cancel" },
      { label: "Ban member", kind: "danger", onClick: async () => { await postJson(`/api/mod/members/${member.id}/ban`, { reason: reason.value }); onDone?.("Member banned."); } },
    ],
  });
}

export function roleDialog(member, onDone) {
  const role = select("role-select", ROLE_OPTIONS, member.role);
  openDialog({
    title: `Change role for ${member.username}`,
    body: h("div", { class: "form" }, field("Role", role, "Moderators can delete messages, mute members, handle reports and edit the word filter. Admins can also ban members and change roles.")),
    actions: [
      { label: "Cancel" },
      { label: "Save", kind: "primary", onClick: async () => { await postJson(`/api/mod/members/${member.id}/role`, { role: role.value }); onDone?.("Role updated."); } },
    ],
  });
}

export function voiceMuteDialog(member, onDone) {
  const len = select("vmute-len", Object.entries(MUTE_LABELS), 60);
  const reason = h("input", { class: "input", id: "vmute-reason", maxlength: 300, placeholder: "Optional, shown in the audit log" });
  openDialog({
    title: `Mute ${member.username} in voice`,
    body: h("div", { class: "form" }, h("p", { class: "text-2", text: "They can still listen in voice, but nobody will hear them until the mute ends." }), field("Length", len), field("Reason", reason)),
    actions: [
      { label: "Cancel" },
      { label: "Mute in voice", kind: "primary", onClick: async () => { await postJson(`/api/mod/members/${member.id}/voice-mute`, { minutes: Number(len.value), reason: reason.value }); onDone?.("Muted in voice."); } },
    ],
  });
}
