import { test, expect } from "@playwright/test";
import { freshPage, hook } from "./helpers";

/** Runs only when a real local Ollama text model is available. */
test("real local model: broad request → validated proposal → apply; grounded explanation", async ({ page, request }) => {
  const status = await (await request.get("/api/ai/status")).json();
  test.skip(!status.reachable || !status.defaults.text, "No local Ollama text model available");
  test.setTimeout(240_000);
  await freshPage(page);
  await page.getByTestId("sample-domino-chain").click();
  await page.getByTestId("copilot-input").fill("give the ramp an icy coating so things slide");
  await page.getByTestId("copilot-input").press("Enter");
  await expect(page.getByTestId("copilot-thinking")).toBeVisible();
  // Physics controls stay responsive while the model thinks.
  await page.getByTestId("bring-to-life").click();
  await expect(page.getByTestId("status-pill")).toContainText("Running");
  await expect(page.getByTestId("copilot-proposal")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("copilot-proposal")).toContainText("Local AI");
  await page.screenshot({ path: ".e2e-shots/40-ai-proposal.png" });
  await page.getByTestId("copilot-apply").click();
  expect((await hook.scene(page)).objects.find((o) => o.id === "ramp-1")!.material).toBe("slippery");

  await page.getByTestId("play-pause").click();
  await page.waitForTimeout(3000);
  await page.getByTestId("tray-tab-explain").click();
  await page.getByTestId("explain-run").click();
  await expect(page.getByTestId("explain-ai")).toBeVisible({ timeout: 150_000 });
  await expect(page.getByTestId("explain-rules")).toBeVisible();
  await page.screenshot({ path: ".e2e-shots/41-ai-explain.png" });
});
