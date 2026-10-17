/**
 * Turns a validated scene + measured run telemetry into numbered facts. Explanations —
 * rule-based or AI — may only reason from these. Observations are measured; settings are
 * the scene configuration; changes are exact parameter diffs between runs.
 */
import { MATERIAL_PRESETS, resolveMaterial } from "../scene/materials";
import type { SceneObject, SceneSpec } from "../scene/spec";
import { gravityLabel } from "../scene/spec";
import type { BodyStats, RunSummary } from "../physics/telemetry";

export interface Fact {
  id: string;
  kind: "measured" | "setting" | "change";
  text: string;
  /** Numbers appearing in the fact, used for the grounding check. */
  numbers: number[];
  subject?: string;
}

export interface RunRecord {
  spec: SceneSpec;
  summary: RunSummary;
}

export interface ParamChange {
  objectId: string;
  field: string;
  before: string;
  after: string;
}

function nums(text: string): number[] {
  return (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function name(o: Pick<SceneObject, "id" | "label">) {
  return o.label ? `${o.label} (${o.id})` : o.id;
}

/** Exact parameter differences between two authored scenes. */
export function diffScenes(before: SceneSpec, after: SceneSpec): ParamChange[] {
  const out: ParamChange[] = [];
  if (before.gravity.scale !== after.gravity.scale) {
    out.push({ objectId: "world", field: "gravity", before: `${before.gravity.scale}× Earth`, after: `${after.gravity.scale}× Earth` });
  }
  const prev = new Map(before.objects.map((o) => [o.id, o]));
  const next = new Map(after.objects.map((o) => [o.id, o]));
  for (const [id, o] of next) {
    const p = prev.get(id);
    if (!p) {
      out.push({ objectId: id, field: "added", before: "—", after: o.role });
      continue;
    }
    const mp = resolveMaterial(p.material, p.overrides);
    const mo = resolveMaterial(o.material, o.overrides);
    const cmp: Array<[string, string, string]> = [
      ["material", p.material, o.material],
      ["bounce", String(mp.restitution), String(mo.restitution)],
      ["friction", String(mp.friction), String(mo.friction)],
      ["density", String(mp.density), String(mo.density)],
      ["static", String(p.isStatic), String(o.isStatic)],
      ["x", String(Math.round(p.x)), String(Math.round(o.x))],
      ["y", String(Math.round(p.y)), String(Math.round(o.y))],
      ["rotation°", String(Math.round(p.rotationDeg)), String(Math.round(o.rotationDeg))],
      ["size", sizeOf(p), sizeOf(o)],
    ];
    for (const [field, a, b] of cmp) if (a !== b) out.push({ objectId: id, field, before: a, after: b });
  }
  for (const id of prev.keys()) if (!next.has(id)) out.push({ objectId: id, field: "removed", before: prev.get(id)!.role, after: "—" });
  return out;
}

function sizeOf(o: SceneObject) {
  return o.shape.kind === "circle" ? `r${Math.round(o.shape.radius)}` : `${Math.round(o.shape.width)}x${Math.round(o.shape.height)}`;
}

export function buildFacts(spec: SceneSpec, run: RunSummary, previous?: RunRecord | null): Fact[] {
  const facts: Fact[] = [];
  const add = (kind: Fact["kind"], text: string, subject?: string) => facts.push({ id: `F${facts.length + 1}`, kind, text, numbers: nums(text), subject });
  const byId = new Map(spec.objects.map((o) => [o.id, o]));

  add("setting", `Gravity: ${gravityLabel(run.gravity)} (${run.gravity.scale}× the scene's Earth gravity).`);
  add("setting", `Observed for ${run.simulatedSec} simulated seconds.`);
  for (const o of spec.objects) {
    if (o.role === "target") continue;
    const m = resolveMaterial(o.material, o.overrides);
    if (o.isStatic) {
      if (o.role === "ramp") add("setting", `${name(o)} is a fixed ramp tilted ${Math.round(Math.abs(o.rotationDeg))}°, material ${MATERIAL_PRESETS[o.material].label}, friction ${m.friction}.`, o.id);
      continue;
    }
    add("setting", `${name(o)}: material ${MATERIAL_PRESETS[o.material].label}, bounce setting ${m.restitution} (1 would be perfectly elastic), friction ${m.friction}, density ${m.density}.`, o.id);
  }

  const bodies = Object.values(run.bodies).filter((b) => !b.isStatic);
  for (const b of bodies) {
    const o = byId.get(b.id);
    if (!o) continue;
    describeBody(o, b, add);
  }
  const dominoes = bodies.filter((b) => b.role === "domino");
  if (dominoes.length) {
    const tipped = dominoes.filter((d) => Math.abs(normalize(d.finalAngleDeg)) > 45).length;
    add("measured", `${tipped} of ${dominoes.length} dominoes ended tipped over (leaning more than 45°).`);
  }
  add("measured", `${run.collisionCount} collisions were recorded in total.`);
  for (const t of Object.values(run.targets)) {
    const o = byId.get(t.id);
    if (!o) continue;
    if (t.firstEntrySec !== null) add("measured", `${t.firstEntryBy} first entered ${name(o)} at ${t.firstEntrySec} s.`, t.id);
    else add("measured", `Nothing entered ${name(o)} during the run.`, t.id);
  }
  if (run.goal) {
    add("measured", run.goal.reached ? `Goal reached: ${run.goal.by} entered the target at ${run.goal.atSec} s.` : `Goal not reached within ${run.simulatedSec} s.`);
  }
  if (run.gravityChangedDuringRun) add("measured", "Gravity was changed while the experiment was running.");
  if (run.userInteracted) add("measured", "Someone dragged an object by hand during the run, so the motion is not purely from the starting setup.");

  if (previous) {
    const changes = diffScenes(previous.spec, spec);
    for (const c of changes) add("change", `Since the previous run: ${c.objectId} ${c.field} changed from ${c.before} to ${c.after}.`, c.objectId);
    if (changes.length === 0) add("change", "No settings changed since the previous run.");
    if (previous.summary.goal && run.goal && previous.summary.goal.reached !== run.goal.reached) {
      add("change", `Previous run: goal ${previous.summary.goal.reached ? "reached" : "not reached"}; this run: ${run.goal.reached ? "reached" : "not reached"}.`);
    }
  }
  return facts;
}

function normalize(d: number) {
  let a = d % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

function describeBody(o: SceneObject, b: BodyStats, add: (k: Fact["kind"], t: string, s?: string) => void) {
  const n = name(o);
  const parts: string[] = [];
  parts.push(`${n} moved ${Math.round(b.maxDisplacement)} u at most from its start`);
  if (b.maxRise > 2) parts.push(`rose ${Math.round(b.maxRise)} u above its start at the highest`);
  parts.push(`top speed ${Math.round(b.maxSpeed)} u/s`);
  add("measured", parts.join(", ") + ".", o.id);
  if (b.collisions > 0) add("measured", `${n} had ${b.collisions} collisions; the first at ${b.firstImpactSec} s.`, o.id);
  else add("measured", `${n} never collided with anything.`, o.id);
  if (b.leftWorldAtSec !== null) add("measured", `${n} left the world at ${b.leftWorldAtSec} s.`, o.id);
  else if (b.restedAtSec !== null) add("measured", `${n} came to rest at ${b.restedAtSec} s, at x=${Math.round(b.finalX)}, y=${Math.round(b.finalY)}.`, o.id);
  else add("measured", `${n} was still moving at the end (${Math.round(b.finalSpeed)} u/s).`, o.id);
}

/** Pick the object a question is about ("why did the ball stop?"). */
export function questionSubject(question: string, spec: SceneSpec, selection: string[] = []): SceneObject | null {
  const q = question.toLowerCase();
  const byId = spec.objects.find((o) => q.includes(o.id));
  if (byId) return byId;
  const sel = spec.objects.find((o) => selection.includes(o.id) && !o.isStatic);
  if (sel && /\b(this|it|selected)\b/.test(q)) return sel;
  for (const role of ["ball", "domino", "block"] as const) {
    if (q.includes(role)) {
      const list = spec.objects.filter((o) => o.role === role && !o.isStatic);
      if (list.length) return list.find((o) => selection.includes(o.id)) ?? list[0]!;
    }
  }
  return sel ?? spec.objects.find((o) => o.role === "ball") ?? spec.objects.find((o) => !o.isStatic) ?? null;
}
