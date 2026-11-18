// Staff to-do list in #Ideas & To-Do: a "To-Do" button in the channel header opens the checklist (add a task,
// give it to a staff member, tick it off). Any message in the channel can become a task from its menu.
// All text goes in with textContent, never as HTML.
import { h, getJson, postJson, openDialog, field } from "/js/dialog.js";
import { toast, iconEl } from "/js/site.js";
import { composerHooks, messageActionHooks, currentChannel } from "/js/chat.js";

const SLUG = "ideas-todo";
let open = 0;

function headerButton() {
  let b = document.getElementById("open-todo");
  if (!b) {
    b = h("button", { class: "icon-btn todo-btn", type: "button", id: "open-todo", "aria-label": "Staff to-do list", title: "To-Do list" },
      iconEl("check"), h("span", { class: "todo-n" }));
    b.addEventListener("click", () => todoDialog());
    document.getElementById("open-pins")?.before(b);
  }
  return b;
}

async function refreshCount() {
  try {
    const d = await getJson("/api/staff/todos");
    open = d.todos.filter((t) => !t.done).length;
    const n = document.querySelector("#open-todo .todo-n");
    if (n) n.textContent = open ? String(open) : "";
  } catch { /* not staff */ }
}

composerHooks.push((ch) => {
  const show = ch?.slug === SLUG;
  const b = document.getElementById("open-todo") || (show ? headerButton() : null);
  if (b) b.hidden = !show;
  if (show) refreshCount();
});

messageActionHooks.push((m, actions, actionBtn) => {
  if (currentChannel()?.slug !== SLUG || m.bot) return;
  actions.append(actionBtn("check", "Make it a task", () => editTask(null, { title: String(m.content || "").split("\n")[0].slice(0, 200), sourceMessage: m.id })));
});

async function todoDialog() {
  let d;
  try { d = await getJson("/api/staff/todos"); } catch (e) { toast(e.message); return; }
  let showDone = false;
  const list = h("div", { class: "todo-list" });
  const doneBtn = h("button", { class: "btn btn-ghost btn-sm", type: "button" });
  const reload = async () => { try { d = await getJson("/api/staff/todos"); draw(); refreshCount(); } catch (e) { toast(e.message); } };
  const draw = () => {
    const items = d.todos.filter((t) => t.done === showDone);
    doneBtn.textContent = showDone ? "Show open tasks" : `Done recently (${d.todos.filter((t) => t.done).length})`;
    list.replaceChildren(...(items.length ? items.map((t) => {
      const box = h("button", { class: `todo-check${t.done ? " on" : ""}`, type: "button", "aria-label": t.done ? "Mark as not done" : "Mark as done",
        onclick: async () => { try { await postJson("/api/staff/todos", { action: "toggle", id: t.id }); reload(); } catch (e) { toast(e.message); } } }, t.done ? iconEl("check") : null);
      const meta = [t.assignee ? `→ ${t.assignee}` : "Anyone", t.done && t.doneBy ? `done by ${t.doneBy}` : `added by ${t.by || "staff"}`].join(" · ");
      return h("div", { class: `todo-item${t.done ? " done" : ""}` }, box,
        h("button", { class: "todo-main", type: "button", onclick: () => editTask(t, null, d.staff, reload) },
          h("b", { text: t.title }), t.notes ? h("span", { class: "todo-notes", text: t.notes }) : null, h("span", { class: "todo-meta", text: meta })));
    }) : [h("p", { class: "text-3", style: "margin:8px 0", text: showDone ? "Nothing finished in the last 2 weeks." : "Nothing to do. Add a task, or make one from a message." })]));
  };
  doneBtn.addEventListener("click", () => { showDone = !showDone; draw(); });
  draw();
  openDialog({
    title: "Staff to-do list",
    body: h("div", { class: "form" }, list, doneBtn),
    actions: [{ label: "Close" }, { label: "Add a task", kind: "primary", onClick: () => { editTask(null, null, d.staff, reload); return false; } }],
  });
}

async function editTask(t, prefill, staff, after) {
  if (!staff) { try { staff = (await getJson("/api/staff/todos")).staff; } catch (e) { toast(e.message); return; } }
  const title = h("input", { class: "input", id: "todo-title", maxlength: 200, value: t?.title || prefill?.title || "", placeholder: "e.g. Build the new spawn fountain" });
  const notes = h("textarea", { class: "input", id: "todo-notes", rows: 3, maxlength: 1000, placeholder: "Details (optional)" });
  notes.value = t?.notes || "";
  const who = h("select", { class: "input", id: "todo-who" }, h("option", { value: "", text: "Anyone" }),
    ...staff.map((s) => h("option", { value: String(s.id), text: s.username, selected: t?.assigneeId === s.id })));
  const actions = [{ label: "Cancel" }];
  if (t) actions.push({ label: "Delete", kind: "danger", onClick: async () => { await postJson("/api/staff/todos", { action: "delete", id: t.id }); toast("Task removed."); after?.(); refreshCount(); } });
  actions.push({ label: t ? "Save" : "Add task", kind: "primary", onClick: async () => {
    const r = await postJson("/api/staff/todos", { action: t ? "update" : "create", id: t?.id, title: title.value, notes: notes.value,
      assigneeId: who.value ? Number(who.value) : null, sourceMessage: prefill?.sourceMessage });
    toast(r.message); after?.(); refreshCount();
  } });
  openDialog({ title: t ? "Edit task" : "New task", body: h("div", { class: "form" }, field("What needs doing?", title), field("Who's doing it?", who), field("Notes", notes)), actions });
  setTimeout(() => title.focus(), 50);
}
