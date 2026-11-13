// Community > Friends: your friends (who's in game right now), friend requests, and adding someone by name.
import { h, getJson, postJson, openDialog } from "/js/dialog.js";
import { iconEl } from "/js/site.js";
import { faceSvg } from "/js/face.js";

const ago = (d) => {
  if (!d) return "Hasn't played yet";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 60) return `Played ${Math.max(1, m)} min ago`;
  if (m < 1440) return `Played ${Math.round(m / 60)} h ago`;
  const days = Math.round(m / 1440);
  return `Played ${days} day${days === 1 ? "" : "s"} ago`;
};

export function renderFriends(root, { toast, setTimer, openDM }) {
  const input = h("input", { class: "input", id: "fr-add", maxlength: 32, placeholder: "Website or Minecraft name", autocomplete: "off" });
  const addBtn = h("button", { class: "btn btn-primary", type: "submit" }, iconEl("userPlus"), "Send request");
  const form = h("form", { class: "fr-add" }, input, addBtn);
  const lists = h("div", { class: "fr-lists" });
  root.append(h("div", { class: "cp-wrap" },
    h("div", { class: "tl-intro" }, h("h2", { text: "Friends" }),
      h("p", { class: "text-3", text: "See when your friends are on the server. You'll get a notification when a friend joins (turn it off in Account settings > Notifications)." })),
    h("section", { class: "panel fr-box" }, h("h3", { class: "fr-h", text: "Add a friend" }), form),
    lists));

  const act = async (action, userId, label) => {
    try {
      await postJson("/api/friends", { action, userId });
      if (label) toast(label);
      load();
    } catch (e) { toast(e.message); }
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    addBtn.disabled = true;
    try {
      const r = await postJson("/api/friends", { action: "request", username: name });
      toast(r.state === "friends" ? `You and ${name} are now friends.` : `Friend request sent to ${name}.`);
      input.value = "";
      load();
    } catch (err) { toast(err.message); }
    addBtn.disabled = false;
  });

  const face = (f) => {
    const img = h("img", { class: "fr-face", alt: "", width: 36, height: 36, src: f.head || faceSvg(f.gamertag || f.username) });
    img.onerror = () => { img.onerror = null; img.src = faceSvg(f.gamertag || f.username); };
    return img;
  };
  const person = (f, sub, ...buttons) => h("div", { class: "fr-row" },
    h("a", { class: "fr-who", href: f.gamertag ? `/player/${encodeURIComponent(f.gamertag)}` : "#" },
      h("span", { class: "fr-face-wrap" }, face(f), f.inGame ? h("span", { class: "fr-dot", title: "In game now" }) : null),
      h("span", { class: "fr-name" }, h("b", { text: f.gamertag || f.username }), h("small", { class: f.inGame ? "fr-on" : "text-3", text: sub }))),
    h("span", { class: "fr-btns" }, ...buttons));
  const btn = (text, cls, onclick, icon) => h("button", { class: `btn btn-sm ${cls}`, type: "button", onclick }, icon ? iconEl(icon) : null, text);

  async function load() {
    let d;
    try { d = await getJson("/api/friends"); } catch (e) { lists.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    const parts = [];
    if (d.incoming.length) {
      parts.push(h("section", { class: "panel fr-box" }, h("h3", { class: "fr-h", text: `Friend requests (${d.incoming.length})` }),
        ...d.incoming.map((f) => person(f, "Wants to be your friend",
          btn("Accept", "btn-primary", () => act("accept", f.id, `You and ${f.gamertag || f.username} are now friends.`)),
          btn("Decline", "btn-ghost", () => act("decline", f.id))))));
    }
    const online = d.friends.filter((f) => f.inGame).length;
    parts.push(h("section", { class: "panel fr-box" },
      h("h3", { class: "fr-h", text: d.friends.length ? `Your friends · ${online} in game` : "Your friends" }),
      ...(d.friends.length ? d.friends.map((f) => person(f, f.inGame ? "In game now" : ago(f.lastSeen),
        btn("Message", "btn-secondary", () => (openDM ? openDM(f.id) : (location.href = `/community#dm-${f.id}`)), "message"),
        btn("", "btn-ghost fr-more", () => openDialog({
          title: `Remove ${f.gamertag || f.username}?`,
          body: h("p", { text: "You'll stop seeing each other in your Friends lists." }),
          actions: [{ label: "Keep" }, { label: "Remove friend", kind: "danger", onClick: () => act("remove", f.id) }],
        }), "trash")))
        : [h("p", { class: "text-3", text: "No friends yet. Add someone above, or tap Add friend on a player's profile." })])));
    if (d.outgoing.length) {
      parts.push(h("section", { class: "panel fr-box" }, h("h3", { class: "fr-h", text: "Requests you sent" }),
        ...d.outgoing.map((f) => person(f, "Waiting for them to accept", btn("Cancel", "btn-ghost", () => act("cancel", f.id))))));
    }
    lists.replaceChildren(...parts);
    root.querySelectorAll(".fr-more").forEach((b) => b.setAttribute("aria-label", "Remove friend"));
  }
  load();
  setTimer(setInterval(load, 30_000));
}
