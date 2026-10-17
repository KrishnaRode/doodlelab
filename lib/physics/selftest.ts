/**
 * Checks used by the in-app demo readiness panel and by unit tests. They RUN the physics —
 * a check passes only if the measured outcome matches.
 */
import { SAMPLES, bounceToTarget, gravityPlayground } from "../scene/samples";
import { emptyScene, gravityFromPreset } from "../scene/spec";
import { makeObject } from "../scene/objects";
import { ground } from "../scene/samples";
import { runHeadless } from "./simulation";
import { semanticIssues } from "../scene/validate";

export interface CheckResult {
  ok: boolean;
  detail: string;
  ms: number;
}

function timed(fn: () => { ok: boolean; detail: string }): CheckResult {
  const t = performance.now();
  try {
    const r = fn();
    return { ...r, ms: Math.round(performance.now() - t) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e), ms: Math.round(performance.now() - t) };
  }
}

export function physicsSelfTest(): CheckResult {
  return timed(() => {
    const s = emptyScene("selftest", "Self test");
    s.objects.push(ground(), makeObject({ id: "ball-1", role: "ball", x: 500, y: 100, shape: { kind: "circle", radius: 20 }, material: "heavy" }));
    const r = runHeadless(s, { durationSec: 3 });
    const b = r.bodies["ball-1"]!;
    const fell = b.finalY - 100;
    const ok = fell > 400 && b.restedAtSec !== null && b.leftWorldAtSec === null;
    return { ok, detail: ok ? `Ball fell ${Math.round(fell)} u and came to rest at ${b.restedAtSec} s.` : `Unexpected: fell ${Math.round(fell)} u, rested ${String(b.restedAtSec)}.` };
  });
}

export function sampleChecks(): Record<string, CheckResult> {
  const out: Record<string, CheckResult> = {};
  out["domino-chain"] = timed(() => {
    const spec = SAMPLES[0]!.build();
    const r = runHeadless(spec);
    const dom = Object.values(r.bodies).filter((b) => b.role === "domino");
    const tipped = dom.filter((d) => Math.abs(((d.finalAngleDeg % 360) + 540) % 360 - 180) > 45).length;
    return { ok: tipped >= dom.length - 1 && semanticIssues(spec).every((i) => i.severity !== "error"), detail: `${tipped} of ${dom.length} dominoes toppled.` };
  });
  out["gravity-playground"] = timed(() => {
    const earth = runHeadless({ ...gravityPlayground(), gravity: gravityFromPreset("earth") });
    const moon = runHeadless({ ...gravityPlayground(), gravity: gravityFromPreset("moon") });
    const ok = !earth.goal?.reached && !!moon.goal?.reached;
    return { ok, detail: `Earth: ${earth.goal?.reached ? "reached" : "missed"} the high target; Moon: ${moon.goal?.reached ? `reached at ${moon.goal.atSec} s` : "missed"}.` };
  });
  out["bounce-to-target"] = timed(() => {
    const wood = runHeadless(bounceToTarget());
    const b = bounceToTarget();
    b.objects.find((o) => o.id === "ball-1")!.material = "bouncy";
    const bouncy = runHeadless(b);
    const ok = !wood.goal?.reached && !!bouncy.goal?.reached;
    return { ok, detail: `Wood-like ball: ${wood.goal?.reached ? "reached" : "missed"}; bouncy ball: ${bouncy.goal?.reached ? `reached at ${bouncy.goal.atSec} s` : "missed"}.` };
  });
  return out;
}
