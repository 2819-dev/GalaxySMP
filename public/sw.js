// GalaxySMP app (PWA) service worker. It makes the site installable as an app and shows
// notifications. It doesn't cache pages, so you always get the newest version of the website.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil((async () => {
    // Already looking at that conversation/channel in a visible tab? Don't buzz.
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const target = new URL(data.url || "/", self.location.origin);
    const looking = wins.some((w) => w.visibilityState === "visible" && w.focused !== false &&
      new URL(w.url).pathname === target.pathname && (!target.hash || new URL(w.url).hash === target.hash));
    if (looking && data.tag !== "test") return;
    await self.registration.showNotification(data.title || "GalaxySMP", {
      body: data.body || "",
      icon: "/img/icon-192.png",
      badge: "/img/icon-192.png",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        if (w.url !== url && "navigate" in w) await w.navigate(url).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
