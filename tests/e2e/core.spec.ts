import { test, expect } from "@playwright/test";
import { freshPage, hook, stagePoint } from "./helpers";

test.beforeEach(async ({ page }) => {
  await freshPage(page);
});

test("draw → review → play → pause → reset", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.getByTestId("status-pill")).toContainText("Empty");
  // Dismiss the welcome card so the paper is free.
  await page.getByRole("button", { name: "Hide and start drawing" }).click();

  // Ground via the tool (click = full width), a ramp by dragging, a freehand circle with the pencil.
  await page.getByTestId("tool-ground").click();
  const p = await stagePoint(page, 500, 570);
  await page.mouse.click(p.x, p.y);
  await page.getByTestId("tool-ramp").click();
  const a = await stagePoint(page, 120, 260);
  const b = await stagePoint(page, 520, 520);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.getByTestId("tool-pencil").click();
  const c = await stagePoint(page, 202, 150);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 44; i++) {
    const t = (i / 40) * Math.PI * 2;
    const q = await stagePoint(page, 170 + Math.cos(t) * 32, 150 + Math.sin(t) * 32);
    await page.mouse.move(q.x, q.y);
  }
  await page.mouse.up();

  // A wobbly open curve can't be guessed → needs review.
  const s0 = await stagePoint(page, 700, 200);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    const q = await stagePoint(page, 700 + i * 6, 200 + Math.sin(i / 3) * 40);
    await page.mouse.move(q.x, q.y);
  }
  await page.mouse.up();
  await expect(page.getByTestId("status-pill")).toContainText("Needs review");
  await page.screenshot({ path: ".e2e-shots/10-needs-review.png" });

  const scene = await hook.scene(page);
  expect(scene.objects.map((o) => o.role).sort()).toEqual(["ball", "ground", "ramp"]);

  // Bring to Life is gated until the review is resolved.
  await page.getByTestId("bring-to-life").click();
  await expect(page.getByTestId("review-panel")).toBeVisible();
  await expect(page.getByTestId("pending-stroke")).toBeVisible();
  await page.getByTestId("accept-all").click();
  await expect(page.getByTestId("status-pill")).toContainText("Ready");

  await page.getByTestId("bring-to-life").click();
  await expect(page.getByTestId("status-pill")).toContainText("Running", { timeout: 5000 });
  // Wait on simulated time (robust when the machine is busy), then pause.
  await expect.poll(async () => (await hook.summary(page))?.simulatedSec ?? 0, { timeout: 20000 }).toBeGreaterThan(1.2);
  await page.getByTestId("play-pause").click();
  await expect(page.getByTestId("status-pill")).toContainText("Paused");
  const moved = (await hook.snapshot(page))!.find((b) => b.id === "ball-1")!;
  const authored = scene.objects.find((o) => o.id === "ball-1")!;
  expect(Math.hypot(moved.x - authored.x, moved.y - authored.y)).toBeGreaterThan(30);

  // Step while paused advances exactly one fixed step.
  const stepsBefore = (await hook.summary(page))!.steps;
  await page.getByTestId("step").click();
  const stepsAfter = (await hook.summary(page))!.steps;
  expect(stepsAfter - stepsBefore).toBe(1); // exactly one fixed 1/120 s step

  await page.getByTestId("reset").click();
  await expect(page.getByTestId("status-pill")).toContainText("Paused · 0.00 s");
  const back = (await hook.snapshot(page))!.find((b) => b.id === "ball-1")!;
  expect(back.x).toBeCloseTo(authored.x, 3);
  expect(back.y).toBeCloseTo(authored.y, 3);
  expect(Math.hypot(back.vx, back.vy)).toBeLessThan(0.001);

  // Switching tray tabs and inspector sections never resets the world.
  await page.getByTestId("play-pause").click();
  await expect.poll(async () => (await hook.summary(page))?.simulatedSec ?? 0, { timeout: 20000 }).toBeGreaterThan(0.3);
  await page.getByTestId("tray-tab-observe").click();
  await page.getByTestId("tray-tab-events").click();
  await page.getByTestId("tray-tab-explain").click();
  const after = (await hook.summary(page))!.simulatedSec;
  expect(after).toBeGreaterThan(0.3);
  await page.screenshot({ path: ".e2e-shots/11-drawn-live.png" });
  expect(errors).toEqual([]);
});

