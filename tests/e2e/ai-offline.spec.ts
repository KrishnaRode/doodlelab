import { test, expect } from "@playwright/test";
import { freshPage } from "./helpers";

/**
 * Simulates "Ollama not running" at the app's API boundary so the UI's handling is tested
 * regardless of the machine. (The server-side offline path itself is unit-tested.)
 */
test("missing Ollama: drawing and physics work, AI is clearly unavailable", async ({ page }) => {
  await page.route("**/api/ai/status", (r) => r.fulfill({ json: { reachable: false, url: "http://127.0.0.1:11434", version: null, models: [], defaults: { text: null, vision: null }, error: "Ollama is not running" } }));
  await page.route("**/api/ai/patch", (r) => r.fulfill({ status: 503, json: { ok: false, code: "ollama-offline", message: "Ollama is not running. Start it with: ollama serve" } }));
  await freshPage(page);
  await expect(page.getByTestId("readiness-button")).toContainText("Ollama offline");

  await page.getByTestId("sample-domino-chain").click();
  await page.getByTestId("bring-to-life").click();
  await expect(page.getByTestId("status-pill")).toContainText("Running");

  // Rule-based commands still work offline…
  await page.getByTestId("copilot-input").fill("make gravity weaker");
  await page.getByTestId("copilot-input").press("Enter");
  await expect(page.getByTestId("copilot-proposal")).toBeVisible();
  // …anything else says so honestly instead of pretending.
  await page.getByTestId("copilot-input").fill("paint the ramp like a rainbow");
  await page.getByTestId("copilot-input").press("Enter");
  await expect(page.getByTestId("copilot-info")).toContainText("Ollama is offline");

  // Explanations fall back to a clearly labelled rule-based summary.
  await page.getByTestId("tray-tab-explain").click();
  await page.getByTestId("explain-run").click();
  await expect(page.getByTestId("explain-rules")).toContainText("Rule-based summary (no AI model)");
  await expect(page.getByTestId("explain-ai")).toHaveCount(0);
  await expect(page.getByTestId("explain-panel")).toContainText("Ollama is offline");

  // Readiness check reports it as failed, not passed.
  await page.getByTestId("readiness-button").click();
  await expect(page.getByTestId("check-ollama")).toHaveAttribute("data-status", "fail", { timeout: 20000 });
  await expect(page.getByTestId("check-physics")).toHaveAttribute("data-status", "pass");
  await expect(page.getByTestId("check-samples")).toHaveAttribute("data-status", "pass");
  await page.screenshot({ path: ".e2e-shots/20-offline-readiness.png" });
});

test("model installed but missing from Ollama → clear error, scene untouched", async ({ page }) => {
  await page.route("**/api/ai/status", (r) => r.fulfill({ json: { reachable: true, url: "x", version: "t", models: [{ name: "qwen3:4b", sizeBytes: 1, parameterSize: "4B", family: "qwen3", capabilities: ["completion"], cloud: false }], defaults: { text: "qwen3:4b", vision: null } } }));
  await page.route("**/api/ai/patch", (r) => r.fulfill({ status: 404, json: { ok: false, code: "model-missing", message: "model 'qwen3:4b' not found" } }));
  await freshPage(page);
  await page.getByTestId("sample-domino-chain").click();
  await page.getByTestId("copilot-input").fill("paint the ramp like a rainbow");
  await page.getByTestId("copilot-input").press("Enter");
  await expect(page.getByTestId("copilot-info")).toContainText("ollama pull");
});
