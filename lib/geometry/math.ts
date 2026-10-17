import type { Point, SceneObject } from "../scene/spec";

export type Vec = { x: number; y: number };

export const DEG = Math.PI / 180;

export function rotate(p: Vec, rad: number): Vec {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** World-space corners of a rect object (clockwise, Y-down). */
export function rectCorners(o: Pick<SceneObject, "x" | "y" | "rotationDeg"> & { w: number; h: number }): Vec[] {
  const hw = o.w / 2;
  const hh = o.h / 2;
  const rad = o.rotationDeg * DEG;
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => {
    const r = rotate(p, rad);
    return { x: r.x + o.x, y: r.y + o.y };
  });
}

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function objectAABB(o: SceneObject): AABB {
  if (o.shape.kind === "circle") {
    const r = o.shape.radius;
    return { minX: o.x - r, minY: o.y - r, maxX: o.x + r, maxY: o.y + r };
  }
  const cs = rectCorners({ x: o.x, y: o.y, rotationDeg: o.rotationDeg, w: o.shape.width, h: o.shape.height });
  return {
    minX: Math.min(...cs.map((c) => c.x)),
    minY: Math.min(...cs.map((c) => c.y)),
    maxX: Math.max(...cs.map((c) => c.x)),
    maxY: Math.max(...cs.map((c) => c.y)),
  };
}

/** World point → object-local (unrotated) frame. */
export function toLocal(o: Pick<SceneObject, "x" | "y" | "rotationDeg">, p: Vec): Vec {
  return rotate({ x: p.x - o.x, y: p.y - o.y }, -o.rotationDeg * DEG);
}

export function toWorld(o: { x: number; y: number; angleRad: number }, p: Vec): Vec {
  const r = rotate(p, o.angleRad);
  return { x: r.x + o.x, y: r.y + o.y };
}

export function hitTest(o: SceneObject, p: Vec, pad = 0): boolean {
  const l = toLocal(o, p);
  if (o.shape.kind === "circle") return Math.hypot(l.x, l.y) <= o.shape.radius + pad;
  return Math.abs(l.x) <= o.shape.width / 2 + pad && Math.abs(l.y) <= o.shape.height / 2 + pad;
}

export function pointsToVecs(points: Point[]): Vec[] {
  return points.map(([x, y]) => ({ x, y }));
}

export function vecsToPoints(v: Vec[]): Point[] {
  return v.map((p) => [round2(p.x), round2(p.y)] as Point);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function normalizeDeg(d: number): number {
  let a = d % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return round2(a);
}

/** Deterministic PRNG (mulberry32) seeded from a string — used for hand-drawn wobble. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ramer–Douglas–Peucker polyline simplification. */
export function simplify(points: Vec[], epsilon: number): Vec[] {
  if (points.length < 3) return points.slice();
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointSegDist(points[i]!, first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > epsilon) {
    const a = simplify(points.slice(0, idx + 1), epsilon);
    const b = simplify(points.slice(idx), epsilon);
    return a.slice(0, -1).concat(b);
  }
  return [first, last];
}

export function pointSegDist(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function pathLength(points: Vec[]): number {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += dist(points[i - 1]!, points[i]!);
  return L;
}

/** Andrew's monotone chain convex hull. */
export function convexHull(points: Vec[]): Vec[] {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function polygonArea(poly: Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export interface OrientedRect {
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Degrees, clockwise-positive (Y-down), normalized so width is the long side. */
  angleDeg: number;
}

/** Minimum-area enclosing rectangle via rotating the hull's edge directions. */
export function minAreaRect(points: Vec[]): OrientedRect {
  const hull = convexHull(points);
  if (hull.length === 0) return { cx: 0, cy: 0, width: 0, height: 0, angleDeg: 0 };
  if (hull.length < 3) {
    const a = hull[0]!;
    const b = hull[hull.length - 1]!;
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      width: dist(a, b),
      height: 0,
      angleDeg: Math.atan2(b.y - a.y, b.x - a.x) / DEG,
    };
  }
  let best: OrientedRect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i]!;
    const q = hull[(i + 1) % hull.length]!;
    const theta = Math.atan2(q.y - p.y, q.x - p.x);
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    const c = Math.cos(-theta);
    const s = Math.sin(-theta);
    for (const h of hull) {
      const u = h.x * c - h.y * s;
      const v = h.x * s + h.y * c;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      const center = rotate({ x: cu, y: cv }, theta);
      let w = maxU - minU;
      let h = maxV - minV;
      let ang = theta / DEG;
      if (h > w) {
        [w, h] = [h, w];
        ang += 90;
      }
      best = { cx: center.x, cy: center.y, width: w, height: h, angleDeg: normalizeAxisDeg(ang) };
    }
  }
  return best!;
}

/** Normalize an undirected axis angle to (-90, 90]. */
export function normalizeAxisDeg(d: number): number {
  let a = ((d % 180) + 180) % 180;
  if (a > 90) a -= 180;
  return a;
}

export interface CircleFit {
  cx: number;
  cy: number;
  r: number;
  /** RMS radial residual divided by radius. */
  deviation: number;
}

/** Algebraic (Kåsa) least-squares circle fit. */
export function fitCircle(points: Vec[]): CircleFit | null {
  const n = points.length;
  if (n < 3) return null;
  let mx = 0,
    my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let suu = 0,
    svv = 0,
    suv = 0,
    suuu = 0,
    svvv = 0,
    suvv = 0,
    svuu = 0;
  for (const p of points) {
    const u = p.x - mx;
    const v = p.y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const b1 = 0.5 * (suuu + suvv);
  const b2 = 0.5 * (svvv + svuu);
  const uc = (b1 * svv - b2 * suv) / det;
  const vc = (suu * b2 - suv * b1) / det;
  const cx = uc + mx;
  const cy = vc + my;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  let ss = 0;
  for (const p of points) {
    const d = Math.hypot(p.x - cx, p.y - cy) - r;
    ss += d * d;
  }
  return { cx, cy, r, deviation: Math.sqrt(ss / n) / r };
}

/** Mean distance from points to an oriented rectangle's boundary, divided by its short side. */
export function rectDeviation(points: Vec[], r: OrientedRect): number {
  const rad = r.angleDeg * DEG;
  const hw = r.width / 2;
  const hh = r.height / 2;
  let sum = 0;
  for (const p of points) {
    const l = rotate({ x: p.x - r.cx, y: p.y - r.cy }, -rad);
    const dx = Math.abs(l.x) - hw;
    const dy = Math.abs(l.y) - hh;
    const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    const inside = Math.min(Math.max(dx, dy), 0);
    sum += Math.abs(outside + inside);
  }
  return sum / points.length / Math.max(r.height, 1);
}
