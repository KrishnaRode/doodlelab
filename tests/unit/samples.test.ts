import { describe, expect, it } from "vitest";
import { physicsSelfTest, sampleChecks } from "@/lib/physics/selftest";
import { bounceToTarget } from "@/lib/scene/samples";
import { runHeadless } from "@/lib/physics/simulation";
import { searchTarget } from "@/lib/physics/solver";

describe("sample scenes run through the same compiler and behave as designed", () => {
  it("physics self-test passes", () => {
    expect(physicsSelfTest().ok).toBe(true);
  });

  it("domino chain, gravity playground and bounce puzzle outcomes hold", () => {
    const r = sampleChecks();
    for (const [k, v] of Object.entries(r)) expect(v.ok, `${k}: ${v.detail}`).toBe(true);
  });

  it("bounce puzzle is not pixel-perfect: the outcome survives small nudges", () => {
    for (const dx of [-12, 0, 12]) {
      for (const drot of [-2, 0, 2]) {
        const s = bounceToTarget();
        const ball = s.objects.find((o) => o.id === "ball-1")!;
        ball.material = "bouncy";
        ball.x += dx;
        s.objects.find((o) => o.id === "ramp-1")!.rotationDeg += drot;
        expect(runHeadless(s).goal!.reached, `dx ${dx} drot ${drot}`).toBe(true);
      }
    }
  });
});

describe("domino chain is a repeatable, quick chain reaction", () => {
  it("all dominoes fall within 6 s even when the ball start is nudged", async () => {
    const { dominoChain } = await import("@/lib/scene/samples");
    for (const dx of [-8, 0, 8]) {
      const s = dominoChain();
      s.objects.find((o) => o.id === "ball-1")!.x += dx;
      const r = runHeadless(s, { durationSec: 6 });
      const tipped = Object.values(r.bodies).filter((b) => b.role === "domino" && Math.abs(Math.sin((b.finalAngleDeg * Math.PI) / 180)) > Math.SQRT1_2).length;
      expect(tipped, `dx ${dx}`).toBe(8);
    }
  });
});

describe("target search", () => {
  it("only reports tested settings and finds a bounce that reaches the shelf", async () => {
    const out = await searchTarget(bounceToTarget(), { kind: "bounce", objectId: "ball-1" });
    expect(out.results).toHaveLength(13);
    expect(out.best).not.toBeNull();
    expect(out.best!.tested).toBe(true);
    // The best candidate is real: re-running it reproduces the hit.
    expect(runHeadless(out.best!.spec).goal!.reached).toBe(true);
  });

  it("says when nothing in the range works", async () => {
    const s = bounceToTarget();
    s.objects.find((o) => o.id === "target-1")!.x = 880; // high in the far corner: out of reach
    s.objects.find((o) => o.id === "target-1")!.y = 60;
    const out = await searchTarget(s, { kind: "release-x", objectId: "ball-1" });
    expect(out.best).toBeNull();
  });
});
