import { describe, expect, it } from "vitest";
import { applyPatch } from "@/lib/scene/patch";
import { dominoChain } from "@/lib/scene/samples";
import { makeObject } from "@/lib/scene/objects";

describe("ScenePatch", () => {
  it("applies allowlisted ops on exact IDs and reports before/after", () => {
    const scene = dominoChain();
    const r = applyPatch(scene, {
      summary: "test",
      ops: [
        { op: "set", objectId: "ball-1", field: "restitution", value: 0.6 },
        { op: "move", objectId: "ramp-1", dx: 0, dy: -20 },
        { op: "gravity", preset: "moon" },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.changes.map((c) => c.what)).toEqual(["bounce (restitution)", "position", "gravity"]);
    expect(r.changes[0]).toMatchObject({ before: "0.05", after: "0.6" });
    expect(r.scene!.objects.find((o) => o.id === "ball-1")!.overrides.restitution).toBe(0.6);
    expect(r.scene!.gravity.scale).toBe(0.165);
  });

  it("never mutates the input scene", () => {
    const scene = dominoChain();
    const before = JSON.stringify(scene);
    applyPatch(scene, { summary: "x", ops: [{ op: "remove", objectId: "ball-1" }] });
    expect(JSON.stringify(scene)).toBe(before);
  });

  it("rejects unknown IDs, out-of-range values and non-allowlisted ops", () => {
    const scene = dominoChain();
    expect(applyPatch(scene, { summary: "x", ops: [{ op: "move", objectId: "ghost-1", dx: 1, dy: 1 }] }).ok).toBe(false);
    expect(applyPatch(scene, { summary: "x", ops: [{ op: "set", objectId: "ball-1", field: "restitution", value: 3 }] }).ok).toBe(false);
    expect(applyPatch(scene, { summary: "x", ops: [{ op: "eval", code: "process.exit()" }] }).ok).toBe(false);
    expect(applyPatch(scene, { summary: "x", ops: [{ op: "set", objectId: "ramp-1", field: "radius", value: 20 }] }).ok).toBe(false);
  });

  it("refuses patches that would create blocking errors", () => {
    const scene = dominoChain();
    const r = applyPatch(scene, { summary: "x", ops: [{ op: "move", objectId: "ball-1", dx: 950, dy: 0 }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/outside the world/);
  });

  it("adds objects with copilot provenance and keeps targets static", () => {
    const scene = dominoChain();
    const target = makeObject({ id: "target-1", role: "target", x: 900, y: 300, shape: { kind: "rect", width: 60, height: 60 } });
    const r = applyPatch(scene, { summary: "x", ops: [{ op: "add", object: target }, { op: "setStatic", objectId: "domino-1", isStatic: true }] });
    expect(r.ok).toBe(true);
    const t = r.scene!.objects.find((o) => o.id === "target-1")!;
    expect(t.isStatic).toBe(true);
    expect(t.source.kind).toBe("copilot");
    expect(applyPatch(r.scene!, { summary: "x", ops: [{ op: "setStatic", objectId: "target-1", isStatic: false }] }).ok).toBe(false);
  });
});
