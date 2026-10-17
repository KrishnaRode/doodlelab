import { test, expect } from "@playwright/test";
import path from "node:path";
import { freshPage, hook } from "./helpers";

test("30 moving bodies stay interactive at laptop size", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await freshPage(page);
  await page.getByRole("button", { name: "File" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import scene JSON…" }).click();
  await (await chooser).setFiles(path.join(__dirname, "../fixtures/perf-30.json"));
  await expect(page.getByTestId("status-pill")).toContainText("33 objects");
  await page.getByTestId("bring-to-life").click();
  await expect(page.getByTestId("status-pill")).toContainText("Running");
  const fps = await page.evaluate(
    () =>
      new Promise<{ frames: number; worst: number }>((resolve) => {
        let frames = 0;
        let worst = 0;
        let last = performance.now();
        const start = last;
        const tick = (now: number) => {
          frames++;
          worst = Math.max(worst, now - last);
          last = now;
          if (now - start < 3000) requestAnimationFrame(tick);
          else resolve({ frames: frames / 3, worst });
        };
        requestAnimationFrame(tick);
      }),
  );
  const sim = (await hook.summary(page))!.simulatedSec;
  console.log(`[perf-browser] ${fps.frames.toFixed(1)} fps avg, worst frame ${fps.worst.toFixed(1)} ms, simulated ${sim.toFixed(2)} s`);
  await page.screenshot({ path: ".e2e-shots/50-perf-30.png" });
  expect(fps.frames).toBeGreaterThan(30);
});
