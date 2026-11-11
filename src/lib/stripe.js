// Stripe, with plain fetch (no SDK). Keys live only in Cloudflare:
//   STRIPE_SECRET_KEY      sk_live_... (or sk_test_... while testing)
//   STRIPE_WEBHOOK_SECRET  whsec_...   (from the webhook endpoint in the Stripe dashboard)
const API = "https://api.stripe.com/v1";

// { a: { b: 1 }, list: [{ x: 2 }] } -> "a[b]=1&list[0][x]=2" (Stripe's form format)
function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? form(item, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(env, method, path, body, idempotencyKey) {
  const res = await fetch((env.STRIPE_API_BASE || API) + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-06-20",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body ? form(body).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("stripe error", res.status, data?.error?.message);
    throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  }
  return data;
}

// A hosted Stripe Checkout page for one thing. Returns { id, url }.
export function createCheckout(env, { paymentId, userId, name, description, amountCents, origin, successPath, cancelPath }) {
  return stripe(env, "POST", "/checkout/sessions", {
    mode: "payment",
    client_reference_id: String(userId),
    line_items: [{
      quantity: 1,
      price_data: { currency: "usd", unit_amount: amountCents, product_data: { name, ...(description ? { description } : {}) } },
    }],
    metadata: { payment_id: String(paymentId), user_id: String(userId) },
    payment_intent_data: { metadata: { payment_id: String(paymentId), user_id: String(userId) } },
    success_url: `${origin}${successPath}`,
    cancel_url: `${origin}${cancelPath}`,
  }, `gsmp-payment-${paymentId}`);
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Checks the Stripe-Signature header (HMAC-SHA256 of "timestamp.body"). Returns the event, or null.
export async function verifyWebhook(env, rawBody, header, toleranceSec = 300) {
  if (!env.STRIPE_WEBHOOK_SECRET || !header) return null;
  let t = null;
  const sigs = [];
  for (const piece of String(header).split(",")) {
    const [k, v] = piece.split("=");
    if (k === "t") t = v;
    else if (k === "v1" && v) sigs.push(v);
  }
  if (!t || !sigs.length) return null;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`)));
  if (!sigs.some((s) => safeEqual(s, expected))) return null;
  try { return JSON.parse(rawBody); } catch { return null; }
}
