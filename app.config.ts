/**
 * Product identity — single source of truth (mirrors project.md in the Sunday template).
 * run.sh reads `defaultModel` and `port` from here.
 */
export const appConfig = {
  name: "DoodleLab",
  tagline: "Draw it. Bring it to life.",
  description:
    "Turn simple drawings into editable, interactive 2D physics experiments. Native drawing, local photo recognition, deterministic Matter.js physics and a local Ollama copilot — no cloud, no API key.",
  /** Default text model for the copilot + explanations (used only if installed). */
  defaultModel: "qwen3:4b",
  /** Suggested optional vision model for photo role hints. */
  suggestedVisionModel: "qwen2.5vl:3b",
  port: 3015,
  series: "The Sunday Builds — Solving Real Problems using Free AI, every Sunday.",
  seriesShort: "The Sunday Builds #15",
  repoUrl: "https://github.com/KrishnaRode/doodlelab",
} as const;

export type AppConfig = typeof appConfig;
