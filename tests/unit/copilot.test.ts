import { describe, expect, it } from "vitest";
import { parseCommand } from "@/lib/copilot/commands";
import { applyPatch } from "@/lib/scene/patch";
import { dominoChain, gravityPlayground } from "@/lib/scene/samples";

describe("deterministic copilot vocabulary", () => {
  it("“make this ball bouncier” uses the selection and raises restitution", () => {
    const scene = gravityPlayground();
    const r = parseCommand("Make this ball bouncier", { scene, selection: ["ball-2"] });
    expect(r.kind).toBe("patch");
    if (r.kind !== "patch") return;
    expect(r.patch.ops[0]).toMatchObject({ op: "set", objectId: "ball-2", field: "restitution" });
    expect(applyPatch(scene, r.patch).ok).toBe(true);
  });

  it("asks which object when “this” is ambiguous", () => {
    const r = parseCommand("make the ball bouncier", { scene: gravityPlayground(), selection: [] });
    expect(r.kind).toBe("clarify");
    if (r.kind === "clarify") expect(r.options.map((o) => o.objectId)).toEqual(["ball-1", "ball-2", "ball-3"]);
  });

  it("resolves a clarified object id", () => {
    const r = parseCommand("make the ball bouncier (ball-3)", { scene: gravityPlayground(), selection: [] });
    expect(r.kind === "patch" && r.patch.ops[0]).toMatchObject({ objectId: "ball-3" });
  });

  it("“make gravity weaker” halves gravity", () => {
    const r = parseCommand("Make gravity weaker", { scene: dominoChain(), selection: [] });
    expect(r.kind === "patch" && r.patch.ops[0]).toEqual({ op: "gravity", preset: "custom", scale: 0.5 });
  });

  it("“add three dominoes after the ramp” stands them on the ground past the ramp and validates", () => {
    const scene = dominoChain();
    scene.objects = scene.objects.filter((o) => o.role !== "domino");
    const r = parseCommand("Add three dominoes after the ramp", { scene, selection: [] });
    expect(r.kind).toBe("patch");
    if (r.kind !== "patch") return;
    expect(r.patch.ops).toHaveLength(3);
    const res = applyPatch(scene, r.patch);
    expect(res.ok).toBe(true);
    const added = res.scene!.objects.filter((o) => o.role === "domino");
    expect(added.map((d) => d.id)).toEqual(["domino-1", "domino-2", "domino-3"]);
    for (const d of added) {
      expect(d.x).toBeGreaterThan(400);
      expect(d.y + 40).toBeLessThanOrEqual(570.5); // standing on the ground's top surface
    }
    expect(res.warnings.filter((w) => w.code === "overlap")).toEqual([]);
  });

  it("“raise the selected ramp slightly” moves it up a little", () => {
    const r = parseCommand("Raise the selected ramp slightly", { scene: dominoChain(), selection: ["ramp-1"] });
    expect(r.kind === "patch" && r.patch.ops[0]).toEqual({ op: "move", objectId: "ramp-1", dx: 0, dy: -20 });
  });

  it("controls and explanations never produce scene edits", () => {
    expect(parseCommand("Reset the experiment", { scene: dominoChain(), selection: [] })).toMatchObject({ kind: "control", action: "reset" });
    expect(parseCommand("Explain why the ball stopped", { scene: dominoChain(), selection: [] })).toMatchObject({ kind: "explain" });
  });

  it("falls through to `unknown` for anything else", () => {
    expect(parseCommand("paint the sky purple and add a dragon", { scene: dominoChain(), selection: [] }).kind).toBe("unknown");
  });
});
