/**
 * SceneSpec → Matter.js world. The ONLY place scene data becomes physics.
 * Samples, user drawings, recognized photos and AI-applied patches all pass through here.
 */
import Matter from "matter-js";
import { resolveMaterial } from "../scene/materials";
import type { SceneObject, SceneSpec } from "../scene/spec";
import { DEG } from "../geometry/math";

/** Fixed simulation step: 1/120 s. Never varies — speed settings change step COUNT, not size. */
export const STEP_MS = 1000 / 120;
/** Matter.js reports velocity per 1/60 s "base delta". */
export const MATTER_BASE_MS = 1000 / 60;
/** Gravity of 1.0 (Earth preset) = 1000 u/s² with Matter's default gravity.scale. */
export const GRAVITY_SCALE = 0.001;
/** Velocity clamp (u/s) — bounds per-step travel to ~16 u so bodies cannot skip thin statics. */
export const MAX_SPEED = 1900;
/** Below this many u past the world edges a body counts as "left the world". */
export const WORLD_MARGIN = 400;

export function uPerSecToMatter(v: number): number {
  return (v * MATTER_BASE_MS) / 1000;
}
export function matterToUPerSec(v: number): number {
  return (v * 1000) / MATTER_BASE_MS;
}

export interface CompiledWorld {
  engine: Matter.Engine;
  bodies: Map<string, Matter.Body>;
  /** Matter body id → scene object id. */
  objectIdByBodyId: Map<number, string>;
  constraints: Matter.Constraint[];
}

export function bodyForObject(o: SceneObject): Matter.Body {
  const m = resolveMaterial(o.material, o.overrides);
  const opts: Matter.IChamferableBodyDefinition = {
    label: o.id,
    angle: o.rotationDeg * DEG,
    isStatic: o.isStatic || o.role === "target",
    isSensor: o.role === "target",
    restitution: m.restitution,
    friction: m.friction,
    frictionStatic: m.frictionStatic,
    frictionAir: m.frictionAir,
    density: m.density,
    slop: 0.04,
  };
  const body =
    o.shape.kind === "circle"
      ? Matter.Bodies.circle(o.x, o.y, o.shape.radius, opts, 40)
      : Matter.Bodies.rectangle(o.x, o.y, o.shape.width, o.shape.height, opts);
  // Bodies.* applies angle via Body.rotate around the centre; the position is already the centre.
  return body;
}

export function compileScene(spec: SceneSpec): CompiledWorld {
  const engine = Matter.Engine.create({
    enableSleeping: false,
    positionIterations: 8,
    velocityIterations: 6,
    constraintIterations: 3,
  });
  engine.gravity.x = 0;
  engine.gravity.y = spec.gravity.scale;
  engine.gravity.scale = GRAVITY_SCALE;

  const bodies = new Map<string, Matter.Body>();
  const objectIdByBodyId = new Map<number, string>();
  for (const o of spec.objects) {
    const b = bodyForObject(o);
    bodies.set(o.id, b);
    objectIdByBodyId.set(b.id, o.id);
  }
  Matter.Composite.add(engine.world, [...bodies.values()]);

  for (const o of spec.objects) {
    const [vx, vy] = o.initialVelocity;
    if (!o.isStatic && (vx !== 0 || vy !== 0)) {
      Matter.Body.setVelocity(bodies.get(o.id)!, { x: uPerSecToMatter(vx), y: uPerSecToMatter(vy) });
    }
  }

  const constraints: Matter.Constraint[] = [];
  for (const c of spec.constraints) {
    if (c.kind === "pin") {
      const b = bodies.get(c.objectId);
      if (!b) continue;
      const [ox, oy] = c.offset;
      const off = Matter.Vector.rotate({ x: ox, y: oy }, b.angle);
      constraints.push(
        Matter.Constraint.create({
          label: c.id,
          pointA: { x: b.position.x + off.x, y: b.position.y + off.y },
          bodyB: b,
          pointB: off,
          length: 0,
          stiffness: 1,
        }),
      );
    } else {
      const a = bodies.get(c.a);
      if (!a) continue;
      const b = c.b ? bodies.get(c.b) : undefined;
      const anchor = c.anchor ? { x: c.anchor[0], y: c.anchor[1] } : undefined;
      if (!b && !anchor) continue;
      const other = b ? b.position : anchor!;
      constraints.push(
        Matter.Constraint.create({
          label: c.id,
          bodyA: a,
          bodyB: b,
          pointB: b ? undefined : anchor,
          length: c.length ?? Matter.Vector.magnitude(Matter.Vector.sub(a.position, other)),
          stiffness: 0.9,
          damping: 0.02,
        }),
      );
    }
  }
  if (constraints.length) Matter.Composite.add(engine.world, constraints);

  return { engine, bodies, objectIdByBodyId, constraints };
}

/** Fully dispose a compiled world: listeners, bodies, constraints, caches. */
export function disposeWorld(w: CompiledWorld): void {
  Matter.Events.off(w.engine, undefined as unknown as string, undefined as unknown as () => void);
  Matter.Composite.clear(w.engine.world, false, true);
  Matter.Engine.clear(w.engine);
  w.bodies.clear();
  w.objectIdByBodyId.clear();
}
