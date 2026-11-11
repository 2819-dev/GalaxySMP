// Notifications on this phone/computer: "Allow notifications" and Notification Preferences.
// iPhone/iPad only allow notifications for the installed GalaxySMP app (Add to Home Screen).
import { h, openDialog, postJson, getJson } from "/js/dialog.js";
import { toast, isInstalled, installApp, iconEl } from "/js/site.js";

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function keyBytes(b64) {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "iPad" : /iPhone/.test(ua) ? "iPhone"
    : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Device";
  return `${os}${isInstalled() ? " app" : " browser"}`;
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Asks for permission (must be called from a tap) and registers this device.
export async function enableNotifications() {
  if (!pushSupported()) {
    if (isIos() && !isInstalled()) {
      toast("On iPhone and iPad, notifications only work in the GalaxySMP app. Add it to your Home Screen first.");
      installApp();
      return false;
    }
    toast("This browser can't show notifications.");
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast(permission === "denied" ? "Notifications are blocked. Allow them for galaxymc.us in your device or browser settings." : "Notifications weren't turned on.");
    return false;
  }
  const settings = await getJson("/api/notify");
  if (!settings.publicKey) { toast("Notifications aren't set up on the website yet."); return false; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(settings.publicKey) });
  await postJson("/api/notify/subscribe", { subscription: sub.toJSON(), device: deviceName() });
  store.set("gsmp-notify", "on");
  return true;
}

export async function disableNotifications() {
  const sub = await currentSubscription().catch(() => null);
  if (sub) {
    await postJson("/api/notify/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  store.set("gsmp-notify", "off");
}

// Notification Preferences: on/off for this device + a switch for each kind.
export async function openPreferences() {
  let settings;
  try { settings = await getJson("/api/notify"); } catch (e) { toast(e.message); return; }
  const sub = await currentSubscription().catch(() => null);
  const on = Boolean(sub) && Notification.permission === "granted";
  const status = h("p", { class: "text-2 small", style: "margin:0" });
  const deviceBtn = h("button", { class: `btn btn-sm ${on ? "btn-secondary" : "btn-primary"}`, type: "button" });
  const paint = (isOn) => {
    status.textContent = isOn ? "Notifications are on for this device." : pushSupported() || !isIos() || isInstalled()
      ? "Notifications are off on this device." : "On iPhone/iPad, add GalaxySMP to your Home Screen to get notifications.";
    deviceBtn.textContent = isOn ? "Turn off on this device" : "Allow notifications";
    deviceBtn.className = `btn btn-sm ${isOn ? "btn-secondary" : "btn-primary"}`;
  };
  paint(on);
  let isOn = on;
  deviceBtn.addEventListener("click", async () => {
    deviceBtn.disabled = true;
    try {
      if (isOn) { await disableNotifications(); isOn = false; }
      else { isOn = await enableNotifications(); if (isOn) postJson("/api/notify/test", {}).catch(() => {}); }
    } catch (e) { toast(e.message || "Couldn't change notifications."); }
    paint(isOn);
    deviceBtn.disabled = false;
  });
  const prefs = { ...settings.prefs };
  const rows = Object.entries(settings.kinds).map(([k, v]) => {
    const box = h("input", { type: "checkbox", checked: prefs[k] });
    box.addEventListener("change", () => { prefs[k] = box.checked; });
    return h("label", { class: "np-row" }, h("span", { class: "np-text" }, h("b", { text: v.name }), h("span", { class: "text-3 small", text: v.hint })), box);
  });
  openDialog({
    title: "Notification Preferences",
    body: h("div", { class: "form" },
      h("div", { class: "np-device" }, iconEl("bell"), h("div", { class: "np-device-text" }, status), deviceBtn),
      h("p", { class: "text-3 small", style: "margin:0", text: `Choose what to be notified about. This applies to all your devices${settings.devices ? ` (${settings.devices} with notifications on)` : ""}.` }),
      h("div", { class: "np-list" }, rows)),
    actions: [{ label: "Close" }, { label: "Save", kind: "primary", onClick: async () => {
      await postJson("/api/notify/prefs", { prefs });
      toast("Notification preferences saved.");
    } }],
  });
}

// A small "Allow notifications" bar, shown once to signed-in members who haven't decided yet.
export async function maybeAskForNotifications() {
  const decided = store.get("gsmp-notify");
  if (decided || document.querySelector(".notify-banner")) return;
  if (!pushSupported() && !(isIos() && !isInstalled())) return; // browser can't do it at all
  if (pushSupported() && Notification.permission !== "default") return;
  const bar = h("div", { class: "notify-banner", role: "region", "aria-label": "Notifications" },
    iconEl("bell"),
    h("div", { class: "notify-banner-text" }, h("b", { text: "Get notified" }),
      h("span", { text: "DMs, mentions, announcements, server status and your daily reward." })),
    h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Allow", onclick: async () => {
      bar.remove();
      if (await enableNotifications()) { toast("Notifications on. Change them any time in Notification Preferences."); postJson("/api/notify/test", {}).catch(() => {}); }
    } }),
    h("button", { class: "icon-btn", type: "button", "aria-label": "Not now", onclick: () => { store.set("gsmp-notify", "later"); bar.remove(); } }, iconEl("x")));
  document.body.append(bar);
}

// Keeps this device's subscription on file (browsers sometimes renew it).
export async function refreshSubscription() {
  try {
    if (store.get("gsmp-notify") !== "on" || !pushSupported() || Notification.permission !== "granted") return;
    const sub = await currentSubscription();
    if (sub) await postJson("/api/notify/subscribe", { subscription: sub.toJSON(), device: deviceName() });
  } catch { /* not signed in, or offline */ }
}
