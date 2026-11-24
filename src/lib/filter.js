// Message safety filter. Runs on the server for every chat message.
// A message that fails any check is NOT sent; the sender sees why.
import config from "../../public/config.js";

export const MAX_LENGTH = 500;
export const STAFF_MAX_LENGTH = 2000;  // staff (Moderators and up) can write longer messages
// user: a signed-in user (perms) or a hub user ({ perms, owner }). Longer messages are a rank permission.
export const maxLengthFor = (user) => (user && (user.owner || (Array.isArray(user.perms) && user.perms.includes("long_messages"))) ? STAFF_MAX_LENGTH : MAX_LENGTH);

const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "i", "€": "e" };
// Letters from other alphabets that look like English ones (Cyrillic, Greek, IPA), so "fսck" or "аss" are caught.
const LOOKALIKE = {
  "а": "a", "в": "b", "с": "c", "ԁ": "d", "е": "e", "ё": "e", "һ": "h", "н": "h", "і": "i", "ї": "i", "ј": "j", "к": "k", "м": "m",
  "о": "o", "р": "p", "ԛ": "q", "г": "r", "ѕ": "s", "т": "t", "ц": "u", "ս": "u", "у": "y", "х": "x", "ү": "y", "ʏ": "y", "ɡ": "g", "ɑ": "a",
  "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ω": "w", "ς": "s",
  "ı": "i", "ł": "l", "ø": "o", "đ": "d", "ß": "ss", "æ": "ae", "œ": "oe",
};
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKE).join("")}]`, "g");

// Lowercase, strip accents and invisible characters, turn fancy fonts (𝓯𝓾), circled/full-width letters,
// letter emoji (🇦 🅰) and look-alike letters into plain ones, undo "l33t" spellings.
export function normalize(text) {
  return String(text)
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, (c) => String.fromCharCode(97 + c.codePointAt(0) - 0x1F1E6))        // 🇦 -> a
    .replace(/[\u{1F170}-\u{1F189}]/gu, (c) => String.fromCharCode(97 + c.codePointAt(0) - 0x1F170))        // 🅰 -> a
    .replace(/[\u{1F130}-\u{1F149}]/gu, (c) => String.fromCharCode(97 + c.codePointAt(0) - 0x1F130))        // 🄰 -> a
    .normalize("NFKD")                                                                                    // 𝓯 ⓕ ｆ -> f
    .replace(/[\u0300-\u036f\u200b-\u200f\u2060\ufeff\u00ad\u034f\u180e]/g, "")
    .toLowerCase()
    .replace(LOOKALIKE_RE, (c) => LOOKALIKE[c])
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
// match: "word" (on its own), "contains" (even inside other words), "safe" (never blocked, e.g. "scunthorpe").
// If the word filter is turned off (Control Panel or /chatfilter), the list is empty: bad words aren't checked,
// but links, personal info and spam still are.
export function compileWordList(rows) {
  const wordRes = [];
  const containsRes = [];
  const safe = new Set();
  const plain = [];
  for (const { word, match } of rows) {
    const n = normalize(word).replace(/[^a-z]/g, "");
    if (match === "safe") { if (n) safe.add(n); continue; }
    const p = letterPattern(n);
    if (!p) continue;
    if (match === "contains") containsRes.push({ word, re: new RegExp(p) });
    else { wordRes.push({ word, re: new RegExp(`^${p}(?:s|es|ed|ing|er|ers|y)?$`) }); plain.push({ word, n }); }
  }
  return { wordRes, containsRes, safe, plain };
}

// Which listed word a message uses (or null). Catches: l33t (sh1t), stretched (shiiit), spaced or dotted
// (f u c k, f.u.c.k), symbols or emoji inside a word (f*ck, f_ck, fu🍑ck), fancy fonts and look-alike letters.
export function findProfanity(text, compiled) {
  if (!compiled || (!compiled.wordRes.length && !compiled.containsRes.length)) return null;
  // "!" and "|" count as an "i" (sh!t) only inside a word, not as punctuation at its ends (shit!!)
  const norm = normalize(String(text).replace(/[^\s]+/g, (w) => w.replace(/^[!|]+|[!|]+$/g, " ")));
  const safe = compiled.safe || new Set();
  const tokens = norm.split(/[^a-z]+/).filter((t) => t && !safe.has(t));
  const candidates = [...tokens];
  // runs of single letters: "f u c k" / "f.u.c.k" -> "fuck"
  let run = "";
  for (const t of tokens) {
    if (t.length === 1) run += t;
    else { if (run.length > 1) candidates.push(run); run = ""; }
  }
  if (run.length > 1) candidates.push(run);
  // a word with symbols or emoji inside: "fu🍑ck", "f-u-c-k" -> "fuck"; and "f*ck", "sh#t" with the symbol as a hidden letter
  const wild = [];
  for (const chunk of norm.split(/\s+/)) {
    const letters = chunk.replace(/[^a-z]/g, "");
    if (letters.length >= 2 && letters !== chunk.replace(/^[^a-z]+|[^a-z]+$/g, "") && !safe.has(letters)) candidates.push(letters);
    const inner = chunk.replace(/^[^a-z*#_%^~?]+|[^a-z*#_%^~?]+$/g, "");
    if (/[a-z]/.test(inner) && /[*#_%^~?]/.test(inner) && /^[a-z*#_%^~?]{3,}$/.test(inner) && (inner.match(/[a-z]/g) || []).length >= 2) {
      wild.push(new RegExp(`^${inner.replace(/[*#_%^~?]+/g, "[a-z]{1,2}")}$`));
    }
  }
  for (const t of candidates) {
    const hit = compiled.wordRes.find((w) => w.re.test(t));
    if (hit) return hit.word;
  }
  for (const re of wild) {
    const hit = (compiled.plain || []).find((w) => re.test(w.n));
    if (hit) return hit.word;
  }
  const lettersOnly = tokens.join("");
  const hit = compiled.containsRes.find((w) => w.re.test(lettersOnly));
  return hit ? hit.word : null;
}

