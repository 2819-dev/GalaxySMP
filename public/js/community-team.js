// #Meet The Team (staff cards with bios) and #Applications (apply to be a Moderator; the owner reviews).
import { h, getJson, postJson, openDialog, field } from "/js/dialog.js";
import { iconEl } from "/js/site.js";
import { faceSvg } from "/js/face.js";
import { renderThread, composer } from "/js/jr-chat.js";
import { rankTag } from "/js/rank-paint.js";

const when = (d) => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const face = (src, name, size) => {
  const img = h("img", { class: "tm-face", alt: "", width: size, height: size, src: src || faceSvg(name), loading: "lazy" });
  img.addEventListener("error", () => { img.src = faceSvg(name); }, { once: true });
  return img;
};

// ---------- Meet The Team ----------
export function renderTeam(root, { toast }) {
  const grid = h("div", { class: "tm-grid" });
  root.append(h("div", { class: "cp-wrap tm-wrap" },
    h("div", { class: "tl-intro" }, h("h2", { text: "Meet The Team" }),
      h("p", { class: "text-3" }, "The people who run GalaxySMP. Want to join them? ", h("a", { href: "/community#applications", text: "Apply in #applications" }), ".")),
    grid));
  async function load() {
    let d;
    try { d = await getJson("/api/team"); } catch (e) { grid.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    grid.replaceChildren(...d.team.map((m) => {
      const bio = h("p", { class: `tm-bio${m.bio ? "" : " empty"}`, text: m.bio || (m.isMe ? "Add a short bio so players get to know you." : "No bio yet.") });
      const actions = h("div", { class: "tm-actions" });
      if (!m.isMe) actions.append(h("a", { class: "btn btn-primary btn-sm", href: `/community#dm-${m.id}` }, iconEl("message"), "Message"));
      if (m.profile) actions.append(h("a", { class: "btn btn-secondary btn-sm", href: m.profile, text: "Profile" }));
      if (m.canEdit) actions.append(h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => editBio(m) }, iconEl("pencil"), m.isMe ? "Edit my bio" : "Edit bio"));
      const role = m.rank ? h("span", { class: "tm-rank" }, rankTag(m.rank)) : null;
      return h("article", { class: "tm-card" },
        h("div", { class: "tm-top" }, h("div", { class: `tm-pic${m.inGame ? " on" : ""}` }, face(m.head, m.name, 72)),
          h("div", {}, h("h3", { class: "tm-name", text: m.name }), role, m.inGame ? h("span", { class: "tm-online", text: "Playing now" }) : null)),
        bio, actions);
    }));
  }
  function editBio(m) {
    const box = h("textarea", { class: "input", id: "tm-bio", rows: 5, maxlength: 400, placeholder: "e.g. I've been playing Minecraft since 2015. I love redstone and helping new players. Ask me anything!" });
    box.value = m.bio;
    openDialog({
      title: m.isMe ? "Your team bio" : `${m.name}'s team bio`,
      body: h("div", { class: "form" }, field("Bio (shown on #Meet The Team)", box, "Up to 400 characters.")),
      actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => { await postJson("/api/team/bio", { userId: m.id, bio: box.value }); toast("Bio saved."); load(); } }],
    });
  }
  load();
}

// ---------- Applications ----------
export function renderApplications(root, helpers) {
  const wrap = h("div", { class: "cp-wrap ap-wrap" });
  root.append(wrap);
  getJson("/api/applications").then((d) => (d.owner ? ownerView(wrap, d, helpers) : memberView(wrap, d, helpers)))
    .catch((e) => wrap.replaceChildren(h("p", { class: "text-3", text: e.message })));
}

const STATUS = { open: ["Waiting for an answer", "planned"], accepted: ["Accepted", "done"], declined: ["Declined", "declined"], withdrawn: ["Withdrawn", "open"] };

function answersBlock(questions, answers) {
  return h("div", { class: "ap-answers" }, ...questions.filter((q) => answers[q.id]).map((q) => h("div", { class: "ap-qa" }, h("b", { text: q.q }), h("p", { text: answers[q.id] }))));
}

