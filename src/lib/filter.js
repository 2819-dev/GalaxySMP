// Message safety filter. Runs on the server for every chat message.
// A message that fails any check is NOT sent; the sender sees why.
import config from "../../public/config.js";

export const MAX_LENGTH = 500;
export const STAFF_MAX_LENGTH = 2000;  // staff (Moderators and up) can write longer messages
// user: a signed-in user (perms) or a hub user ({ perms, owner }). Longer messages are a rank permission.
export const maxLengthFor = (user) => (user && (user.owner || (Array.isArray(user.perms) && user.perms.includes("long_messages"))) ? STAFF_MAX_LENGTH : MAX_LENGTH);

const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "i", "€": "e" };

// Lowercase, strip accents and invisible characters, undo "l33t" spellings.
export function normalize(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ​-‏⁠﻿]/g, "")
    .toLowerCase()
    .replace(/[0134578@$!|€]/g, (c) => LEET[c] ?? c);
}

// "cats" -> /c+a+t+s+/ so stretched spellings ("caaats") still match,
// but "cat" never matches "cats".
function letterPattern(word) {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const c = word[i].replace(/[^a-z0-9]/g, "");
    if (c) out += `${c}+`;
  }
  return out;
}

// Builds matchers from the staff-editable word list (rows of { word, match }).
export function compileWordList(rows) {
  const wordRes = [];
  const containsRes = [];
  for (const { word, match } of rows) {
    const p = letterPattern(normalize(word));
    if (!p) continue;
    if (match === "contains") containsRes.push(new RegExp(p));
    else wordRes.push(new RegExp(`^${p}(?:s|es|ed|ing|er|ers)?$`));
  }
  return { wordRes, containsRes };
}

function hasProfanity(text, compiled) {
  // "!" and "|" count as an "i" (sh!t) only inside a word, not as punctuation at its ends (shit!!)
  const norm = normalize(String(text).replace(/[A-Za-z0-9@$!|€]+/g, (w) => w.replace(/^[!|]+|[!|]+$/g, " ")));
  const tokens = norm.split(/[^a-z]+/).filter(Boolean);
  // Also join runs of single letters: "f u c k" / "f.u.c.k" -> "fuck"
  const joined = [];
  let run = "";
  for (const t of tokens) {
    if (t.length === 1) run += t;
    else { if (run.length > 1) joined.push(run); run = ""; }
  }
  if (run.length > 1) joined.push(run);
  const candidates = tokens.concat(joined);
  if (candidates.some((t) => compiled.wordRes.some((re) => re.test(t)))) return true;
  const lettersOnly = norm.replace(/[^a-z]/g, "");
  return compiled.containsRes.some((re) => re.test(lettersOnly));
}

// Our own server address may be shared; everything else that looks like a link is blocked.
const OWN_ADDRESSES = [config.javaAddress, config.bedrockAddress]
  .filter((a) => a && a !== "your.server.ip")
  .map((a) => a.toLowerCase());

const TLDS = "com|net|org|gg|io|co|me|tv|xyz|ly|us|uk|ca|de|ru|info|biz|app|dev|link|club|site|online|store|shop|fun|live|pro|to|cc|be|gl|ws|top|vip|one|lol|wtf|sh|ai";
const LINK_RES = [
  /\b(?:https?|ftp):\/\//i,
  /\bwww\s*\./i,
  new RegExp(`\\b[a-z0-9-]{2,}\\s*(?:\\.|\\(\\s*dot\\s*\\)|\\[\\s*dot\\s*\\]|\\s+dot\\s+)\\s*(?:${TLDS})\\b`, "i"),
  /\bdiscord(?:app)?\s*(?:\.|dot)?\s*(?:gg|com\/invite)\b/i,
  /\b(?:bit\.ly|tinyurl|t\.me)\b/i,
];

