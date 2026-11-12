// Control Panel > Server > Voice rooms (Admins): permanent voice rooms anyone can join.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";

export function setupRooms({ loaders, toast }) {
  const box = document.getElementById("rooms-list");
  document.getElementById("rooms-new").addEventListener("click", () => roomDialog(null));
  const act = async (body, msg) => {
    try { await postJson("/api/panel/voice-rooms", body); if (msg) toast(msg); loaders.rooms(); } catch (e) { toast(e.message); }
  };
  loaders.rooms = async () => {
    let d;
    try { d = await getJson("/api/panel/voice-rooms"); } catch (e) { box.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    if (!d.rooms.length) { box.replaceChildren(h("div", { class: "panel empty", text: "No rooms yet. Add one, for example Bedwars Lobby or Chill." })); return; }
    box.replaceChildren(...d.rooms.map((r, i) => h("div", { class: "member-row" },
      h("div", { class: "info" }, h("strong", { text: r.name }),
        h("span", { text: `${r.description ? `${r.description} · ` : ""}${r.inRoom ? `${r.inRoom} in the room now` : "Nobody in it now"}` })),
      h("div", { class: "row-actions" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "↑", "aria-label": `Move ${r.name} up`, disabled: i === 0, onclick: () => act({ action: "move", id: r.id, dir: -1 }) }),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "↓", "aria-label": `Move ${r.name} down`, disabled: i === d.rooms.length - 1, onclick: () => act({ action: "move", id: r.id, dir: 1 }) }),
        h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Edit", onclick: () => roomDialog(r) }),
        h("button", { class: "btn btn-danger btn-sm", type: "button", text: "Delete", onclick: () => openDialog({
          title: `Delete ${r.name}?`, body: h("p", { class: "text-2", text: "Anyone in the room goes back to normal proximity voice." }),
          actions: [{ label: "Cancel" }, { label: "Delete", kind: "danger", onClick: () => act({ action: "delete", id: r.id }, "Room deleted.") }],
        }) })))));
  };
  function roomDialog(r) {
    const name = h("input", { class: "input", id: "room-name", maxlength: 24, value: r?.name || "", placeholder: "e.g. Bedwars Lobby" });
    const desc = h("input", { class: "input", id: "room-desc", maxlength: 80, value: r?.description || "", placeholder: "e.g. Find a team for the next game" });
    openDialog({
      title: r ? `Edit ${r.name}` : "New voice room",
      body: h("div", { class: "form" }, field("Name", name), field("Description (optional)", desc, "Shown on the Voice page when the room is empty.")),
      actions: [{ label: "Cancel" }, { label: r ? "Save" : "Add room", kind: "primary", onClick: async () => {
        await postJson("/api/panel/voice-rooms", { action: r ? "rename" : "add", id: r?.id, name: name.value, description: desc.value });
        toast(r ? "Room saved." : "Room added: it shows on the Voice page.");
        loaders.rooms();
      } }],
    });
  }
}
