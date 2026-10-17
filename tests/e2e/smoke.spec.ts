import { test, expect } from "@playwright/test";

test("studio renders without console errors (desktop + laptop)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByTestId("status-pill")).toContainText("Empty");
  await page.screenshot({ path: ".e2e-shots/01-empty-1440.png" });
  await page.getByTestId("sample-domino-chain").click();
  await expect(page.getByTestId("status-pill")).toContainText("Ready");
  await page.screenshot({ path: ".e2e-shots/02-sample-edit-1440.png" });
  await page.getByTestId("bring-to-life").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: ".e2e-shots/03-transition-1440.png" });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: ".e2e-shots/04-live-1440.png" });
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: ".e2e-shots/05-live-1280.png" });
  expect(errors).toEqual([]);
});
