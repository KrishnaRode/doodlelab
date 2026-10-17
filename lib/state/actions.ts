/**
 * User-level actions shared by toolbar buttons, keyboard shortcuts and the copilot.
 */
import { getController } from "./controller";
import { useLab, type PendingStroke } from "./store";
import { SAMPLES, type SampleInfo } from "../scene/samples";
import { makeObject, nextId } from "../scene/objects";
import { emptyScene, gravityFromPreset, GRAVITY_PRESETS, type Role, type SceneSpec } from "../scene/spec";
import { semanticIssues, type SceneIssue } from "../scene/validate";
import { DEG, round2 } from "../geometry/math";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export interface ReadinessReport {
  empty: boolean;
  errors: SceneIssue[];
  warnings: SceneIssue[];
  reviewIds: string[];
  pending: number;
}

export function sceneReadiness(scene: SceneSpec, pending: PendingStroke[]): ReadinessReport {
  const issues = semanticIssues(scene);
  return {
    empty: scene.objects.length === 0,
    errors: issues.filter((i) => i.severity === "error"),
    warnings: issues.filter((i) => i.severity === "warning"),
    reviewIds: scene.objects.filter((o) => o.source.needsReview).map((o) => o.id),
    pending: pending.length,
  };
}

/** Validate → (review gate) → compile + transition. Never starts on a broken scene. */
export function bringToLife(): boolean {
  const st = useLab.getState();
  const r = sceneReadiness(st.scene, st.pending);
  if (r.empty) {
    st.notify("Draw something first — a ball, a ramp, some ground.", "warn");
    return false;
  }
  if (r.errors.length) {
    st.set({ selection: [], inspectorOpen: true });
    st.notify(`Fix ${r.errors.length} problem${r.errors.length > 1 ? "s" : ""} first (see the inspector).`, "bad");
    return false;
  }
  if (r.reviewIds.length || r.pending) {
    st.set({ selection: [], inspectorOpen: true });
    st.notify(`Review ${r.reviewIds.length + r.pending} item${r.reviewIds.length + r.pending > 1 ? "s" : ""} before bringing it to life.`, "warn");
    return false;
  }
  getController().bringToLife(st.scene, prefersReducedMotion());
  return true;
}

/** Accept every "needs review" interpretation as shown and leave unrecognised strokes out. */
export function acceptAllReview(): void {
  const st = useLab.getState();
  const next = structuredClone(st.scene);
  let n = 0;
  for (const o of next.objects) {
    if (o.source.needsReview) {
      o.source.needsReview = false;
      n++;
    }
  }
  const dropped = st.pending.length;
  if (n) st.commit(next);
  if (dropped) st.set({ pending: [] });
  st.notify(`Accepted ${n} interpretation${n === 1 ? "" : "s"}${dropped ? `; left out ${dropped} unrecognised stroke${dropped === 1 ? "" : "s"}` : ""}.`, "ok");
}

export function confirmObject(id: string): void {
  useLab.getState().updateObject(
    id,
    (o) => {
      o.source.needsReview = false;
    },
    false,
  );
}

export function loadSample(info: SampleInfo | SampleInfo["id"]): void {
  const s = typeof info === "string" ? SAMPLES.find((x) => x.id === info)! : info;
  getController().backToEdit();
  useLab.getState().replaceScene(s.build());
  useLab.getState().set({ compareOpen: false, tool: "select" });
  useLab.getState().notify(`Loaded “${s.title}”. ${s.tryThis}`, "info");
}

export function newScene(): void {
  getController().backToEdit();
  useLab.getState().replaceScene(emptyScene(`scene-${Date.now().toString(36)}`));
  useLab.getState().set({ tool: "pencil" });
}

export function setGravityPreset(preset: keyof typeof GRAVITY_PRESETS): void {
  const st = useLab.getState();
  const next = structuredClone(st.scene);
  next.gravity = gravityFromPreset(preset);
  st.commit(next);
}

export function setGravityScale(scale: number): void {
  const st = useLab.getState();
  const next = structuredClone(st.scene);
  const preset = (Object.keys(GRAVITY_PRESETS) as Array<keyof typeof GRAVITY_PRESETS>).find((k) => GRAVITY_PRESETS[k].scale === scale);
  next.gravity = preset ? { preset, scale } : { preset: "custom", scale: round2(scale) };
  st.commit(next);
}

/** Turn an unrecognised stroke into an explicit object of the chosen role. */
export function convertPending(ps: PendingStroke, role: Role): void {
  const st = useLab.getState();
  const xs = ps.points.map((p) => p[0]);
  const ys = ps.points.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const id = nextId(st.scene, role);
  const local = ps.points.map(([x, y]) => [round2(x - cx), round2(y - cy)] as [number, number]);
  let obj;
  if (role === "ball") {
    const r = Math.max(8, Math.min(200, Math.max(maxX - minX, maxY - minY) / 2));
    obj = makeObject({ id, role, x: cx, y: cy, shape: { kind: "circle", radius: round2(r) }, sketch: [local] });
  } else if (role === "ramp" || role === "platform" || role === "ground") {
    const [fx, fy] = ps.points[0]!;
    const [lx, ly] = ps.points[ps.points.length - 1]!;
    const len = Math.max(30, Math.hypot(lx - fx, ly - fy));
    let ang = Math.atan2(ly - fy, lx - fx) / DEG;
    if (Math.abs(ang) > 90) ang = ang > 0 ? ang - 180 : ang + 180;
    const mx = (fx + lx) / 2;
    const my = (fy + ly) / 2;
    const rad = -ang * DEG;
    const sk = ps.points.map(([x, y]) => {
      const dx = x - mx;
      const dy = y - my;
      return [round2(dx * Math.cos(rad) - dy * Math.sin(rad)), round2(dx * Math.sin(rad) + dy * Math.cos(rad))] as [number, number];
    });
    obj = makeObject({ id, role, x: mx, y: my, rotationDeg: round2(ang), shape: { kind: "rect", width: round2(Math.min(1400, len)), height: role === "ground" ? 30 : 16 }, sketch: [sk] });
  } else {
    obj = makeObject({ id, role, x: cx, y: cy, shape: { kind: "rect", width: round2(Math.max(8, maxX - minX)), height: round2(Math.max(8, maxY - minY)) }, sketch: [local] });
  }
  obj.source = { kind: "freehand", needsReview: false, reasons: [], fit: { method: "manual", deviation: 0, note: "Interpretation chosen by you" } };
  st.removePending(ps.id);
  st.addObjects([obj]);
}
