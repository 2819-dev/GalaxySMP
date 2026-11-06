import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMessage, compileWordList } from "../src/lib/filter.js";

const words = compileWordList([
  { word: "fuck", match: "contains" },
  { word: "shit", match: "contains" },
  { word: "ass", match: "word" },
  { word: "damn", match: "word" },
  { word: "snapchat", match: "contains" },
]);
const ok = (t) => assert.equal(checkMessage(t, words).ok, true, `should allow: ${t}`);
const no = (t, reason) => {
  const r = checkMessage(t, words);
  assert.equal(r.ok, false, `should block: ${t}`);
  if (reason) assert.equal(r.reason, reason, `${t} -> ${r.reason}`);
};

test("normal chat is allowed", () => {
  ok("hey everyone, anyone want to do skyblock?");
  ok("my base is at x 1200 y 64 z -340");
  ok("I passed the class assessment");
  ok("gg that was a great match :)");
  ok("I'm on Bedrock, version 1.21.4");
  ok("Meet me at spawn in 5 minutes");
  ok("I have 2 diamonds and 30 iron");
  ok("I'm at home. Then we play minigames");
  ok("see you at spawn. bring food");
});

test("profanity, including disguises", () => {
  no("what the fuck", "profanity");
  no("f u c k", "profanity");
  no("f.u.c.k this", "profanity");
  no("fvck".replace("v", "u") + "ing", "profanity");
  no("sh1t", "profanity");
  no("shiiiiit", "profanity");
  no("you ass", "profanity");
  no("a$$", "profanity");
  no("damnit".replace("it", ""), "profanity");
  no("add my snap chat", "personal");
});

test("links", () => {
  no("go to https://example.com", "link");
  no("www.example.com", "link");
  no("join coolserver.net", "link");
  no("coolserver dot net", "link");
  no("discord.gg/abc123", "link");
  no("connect to 192.168.1.20", "link");
});

test("personal information", () => {
  no("my email is kid@example.com", "personal");
  no("kid at gmail dot com", "personal");
  no("message coolkid at outlook", "personal");
  no("call 555-123-4567", "personal");
  no("my number is 5551234567", "personal");
  no("I live at 42 Maple Street", "personal");
  no("i go to lincoln elementary school", "personal");
  no("im 9 years old", "personal");
  no("my real name is Sam", "personal");
  no("add me on insta", "personal");
});

test("spam", () => {
  no("AAAAAAAAAAAAAAAAAAAAAAAA", "caps");
  no("HELLO EVERYONE LOOK AT ME", "caps");
  no("lolllllllllllllllllllll", "spam");
  no("", "empty");
  no("x".repeat(501), "length");
});
