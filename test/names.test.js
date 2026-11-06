import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRequestedName, namesMatch, isOwner, baseName } from "../src/lib/names.js";
import { linkCode, formatCode, normalizeCode, safeEqual } from "../src/lib/crypto.js";

test("java names", () => {
  assert.deepEqual(parseRequestedName("Ashcore2261", "java"), { name: "Ashcore2261", platform: "java" });
  assert.ok(parseRequestedName("ab", "java").error);
  assert.ok(parseRequestedName("bad name", "java").error);
  assert.ok(parseRequestedName(".dot", "java").error);
});

test("bedrock names get the dot and underscores", () => {
  assert.equal(parseRequestedName("VisionDevs", "bedrock").name, ".VisionDevs");
  assert.equal(parseRequestedName(".VisionDevs", "bedrock").name, ".VisionDevs");
  assert.equal(parseRequestedName("Cool Kid", "bedrock").name, ".Cool_Kid");
  assert.ok(parseRequestedName("x!y", "bedrock").error);
});

test("matching in-game names", () => {
  assert.ok(namesMatch(".VisionDevs", ".visiondevs", true));
  assert.ok(namesMatch(".VisionDevs", "*VisionDevs", true));      // custom Floodgate prefix
  assert.ok(!namesMatch(".VisionDevs", "VisionDevs", false));     // Java player with same base name
  assert.ok(!namesMatch("Steve", ".Steve", true));                // Bedrock player can't take Java name
  assert.ok(namesMatch("Ashcore2261", "ashcore2261", false));
  assert.equal(baseName(".Cool Kid"), "cool_kid");
});

test("owners", () => {
  const env = { OWNER_USERNAMES: "Ashcore2261,.VisionDevs" };
  assert.ok(isOwner(env, "Ashcore2261", false));
  assert.ok(isOwner(env, ".VisionDevs", true));
  assert.ok(!isOwner(env, "VisionDevs", false));
  assert.ok(!isOwner(env, ".Ashcore2261", true));
});

test("codes", async () => {
  const c = linkCode();
  assert.match(c, /^[A-HJKMNP-Z2-9]{6}$/);
  assert.equal(normalizeCode(formatCode(c).toLowerCase()), c);
  assert.ok(await safeEqual("abc", "abc"));
  assert.ok(!(await safeEqual("abc", "abd")));
});