// Our own server address may be shared; everything else that looks like a link is blocked.
const OWN_ADDRESSES = [config.javaAddress, config.bedrockAddress, "galaxymc.us", "galaxymc dot us", "galaxy mc dot us", "galaxymc (dot) us"]
  .filter((a) => a && a !== "your.server.ip")
  .map((a) => a.toLowerCase());

const TLDS = "com|net|org|gg|io|co|me|tv|xyz|ly|us|uk|ca|de|ru|info|biz|app|dev|link|club|site|online|store|shop|fun|live|pro|to|cc|be|gl|ws|top|vip|one|lol|wtf|sh|ai";
const LINK_RES = [
  /\b(?:https?|ftp):\/\//i,
  /\bwww\s*\./i,
  // name.com (a real dot right before the ending, so normal sentences like "help. me" or "buildings. One" aren't links)
  new RegExp(`\\b[a-z0-9-]{2,} ?\\.(?:${TLDS})\\b`, "i"),
  // spelled-out tricks: name (dot) com, name [dot] com, name dot com
  new RegExp(`\\b[a-z0-9-]{2,}\\s*(?:\\(\\s*dot\\s*\\)|\\[\\s*dot\\s*\\]|\\s+dot\\s+)\\s*(?:${TLDS})\\b`, "i"),
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
// Only when real details follow, so normal sentences ("hello from my phone", "my school starts at 8",
// "I forgot my password") are fine.
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const PERSONAL_RES = [
  /\bmy\s+(?:home\s+|house\s+|real\s+)?address\s+(?:is|=|:)/i,
  /\bi\s+live\s+(?:at|on)\s+\d/i,
  /\bmy\s+school(?:'s|\s+is)\s+(?:called|named)\b/i,
  /\bi\s+(?:go\s+to|attend)\s+(?!(?:a|an|the|my|high|middle|elementary|primary|secondary|public|private|summer|boarding|online|night|sunday|religious|catholic|school)\b)[a-z]+(?:\s+[a-z]+){0,3}\s+(?:school|academy|elementary|middle|high)\b/i,
  /\bmy\s+(?:phone|cell|mobile|whatsapp)(?:\s+(?:number|no\.?|#))?\s+(?:is|=|:)/i,
  /\bmy\s+number\s+(?:is|=|:)/i,
  /\b(?:call|text)\s+me\s+(?:at|on)\b/i,
  /\b(?:add|follow|dm)\s+me\s+on\s+(?:snap|snapchat|insta|instagram|ig|tiktok|discord|whatsapp|telegram|kik|facebook|fb|twitter|x)\b/i,
  /\bmy\s+(?:snap|snapchat|insta|instagram|ig|tiktok|discord|whatsapp|telegram|kik|socials?)\s*(?:is|=|:|@)/i,
  /\bmy\s+(?:real|full|last)\s+name\s+(?:is|=|:)/i,
  /\b(?:i\s*am|i'?m|im)\s+\d{1,2}\s*(?:years?\s*old|yrs?\s*old|yo|y\/o)\b/i,
  /\bmy\s+age\s+is\s+\d/i,
  new RegExp(`\\bmy\\s+(?:birthday|bday|b-day)\\s+is\\s+(?:on\\s+)?(?:the\\s+)?(?:\\d|${MONTHS})`, "i"),
  /\bmy\s+(?:password|pass|pw)\s+(?:is|=|:)/i,
];

function blocked(reason, message, detail) {
  return { ok: false, reason, message, detail };
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
  // opts.allowUrls: everyone may post web links in this channel (e.g. #OT | Advertising); IPs and numbers are still checked
  if (opts.allowLinks || opts.allowUrls) scan = scan.replace(URL_TOKEN_RE, " ");
  if (LINK_RES.some((re) => re.test(scan))) return blocked("link", "Links aren't allowed in chat.");
  // Admins (allowLinks) may also share server IPs, ports and other numbers (e.g. setup guides).
  if (!opts.allowLinks && IP_RE.test(scan)) return blocked("link", "IP addresses aren't allowed in chat.");
  if (!opts.allowLinks && PHONE_RES.some((re) => re.test(scan))) return blocked("personal", "Phone numbers and long numbers can't be shared in chat.");
  const personal = [ADDRESS_RE, ...PERSONAL_RES].map((re) => scan.match(re)).find(Boolean);
  if (personal) return blocked("personal", "For your safety, personal information can't be shared in chat.", `Looks like personal info: "${personal[0]}"`);
  const bad = compiledWords ? findProfanity(text, compiledWords) : null;
  if (bad) return blocked("profanity", "Your message contains language that isn't allowed here.", `Word on the list: "${bad}"`);

  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 12 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.7) {
    return blocked("caps", "Please don't write in all capital letters.");
  }
  if (/(.)\1{14,}/su.test(text)) return blocked("spam", "Please don't repeat the same character over and over.");
  return { ok: true, text };
}
