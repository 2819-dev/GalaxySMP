// Staff category: #Staff Logs (moderation actions from the website and the game, newest first) and
// #Reports (open chat and in-game reports, handled right here). Text goes in with textContent only.
import { h, getJson, postJson, openDialog, field } from "/js/dialog.js";

const when = (d) => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const length = (m) => (m == null ? "permanent" : m >= 1440 ? `${Math.round(m / 1440)} day${m >= 2880 ? "s" : ""}` : m >= 60 ? `${Math.round(m / 60)} hour${m >= 120 ? "s" : ""}` : `${m} minutes`);

// [what happened, the member it happened to]
const DESCRIBE = {
  "message.delete": (e) => ["deleted a message by", e.target],
  "user.mute": (e) => [`muted (${length(e.details.minutes)})`, e.target],
  "user.unmute": (e) => ["unmuted", e.target],
  "user.ban": (e) => ["banned on the website", e.target],
  "user.unban": (e) => ["unbanned on the website", e.target],
  "voice.mute": (e) => [`muted in voice (${length(e.details.minutes)})`, e.target],
  "voice.unmute": (e) => ["unmuted in voice", e.target],
  "voice.kick": (e) => ["removed from voice", e.target],
  "game.warn": (e) => ["warned", e.details.player],
  "game.mute": (e) => [`muted in game (${length(e.details.minutes)})`, e.details.player],
  "game.unmute": (e) => ["unmuted in game", e.details.player],
  "game.kick": (e) => ["kicked from the server", e.details.player],
  "game.ban": (e) => [`banned from the server (${length(e.details.minutes)})`, e.details.player],
  "game.unban": (e) => ["unbanned from the server", e.details.player],
  "game.rollback": (e) => [`rolled back ${e.details.blocks ?? "the"} blocks (last ${e.details.span || "while"}) of`, e.details.player],
  "report.resolve": () => ["resolved a chat report", null],
  "report.dismiss": () => ["dismissed a chat report", null],
  "game_report.resolve": () => ["resolved an in-game report", null],
  "game_report.dismiss": () => ["dismissed an in-game report", null],
  "uploads.remove-banner": (e) => ["removed the banner of", e.details.member],
  "uploads.remove-picture": (e) => ["removed the profile picture of", e.details.member],
  "uploads.block": (e) => ["stopped picture uploads for", e.details.member],
  "uploads.unblock": (e) => ["allowed picture uploads again for", e.details.member],
  "appeal.accepted": (e) => ["accepted the ban appeal of", e.details.player],
  "appeal.declined": (e) => ["declined the ban appeal of", e.details.player],
};
const KIND = (a) => (/ban|kick/.test(a) && !/unban/.test(a) ? "bad" : /mute|warn|rollback|remove|block|delete/.test(a) && !/un(mute|block)/.test(a) ? "warn" : "ok");

export function renderStaffLogs(root, { setTimer }) {
  const list = h("div", { class: "sl-list" });
  const more = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Load older", hidden: true });
  root.append(h("div", { class: "cp-wrap" },
    h("div", { class: "tl-intro" }, h("h2", { text: "Staff Logs" }),
      h("p", { class: "text-3", text: "Bans, mutes, kicks, warnings and rollbacks from the website and the game. Only staff can see this." })),
    list, more));
  let oldest = null;
  let newest = 0;
  const row = (e) => {
    const [what, who] = (DESCRIBE[e.action] || (() => [e.action, null]))(e);
    const by = e.details?.by && /\(in game\)$/.test(e.details.by) ? e.details.by : e.actor || e.details?.by || "Someone";
    const line = h("div", { class: "sl-line" }, h("b", { text: by }), ` ${what} `, who ? h("b", { text: who }) : null);
    const reason = e.details?.reason ? h("div", { class: "sl-reason text-3 small", text: `Reason: ${e.details.reason}` }) : null;
    return h("div", { class: `sl-row ${KIND(e.action)}`, "data-id": String(e.id) },
      h("span", { class: "sl-dot", "aria-hidden": "true" }),
      h("div", { class: "sl-body" }, line, reason), h("time", { class: "text-3 small", text: when(e.at) }));
  };
  async function load(older) {
    try {
      const d = await getJson(`/api/staff-room/logs${older && oldest ? `?before=${oldest}` : ""}`);
      if (!older) {
        const fresh = d.entries.filter((e) => e.id > newest);
        if (newest) list.prepend(...fresh.map(row));
        else list.replaceChildren(...(d.entries.length ? d.entries.map(row) : [h("p", { class: "text-3", text: "Nothing yet. Moderation actions show up here as they happen." })]));
        if (!oldest) more.hidden = !d.more;
      } else {
        list.append(...d.entries.map(row));
        more.hidden = !d.more;
      }
      for (const e of d.entries) { newest = Math.max(newest, e.id); oldest = oldest ? Math.min(oldest, e.id) : e.id; }
    } catch (err) { if (!newest) list.replaceChildren(h("p", { class: "text-3", text: err.message })); }
  }
  more.addEventListener("click", () => load(true));
  load(false);
  setTimer(setInterval(() => load(false), 20_000));
}

