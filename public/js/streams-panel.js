// Control Panel > Moderation > Reports: the "Live stages" list (staff with "Moderate stages").
import { h, getJson, postJson, openDialog, field } from "/js/dialog.js";

export function setupStreamsMod({ loaders, toast }) {
  const wrap = document.getElementById("streams-mod");
  const live = document.getElementById("streams-mod-live");
  const banned = document.getElementById("streams-mod-banned");
  wrap.hidden = false;
  const act = async (body) => { try { const r = await postJson("/api/streams", body); toast(r.message); load(); } catch (e) { toast(e.message); } };
  async function load() {
    let d;
    try { d = await getJson("/api/streams/staff"); } catch (e) { live.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    live.replaceChildren(...(d.live.length ? d.live.map((s) => h("div", { class: "member-row" },
      h("div", { class: "info" }, h("strong", { text: s.title }),
        h("span", { text: `${s.host.type === "team" ? `[${s.host.tag}] ${s.host.name} (team)` : s.host.name} · ${s.viewers} listening${s.onStage.length ? ` · Speaking: ${s.onStage.join(", ")}` : ""}` })),
      h("div", { class: "row-actions" },
        h("a", { class: "btn btn-secondary btn-sm", href: `/community#stages/${s.id}`, text: "Join" }),
        s.host.type === "user" ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Stop hosting", onclick: () => banDialog(s.host) }) : null,
        h("button", { class: "btn btn-danger btn-sm", type: "button", text: "End", onclick: () => openDialog({ title: `End "${s.title}"?`, body: h("p", { class: "text-2", text: "Everyone on it sees that staff ended it." }),
          actions: [{ label: "Cancel" }, { label: "End stage", kind: "danger", onClick: () => act({ action: "end", id: s.id }) }] }) }))))
      : [h("div", { class: "panel empty", text: "No stages are live right now." })]));
    banned.replaceChildren(...(d.banned.length ? [h("h3", { style: "font-size:.95rem;margin:0 0 8px", text: "Stopped from hosting stages" }),
      ...d.banned.map((u) => h("div", { class: "member-row" },
        h("div", { class: "info" }, h("strong", { text: u.username }), h("span", { text: `Until ${new Date(u.until).toLocaleDateString()}${u.reason ? ` · ${u.reason}` : ""}` })),
        h("div", { class: "row-actions" }, h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Allow again", onclick: () => act({ action: "unban", userId: u.id }) }))))] : []));
  }
  function banDialog(host) {
    const days = h("select", { class: "input", id: "sm-days" }, ...[[1, "1 day"], [7, "1 week"], [30, "30 days"], [3650, "Permanently"]].map(([v, t]) => h("option", { value: String(v), text: t })));
    const reason = h("input", { class: "input", id: "sm-reason", maxlength: 120, placeholder: "Reason (they'll see it)" });
    openDialog({ title: `Stop ${host.name} from hosting stages`, body: h("div", { class: "form" }, field("For how long", days), field("Reason", reason)),
      actions: [{ label: "Cancel" }, { label: "Stop hosting", kind: "danger", onClick: () => act({ action: "ban", userId: host.id, days: Number(days.value), reason: reason.value }) }] });
  }
  const prev = loaders.reports;
  loaders.reports = async () => { await Promise.all([prev?.(), load()]); };
}
