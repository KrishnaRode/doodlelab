/**
 * Convert the model's flat op list into strict ScenePatch ops. Anything incomplete or
 * referencing unknown IDs is rejected with a reason — never "fixed up" silently.
 */
import { makeObject, nextId } from "../scene/objects";
import type { PatchOp, ScenePatch } from "../scene/patch";
import type { SceneSpec } from "../scene/spec";
import type { AiPatchOutput } from "./prompts";

export interface ConvertResult {
  patch: ScenePatch | null;
  rejected: string[];
}

export function convertAiPatch(out: AiPatchOutput, scene: SceneSpec): ConvertResult {
  const ids = new Set(scene.objects.map((o) => o.id));
  const ops: PatchOp[] = [];
  const rejected: string[] = [];
  const taken = new Set<string>();
  const need = (cond: boolean, msg: string) => {
    if (!cond) rejected.push(msg);
    return cond;
  };
  for (const op of out.ops) {
    const idOk = () => need(!!op.objectId && ids.has(op.objectId), `${op.op}: unknown object "${op.objectId ?? "?"}"`);
    switch (op.op) {
      case "set":
        if (idOk() && need(!!op.field && typeof op.value === "number", "set: needs field and value"))
          ops.push({ op: "set", objectId: op.objectId!, field: op.field!, value: op.value! });
        break;
      case "setMaterial":
        if (idOk() && need(!!op.material, "setMaterial: missing material")) ops.push({ op: "setMaterial", objectId: op.objectId!, material: op.material! });
        break;
      case "setRole":
        if (idOk() && need(!!op.role, "setRole: missing role")) ops.push({ op: "setRole", objectId: op.objectId!, role: op.role! });
        break;
      case "setStatic":
        if (idOk() && need(typeof op.isStatic === "boolean", "setStatic: missing isStatic")) ops.push({ op: "setStatic", objectId: op.objectId!, isStatic: op.isStatic! });
        break;
      case "move":
        if (idOk() && need(typeof op.dx === "number" || typeof op.dy === "number", "move: missing dx/dy"))
          ops.push({ op: "move", objectId: op.objectId!, dx: op.dx ?? 0, dy: op.dy ?? 0 });
        break;
      case "rotate":
        if (idOk() && need(typeof op.dDeg === "number", "rotate: missing dDeg")) ops.push({ op: "rotate", objectId: op.objectId!, dDeg: op.dDeg! });
        break;
      case "remove":
        if (idOk()) ops.push({ op: "remove", objectId: op.objectId! });
        break;
      case "gravity":
        if (need(!!op.preset, "gravity: missing preset")) {
          if (op.preset === "custom") {
            if (need(typeof op.value === "number", "gravity: custom needs a value")) ops.push({ op: "gravity", preset: "custom", scale: op.value! });
          } else ops.push({ op: "gravity", preset: op.preset! });
        }
        break;
      case "addBall":
      case "addBlock": {
        const role = op.op === "addBall" ? "ball" : "block";
        if (!need(typeof op.x === "number" && typeof op.y === "number", `${op.op}: needs x and y`)) break;
        const id = nextId(scene, role, taken);
        taken.add(id);
        ops.push({
          op: "add",
          object: makeObject({
            id,
            role,
            x: op.x!,
            y: op.y!,
            shape: role === "ball" ? { kind: "circle", radius: 22 } : { kind: "rect", width: 56, height: 56 },
            source: { kind: "copilot", needsReview: false, reasons: [] },
          }),
        });
        break;
      }
    }
  }
  if (!ops.length) return { patch: null, rejected };
  return { patch: { summary: out.summary || "Proposed change", ops }, rejected };
}
