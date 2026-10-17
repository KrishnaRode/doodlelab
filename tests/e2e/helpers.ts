import type { Page } from "@playwright/test";

export interface Body { id: string; x: number; y: number; angle: number; vx: number; vy: number }

export const hook = {
  scene: (p: Page) => p.evaluate(() => (window as unknown as { __doodlelab: { scene: () => { objects: Array<{ id: string; role: string; x: number; y: number; material: string; overrides: Record<string, number> }>; gravity: { preset: string; scale: number } } } }).__doodlelab.scene()),
  snapshot: (p: Page) => p.evaluate(() => (window as unknown as { __doodlelab: { snapshot: () => Body[] | null } }).__doodlelab.snapshot()),
  summary: (p: Page) => p.evaluate(() => (window as unknown as { __doodlelab: { summary: () => { simulatedSec: number; steps: number; goal: { reached: boolean } | null; collisionCount: number } | null } }).__doodlelab.summary()),
};

/** World → page coordinates for the stage canvas (reads the same letterbox the app uses). */
export async function stagePoint(page: Page, wx: number, wy: number, world = { width: 1000, height: 600 }) {
  const box = (await page.getByTestId("stage").boundingBox())!;
  const pad = 12, top = 34, bottom = 52;
  const scale = Math.min((box.width - pad * 2) / world.width, (box.height - pad * 2 - top - bottom) / world.height);
  const ox = (box.width - world.width * scale) / 2;
  const oy = pad + top + (box.height - pad * 2 - top - bottom - world.height * scale) / 2;
  return { x: box.x + ox + wx * scale, y: box.y + oy + wy * scale };
}

export async function freshPage(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}
