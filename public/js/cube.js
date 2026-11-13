// galaxymc.us/cube (cube.galaxymc.us): link a Galaxy Cube with the code on its screen, and manage your Cubes.
import { toast, iconEl } from "/js/site.js";
import { h, getJson, postJson, openDialog, field } from "/js/dialog.js";

const root = document.getElementById("cube-root");
const ago = (d) => {
  if (!d) return "never";
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(d).toLocaleDateString();
};

async function load() {
  let me = null;
  try { me = (await getJson("/api/me")).user; } catch { /* signed out */ }
  if (!me) {
    root.replaceChildren(h("section", { class: "panel cube-pair" }, h("h2", { text: "Link your Cube" }),
      h("p", { class: "text-2", text: "Sign in to link a Cube to your account." }), h("a", { class: "btn btn-primary", href: "/community", text: "Sign in" })));
    return;
  }
  const code = h("input", { class: "input cube-code", id: "cube-code", maxlength: 8, placeholder: "K7Q-29M", autocomplete: "off", autocapitalize: "characters", spellcheck: "false" });
  const go = h("button", { class: "btn btn-primary", type: "submit", text: "Link Cube" });
  const form = h("form", { class: "cube-pair-form" }, code, go);
  code.addEventListener("input", () => {
    const v = code.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    code.value = v.length > 3 ? `${v.slice(0, 3)}-${v.slice(3)}` : v;
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    go.disabled = true;
    try { const r = await postJson("/api/cube/pair/claim", { code: code.value }); toast(r.message); code.value = ""; setTimeout(drawList, 4000); drawList(); }
    catch (err) { toast(err.message); }
    finally { go.disabled = false; }
  });
  const list = h("div", { class: "cube-list" }, h("p", { class: "text-3", text: "Loading…" }));
  root.replaceChildren(
    h("section", { class: "panel cube-pair" }, h("h2", { text: "Link a Cube" }),
      h("p", { class: "text-2", text: "Type the code on your Cube's screen." }), form),
    h("section", { class: "panel" }, h("h2", { text: "Your Cubes" }), list));

  async function drawList() {
    let d;
    try { d = await getJson("/api/cube/devices"); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    list.replaceChildren(...(d.devices.length ? d.devices.map((c) => h("div", { class: "cube-row" },
      h("span", { class: `cube-dot${c.online ? " on" : ""}`, title: c.online ? "Online" : "Offline" }),
      h("div", { class: "cube-row-main" }, h("b", { text: c.name }),
        h("span", { class: "text-3 small", text: `${c.deviceId} · ${c.model === "lite" ? "Lite" : "Cube"}${c.firmware ? ` · v${c.firmware}` : ""} · ${c.online ? "online now" : `last seen ${ago(c.lastSeen)}`}` })),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Rename", onclick: () => rename(c) }),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Unlink", onclick: () => unlink(c) })))
      : [h("p", { class: "text-3", style: "margin:0", text: "No Cubes linked yet." })]));
  }
  function rename(c) {
    const name = h("input", { class: "input", id: "cube-name", maxlength: 24, value: c.name });
    openDialog({ title: "Rename Cube", body: field("Name", name), actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => {
      await postJson(`/api/cube/devices/${c.id}`, { action: "rename", name: name.value }); toast("Renamed."); drawList();
    } }] });
  }
  function unlink(c) {
    openDialog({ title: `Unlink ${c.name}?`, body: h("p", { class: "text-2", text: "It stops working with your account until you pair it again." }),
      actions: [{ label: "Cancel" }, { label: "Unlink", kind: "danger", onClick: async () => { const r = await postJson(`/api/cube/devices/${c.id}`, { action: "unlink" }); toast(r.message); drawList(); } }] });
  }
  drawList();
  const pre = new URLSearchParams(location.search).get("code");
  if (pre) { code.value = pre; code.dispatchEvent(new Event("input")); }
}
load();
void iconEl;
