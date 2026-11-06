// Staff Tools page: reports, members, word filter and audit log.
import { toast } from "/js/site.js";
import { h, openDialog, postJson, getJson, MUTE_LABELS, muteDialog, banDialog, roleDialog } from "/js/dialog.js";

const $ = (id) => document.getElementById(id);
const ROLE_NAMES = { member: "Member", vip: "VIP", moderator: "Moderator", admin: "Admin" };
let me = null;
let power = 0;

const fmt = (d) => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// ---------- Tabs ----------
const loaders = {};
function selectTab(name) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  history.replaceState(null, "", "#" + name);
  loaders[name]?.();
}
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));

function setCount(n) {
  const b = $("tab-reports-count");
  b.textContent = n ? String(n) : "";
  b.dataset.n = String(n || 0);
}

// ---------- Reports ----------
loaders.reports = async () => {
  const data = await getJson("/api/mod/reports");
  setCount(data.open.length);
  const open = $("reports-open");
  open.replaceChildren();
  if (!data.open.length) open.append(h("div", { class: "panel empty", text: "No open reports. Nice and quiet." }));
  for (const r of data.open) open.append(reportCard(r));

  const closed = $("reports-closed");
  closed.replaceChildren();
  if (!data.closed.length) closed.append(h("div", { class: "empty", text: "Nothing handled yet." }));
  for (const c of data.closed) {
    closed.append(h("div", { class: "audit-row" },
      h("time", { text: fmt(c.resolvedAt) }),
      h("div", {}, h("b", { text: c.resolvedBy || "Staff" }), ` ${c.status === "dismissed" ? "dismissed" : "resolved"} a report on `, h("b", { text: c.author }), ` in #${c.channel}`),
      h("div", { class: "detail", text: `"${c.content.slice(0, 140)}" · ${c.resolution || ""}` })));
  }
};

function reportCard(r) {
  const card = h("article", { class: "panel report-card" });
  card.append(
    h("div", { class: "meta" },
      h("span", {}, "By ", h("b", { text: r.author.username }), ` (${ROLE_NAMES[r.author.role] || r.author.role})`),
      h("span", { text: `#${r.channel}` }),
      h("span", { text: fmt(r.messageAt) }),
      h("span", { text: `${r.count} report${r.count === 1 ? "" : "s"}` }),
      r.deleted ? h("span", { class: "pill-status banned", text: "Deleted" }) : null),
    h("div", { class: "quote", text: r.content }),
    h("ul", { class: "report-list" }, r.reports.map((x) => h("li", {}, h("b", { text: x.reporter }), `: ${x.reason}`))),
  );
  const actions = h("div", { class: "row-actions" });
  const target = { id: r.author.id, username: r.author.username, role: r.author.role };
  if (!r.deleted) {
    actions.append(h("button", {
      class: "btn btn-danger btn-sm", type: "button", text: "Delete message",
      onclick: () => openDialog({
        title: "Delete message",
        body: h("div", { class: "quote", text: r.content }),
        actions: [{ label: "Cancel" }, {
          label: "Delete", kind: "danger",
          onClick: async () => { await postJson(`/api/messages/${r.messageId}/delete`, { reason: `Reported: ${r.reports[0]?.reason || ""}` }); toast("Message deleted and reports resolved."); loaders.reports(); },
        }],
      }),
    }));
  }
  actions.append(
    h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Mute author", onclick: () => muteDialog(target, (m) => { toast(m); }) }),
    h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Mark resolved", onclick: () => resolve(r, "resolved") }),
    h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Dismiss", onclick: () => resolve(r, "dismissed") }),
  );
  card.append(actions);
  return card;
}

async function resolve(r, outcome) {
  try {
    await postJson(`/api/mod/reports/${r.messageId}/resolve`, { outcome });
    toast(outcome === "dismissed" ? "Report dismissed." : "Report resolved.");
    loaders.reports();
  } catch (e) {
    toast(e.message);
  }
}

