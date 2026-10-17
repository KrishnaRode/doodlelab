import { describe, expect, it } from "vitest";
import { findPaperQuad, fullQuad, otsu, recognizeShapes, rectSize, warpToRect, worldForAspect, type RGBAImage, type Quad } from "@/lib/vision/pipeline";
import { applyHomography, homographyFromQuad } from "@/lib/geometry/transforms";

/** Paper image with dark pen marks drawn as thick strokes. */
function paper(w: number, h: number): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const shade = 236 + ((i * 2654435761) >>> 28); // light paper + faint deterministic noise
    data[i * 4] = shade;
    data[i * 4 + 1] = shade - 4;
    data[i * 4 + 2] = shade - 14;
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}
function dot(img: RGBAImage, x: number, y: number, r = 2.2) {
  for (let yy = Math.floor(y - r); yy <= y + r; yy++)
    for (let xx = Math.floor(x - r); xx <= x + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
      if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
      const o = (yy * img.width + xx) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 40;
    }
}
function strokeLine(img: RGBAImage, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let i = 0; i <= n; i++) dot(img, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
}
function strokeCircle(img: RGBAImage, cx: number, cy: number, r: number) {
  const n = Math.ceil(2 * Math.PI * r);
  for (let i = 0; i <= n; i++) dot(img, cx + Math.cos((i / n) * 2 * Math.PI) * r, cy + Math.sin((i / n) * 2 * Math.PI) * r);
}
function strokeRect(img: RGBAImage, x0: number, y0: number, x1: number, y1: number) {
  strokeLine(img, x0, y0, x1, y0);
  strokeLine(img, x1, y0, x1, y1);
  strokeLine(img, x1, y1, x0, y1);
  strokeLine(img, x0, y1, x0, y0);
}

function drawing(): RGBAImage {
  const img = paper(800, 500);
  strokeCircle(img, 120, 110, 40); // ball
  strokeLine(img, 90, 200, 400, 380); // ramp
  strokeLine(img, 40, 460, 760, 460); // ground
  strokeRect(img, 560, 340, 640, 430); // block
  strokeCircle(img, 640, 140, 60); // target outer
  strokeCircle(img, 640, 140, 22); // target inner
  return img;
}

const roles = (r: ReturnType<typeof recognizeShapes>) =>
  r.candidates.filter((c) => !c.ignored).map((c) => c.fit.role).sort();

describe("image pipeline (deterministic geometry)", () => {
  it("Otsu separates paper from ink", () => {
    const v = new Uint8Array([...Array(900).fill(230), ...Array(100).fill(40)]);
    const { threshold } = otsu(v);
    expect(threshold).toBeGreaterThanOrEqual(40);
    expect(threshold).toBeLessThan(230);
  });

  it("finds ball, ramp, ground, block and a bullseye target on a flat drawing", () => {
    const img = drawing();
    const r = recognizeShapes(img, { world: worldForAspect(800 / 500) });
    expect(roles(r)).toEqual(["ball", "block", "ground", "ramp", "target"]);
    const ball = r.candidates.find((c) => c.fit.role === "ball")!;
    // 120/800 of a 960-wide world = 144 u; radius 40/500 of 600 u ≈ 48 u (outer edge a bit larger)
    expect(ball.fit.x).toBeGreaterThan(134);
    expect(ball.fit.x).toBeLessThan(154);
    expect(ball.fit.shape!.kind).toBe("circle");
    const inner = r.candidates.find((c) => c.ignored?.startsWith("Inner ring"));
    expect(inner).toBeDefined();
  });

  it("recovers the same shapes after a perspective photo + auto paper detection", () => {
    const flat = drawing();
    // Place the paper into a darker "table" photo with perspective.
    const W = 1100,
      H = 800;
    const photo: RGBAImage = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    for (let i = 0; i < W * H; i++) {
      photo.data[i * 4] = 92;
      photo.data[i * 4 + 1] = 70;
      photo.data[i * 4 + 2] = 52;
      photo.data[i * 4 + 3] = 255;
    }
    const corners: Quad = [{ x: 140, y: 120 }, { x: 980, y: 70 }, { x: 1040, y: 720 }, { x: 90, y: 690 }];
    const Hp = homographyFromQuad(corners, fullQuad(flat.width, flat.height));
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = applyHomography(Hp, { x, y });
        if (p.x < 0 || p.y < 0 || p.x >= flat.width - 1 || p.y >= flat.height - 1) continue;
        const s = (Math.round(p.y) * flat.width + Math.round(p.x)) * 4;
        const o = (y * W + x) * 4;
        photo.data[o] = flat.data[s]!;
        photo.data[o + 1] = flat.data[s + 1]!;
        photo.data[o + 2] = flat.data[s + 2]!;
      }
    const quad = findPaperQuad(photo)!;
    expect(quad).not.toBeNull();
    quad.forEach((p, i) => expect(Math.hypot(p.x - corners[i]!.x, p.y - corners[i]!.y)).toBeLessThan(12));
    const size = rectSize(quad, 800);
    const { image } = warpToRect(photo, quad, size.width, size.height);
    const r = recognizeShapes(image, { world: worldForAspect(size.aspect) });
    expect(roles(r)).toEqual(["ball", "block", "ground", "ramp", "target"]);
  });

  it("ignores marks hugging the photo edge and tiny specks", () => {
    const img = paper(600, 400);
    strokeCircle(img, 300, 200, 50);
    strokeLine(img, 2, 50, 2, 350); // paper edge / table sliver
    dot(img, 100, 100, 1.5); // speck
    const r = recognizeShapes(img, { world: worldForAspect(1.5) });
    expect(roles(r)).toEqual(["ball"]);
    expect(r.candidates.find((c) => c.ignored)?.ignored).toMatch(/edge/);
    expect(r.ignoredSpecks).toBeGreaterThanOrEqual(1);
  });

  it("returns nothing (not a guess) for a blank page", () => {
    const r = recognizeShapes(paper(400, 300), { world: worldForAspect(4 / 3) });
    expect(r.candidates.filter((c) => !c.ignored)).toHaveLength(0);
  });
});
