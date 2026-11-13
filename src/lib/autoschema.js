// Small database changes the website makes by itself the first time it starts after an update
// (each one only adds things, so running it again is harmless). Checked once per worker instance.
import { getDb } from "./db.js";

const PENDING = [
  ["0048_invites_looks", [
    "ALTER TABLE join_requests ADD COLUMN IF NOT EXISTS invited_by bigint REFERENCES users(id) ON DELETE SET NULL",
    `CREATE TABLE IF NOT EXISTS user_unlocks (
       user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       kind text NOT NULL CHECK (kind IN ('theme', 'title', 'frame')),
       item text NOT NULL, source text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (user_id, kind, item))`,
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS look_theme text",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS look_title text",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS look_frame text",
    "INSERT INTO schema_migrations (version) VALUES ('0048_invites_looks') ON CONFLICT DO NOTHING",
  ]],
];

let ready = null;
export function ensureSchema(env) {
  if (!env.DATABASE_URL) return Promise.resolve();
  ready ||= (async () => {
    const sql = getDb(env);
    const done = new Set((await sql`SELECT version FROM schema_migrations WHERE version = ANY(${PENDING.map((p) => p[0])})`).map((r) => r.version));
    for (const [version, statements] of PENDING) {
      if (done.has(version)) continue;
      for (const s of statements) await sql.query(s);
      console.log("database updated:", version);
    }
  })().catch((e) => { ready = null; console.error("database update failed", e); });
  return ready;
}
