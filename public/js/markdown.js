// Discord-style message formatting for the community. Everything is built as DOM nodes with
// textContent (never innerHTML), so formatting can't inject anything.
//
//   **bold**  *italic* / _italic_  ***bold italic***  __underline__  ~~strikethrough~~  ||spoiler||
//   `code`  ```code block```  # Heading  ## Heading  ### Heading  -# small text  > quote
//   - list / * list / 1. list   [text](https://link)   links   @mentions  @everyone  @here

const el = (tag, cls) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};

// ctx: { members: [{ id, username }], meName, onMention(member, node) }
export function renderMarkdown(text, ctx = {}) {
  const root = document.createDocumentFragment();
  // Only 1 to 3 custom emoji and nothing else: show them big, like Discord.
  const only = String(text).trim().match(/^(?::[a-z0-9_]{2,24}:\s*){1,3}$/);
  if (only) {
    const names = [...String(text).matchAll(/:([a-z0-9_]{2,24}):/g)].map((x) => x[1]);
    if (names.every((n) => CUSTOM_EMOJI.has(n))) {
      for (const n of names) root.append(emojiNode(n, true));
      return root;
    }
  }
  const lines = String(text).split("\n");
  let i = 0;
  let list = null;
  let quote = null;
  const endBlocks = () => { list = null; quote = null; };
  while (i < lines.length) {
    const line = lines[i];
    // ``` code block ``` (can span lines)
    if (line.trimStart().startsWith("```")) {
      const first = line.trimStart().slice(3);
      const body = [];
      let closed = false;
      if (first.includes("```")) { body.push(first.slice(0, first.indexOf("```"))); closed = true; i++; }
      else {
        if (first.trim() && !/^[a-z0-9+#-]{1,15}$/i.test(first.trim())) body.push(first); // ```lang is dropped
        i++;
        while (i < lines.length) {
          if (lines[i].includes("```")) { body.push(lines[i].slice(0, lines[i].indexOf("```"))); closed = true; i++; break; }
          body.push(lines[i]);
          i++;
        }
      }
      if (!closed && !body.length) { root.append(inline(line, ctx)); continue; }
      endBlocks();
      const pre = el("pre", "md-codeblock");
      const code = el("code");
      code.textContent = body.join("\n").replace(/^\n+|\n+$/g, "");
      pre.append(code);
      root.append(pre);
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,3}) (.+)$/))) {
      endBlocks();
      const hd = el(`h${m[1].length + 2}`, `md-h md-h${m[1].length}`);
      hd.append(inline(m[2], ctx));
      root.append(hd);
    } else if ((m = line.match(/^-# (.+)$/))) {
      endBlocks();
      const sm = el("div", "md-subtext");
      sm.append(inline(m[1], ctx));
      root.append(sm);
    } else if ((m = line.match(/^>>> ?(.*)$/))) { // everything after >>> is quoted
      list = null;
      const bq = el("blockquote", "md-quote");
      bq.append(inline([m[1], ...lines.slice(i + 1)].join("\n"), ctx));
      root.append(bq);
      break;
    } else if ((m = line.match(/^> ?(.*)$/))) {
      list = null;
      if (!quote) { quote = el("blockquote", "md-quote"); root.append(quote); }
      else quote.append(document.createElement("br"));
      quote.append(inline(m[1], ctx));
    } else if ((m = line.match(/^\s*([-*]|\d{1,3}\.) (.+)$/))) {
      quote = null;
      const ordered = /\d/.test(m[1]);
      if (!list || list.ordered !== ordered) {
        list = el(ordered ? "ol" : "ul", "md-list");
        list.ordered = ordered;
        if (ordered) list.start = parseInt(m[1], 10) || 1;
        root.append(list);
      }
      const li = el("li");
      li.append(inline(m[2], ctx));
      list.append(li);
    } else {
      endBlocks();
      if (root.childNodes.length && !(root.lastChild instanceof HTMLElement && /^(H\d|PRE|UL|OL|BLOCKQUOTE|DIV)$/.test(root.lastChild.tagName))) {
        root.append(document.createElement("br"));
      }
      root.append(inline(line, ctx));
    }
    i++;
  }
  return root;
}

