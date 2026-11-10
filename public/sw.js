// GalaxySMP app (PWA) service worker. It only makes the site installable as an app;
// it doesn't cache pages, so you always get the newest version of the website.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
