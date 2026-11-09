// Staff Tools page: reports, members, word filter, ranks, economy and audit log.
import { toast } from "/js/site.js";
import { h, openDialog, postJson, getJson, MUTE_LABELS, muteDialog, banDialog, roleDialog, voiceMuteDialog, select, field } from "/js/dialog.js";

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
  if (m.voiceMutedUntil) status.push(h("span", { class: "pill-status muted", text: `Voice muted until ${fmt(m.voiceMutedUntil)}` }));
  if (m.globalMic) status.push(h("span", { class: "pill-status owner", text: "Global Mic" }));
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
    if (m.voiceMutedUntil) {
      actions.append(h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Voice unmute", onclick: async () => { try { await postJson(`/api/mod/members/${m.id}/voice-unmute`); refresh("Unmuted in voice."); } catch (e) { toast(e.message); } } }));
    } else if (!m.banned) {
      actions.append(h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Voice mute", onclick: () => voiceMuteDialog(m, refresh) }));
    }
    if (power >= 100) {
      if (m.power < 50) {
        actions.append(h("button", { class: "btn btn-secondary btn-sm", type: "button", text: m.globalMic ? "Take Global Mic" : "Give Global Mic", onclick: async () => { try { await postJson(`/api/mod/members/${m.id}/global-mic`, { allowed: !m.globalMic }); refresh(m.globalMic ? "Global Mic removed." : "Global Mic given."); } catch (e) { toast(e.message); } } }));
      }
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
  "voice.mute": (e) => ["muted ", e.target, ` in voice for ${MUTE_LABELS[e.details.minutes] || `${e.details.minutes} minutes`}`],
  "voice.unmute": (e) => ["unmuted ", e.target, " in voice"],
  "voice.kick": (e) => ["removed ", e.target, " from voice"],
  "voice.global_grant": (e) => ["gave the Global Mic to ", e.target],
  "voice.global_revoke": (e) => ["took the Global Mic from ", e.target],
  "rank.create": (e) => [`created the rank ${e.details.rank} [${e.details.prefix}]`],
  "rank.update": (e) => [`edited the rank ${e.details.rank}`],
  "rank.delete": (e) => [`deleted the rank ${e.details.rank}`],
  "rank.assign": (e) => [`gave ${e.details.player} the rank ${e.details.rank}`],
  "rank.remove": (e) => [`removed the rank from ${e.details.player}`],
  "economy.money": (e) => [e.details.action === "set" ? `set ${e.details.player}'s money to ${money(e.details.cents)}` : e.details.action === "add" ? `gave ${e.details.player} ${money(e.details.cents)}` : `took ${money(e.details.cents)} from ${e.details.player}`],
  "economy.shop": (e) => [`changed the shop prices (${e.details.categories} categories, ${e.details.items} items)`],
  "economy.shop_reset": () => ["reset the shop to the built-in prices"],
  "filter.add": () => ["added a word to the filter"],
  "filter.remove": () => ["removed a word from the filter"],
};

function auditRow(e) {
  const parts = (DESCRIBE[e.action] || (() => [e.action]))(e);
  const by = e.details && e.details.by;
  const who = by && /\(in game\)$/.test(by) ? by : e.actor || by || "Someone";
  const line = h("div", {}, h("b", { text: who }), " ");
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

// ---------- Ranks (Admins) ----------
const MC_COLORS = [
  ["0", "Black", "#000000"], ["1", "Dark Blue", "#0000AA"], ["2", "Dark Green", "#00AA00"], ["3", "Dark Aqua", "#00AAAA"],
  ["4", "Dark Red", "#AA0000"], ["5", "Dark Purple", "#AA00AA"], ["6", "Gold", "#FFAA00"], ["7", "Gray", "#AAAAAA"],
  ["8", "Dark Gray", "#555555"], ["9", "Blue", "#5555FF"], ["a", "Green", "#55FF55"], ["b", "Aqua", "#55FFFF"],
  ["c", "Red", "#FF5555"], ["d", "Light Purple", "#FF55FF"], ["e", "Yellow", "#FFFF55"], ["f", "White", "#FFFFFF"],
];
const hexOf = (c) => (MC_COLORS.find((x) => x[0] === c) || MC_COLORS[15])[2];
const WEB_ROLES = [["", "None"], ["2", "VIP"], ["3", "Moderator"], ["4", "Admin"]];
const PERM_PREFIXES = ["minecraft.command.", "endstone.command.", "galaxylink.command."];
let rankData = null;
let rankSearchTimer;

const iconImg = (icon) => (icon ? h("img", { class: "rank-icon", src: `/img/ranks/rank_${icon}.png`, alt: "", width: 18, height: 18 }) : null);

function rankPreview(prefix, color, name, icon) {
  const span = h("span", { class: "rank-preview" });
  const tag = h("span", { text: `[${prefix}]` });
  tag.style.color = hexOf(color);
  span.append(...[iconImg(icon), tag, " ", h("span", { text: name })].filter(Boolean));
  return span;
}

function splitPerms(perms) {
  const commands = [];
  const other = [];
  for (const p of perms) {
    const pre = PERM_PREFIXES.find((x) => p.startsWith(x));
    if (pre) commands.push(p.slice(pre.length)); else other.push(p);
  }
  return { commands, other };
}

loaders.ranks = async () => {
  const q = $("rank-player-search").value.trim();
  rankData = await getJson(`/api/mod/ranks?q=${encodeURIComponent(q)}`);
  const list = $("rank-list");
  list.replaceChildren();
  if (!rankData.ranks.length) list.append(h("div", { class: "empty", text: "No ranks yet. Select New rank to create one." }));
  for (const r of rankData.ranks) {
    const role = WEB_ROLES.find((x) => x[0] === String(r.websiteRole || ""))[1];
    const { commands } = splitPerms(r.permissions);
    list.append(h("div", { class: "member-row" },
      h("div", { class: "info" },
        h("strong", {}, rankPreview(r.prefix, r.color, r.name, r.icon)),
        h("span", { text: `${r.players} player${r.players === 1 ? "" : "s"} · ${commands.length ? "Commands: " + commands.map((c) => "/" + c).join(" ") : "No commands"} · Website role: ${role}` })),
      h("div", { class: "row-actions" },
        h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Edit", onclick: () => rankDialog(r) }),
        h("button", { class: "btn btn-danger btn-sm", type: "button", text: "Delete", onclick: () => deleteRank(r) }))));
  }
  renderRankPlayers();
};

function renderRankPlayers() {
  const box = $("rank-players");
  box.replaceChildren();
  if (!rankData.players.length) { box.append(h("div", { class: "empty", text: "No players found." })); return; }
  for (const p of rankData.players) {
    const sel = h("select", { class: "input", "aria-label": `Rank for ${p.gamertag}`, style: "width:auto;min-width:170px" });
    sel.append(h("option", { value: "", text: "No rank" }));
    for (const r of rankData.ranks) sel.append(h("option", { value: r.id, text: `[${r.prefix}] ${r.name}`, selected: r.id === p.rankId }));
    sel.addEventListener("change", async () => {
      sel.disabled = true;
      try {
        await postJson("/api/mod/ranks/assign", { xuid: p.xuid, rankId: sel.value || null });
        toast(sel.value ? `Rank given to ${p.gamertag}.` : `Rank removed from ${p.gamertag}.`);
        loaders.ranks();
      } catch (e) { toast(e.message); sel.disabled = false; }
    });
    box.append(h("div", { class: "member-row" },
      h("div", { class: "info" }, h("strong", {}, p.gamertag, p.linked ? h("span", { class: "pill-status owner", text: "Website account" }) : null),
        h("span", { text: `Last seen ${fmt(p.lastSeen)}` })),
      sel));
  }
}

$("rank-player-search").addEventListener("input", () => { clearTimeout(rankSearchTimer); rankSearchTimer = setTimeout(loaders.ranks, 300); });
$("rank-new").addEventListener("click", () => rankDialog(null));

// A row of toggle buttons (colors, icons). Returns { el, value() }.
function choiceGrid(label, options, initial, render) {
  let value = initial;
  const el = h("div", { class: "choice-grid", role: "group", "aria-label": label });
  const buttons = options.map(([v, name]) => {
    const b = h("button", { type: "button", title: name, "aria-label": name, "aria-pressed": String(v === value) }, render(v, name));
    b.addEventListener("click", () => {
      value = v;
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return b;
  });
  el.append(...buttons);
  return { el, value: () => value };
}

// Type a command and press Enter (or space / comma) to add it as a chip.
function commandChips(initial) {
  const list = [...initial];
  const input = h("input", { id: "rank-commands", placeholder: list.length ? "Add another…" : "Type a command, like time, then press Enter", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
  const box = h("div", { class: "chips", onclick: () => input.focus() });
  const draw = () => {
    box.replaceChildren(...list.map((c, i) => h("span", { class: "chip" }, "/" + c,
      h("button", { type: "button", "aria-label": `Remove /${c}`, text: "×", onclick: (e) => { e.stopPropagation(); list.splice(i, 1); draw(); } }))), input);
  };
  const add = () => {
    for (const part of input.value.split(/[\s,]+/)) {
      const c = part.trim().replace(/^\/+/, "").toLowerCase();
      if (c && /^[a-z0-9_-]{1,40}$/.test(c) && !list.includes(c)) list.push(c);
    }
    input.value = "";
    draw();
    input.focus();
  };
  input.addEventListener("keydown", (e) => {
    if (["Enter", " ", ","].includes(e.key)) { e.preventDefault(); add(); }
    else if (e.key === "Backspace" && !input.value && list.length) { list.pop(); draw(); input.focus(); }
  });
  input.addEventListener("blur", () => { if (input.value.trim()) add(); });
  draw();
  return { el: box, value: () => { if (input.value.trim()) add(); return [...list]; } };
}

function rankDialog(rank) {
  const r = rank || { name: "", prefix: "", color: "f", icon: null, permissions: [], websiteRole: null };
  const { commands, other } = splitPerms(r.permissions);
  const name = h("input", { class: "input", id: "rank-name", maxlength: 24, value: r.name, placeholder: "e.g. Builder" });
  const prefix = h("input", { class: "input", id: "rank-prefix", maxlength: 16, value: r.prefix, placeholder: "e.g. BUILDER" });
  const color = choiceGrid("Color", MC_COLORS.map(([c, n]) => [c, n]), r.color, (c) => { const s = h("span", { class: "swatch" }); s.style.background = hexOf(c); return s; });
  const icon = choiceGrid("Icon", [["", "No icon"], ...rankData.icons.map((i) => [i, i[0].toUpperCase() + i.slice(1)])], r.icon || "",
    (v) => (v ? h("img", { src: `/img/ranks/rank_${v}.png`, alt: "" }) : h("span", { text: "None" })));
  const role = select("rank-role", WEB_ROLES, String(r.websiteRole || ""));
  const cmds = commandChips(commands);
  const advanced = h("input", { class: "input", id: "rank-other", placeholder: "someplugin.permission, another.one", value: other.join(", ") });
  const preview = h("div", { class: "rank-preview-box" });
  const update = () => {
    preview.replaceChildren(rankPreview(prefix.value || "PREFIX", color.value(), "VisionDevs", icon.value()), h("span", { class: "text-3", text: ": hello!" }));
  };
  [name, prefix, color.el, icon.el].forEach((el) => el.addEventListener("input", update));
  update();
  openDialog({
    title: rank ? `Edit ${rank.name}` : "New rank",
    body: h("div", { class: "form" },
      preview,
      field("Rank name", name),
      field("Prefix", prefix, "Shown as [PREFIX] in chat and above heads."),
      h("div", { class: "field" }, h("span", { class: "field-label", text: "Color" }), color.el),
      h("div", { class: "field" }, h("span", { class: "field-label", text: "Icon" }), icon.el,
        h("p", { class: "hint", text: "Shown before the prefix in game (players need the GalaxySMP Icons pack, which the server sends automatically)." })),
      h("div", { class: "field" }, h("label", { class: "field-label", for: "rank-commands", text: "Commands this rank can use" }), cmds.el,
        h("p", { class: "hint", text: "Type a command name and press Enter, for example time, weather, gamemode or tp. A command includes everything after it: time also allows /time set day. Players don't need to be operators." })),
      field("Website role", role, "Players with this rank who linked a website account also get this role in chat and voice. Roles set by hand are never lowered."),
      h("details", {}, h("summary", { class: "text-3 small", text: "Advanced: other permission nodes" }),
        field("Permission nodes", advanced, "For other plugins' permissions, separated by commas."))),
    actions: [{ label: "Cancel" }, {
      label: rank ? "Save" : "Create", kind: "primary",
      onClick: async () => {
        await postJson(`/api/mod/ranks/${rank ? "update" : "create"}`, {
          id: rank?.id, name: name.value, prefix: prefix.value, color: color.value(), icon: icon.value() || null,
          websiteRole: role.value || null, commands: cmds.value(),
          permissions: advanced.value.split(",").map((s) => s.trim()).filter(Boolean),
        });
        toast(rank ? "Rank saved." : "Rank created.");
        loaders.ranks();
      },
    }],
  });
}

function deleteRank(r) {
  openDialog({
    title: `Delete ${r.name}?`,
    body: h("p", { class: "text-2", text: `${r.players} player${r.players === 1 ? "" : "s"} will lose this rank, its prefix and its commands.` }),
    actions: [{ label: "Cancel" }, {
      label: "Delete rank", kind: "danger",
      onClick: async () => { await postJson("/api/mod/ranks/delete", { id: r.id }); toast("Rank deleted."); loaders.ranks(); },
    }],
  });
}

// ---------- Economy (Admins) ----------
const money = (cents) => {
  const d = cents / 100;
  if (Math.abs(d) < 10000) return "$" + d.toLocaleString("en-US", { maximumFractionDigits: 2 });
  for (const [size, letter] of [[1e15, "Q"], [1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
    if (Math.abs(d) >= size) return `$${(d / size).toFixed(2).replace(/\.?0+$/, "")}${letter}`;
  }
  return "$" + d;
};
let ecoData = null;
let ecoShop = null;
let ecoDirty = false;
let ecoSearchTimer;

loaders.economy = async () => {
  const q = $("eco-search").value.trim();
  ecoData = await getJson(`/api/mod/economy?q=${encodeURIComponent(q)}`);
  $("eco-server").textContent = ecoData.serverOnline ? "The server is connected: changes apply in game within seconds." : "The server isn't connected right now. Price changes are saved and sent when it's back; money can only be changed while it's online.";
  $("eco-server").className = `small ${ecoData.serverOnline ? "text-3" : "text-warn"}`;
  renderEcoPlayers();
  if (!ecoDirty) { ecoShop = structuredClone(ecoData.shop); renderShop(); }
};
$("eco-search").addEventListener("input", () => { clearTimeout(ecoSearchTimer); ecoSearchTimer = setTimeout(loaders.economy, 300); });

function renderEcoPlayers() {
  const box = $("eco-players");
  box.replaceChildren();
  if (!ecoData.players.length) { box.append(h("div", { class: "empty", text: "No players found. Players appear after they join the server." })); return; }
  for (const p of ecoData.players) {
    box.append(h("div", { class: "member-row" },
      h("div", { class: "info" },
        h("strong", {}, p.gamertag, p.op ? h("span", { class: "pill-status owner", text: "Operator · ∞" }) : null),
        h("span", {}, h("span", { class: "money-cell", text: p.cents == null ? "No balance yet" : money(p.cents) }), ` · last seen ${fmt(p.lastSeen)}`)),
      h("div", { class: "row-actions" },
        h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Change money", onclick: () => moneyDialog(p) }))));
  }
}

function moneyDialog(p) {
  const action = select("eco-action", [["add", "Give money"], ["take", "Take money"], ["set", "Set balance to"]], "add");
  const amount = h("input", { class: "input", id: "eco-amount", inputmode: "decimal", placeholder: "e.g. 1000", autocomplete: "off" });
  openDialog({
    title: `Money for ${p.gamertag}`,
    body: h("div", { class: "form" },
      h("p", { class: "text-2", style: "margin:0", text: `Current balance: ${p.cents == null ? "none yet" : "$" + (p.cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}` }),
      field("Action", action), field("Amount in dollars", amount, "Works for offline players too, as long as the server is online.")),
    actions: [{ label: "Cancel" }, {
      label: "Save", kind: "primary",
      onClick: async () => {
        const res = await postJson("/api/mod/economy/money", { xuid: p.xuid, action: action.value, amount: amount.value });
        toast(`${p.gamertag} now has ${money(res.cents)}.`);
        loaders.economy();
      },
    }],
  });
}

function priceInput(label, value, onChange) {
  const input = h("input", { class: "input", inputmode: "decimal", value: value ?? "", placeholder: "Off", "aria-label": label });
  input.addEventListener("input", () => onChange(input.value.trim() === "" ? null : input.value.trim()));
  return h("label", {}, label, input);
}

function markDirty() {
  ecoDirty = true;
  $("eco-save").disabled = false;
  $("eco-status").textContent = "Unsaved changes";
}

function renderShop() {
  const box = $("eco-shop");
  const open = new Set([...box.querySelectorAll("details[open]")].map((d) => d.dataset.i));
  box.replaceChildren();
  ecoShop.categories.forEach((cat, ci) => {
    const items = h("div", { class: "eco-items" });
    cat.items.forEach((it, ii) => {
      const nameIn = h("input", { class: "input", value: it.name, "aria-label": "Item name", placeholder: "Name" });
      nameIn.addEventListener("input", () => { it.name = nameIn.value; markDirty(); });
      items.append(h("div", { class: "eco-item" },
        h("label", {}, it.id.replace("minecraft:", ""), nameIn),
        priceInput("Buy $", it.buy, (v) => { it.buy = v; markDirty(); }),
        priceInput("Sell $", it.sell, (v) => { it.sell = v; markDirty(); }),
        h("button", { class: "btn btn-ghost btn-sm remove", type: "button", "aria-label": `Remove ${it.name}`, text: "×",
          onclick: () => { cat.items.splice(ii, 1); markDirty(); renderShop(); } })));
    });
    const newId = h("input", { class: "input", placeholder: "Item ID, e.g. diamond_block", "aria-label": "New item ID", autocapitalize: "off", spellcheck: "false" });
    items.append(h("div", { class: "eco-head" }, newId, h("button", {
      class: "btn btn-secondary btn-sm", type: "button", text: "Add item",
      onclick: () => {
        const id = newId.value.trim().toLowerCase().replace(/\s+/g, "_");
        if (!id) return;
        const full = id.includes(":") ? id : `minecraft:${id}`;
        cat.items.push({ id: full, name: full.split(":")[1].replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()), buy: 10, sell: null, icon: "" });
        markDirty(); renderShop();
      },
    })));
    const catName = h("input", { class: "input", value: cat.name, "aria-label": "Category name" });
    catName.addEventListener("input", () => { cat.name = catName.value; markDirty(); });
    items.prepend(h("div", { class: "eco-head" }, h("label", { class: "small text-3" }, "Category name", catName),
      h("button", { class: "btn btn-danger btn-sm", type: "button", text: "Delete category",
        onclick: () => { if (confirm(`Delete the category "${cat.name}" and its ${cat.items.length} items?`)) { ecoShop.categories.splice(ci, 1); markDirty(); renderShop(); } } })));
    const det = h("details", { class: "eco-cat", "data-i": String(ci) },
      h("summary", {}, cat.name || "Untitled", h("span", { class: "text-3", text: `${cat.items.length} items` })), items);
    if (open.has(String(ci))) det.open = true;
    box.append(det);
  });
  $("eco-save").disabled = !ecoDirty;
  $("eco-status").textContent = ecoDirty ? "Unsaved changes" : ecoData.custom ? `Last changed by ${ecoData.shopUpdated.by} on ${fmt(ecoData.shopUpdated.at)}` : "Using the built-in price list";
}

$("eco-add-cat").addEventListener("click", () => {
  const name = prompt("Name for the new category:");
  if (!name) return;
  ecoShop.categories.push({ id: "", name: name.slice(0, 32), icon: "", items: [] });
  markDirty(); renderShop();
  $("eco-shop").lastElementChild.open = true;
});
$("eco-save").addEventListener("click", async () => {
  $("eco-save").disabled = true;
  try {
    const res = await postJson("/api/mod/economy/shop", { shop: ecoShop });
    ecoDirty = false;
    toast(res.sent ? "Shop saved and sent to the server." : "Shop saved. It will be sent when the server is online.");
    loaders.economy();
  } catch (e) { toast(e.message); $("eco-save").disabled = false; }
});
$("eco-reset").addEventListener("click", () => openDialog({
  title: "Go back to the built-in prices?",
  body: h("p", { class: "text-2", text: "This replaces every category, item and price with the original GalaxySMP price list." }),
  actions: [{ label: "Cancel" }, {
    label: "Reset prices", kind: "danger",
    onClick: async () => { await postJson("/api/mod/economy/reset-shop", {}); ecoDirty = false; toast("Prices reset."); loaders.economy(); },
  }],
}));

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
  if (power >= 100) document.querySelectorAll('[data-tab="ranks"], [data-tab="economy"]').forEach((t) => (t.hidden = false));
  selectTab(["reports", "members", "words", "audit", ...(power >= 100 ? ["ranks", "economy"] : [])].includes(start) ? start : "reports");
})();
