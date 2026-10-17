/**
 * Local, deterministic image pipeline for photos of paper drawings. Pure functions on pixel
 * arrays — runs in the browser and in unit tests. No model is needed to find geometry; an
 * optional local vision model only suggests ROLES afterwards.
 *
 *   original px ──homography──► rectified (outW×outH) ──threshold──► ink mask
 *   ──components──► outer contours ──fitStroke (same fitter as freehand)──► candidates
 */
import { fitStroke, type StrokeFit } from "../geometry/fit";
import { applyHomography, homographyFromQuad, invertHomography, type Homography } from "../geometry/transforms";
import type { Vec } from "../geometry/math";
import type { Point } from "../scene/spec";

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Corners of the paper in ORIGINAL image pixels: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Vec, Vec, Vec, Vec];

export function fullQuad(w: number, h: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: w - 1, y: 0 },
    { x: w - 1, y: h - 1 },
    { x: 0, y: h - 1 },
  ];
}

/** H maps rectified px → original px (used for sampling). Its inverse maps original → rectified. */
export function rectifyHomography(quad: Quad, outW: number, outH: number): Homography {
  const dst = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];
  return homographyFromQuad(dst, quad);
}

/** Perspective-correct crop with bilinear sampling. */
export function warpToRect(src: RGBAImage, quad: Quad, outW: number, outH: number): { image: RGBAImage; H: Homography } {
  const H = rectifyHomography(quad, outW, outH);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const { width: sw, height: sh, data: s } = src;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyHomography(H, { x, y });
      const o = (y * outW + x) * 4;
      if (p.x < 0 || p.y < 0 || p.x > sw - 1 || p.y > sh - 1) {
        out[o] = out[o + 1] = out[o + 2] = 255;
        out[o + 3] = 255;
        continue;
      }
      const x0 = Math.floor(p.x);
      const y0 = Math.floor(p.y);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = p.x - x0;
      const fy = p.y - y0;
      for (let c = 0; c < 3; c++) {
        const a = s[(y0 * sw + x0) * 4 + c]!;
        const b = s[(y0 * sw + x1) * 4 + c]!;
        const d = s[(y1 * sw + x0) * 4 + c]!;
        const e = s[(y1 * sw + x1) * 4 + c]!;
        out[o + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { image: { width: outW, height: outH, data: out }, H };
}

export function toGray(img: RGBAImage): GrayImage {
  const n = img.width * img.height;
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    g[i] = Math.round(0.299 * img.data[i * 4]! + 0.587 * img.data[i * 4 + 1]! + 0.114 * img.data[i * 4 + 2]!);
  }
  return { width: img.width, height: img.height, data: g };
}

/** Box blur via an integral image (used to flatten uneven lighting). */
export function boxBlur(g: GrayImage, r: number): Float32Array {
  const { width: w, height: h, data } = g;
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x]!;
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1]! + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = I[y1 * (w + 1) + x1]! - I[y0 * (w + 1) + x1]! - I[y1 * (w + 1) + x0]! + I[y0 * (w + 1) + x0]!;
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

export function otsu(values: Uint8Array): { threshold: number; separation: number } {
  const hist = new Array<number>(256).fill(0);
  for (const v of values) hist[v]!++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0,
    wB = 0,
    best = 0,
    threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  // Normalized separation in [0,1]: how bimodal the image is.
  let mean = sum / total;
  let varT = 0;
  for (let i = 0; i < 256; i++) varT += hist[i]! * (i - mean) ** 2;
  mean = 0;
  return { threshold, separation: varT > 0 ? best / total / (varT || 1) : 0 };
}

export interface InkMask {
  width: number;
  height: number;
  mask: Uint8Array;
  threshold: number;
  separation: number;
  inkFraction: number;
}

/** Flatten lighting (divide by a large blur), then Otsu → ink mask (1 = ink). */
export function inkMask(g: GrayImage): InkMask {
  const { width: w, height: h } = g;
  const r = Math.max(8, Math.round(Math.min(w, h) / 12));
  const bg = boxBlur(g, r);
  const norm = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) norm[i] = Math.max(0, Math.min(255, Math.round((g.data[i]! / Math.max(bg[i]!, 1)) * 235)));
  const { threshold, separation } = otsu(norm);
  // Ink must be clearly darker than paper: cap the threshold so plain paper noise is ignored.
  const t = Math.min(threshold, 200);
  const mask = new Uint8Array(w * h);
  let ink = 0;
  for (let i = 0; i < w * h; i++) {
    if (norm[i]! < t) {
      mask[i] = 1;
      ink++;
    }
  }
  const closed = close(mask, w, h);
  return { width: w, height: h, mask: closed, threshold: t, separation, inkFraction: ink / (w * h) };
}

