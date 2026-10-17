/**
 * The three demo scenes. They are plain SceneSpecs and go through exactly the same
 * validator → compiler → simulation path as a user's drawing. Their outcomes are verified
 * by headless runs in tests/unit/samples.test.ts and by the in-app readiness check.
 */
import { makeObject } from "./objects";
import { SCENE_VERSION, SceneSpec, DEFAULT_WORLD, type SceneObject } from "./spec";
import { DEG } from "../geometry/math";

export interface SampleInfo {
  id: "domino-chain" | "gravity-playground" | "bounce-to-target";
  title: string;
  blurb: string;
  tryThis: string;
  build: () => SceneSpec;
}

const sampleSource = { kind: "sample" as const, needsReview: false, reasons: [] };

export function ground(id = "ground-1", y = 585, width = 1000, x = 500): SceneObject {
  return makeObject({ id, role: "ground", x, y, shape: { kind: "rect", width, height: 30 }, label: "Ground", source: sampleSource });
}

/** A static ramp defined by its two end points (centre-line) and thickness. */
export function rampBetween(id: string, x1: number, y1: number, x2: number, y2: number, thickness = 16, label = "Ramp"): SceneObject {
  const len = Math.hypot(x2 - x1, y2 - y1);
  return makeObject({
    id,
    role: "ramp",
    label,
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
    rotationDeg: Math.atan2(y2 - y1, x2 - x1) / DEG,
    shape: { kind: "rect", width: len, height: thickness },
    source: sampleSource,
  });
}

/** Centre of a circle of radius r resting `gap` above a ramp's top surface at parameter x. */
export function onRamp(ramp: SceneObject, x: number, r: number, gap = 2): { x: number; y: number } {
  const a = ramp.rotationDeg * DEG;
  const h = ramp.shape.kind === "rect" ? ramp.shape.height : 0;
  const yLine = ramp.y + Math.tan(a) * (x - ramp.x);
  const nx = Math.sin(a);
  const ny = -Math.cos(a);
  const off = h / 2 + r + gap;
  return { x: x + nx * off, y: yLine + ny * off };
}

function base(id: string, title: string, objects: SceneObject[], extra: Partial<SceneSpec> = {}): SceneSpec {
  return SceneSpec.parse({
    schema: "doodlelab.scene",
    version: SCENE_VERSION,
    id,
    title,
    world: DEFAULT_WORLD,
    gravity: { preset: "earth", scale: 1 },
    objects,
    provenance: { kind: "sample", note: "Built-in sample scene" },
    ...extra,
  });
}

export function dominoChain(): SceneSpec {
  // Tuned by headless sweeps: the ball leaves the ramp ~100 u up and strikes the first domino
  // high, so the dominoes topple instead of sliding. All 8 fall by ≈4.7 s, and still do when
  // the ball's start is nudged ±8 u (see tests/unit/samples.test.ts).
  const ramp = rampBetween("ramp-1", 40, 250, 400, 470, 16);
  const ballPos = onRamp(ramp, 90, 24);
  const ball = makeObject({
    id: "ball-1",
    role: "ball",
    label: "Ball",
    ...ballPos,
    shape: { kind: "circle", radius: 24 },
    material: "heavy",
    source: sampleSource,
  });
  const dominoes: SceneObject[] = [];
  for (let i = 0; i < 8; i++) {
    const d = makeObject({
      id: `domino-${i + 1}`,
      role: "domino",
      label: `Domino ${i + 1}`,
      x: 470 + i * 46,
      y: 570 - 48,
      shape: { kind: "rect", width: 14, height: 96 },
      material: "wood",
      source: sampleSource,
    });
    d.overrides = { friction: 0.2 };
    dominoes.push(d);
  }
  return base("domino-chain", "Ramp → ball → domino chain", [ground(), ramp, ball, ...dominoes]);
}

