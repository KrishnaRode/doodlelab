import { ROLE_DEFAULTS } from "./materials";
import { SceneObject, type Point, type Role, type SceneSpec, type Shape } from "./spec";
import { round2, seededRandom } from "../geometry/math";

/** Next free id like `ball-3` for a role, unique within the scene. */
export function nextId(scene: Pick<SceneSpec, "objects">, role: Role, taken: Set<string> = new Set()): string {
  const used = new Set([...scene.objects.map((o) => o.id), ...taken]);
  for (let i = 1; i < 10_000; i++) {
    const id = `${role}-${i}`;
    if (!used.has(id)) return id;
  }
  throw new Error("could not allocate an object id");
}

export interface MakeObjectInput {
  id: string;
  role: Role;
  x: number;
  y: number;
  shape: Shape;
  rotationDeg?: number;
  isStatic?: boolean;
  material?: SceneObject["material"];
  sketch?: Point[][];
  source?: SceneObject["source"];
  label?: string;
}

export function makeObject(input: MakeObjectInput): SceneObject {
  const d = ROLE_DEFAULTS[input.role];
  return SceneObject.parse({
    id: input.id,
    role: input.role,
    label: input.label,
    shape: input.shape,
    x: round2(input.x),
    y: round2(input.y),
    rotationDeg: round2(input.rotationDeg ?? 0),
    isStatic: input.role === "target" ? true : (input.isStatic ?? d.isStatic),
    material: input.material ?? d.material,
    sketch: input.sketch ?? wobbleOutline(input.shape, input.id),
    source: input.source ?? { kind: "tool", needsReview: false, reasons: [] },
  });
}

/**
 * A deterministic "hand-drawn" outline for tool-made shapes, so every object keeps a
 * doodle identity that travels with the body during simulation.
 */
export function wobbleOutline(shape: Shape, seed: string): Point[][] {
  const rnd = seededRandom(seed);
  const pts: Point[] = [];
  if (shape.kind === "circle") {
    const n = 36;
    const r = shape.radius;
    const amp = Math.min(2.2, r * 0.06);
    const start = rnd() * Math.PI * 2;
    for (let i = 0; i <= n + 2; i++) {
      const t = start + (i / n) * Math.PI * 2;
      const rr = r + (rnd() - 0.5) * amp * 2 + (i > n ? 1.2 : 0);
      pts.push([round2(Math.cos(t) * rr), round2(Math.sin(t) * rr)]);
    }
    return [pts];
  }
  const hw = shape.width / 2;
  const hh = shape.height / 2;
  const amp = Math.min(1.8, Math.min(hw, hh) * 0.2);
  const corners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
    [-hw, -hh],
  ];
  for (let c = 0; c < 4; c++) {
    const [ax, ay] = corners[c]!;
    const [bx, by] = corners[c + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(2, Math.min(10, Math.round(len / 30)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      pts.push([
        round2(ax + (bx - ax) * t + (rnd() - 0.5) * amp),
        round2(ay + (by - ay) * t + (rnd() - 0.5) * amp),
      ]);
    }
  }
  pts.push([round2(-hw + (rnd() - 0.5) * amp), round2(-hh + 1 + (rnd() - 0.5) * amp)]);
  return [pts];
}

/** Default sizes for click-to-place tools (scene units). */
export const TOOL_DEFAULT_SHAPES: Record<Role, Shape> = {
  ball: { kind: "circle", radius: 22 },
  block: { kind: "rect", width: 60, height: 60 },
  domino: { kind: "rect", width: 14, height: 76 },
  ramp: { kind: "rect", width: 280, height: 16 },
  ground: { kind: "rect", width: 1000, height: 30 },
  platform: { kind: "rect", width: 200, height: 18 },
  wall: { kind: "rect", width: 20, height: 200 },
  target: { kind: "rect", width: 80, height: 80 },
};

export function describeObject(o: SceneObject): string {
  const name = o.label || o.id;
  const g =
    o.shape.kind === "circle"
      ? `r=${Math.round(o.shape.radius)}`
      : `${Math.round(o.shape.width)}×${Math.round(o.shape.height)}`;
  return `${name} (${o.role}, ${g}, ${o.isStatic ? "static" : "dynamic"}, ${o.material})`;
}
