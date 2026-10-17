/**
 * ScenePatch — the ONLY way the copilot (deterministic parser or local LLM) can propose
 * scene changes. Allowlisted operations on exact object IDs, schema-validated, previewed as
 * before/after, applied only when the user clicks Apply (and undoable).
 */
import { z } from "zod";
import { MATERIAL_PRESETS, resolveMaterial } from "./materials";
import { wobbleOutline } from "./objects";
import {
  GRAVITY_PRESETS,
  MATERIALS,
  ObjectId,
  PARAM_LIMITS,
  ROLES,
  SceneObject,
  SceneSpec,
  type Gravity,
} from "./spec";
import { formatZodError, semanticIssues, type SceneIssue } from "./validate";

export const NUMERIC_FIELDS = ["x", "y", "rotationDeg", "radius", "width", "height", "restitution", "friction", "density"] as const;

const SetNumber = z.object({
  op: z.literal("set"),
  objectId: ObjectId,
  field: z.enum(NUMERIC_FIELDS),
  value: z.number().finite(),
});
const SetMaterial = z.object({ op: z.literal("setMaterial"), objectId: ObjectId, material: z.enum(MATERIALS) });
const SetRole = z.object({ op: z.literal("setRole"), objectId: ObjectId, role: z.enum(ROLES) });
const SetStatic = z.object({ op: z.literal("setStatic"), objectId: ObjectId, isStatic: z.boolean() });
const Move = z.object({ op: z.literal("move"), objectId: ObjectId, dx: z.number().finite().min(-1000).max(1000), dy: z.number().finite().min(-1000).max(1000) });
const Rotate = z.object({ op: z.literal("rotate"), objectId: ObjectId, dDeg: z.number().finite().min(-180).max(180) });
const Add = z.object({ op: z.literal("add"), object: SceneObject });
const Remove = z.object({ op: z.literal("remove"), objectId: ObjectId });
const SetGravity = z.object({
  op: z.literal("gravity"),
  preset: z.enum(["earth", "moon", "zero", "custom"]),
  scale: z.number().finite().min(PARAM_LIMITS.gravityScale.min).max(PARAM_LIMITS.gravityScale.max).optional(),
});

export const PatchOp = z.discriminatedUnion("op", [SetNumber, SetMaterial, SetRole, SetStatic, Move, Rotate, Add, Remove, SetGravity]);
export type PatchOp = z.infer<typeof PatchOp>;

export const ScenePatch = z.object({
  summary: z.string().min(1).max(200),
  ops: z.array(PatchOp).min(1).max(24),
});
export type ScenePatch = z.infer<typeof ScenePatch>;

export interface Change {
  target: string;
  what: string;
  before: string;
  after: string;
}

export interface PatchResult {
  ok: boolean;
  scene: SceneSpec | null;
  changes: Change[];
  errors: string[];
  warnings: SceneIssue[];
  touched: string[];
}

const FIELD_LABEL: Record<(typeof NUMERIC_FIELDS)[number], string> = {
  x: "x position",
  y: "y position",
  rotationDeg: "rotation (°)",
  radius: "radius",
  width: "width",
  height: "height",
  restitution: "bounce (restitution)",
  friction: "friction",
  density: "density",
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : (Math.round(n * 1000) / 1000).toString();
}

