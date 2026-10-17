import { test, expect } from "@playwright/test";

test("./run.sh serves a working studio", async ({ page, request }) => {
  const health = await (await request.get("/api/health")).json();
  expect(health.ok).toBe(true);
  await page.goto("/");
  await page.getByTestId("sample-domino-chain").click();
  await page.getByTestId("bring-to-life").click();
  await expect(page.getByTestId("status-pill")).toContainText("Running");
});
