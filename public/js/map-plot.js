// A plot's card on the map: name, owner, photos and likes. Owners can make it public or private and add photos.
import { h, openDialog, getJson, postJson, field } from "/js/dialog.js";
import { toast, iconEl } from "/js/site.js";

async function readPhoto(file) {
  // shrink to at most 1600px wide (JPEG), so uploads stay small
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const data = c.toDataURL("image/jpeg", 0.85).split(",")[1];
  return { mime: "image/jpeg", data, width: c.width, height: c.height };
}

export async function openPlot(id, onChange) {
  let d;
  try { d = (await getJson(`/api/map/plots/${encodeURIComponent(id)}`)).plot; } catch (e) { toast(e.message); return; }
  const photos = d.photos.length
    ? h("div", { class: "mp-photos" }, ...d.photos.map((p) => h("img", { src: `/api/map/plot-photo/${p.id}`, alt: `Photo of ${d.name}`, loading: "lazy", width: p.w, height: p.h })))
    : h("div", { class: "mp-nophoto" }, iconEl("image"), h("span", { text: d.mine ? "Add photos so visitors can see your build." : "No photos yet." }));
  const like = h("button", { class: `btn btn-sm ${d.liked ? "btn-primary" : "btn-secondary"} mp-like`, type: "button" }, iconEl("heart"), `${d.likes} like${d.likes === 1 ? "" : "s"}`);
  like.addEventListener("click", async () => {
    try {
      const r = await postJson(`/api/map/plots/${encodeURIComponent(id)}`, { action: "like" });
      d.liked = r.liked; d.likes += r.liked ? 1 : -1;
      like.className = `btn btn-sm ${d.liked ? "btn-primary" : "btn-secondary"} mp-like`;
      like.lastChild.textContent = `${d.likes} like${d.likes === 1 ? "" : "s"}`;
      onChange?.();
    } catch (e) { toast(e.message); }
  });
  const body = h("div", { class: "mp-card" }, photos,
    h("div", { class: "mp-meta" }, h("span", { class: "text-3 small", text: `By ${d.owner} · X ${d.x}, Z ${d.z}` }), d.mine ? h("span", { class: `mp-state ${d.public ? "on" : ""}`, text: d.public ? "Public" : "Private" }) : like),
    d.caption ? h("p", { class: "text-2", style: "margin:0", text: d.caption } ) : null);
  const actions = [{ label: "Close" }];
  if (d.mine) {
    actions.unshift({ label: d.public ? "Make private" : "Make public", onClick: async () => {
      const r = await postJson(`/api/map/plots/${encodeURIComponent(id)}`, { action: d.public ? "private" : "public" });
      toast(r.message); onChange?.();
    } }, { label: "Edit photos", onClick: () => { editPhotos(id, d, onChange); } });
  }
  openDialog({ title: d.name, body, actions });
}

function editPhotos(id, d, onChange) {
  const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true, id: "mp-files" });
  const caption = h("textarea", { class: "input", id: "mp-caption", rows: 2, maxlength: 200, placeholder: "Tell visitors about your plot (optional)" });
  caption.value = d.caption || "";
  openDialog({
    title: "Plot photos",
    body: h("div", { class: "form" }, field("Photos (up to 4, replaces the current ones)", input), field("Description", caption),
      h("p", { class: "text-3 small", style: "margin:0", text: "Photos show when players tap your plot on the map. Follow the rules: staff can remove them." })),
    actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => {
      const files = [...(input.files || [])].slice(0, 4);
      const images = [];
      for (const f of files) images.push(await readPhoto(f));
      const r = await postJson(`/api/map/plots/${encodeURIComponent(id)}`, { action: "photos", images, caption: caption.value });
      toast(r.message); onChange?.();
    } }],
  });
}