/** Morphological close (3×3 dilate then erode) to join small gaps in pencil lines. */
function close(m: Uint8Array, w: number, h: number): Uint8Array {
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx]) {
            v = 1;
            break;
          }
        }
      dil[y * w + x] = v;
    }
  const ero = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dy = -1; dy <= 1 && v; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && !dil[yy * w + xx]) {
            v = 0;
            break;
          }
        }
      ero[y * w + x] = v;
    }
  return ero;
}

export interface Component {
  label: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixels: Int32Array;
}

/** 8-connected component labelling (iterative flood fill). */
export function components(m: InkMask): { labels: Int32Array; comps: Component[] } {
  const { width: w, height: h, mask } = m;
  const labels = new Int32Array(w * h);
  const comps: Component[] = [];
  const stack = new Int32Array(w * h);
  let next = 1;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i]) continue;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = next;
    const px: number[] = [];
    let minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    while (sp) {
      const p = stack[--sp]!;
      px.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (mask[q] && !labels[q]) {
            labels[q] = next;
            stack[sp++] = q;
          }
        }
    }
    comps.push({ label: next, area: px.length, minX, minY, maxX, maxY, pixels: Int32Array.from(px) });
    next++;
  }
  return { labels, comps };
}

/**
 * Outer contour of a component via Moore-neighbour tracing on its hole-filled mask.
 * Returns ordered boundary pixels (closed loop) in rectified px.
 */
export function outerContour(c: Component, w: number): { contour: Vec[]; filledArea: number; holeArea: number } {
  const bw = c.maxX - c.minX + 3;
  const bh = c.maxY - c.minY + 3;
  const local = new Uint8Array(bw * bh);
  for (const p of c.pixels) {
    const x = (p % w) - c.minX + 1;
    const y = Math.floor(p / w) - c.minY + 1;
    local[y * bw + x] = 1;
  }
  // Flood the outside from the padded border; everything not reached is inside the shape.
  const outside = new Uint8Array(bw * bh);
  const stack: number[] = [0];
  outside[0] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % bw;
    const y = (p - x) / bw;
    const nb = [p - 1, p + 1, p - bw, p + bw];
    const ok = [x > 0, x < bw - 1, y > 0, y < bh - 1];
    for (let k = 0; k < 4; k++) {
      const q = nb[k]!;
      if (ok[k] && !outside[q] && !local[q]) {
        outside[q] = 1;
        stack.push(q);
      }
    }
  }
  let filledArea = 0;
  for (let i = 0; i < bw * bh; i++) if (!outside[i]) filledArea++;
  const holeArea = filledArea - c.area;
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < bw && y < bh && !outside[y * bw + x];
  // Start: first filled pixel in raster order.
  let start = -1;
  for (let i = 0; i < bw * bh && start < 0; i++) if (!outside[i]) start = i;
  if (start < 0) return { contour: [], filledArea, holeArea };
  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ] as const;
  const sx = start % bw;
  const sy = (start - sx) / bw;
  const contour: Vec[] = [];
  let cx = sx,
    cy = sy;
  let dir = 7; // came from the west-ish (raster order start)
  const maxLen = 20000;
  for (let n = 0; n < maxLen; n++) {
    contour.push({ x: cx - 1 + c.minX, y: cy - 1 + c.minY });
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;
      const nx = cx + dirs[d]![0];
      const ny = cy + dirs[d]![1];
      if (filled(nx, ny)) {
        cx = nx;
        cy = ny;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (cx === sx && cy === sy && contour.length > 2) break;
  }
  return { contour, filledArea, holeArea };
}

export interface Candidate {
  id: string;
  /** Outer contour in rectified px. */
  contour: Vec[];
  bboxPx: [number, number, number, number];
  /** Same fitter as freehand drawing, run in WORLD units. */
  fit: StrokeFit;
  areaPx: number;
  holeFraction: number;
  ignored: string | null;
  notes: string[];
}

