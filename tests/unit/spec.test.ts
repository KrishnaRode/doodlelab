import { describe, expect, it } from "vitest";
import { SceneSpec, emptyScene, MAX_OBJECTS } from "@/lib/scene/spec";
import { validateSceneInput, semanticIssues } from "@/lib/scene/validate";
import { SAMPLES } from "@/lib/scene/samples";
import { makeObject } from "@/lib/scene/objects";
import { dropScene } from "./helpers";

describe("SceneSpec structural validation", () => {
  it("accepts every built-in sample", () => {
    for (const s of SAMPLES) {
      const r = validateSceneInput(JSON.parse(JSON.stringify(s.build())));
      expect(r.ok, s.id).toBe(true);
      expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    }
  });

  it("rejects non-finite numbers", () => {
    const s = dropScene() as unknown as { objects: Array<{ x: number }> };
    s.objects[1]!.x = Number.NaN;
    expect(validateSceneInput(s).ok).toBe(false);
    s.objects[1]!.x = Infinity;
    expect(SceneSpec.safeParse(s).success).toBe(false);
  });

  it("rejects out-of-range physical parameters", () => {
    const s = dropScene();
    const bad = structuredClone(s) as unknown as { objects: Array<{ overrides: Record<string, number> }> };
    bad.objects[1]!.overrides = { restitution: 1.5 };
    expect(validateSceneInput(bad).ok).toBe(false);
    bad.objects[1]!.overrides = { density: 5 };
    expect(validateSceneInput(bad).ok).toBe(false);
    const tiny = structuredClone(s) as unknown as { objects: Array<{ shape: { radius: number } }> };
    tiny.objects[1]!.shape.radius = 1;
    expect(validateSceneInput(tiny).ok).toBe(false);
  });

  it("rejects bad IDs, too many objects and unknown versions", () => {
    const s = dropScene() as unknown as { objects: Array<{ id: string }>; version: number };
    s.objects[1]!.id = "Ball 1!";
    expect(validateSceneInput(s).ok).toBe(false);
    const many = emptyScene();
    for (let i = 0; i < MAX_OBJECTS + 1; i++) many.objects.push(makeObject({ id: `ball-${i + 1}`, role: "ball", x: 20 + (i % 30) * 30, y: 50 + Math.floor(i / 30) * 60, shape: { kind: "circle", radius: 10 } }));
    expect(validateSceneInput(many).ok).toBe(false);
    const v2 = { ...dropScene(), version: 2 };
    expect(validateSceneInput(v2).ok).toBe(false);
  });

  it("rejects unsupported shapes", () => {
    const s = dropScene() as unknown as { objects: Array<{ shape: unknown }> };
    s.objects[1]!.shape = { kind: "polygon", points: [[0, 0], [10, 0], [5, 5]] };
    expect(validateSceneInput(s).ok).toBe(false);
  });
});

describe("semantic validation", () => {
  it("flags duplicate IDs", () => {
    const s = dropScene();
    s.objects.push({ ...s.objects[1]! });
    expect(semanticIssues(s).some((i) => i.code === "duplicate-id" && i.severity === "error")).toBe(true);
  });

  it("flags dangling constraint and goal references", () => {
    const s = dropScene();
    s.constraints.push({ id: "pin-1", kind: "pin", objectId: "nope", offset: [0, 0] });
    s.goal = { kind: "reach-target", targetId: "ball-1" };
    const codes = semanticIssues(s).map((i) => i.code);
    expect(codes).toContain("bad-reference");
    expect(codes).toContain("goal-target");
  });

  it("flags out-of-bounds geometry with a proposed (not applied) fix", () => {
    const s = dropScene();
    s.objects[1]!.x = 1500;
    const issue = semanticIssues(s).find((i) => i.code === "out-of-bounds")!;
    expect(issue.severity).toBe("error");
    expect(issue.fix?.set.x).toBeLessThan(1000);
    expect(s.objects[1]!.x).toBe(1500); // never silently repaired
  });

  it("detects initial penetration and proposes moving the dynamic object out", () => {
    const s = dropScene(575); // ball centre inside the ground slab
    const issue = semanticIssues(s).find((i) => i.code === "overlap")!;
    expect(issue).toBeDefined();
    expect(issue.objectIds[0]).toBe("ball-1");
    expect(issue.fix!.set.y!).toBeLessThan(575);
  });

  it("warns when nothing static can catch falling objects", () => {
    const s = emptyScene();
    s.objects.push(makeObject({ id: "ball-1", role: "ball", x: 100, y: 100, shape: { kind: "circle", radius: 20 } }));
    expect(semanticIssues(s).some((i) => i.code === "no-support")).toBe(true);
  });
});
