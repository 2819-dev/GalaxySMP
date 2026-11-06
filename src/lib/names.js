// Minecraft username rules for Java and Bedrock (Geyser + Floodgate) players.
//
// Java names: 3-16 letters, numbers or underscores.
// Bedrock names: Floodgate adds a prefix (usually ".") and replaces spaces with "_",
// so the Xbox gamertag "Cool Kid" appears in game as ".Cool_Kid".

const JAVA_RE = /^[A-Za-z0-9_]{3,16}$/;
const BEDROCK_RE = /^[A-Za-z0-9_]{1,20}$/;

// Strips the Floodgate prefix and makes spaces match Floodgate's underscores.
export function baseName(name) {
  return String(name || "").trim().replace(/^[^A-Za-z0-9_]+/, "").replace(/ /g, "_").toLowerCase();
}

// Checks what the player typed on the website. Returns the name to store, or an error.
export function parseRequestedName(raw, platform) {
  const name = String(raw || "").trim();
  if (platform === "bedrock") {
    const base = name.replace(/^[.*]+/, "").replace(/ /g, "_");
    if (!BEDROCK_RE.test(base)) {
      return { error: "Bedrock names can only use letters, numbers, spaces and underscores." };
    }
    return { name: "." + base, platform: "bedrock" };
  }
  if (platform !== "java") return { error: "Choose Java or Bedrock." };
  if (!JAVA_RE.test(name)) {
    return { error: "Java names are 3 to 16 letters, numbers or underscores." };
  }
  return { name, platform: "java" };
}

// Does the in-game player match the name the code was made for?
export function namesMatch(requested, inGame, isBedrock) {
  const requestedBedrock = String(requested).startsWith(".");
  return requestedBedrock === Boolean(isBedrock) && baseName(requested) === baseName(inGame);
}

// Is this player one of the owners listed in OWNER_USERNAMES?
export function isOwner(env, username, isBedrock) {
  const list = String(env.OWNER_USERNAMES || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.some((entry) => namesMatch(entry, username, isBedrock));
}
