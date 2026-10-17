/**
 * Two-stage validation:
 *   1. Structural (Zod): types, finite numbers, bounded parameters, counts.
 *   2. Semantic: unique IDs, references, out-of-bounds geometry, initial penetrations,
 *      unsupported placements. Major problems are NEVER silently repaired — we return
 *      an issue with an optional *proposed* fix the user can apply.
 */
import Matter from "matter-js";
import { z } from "zod";
import { SceneSpec, type SceneObject } from "./spec";
import { objectAABB } from "../geometry/math";
import { bodyForObject } from "../physics/compile";

export type Severity = "error" | "warning";

export interface ProposedFix {
  label: string;
  objectId: string;
  /** Absolute new position for the object. */
  set: { x?: number; y?: number };
}

export interface SceneIssue {
  severity: Severity;
  code:
    | "schema"
    | "duplicate-id"
    | "bad-reference"
    | "out-of-bounds"
    | "partly-outside"
    | "overlap"
    | "no-support"
    | "thin-static"
    | "fast-start"
    | "goal-target";
  message: string;
  objectIds: string[];
  fix?: ProposedFix;
}

export interface ValidationResult {
  ok: boolean;
  scene: SceneSpec | null;
  issues: SceneIssue[];
}

export function formatZodError(err: z.ZodError): string[] {
  return err.issues.slice(0, 8).map((i) => `${i.path.join(".") || "scene"}: ${i.message}`);
}

/** Structural + semantic validation of untrusted input (imports, AI output, storage). */
export function validateSceneInput(input: unknown): ValidationResult {
  const parsed = SceneSpec.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      scene: null,
      issues: formatZodError(parsed.error).map((m) => ({
        severity: "error" as const,
        code: "schema" as const,
        message: m,
        objectIds: [],
      })),
    };
  }
  const issues = semanticIssues(parsed.data);
  return { ok: !issues.some((i) => i.severity === "error"), scene: parsed.data, issues };
}

const MIN_STATIC_THICKNESS = 10;
const PENETRATION_TOLERANCE = 1.5;

export function semanticIssues(scene: SceneSpec): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const ids = new Map<string, number>();
  for (const o of scene.objects) ids.set(o.id, (ids.get(o.id) ?? 0) + 1);
  for (const [id, n] of ids) {
    if (n > 1) issues.push({ severity: "error", code: "duplicate-id", message: `ID "${id}" is used ${n} times.`, objectIds: [id] });
  }
  const byId = new Map(scene.objects.map((o) => [o.id, o]));

  for (const c of scene.constraints) {
    const refs = c.kind === "pin" ? [c.objectId] : [c.a, ...(c.b ? [c.b] : [])];
    for (const r of refs) {
      if (!byId.has(r)) {
        issues.push({ severity: "error", code: "bad-reference", message: `Constraint "${c.id}" points to missing object "${r}".`, objectIds: [] });
      }
    }
    if (c.kind === "rope" && !c.b && !c.anchor) {
      issues.push({ severity: "error", code: "bad-reference", message: `Rope "${c.id}" needs a second object or an anchor point.`, objectIds: [c.a] });
    }
  }

  if (scene.goal) {
    const t = byId.get(scene.goal.targetId);
    if (!t) {
      issues.push({ severity: "error", code: "bad-reference", message: `Goal refers to missing target "${scene.goal.targetId}".`, objectIds: [] });
    } else if (t.role !== "target") {
      issues.push({ severity: "error", code: "goal-target", message: `Goal target "${t.id}" is a ${t.role}, not a target zone.`, objectIds: [t.id] });
    }
    if (scene.goal.subjectId) {
      const s = byId.get(scene.goal.subjectId);
      if (!s) issues.push({ severity: "error", code: "bad-reference", message: `Goal subject "${scene.goal.subjectId}" does not exist.`, objectIds: [] });
      else if (s.isStatic) issues.push({ severity: "warning", code: "goal-target", message: `Goal subject "${s.id}" is static, so it can never move into the target.`, objectIds: [s.id] });
    }
  }

  const W = scene.world.width;
  const H = scene.world.height;
  for (const o of scene.objects) {
    const bb = objectAABB(o);
    if (o.x < 0 || o.x > W || o.y < 0 || o.y > H) {
      issues.push({
        severity: "error",
        code: "out-of-bounds",
        message: `${name(o)} has its centre outside the world (${Math.round(o.x)}, ${Math.round(o.y)}).`,
        objectIds: [o.id],
        fix: { label: "Move inside the world", objectId: o.id, set: { x: clampIn(o.x, 0, W), y: clampIn(o.y, 0, H) } },
      });
    } else if (!o.isStatic && (bb.minX < -1 || bb.maxX > W + 1 || bb.minY < -1 || bb.maxY > H + 1)) {
      issues.push({ severity: "warning", code: "partly-outside", message: `${name(o)} pokes outside the world edge.`, objectIds: [o.id] });
    }
    if (o.isStatic && o.role !== "target" && o.shape.kind === "rect" && Math.min(o.shape.width, o.shape.height) < MIN_STATIC_THICKNESS) {
      issues.push({
        severity: "warning",
        code: "thin-static",
        message: `${name(o)} is very thin (${Math.round(Math.min(o.shape.width, o.shape.height))} u). Fast objects may pass through; ${MIN_STATIC_THICKNESS} u or more is safer.`,
        objectIds: [o.id],
      });
    }
    const [vx, vy] = o.initialVelocity;
    if (!o.isStatic && Math.hypot(vx, vy) > 1600) {
      issues.push({ severity: "warning", code: "fast-start", message: `${name(o)} starts very fast; collisions may be missed.`, objectIds: [o.id] });
    }
  }

  issues.push(...penetrationIssues(scene));

  const dynamic = scene.objects.filter((o) => !o.isStatic && o.role !== "target");
  const solidsStatic = scene.objects.filter((o) => o.isStatic && o.role !== "target");
  if (dynamic.length && scene.gravity.scale > 0 && solidsStatic.length === 0) {
    issues.push({
      severity: "warning",
      code: "no-support",
      message: "Nothing static to land on — everything will fall out of the world. Add ground or a platform.",
      objectIds: dynamic.map((o) => o.id),
    });
  }
  return issues;
}