export function gravityPlayground(): SceneSpec {
  const launched = makeObject({
    id: "ball-1",
    role: "ball",
    label: "Launched ball",
    x: 100,
    y: 546,
    shape: { kind: "circle", radius: 22 },
    material: "wood",
    source: sampleSource,
  });
  launched.initialVelocity = [150, -360];
  const heavy = makeObject({ id: "ball-2", role: "ball", label: "Heavy ball", x: 860, y: 150, shape: { kind: "circle", radius: 20 }, material: "heavy", source: sampleSource });
  const light = makeObject({ id: "ball-3", role: "ball", label: "Light ball", x: 940, y: 150, shape: { kind: "circle", radius: 20 }, material: "wood", source: sampleSource });
  light.overrides = { density: 0.0006 };
  const target = makeObject({ id: "target-1", role: "target", label: "High target", x: 430, y: 165, shape: { kind: "rect", width: 110, height: 110 }, source: sampleSource });
  const wall = makeObject({ id: "wall-1", role: "wall", label: "Wall", x: 990, y: 400, shape: { kind: "rect", width: 20, height: 340 }, source: sampleSource });
  return base("gravity-playground", "Gravity playground", [ground(), wall, launched, heavy, light, target], {
    goal: { kind: "reach-target", targetId: "target-1", subjectId: "ball-1", prompt: "Which gravity lets the launched ball reach the high target?" },
  });
}

export function bounceToTarget(): SceneSpec {
  const ball = makeObject({ id: "ball-1", role: "ball", label: "Ball", x: 190, y: 90, shape: { kind: "circle", radius: 20 }, material: "wood", source: sampleSource });
  const deflector = makeObject({
    id: "ramp-1",
    role: "ramp",
    label: "Deflector",
    x: 200,
    y: 400,
    rotationDeg: 26,
    shape: { kind: "rect", width: 200, height: 18 },
    material: "wood",
    source: sampleSource,
  });
  const shelf = makeObject({ id: "platform-1", role: "platform", label: "Shelf", x: 690, y: 470, shape: { kind: "rect", width: 220, height: 18 }, source: sampleSource });
  const backStop = makeObject({ id: "wall-1", role: "wall", label: "Back stop", x: 795, y: 400, shape: { kind: "rect", width: 16, height: 124 }, source: sampleSource });
  const left = makeObject({ id: "wall-2", role: "wall", label: "Left wall", x: 10, y: 300, shape: { kind: "rect", width: 20, height: 600 }, source: sampleSource });
  const right = makeObject({ id: "wall-3", role: "wall", label: "Right wall", x: 990, y: 300, shape: { kind: "rect", width: 20, height: 600 }, source: sampleSource });
  const target = makeObject({ id: "target-1", role: "target", label: "Target", x: 695, y: 420, shape: { kind: "rect", width: 180, height: 82 }, source: sampleSource });
  return base("bounce-to-target", "Bounce-to-target puzzle", [ground(), left, right, deflector, shelf, backStop, ball, target], {
    goal: { kind: "reach-target", targetId: "target-1", subjectId: "ball-1", prompt: "Can you make the ball land on the shelf?" },
  });
}

export const SAMPLES: SampleInfo[] = [
  {
    id: "domino-chain",
    title: "Domino chain",
    blurb: "A heavy ball rolls down a ramp into eight dominoes.",
    tryThis: "Try: make the ball bouncy, or raise the ramp.",
    build: dominoChain,
  },
  {
    id: "gravity-playground",
    title: "Gravity playground",
    blurb: "One launch, two drops. Compare Earth and Moon side by side.",
    tryThis: "Try: Compare → Earth vs Moon. Do the heavy and light balls land together?",
    build: gravityPlayground,
  },
  {
    id: "bounce-to-target",
    title: "Bounce to target",
    blurb: "A ball drops onto a deflector. Can it reach the shelf?",
    tryThis: "Try: make the ball bouncier — or let the target search tune it.",
    build: bounceToTarget,
  },
];
