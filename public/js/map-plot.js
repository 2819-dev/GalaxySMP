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
    h("div", { class: "mp-meta" }, h("span", { class: "text-3 small", text: `By ${d.owner} · ${d.x != null ? `X ${d.x}, Z ${d.z}` : "Location Hidden"}` }),
      d.mine ? h("span", { class: `mp-state ${d.visibility === "public" ? "on" : ""}`, text: VIS[d.visibility] || "Hidden" }) : like),
    d.caption ? h("p", { class: "text-2", style: "margin:0", text: d.caption } ) : null);
  const actions = [{ label: "Close" }];
  if (d.mine) {
    actions.unshift({ label: "Who can see it", onClick: () => { pickVisibility(id, d, onChange); } }, { label: "Edit photos", onClick: () => { editPhotos(id, d, onChange); } });
  }
  openDialog({ title: d.name, body, actions });
}

const VIS = { public: "Public", location: "Location Hidden", hidden: "Plot Hidden" };

function pickVisibility(id, d, onChange) {
  const opts = [
    ["public", "Public", "On the map and in the Plot Showcase, with where it is."],
    ["location", "Location Hidden", "In the Plot Showcase with photos and likes, but nobody can see where it is."],
    ["hidden", "Plot Hidden", "Only a locked \"Plot Hidden\" card in the showcase."],
  ];
  let level = d.visibility || "hidden";
  const list = h("div", { class: "mp-vis" });
  const draw = () => list.replaceChildren(...opts.map(([k, name, text]) => {
    const b = h("button", { class: "mp-vis-opt", type: "button", role: "radio", "aria-checked": String(level === k) }, h("b", { text: name }), h("span", { class: "text-3 small", text }));
    b.addEventListener("click", () => { level = k; draw(); });
    return b;
  }));
  draw();
  openDialog({ title: "Who can see your plot?", body: list, actions: [{ label: "Cancel" }, { label: "Save", kind: "primary", onClick: async () => {
    const r = await postJson(`/api/map/plots/${encodeURIComponent(id)}`, { action: "visibility", level });
    toast(r.message); onChange?.();
  } }] });
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
