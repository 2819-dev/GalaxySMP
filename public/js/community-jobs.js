// #Jobs: post a job (the reward is held from your in-game money), offer to do jobs, mark them done and get paid.
// All text goes in with textContent, never as HTML.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";
import { moneyExact } from "/js/money.js";
import { faceSvg } from "/js/face.js";
import { iconEl } from "/js/site.js";

const STATUS = { open: "Open", taken: "In progress", submitted: "Waiting for check", done: "Paid", cancelled: "Cancelled", expired: "Ended" };

function left(at) {
  const ms = new Date(at) - Date.now();
  if (ms <= 0) return "soon";
  const h_ = Math.floor(ms / 36e5);
  if (h_ >= 48) return `${Math.round(h_ / 24)} days`;
  if (h_ >= 1) return `${h_} h`;
  return `${Math.max(1, Math.round(ms / 6e4))} min`;
}
function ago(at) {
  const m = Math.round((Date.now() - new Date(at)) / 6e4);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}
const face = (name) => { const i = h("img", { class: "jb-face", alt: "", width: 22, height: 22 }); i.src = faceSvg(name); return i; };

export function renderJobs(root, { toast, setTimer }) {
  const wrap = h("div", { class: "cp-wrap jb-wrap" });
  root.append(wrap);
  let data = null;
  let tab = "open";

  const act = async (job, action, extra = {}) => {
    try { const r = await postJson(`/api/jobs/${job.id}`, { action, ...extra }); toast(r.message || "Done."); await load(); } catch (e) { toast(e.message); }
  };

  function postDialog() {
    const title = h("input", { class: "input", id: "jb-title", maxlength: 80, placeholder: "e.g. 64 oak logs, a 10x10 wheat farm, 3 enchanted bows" });
    const details = h("textarea", { class: "input", id: "jb-details", rows: 3, maxlength: 600, placeholder: "Where to bring it, what it should look like, when you need it" });
    const reward = h("input", { class: "input", id: "jb-reward", type: "number", min: 1, step: "0.01", inputmode: "decimal", placeholder: "500" });
    let mode = "pick";
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Who gets the job" });
    const segBtn = (m, label) => h("button", { type: "button", "data-m": m, "aria-pressed": String(m === mode), text: label,
      onclick: () => { mode = m; [...seg.children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === mode))); } });
    seg.append(segBtn("pick", "I pick who"), segBtn("first", "First come"));
    openDialog({
      title: "Post a job",
      body: h("div", { class: "form" },
        field("What do you need?", title), field("Details (optional)", details), field("Reward (in-game $)", reward),
        field("Who gets the job?", seg),
        h("p", { class: "text-3 small", style: "margin:0",
          text: `The reward is taken from your balance now and held. The worker gets it when you confirm the job is done (or after ${data.limits.autoPayDays} days if you don't answer). If nobody takes it in ${data.limits.openDays} days, or you cancel, you get it back. The server needs to be online to post.` })),
      actions: [{ label: "Cancel" }, { label: "Post job", kind: "primary", onClick: async () => {
        const cents = Math.round(Number(reward.value) * 100);
        const r = await postJson("/api/jobs", { title: title.value, details: details.value, reward: cents, mode });
        toast(r.message); tab = "mine"; await load();
      } }],
    });
    setTimeout(() => title.focus(), 50);
  }

  function applyDialog(job) {
    const note = h("input", { class: "input", id: "jb-note", maxlength: 160, placeholder: "e.g. I can have it done tonight" });
    openDialog({
      title: `Offer to do: ${job.title}`,
      body: h("div", { class: "form" }, field("Message to " + job.poster + " (optional)", note),
        h("p", { class: "text-3 small", style: "margin:0", text: `${job.poster} picks who does it. You get a notification if it's you.` })),
      actions: [{ label: "Cancel" }, { label: "Send offer", kind: "primary", onClick: () => act(job, "apply", { note: note.value }) }],
    });
  }

  function rejectDialog(job) {
    const note = h("input", { class: "input", id: "jb-reject", maxlength: 200, placeholder: "e.g. I only got 40 logs, not 64" });
    openDialog({
      title: "Not done yet",
      body: h("div", { class: "form" }, field(`Tell ${job.worker} what's missing`, note)),
      actions: [{ label: "Cancel" }, { label: "Send", kind: "primary", onClick: () => act(job, "reject", { note: note.value }) }],
    });
  }

  function confirmDialog(job, text, label, action, kind = "primary") {
    openDialog({ title: job.title, body: h("p", { class: "text-2", text }), actions: [{ label: "Back" }, { label, kind, onClick: () => act(job, action) }] });
  }

  function buttons(job) {
    const b = (text, kind, onclick) => h("button", { class: `btn btn-${kind} btn-sm`, type: "button", text, onclick });
    const out = [];
    const linked = data.linked;
    if (job.status === "open" && !job.mine) {
      if (!linked) out.push(h("span", { class: "text-3 small", text: "Link your Minecraft account to do jobs." }));
      else if (job.mode === "first") out.push(b("Take job", "primary", () => confirmDialog(job, `Do this job in game, then press "Mark as done". You'll get ${moneyExact(job.reward)} when ${job.poster} confirms.`, "Take it", "take")));
      else if (job.applied) out.push(b("Take back offer", "ghost", () => act(job, "unapply")));
      else out.push(b("I can do it", "primary", () => applyDialog(job)));
    }
    if (job.mine) {
      if (job.status === "open") out.push(b("Cancel job", "ghost", () => confirmDialog(job, "Cancel this job? The reward goes back to your balance.", "Cancel job", "cancel", "danger")));
      if (job.status === "taken") out.push(b("Remove worker", "ghost", () => confirmDialog(job, `Take ${job.worker} off this job and open it for others again?`, "Remove", "release", "danger")));
      if (job.status === "submitted") {
        out.push(b("Not done yet", "secondary", () => rejectDialog(job)));
        out.push(b(`Confirm & pay ${moneyExact(job.reward)}`, "primary", () => confirmDialog(job, `Did ${job.worker} do the job? They get ${moneyExact(job.reward)}. This can't be undone.`, "Yes, pay them", "confirm")));
      }
    }
    if (job.working) {
      if (job.status === "taken") {
        out.push(b("Give up", "ghost", () => confirmDialog(job, "Give this job back? Someone else can take it.", "Give up", "giveup", "danger")));
        out.push(b("Mark as done", "primary", () => confirmDialog(job, `Tell ${job.poster} the job is done? Make sure you gave them everything in game first.`, "Mark as done", "submit")));
      }
    }
    if (data.staff && !job.mine && ["open", "taken", "submitted"].includes(job.status)) {
      const staff = h("details", { class: "jb-staff" }, h("summary", { text: "Staff" }),
        h("div", { class: "jb-staff-row" },
          job.workerId ? b(`Pay ${job.worker}`, "secondary", () => confirmDialog(job, `Settle this job: pay ${job.worker} ${moneyExact(job.reward)}.`, "Pay worker", "staff_pay")) : null,
          b("Cancel & refund poster", "danger", () => confirmDialog(job, `Cancel this job and give ${job.poster} their money back.`, "Cancel & refund", "cancel", "danger"))));
      out.push(staff);
    }
    return out;
  }

  function card(job) {
    const meta = [];
    if (job.status === "open") meta.push(job.mode === "first" ? "First come, first served" : `${job.poster} picks who`, `ends in ${left(job.endsAt)}`);
    if (job.status === "submitted" && job.autoPayAt) meta.push(`auto-pays in ${left(job.autoPayAt)}`);
    if (job.status === "open" && job.mode === "pick" && job.applicantCount) meta.push(`${job.applicantCount} offer${job.applicantCount === 1 ? "" : "s"}`);
    const el = h("article", { class: `jb-card ${job.status}${job.mine ? " mine" : ""}${job.working ? " working" : ""}` },
      h("div", { class: "jb-top" },
        h("div", { class: "jb-main" },
          h("h3", { class: "jb-title", text: job.title }),
          h("div", { class: "jb-by" }, face(job.poster), h("span", { text: job.mine ? "You" : job.poster }), h("span", { class: "text-3", text: `· ${ago(job.createdAt)}` }))),
        h("div", { class: "jb-reward" }, h("span", { class: "jb-reward-k", text: "Reward" }), h("b", { text: moneyExact(job.reward) }))),
      job.details ? h("p", { class: "jb-details", text: job.details }) : null,
      h("div", { class: "jb-chips" },
        h("span", { class: `jb-status ${job.status}`, text: STATUS[job.status] }),
        job.worker ? h("span", { class: "jb-chip" }, face(job.worker), job.working ? "You're doing it" : `${job.worker} is doing it`) : null,
        ...meta.map((m) => h("span", { class: "jb-chip", text: m }))),
      job.note && job.status === "taken" ? h("p", { class: "jb-note", text: `${job.poster}: "${job.note}"` }) : null,
      job.settledBy?.startsWith("staff:") && !["open", "taken", "submitted"].includes(job.status) ? h("p", { class: "text-3 small", text: "Settled by staff." }) : null);
    if (job.mine && job.status === "open" && job.mode === "pick") {
      const list = h("div", { class: "jb-apps" }, h("div", { class: "jb-apps-k", text: job.applicants.length ? "Who can do it" : "No offers yet. Players get it when they open #Jobs." }),
        ...job.applicants.map((a) => h("div", { class: "jb-app" }, face(a.name),
          h("div", { class: "jb-app-main" }, h("b", { text: a.name }), a.note ? h("span", { class: "text-3 small", text: a.note }) : null),
          h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Hire", onclick: () => openDialog({
            title: job.title, body: h("p", { class: "text-2", text: `Pick ${a.name} for this job? The others are told it's filled.` }),
            actions: [{ label: "Back" }, { label: `Hire ${a.name}`, kind: "primary", onClick: () => act(job, "hire", { userId: a.userId }) }] }) }))));
      el.append(list);
    }
    const btns = buttons(job);
    if (btns.length) el.append(h("div", { class: "jb-actions" }, ...btns));
    return el;
  }

  function draw() {
    const d = data;
    const open = d.jobs.filter((j) => j.status === "open" && !j.mine);
    const mine = d.jobs.filter((j) => j.mine);
    const doing = d.jobs.filter((j) => j.working);
    const busy = d.jobs.filter((j) => ["taken", "submitted"].includes(j.status) && !j.mine && !j.working);
    const lists = { open, mine, doing, ...(d.staff ? { busy } : {}) };
    const labels = { open: "Open jobs", mine: "My posts", doing: "I'm doing", busy: "In progress" };
    const needs = mine.filter((j) => j.status === "submitted" || (j.status === "open" && j.applicantCount)).length;
    const seg = h("div", { class: "seg jb-tabs", role: "tablist" }, ...Object.keys(lists).map((k) => h("button", { type: "button", role: "tab", "aria-pressed": String(tab === k),
      onclick: () => { tab = k; draw(); } }, labels[k], lists[k].length ? h("span", { class: `jb-count${k === "mine" && needs ? " hot" : ""}`, text: String(k === "mine" && needs ? needs : lists[k].length) }) : null)));
    const shown = lists[tab] || [];
    const empty = {
      open: "No open jobs right now. Post one, or check back later.",
      mine: "You haven't posted any jobs. Need something gathered or built? Post a job!",
      doing: "You're not doing any jobs. Open jobs are in the first tab.",
      busy: "No jobs in progress.",
    }[tab];
    wrap.replaceChildren(
      h("section", { class: "jb-hero" },
        h("div", {}, h("h2", { class: "jb-h", text: "Jobs" }),
          h("p", { class: "text-2", text: "Pay other players to gather, build or craft for you, or earn money doing jobs. The reward is held safely until the job is done." }),
          d.month.done ? h("p", { class: "text-3 small", text: `${d.month.done} job${d.month.done === 1 ? "" : "s"} done this month · ${moneyExact(d.month.paid)} paid` }) : null),
        d.linked ? h("button", { class: "btn btn-primary", type: "button", onclick: postDialog }, iconEl("plus"), "Post a job")
          : h("p", { class: "text-3 small", text: "Type /link in game to post or do jobs." })),
      seg,
      shown.length ? h("div", { class: "jb-list" }, ...shown.map(card)) : h("p", { class: "jb-empty text-3", text: empty }),
      h("p", { class: "text-3 small", text: "Hand over items in game (or use galaxymc.us/trades). Problems with a job? Open a ticket in #Support and staff will settle it." }));
  }

  async function load() {
    try { data = await getJson("/api/jobs"); draw(); } catch (e) { wrap.replaceChildren(h("p", { class: "text-3", text: e.message })); }
  }
  load();
  setTimer(setInterval(() => { if (!document.hidden && !document.querySelector("dialog[open]")) load(); }, 30000));
}
