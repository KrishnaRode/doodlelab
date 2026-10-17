/**
 * Target challenge: a small, bounded parameter search. Each candidate is a full SceneSpec
 * variant run headlessly through the normal compiler. Only TESTED results are reported —
 * no guaranteed optimum is claimed.
 */
import type { SceneSpec } from "../scene/spec";
import { semanticIssues } from "../scene/validate";
import { resolveMaterial } from "../scene/materials";
import { runHeadless } from "./simulation";

export type SearchParam =
  | { kind: "ramp-angle"; objectId: string }
  | { kind: "release-x"; objectId: string }
  | { kind: "bounce"; objectId: string };

export interface Candidate {
  value: number;
  label: string;
  spec: SceneSpec;
}

export interface CandidateResult {
  value: number;
  label: string;
  tested: boolean;
  skippedReason: string | null;
  reached: boolean;
  atSec: number | null;
  collisions: number;
  spec: SceneSpec;
}

export interface SearchOutcome {
  param: SearchParam;
  current: number;
  results: CandidateResult[];
  best: CandidateResult | null;
  testedCount: number;
  ms: number;
}

const STEPS = 13;

export function currentValue(spec: SceneSpec, p: SearchParam): number {
  const o = spec.objects.find((x) => x.id === p.objectId);
  if (!o) throw new Error(`No object ${p.objectId}`);
  if (p.kind === "ramp-angle") return o.rotationDeg;
  if (p.kind === "release-x") return o.x;
  return resolveMaterial(o.material, o.overrides).restitution;
}

export function candidatesFor(spec: SceneSpec, p: SearchParam): Candidate[] {
  const cur = currentValue(spec, p);
  const values: number[] = [];
  if (p.kind === "ramp-angle") for (let i = 0; i < STEPS; i++) values.push(Math.round((cur - 15 + i * 2.5) * 10) / 10);
  else if (p.kind === "release-x") for (let i = 0; i < STEPS; i++) values.push(Math.round(cur - 120 + i * 20));
  else for (let i = 0; i < STEPS; i++) values.push(Math.round((0.05 + i * 0.075) * 1000) / 1000);
  return values.map((v) => {
    const s = structuredClone(spec);
    const o = s.objects.find((x) => x.id === p.objectId)!;
    if (p.kind === "ramp-angle") o.rotationDeg = v;
    else if (p.kind === "release-x") o.x = v;
    else o.overrides = { ...o.overrides, restitution: Math.min(0.95, v) };
    const label = p.kind === "ramp-angle" ? `${v}°` : p.kind === "release-x" ? `x = ${v}` : `bounce ${v}`;
    return { value: v, label, spec: s };
  });
}

export async function searchTarget(
  spec: SceneSpec,
  p: SearchParam,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<SearchOutcome> {
  if (!spec.goal) throw new Error("This scene has no target goal to search for.");
  const started = performance.now();
  const cur = currentValue(spec, p);
  const cands = candidatesFor(spec, p);
  const results: CandidateResult[] = [];
  for (let i = 0; i < cands.length; i++) {
    if (opts.signal?.aborted) break;
    const c = cands[i]!;
    const issues = semanticIssues(c.spec);
    const blocking = issues.find((x) => x.severity === "error" || x.code === "overlap");
    if (blocking) {
      results.push({ value: c.value, label: c.label, tested: false, skippedReason: blocking.message, reached: false, atSec: null, collisions: 0, spec: c.spec });
    } else {
      const run = runHeadless(c.spec, { stopOnGoal: true });
      results.push({ value: c.value, label: c.label, tested: true, skippedReason: null, reached: !!run.goal?.reached, atSec: run.goal?.atSec ?? null, collisions: run.collisionCount, spec: c.spec });
    }
    opts.onProgress?.(i + 1, cands.length);
    // Yield so physics controls and the UI stay responsive.
    await new Promise((r) => setTimeout(r, 0));
  }
  const hits = results.filter((r) => r.reached);
  // Prefer the smallest change from the current setting, then the earliest arrival.
  const best = hits.sort((a, b) => Math.abs(a.value - cur) - Math.abs(b.value - cur) || (a.atSec ?? 99) - (b.atSec ?? 99))[0] ?? null;
  return { param: p, current: cur, results, best, testedCount: results.filter((r) => r.tested).length, ms: Math.round(performance.now() - started) };
}