// ---------- #Reports ----------
export function renderReports(root, { toast, setTimer }) {
  const box = h("div", { class: "sl-list" });
  root.append(h("div", { class: "cp-wrap" },
    h("div", { class: "tl-intro" }, h("h2", { text: "Reports" }),
      h("p", { class: "text-3" }, "Open chat and in-game reports. New ones show up here by themselves. ",
        h("a", { href: "/staff#reports", text: "Open the full list in the Staff Panel" }), ".")),
    box));

  const decide = (title, run) => {
    const note = h("input", { class: "input", id: "rp-note", maxlength: 200, placeholder: "e.g. Warned the player" });
    openDialog({
      title,
      body: h("div", { class: "form" }, field("Note (optional)", note)),
      actions: [{ label: "Cancel" },
        { label: "Dismiss", onClick: async () => { await run("dismissed", note.value); toast("Report dismissed."); load(); } },
        { label: "Resolved", kind: "primary", onClick: async () => { await run("resolved", note.value); toast("Report resolved."); load(); } }],
    });
  };

  const card = (title, lines, onHandle, at) => h("div", { class: "sl-row warn" },
    h("span", { class: "sl-dot", "aria-hidden": "true" }),
    h("div", { class: "sl-body" }, h("div", { class: "sl-line" }, ...title), ...lines.filter(Boolean).map((t) => h("div", { class: "text-3 small", text: t }))),
    h("div", { class: "sl-side" }, h("time", { class: "text-3 small", text: when(at) }),
      h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Handle", onclick: onHandle })));

  async function load() {
    let chat, game;
    try {
      [chat, game] = await Promise.all([getJson("/api/mod/reports"), getJson("/api/mod/game-reports")]);
    } catch (e) {
      box.replaceChildren(h("p", { class: "text-3", text: e.message }));
      return;
    }
    const items = [
      ...game.open.map((r) => ({ at: r.at, el: card(
        [h("b", { text: r.reporter }), " reported ", h("b", { text: r.target }), ` · ${r.reason}`],
        [r.details ? `"${r.details}"` : null, r.world && r.x != null ? `In game at ${r.world} ${r.x}, ${r.y}, ${r.z}` : "Sent from the website",
          r.history?.length ? `Before: ${r.history.map((x) => x.kind).join(", ")}` : null],
        () => decide(`Report about ${r.target}`, (outcome, note) => postJson(`/api/mod/game-reports/${r.id}/resolve`, { outcome, note })), r.at) })),
      ...chat.open.map((r) => ({ at: r.firstReported, el: card(
        [h("b", { text: `${r.count} report${r.count === 1 ? "" : "s"}` }), " on a message by ", h("b", { text: r.author.username }), ` in #${r.channel}`],
        [`"${String(r.content || "").slice(0, 200)}"${r.deleted ? " (deleted)" : ""}`, r.reports.map((x) => `${x.reporter}: ${x.reason}`).join(" · ")],
        () => decide(`Message by ${r.author.username}`, (outcome, note) => postJson(`/api/mod/reports/${r.messageId}/resolve`, { outcome, note })), r.firstReported) })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));
    box.replaceChildren(...(items.length ? items.map((i) => i.el) : [h("p", { class: "text-3", text: "No open reports. Nice and quiet." })]));
  }
  load();
  setTimer(setInterval(load, 30_000));
}
