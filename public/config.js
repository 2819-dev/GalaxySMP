// ============================================================
//  GalaxySMP site settings: the ONE place to change server info.
// ============================================================
const config = {
  serverName: "GalaxySMP",

  // Java players type this in Multiplayer > Add Server.
  // Replace "your.server.ip" with the real address from the BisectHosting panel.
  javaAddress: "your.server.ip",
  javaPort: 25565,

  // Bedrock players (phone, tablet, console, Windows) need the address AND the port.
  bedrockAddress: "your.server.ip",
  bedrockPort: 19132,

  minecraftVersion: "1.21",

  // Shown on the home page. icon = one of: mountain, target, cloud, cube
  gameModes: [
    { name: "Survival", icon: "mountain", text: "A shared world for building, exploring and trading with other players." },
    { name: "Minigames", icon: "target", text: "Fast, competitive rounds with new matches starting throughout the day." },
    { name: "Skyblock", icon: "cloud", text: "Begin on a small island in the sky and expand it with limited resources." },
    { name: "Creative", icon: "cube", text: "Unlimited blocks and a private plot to build whatever you imagine." },
  ],
};

export default config;
