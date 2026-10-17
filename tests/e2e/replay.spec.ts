import { test, expect } from "@playwright/test";
import { freshPage, hook } from "./helpers";

test("loading a sample switches to the select tool; replay scrubbing is view-only", async ({ page }) => {
  await freshPage(page);
  await page.getByTestId("sample-gravity-playground").click();
  await expect(page.getByTestId("tool-select")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("bring-to-life").click();
  await expect.poll(async () => (await hook.summary(page))?.simulatedSec ?? 0, { timeout: 20000 }).toBeGreaterThan(1.5);
  await page.getByTestId("play-pause").click();
  const before = await hook.snapshot(page);
  const slider = page.getByTestId("replay-slider");
  await expect(slider).toBeVisible();
  await slider.fill("0.5");
  await expect(page.getByTestId("status-pill")).toContainText("Replay view");
  await page.screenshot({ path: ".e2e-shots/17-replay.png" });
  // Live world untouched by scrubbing.
  expect(await hook.snapshot(page)).toEqual(before);
  await page.getByTestId("play-pause").click();
  await expect(page.getByTestId("status-pill")).toContainText("Running");
});
