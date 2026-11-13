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
  "server.crash": (e) => [`stopped unexpectedly (last seen ${e.details.lastSeen || "unknown"}). Recent changes in the world may have been lost.`, null],
};
const KIND = (a) => (a === "server.crash" ? "bad" : /ban|kick/.test(a) && !/unban/.test(a) ? "bad" : /mute|warn|rollback|remove|block|delete/.test(a) && !/un(mute|block)/.test(a) ? "warn" : "ok");

// A crash report: what the plugin was doing, who was online and the end of the server log.
function crashDetails(d) {
  const facts = [
    `Last activity: ${d.doing || "unknown"}`,
    d.uptimeMinutes != null ? `Up for ${d.uptimeMinutes} min before it stopped` : null,
    `Online: ${d.players?.length ? d.players.join(", ") : "nobody"}`,
  ].filter(Boolean);
  const log = d.log?.length
    ? h("details", { class: "sl-crash-log" }, h("summary", { text: `End of the server log${d.logFile ? ` (${d.logFile})` : ""}` }),
      h("pre", { class: "small", text: d.log.join("\n") }))
    : h("div", { class: "text-3 small", text: "No server log file was found to attach." });
  return h("div", { class: "sl-reason text-3 small" }, ...facts.map((f) => h("div", { text: f })), log);
}

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
    const reason = e.details?.reason ? h("div", { class: "sl-reason text-3 small", text: `Reason: ${e.details.reason}` }) : null
      || (e.action === "server.crash" ? crashDetails(e.details || {}) : null);
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
    box.replaceChildren(...(items.length ? items.map((i) => i.el) : [h("p", { class: "text-3", text: "No open reports." })]));
  }
  load();
  setTimer(setInterval(load, 30_000));
}

