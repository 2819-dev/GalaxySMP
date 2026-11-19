// Per-connection message limits for the live sockets (chat, voice, stages).
// A token bucket: `rate` messages a second on average, bursts up to `burst`.
const buckets = new WeakMap();

export function flooding(ws, key = "all", rate = 10, burst = 30) {
  const now = Date.now();
  let all = buckets.get(ws);
  if (!all) buckets.set(ws, (all = {}));
  const b = (all[key] ||= { t: burst, at: now });
  b.t = Math.min(burst, b.t + ((now - b.at) * rate) / 1000);
  b.at = now;
  if (b.t < 1) return true;
  b.t -= 1;
  return false;
}

// Too many messages: close the connection (the page reconnects by itself a moment later).
export function closeFlooder(ws) {
  try { ws.close(4008, "Too many messages"); } catch { /* gone */ }
}