export interface RecognitionResult {
  width: number;
  height: number;
  threshold: number;
  separation: number;
  inkFraction: number;
  candidates: Candidate[];
  ignoredSpecks: number;
  timings: Record<string, number>;
}

export interface RecognizeOptions {
  world: { width: number; height: number };
}

/** Rectified px → normalized [0,1] → world units. Explicit, invertible. */
export function rectToWorld(p: Vec, rectW: number, rectH: number, world: { width: number; height: number }): Vec {
  return { x: (p.x / rectW) * world.width, y: (p.y / rectH) * world.height };
}

export function worldToRect(p: Vec, rectW: number, rectH: number, world: { width: number; height: number }): Vec {
  return { x: (p.x / world.width) * rectW, y: (p.y / world.height) * rectH };
}

/** Map a rectified-px point back onto the ORIGINAL photo (for alignment overlays). */
export function rectToOriginal(p: Vec, H: Homography): Vec {
  return applyHomography(H, p);
}

export function originalToRect(p: Vec, H: Homography): Vec {
  return applyHomography(invertHomography(H), p);
}

export function recognizeShapes(rect: RGBAImage, opts: RecognizeOptions): RecognitionResult {
  const timings: Record<string, number> = {};
  let t = performance.now();
  const gray = toGray(rect);
  const ink = inkMask(gray);
  timings.threshold = Math.round(performance.now() - t);
  t = performance.now();
  const { comps } = components(ink);
  timings.components = Math.round(performance.now() - t);
  t = performance.now();
  const W = rect.width;
  const Hh = rect.height;
  const diag = Math.hypot(W, Hh);
  const minArea = Math.max(25, W * Hh * 0.0002);
  const cands: Candidate[] = [];
  let specks = 0;
  const sorted = comps.slice().sort((a, b) => b.area - a.area).slice(0, 80);
  for (const c of comps) if (c.area < minArea || Math.hypot(c.maxX - c.minX, c.maxY - c.minY) < diag * 0.02) specks++;
  let idx = 1;
  for (const c of sorted) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    if (c.area < minArea || Math.hypot(bw, bh) < diag * 0.02) continue;
    const notes: string[] = [];
    let ignored: string | null = null;
    const touches = (c.minX <= 1 ? 1 : 0) + (c.minY <= 1 ? 1 : 0) + (c.maxX >= W - 2 ? 1 : 0) + (c.maxY >= Hh - 2 ? 1 : 0);
    if (touches >= 2 && bw * bh > W * Hh * 0.25) ignored = "Touches the photo edges — probably the paper edge or a shadow.";
    // Thin marks hugging one border are almost always the table or paper edge after cropping.
    const band = Math.max(4, Math.round(Math.min(W, Hh) * 0.03));
    if (!ignored && (c.maxY < band || c.minY > Hh - 1 - band || c.maxX < band || c.minX > W - 1 - band)) {
      ignored = "Runs along the photo edge — probably the table or the paper edge.";
    }
    const { contour, filledArea, holeArea } = outerContour(c, W);
    if (contour.length < 8) continue;
    const worldPts: Point[] = contour.map((p) => {
      const q = rectToWorld(p, W, Hh, opts.world);
      return [q.x, q.y] as Point;
    });
    // A closed loop: repeat the first point so the fitter sees it as closed.
    worldPts.push(worldPts[0]!);
    const fit = fitStroke(worldPts, { world: opts.world });
    const holeFraction = filledArea > 0 ? holeArea / filledArea : 0;
    if (fit.kind === "rect" && fit.role === "block" && holeFraction > 0.2) notes.push("Drawn as an outline (hollow) — treated as a solid block.");
    cands.push({
      id: `s${idx++}`,
      contour,
      bboxPx: [c.minX, c.minY, c.maxX, c.maxY],
      fit,
      areaPx: c.area,
      holeFraction: Math.round(holeFraction * 100) / 100,
      ignored,
      notes,
    });
  }
  markBullseyes(cands);
  timings.fitting = Math.round(performance.now() - t);
  return { width: W, height: Hh, threshold: ink.threshold, separation: ink.separation, inkFraction: ink.inkFraction, candidates: cands, ignoredSpecks: specks, timings };
}