// ---------- #Shifts (like Melonly): clock in / break / clock out, weekly quota, leave of absence ----------
const dur = (secs) => { const m = Math.max(0, Math.round(secs / 60)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const day = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric" });

export function renderShifts(root, { toast, setTimer }) {
  const wrap = h("div", { class: "cp-wrap sh-wrap" });
  root.append(wrap);
  let data = null;
  let ticker = null;

  const act = async (action) => {
    try { const r = await postJson("/api/shifts/action", { action }); toast(r.message); await load(); } catch (e) { toast(e.message); }
  };

  function loaDialog() {
    const today = new Date().toISOString().slice(0, 10);
    const starts = h("input", { class: "input", id: "loa-start", type: "date", min: today, value: today });
    const ends = h("input", { class: "input", id: "loa-end", type: "date", min: today, value: today });
    const reason = h("textarea", { class: "input", id: "loa-reason", rows: 3, maxlength: 300, placeholder: "e.g. Family trip, exams, being sick" });
    openDialog({
      title: "Ask for time off",
      body: h("div", { class: "form" }, h("div", { class: "sh-dates" }, field("First day", starts), field("Last day", ends)), field("Reason", reason),
        h("p", { class: "text-3 small", style: "margin:0", text: "While your leave is approved, your weekly quota doesn't count." })),
      actions: [{ label: "Cancel" }, { label: "Send request", kind: "primary", onClick: async () => {
        await postJson("/api/shifts/loa", { starts: starts.value, ends: ends.value, reason: reason.value });
        toast("Request sent. You'll get a notification when it's answered."); load();
      } }],
    });
  }

  function decide(l) {
    const note = h("input", { class: "input", id: "loa-note", maxlength: 200, placeholder: "Optional note" });
    openDialog({
      title: `${l.username}: ${day(l.starts)} to ${day(l.ends)}`,
      body: h("div", { class: "form" }, h("p", { class: "text-2", text: l.reason }), field("Note", note)),
      actions: [{ label: "Cancel" },
        { label: "Decline", kind: "danger", onClick: async () => { await postJson(`/api/shifts/loa/${l.id}`, { status: "declined", note: note.value }); toast("Declined."); load(); } },
        { label: "Approve", kind: "primary", onClick: async () => { await postJson(`/api/shifts/loa/${l.id}`, { status: "approved", note: note.value }); toast("Approved."); load(); } }],
    });
  }

  const loaRow = (l, mine) => h("div", { class: "sh-row" },
    h("div", { class: "sh-row-main" }, h("b", { text: mine ? `${day(l.starts)} to ${day(l.ends)}` : `${l.username} · ${day(l.starts)} to ${day(l.ends)}` }),
      h("div", { class: "text-3 small", text: l.reason }), l.note ? h("div", { class: "text-3 small", text: `Note: ${l.note}` }) : null),
    h("span", { class: `sh-status ${l.status}`, text: { open: "Waiting", approved: "Approved", declined: "Declined", cancelled: "Cancelled" }[l.status] }),
    mine && ["open", "approved"].includes(l.status) && l.ends >= new Date().toISOString().slice(0, 10)
      ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Cancel", onclick: async () => { try { await postJson(`/api/shifts/loa/${l.id}`, { status: "cancelled" }); load(); } catch (e) { toast(e.message); } } })
      : !mine && l.status === "open" ? h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Answer", onclick: () => decide(l) }) : null);

  function draw() {
    const d = data, me = d.me, s = me.shift;
    const clock = h("div", { class: "sh-clock", text: s ? dur(s.secs) : "Off duty" });
    const state = s ? (s.onBreak ? "On a break" : "On shift") : "Not on shift";
    const buttons = h("div", { class: "sh-buttons" }, ...(s
      ? [s.onBreak ? h("button", { class: "btn btn-primary", type: "button", text: "End break", onclick: () => act("resume") })
                   : h("button", { class: "btn btn-secondary", type: "button", text: "Take a break", onclick: () => act("break") }),
         h("button", { class: "btn btn-danger", type: "button", text: "Clock out", onclick: () => act("end") })]
      : [h("button", { class: "btn btn-primary", type: "button", text: "Clock in", onclick: () => act("start") })]));
    const q = me.quotaMin * 60;
    const pct = q ? Math.min(100, Math.round((me.weekSecs / q) * 100)) : 0;
    const bar = h("div", { class: "sh-bar" }, h("span", { style: `width:${pct}%` }));
    const card = h("section", { class: `sh-card${s ? (s.onBreak ? " break" : " on") : ""}` },
      h("div", { class: "sh-top" }, h("div", {}, h("div", { class: "sh-state", text: state }), clock), buttons),
      h("div", { class: "sh-week" },
        h("div", { class: "sh-week-line" }, h("b", { text: `This week: ${dur(me.weekSecs)}` }),
          me.loaUntil ? h("span", { class: "sh-status approved", text: `On leave until ${day(me.loaUntil)}` })
            : q ? h("span", { class: "text-3 small", text: `Quota ${dur(q)} · ${pct >= 100 ? "done ✓" : `${dur(Math.max(0, q - me.weekSecs))} to go`}` }) : h("span", { class: "text-3 small", text: "No weekly quota" })),
        q ? bar : null),
      h("p", { class: "text-3 small", style: "margin:8px 0 0", text: "In game: /shift on, /shift break, /shift back, /shift off" }));
    ticker = s && !s.onBreak ? { el: clock, base: s.secs, at: Date.now() } : null;

    const duty = h("section", { class: "sh-panel" }, h("h3", { text: `On duty · ${d.onDuty.length}` }),
      d.onDuty.length ? h("div", { class: "sh-list" }, ...d.onDuty.map((x) => h("div", { class: "sh-row" },
        h("span", { class: `sh-dot ${x.onBreak ? "break" : "on"}` }), h("div", { class: "sh-row-main" }, h("b", { text: x.username }),
          h("div", { class: "text-3 small", text: `${x.onBreak ? "On a break" : "On shift"} · since ${new Date(x.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${x.source === "game" ? " · in game" : ""}` })))))
        : h("p", { class: "text-3", text: "Nobody is on shift right now." }));

    const leave = h("section", { class: "sh-panel" },
      h("div", { class: "sh-head" }, h("h3", { text: "My leave" }), h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Ask for time off", onclick: loaDialog })),
      d.loa.length ? h("div", { class: "sh-list" }, ...d.loa.map((l) => loaRow(l, true))) : h("p", { class: "text-3", text: "No leave requests." }));

    const recent = h("section", { class: "sh-panel" }, h("h3", { text: "My recent shifts" }),
      d.recent.length ? h("div", { class: "sh-list" }, ...d.recent.map((x) => h("div", { class: "sh-row" },
        h("div", { class: "sh-row-main" }, h("b", { text: new Date(x.startedAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }),
          h("div", { class: "text-3 small", text: `${dur(x.secs)}${x.source === "game" ? " · in game" : ""}${x.endedBy === "auto" ? " · closed automatically after 10 hours" : ""}` })))))
        : h("p", { class: "text-3", text: "No shifts yet." }));

    const parts = [h("div", { class: "tl-intro" }, h("h2", { text: "Shifts" }),
      h("p", { class: "text-3", text: "Clock in when you're helping out, take breaks, and clock out when you're done. Weeks start on Monday." })), card, duty];
    if (d.manager) {
      const team = h("section", { class: "sh-panel" }, h("h3", { text: "Team this week" }),
        h("div", { class: "sh-list" }, ...d.team.map((m) => {
          const tq = m.quotaMin * 60, ok = !tq || m.weekSecs >= tq;
          return h("div", { class: "sh-row" }, h("span", { class: `sh-dot ${m.status}` }),
            h("div", { class: "sh-row-main" }, h("b", { text: m.username }),
              h("div", { class: "text-3 small", text: `${dur(m.weekSecs)}${tq ? ` of ${dur(tq)}` : ""}` })),
            m.loaUntil ? h("span", { class: "sh-status approved", text: "On leave" })
              : tq ? h("span", { class: `sh-status ${ok ? "approved" : "open"}`, text: ok ? "Quota met" : "Behind" }) : null);
        })));
      const reqs = h("section", { class: "sh-panel" }, h("h3", { text: "Leave requests" }),
        d.requests.length ? h("div", { class: "sh-list" }, ...d.requests.map((l) => loaRow(l, false))) : h("p", { class: "text-3", text: "No requests." }));
      parts.push(team, reqs);
    }
    parts.push(leave, recent);
    wrap.replaceChildren(...parts);
  }

  async function load() {
    try { data = await getJson("/api/shifts"); draw(); } catch (e) { wrap.replaceChildren(h("p", { class: "text-3", text: e.message })); }
  }
  load();
  let n = 0;
  setTimer(setInterval(() => {  // the clock moves every 15 seconds; everything reloads every minute
    if (++n % 4 === 0) load();
    else if (ticker) ticker.el.textContent = dur(ticker.base + (Date.now() - ticker.at) / 1000);
  }, 15_000));
}
