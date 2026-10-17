import { describe, expect, it } from "vitest";
import { fitStroke } from "@/lib/geometry/fit";
import type { Point } from "@/lib/scene/spec";

const world = { width: 1000, height: 600 };
const jitter = (seed: number) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 3;
};

function circle(cx: number, cy: number, r: number, overshoot = 0.08): Point[] {
  const j = jitter(7);
  const pts: Point[] = [];
  for (let i = 0; i <= 80 * (1 + overshoot); i++) {
    const t = (i / 80) * Math.PI * 2;
    pts.push([cx + Math.cos(t) * r + j(), cy + Math.sin(t) * r + j()]);
  }
  return pts;
}
function rect(x0: number, y0: number, x1: number, y1: number): Point[] {
  const j = jitter(3);
  const pts: Point[] = [];
  const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]];
  for (let k = 0; k < 4; k++) for (let i = 0; i < 20; i++) {
    const t = i / 20;
    pts.push([c[k]![0]! + (c[k + 1]![0]! - c[k]![0]!) * t + j(), c[k]![1]! + (c[k + 1]![1]! - c[k]![1]!) * t + j()]);
  }
  return pts;
}
function line(x0: number, y0: number, x1: number, y1: number): Point[] {
  const j = jitter(11);
  return Array.from({ length: 50 }, (_, i) => [x0 + ((x1 - x0) * i) / 49 + j(), y0 + ((y1 - y0) * i) / 49 + j()] as Point);
}

describe("freehand stroke fitting (deterministic, no model)", () => {
  it("circle → ball with a measured deviation", () => {
    const f = fitStroke(circle(300, 200, 50), { world });
    expect(f.kind).toBe("circle");
    expect(f.role).toBe("ball");
    expect(f.shape).toMatchObject({ kind: "circle" });
    expect(f.x).toBeCloseTo(300, -1);
    expect(f.deviation).toBeLessThan(0.08);
    expect(f.note).toMatch(/Circle fit/);
    expect(f.needsReview).toBe(false);
  });

  it("box → block, tall thin box → domino", () => {
    const b = fitStroke(rect(400, 300, 480, 380), { world });
    expect(b.kind).toBe("rect");
    expect(b.role).toBe("block");
    expect(b.rotationDeg).toBe(0);
    const d = fitStroke(rect(600, 400, 616, 490), { world });
    expect(d.role).toBe("domino");
  });

  it("sloped line → static ramp; flat line low down → ground; flat line → platform", () => {
    const r = fitStroke(line(100, 200, 500, 450), { world });
    expect(r.kind).toBe("line");
    expect(r.role).toBe("ramp");
    expect(r.rotationDeg).toBeGreaterThan(25);
    expect(fitStroke(line(30, 560, 970, 562), { world }).role).toBe("ground");
    expect(fitStroke(line(300, 300, 600, 301), { world }).role).toBe("platform");
  });

  it("open curves are not guessed — they need review", () => {
    const pts: Point[] = Array.from({ length: 60 }, (_, i) => [100 + i * 5, 300 + Math.sin(i / 6) * 60] as Point);
    const f = fitStroke(pts, { world });
    expect(f.kind).toBe("unsupported");
    expect(f.needsReview).toBe(true);
    expect(f.reasons[0]).toMatch(/open curve/i);
  });

  it("tiny strokes are rejected", () => {
    expect(fitStroke([[10, 10], [12, 11]], { world }).kind).toBe("too-small");
  });

  it("an oval becomes a ball but is flagged for review", () => {
    const pts = circle(300, 300, 60).map(([x, y]) => [300 + (x - 300) * 1.7, y] as Point);
    const f = fitStroke(pts, { world });
    expect(f.needsReview).toBe(true);
  });
});
