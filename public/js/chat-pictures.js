// Pictures in chat (staff, Galaxy+ and Galaxy Pro+): the picture button next to the message box, a preview
// before sending, and the picture inside the message (tap to open it full size).
import { toast } from "/js/site.js";
import { h, getJson, postJson, openDialog } from "/js/dialog.js";
import { chatState as state, messageBodyHooks, composerHooks } from "/js/chat.js";
import { shrink } from "/js/community-extra.js";

let rights = null;
getJson("/api/uploads/rights").then((r) => { rights = r; refreshButton(); }).catch(() => {});

const btn = document.getElementById("composer-pic");
const file = document.getElementById("composer-pic-file");
let open = false;

function refreshButton() {
  if (btn) btn.hidden = !open || !rights;
  drawPending();
}
composerHooks.push((ch, isOpen) => { open = isOpen; refreshButton(); });

function drawPending() {
  let bar = document.getElementById("pic-pending");
  if (!state.pendingImage) { bar?.remove(); return; }
  if (!bar) {
    bar = h("div", { class: "pic-pending", id: "pic-pending" });
    document.getElementById("composer")?.before(bar);
  }
  bar.replaceChildren(h("img", { src: state.pendingImage.preview, alt: "" }),
    h("span", { text: "Picture ready. Add a message or press send." }),
    h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove", onclick: () => { state.pendingImage = null; drawPending(); } }));
}

btn?.addEventListener("click", () => {
  if (rights?.blocked) return toast("Staff turned off picture uploads for your account.");
  if (!rights?.chat) {
    openDialog({
      title: "Pictures are a Galaxy+ perk",
      body: h("p", { class: "text-2", text: "Galaxy+ and Galaxy Pro+ members can share pictures in chat. Everyone can see them." }),
      actions: [{ label: "Close" }, { label: "See Galaxy+", kind: "primary", onClick: () => { location.href = "/store"; } }],
    });
    return;
  }
  file.click();
});

file?.addEventListener("change", async () => {
  const f = file.files[0];
  file.value = "";
  if (!f) return;
  try {
    btn.disabled = true;
    const img = await shrink(f);
    const r = await postJson("/api/chat/images", { mime: img.mime, data: img.data, width: img.width, height: img.height });
    state.pendingImage = { id: r.id, preview: img.preview };
    drawPending();
    document.getElementById("composer-input")?.focus();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
});

// A message with a picture shows it under the text.
messageBodyHooks.push((m, body, text) => {
  if (!m.image) return;
  if (!m.content) text.hidden = true;
  const ratio = m.image.w && m.image.h ? m.image.h / m.image.w : 0.6;
  const width = Math.min(360, m.image.w || 360);
  const img = h("img", { class: "msg-pic", src: `/api/chat/images/${m.image.id}`, alt: "Picture", loading: "lazy", width, height: Math.round(width * ratio) });
  const a = h("a", { class: "msg-pic-link", href: `/api/chat/images/${m.image.id}`, target: "_blank", rel: "noopener" }, img);
  body.append(a);
});
