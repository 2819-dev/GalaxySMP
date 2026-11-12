// Typing "#" in a message box shows the channels (like Discord). Pick one with a tap, Enter or Tab and it
// becomes "#slug", which shows as a clickable channel chip in the message.
export function attachChannelSuggest(input, getChannels) {
  let box = null;
  let items = [];
  let pick = 0;
  let start = -1;

  const close = () => { box?.remove(); box = null; start = -1; };

  function insert(ch) {
    const v = input.value;
    const end = input.selectionStart;
    input.value = `${v.slice(0, start)}#${ch.slug} ${v.slice(end)}`;
    const pos = start + ch.slug.length + 2;
    input.setSelectionRange(pos, pos);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    close();
    input.focus();
  }

  function draw() {
    if (!box) {
      box = document.createElement("div");
      box.className = "ch-suggest";
      box.setAttribute("role", "listbox");
      document.body.append(box);
    }
    box.replaceChildren();
    const head = document.createElement("div");
    head.className = "ch-suggest-head";
    head.textContent = "Channels";
    box.append(head);
    items.forEach((ch, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(i === pick));
      const hash = document.createElement("span"); hash.className = "hash"; hash.textContent = "#";
      const name = document.createElement("span"); name.textContent = ch.name;
      const cat = document.createElement("span"); cat.className = "cat"; cat.textContent = ch.category || "";
      b.append(hash, name, cat);
      b.addEventListener("mousedown", (e) => { e.preventDefault(); insert(ch); });
      box.append(b);
    });
    const r = input.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - 330))}px`;
    box.style.top = `${r.top + window.scrollY - Math.min(260, 40 + items.length * 40) - 8}px`;
  }

  input.addEventListener("input", () => {
    const upto = input.value.slice(0, input.selectionStart);
    const m = upto.match(/(^|[\s(])#([a-z0-9-]{0,40})$/i);
    if (!m) return close();
    start = upto.length - m[2].length - 1;
    const q = m[2].toLowerCase();
    items = getChannels().filter((c) => c.slug.includes(q) || c.name.toLowerCase().includes(q)).slice(0, 8);
    if (!items.length) return close();
    pick = 0;
    draw();
  });
  input.addEventListener("keydown", (e) => {
    if (!box) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      pick = (pick + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      draw();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopImmediatePropagation();
      insert(items[pick]);
    } else if (e.key === "Escape") {
      e.stopImmediatePropagation();
      close();
    }
  }, true);
  input.addEventListener("blur", () => setTimeout(close, 150));
}
