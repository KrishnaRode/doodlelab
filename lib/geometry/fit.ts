/**
 * Deterministic freehand-stroke recognition. Vector strokes are fitted directly — never
 * rasterized and re-guessed by a model. Output carries *measured* fit quality and plain
 * review reasons, never a made-up confidence percentage.
 */
import type { Point, Role, Shape } from "../scene/spec";
import {
  DEG,
  convexHull,
  dist,
  fitCircle,
  minAreaRect,
  normalizeAxisDeg,
  pathLength,
  polygonArea,
  rectDeviation,
  rotate,
  round2,
  simplify,
  type Vec,
} from "./math";

export type FitKind = "circle" | "rect" | "line" | "unsupported" | "too-small";

export interface StrokeFit {
  kind: FitKind;
  role: Role | null;
  shape: Shape | null;
  x: number;
  y: number;
  rotationDeg: number;
  /** Measured deviation of the stroke from the fitted shape (0 = perfect). */
  deviation: number;
  method: "circle" | "rect" | "line" | null;
  note: string;
  needsReview: boolean;
  reasons: string[];
  /** Other reasonable interpretations offered in the review UI. */
  alternatives: Role[];
  /** Stroke in the fitted object's local frame, simplified. */
  localSketch: Point[];
  metrics: {
    pathLength: number;
    closedness: number;
    straightness: number;
    rectangularity: number;
    aspect: number;
  };
}

export interface FitOptions {
  world: { width: number; height: number };
  /** Static thickness used for line → ramp conversion. */
  rampThickness?: number;
}

export function resample(points: Vec[], spacing: number): Vec[] {
  if (points.length < 2) return points.slice();
  const out: Vec[] = [points[0]!];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1]!;
    const b = points[i]!;
    let seg = dist(a, b);
    while (carry + seg >= spacing) {
      const t = (spacing - carry) / seg;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(p);
      a = p;
      seg = dist(a, b);
      carry = 0;
    }
    carry += seg;
  }
  const last = points[points.length - 1]!;
  if (dist(out[out.length - 1]!, last) > spacing * 0.3) out.push(last);
  return out;
}

