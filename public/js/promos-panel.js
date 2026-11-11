// Control Panel > Promo codes (Admins): make, pause and delete Store promo codes.
import { h, openDialog, postJson, getJson, field, select } from "/js/dialog.js";
import { iconEl } from "/js/site.js";

const fmtDate = (d) => new Date(d).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function setupPromos({ loaders, toast }) {
  let data = null;

  async function load() {
    const box = document.getElementById("promo-list");
    try {
      data = await getJson("/api/panel/promos");
    } catch (e) {
      box.replaceChildren(h("p", { class: "text-3", text: e.message }));
      return;
    }
    if (!data.promos.length) {
      box.replaceChildren(h("div", { class: "promo-empty" }, iconEl("tag"), h("p", { class: "text-3", text: "No promo codes yet. Tap New promo code to make one." })));
      return;
    }
    box.replaceChildren(h("div", { class: "promo-list" }, data.promos.map(row)));
  }

  function row(p) {
    const status = !p.active ? ["Paused", "off"] : !p.live ? ["Expired", "off"] : ["Active", "on"];
    const bits = [
      p.targetText,
      p.members ? `Only for ${p.members.map((m) => m.username).join(", ")}` : "Anyone with the code",
      p.maxUses != null ? `${p.uses}/${p.maxUses} used` : `${p.uses} used`,
      p.perPlayer != null ? `${p.perPlayer} per player` : "no per-player limit",
      p.expires ? `ends ${fmtDate(p.expires)}` : "never ends",
    ];
    const copy = h("button", { class: "promo-code", type: "button", title: "Copy code" }, h("span", { text: p.code }), iconEl("copy"));
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(p.code); toast("Code copied."); } catch { /* no clipboard */ } });
    const act = async (action, msg) => { await postJson(`/api/panel/promos/${p.id}`, { action }); toast(msg); load(); };
    const pause = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: p.active ? "Pause" : "Turn on" });
    pause.addEventListener("click", () => act(p.active ? "pause" : "resume", p.active ? "Paused." : "Turned on.").catch((e) => toast(e.message)));
    const del = h("button", { class: "btn btn-ghost btn-sm danger-text", type: "button", text: "Delete" });
    del.addEventListener("click", () => openDialog({
      title: `Delete ${p.code}?`,
      body: h("p", { class: "text-2", text: "Nobody will be able to use it any more. Things already bought with it stay bought." }),
      actions: [{ label: "Cancel" }, { label: "Delete", kind: "danger", onClick: () => act("delete", "Deleted.") }],
    }));
    return h("div", { class: `promo-row${status[1] === "off" ? " off" : ""}` },
      h("div", { class: "promo-main" },
        h("div", { class: "promo-top" }, copy, h("span", { class: `promo-offer`, text: p.label }), h("span", { class: `promo-status ${status[1]}`, text: status[0] })),
        h("p", { class: "text-3 small promo-bits", text: bits.join(" · ") }),
        p.note ? h("p", { class: "text-2 small", style: "margin:2px 0 0", text: p.note }) : null),
      h("div", { class: "promo-actions" }, pause, del));
  }

  function memberPicker(chosen) {
    const input = h("input", { class: "input", id: "pr-member", type: "search", placeholder: "Search members by name", autocomplete: "off" });
    const results = h("div", { class: "promo-results" });
    const chips = h("div", { class: "promo-chips" });
    const draw = () => chips.replaceChildren(...[...chosen.values()].map((m) => {
      const x = h("button", { class: "promo-chip", type: "button", "aria-label": `Remove ${m.username}` }, m.username, " ×");
      x.addEventListener("click", () => { chosen.delete(m.id); draw(); });
      return x;
    }));
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim();
        if (!q) return results.replaceChildren();
        try {
          const d = await getJson(`/api/mod/members?q=${encodeURIComponent(q)}`);
          results.replaceChildren(...d.members.slice(0, 8).map((m) => {
            const b = h("button", { class: "promo-result", type: "button", text: m.username });
            b.addEventListener("click", () => { chosen.set(m.id, { id: m.id, username: m.username }); input.value = ""; results.replaceChildren(); draw(); });
            return b;
          }));
        } catch { /* ignore */ }
      }, 200);
    });
    return h("div", {}, input, results, chips);
  }

  function newPromo() {
    const code = h("input", { class: "input", id: "pr-code", maxlength: 32, placeholder: "e.g. SUMMER20 (empty = make one up)", autocomplete: "off" });
    code.addEventListener("input", () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""); });
    const kind = select("pr-kind", [["percent", "Percent off"], ["amount", "Dollars off"], ["free", "Free (100% off)"], ["first_month", "First month free (subscriptions)"]], "percent");
    const value = h("input", { class: "input", id: "pr-value", type: "number", min: 1, max: 99, step: 1, value: 20, inputmode: "decimal" });
    const valueField = field("Percent off", value);
    const syncKind = () => {
      const k = kind.value;
      valueField.hidden = k === "free" || k === "first_month";
      valueField.querySelector("label").textContent = k === "amount" ? "Dollars off (e.g. 1.50)" : "Percent off";
      value.step = k === "amount" ? "0.01" : "1";
      value.max = k === "amount" ? "1000" : "99";
      if (k === "amount" && Number(value.value) > 20) value.value = "1.00";
      boxes.forEach((b) => { b.disabled = k === "first_month" && !b.value.startsWith("plan:") && b.value !== "subs"; if (b.disabled) b.checked = false; });
    };
    kind.addEventListener("change", syncKind);

    // What it works on
    const boxes = [];
    const groups = new Map();
    for (const t of data.targets) {
      if (!groups.has(t.group)) groups.set(t.group, []);
      groups.get(t.group).push(t);
    }
    const targetBox = h("div", { class: "promo-targets" });
    for (const [group, list] of groups) {
      const items = list.map((t) => {
        const b = h("input", { type: "checkbox", value: t.id });
        boxes.push(b);
        return h("label", { class: "promo-check" }, b, h("span", { text: t.name }));
      });
      const isMain = group === "Subscriptions" || group === "Shop";
      targetBox.append(isMain
        ? h("div", { class: "promo-group" }, h("b", { class: "small", text: group }), h("div", { class: "promo-checks" }, items))
        : h("details", { class: "promo-group" }, h("summary", { class: "small", text: `${group}: pick single items` }), h("div", { class: "promo-checks" }, items)));
    }

    const who = select("pr-who", [["anyone", "Anyone who has the code"], ["members", "Only members I pick (they get a pop-up)"]], "anyone");
    const chosen = new Map();
    const picker = memberPicker(chosen);
    const pickerField = field("Members", picker.querySelector("input"));
    pickerField.append(...picker.children); // the results list and the chosen-member chips
    pickerField.hidden = true;
    who.addEventListener("change", () => { pickerField.hidden = who.value !== "members"; });

    const maxUses = h("input", { class: "input", id: "pr-max", type: "number", min: 1, step: 1, placeholder: "Unlimited" });
    const perPlayer = h("input", { class: "input", id: "pr-per", type: "number", min: 1, step: 1, value: 1, placeholder: "Unlimited" });
    const ends = select("pr-ends", [["", "Never"], ["1", "In 1 day"], ["3", "In 3 days"], ["7", "In 1 week"], ["14", "In 2 weeks"], ["30", "In 1 month"], ["custom", "Pick a date and time"]], "7");
    const endsAt = h("input", { class: "input", id: "pr-ends-at", type: "datetime-local" });
    const endsAtField = field("Ends on", endsAt);
    endsAtField.hidden = true;
    ends.addEventListener("change", () => { endsAtField.hidden = ends.value !== "custom"; });
    const note = h("input", { class: "input", id: "pr-note", maxlength: 120, placeholder: "Only staff see this (e.g. Summer event)" });

    openDialog({
      title: "New promo code",
      body: h("div", { class: "promo-form" },
        field("Code", code, "What players type at checkout. Letters, numbers, - and _."),
        field("What it gives", kind), valueField,
        h("div", { class: "field" }, h("span", { class: "field-label", text: "Works on" }), h("p", { class: "hint", style: "margin:0 0 6px", text: "Tick nothing for everything." }), targetBox),
        field("Who can use it", who), pickerField,
        h("div", { class: "promo-two" }, field("Total uses", maxUses, "Empty = unlimited"), field("Uses per player", perPlayer, "Empty = unlimited")),
        field("Expires", ends), endsAtField,
        field("Note", note)),
      actions: [{ label: "Cancel" }, {
        label: "Create code", kind: "primary", onClick: async () => {
          if (who.value === "members" && !chosen.size) throw new Error("Pick at least one member, or choose Anyone.");
          let expires = null;
          if (ends.value === "custom") {
            if (!endsAt.value) throw new Error("Pick when it ends.");
            expires = new Date(endsAt.value).toISOString();
          } else if (ends.value) expires = new Date(Date.now() + Number(ends.value) * 86400000).toISOString();
          const res = await postJson("/api/panel/promos", {
            code: code.value, kind: kind.value, value: value.value,
            targets: boxes.filter((b) => b.checked).map((b) => b.value),
            members: who.value === "members" ? [...chosen.keys()] : [],
            maxUses: maxUses.value, perPlayer: perPlayer.value, expires, note: note.value,
          });
          toast(`Promo code ${res.code} created.`);
          load();
        },
      }],
    });
    syncKind();
  }

  document.getElementById("promo-new")?.addEventListener("click", async () => {
    if (!data) await load();
    if (data) newPromo();
  });
  loaders.promos = load;
}
