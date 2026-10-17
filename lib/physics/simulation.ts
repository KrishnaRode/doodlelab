/**
 * A single isolated simulation of one authored SceneSpec.
 *
 * - Fixed 1/120 s step with a bounded accumulator; `speed` changes how many fixed steps run
 *   per real second, never the step size, so outcomes are identical at every speed.
 * - Lives entirely outside React. The UI reads `snapshot()` each animation frame.
 * - `reset()` disposes the Matter engine (listeners included) and recompiles from the
 *   authored spec, restoring positions, velocities, constraints and gravity exactly.
 */
import Matter from "matter-js";
import type { Gravity, SceneSpec } from "../scene/spec";
import {
  MAX_SPEED,
  STEP_MS,
  WORLD_MARGIN,
  compileScene,
  disposeWorld,
  matterToUPerSec,
  uPerSecToMatter,
  type CompiledWorld,
} from "./compile";
import { TelemetryRecorder, type RunSummary } from "./telemetry";

export const MAX_STEPS_PER_ADVANCE = 8;
export const SPEEDS = [0.25, 0.5, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];

const TRAIL_EVERY = 2; // steps
const TRAIL_MAX = 180;
const RECORD_EVERY = 2; // steps → 60 frames per simulated second
export const RECORD_MAX_FRAMES = 60 * 60;

export interface BodyState {
  id: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
}

export interface Frame {
  t: number;
  /** [x, y, angle] per recorded body in `recordOrder`. */
  data: Float32Array;
}

export class Simulation {
  private authored: SceneSpec;
  private world!: CompiledWorld;
  private telemetry!: TelemetryRecorder;
  private accumulator = 0;
  private stepCount = 0;
  private gravity: Gravity;
  private drag: { id: string; constraint: Matter.Constraint } | null = null;
  private dynamicIds: string[] = [];
  private targetIds: string[] = [];
  private readonly trails = new Map<string, Array<[number, number]>>();
  private frames: Frame[] = [];
  readonly recordOrder: string[];
  private listenerCount = 0;
  private leftWorldIds = new Set<string>();
  /** Listeners notified once when a target is entered (UI flashes, compare finish times). */
  onTargetEnter: ((targetId: string, bodyId: string, t: number) => void) | null = null;

  constructor(spec: SceneSpec) {
    this.authored = structuredClone(spec);
    this.gravity = { ...spec.gravity };
    this.recordOrder = spec.objects.filter((o) => !o.isStatic && o.role !== "target").map((o) => o.id);
    this.build();
  }

  /** Simulated seconds since the authored start. */
  get time(): number {
    return (this.stepCount * STEP_MS) / 1000;
  }
  get steps(): number {
    return this.stepCount;
  }
  get spec(): SceneSpec {
    return this.authored;
  }
  get currentGravity(): Gravity {
    return this.gravity;
  }
  /** Exposed for tests: how many collision listeners are attached to the live engine. */
  get activeListeners(): number {
    return this.listenerCount;
  }
  get engine(): Matter.Engine {
    return this.world.engine;
  }

  private build(): void {
    this.world = compileScene(this.authored);
    this.gravity = { ...this.authored.gravity };
    this.telemetry = new TelemetryRecorder(this.authored);
    this.accumulator = 0;
    this.stepCount = 0;
    this.drag = null;
    this.trails.clear();
    this.frames = [];
    this.leftWorldIds = new Set();
    this.dynamicIds = this.authored.objects.filter((o) => !o.isStatic && o.role !== "target").map((o) => o.id);
    this.targetIds = this.authored.objects.filter((o) => o.role === "target").map((o) => o.id);
    this.listenerCount = 0;
    Matter.Events.on(this.world.engine, "collisionStart", this.onCollisionStart);
    this.listenerCount++;
    this.record();
  }

  private onCollisionStart = (ev: Matter.IEventCollision<Matter.Engine>) => {
    const t = this.time;
    for (const pair of ev.pairs) {
      if (pair.isSensor || pair.bodyA.isSensor || pair.bodyB.isSensor) continue;
      const a = this.world.objectIdByBodyId.get(pair.bodyA.id);
      const b = this.world.objectIdByBodyId.get(pair.bodyB.id);
      if (!a || !b) continue;
      const rv = Matter.Vector.sub(pair.bodyA.velocity, pair.bodyB.velocity);
      this.telemetry.collision(t, a, b, matterToUPerSec(Matter.Vector.magnitude(rv)));
    }
  };

