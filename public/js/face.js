// A little Minecraft-style face made from a player's name: shown until the game sends their real head.
const SKIN = ["#f2c49b", "#e0a679", "#c68857", "#a36a3f", "#7a4a2a", "#5a3620"];
const HAIR = ["#2b1a10", "#4a2e19", "#7a4b23", "#c58b3a", "#e8c66a", "#1d1d1d", "#8a3a2a", "#c7c7c7", "#3b5bd6", "#b04cd6"];
const EYES = ["#2f6fe0", "#3a8f3a", "#5a3a20", "#2b2b2b", "#7a3ad6", "#1f9e9e"];
export function faceSvg(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pick = (arr, k) => arr[(h >>> k) % arr.length];
  const skin = pick(SKIN, 0), hair = pick(HAIR, 4), eyes = pick(EYES, 9), long = (h >>> 13) & 1;
  const px = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let c = skin;
    if (y < 2 || (y === 2 && (x === 0 || x === 7)) || (long && y < 6 && (x === 0 || x === 7))) c = hair;
    if (y === 4 && (x === 1 || x === 5)) c = "#ffffff";
    if (y === 4 && (x === 2 || x === 6)) c = eyes;
    if (y === 6 && (x === 3 || x === 4)) c = "#8a4a3a";
    px.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`);
  }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">${px.join("")}</svg>`)}`;
}
