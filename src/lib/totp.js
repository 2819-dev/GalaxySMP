// Authenticator-app codes (TOTP, RFC 6238: 6 digits, 30 seconds, SHA-1), with Web Crypto only.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = "", out = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out; // 32 characters
}

function decode(secret) {
  const clean = String(secret).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of clean) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export async function codeAt(secret, step) {
  const key = await crypto.subtle.importKey("raw", decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(step / 2 ** 32));
  view.setUint32(4, step >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = mac[mac.length - 1] & 15;
  const n = ((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

// The time step a code matches (now, or 30 seconds either side), or null.
export async function matchStep(secret, code, now = Date.now()) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const step = Math.floor(now / 30000);
  for (const s of [step, step - 1, step + 1]) if ((await codeAt(secret, s)) === c) return s;
  return null;
}

export function otpauthUrl(secret, account) {
  return `otpauth://totp/${encodeURIComponent(`GalaxySMP:${account}`)}?secret=${secret}&issuer=GalaxySMP&algorithm=SHA1&digits=6&period=30`;
}