  /** Replace the authored scene (e.g. after an edit) and rebuild from it. */
  load(spec: SceneSpec): void {
    this.authored = structuredClone(spec);
    (this as { recordOrder: string[] }).recordOrder = spec.objects
      .filter((o) => !o.isStatic && o.role !== "target")
      .map((o) => o.id);
    this.reset();
  }

  reset(): void {
    disposeWorld(this.world);
    this.listenerCount = 0;
    this.build();
  }

  destroy(): void {
    disposeWorld(this.world);
    this.listenerCount = 0;
    this.onTargetEnter = null;
  }

  /** Advance by real elapsed time. Returns number of fixed steps taken. */
  advance(realMs: number, speed: number): number {
    const bounded = Math.min(Math.max(realMs, 0), 100);
    this.accumulator += bounded * speed;
    const maxAcc = STEP_MS * MAX_STEPS_PER_ADVANCE;
    if (this.accumulator > maxAcc) this.accumulator = maxAcc;
    let n = 0;
    while (this.accumulator >= STEP_MS && n < MAX_STEPS_PER_ADVANCE) {
      this.step();
      this.accumulator -= STEP_MS;
      n++;
    }
    return n;
  }

  /** Exactly one fixed step (also used by the "step" control while paused). */
  step(): void {
    Matter.Engine.update(this.world.engine, STEP_MS);
    this.stepCount++;
    const t = this.time;
    const W = this.authored.world.width;
    const H = this.authored.world.height;
    const maxV = uPerSecToMatter(MAX_SPEED);
    for (const id of this.dynamicIds) {
      const b = this.world.bodies.get(id);
      if (!b) continue;
      // getSpeed/getVelocity are normalized to Matter's 1/60 s base delta.
      const sp = Matter.Body.getSpeed(b);
      if (sp > maxV) Matter.Body.setVelocity(b, Matter.Vector.mult(Matter.Body.getVelocity(b), maxV / sp));
      const speed = matterToUPerSec(Matter.Body.getSpeed(b));
      this.telemetry.sampleBody(id, t, b.position.x, b.position.y, (b.angle * 180) / Math.PI, speed);
      if (
        !this.leftWorldIds.has(id) &&
        (b.position.y > H + WORLD_MARGIN || b.position.y < -WORLD_MARGIN * 2 || b.position.x < -WORLD_MARGIN || b.position.x > W + WORLD_MARGIN)
      ) {
        this.leftWorldIds.add(id);
        this.telemetry.leftWorld(t, id);
        // Park it far away as a static body so it stops costing CPU and cannot come back.
        Matter.Body.setStatic(b, true);
      }
      if (this.stepCount % TRAIL_EVERY === 0) {
        let tr = this.trails.get(id);
        if (!tr) this.trails.set(id, (tr = []));
        tr.push([b.position.x, b.position.y]);
        if (tr.length > TRAIL_MAX) tr.shift();
      }
    }
    for (const tid of this.targetIds) {
      const tb = this.world.bodies.get(tid);
      if (!tb) continue;
      const inside = new Set<string>();
      for (const id of this.dynamicIds) {
        if (this.leftWorldIds.has(id)) continue;
        const b = this.world.bodies.get(id);
        if (!b) continue;
        if (!Matter.Bounds.overlaps(tb.bounds, b.bounds)) continue;
        if (Matter.Collision.collides(tb, b)) inside.add(id);
      }
      for (const id of this.telemetry.targetOccupancy(t, tid, inside)) this.onTargetEnter?.(tid, id, t);
    }
    if (this.stepCount % RECORD_EVERY === 0) this.record();
  }

  private record(): void {
    if (this.frames.length >= RECORD_MAX_FRAMES) return;
    const data = new Float32Array(this.recordOrder.length * 3);
    this.recordOrder.forEach((id, i) => {
      const b = this.world.bodies.get(id);
      if (!b) return;
      data[i * 3] = b.position.x;
      data[i * 3 + 1] = b.position.y;
      data[i * 3 + 2] = b.angle;
    });
    this.frames.push({ t: this.time, data });
  }