// ---------- Members ----------
let searchTimer;
loaders.members = async () => {
  const q = $("member-search").value.trim().replace(/^\./, "");
  const data = await getJson(`/api/mod/members?q=${encodeURIComponent(q)}&filter=${$("member-filter").value}`);
  const list = $("member-results");
  list.replaceChildren();
  if (!data.members.length) list.append(h("div", { class: "empty", text: "No members found." }));
  for (const m of data.members) list.append(memberRow(m));
};
$("member-search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loaders.members, 300); });
$("member-filter").addEventListener("change", () => loaders.members());

function memberRow(m) {
  const refresh = (msg) => { toast(msg); setTimeout(loaders.members, 300); };
  const status = [];
  if (m.owner) status.push(h("span", { class: "pill-status owner", text: "Owner" }));
  if (m.banned) status.push(h("span", { class: "pill-status banned", text: "Banned" }));
  if (m.mutedUntil) status.push(h("span", { class: "pill-status muted", text: `Muted until ${fmt(m.mutedUntil)}` }));
  const row = h("div", { class: "member-row" },
    h("div", { class: "info" },
      h("strong", {}, m.username, ...status),
      h("span", { text: `${ROLE_NAMES[m.role]} · ${m.platform === "bedrock" ? "Bedrock" : "Java"} · joined ${new Date(m.joined).toLocaleDateString()} · ${m.messages} message${m.messages === 1 ? "" : "s"} · reported ${m.reported}×` }),
      m.banned && m.banReason ? h("span", { style: "display:block", text: `Ban reason: ${m.banReason}` }) : null,
      m.mutedUntil && m.muteReason ? h("span", { style: "display:block", text: `Mute reason: ${m.muteReason}` }) : null));
  const canAct = !m.owner && m.id !== me.id && power > m.power;
  if (canAct) {
    const actions = h("div", { class: "row-actions" });
    if (m.mutedUntil) {
      actions.append(h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Unmute", onclick: async () => { try { await postJson(`/api/mod/members/${m.id}/unmute`); refresh("Member unmuted."); } catch (e) { toast(e.message); } } }));
    } else if (!m.banned) {
      actions.append(h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Mute", onclick: () => muteDialog(m, refresh) }));
    }
    if (power >= 100) {
      actions.append(h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Role", onclick: () => roleDialog(m, refresh) }));
      if (m.banned) {
        actions.append(h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Unban", onclick: async () => { try { await postJson(`/api/mod/members/${m.id}/unban`); refresh("Member unbanned."); } catch (e) { toast(e.message); } } }));
      } else {
        actions.append(h("button", { class: "btn btn-danger btn-sm", type: "button", text: "Ban", onclick: () => banDialog(m, refresh) }));
      }
    }
    row.append(actions);
  }
  return row;
}

// ---------- Word filter ----------
let words = [];
let reveal = false;
const mask = (w) => (reveal ? w : w[0] + "•".repeat(Math.max(1, w.length - 1)));

loaders.words = async () => {
  words = (await getJson("/api/mod/words")).words;
  renderWords();
};

function renderWords() {
  const q = $("word-search").value.trim().toLowerCase();
  const list = $("word-list");
  list.replaceChildren();
  const shown = words.filter((w) => !q || w.word.includes(q));
  list.append(h("p", { class: "text-3 small", style: "margin:0 0 12px", text: `${words.length} words on the list${q ? `, ${shown.length} matching` : ""}.` }));
  for (const w of shown) {
    list.append(h("span", { class: "word-chip", title: w.addedBy ? `Added by ${w.addedBy}` : "Starter list" },
      mask(w.word),
      h("span", { class: "kind", text: w.match === "contains" ? "anywhere" : "word" }),
      h("button", {
        class: "icon-btn", type: "button", "aria-label": `Remove ${w.word}`, text: "✕",
        onclick: async () => {
          try { await postJson(`/api/mod/words/${w.id}/delete`); toast("Removed from the filter."); loaders.words(); } catch (e) { toast(e.message); }
        },
      })));
  }
}

$("word-search").addEventListener("input", renderWords);
$("word-reveal").addEventListener("click", () => {
  reveal = !reveal;
  $("word-reveal").textContent = reveal ? "Hide words" : "Show words";
  renderWords();
});
$("word-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await postJson("/api/mod/words", { word: $("word-input").value, match: $("word-match").value });
    $("word-input").value = "";
    toast("Added to the filter.");
    loaders.words();
  } catch (ex) {
    toast(ex.message);
  }
});

// ---------- Audit log ----------
let auditBefore = null;
const DESCRIBE = {
  "message.delete": (e) => ["deleted a message by ", e.target],
  "user.mute": (e) => ["muted ", e.target, ` for ${MUTE_LABELS[e.details.minutes] || `${e.details.minutes} minutes`}`],
  "user.unmute": (e) => ["unmuted ", e.target],
  "user.ban": (e) => ["banned ", e.target],
  "user.unban": (e) => ["unbanned ", e.target],
  "user.role": (e) => ["changed the role of ", e.target, ` from ${ROLE_NAMES[e.details.from] || e.details.from} to ${ROLE_NAMES[e.details.to] || e.details.to}`],
  "report.resolve": () => ["resolved a report"],
  "report.dismiss": () => ["dismissed a report"],
  "filter.add": () => ["added a word to the filter"],
  "filter.remove": () => ["removed a word from the filter"],
};

function auditRow(e) {
  const parts = (DESCRIBE[e.action] || (() => [e.action]))(e);
  const line = h("div", {}, h("b", { text: e.actor || "Someone" }), " ");
  parts.forEach((p, i) => line.append(i % 2 === 1 ? h("b", { text: p || "a removed member" }) : p));
  const extra = [];
  if (e.details?.reason) extra.push(`Reason: ${e.details.reason}`);
  if (e.details?.content) extra.push(`Message: "${e.details.content.slice(0, 160)}"`);
  if (e.details?.note && e.action.startsWith("report.")) extra.push(`Note: ${e.details.note}`);
  if (e.details?.word) extra.push(`Word: ${mask(e.details.word)} (${e.details.match === "contains" ? "anywhere" : "whole word"})`);
  return h("div", { class: "audit-row" }, h("time", { text: fmt(e.at) }), line, extra.length ? h("div", { class: "detail", text: extra.join(" · ") }) : null);
}

async function loadAudit(more) {
  const data = await getJson(`/api/mod/audit${more && auditBefore ? `?before=${auditBefore}` : ""}`);
  const list = $("audit-list");
  if (!more) list.replaceChildren();
  if (!more && !data.entries.length) list.append(h("div", { class: "empty", text: "No staff actions yet." }));
  for (const e of data.entries) list.append(auditRow(e));
  auditBefore = data.entries.length ? data.entries[data.entries.length - 1].id : auditBefore;
  $("audit-more").hidden = !data.hasMore;
}
loaders.audit = () => loadAudit(false);
$("audit-more").addEventListener("click", () => loadAudit(true));

// ---------- Start ----------
(async () => {
  let user = null;
  try { user = (await getJson("/api/me")).user; } catch { /* signed out */ }
  if (!user || user.role.power < 50) {
    $("staff-intro").textContent = "";
    $("staff-denied").hidden = false;
    return;
  }
  me = user;
  power = user.role.power;
  $("staff-intro").textContent = `Signed in as ${user.username} (${user.role.name}). ${power >= 100 ? "You can use every tool on this page." : "Banning and role changes are reserved for Admins."}`;
  $("staff-app").hidden = false;
  const start = location.hash.slice(1);
  selectTab(["reports", "members", "words", "audit"].includes(start) ? start : "reports");
})();
