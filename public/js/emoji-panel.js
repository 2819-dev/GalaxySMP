// Control Panel > Server > Emoji (Admins): add and remove the server's custom emoji.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";

// Shrinks a picture to fit 128 x 128 (keeps transparency: PNG).
async function emojiPicture(file) {
  if (!/^image\//.test(file.type)) throw new Error("Choose a picture file.");
  if (file.type === "image/gif" && file.size <= 100_000) {  // keep small GIFs (animated) as they are
    const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(file); });
    return { mime: "image/gif", data, url: URL.createObjectURL(file) };
  }
  const bmp = await createImageBitmap(file).catch(() => { throw new Error("That picture couldn't be opened."); });
  const scale = Math.min(1, 128 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), hgt = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = hgt;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = !(bmp.width <= 32 && bmp.height <= 32);  // pixel art stays crisp
  g.drawImage(bmp, 0, 0, w, hgt);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  if (blob.size > 100_000) throw new Error("That picture is too detailed for an emoji. Try a simpler one.");
  const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
  return { mime: "image/png", data, url: URL.createObjectURL(blob) };
}

export function setupEmoji({ loaders, toast }) {
  const box = document.getElementById("emoji-list");
  document.getElementById("emoji-new").addEventListener("click", addDialog);
  loaders.emoji = async () => {
    let d;
    try { d = await getJson("/api/emoji"); } catch (e) { box.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    if (!d.emoji.length) { box.replaceChildren(h("div", { class: "panel empty", text: "No emoji yet. Add the first one." })); return; }
    box.replaceChildren(h("div", { class: "emoji-grid" }, d.emoji.map((e) => h("div", { class: "emoji-card" },
      h("img", { src: e.url, alt: `:${e.name}:`, width: 40, height: 40 }), h("code", { text: `:${e.name}:` }),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove", onclick: () => openDialog({
        title: `Remove :${e.name}:?`, body: h("p", { class: "text-2", text: "It disappears from messages and reactions that use it." }),
        actions: [{ label: "Cancel" }, { label: "Remove", kind: "danger", onClick: async () => { await postJson(`/api/panel/emoji/${e.name}/delete`, {}); toast("Emoji removed."); loaders.emoji(); } }],
      }) })))));
  };
  function addDialog() {
    let pic = null;
    const name = h("input", { class: "input", id: "emoji-name", maxlength: 24, placeholder: "e.g. creeper", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
    const file = h("input", { type: "file", accept: "image/png,image/webp,image/gif,image/jpeg", id: "emoji-file", class: "sr-only" });
    const preview = h("div", { class: "emoji-card", style: "width:120px" }, h("span", { class: "text-3 small", text: "No picture yet" }));
    const pick = h("label", { class: "btn btn-secondary btn-sm", for: "emoji-file", text: "Choose a picture" });
    const drawPreview = () => preview.replaceChildren(pic ? h("img", { src: pic.url, alt: "", width: 40, height: 40 }) : h("span", { class: "text-3 small", text: "No picture yet" }),
      h("code", { text: `:${(name.value.trim().toLowerCase() || "name")}:` }));
    name.addEventListener("input", () => { name.value = name.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"); drawPreview(); });
    file.addEventListener("change", async () => {
      const f = file.files[0];
      file.value = "";
      if (!f) return;
      try {
        pic = await emojiPicture(f);
        if (!name.value) name.value = f.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 24);
        drawPreview();
      } catch (e) { toast(e.message); }
    });
    drawPreview();
    openDialog({
      title: "Add an emoji",
      body: h("div", { class: "form" }, h("div", { class: "pic-top" }, preview, h("div", { class: "stack", style: "gap:8px" }, pick, h("p", { class: "hint", style: "margin:0", text: "PNG with a transparent background works best. Small GIFs can be animated." }))), file,
        field("Name", name, "Members type it as :name: in chat and DMs, or pick it from the emoji button.")),
      actions: [{ label: "Cancel" }, { label: "Add emoji", kind: "primary", onClick: async () => {
        if (!pic) throw new Error("Choose a picture first.");
        await postJson("/api/panel/emoji", { name: name.value, image: { mime: pic.mime, data: pic.data } });
        toast(`:${name.value}: added.`);
        loaders.emoji();
      } }],
    });
  }
}