function lineFit(pts: Vec[]): { cx: number; cy: number; angleDeg: number; length: number; rms: number } {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n;
  const cy = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (const p of pts) {
    sxx += (p.x - cx) ** 2;
    syy += (p.y - cy) ** 2;
    sxy += (p.x - cx) * (p.y - cy);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  let minT = Infinity,
    maxT = -Infinity,
    ss = 0;
  for (const p of pts) {
    const t = (p.x - cx) * dx + (p.y - cy) * dy;
    const d = -(p.x - cx) * dy + (p.y - cy) * dx;
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
    ss += d * d;
  }
  const mid = (minT + maxT) / 2;
  return {
    cx: cx + dx * mid,
    cy: cy + dy * mid,
    angleDeg: normalizeAxisDeg(theta / DEG),
    length: maxT - minT,
    rms: Math.sqrt(ss / n),
  };
}

function toLocalSketch(points: Vec[], cx: number, cy: number, angleDeg: number): Point[] {
  const local = points.map((p) => rotate({ x: p.x - cx, y: p.y - cy }, -angleDeg * DEG));
  const simp = simplify(local, 0.8);
  const step = Math.max(1, Math.ceil(simp.length / 380));
  return simp.filter((_, i) => i % step === 0).map((p) => [round2(p.x), round2(p.y)] as Point);
}

/** Pick a role for a fitted straight/thin element. */
function thinRole(angleDeg: number, length: number, cy: number, world: FitOptions["world"]): { role: Role; alternatives: Role[] } {
  const flat = Math.abs(angleDeg) < 4;
  const vertical = Math.abs(Math.abs(angleDeg) - 90) < 8;
  if (vertical) return { role: "wall", alternatives: ["ramp", "domino", "platform"] };
  if (flat && cy > world.height * 0.82 && length > world.width * 0.45) return { role: "ground", alternatives: ["platform", "ramp"] };
  if (flat) return { role: "platform", alternatives: ["ground", "ramp"] };
  return { role: "ramp", alternatives: ["platform", "block"] };
}

export function fitStroke(raw: Point[], opts: FitOptions): StrokeFit {
  const world = opts.world;
  const thickness = opts.rampThickness ?? 16;
  const input: Vec[] = raw.map(([x, y]) => ({ x, y }));
  const L = pathLength(input);
  const empty: StrokeFit = {
    kind: "too-small",
    role: null,
    shape: null,
    x: input[0]?.x ?? 0,
    y: input[0]?.y ?? 0,
    rotationDeg: 0,
    deviation: 0,
    method: null,
    note: "Too small to recognise",
    needsReview: true,
    reasons: ["The stroke is too short to recognise. Draw a bit bigger."],
    alternatives: [],
    localSketch: [],
    metrics: { pathLength: L, closedness: 0, straightness: 0, rectangularity: 0, aspect: 0 },
  };
  if (input.length < 2 || L < 14) return empty;

  const pts = resample(input, Math.max(2, L / 160));
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const chord = dist(first, last);
  const straightness = chord / L;
  const hull = convexHull(pts);
  const mar = minAreaRect(pts);
  const aspect = mar.height > 0 ? mar.width / mar.height : Infinity;
  const rectangularity = mar.width * mar.height > 0 ? polygonArea(hull) / (mar.width * mar.height) : 0;
  // A stroke is "closed" if its ends meet relative to its size. People overshoot or stop short
  // of the start, so the end may land near ANY early part of the stroke (and vice versa).
  const size = Math.max(mar.width, 1);
  const k = Math.max(2, Math.floor(pts.length * 0.25));
  let gap = chord;
  for (let i = 0; i < k; i++) gap = Math.min(gap, dist(last, pts[i]!), dist(first, pts[pts.length - 1 - i]!));
  const closedness = 1 - Math.min(1, gap / (size * 0.5));
  const metrics = { pathLength: round2(L), closedness: round2(closedness), straightness: round2(straightness), rectangularity: round2(rectangularity), aspect: round2(Math.min(aspect, 999)) };

  // ── Straight line → ramp / platform / ground ──────────────────────────────
  if (straightness > 0.86 || aspect > 9) {
    const lf = lineFit(pts);
    const deviation = lf.rms / Math.max(lf.length, 1);
    if (lf.length < 24) return { ...empty, metrics };
    const { role, alternatives } = thinRole(lf.angleDeg, lf.length, lf.cy, world);
    const reasons: string[] = [];
    if (deviation > 0.05) reasons.push("The line is wobbly; it was straightened.");
    const width = Math.min(1400, lf.length);
    const shape: Shape = role === "wall" ? { kind: "rect", width: thickness + 4, height: width } : { kind: "rect", width, height: role === "ground" ? 26 : thickness };
    const rot = role === "wall" ? 0 : lf.angleDeg;
    return {
      kind: "line",
      role,
      shape,
      x: lf.cx,
      y: lf.cy,
      rotationDeg: round2(rot),
      deviation: round2(deviation),
      method: "line",
      note: `Line fit: ${pct(deviation)} wobble over ${Math.round(lf.length)} u`,
      needsReview: reasons.length > 0,
      reasons,
      alternatives,
      localSketch: toLocalSketch(pts, lf.cx, lf.cy, rot),
      metrics,
    };
  }

  if (closedness < 0.35) {
    return {
      ...empty,
      kind: "unsupported",
      note: "Open curve",
      x: (first.x + last.x) / 2,
      y: (first.y + last.y) / 2,
      reasons: ["This is an open curve. DoodleLab understands balls (circles), blocks (boxes) and ramps (straight lines)."],
      alternatives: ["ramp", "ball", "block"],
      localSketch: toLocalSketch(pts, (first.x + last.x) / 2, (first.y + last.y) / 2, 0),
      metrics,
    };
  }

  // ── Closed shape: circle vs rectangle ────────────────────────────────────
  const circ = fitCircle(pts);
  const rectDev = rectDeviation(pts, mar);
  const reasons: string[] = [];
  let kind: "circle" | "rect";
  if (rectangularity < 0.7) {
    reasons.push("Looks like a triangle or irregular shape — only circles, boxes and lines are supported.");
    kind = circ && circ.deviation < rectDev ? "circle" : "rect";
  } else if (rectangularity >= 0.9 && rectDev < 0.25) {
    kind = "rect";
  } else if (rectangularity <= 0.84 && circ && circ.deviation < 0.14) {
    kind = "circle";
  } else {
    kind = circ && circ.deviation < 0.1 && rectDev > 0.12 ? "circle" : "rect";
    reasons.push("Between a circle and a box — please confirm.");
  }

  if (kind === "circle" && circ) {
    if (aspect > 1.35) reasons.push("Oval shape — it becomes a round ball of average size.");
    const r = Math.max(6, Math.min(200, Math.sqrt(mar.width * mar.height) / 2));
    if (circ.deviation > 0.12) reasons.push("The circle is quite wobbly.");
    return {
      kind: "circle",
      role: "ball",
      shape: { kind: "circle", radius: round2(r) },
      x: circ.cx,
      y: circ.cy,
      rotationDeg: 0,
      deviation: round2(circ.deviation),
      method: "circle",
      note: `Circle fit: ${pct(circ.deviation)} deviation`,
      needsReview: reasons.length > 0,
      reasons,
      alternatives: ["block", "target"],
      localSketch: toLocalSketch(pts, circ.cx, circ.cy, 0),
      metrics,
    };
  }

  // Rectangle: choose an upright/flat orientation and role.
  let w = mar.width;
  let h = mar.height;
  let angle = mar.angleDeg;
  // Prefer the representation closest to axis-aligned (|angle| ≤ 45°).
  if (Math.abs(angle) > 45) {
    angle = normalizeAxisDeg(angle - 90);
    [w, h] = [h, w];
  }
  if (Math.abs(angle) < 3) angle = 0;
  let role: Role = "block";
  let alternatives: Role[] = ["domino", "platform", "target"];
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (long / Math.max(short, 1) > 5) {
    const thin = thinRole(w >= h ? angle : angle + 90, long, mar.cy, world);
    role = thin.role;
    alternatives = thin.alternatives;
  } else if (h > w * 2.5) {
    role = h < 160 ? "domino" : "wall";
    alternatives = ["block", "wall", "domino"].filter((r) => r !== role) as Role[];
  }
  return {
    kind: "rect",
    role,
    shape: { kind: "rect", width: round2(Math.max(4, w)), height: round2(Math.max(4, h)) },
    x: mar.cx,
    y: mar.cy,
    rotationDeg: round2(angle),
    deviation: round2(rectDev),
    method: "rect",
    note: `Box fit: ${pct(rectDev)} deviation`,
    needsReview: reasons.length > 0,
    reasons,
    alternatives,
    localSketch: toLocalSketch(pts, mar.cx, mar.cy, angle),
    metrics,
  };
}

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}