/** Concentric circles → a target zone (the inner ring is folded into it). */
function markBullseyes(cands: Candidate[]) {
  for (const outer of cands) {
    if (outer.ignored || outer.fit.kind !== "circle") continue;
    const [ox0, oy0, ox1, oy1] = outer.bboxPx;
    for (const inner of cands) {
      if (inner === outer || inner.ignored) continue;
      const [ix0, iy0, ix1, iy1] = inner.bboxPx;
      const inside = ix0 > ox0 && iy0 > oy0 && ix1 < ox1 && iy1 < oy1;
      if (!inside) continue;
      const ocx = (ox0 + ox1) / 2,
        ocy = (oy0 + oy1) / 2;
      const icx = (ix0 + ix1) / 2,
        icy = (iy0 + iy1) / 2;
      const centred = Math.hypot(ocx - icx, ocy - icy) < (ox1 - ox0) * 0.2;
      if (centred && (inner.fit.kind === "circle" || inner.areaPx < outer.areaPx * 0.5)) {
        outer.fit = { ...outer.fit, role: "target", alternatives: ["ball", "block"], note: `${outer.fit.note}; concentric rings` };
        outer.notes.push("Concentric rings look like a bullseye — read as a target zone.");
        inner.ignored = `Inner ring of target ${outer.id}.`;
      }
    }
  }
}

/** Estimated paper aspect (width/height) from the quad's average side lengths. */
export function estimateAspect(q: Quad): number {
  const d = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
  const w = (d(q[0], q[1]) + d(q[3], q[2])) / 2;
  const h = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
  return h > 0 ? w / h : 1;
}

/** Rectified working size for a quad: long side `maxSide` px, aspect preserved. */
export function rectSize(q: Quad, maxSide = 900): { width: number; height: number; aspect: number } {
  const aspect = Math.min(4, Math.max(0.25, estimateAspect(q)));
  return aspect >= 1
    ? { width: maxSide, height: Math.round(maxSide / aspect), aspect }
    : { width: Math.round(maxSide * aspect), height: maxSide, aspect };
}

/** World size for an imported drawing: 600 u tall, width follows the paper's aspect. */
export function worldForAspect(aspect: number): { width: number; height: number } {
  const height = 600;
  const width = Math.round(Math.min(2400, Math.max(400, height * aspect)));
  return { width, height };
}

/**
 * Best-effort paper detection: the largest bright region containing the image centre,
 * reduced to 4 corners by extreme projections. Returns null when unsure.
 */
export function findPaperQuad(img: RGBAImage): Quad | null {
  const step = Math.max(1, Math.round(Math.max(img.width, img.height) / 400));
  const w = Math.floor(img.width / step);
  const h = Math.floor(img.height / step);
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * step * img.width + x * step) * 4;
      g[y * w + x] = Math.round(0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!);
    }
  const { threshold, separation } = otsu(g);
  if (separation < 0.5) return null;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = g[i]! > threshold ? 1 : 0;
  // Close small gaps from ink so the paper is one blob.
  const { comps } = components({ width: w, height: h, mask, threshold, separation, inkFraction: 0 });
  const cx = Math.floor(w / 2),
    cy = Math.floor(h / 2);
  const paper = comps
    .filter((c) => c.minX <= cx && c.maxX >= cx && c.minY <= cy && c.maxY >= cy)
    .sort((a, b) => b.area - a.area)[0];
  if (!paper || paper.area < w * h * 0.15) return null;
  if (paper.minX <= 0 && paper.minY <= 0 && paper.maxX >= w - 1 && paper.maxY >= h - 1 && paper.area > w * h * 0.97) return null;
  let tl = { s: Infinity, p: { x: 0, y: 0 } },
    br = { s: -Infinity, p: { x: 0, y: 0 } },
    tr = { s: -Infinity, p: { x: 0, y: 0 } },
    bl = { s: Infinity, p: { x: 0, y: 0 } };
  for (const p of paper.pixels) {
    const x = p % w;
    const y = (p - x) / w;
    if (x + y < tl.s) tl = { s: x + y, p: { x, y } };
    if (x + y > br.s) br = { s: x + y, p: { x, y } };
    if (x - y > tr.s) tr = { s: x - y, p: { x, y } };
    if (x - y < bl.s) bl = { s: x - y, p: { x, y } };
  }
  const sc = (v: Vec) => ({ x: (v.x + 0.5) * step, y: (v.y + 0.5) * step });
  return [sc(tl.p), sc(tr.p), sc(br.p), sc(bl.p)];
}
