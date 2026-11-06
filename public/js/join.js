import "/js/site.js";

const tabs = [...document.querySelectorAll('[role="tab"]')];

function select(tab, focus) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  }
  if (focus) tab.focus();
  history.replaceState(null, "", "#" + tab.id.replace("tab-", ""));
}

tabs.forEach((t, i) => {
  t.addEventListener("click", () => select(t));
  t.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      select(next, true);
    }
  });
});

// Open the Bedrock tab for /join#bedrock, or guess from the device.
const wanted = location.hash.slice(1);
const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const start = document.getElementById("tab-" + wanted) || (mobile ? document.getElementById("tab-bedrock") : null);
if (start) select(start);
