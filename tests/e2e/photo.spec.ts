import { test, expect } from "@playwright/test";
import path from "node:path";
import { freshPage, hook } from "./helpers";

test("upload recognition: synthetic paper photo → reviewed shapes → real physics", async ({ page }) => {
  await freshPage(page);
  await page.getByRole("button", { name: "Photo", exact: true }).click();
  await page.getByTestId("upload-input").setInputFiles(path.join(__dirname, "../../public/fixtures/paper-ramp-ball.jpg"));
  await expect(page.getByTestId("recognize")).toBeVisible();
  await page.screenshot({ path: ".e2e-shots/30-crop.png" });
  await page.getByTestId("recognize").click();
  await expect(page.getByTestId("review-pane")).toBeVisible({ timeout: 20000 });
  const included = page.locator('[data-testid="candidate"][data-included="true"]');
  await expect(included).toHaveCount(4);
  const roles = await included.evaluateAll((els) => els.map((e) => e.getAttribute("data-role")).sort());
  expect(roles).toEqual(["ball", "block", "ground", "ramp"]);
  await page.screenshot({ path: ".e2e-shots/31-review.png" });
  await page.getByTestId("use-shapes").click();
  const scene = await hook.scene(page);
  expect(scene.objects.map((o) => o.role).sort()).toEqual(["ball", "block", "ground", "ramp"]);
  await page.screenshot({ path: ".e2e-shots/32-photo-scene.png" });
  await expect(page.getByTestId("status-pill")).toContainText("Ready");
  await page.getByTestId("bring-to-life").click();
  await expect.poll(async () => (await hook.summary(page))?.simulatedSec ?? 0, { timeout: 30000 }).toBeGreaterThan(2);
  await page.screenshot({ path: ".e2e-shots/33-photo-live.png" });
  const ball = (await hook.snapshot(page))!.find((b) => b.id === "ball-1")!;
  const start = scene.objects.find((o) => o.id === "ball-1")!;
  expect(ball.y).toBeGreaterThan(start.y + 50);
});

for (const f of ["paper-bullseye", "paper-dominoes"]) {
  test(`fixture ${f} recognises its expected shapes`, async ({ page }) => {
    const manifest = (await import("../../public/fixtures/fixtures.json", { with: { type: "json" } })).default as unknown as { fixtures: Array<{ id: string; expect: Record<string, number> }> };
    const exp = manifest.fixtures.find((x) => x.id === f)!.expect;
    await freshPage(page);
    await page.getByRole("button", { name: "Photo", exact: true }).click();
    await page.getByTestId(`fixture-${f}`).click();
    await page.getByTestId("recognize").click();
    await expect(page.getByTestId("review-pane")).toBeVisible({ timeout: 20000 });
    const roles = await page.locator('[data-testid="candidate"][data-included="true"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-role")));
    const counts: Record<string, number> = {};
    for (const r of roles) counts[r!] = (counts[r!] ?? 0) + 1;
    for (const [role, n] of Object.entries(exp)) expect(counts[role] ?? 0, role).toBe(n);
    // The vision stage is honest about being skipped when no vision model is installed.
    await expect(page.locator('[data-stage="vision"]')).toHaveCount(0);
    await page.screenshot({ path: `.e2e-shots/34-${f}.png` });
  });
}