// ---------- inline formatting ----------
const RULES = [
  { re: /`([^`\n]+)`/, make: (m) => { const c = el("code", "md-code"); c.textContent = m[1]; return c; } },
  { re: /\|\|([\s\S]+?)\|\|/, make: (m, ctx) => {
    const s = el("span", "md-spoiler");
    s.append(inline(m[1], ctx));
    s.tabIndex = 0;
    s.setAttribute("role", "button");
    s.setAttribute("aria-label", "Spoiler: tap to show");
    const show = (e) => { e.stopPropagation(); s.classList.add("shown"); s.removeAttribute("role"); s.removeAttribute("aria-label"); };
    s.addEventListener("click", show);
    s.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") show(e); });
    return s;
  } },
  { re: /\[([^\]\n]{1,100})\]\((https?:\/\/[^\s)]+)\)/, make: (m) => link(m[2], m[1]) },
  { re: /\b(?:https?:\/\/|www\.)[^\s<>"]+[^\s<>".,!?:;)\]]/, make: (m) => link(/^https?:/i.test(m[0]) ? m[0] : `https://${m[0]}`, m[0]) },
  { re: /\*\*\*([^*\n](?:[\s\S]*?[^*\n])?)\*\*\*/, make: (m, ctx) => wrap("strong", wrap("em", inline(m[1], ctx))) },
  { re: /\*\*([^*\n](?:[\s\S]*?[^*\n])?)\*\*/, make: (m, ctx) => wrap("strong", inline(m[1], ctx)) },
  { re: /__([^_\n](?:[\s\S]*?[^_\n])?)__/, make: (m, ctx) => wrap("u", inline(m[1], ctx)) },
  { re: /~~([^~\n](?:[\s\S]*?[^~\n])?)~~/, make: (m, ctx) => wrap("s", inline(m[1], ctx)) },
  { re: /\*([^*\s](?:[^*\n]*?[^*\s])?)\*/, make: (m, ctx) => wrap("em", inline(m[1], ctx)) },
  { re: /(?<![A-Za-z0-9_])_([^_\s](?:[^_\n]*?[^_\s])?)_(?![A-Za-z0-9_])/, make: (m, ctx) => wrap("em", inline(m[1], ctx)) },
  { re: /:([a-z0-9_]{2,24}):/, make: (m) => emojiNode(m[1]) || document.createTextNode(m[0]) },  // custom emoji
  { re: /@/, make: null }, // mentions: handled below (they need the member list)
];

// Custom server emoji (:creeper:, :diamond:...), added by Admins. The chat page loads the list.
const CUSTOM_EMOJI = new Map();  // name -> image url
export function setCustomEmoji(list) {
  CUSTOM_EMOJI.clear();
  for (const e of list || []) CUSTOM_EMOJI.set(e.name, e.url);
}
export function customEmoji() {
  return [...CUSTOM_EMOJI].map(([name, url]) => ({ name, url }));
}
export function emojiNode(name, big) {
  const url = CUSTOM_EMOJI.get(name);
  if (!url) return null;
  const img = document.createElement("img");
  img.className = big ? "emoji emoji-big" : "emoji";
  img.src = url;
  img.alt = `:${name}:`;
  img.title = `:${name}:`;
  img.width = big ? 44 : 22;
  img.height = big ? 44 : 22;
  img.loading = "lazy";
  return img;
}

function wrap(tag, child) {
  const e = document.createElement(tag);
  e.append(child);
  return e;
}

function link(href, label) {
  let ok = false;
  try { ok = ["http:", "https:"].includes(new URL(href).protocol); } catch { /* not a link */ }
  if (!ok) return document.createTextNode(label);
  const a = el("a", "msg-link");
  a.textContent = label;
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer nofollow ugc";
  if (label !== href) a.title = href;
  return a;
}

// The member whose name follows the "@" at position at (longest name wins, case-insensitive).
function mentionAt(text, at, ctx) {
  const rest = text.slice(at + 1).toLowerCase();
  for (const word of ["everyone", "here"]) {
    if (rest.startsWith(word) && !/[a-z0-9_]/i.test(rest[word.length] || "")) return { special: word, length: word.length + 1 };
  }
  let best = null;
  for (const m of ctx.members || []) {
    const n = m.username.toLowerCase();
    if (rest.startsWith(n) && !/[a-z0-9_]/i.test(rest[n.length] || "") && (!best || n.length > best.username.length)) best = m;
  }
  return best ? { member: best, length: best.username.length + 1 } : null;
}

export function inline(text, ctx = {}) {
  const frag = document.createDocumentFragment();
  let rest = String(text);
  while (rest) {
    let best = null;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, rule };
    }
    if (!best) { frag.append(rest); break; }
    const { m, rule } = best;
    if (m.index) frag.append(rest.slice(0, m.index));
    if (!rule.make) { // "@"
      const hit = mentionAt(rest, m.index, ctx);
      if (!hit) { frag.append("@"); rest = rest.slice(m.index + 1); continue; }
      const pill = el("span", "mention");
      if (hit.special) pill.textContent = `@${hit.special}`;
      else {
        pill.textContent = `@${hit.member.username}`;
        if (ctx.meName && hit.member.username.toLowerCase() === ctx.meName.toLowerCase()) pill.classList.add("me");
        if (ctx.onMention) {
          pill.classList.add("clickable");
          pill.addEventListener("click", (e) => { e.stopPropagation(); ctx.onMention(hit.member, pill); });
        }
      }
      frag.append(pill);
      rest = rest.slice(m.index + hit.length);
      continue;
    }
    frag.append(rule.make(m, ctx));
    rest = rest.slice(m.index + m[0].length);
  }
  return frag;
}

// For previews (reply bar, notifications): the message without formatting characters.
export function plainText(text) {
  return String(text)
    .replace(/```[a-z0-9+#-]*\n?([\s\S]*?)```/gi, "$1")
    .replace(/^(#{1,3}|-#|>>>|>) ?/gm, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/(\*\*\*|\*\*|__|~~|\|\||`|\*)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
