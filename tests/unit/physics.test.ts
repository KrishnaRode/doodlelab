import { describe, expect, it } from "vitest";
import Matter from "matter-js";
import { Simulation, runHeadless } from "@/lib/physics/simulation";
import { MAX_SPEED, STEP_MS } from "@/lib/physics/compile";
import { gravityFromPreset, emptyScene } from "@/lib/scene/spec";
import { makeObject } from "@/lib/scene/objects";
import { ground } from "@/lib/scene/samples";
import { dropScene } from "./helpers";

const stepsFor = (sec: number) => Math.round((sec * 1000) / STEP_MS);

describe("simulation lifecycle", () => {
  it("reset restores authored positions, velocities, gravity and time", () => {
    const spec = dropScene(100);
    spec.objects[1]!.initialVelocity = [120, -50];
    const sim = new Simulation(spec);
    const initial = sim.snapshot().find((b) => b.id === "ball-1")!;
    for (let i = 0; i < stepsFor(1.5); i++) sim.step();
    sim.setGravity(gravityFromPreset("moon"));
    sim.startDrag("ball-1", sim.snapshot()[1]!.x, sim.snapshot()[1]!.y);
    for (let i = 0; i < 30; i++) sim.step();
    expect(sim.snapshot().find((b) => b.id === "ball-1")!.y).not.toBeCloseTo(initial.y, 0);
    sim.reset();
    const after = sim.snapshot().find((b) => b.id === "ball-1")!;
    expect(sim.time).toBe(0);
    expect(sim.currentGravity.scale).toBe(1);
    expect(sim.engine.gravity.y).toBe(1);
    expect(sim.dragging).toBeNull();
    expect(after.x).toBeCloseTo(initial.x, 6);
    expect(after.y).toBeCloseTo(initial.y, 6);
    expect(after.vx).toBeCloseTo(120, 3);
    expect(after.vy).toBeCloseTo(-50, 3);
    sim.destroy();
  });

  it("a reset run reproduces the original run (deterministic)", () => {
    const sim = new Simulation(dropScene(80, "bouncy"));
    for (let i = 0; i < stepsFor(2); i++) sim.step();
    const first = sim.snapshot();
    sim.reset();
    for (let i = 0; i < stepsFor(2); i++) sim.step();
    const second = sim.snapshot();
    first.forEach((b, i) => {
      expect(second[i]!.x).toBeCloseTo(b.x, 6);
      expect(second[i]!.y).toBeCloseTo(b.y, 6);
    });
    sim.destroy();
  });

  it("never stacks engines or listeners across many resets", () => {
    const sim = new Simulation(dropScene());
    const before = sim.engine;
    for (let i = 0; i < 25; i++) {
      for (let k = 0; k < 10; k++) sim.step();
      sim.reset();
      expect(sim.activeListeners).toBe(1);
    }
    expect(sim.engine).not.toBe(before);
    // The old engine was cleared: no bodies left in it.
    expect(Matter.Composite.allBodies(before.world).length).toBe(0);
    expect(Matter.Composite.allBodies(sim.engine.world).length).toBe(2);
    sim.destroy();
  });

  it("speed changes how many fixed steps run, not the outcome", () => {
    const a = new Simulation(dropScene(80, "bouncy"));
    const b = new Simulation(dropScene(80, "bouncy"));
    while (a.steps < 240) a.advance(16.7, 0.5);
    while (b.steps < 240) b.advance(16.7, 2);
    // Advance overshoots differ; bring both to exactly 240 steps by stepping a fresh pair.
    const c = new Simulation(dropScene(80, "bouncy"));
    for (let i = 0; i < Math.max(a.steps, b.steps); i++) c.step();
    const target = c.snapshot()[1]!;
    const pick = a.steps === c.steps ? a : b;
    expect(pick.snapshot()[1]!.y).toBeCloseTo(target.y, 6);
    [a, b, c].forEach((s) => s.destroy());
  });

  it("bounds the accumulator so a long frame cannot cause a spiral of death", () => {
    const sim = new Simulation(dropScene());
    const n = sim.advance(5000, 2);
    expect(n).toBeLessThanOrEqual(8);
    sim.destroy();
  });
});

describe("gravity", () => {
  const fallTime = (scale: number) => {
    const spec = dropScene(100);
    spec.gravity = { preset: "custom", scale };
    return runHeadless(spec, { durationSec: 8 }).bodies["ball-1"]!.firstImpactSec;
  };

  it("presets are relative to Earth", () => {
    expect(gravityFromPreset("earth").scale).toBe(1);
    expect(gravityFromPreset("moon").scale).toBeCloseTo(0.165, 3);
    expect(gravityFromPreset("zero").scale).toBe(0);
  });

  it("Moon fall time ≈ √(1/0.165) × Earth fall time (within 8%)", () => {
    const earth = fallTime(1)!;
    const moon = fallTime(0.165)!;
    expect(earth).toBeGreaterThan(0.5);
    expect(moon / earth).toBeGreaterThan(Math.sqrt(1 / 0.165) * 0.92);
    expect(moon / earth).toBeLessThan(Math.sqrt(1 / 0.165) * 1.08);
  });

  it("zero gravity leaves a resting ball where it is", () => {
    const spec = dropScene(100);
    spec.gravity = gravityFromPreset("zero");
    const r = runHeadless(spec, { durationSec: 3 });
    expect(r.bodies["ball-1"]!.maxDisplacement).toBeLessThan(0.5);
  });

  it("heavy and light balls dropped together land together (same gravity)", () => {
    const s = emptyScene();
    s.objects.push(ground());
    s.objects.push(makeObject({ id: "ball-1", role: "ball", x: 300, y: 100, shape: { kind: "circle", radius: 20 }, material: "heavy" }));
    const light = makeObject({ id: "ball-2", role: "ball", x: 700, y: 100, shape: { kind: "circle", radius: 20 }, material: "heavy" });
    light.overrides = { density: 0.0004 };
    s.objects.push(light);
    const r = runHeadless(s, { durationSec: 3 });
    expect(Math.abs(r.bodies["ball-1"]!.firstImpactSec! - r.bodies["ball-2"]!.firstImpactSec!)).toBeLessThanOrEqual(STEP_MS / 1000 + 1e-9);
  });
});

