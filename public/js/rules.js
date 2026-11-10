// Rules page: shows the rules Admins edit in the staff panel > Help menu (the same rules as /guide in game).
import "/js/site.js";

function line(text) {
  const li = document.createElement("li");
  // **bold** -> <strong>, everything else as plain text
  text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) {
      const b = document.createElement("strong");
      b.textContent = part.slice(2, -2);
      li.append(b);
    } else {
      li.append(part);
    }
  });
  return li;
}

(async () => {
  try {
    const res = await fetch("/api/help");
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.rules) || !data.rules.length) return;
    const box = document.getElementById("rule-sections");
    box.replaceChildren();
    for (const section of data.rules) {
      const h3 = document.createElement("h3");
      h3.textContent = section.title;
      const ul = document.createElement("ul");
      for (const item of section.items) ul.append(line(item));
      box.append(h3, ul);
    }
  } catch {
    // keep the built-in copy
  }
})();