/**
 * Detect objects that start overlapping (excluding target sensors). For a dynamic object
 * resting into a static one we PROPOSE moving it out along the separation normal; we never
 * apply it automatically.
 */
function penetrationIssues(scene: SceneSpec): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const solids = scene.objects.filter((o) => o.role !== "target");
  const bodies = solids.map((o) => ({ o, b: bodyForObject(o) }));
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i]!;
      const B = bodies[j]!;
      if (A.o.isStatic && B.o.isStatic) continue;
      if (!Matter.Bounds.overlaps(A.b.bounds, B.b.bounds)) continue;
      const col = Matter.Collision.collides(A.b, B.b);
      if (!col || col.depth <= PENETRATION_TOLERANCE) continue;
      const mover = A.o.isStatic ? B : B.o.isStatic ? A : B;
      const other = mover === A ? B : A;
      // normal points from bodyA to bodyB in Matter; push the mover away from the other.
      let nx = col.normal.x;
      let ny = col.normal.y;
      const fromOther = { x: mover.b.position.x - other.b.position.x, y: mover.b.position.y - other.b.position.y };
      if (nx * fromOther.x + ny * fromOther.y < 0) {
        nx = -nx;
        ny = -ny;
      }
      const d = col.depth + 1;
      issues.push({
        severity: "warning",
        code: "overlap",
        message: `${name(mover.o)} starts ${Math.round(col.depth)} u inside ${name(other.o)}. It will be shoved apart at the first step.`,
        objectIds: [mover.o.id, other.o.id],
        fix: {
          label: `Nudge ${mover.o.label || mover.o.id} out by ${Math.ceil(d)} u`,
          objectId: mover.o.id,
          set: { x: round1(mover.o.x + nx * d), y: round1(mover.o.y + ny * d) },
        },
      });
    }
  }
  return issues;
}

function name(o: SceneObject): string {
  return o.label ? `${o.label} (${o.id})` : o.id;
}
function clampIn(v: number, lo: number, hi: number) {
  return Math.min(hi - 1, Math.max(lo + 1, v));
}
function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** Whether the scene can be brought to life (no errors). Warnings show as "Needs review". */
export function blockingIssues(issues: SceneIssue[]): SceneIssue[] {
  return issues.filter((i) => i.severity === "error");
}