/** Apply a patch to a COPY of the scene. Never mutates the input. */
export function applyPatch(scene: SceneSpec, patchInput: unknown): PatchResult {
  const parsed = ScenePatch.safeParse(patchInput);
  if (!parsed.success) return fail(formatZodError(parsed.error));
  const patch = parsed.data;
  const next: SceneSpec = structuredClone(scene);
  const changes: Change[] = [];
  const errors: string[] = [];
  const touched = new Set<string>();
  const find = (id: string) => next.objects.find((o) => o.id === id);

  for (const op of patch.ops) {
    if (op.op === "gravity") {
      const before: Gravity = { ...next.gravity };
      const scale = op.preset === "custom" ? op.scale : GRAVITY_PRESETS[op.preset].scale;
      if (scale === undefined) {
        errors.push("Custom gravity needs a scale.");
        continue;
      }
      next.gravity = { preset: op.preset, scale };
      changes.push({ target: "world", what: "gravity", before: `${fmt(before.scale)}× Earth`, after: `${fmt(scale)}× Earth` });
      continue;
    }
    if (op.op === "add") {
      if (find(op.object.id)) {
        errors.push(`An object with ID "${op.object.id}" already exists.`);
        continue;
      }
      const obj = structuredClone(op.object);
      if (obj.sketch.length === 0) obj.sketch = wobbleOutline(obj.shape, obj.id);
      if (obj.role === "target") obj.isStatic = true;
      obj.source = { kind: "copilot", needsReview: false, reasons: [] };
      next.objects.push(obj);
      touched.add(obj.id);
      changes.push({ target: obj.id, what: "add", before: "—", after: `${obj.role} at (${Math.round(obj.x)}, ${Math.round(obj.y)})` });
      continue;
    }
    const o = find(op.objectId);
    if (!o) {
      errors.push(`No object with ID "${op.objectId}".`);
      continue;
    }
    touched.add(o.id);
    switch (op.op) {
      case "remove":
        next.objects = next.objects.filter((x) => x.id !== o.id);
        next.constraints = next.constraints.filter((c) => (c.kind === "pin" ? c.objectId !== o.id : c.a !== o.id && c.b !== o.id));
        if (next.goal && (next.goal.targetId === o.id || next.goal.subjectId === o.id)) next.goal = undefined;
        changes.push({ target: o.id, what: "remove", before: o.role, after: "—" });
        break;
      case "move":
        changes.push({ target: o.id, what: "position", before: `(${fmt(o.x)}, ${fmt(o.y)})`, after: `(${fmt(o.x + op.dx)}, ${fmt(o.y + op.dy)})` });
        o.x = round(o.x + op.dx);
        o.y = round(o.y + op.dy);
        break;
      case "rotate": {
        const after = round(o.rotationDeg + op.dDeg);
        if (Math.abs(after) > 360) {
          errors.push(`Rotation of ${o.id} would leave the allowed range.`);
          break;
        }
        changes.push({ target: o.id, what: "rotation (°)", before: fmt(o.rotationDeg), after: fmt(after) });
        o.rotationDeg = after;
        break;
      }
      case "setMaterial":
        changes.push({ target: o.id, what: "material", before: MATERIAL_PRESETS[o.material].label, after: MATERIAL_PRESETS[op.material].label });
        o.material = op.material;
        o.overrides = {};
        break;
      case "setRole":
        changes.push({ target: o.id, what: "role", before: o.role, after: op.role });
        o.role = op.role;
        if (op.role === "target") o.isStatic = true;
        break;
      case "setStatic":
        if (o.role === "target" && !op.isStatic) {
          errors.push("Targets are sensors and always stay fixed.");
          break;
        }
        changes.push({ target: o.id, what: "static", before: o.isStatic ? "static" : "dynamic", after: op.isStatic ? "static" : "dynamic" });
        o.isStatic = op.isStatic;
        break;
      case "set": {
        const r = setNumber(o, op.field, op.value);
        if (typeof r === "string") errors.push(r);
        else changes.push({ target: o.id, what: FIELD_LABEL[op.field], before: fmt(r.before), after: fmt(op.value) });
        break;
      }
    }
  }

  if (errors.length) return fail(errors, changes);
  const reparsed = SceneSpec.safeParse(next);
  if (!reparsed.success) return fail(formatZodError(reparsed.error), changes);
  const issues = semanticIssues(reparsed.data);
  const blocking = issues.filter((i) => i.severity === "error");
  if (blocking.length) return fail(blocking.map((i) => i.message), changes);
  return { ok: true, scene: reparsed.data, changes, errors: [], warnings: issues, touched: [...touched] };
}

function setNumber(o: SceneObject, field: (typeof NUMERIC_FIELDS)[number], value: number): { before: number } | string {
  switch (field) {
    case "x":
    case "y":
    case "rotationDeg": {
      const before = o[field];
      o[field] = round(value);
      return { before };
    }
    case "radius":
      if (o.shape.kind !== "circle") return `${o.id} is not a circle, so it has no radius.`;
      {
        const before = o.shape.radius;
        o.shape.radius = value;
        return { before };
      }
    case "width":
    case "height":
      if (o.shape.kind !== "rect") return `${o.id} is a circle; use radius instead.`;
      {
        const before = o.shape[field];
        o.shape[field] = value;
        return { before };
      }
    case "restitution":
    case "friction":
    case "density": {
      const lim = PARAM_LIMITS[field];
      if (value < lim.min || value > lim.max) return `${field} must be between ${lim.min} and ${lim.max}.`;
      const before = resolveMaterial(o.material, o.overrides)[field];
      o.overrides = { ...o.overrides, [field]: value };
      return { before };
    }
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function fail(errors: string[], changes: Change[] = []): PatchResult {
  return { ok: false, scene: null, changes, errors, warnings: [], touched: [] };
}
