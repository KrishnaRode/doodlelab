import { describe, expect, it } from "vitest";
import { Simulation } from "@/lib/physics/simulation";
import { perfScene } from "@/scripts/perf-scene";
import { semanticIssues } from "@/lib/scene/validate";

describe("performance budget (measured, reported)", () => {
  it("30 dynamic bodies: a fixed step costs far less than its 8.3 ms budget", () => {
    const spec = perfScene();
    expect(spec.objects.filter((o) => !o.isStatic).length).toBe(30);
    expect(semanticIssues(spec).filter((i) => i.severity === "error")).toEqual([]);
    const sim = new Simulation(spec);
    for (let i = 0; i < 120; i++) sim.step(); // warm-up
    const t = performance.now();
    const N = 1200;
    for (let i = 0; i < N; i++) sim.step();
    const perStep = (performance.now() - t) / N;
    console.log(`[perf] 30 bodies: ${perStep.toFixed(3)} ms per fixed step (budget ${(1000 / 120).toFixed(2)} ms)`);
    expect(perStep).toBeLessThan(2);
    sim.destroy();
  });
});

describe("perf scene is a valid scene", () => {
  it("has no overlap warnings", () => {
    expect(semanticIssues(perfScene()).filter((i) => i.code === "overlap")).toEqual([]);
  });
});
