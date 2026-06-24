import { serve } from "tradjs";

const port = Number(process.env.PORT ?? 5173);
const hotReload = process.argv.includes("--hot") || process.env.HOT_RELOAD === "1";

console.log(`Starting SolCraft with TradJS on http://localhost:${port}`);

await serve({
  port,
  defaultTitle: "SolCraft — TradJS + Three.js",
  hotReload,
} as any);