test("sample chain reaction topples the dominoes", async ({ page }) => {
  await page.getByTestId("sample-domino-chain").click();
  await page.getByTestId("bring-to-life").click();
  // Wait on simulated time, not wall-clock: headless browsers may run fewer frames.
  await expect.poll(async () => (await hook.summary(page))?.simulatedSec ?? 0, { timeout: 30000 }).toBeGreaterThan(6);
  const bodies = (await hook.snapshot(page))!;
  const tipped = bodies.filter((b) => b.id.startsWith("domino") && Math.abs(Math.sin(b.angle)) > Math.sin(Math.PI / 4)).length;
  expect(tipped).toBeGreaterThanOrEqual(7);
  await page.getByTestId("tray-tab-observe").click();
  await expect(page.getByTestId("telemetry-table")).toBeVisible();
  await page.screenshot({ path: ".e2e-shots/12-chain-observe.png" });
});

test("gravity comparison runs isolated Earth and Moon worlds", async ({ page }) => {
  await page.getByTestId("sample-gravity-playground").click();
  await page.getByRole("button", { name: "2×" }).click();
  await page.getByTestId("open-compare").click();
  await expect(page.getByTestId("compare-view")).toBeVisible();
  await expect(page.getByTestId("compare-canvas-earth")).toBeVisible();
  await expect(page.getByTestId("compare-canvas-moon")).toBeVisible();
  await page.getByTestId("compare-play").click();
  await page.waitForTimeout(3200);
  await page.screenshot({ path: ".e2e-shots/13-compare-mid.png" });
  const rows = page.getByTestId("compare-table").locator("tbody tr");
  await expect(rows.nth(1)).toContainText("yes", { timeout: 10000 });
  await page.waitForTimeout(3500);
  await expect(rows.nth(0)).toContainText("no");
  await page.screenshot({ path: ".e2e-shots/14-compare-done.png" });
  // The authored scene was not changed by comparing.
  expect((await hook.scene(page)).gravity.preset).toBe("earth");
});

test("copilot proposes, applies and undoes a change", async ({ page }) => {
  await page.getByTestId("sample-bounce-to-target").click();
  await page.getByTestId("copilot-input").fill("make the ball bouncier");
  await page.getByTestId("copilot-input").press("Enter");
  await expect(page.getByTestId("copilot-proposal")).toContainText("bounce (restitution)");
  await expect(page.getByTestId("copilot-proposal")).toContainText("Rules");
  // Not applied until Apply.
  expect((await hook.scene(page)).objects.find((o) => o.id === "ball-1")!.overrides.restitution).toBeUndefined();
  await page.screenshot({ path: ".e2e-shots/15-proposal.png" });
  await page.getByTestId("copilot-apply").click();
  await expect(page.getByTestId("copilot-applied")).toBeVisible();
  expect((await hook.scene(page)).objects.find((o) => o.id === "ball-1")!.overrides.restitution).toBe(0.5);
  await page.getByTestId("copilot-undo").click();
  expect((await hook.scene(page)).objects.find((o) => o.id === "ball-1")!.overrides.restitution).toBeUndefined();
});

test("target search returns only a tested proposal", async ({ page }) => {
  await page.getByTestId("sample-bounce-to-target").click();
  await page.getByTestId("tray-tab-challenge").click();
  await page.getByTestId("search-run").click();
  await expect(page.getByTestId("search-best")).toContainText("Best tested", { timeout: 20000 });
  await page.screenshot({ path: ".e2e-shots/16-challenge.png" });
  await page.getByTestId("search-apply").click();
  await page.getByTestId("bring-to-life").click();
  await expect.poll(async () => (await hook.summary(page))?.goal?.reached ?? false, { timeout: 15000 }).toBe(true);
});
