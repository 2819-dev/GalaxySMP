// Season Pass unlocks for the website: themes (colors of galaxymc.us), profile titles and profile frames.
// Used by the website code and the server, so names and tiers always agree.
// Free players get some; the fanciest ones are on the Galaxy Pro+ track.

export const THEMES = [
  { id: "ocean", name: "Ocean", colors: ["#06202e", "#1aa3c9", "#4febfd"] },
  { id: "forest", name: "Forest", colors: ["#07200f", "#2fbf71", "#b6f36a"] },
  { id: "sunset", name: "Sunset", colors: ["#2a0d14", "#ff7a3d", "#ff4f8b"] },
  { id: "cherry", name: "Cherry Blossom", colors: ["#2a0c1f", "#ff6fae", "#ffc2dc"] },
  { id: "aurora", name: "Aurora", colors: ["#061a1f", "#3fe0a8", "#a46bff"], animated: true },
  { id: "royal", name: "Royal Gold", colors: ["#1a1030", "#f5c542", "#8a5cff"], animated: true },
];

export const FRAMES = [
  { id: "iron", name: "Iron frame" },
  { id: "gold", name: "Gold frame" },
  { id: "diamond", name: "Diamond frame" },
  { id: "emerald", name: "Emerald frame" },
  { id: "nebula", name: "Nebula frame", animated: true },
];

// Titles show under your name. "{season}" titles are made per season (e.g. s1_veteran = "Season 1 Veteran").
export const TITLES = [
  { id: "explorer", name: "Explorer" },
  { id: "adventurer", name: "Adventurer" },
  { id: "star_chaser", name: "Star Chaser" },
  { id: "legend", name: "Galaxy Legend" },
  { id: "veteran", name: "Season {season} Veteran", perSeason: true },
  { id: "champion", name: "Season {season} Champion", perSeason: true },
];

// Which tier unlocks what, on each track (tiers 1-30). Money and crate keys stay on every tier too.
export const SEASON_UNLOCKS = {
  free: { 3: ["title", "explorer"], 6: ["theme", "ocean"], 10: ["title", "adventurer"], 14: ["frame", "iron"],
    18: ["theme", "forest"], 22: ["frame", "gold"], 25: ["title", "veteran"] },
  pro: { 4: ["theme", "sunset"], 6: ["frame", "diamond"], 8: ["title", "star_chaser"], 12: ["theme", "cherry"],
    15: ["frame", "emerald"], 16: ["title", "legend"], 20: ["theme", "aurora"], 24: ["frame", "nebula"],
    28: ["title", "champion"], 30: ["theme", "royal"] },
};

const LISTS = { theme: THEMES, title: TITLES, frame: FRAMES };

// The stored id for an unlock in a season (per-season titles get the season number in front).
export function unlockId(kind, id, season) {
  const def = LISTS[kind]?.find((x) => x.id === id);
  return def?.perSeason ? `s${season}_${id}` : id;
}

// { kind, id, name } for a stored id, or null.
export function lookInfo(kind, item) {
  if (!item) return null;
  const m = kind === "title" ? /^s(\d+)_(\w+)$/.exec(item) : null;
  const def = LISTS[kind]?.find((x) => x.id === (m ? m[2] : item));
  if (!def || Boolean(m) !== Boolean(def.perSeason)) return null;
  return { kind, id: item, name: def.name.replace("{season}", m ? m[1] : ""), animated: Boolean(def.animated), colors: def.colors || null };
}

// The unlock a season tier gives on a track: { kind, id, name } or null.
export function tierUnlock(track, tier, season) {
  const u = SEASON_UNLOCKS[track]?.[tier];
  return u ? lookInfo(u[0], unlockId(u[0], u[1], season)) : null;
}

export const KIND_NAMES = { theme: "Website theme", title: "Profile title", frame: "Profile frame" };