  /** Change gravity on the LIVE world (also recorded as an event so explanations know). */
  setGravity(g: Gravity): void {
    this.gravity = { ...g };
    this.world.engine.gravity.y = g.scale;
    if (this.stepCount > 0) this.telemetry.gravityChange(this.time, `gravity set to ${g.scale}× Earth`);
  }

  snapshot(): BodyState[] {
    const out: BodyState[] = [];
    for (const o of this.authored.objects) {
      const b = this.world.bodies.get(o.id);
      if (!b) continue;
      const v = Matter.Body.getVelocity(b);
      out.push({
        id: o.id,
        x: b.position.x,
        y: b.position.y,
        angle: b.angle,
        vx: matterToUPerSec(v.x),
        vy: matterToUPerSec(v.y),
      });
    }
    return out;
  }

  trail(id: string): ReadonlyArray<[number, number]> {
    return this.trails.get(id) ?? [];
  }

  get recordedFrames(): ReadonlyArray<Frame> {
    return this.frames;
  }

  /** Recorded poses nearest to simulated time `t` (view-only replay; never alters the world). */
  frameAt(t: number): BodyState[] | null {
    const f = this.frames;
    if (!f.length) return null;
    let lo = 0,
      hi = f.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (f[mid]!.t < t) lo = mid + 1;
      else hi = mid;
    }
    const frame = lo > 0 && Math.abs(f[lo - 1]!.t - t) < Math.abs(f[lo]!.t - t) ? f[lo - 1]! : f[lo]!;
    const out: BodyState[] = [];
    for (const o of this.authored.objects) {
      const i = this.recordOrder.indexOf(o.id);
      if (i < 0) out.push({ id: o.id, x: o.x, y: o.y, angle: (o.rotationDeg * Math.PI) / 180, vx: 0, vy: 0 });
      else out.push({ id: o.id, x: frame.data[i * 3]!, y: frame.data[i * 3 + 1]!, angle: frame.data[i * 3 + 2]!, vx: 0, vy: 0 });
    }
    return out;
  }

  summary(): RunSummary {
    return this.telemetry.summary(this.time, this.stepCount, this.gravity);
  }

  // ── Hand interaction ──────────────────────────────────────────────────────

  bodyAt(x: number, y: number): string | null {
    const candidates = this.dynamicIds
      .filter((id) => !this.leftWorldIds.has(id))
      .map((id) => this.world.bodies.get(id)!)
      .filter(Boolean);
    const hit = Matter.Query.point(candidates, { x, y })[0];
    return hit ? (this.world.objectIdByBodyId.get(hit.id) ?? null) : null;
  }

  startDrag(id: string, x: number, y: number): boolean {
    const b = this.world.bodies.get(id);
    if (!b || b.isStatic) return false;
    this.endDrag();
    const local = Matter.Vector.rotate(Matter.Vector.sub({ x, y }, b.position), -b.angle);
    const constraint = Matter.Constraint.create({
      label: "hand",
      pointA: { x, y },
      bodyB: b,
      pointB: Matter.Vector.rotate(local, b.angle),
      length: 0.01,
      stiffness: 0.18,
      damping: 0.1,
    });
    Matter.Composite.add(this.world.engine.world, constraint);
    this.drag = { id, constraint };
    this.telemetry.drag(this.time, id);
    return true;
  }

  moveDrag(x: number, y: number): void {
    if (this.drag) this.drag.constraint.pointA = { x, y };
  }

  endDrag(): void {
    if (!this.drag) return;
    Matter.Composite.remove(this.world.engine.world, this.drag.constraint);
    this.drag = null;
  }

  get dragging(): string | null {
    return this.drag?.id ?? null;
  }
}

/** Run a spec headlessly for its observation window (or a given duration). */
export function runHeadless(
  spec: SceneSpec,
  opts: { durationSec?: number; stopOnGoal?: boolean } = {},
): RunSummary {
  const sim = new Simulation(spec);
  const duration = opts.durationSec ?? spec.simulation.durationSec;
  const maxSteps = Math.ceil((duration * 1000) / STEP_MS);
  let goalHit = false;
  if (opts.stopOnGoal && spec.goal) {
    const g = spec.goal;
    sim.onTargetEnter = (tid, bid) => {
      if (tid === g.targetId && (!g.subjectId || g.subjectId === bid)) goalHit = true;
    };
  }
  for (let i = 0; i < maxSteps && !goalHit; i++) sim.step();
  const s = sim.summary();
  sim.destroy();
  return s;
}