function memberView(wrap, d, { toast, setTimer }) {
  const intro = h("div", { class: "tl-intro" }, h("h2", { text: "Applications" }),
    h("p", { class: "text-3", text: "Help keep GalaxySMP friendly and fun. Moderators help players, keep chat kind and handle reports. Only the owner reads applications." }));
  if (d.staff) { wrap.replaceChildren(intro, h("div", { class: "panel empty", text: "You're already on the staff team. Thanks for helping out!" })); return; }
  const a = d.application;
  if (a && (a.status === "open" || a.status === "accepted" || (a.status === "declined" && !d.canApply))) {
    const [label, cls] = STATUS[a.status];
    const log = h("div", { class: "dm-log jr-log" });
    const form = composer(async (text) => { await postJson(`/api/applications/${a.id}/messages`, { body: text }); reload(); }, "Message the owner");
    const head = h("div", { class: "jr-head" }, h("b", { text: "Your Moderator application" }), h("span", { class: `sg-status ${cls}`, text: label }), h("span", { class: "text-3 small", text: `Sent ${when(a.createdAt)}` }));
    const withdraw = a.status === "open" ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Withdraw application", onclick: () => openDialog({
      title: "Withdraw your application?", body: h("p", { class: "text-2", text: "You can apply again any time." }),
      actions: [{ label: "Cancel" }, { label: "Withdraw", kind: "danger", onClick: async () => { await postJson("/api/applications/withdraw", {}); reload(); } }],
    }) }) : null;
    wrap.replaceChildren(intro, h("section", { class: "panel ap-mine" }, head,
      a.status === "declined" ? h("p", { class: "text-3 small", text: `You can apply again in ${d.waitDays} day${d.waitDays === 1 ? "" : "s"}.` }) : null,
      h("details", { class: "ap-details" }, h("summary", { text: "Your answers" }), answersBlock(d.questions, a.answers)),
      h("div", { class: "jr-chat" }, log, a.status === "open" ? form : null), withdraw));
    renderThread(log, a.messages, false, { ownerName: "Owner" });
    setTimer(setInterval(async () => {
      if (document.hidden) return;
      try { const n = await getJson("/api/applications"); if (n.application?.id === a.id) renderThread(log, n.application.messages, false, { ownerName: "Owner" }); } catch { /* next time */ }
    }, 15000));
    return;
  }
  // closed by the owner: their message instead of the form
  if (d.state?.closed) {
    wrap.replaceChildren(intro, h("section", { class: "panel ap-closed" }, h("h3", { text: "Applications are closed" }),
      h("p", { class: "text-2", text: d.state.message || "We're not looking for new Moderators right now. Check back later!" })));
    return;
  }
  // the form
  const inputs = {};
  const fields = d.questions.map((q) => {
    inputs[q.id] = h("textarea", { class: "input", id: `ap-${q.id}`, rows: q.min > 20 ? 4 : 2, maxlength: 1000 });
    return field(q.q, inputs[q.id]);
  });
  const send = h("button", { class: "btn btn-primary", type: "submit", text: "Send application" });
  const form = h("form", { class: "form panel ap-form" }, h("h3", { style: "margin:0", text: "Apply for Moderator" }),
    h("p", { class: "text-3 small", style: "margin:0", text: "Be honest and take your time. After you send it, you can chat with the owner here." }), ...fields, h("div", {}, send));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    send.disabled = true;
    try {
      await postJson("/api/applications", { answers: Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])) });
      toast("Application sent. Good luck!");
      reload();
    } catch (err) { toast(err.message); } finally { send.disabled = false; }
  });
  wrap.replaceChildren(intro, form);
  function reload() { getJson("/api/applications").then((n) => memberView(wrap, n, { toast, setTimer })).catch(() => {}); }
}

