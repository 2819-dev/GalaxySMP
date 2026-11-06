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
    { name: "Survival", icon: "mountain", text: "Gather, build and explore a shared world with friends." },
    { name: "Minigames", icon: "target", text: "Short rounds against other players. Jump in any time." },
    { name: "Skyblock", icon: "cloud", text: "Start on a small island in the sky and expand it." },
    { name: "Creative", icon: "cube", text: "Unlimited blocks and your own plot to build on." },
  ],
};

export default config;
