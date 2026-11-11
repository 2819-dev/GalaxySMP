// "@" suggestions while typing a message, like Discord: type @ and part of a name, then pick a
// member with Tab/Enter/click (arrow keys move). Staff also get @everyone and @here.
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// input: the textarea. getMembers(): [{ id, username, head, online }]. isStaff(): boolean.
export function setupMentions(input, getMembers, isStaff) {
  const box = el("div", "mention-pop");
  box.setAttribute("role", "listbox");
  box.hidden = true;
  input.closest("form")?.before(box);
  let items = [];
  let active = 0;
  let start = -1;

  const close = () => { box.hidden = true; items = []; start = -1; };
  const query = () => {
    const pos = input.selectionStart;
    const before = input.value.slice(0, pos);
    const m = before.match(/(^|[\s(])@([^\s@]{0,24}(?: [^\s@]{0,24})?)$/);
    if (!m) return null;
    return { at: pos - m[2].length - 1, text: m[2].toLowerCase() };
  };
  const render = () => {
    box.replaceChildren();
    items.forEach((it, i) => {
      const row = el("button", `mention-opt${i === active ? " active" : ""}`);
      row.type = "button";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(i === active));
      if (it.head) {
        const img = el("img", "mention-face");
        img.src = it.head;
        img.alt = "";
        img.addEventListener("error", () => img.remove(), { once: true });
        row.append(img);
      } else row.append(el("span", "mention-face mention-face-blank", "@"));
      row.append(el("span", "mention-name", it.label), it.hint ? el("span", "mention-hint", it.hint) : "");
      row.addEventListener("mousedown", (e) => { e.preventDefault(); pick(i); });
      box.append(row);
    });
    box.hidden = !items.length;
  };
  const update = () => {
    const q = query();
    if (!q) return close();
    start = q.at;
    const t = q.text;
    const list = [];
    if (isStaff()) {
      for (const [word, hint] of [["everyone", "Notify everyone"], ["here", "Notify everyone online"]]) {
        if (word.startsWith(t)) list.push({ insert: word, label: `@${word}`, hint });
      }
    }
    const members = getMembers()
      .filter((m) => m.username.toLowerCase().includes(t))
      .sort((a, b) => {
        const as = a.username.toLowerCase().startsWith(t) ? 0 : 1;
        const bs = b.username.toLowerCase().startsWith(t) ? 0 : 1;
        return as - bs || (b.online ? 1 : 0) - (a.online ? 1 : 0) || a.username.localeCompare(b.username);
      })
      .slice(0, 8);
    for (const m of members) list.push({ insert: m.username, label: m.username, head: m.head, hint: m.online ? "online" : "" });
    items = list.slice(0, 10);
    active = Math.min(active, Math.max(0, items.length - 1));
    render();
  };
  const pick = (i) => {
    const it = items[i];
    if (!it || start < 0) return;
    const pos = input.selectionStart;
    const insert = `@${it.insert} `;
    input.value = input.value.slice(0, start) + insert + input.value.slice(pos);
    const caret = start + insert.length;
    input.setSelectionRange(caret, caret);
    close();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  };

  input.addEventListener("input", () => { active = 0; update(); });
  input.addEventListener("click", update);
  input.addEventListener("blur", () => setTimeout(close, 150));
  // registered before the "Enter sends" handler, so picking a name doesn't send the message
  input.addEventListener("keydown", (e) => {
    if (box.hidden || !items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      render();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(active);
    } else if (e.key === "Escape") {
      e.stopImmediatePropagation();
      close();
    }
  });
}
