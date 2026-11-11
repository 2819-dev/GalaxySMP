// Galaxy Credits: a Store balance (in US cents) that players top up with a card and spend on
// Store items. Every change goes through change() so the ledger always matches the balance.

// Top-up packs: what the card is charged, and how much credit that gives (bigger packs get a bonus).
export const PACKS = [
  { id: "c5", price: 500, credit: 500 },
  { id: "c10", price: 1000, credit: 1100 },
  { id: "c20", price: 2000, credit: 2300 },
  { id: "c50", price: 5000, credit: 6000, badge: "Best value" },
];
export const PACK = Object.fromEntries(PACKS.map((p) => [p.id, p]));

export const GIFT_MIN = 100;        // $1
export const GIFT_DAILY_MAX = 5000; // $50 a day per sender

// Adds (positive) or takes (negative) credit. Taking fails (returns null) if the balance is too low,
// unless allowNegative (refunds of top-ups that were already spent).
export async function change(sql, userId, delta, reason, detail = null, ref = null, { allowNegative = false } = {}) {
  const [row] = delta < 0 && !allowNegative
    ? await sql`UPDATE users SET credit_cents = credit_cents + ${delta} WHERE id = ${userId} AND credit_cents >= ${-delta} RETURNING credit_cents`
    : await sql`UPDATE users SET credit_cents = credit_cents + ${delta} WHERE id = ${userId} RETURNING credit_cents`;
  if (!row) return null;
  await sql`INSERT INTO credit_ledger (user_id, delta_cents, reason, detail, ref) VALUES (${userId}, ${delta}, ${reason}, ${detail}, ${ref})`;
  return Number(row.credit_cents);
}

export async function balance(sql, userId) {
  const [row] = await sql`SELECT credit_cents FROM users WHERE id = ${userId}`;
  return Number(row?.credit_cents || 0);
}

export async function history(sql, userId, limit = 30) {
  const rows = await sql`SELECT delta_cents, reason, detail, created_at FROM credit_ledger WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${limit}`;
  return rows.map((r) => ({ amount: Number(r.delta_cents) / 100, reason: r.reason, detail: r.detail || "", at: r.created_at }));
}
