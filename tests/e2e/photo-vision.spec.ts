import { test, expect } from "@playwright/test";
import { freshPage, hook } from "./helpers";

/**
 * Runs only when a real local vision model is installed. Validates the optional hint path end to
 * end: crops → local VLM → deterministic comparison → review UI → scene. Agreement is reported,
 * and the one behaviour we rely on (the scribble is flagged) is asserted.
 */
test("real vision model double-checks recognised photo shapes", async ({ page, request }) => {
  const status = await (await request.get("/api/ai/status")).json();
  test.skip(!status.reachable || !status.defaults.vision, "No local vision model installed");
  test.setTimeout(240_000);
  const fixtures = ["paper-ramp-ball", "paper-bullseye", "paper-dominoes"];
  let agree = 0;
  let total = 0;
  await freshPage(page);
  for (const f of fixtures) {
    await page.getByRole("button", { name: "Photo", exact: true }).click();
    await page.getByTestId(`fixture-${f}`).click();
    const t = Date.now();
    await page.getByTestId("recognize").click();
    await expect(page.locator('[data-stage="vision"]')).toHaveAttribute("data-status", "running", { timeout: 15_000 });
    await expect(page.getByTestId("review-pane")).toBeVisible({ timeout: 120_000 });
    const ms = Date.now() - t;
    const verdicts = await page.getByTestId("vision-hint").evaluateAll((els) => els.map((e) => ({ agrees: e.getAttribute("data-agrees") === "true", text: e.textContent ?? "" })));
    expect(verdicts.length).toBeGreaterThan(2);
    agree += verdicts.filter((v) => v.agrees).length;
    total += verdicts.length;
    console.log(`[vision] ${f}: ${verdicts.filter((v) => v.agrees).length}/${verdicts.length} agree, ${ms} ms incl. geometry —`, verdicts.filter((v) => !v.agrees).map((v) => v.text).join(" | "));
    // Geometry and roles are unchanged by the model.
    const roles = await page.locator('[data-testid="candidate"][data-included="true"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-role")));
    expect(roles.length).toBeGreaterThan(2);
    if (f === "paper-dominoes") {
      await expect(page.getByTestId("vision-hint").filter({ hasText: "text or a scribble" })).toHaveCount(1);
      await page.screenshot({ path: ".e2e-shots/35-vision-review.png" });
      await page.getByRole("button", { name: "Leave out" }).click();
      await page.getByTestId("use-shapes").click();
      const scene = await hook.scene(page);
      expect(scene.objects.map((o) => o.role).sort()).toEqual(["ball", "domino", "domino", "domino", "ground", "ramp"]);
    } else {
      await page.getByRole("button", { name: "Close" }).click();
    }
  }
  console.log(`[vision] total agreement ${agree}/${total}`);
});
