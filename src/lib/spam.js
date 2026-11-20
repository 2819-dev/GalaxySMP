// Spam detection for chat (used by the chat hub) and "is this a real message?" for chat XP.
// Pure functions, so they can be tested on their own.
import { normalize } from "./filter.js";

export const LIMITS = {
  burst: { count: 5, windowMs: 10_000 },       // 5 messages in 10 seconds
  sustained: { count: 20, windowMs: 60_000 },  // 20 messages in a minute
  shortBurst: { count: 4, windowMs: 8_000 },   // 4 one-word messages in 8 seconds ("hi" "hi" "hey" "yo")
  repeatWindowMs: 120_000,                     // near-copies are compared over 2 minutes
  immediateMs: 30_000,                         // the same thing again within 30 seconds is blocked at once
  similar: 0.85,                               // how alike two messages must be to count as the same
  strikes: { count: 3, windowMs: 120_000, muteMinutes: 10 },   // 3 blocked spam messages in 2 minutes = 10-minute mute
};

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

// Letters and digits only, lowercased, look-alike letters undone, stretched letters squashed ("heyyyy" -> "hey").
export function spamKey(text) {
  // punctuation and emojis go first (the word filter reads "!" as "i", which isn't wanted here)
  return normalize(String(text || "").replace(/[^\p{L}\p{N}\s]+/gu, "")).replace(/[^\p{L}\p{N}]+/gu, "").replace(/(.)\1+/gu, "$1");
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); out.set(b, (out.get(b) || 0) + 1); }
  return out;
}
// 0 (different) to 1 (the same), ignoring small changes like "hi1" / "hi2" or an extra word.
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return a === b ? 1 : 0;
  const A = bigrams(a), B = bigrams(b);
  let both = 0;
  for (const [k, n] of A) both += Math.min(n, B.get(k) || 0);
  return (2 * both) / (a.length - 1 + b.length - 1);
}

const words = (text) => normalize(String(text || "")).split(/[^\p{L}\p{N}@]+/u).filter(Boolean);

// Problems inside one message (no history needed). Returns a friendly reason, or null.
export function contentProblem(text) {
  const t = String(text || "");
  const w = words(t);
  if (w.length >= 6 && new Set(w).size / w.length < 0.34) return "Please don't repeat the same words over and over.";
  const mentions = new Set((t.match(/@[\w.-]{2,32}/g) || []).map((m) => m.toLowerCase()));
  if (mentions.size > 5) return "Please don't mention lots of people at once.";
  if ((t.match(EMOJI_RE) || []).length > 20) return "Please use fewer emojis in one message.";
  return null;
}

// Is this a real message that should earn chat XP? (not "k", "lol", "aaaa", a lone emoji or a copy of the last one)
export function earnsXp(text, lastKey = null) {
  const key = spamKey(text);
  if (key.length < 4) return false;                       // "ok", "lol", "hi", emojis only
  const w = words(text);
  if (w.length < 2 && key.length < 8) return false;       // one short word
  if (new Set(key).size < 3) return false;                // "hahahaha", "lolololol"
  if (contentProblem(text)) return false;
  if (lastKey && similarity(key, lastKey) >= 0.8) return false;   // basically the same as their last one
  return true;
}

// One member's recent messages. check() returns null (fine) or { message, strike }.
export class SpamTracker {
  constructor() { this.times = []; this.said = []; this.short = []; this.strikes = []; }

  forget(now) {
    this.times = this.times.filter((t) => now - t < LIMITS.sustained.windowMs);
    this.said = this.said.filter((x) => now - x.at < LIMITS.repeatWindowMs);
    this.short = this.short.filter((t) => now - t < LIMITS.shortBurst.windowMs);
    this.strikes = this.strikes.filter((t) => now - t < LIMITS.strikes.windowMs);
  }

  idle(now, ms) { return !this.times.some((t) => now - t < ms); }

  check(text, now = Date.now()) {
    this.forget(now);
    const burst = this.times.filter((t) => now - t < LIMITS.burst.windowMs).length;
    if (burst >= LIMITS.burst.count || this.times.length >= LIMITS.sustained.count) {
      return this.block("You're sending messages too quickly. Please slow down.", now, false);
    }
    const problem = contentProblem(text);
    if (problem) return this.block(problem, now, true);
    const key = spamKey(text);
    const oneWord = words(text).length <= 1;
    if (oneWord && this.short.length >= LIMITS.shortBurst.count - 1) {
      return this.block("Try putting your thoughts into one message instead of lots of short ones.", now, false);
    }
    if (key) {
      const alike = this.said.filter((x) => similarity(x.key, key) >= LIMITS.similar);
      const last = alike[alike.length - 1];
      if (last && now - last.at < LIMITS.immediateMs) return this.block("You just sent that message.", now, true);
      if (alike.length >= 2) return this.block("Please don't send the same message over and over.", now, true);
    }
    this.times.push(now);
    this.said.push({ key, at: now });
    if (oneWord) this.short.push(now);
    return null;
  }

  // strike: counts toward the automatic mute (copies and junk do; just typing fast doesn't)
  block(message, now, strike) {
    if (strike) this.strikes.push(now);
    return { message, strike, mute: strike && this.strikes.length >= LIMITS.strikes.count };
  }
}
