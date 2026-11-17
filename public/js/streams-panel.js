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
    const allowBox = document.getElementById("streams-allowed");
    allowBox.hidden = !d.owner;
    if (d.owner) document.getElementById("sa-list").replaceChildren(...(d.allowed.length ? d.allowed.map((u) => h("div", { class: "member-row" },
      h("div", { class: "info" }, h("strong", { text: u.username })),
      h("div", { class: "row-actions" }, h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove", onclick: () => act({ action: "disallow", userId: u.id }) }))))
      : [h("p", { class: "text-3 small", style: "margin:0", text: "Nobody yet. Pro+ members can always host." })]));
    banned.replaceChildren(...(d.banned.length ? [h("h3", { style: "font-size:.95rem;margin:0 0 8px", text: "Stopped from hosting stages" }),
      ...d.banned.map((u) => h("div", { class: "member-row" },
        h("div", { class: "info" }, h("strong", { text: u.username }), h("span", { text: `Until ${new Date(u.until).toLocaleDateString()}${u.reason ? ` · ${u.reason}` : ""}` })),
        h("div", { class: "row-actions" }, h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Allow again", onclick: () => act({ action: "unban", userId: u.id }) }))))] : []));
  }
  document.getElementById("sa-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const n = document.getElementById("sa-name");
    if (n.value.trim()) act({ action: "allow", name: n.value }).then(() => { n.value = ""; });
  });
  function banDialog(host) {
    const days = h("select", { class: "input", id: "sm-days" }, ...[[1, "1 day"], [7, "1 week"], [30, "30 days"], [3650, "Permanently"]].map(([v, t]) => h("option", { value: String(v), text: t })));
    const reason = h("input", { class: "input", id: "sm-reason", maxlength: 120, placeholder: "Reason (they'll see it)" });
    openDialog({ title: `Stop ${host.name} from hosting stages`, body: h("div", { class: "form" }, field("For how long", days), field("Reason", reason)),
      actions: [{ label: "Cancel" }, { label: "Stop hosting", kind: "danger", onClick: () => act({ action: "ban", userId: host.id, days: Number(days.value), reason: reason.value }) }] });
  }
  // ---------- recordings and all episodes ----------
  const recList = document.getElementById("rec-list");
  const epAll = document.getElementById("ep-all");
  const gb = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const dur = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");
  const STATUS = { done: "", uploading: "Uploading…", local: "Saved on the recorder's device only", failed: "Upload failed (saved on the recorder's device)" };
  async function loadRecordings() {
    let d;
    try { d = await getJson("/api/recordings"); } catch (e) { recList.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    document.getElementById("rec-usage").textContent = d.storageOn
      ? `Every stage recording, uploaded while it records. Only you and staff with "Moderate stages" can watch them. Storage used: ${gb(d.used)} of ${gb(d.cap)} (free).`
      : "Uploading recordings isn't switched on yet (Cloudflare R2). Until then, recordings only save on the recorder's device; this list still shows every recording.";
    recList.replaceChildren(...(d.recordings.length ? d.recordings.map((r) => {
      const player = h("div", { class: "rec-player", hidden: true });
      return h("div", { class: "member-row rec-row" },
        h("div", { class: "info" }, h("strong", { text: r.title || "Stage" }),
          h("span", { text: [r.by ? `Recorded by ${r.by}` : null, new Date(r.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), dur(r.seconds), r.size ? gb(r.size) : null, STATUS[r.status]].filter(Boolean).join(" · ") })),
        h("div", { class: "row-actions" },
          r.status === "done" ? h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Watch", onclick: () => {
            if (player.hidden) { const v = h("video", { controls: true, preload: "metadata", src: `/api/recordings/${r.id}/file` }); v.playsInline = true; player.replaceChildren(v); player.hidden = false; v.play().catch(() => {}); }
            else { player.hidden = true; player.replaceChildren(); }
          } }) : null,
          r.status === "done" ? h("a", { class: "btn btn-ghost btn-sm", href: `/api/recordings/${r.id}/file?download=1`, text: "Download" }) : null,
          h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": "Delete recording", onclick: () => openDialog({ title: "Delete this recording?", body: h("p", { class: "text-2", text: "It's removed from GalaxySMP for good (copies on people's devices aren't affected)." }),
            actions: [{ label: "Cancel" }, { label: "Delete", kind: "danger", onClick: async () => { const x = await postJson(`/api/recordings/${r.id}/delete`, {}); toast(x.message); loadRecordings(); } }] }) }, "Delete")),
        player);
    }) : [h("div", { class: "panel empty", text: "No recordings yet." })]));
    epAll.replaceChildren(...(d.episodes.length ? d.episodes.map((e) => h("div", { class: "member-row" },
      h("div", { class: "info" }, h("strong", { text: e.title }),
        h("span", { text: [{ podcast: "Podcast", video: "Saved stream", more: "More" }[e.kind] || "Podcast", e.host, e.by && e.by !== e.host ? `posted by ${e.by}` : null, new Date(e.createdAt).toLocaleDateString(), e.size ? gb(e.size) : null, `${e.plays} plays`, e.removed ? "Removed" : null].filter(Boolean).join(" · ") })),
      h("div", { class: "row-actions" },
        e.audio ? h("a", { class: "btn btn-ghost btn-sm", href: e.audio, target: "_blank", rel: "noopener", text: e.media === "video" ? "Watch" : "Listen" }) : null,
        e.removed ? h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Restore", onclick: async () => { try { const x = await postJson(`/api/recordings/episodes/${e.id}/restore`, {}); toast(x.message); loadRecordings(); } catch (er) { toast(er.message); } } })
          : h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove", onclick: async () => { try { const x = await postJson("/api/streams", { action: "episode-delete", id: e.id }); toast(x.message); loadRecordings(); } catch (er) { toast(er.message); } } }),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Delete for good", onclick: () => openDialog({ title: `Delete "${e.title}" for good?`, body: h("p", { class: "text-2", text: "The file is deleted and can't be restored. This frees up storage." }),
          actions: [{ label: "Cancel" }, { label: "Delete", kind: "danger", onClick: async () => { const x = await postJson(`/api/recordings/episodes/${e.id}/purge`, {}); toast(x.message); loadRecordings(); } }] }) }))))
      : [h("div", { class: "panel empty", text: "No episodes yet." })]));
  }

  const prev = loaders.reports;
  loaders.reports = async () => { await Promise.all([prev?.(), load(), loadRecordings()]); };
}
