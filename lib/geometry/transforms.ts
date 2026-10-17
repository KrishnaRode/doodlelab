/**
 * Explicit coordinate transforms. Every conversion between spaces goes through here:
 *
 *   original image px ──H (perspective crop)──► rectified px ──÷size──► normalized [0,1]
 *   normalized [0,1] ──×world──► scene units (u, Y-down)  ──view──► CSS px on the stage canvas
 *
 * Both directions exist for each step so recognition overlays can be drawn back onto the
 * ORIGINAL photo for alignment inspection.
 */
import type { Vec } from "./math";

export interface WorldSize {
  width: number;
  height: number;
}

export function normalizedToWorld(p: Vec, world: WorldSize): Vec {
  return { x: p.x * world.width, y: p.y * world.height };
}

export function worldToNormalized(p: Vec, world: WorldSize): Vec {
  return { x: p.x / world.width, y: p.y / world.height };
}

/** Uniform world→screen view that letterboxes the world into a viewport. */
export interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function fitView(
  world: WorldSize,
  viewportW: number,
  viewportH: number,
  padding = 0,
  insets: { top?: number; bottom?: number } = {},
): View {
  const top = padding + (insets.top ?? 0);
  const bottom = padding + (insets.bottom ?? 0);
  const scale = Math.max(0.05, Math.min((viewportW - padding * 2) / world.width, (viewportH - top - bottom) / world.height));
  return {
    scale,
    offsetX: (viewportW - world.width * scale) / 2,
    offsetY: top + (viewportH - top - bottom - world.height * scale) / 2,
  };
}

export function worldToScreen(p: Vec, v: View): Vec {
  return { x: p.x * v.scale + v.offsetX, y: p.y * v.scale + v.offsetY };
}

export function screenToWorld(p: Vec, v: View): Vec {
  return { x: (p.x - v.offsetX) / v.scale, y: (p.y - v.offsetY) / v.scale };
}

/** 3×3 homography, row-major, mapping (x,y,1). */
export type Homography = [number, number, number, number, number, number, number, number, number];

export function applyHomography(H: Homography, p: Vec): Vec {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

/**
 * Homography mapping 4 source points to 4 destination points (DLT with h33 = 1,
 * solved by Gaussian elimination with partial pivoting).
 */
export function homographyFromQuad(src: Vec[], dst: Vec[]): Homography {
  if (src.length !== 4 || dst.length !== 4) throw new Error("homography needs exactly 4 point pairs");
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

export function invertHomography(H: Homography): Homography {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error("homography is singular");
  const inv: Homography = [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
  const s = inv[8];
  return inv.map((v) => v / s) as Homography;
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-12) throw new Error("degenerate quad (points are collinear)");
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / M[col]![col]!;
      for (let k = col; k <= n; k++) M[r]![k]! -= f * M[col]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/** Rotate an image-space point by a multiple of 90° (clockwise) inside a w×h image. */
export function rotatePoint90(p: Vec, w: number, h: number, quarterTurns: number): Vec {
  const q = ((quarterTurns % 4) + 4) % 4;
  if (q === 0) return p;
  if (q === 1) return { x: h - p.y, y: p.x };
  if (q === 2) return { x: w - p.x, y: h - p.y };
  return { x: p.y, y: w - p.x };
}
