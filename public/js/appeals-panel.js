// Control Panel > Moderation > Appeals: read ban appeals, accept (lifts the ban) or decline, with an answer.
import { h, openDialog, postJson, getJson, field } from "/js/dialog.js";

const WHICH = { game: "Minecraft server", website: "Community", both: "Server and community" };

export function setupAppeals({ loaders, toast, setBadge }) {
  let status = "open";
  const list = document.getElementById("appeal-list");
  document.querySelectorAll("#appeal-filter button").forEach((b) => b.addEventListener("click", () => {
    status = b.dataset.status;
    document.querySelectorAll("#appeal-filter button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    loaders.appeals();
  }));
  loaders.appeals = async () => {
    let d;
    try { d = await getJson(`/api/mod/appeals?status=${status}`); } catch (e) { list.replaceChildren(h("p", { class: "text-3", text: e.message })); return; }
    setBadge("appeals", d.open);
    if (!d.appeals.length) { list.replaceChildren(h("div", { class: "panel empty", text: status === "open" ? "No appeals waiting." : "None yet." })); return; }
    list.replaceChildren(...d.appeals.map((a) => {
      const foot = h("div", { class: "sg-foot" }, h("span", { text: `${WHICH[a.which]} ban · ${new Date(a.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` }));
      if (a.status === "open" && d.canDecide) {
        foot.append(
          h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Accept", onclick: () => decide(a, "accepted") }),
          h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Decline", onclick: () => decide(a, "declined") }));
      } else if (a.status === "open") {
        foot.append(h("span", { class: "text-3", text: "An Admin decides appeals." }));
      }
      return h("article", { class: "panel", style: "padding:16px" },
        h("div", { class: "ap-head" }, a.xuid ? h("a", { href: `/staff#players/${a.xuid}`, text: a.gamertag }) : h("b", { text: a.gamertag }),
          h("span", { class: `sg-status ${{ open: "planned", accepted: "done", declined: "declined" }[a.status]}`, text: { open: "Waiting", accepted: "Accepted", declined: "Declined" }[a.status] })),
        a.gameBan ? h("p", { class: "text-3 small", style: "margin:6px 0 0", text: `Game ban by ${a.gameBan.by || "staff"}${a.gameBan.reason ? `: ${a.gameBan.reason}` : ""}` }) : null,
        h("p", { class: "ap-msg", style: "margin:10px 0", text: a.message }),
        a.reply ? h("div", { class: `sg-reply ${a.status === "accepted" ? "done" : "declined"}` }, h("div", { class: "sg-reply-head", text: `Answer from ${a.handledBy || "staff"}` }), h("p", { text: a.reply })) : null,
        foot);
    }));
  };
  function decide(a, st) {
    const reply = h("textarea", { class: "input", id: "ap-reply", rows: 4, maxlength: 1000,
      placeholder: st === "accepted" ? "e.g. Thanks for explaining. Your ban is lifted; please follow the rules." : "e.g. The ban stays because…" });
    const unban = h("input", { type: "checkbox", id: "ap-unban", checked: true });
    openDialog({
      title: `${st === "accepted" ? "Accept" : "Decline"} ${a.gamertag}'s appeal`,
      body: h("div", { class: "form" }, field("Answer (the player sees this on their appeal page)", reply),
        st === "accepted" ? h("label", { class: "check" }, unban, "Lift the ban now") : null),
      actions: [{ label: "Cancel" }, { label: st === "accepted" ? "Accept" : "Decline", kind: st === "accepted" ? "primary" : "danger", onClick: async () => {
        const r = await postJson(`/api/mod/appeals/${a.id}`, { status: st, reply: reply.value, unban: unban.checked });
        toast(r.message || "Saved.");
        loaders.appeals();
      } }],
    });
  }
  getJson("/api/mod/appeals?status=open").then((d) => setBadge("appeals", d.open)).catch(() => {});
}