const EMAIL_RES = [
  /[a-z0-9._%+-]+\s*(?:@|\(\s*at\s*\)|\[\s*at\s*\])\s*[a-z0-9-]+\s*(?:\.|\s+dot\s+|\(\s*dot\s*\))\s*[a-z]{2,}/i,
  /\b[a-z0-9._%+-]+\s+at\s+(?:gmail|yahoo|hotmail|outlook|icloud|aol|proton|protonmail|live|msn|mail)\b/i,
  new RegExp(`\\b[a-z0-9._%+-]+\\s+at\\s+[a-z0-9-]+\\s*(?:\\.|\\s+dot\\s+)\\s*(?:${TLDS})\\b`, "i"),
];
const PHONE_RES = [
  /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/,
  /\d{7,}/,
];
const IP_RE = /\b\d{1,3}(?:\s*\.\s*\d{1,3}){3}\b/;
const ADDRESS_RE = /\b\d{1,5}\s+(?:[a-z]+\s+){0,3}(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|court|ct|boulevard|blvd|way|place|pl|terrace|circle|cir|highway|hwy)\b/i;
const PERSONAL_RES = [
  /\bmy\s+(?:home\s+|house\s+)?address\b/i,
  /\bi\s+live\s+(?:at|on)\b/i,
  /\bmy\s+(?:school|teacher)\b/i,
  /\bi\s+go\s+to\s+[\w\s]{0,25}\bschool\b/i,
  /\bmy\s+(?:phone|cell|mobile|number|whatsapp)\b/i,
  /\b(?:call|text)\s+me\s+(?:at|on)\b/i,
  /\b(?:add|follow|dm)\s+me\s+on\b/i,
  /\bmy\s+(?:snap|insta|ig|tiktok|discord|socials?)\b/i,
  /\bmy\s+(?:real|full|last|first)\s+name\b/i,
  /\b(?:i\s*am|i'?m|im)\s+\d{1,2}\s*(?:years?\s*old|yrs?\s*old|yo|y\/o)\b/i,
  /\bmy\s+(?:age|birthday|password)\b/i,
];

function blocked(reason, message) {
  return { ok: false, reason, message };
}

// Links (with their path) that Admins may post; removed before the other checks so a link's
// numbers or letters aren't mistaken for a phone number or personal info.
const URL_TOKEN_RE = new RegExp(`(?:\\b(?:https?|ftp):\\/\\/|\\bwww\\.|\\b[a-z0-9-]{2,}\\.(?:${TLDS})\\b)[^\\s]*`, "gi");

// Returns { ok: true, text } or { ok: false, reason, message }.
// opts.allowLinks: Admins and owners may share links, IPs and numbers (email, bad words etc. are still checked).
export function checkMessage(raw, compiledWords, opts = {}) {
  let text = String(raw ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return blocked("empty", "Your message is empty.");
  const max = opts.maxLength || MAX_LENGTH;
  const maxLines = max > MAX_LENGTH ? 60 : 20;
  if (text.length > max) return blocked("length", `Messages can be at most ${max.toLocaleString("en-US")} characters.`);
  if (text.split("\n").length > maxLines) return blocked("spam", `Please keep messages to ${maxLines} lines or fewer.`);

  let scan = text.toLowerCase();
  for (const own of OWN_ADDRESSES) scan = scan.split(own).join(" ");
  if (EMAIL_RES.some((re) => re.test(scan))) return blocked("personal", "Email addresses can't be shared in chat.");
  if (opts.allowLinks) scan = scan.replace(URL_TOKEN_RE, " ");
  if (LINK_RES.some((re) => re.test(scan))) return blocked("link", "Links aren't allowed in chat.");
  // Admins (allowLinks) may also share server IPs, ports and other numbers (e.g. setup guides).
  if (!opts.allowLinks && IP_RE.test(scan)) return blocked("link", "IP addresses aren't allowed in chat.");
  if (!opts.allowLinks && PHONE_RES.some((re) => re.test(scan))) return blocked("personal", "Phone numbers and long numbers can't be shared in chat.");
  if (ADDRESS_RE.test(scan) || PERSONAL_RES.some((re) => re.test(scan))) {
    return blocked("personal", "For your safety, personal information can't be shared in chat.");
  }
  if (compiledWords && hasProfanity(text, compiledWords)) {
    return blocked("profanity", "Your message contains language that isn't allowed here.");
  }

  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 12 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.7) {
    return blocked("caps", "Please don't write in all capital letters.");
  }
  if (/(.)\1{14,}/su.test(text)) return blocked("spam", "Please don't repeat the same character over and over.");
  return { ok: true, text };
}