function ownerView(wrap, d, { toast, setTimer }) {
  let status = "open";
  let openId = null;
  const filter = h("div", { class: "tabs-mini", role: "group", "aria-label": "Show" });
  const list = h("div", { class: "jr-list" });
  const pane = h("div", { class: "panel jr-pane" }, h("p", { class: "text-3", style: "margin:0", text: "Pick an application to read it and reply." }));
  for (const [k, label] of [["open", "Waiting"], ["accepted", "Accepted"], ["declined", "Declined"]]) {
    const b = h("button", { type: "button", "aria-pressed": String(k === status), text: label });
    b.addEventListener("click", () => { status = k; filter.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); load(); });
    filter.append(b);
  }
  const stateBar = h("div", { class: "ap-state" });
  const drawState = (st) => {
    const btn = st.closed
      ? h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Reopen applications", onclick: async () => {
        try { const r = await postJson("/api/applications/state", { closed: false }); toast(r.message); drawState({ closed: false }); } catch (e) { toast(e.message); } } })
      : h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Close applications", onclick: () => {
        const msg = h("textarea", { class: "input", id: "ap-closed-msg", rows: 3, maxlength: 300, placeholder: "e.g. We have enough Moderators for now. Applications open again in January!" });
        openDialog({
          title: "Close applications?",
          body: h("div", { class: "form" }, field("Message players see", msg, "Optional. Applications already sent stay open for you to answer.")),
          actions: [{ label: "Cancel" }, { label: "Close applications", kind: "primary", onClick: async () => {
            const r = await postJson("/api/applications/state", { closed: true, message: msg.value });
            toast(r.message); drawState({ closed: true, message: msg.value.trim() });
          } }],
        });
      } });
    stateBar.replaceChildren(h("div", { class: "ap-state-text" },
      h("span", { class: `sg-status ${st.closed ? "declined" : "done"}`, text: st.closed ? "Closed" : "Open" }),
      h("span", { class: "text-3 small", text: st.closed ? (st.message ? `Players see: "${st.message}"` : "Players see that applications are closed.") : "Members can apply." })), btn);
  };
  drawState(d.state || { closed: false });
  wrap.replaceChildren(
    h("div", { class: "tl-intro" }, h("h2", { text: "Applications" }), h("p", { class: "text-3", text: "Moderator applications. Only you can see these. Accepting makes them a Moderator on the website." })),
    stateBar, filter, h("div", { class: "jr-layout", style: "margin-top:12px" }, list, pane));
  async function load() {
    let n;
    try { n = await getJson(`/api/applications?status=${status}`); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    list.replaceChildren(...(n.applications.length ? n.applications.map((a) => h("button", { type: "button", class: `jr-row${a.id === openId ? " active" : ""}`, onclick: () => open(a.id) },
      h("div", { class: "jr-row-top" }, h("b", { text: a.user.username }), a.unread ? h("span", { class: "count-badge", "data-n": String(a.unread), text: String(a.unread) }) : null),
      h("span", { class: "jr-row-last", text: a.answers.why || "" }), h("span", { class: "jr-row-meta", text: when(a.createdAt) })))
      : [h("div", { class: "panel empty", text: status === "open" ? "No applications waiting." : "None yet." })]));
  }
  async function open(id) {
    openId = id;
    let r;
    try { r = await getJson(`/api/applications/${id}`); } catch (e) { pane.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    const a = r.application;
    const [label, cls] = STATUS[a.status];
    const log = h("div", { class: "dm-log jr-log" });
    const form = composer(async (text) => { await postJson(`/api/applications/${id}/messages`, { body: text }); open(id); }, `Message ${a.user.username}`);
    const decide = (st) => {
      const note = h("textarea", { class: "input", id: "ap-note", rows: 3, maxlength: 2000, placeholder: "Optional. If empty, they get a friendly default message." });
      openDialog({
        title: st === "accepted" ? `Make ${a.user.username} a Moderator?` : `Decline ${a.user.username}?`,
        body: h("div", { class: "form" }, field("Message to them", note)),
        actions: [{ label: "Cancel" }, { label: st === "accepted" ? "Accept" : "Decline", kind: st === "accepted" ? "primary" : "danger", onClick: async () => {
          const res = await postJson(`/api/applications/${id}/decide`, { status: st, message: note.value });
          toast(res.message); open(id); load();
        } }],
      });
    };
    pane.replaceChildren(
      h("div", { class: "jr-head" }, face(a.user.head, a.user.username, 36), a.user.profile ? h("a", { href: a.user.profile, text: a.user.username }) : h("b", { text: a.user.username }),
        h("span", { class: `sg-status ${cls}`, text: label }),
        h("span", { class: "text-3 small", text: `Member since ${new Date(a.user.since).toLocaleDateString()}${a.user.playtime != null ? ` · ${Math.round(a.user.playtime / 3600)}h played` : ""}` })),
      a.status === "open" ? h("div", { class: "cx-row" },
        h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Accept as Moderator", onclick: () => decide("accepted") }),
        h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Decline", onclick: () => decide("declined") })) : null,
      answersBlock(d.questions, a.answers), log, form);
    renderThread(log, a.messages, true, { otherName: a.user.username });
    load();
  }
  load();
  setTimer(setInterval(() => { if (!document.hidden) load(); }, 20000));
}
