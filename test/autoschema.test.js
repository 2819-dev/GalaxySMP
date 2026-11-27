// The automatic database updates (src/lib/autoschema.js): a typo in this list silently stops every update after it,
// so check the list is well formed (this caught a missing comma that stopped them for a release).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PENDING } from "../src/lib/autoschema.js";

test("every entry is [version, [statements]] and records itself", () => {
  assert.ok(PENDING.length > 40);
  for (const [i, entry] of PENDING.entries()) {
    assert.ok(Array.isArray(entry) && typeof entry[0] === "string" && Array.isArray(entry[1]) && entry[1].length, `entry ${i} is malformed`);
    const [version, statements] = entry;
    assert.match(version, /^\d{4}_[a-z0-9_]+$/, version);
    assert.ok(statements.every((s) => typeof s === "string" && s.trim()), `${version}: statements must be non-empty strings`);
    assert.match(statements.at(-1), new RegExp(`INSERT INTO schema_migrations \\(version\\) VALUES \\('${version}'\\)`), `${version} should end by recording itself`);
  }
});

test("versions are unique and in order", () => {
  const versions = PENDING.map((p) => p[0]);
  assert.equal(new Set(versions).size, versions.length);
  assert.deepEqual(versions, [...versions].sort());
});

test("each update also has a copy in migrations/", () => {
  const files = readdirSync(new URL("../migrations/", import.meta.url)).map((f) => f.replace(/\.sql$/, ""));
  const recent = PENDING.map((p) => p[0]).filter((v) => v >= "0095");
  for (const v of recent) assert.ok(files.includes(v) || files.some((f) => f.startsWith(v.slice(0, 4))), `${v} should have a file in migrations/`);
  assert.ok(readFileSync(new URL("../migrations/0096_partners.sql", import.meta.url), "utf8").includes("partner_servers"));
});
