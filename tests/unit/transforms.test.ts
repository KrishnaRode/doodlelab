import { describe, expect, it } from "vitest";
import { applyHomography, fitView, homographyFromQuad, invertHomography, normalizedToWorld, rotatePoint90, screenToWorld, worldToNormalized, worldToScreen } from "@/lib/geometry/transforms";
import { originalToRect, rectToOriginal, rectToWorld, worldForAspect, worldToRect, type Quad, rectifyHomography, estimateAspect } from "@/lib/vision/pipeline";

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("coordinate transforms", () => {
  it("normalized ↔ world round-trips (Y down, no flips)", () => {
    const world = { width: 1000, height: 600 };
    const w = normalizedToWorld({ x: 0.25, y: 0.9 }, world);
    expect(w).toEqual({ x: 250, y: 540 });
    const n = worldToNormalized(w, world);
    close(n.x, 0.25);
    close(n.y, 0.9);
  });

  it("world ↔ screen round-trips through a letterboxed view with insets", () => {
    const v = fitView({ width: 1000, height: 600 }, 1200, 900, 12, { top: 34, bottom: 52 });
    expect(v.scale).toBeGreaterThan(0);
    for (const p of [{ x: 0, y: 0 }, { x: 1000, y: 600 }, { x: 333.3, y: 123.4 }]) {
      const s = worldToScreen(p, v);
      const back = screenToWorld(s, v);
      close(back.x, p.x, 1e-9);
      close(back.y, p.y, 1e-9);
    }
    // World fits inside the viewport minus insets.
    expect(worldToScreen({ x: 0, y: 0 }, v).y).toBeGreaterThanOrEqual(46 - 1e-9);
    expect(worldToScreen({ x: 0, y: 600 }, v).y).toBeLessThanOrEqual(900 - 64 + 1e-9);
  });

  it("homography maps the four quad corners exactly and inverts", () => {
    const src = [{ x: 10, y: 20 }, { x: 900, y: 60 }, { x: 870, y: 700 }, { x: 40, y: 640 }];
    const dst = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 500 }, { x: 0, y: 500 }];
    const H = homographyFromQuad(src, dst);
    src.forEach((p, i) => {
      const q = applyHomography(H, p);
      close(q.x, dst[i]!.x, 1e-6);
      close(q.y, dst[i]!.y, 1e-6);
    });
    const Hi = invertHomography(H);
    const mid = { x: 400, y: 250 };
    const back = applyHomography(H, applyHomography(Hi, mid));
    close(back.x, mid.x, 1e-6);
    close(back.y, mid.y, 1e-6);
  });

  it("rectified px ↔ original photo px round-trips (overlay alignment)", () => {
    const quad: Quad = [{ x: 191, y: 206 }, { x: 1207, y: 95 }, { x: 1336, y: 867 }, { x: 156, y: 934 }];
    const H = rectifyHomography(quad, 900, 616);
    const tl = rectToOriginal({ x: 0, y: 0 }, H);
    close(tl.x, 191, 1e-6);
    close(tl.y, 206, 1e-6);
    const p = { x: 412, y: 300 };
    const o = rectToOriginal(p, H);
    const r = originalToRect(o, H);
    close(r.x, p.x, 1e-6);
    close(r.y, p.y, 1e-6);
  });

  it("rectified px ↔ world is explicit and invertible; world follows paper aspect", () => {
    const world = worldForAspect(1.414);
    expect(world.height).toBe(600);
    expect(world.width).toBe(848);
    const w = rectToWorld({ x: 450, y: 300 }, 900, 636, world);
    const back = worldToRect(w, 900, 636, world);
    close(back.x, 450);
    close(back.y, 300);
    expect(estimateAspect([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }])).toBe(2);
  });

  it("rotates image points by quarter turns", () => {
    expect(rotatePoint90({ x: 10, y: 20 }, 100, 50, 1)).toEqual({ x: 30, y: 10 });
    expect(rotatePoint90({ x: 10, y: 20 }, 100, 50, 2)).toEqual({ x: 90, y: 30 });
    expect(rotatePoint90({ x: 10, y: 20 }, 100, 50, 4)).toEqual({ x: 10, y: 20 });
  });
});
