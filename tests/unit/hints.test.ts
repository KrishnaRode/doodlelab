import { describe, expect, it } from "vitest";
import { compareHint } from "@/lib/vision/hints";

describe("vision hint comparison (deterministic)", () => {
  it("agreement never changes anything", () => {
    expect(compareHint("circle", 1, "ball", "round-shape")).toMatchObject({ agrees: true, suggestion: null });
    expect(compareHint("rect", 1.1, "block", "box-or-rectangle").agrees).toBe(true);
    expect(compareHint("line", 40, "ramp", "straight-line").agrees).toBe(true);
    expect(compareHint("circle", 1, "target", "bullseye-rings").agrees).toBe(true);
  });
  it("a thin box (domino) reading as a line is an honest ambiguity, not a disagreement", () => {
    expect(compareHint("rect", 4, "domino", "straight-line").agrees).toBe(true);
    expect(compareHint("rect", 1.2, "block", "straight-line")).toMatchObject({ agrees: false, suggestion: "ramp" });
  });
  it("flags scribbles and suggests targets for bullseyes", () => {
    expect(compareHint("rect", 3.6, "block", "text-or-scribble")).toMatchObject({ agrees: false, suggestion: null });
    expect(compareHint("circle", 1, "ball", "bullseye-rings")).toMatchObject({ agrees: false, suggestion: "target" });
    expect(compareHint("rect", 1, "block", "round-shape")).toMatchObject({ agrees: false, suggestion: "ball" });
  });
});