describe("comparison worlds are isolated", () => {
  it("two simulations from one spec never share bodies or state", () => {
    const spec = dropScene(100);
    const earth = new Simulation({ ...structuredClone(spec), gravity: gravityFromPreset("earth") });
    const moon = new Simulation({ ...structuredClone(spec), gravity: gravityFromPreset("moon") });
    for (let i = 0; i < 60; i++) earth.step();
    // Stepping Earth alone does not move the Moon world.
    expect(moon.time).toBe(0);
    expect(moon.snapshot()[1]!.y).toBe(100);
    for (let i = 0; i < 60; i++) moon.step();
    expect(earth.snapshot()[1]!.y).toBeGreaterThan(moon.snapshot()[1]!.y);
    // Dragging in one world does not affect the other.
    moon.startDrag("ball-1", 500, moon.snapshot()[1]!.y);
    expect(earth.dragging).toBeNull();
    // The authored spec handed in is untouched.
    expect(spec.gravity.scale).toBe(1);
    earth.destroy();
    moon.destroy();
  });
});

describe("collisions, targets and tunnelling", () => {
  it("detects target entry as a sensor (the ball passes through)", () => {
    const s = dropScene(100);
    s.objects.push(makeObject({ id: "target-1", role: "target", x: 500, y: 300, shape: { kind: "rect", width: 120, height: 60 } }));
    s.goal = { kind: "reach-target", targetId: "target-1", subjectId: "ball-1" };
    const r = runHeadless(s, { durationSec: 3 });
    expect(r.goal!.reached).toBe(true);
    expect(r.goal!.atSec!).toBeGreaterThan(0.3);
    expect(r.goal!.atSec!).toBeLessThan(0.8);
    expect(r.bodies["ball-1"]!.finalY).toBeGreaterThan(500); // fell through the sensor to the ground
    expect(r.events.filter((e) => e.type === "target-enter")).toHaveLength(1);
  });

  it("does not report a target that was never entered", () => {
    const s = dropScene(100);
    s.objects.push(makeObject({ id: "target-1", role: "target", x: 900, y: 300, shape: { kind: "rect", width: 60, height: 60 } }));
    s.goal = { kind: "reach-target", targetId: "target-1" };
    expect(runHeadless(s, { durationSec: 3 }).goal!.reached).toBe(false);
  });

  it("counts collisions from real contacts", () => {
    const r = runHeadless(dropScene(100, "bouncy"), { durationSec: 4 });
    expect(r.collisionCount).toBeGreaterThan(2);
    expect(r.bodies["ball-1"]!.collisions).toBe(r.collisionCount);
  });

  it("a ball launched at the speed limit does not tunnel through a 16 u ramp", () => {
    const s = emptyScene();
    s.objects.push(ground());
    s.objects.push(makeObject({ id: "ramp-1", role: "ramp", x: 500, y: 350, rotationDeg: 10, shape: { kind: "rect", width: 500, height: 16 } }));
    const ball = makeObject({ id: "ball-1", role: "ball", x: 500, y: 60, shape: { kind: "circle", radius: 10 }, material: "heavy" });
    ball.initialVelocity = [0, MAX_SPEED];
    s.objects.push(ball);
    const r = runHeadless(s, { durationSec: 1 });
    // If it had tunnelled it would end up on the ground (y ≈ 560); it should stay above the ramp.
    expect(r.bodies["ball-1"]!.finalY).toBeLessThan(400);
  });

  it("clamps velocities to the documented limit", () => {
    const s = dropScene(60);
    s.objects[1]!.initialVelocity = [0, 1600];
    s.gravity = { preset: "custom", scale: 2.5 };
    const r = runHeadless(s, { durationSec: 1 });
    expect(r.bodies["ball-1"]!.maxSpeed).toBeLessThanOrEqual(MAX_SPEED + 1);
  });
});

describe("telemetry honesty", () => {
  it("resting contacts at the start are not counted as collisions", () => {
    const s = emptyScene();
    s.objects.push(ground());
    s.objects.push(makeObject({ id: "domino-1", role: "domino", x: 500, y: 530, shape: { kind: "rect", width: 14, height: 80 } }));
    const r = runHeadless(s, { durationSec: 2 });
    expect(r.collisionCount).toBe(0);
    expect(r.bodies["domino-1"]!.firstImpactSec).toBeNull();
  });

  it("replay frames are view-only and match the recorded run", () => {
    const sim = new Simulation(dropScene(100, "bouncy"));
    for (let i = 0; i < 240; i++) sim.step();
    const live = sim.snapshot();
    const past = sim.frameAt(0.5)!;
    expect(past.find((b) => b.id === "ball-1")!.y).not.toBeCloseTo(live.find((b) => b.id === "ball-1")!.y, 0);
    // Reading the past did not change the present.
    expect(sim.snapshot()).toEqual(live);
    const start = sim.frameAt(0)!;
    expect(start.find((b) => b.id === "ball-1")!.y).toBeCloseTo(100, 3);
    sim.destroy();
  });
});
