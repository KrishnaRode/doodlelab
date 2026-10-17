/**
 * Prompts + output schemas for the three AI tasks. Every output is data validated by Zod;
 * none of it is ever executed.
 */
import { z } from "zod";
import { MATERIALS, ROLES, type SceneSpec } from "../scene/spec";
import { resolveMaterial } from "../scene/materials";
import type { Fact } from "../explain/facts";

// ── 1. Natural-language → ScenePatch proposal ───────────────────────────────

/** A deliberately small, flat op format for small local models; converted to ScenePatch ops. */
export const AiPatchOp = z.object({
  op: z.enum(["set", "setMaterial", "setRole", "setStatic", "move", "rotate", "remove", "gravity", "addBall", "addBlock"]),
  objectId: z.string().max(40).optional(),
  field: z.enum(["x", "y", "rotationDeg", "radius", "width", "height", "restitution", "friction", "density"]).optional(),
  value: z.number().optional(),
  material: z.enum(MATERIALS).optional(),
  role: z.enum(ROLES).optional(),
  isStatic: z.boolean().optional(),
  dx: z.number().optional(),
  dy: z.number().optional(),
  dDeg: z.number().optional(),
  preset: z.enum(["earth", "moon", "zero", "custom"]).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});
export type AiPatchOp = z.infer<typeof AiPatchOp>;

export const AiPatchOutput = z.object({
  understood: z.boolean(),
  summary: z.string().max(200),
  clarifyingQuestion: z.string().max(200).optional(),
  ops: z.array(AiPatchOp).max(12),
});
export type AiPatchOutput = z.infer<typeof AiPatchOutput>;

export function sceneDigest(scene: SceneSpec, selection: string[]): string {
  const lines = scene.objects.map((o) => {
    const m = resolveMaterial(o.material, o.overrides);
    const size = o.shape.kind === "circle" ? `radius ${Math.round(o.shape.radius)}` : `${Math.round(o.shape.width)}x${Math.round(o.shape.height)}`;
    return `- ${o.id}${o.label ? ` "${o.label}"` : ""}: ${o.role}, ${size}, at (${Math.round(o.x)}, ${Math.round(o.y)}), rotation ${Math.round(o.rotationDeg)}°, ${o.isStatic ? "static" : "dynamic"}, material ${o.material} (restitution ${m.restitution}, friction ${m.friction}, density ${m.density})${selection.includes(o.id) ? "  ← SELECTED" : ""}`;
  });
  return [
    `World: ${scene.world.width} wide x ${scene.world.height} tall scene units. Origin top-left, y grows DOWNWARD (so "raise" means smaller y).`,
    `Gravity: ${scene.gravity.scale}x Earth (preset ${scene.gravity.preset}).`,
    `Objects:`,
    ...(lines.length ? lines : ["- (none)"]),
  ].join("\n");
}

export const PATCH_SYSTEM = `You convert a user's request about a 2D physics sketch into a small list of edit operations.
Return ONLY JSON matching the schema. Never write code.
Allowed ops:
- set: change a number. Needs objectId, field (x, y, rotationDeg, radius, width, height, restitution 0-0.95, friction 0-1, density 0.0002-0.02), value.
- setMaterial: objectId + material (bouncy, wood, heavy, slippery, rough).
- setRole: objectId + role (ball, block, domino, ramp, ground, platform, wall, target).
- setStatic: objectId + isStatic.
- move: objectId + dx, dy (scene units; negative dy moves UP).
- rotate: objectId + dDeg (positive = clockwise).
- remove: objectId.
- gravity: preset (earth, moon, zero, custom) and value for custom (0 to 2.5, multiple of Earth).
- addBall / addBlock: x, y.
Rules:
- Use ONLY object IDs that appear in the scene list. "this", "it" and "selected" mean the SELECTED object.
- If the request is ambiguous (several possible objects and none selected) or not about editing the scene, set understood=false, ops=[] and ask a short clarifyingQuestion.
- Keep changes small and only what was asked. Do not invent measurements or outcomes.`;

export function patchUserPrompt(request: string, scene: SceneSpec, selection: string[]): string {
  return `${sceneDigest(scene, selection)}\n\nUser request: "${request}"\n\nReturn JSON with understood, summary, optional clarifyingQuestion, and ops.`;
}

// ── 2. Grounded explanation ─────────────────────────────────────────────────

export const AiExplainOutput = z.object({
  child: z.string().min(1).max(500),
  deeper: z.string().min(1).max(1400),
  reasons: z.array(z.object({ text: z.string().max(300), factIds: z.array(z.string().max(6)).max(8) })).max(5),
});
export type AiExplainOutput = z.infer<typeof AiExplainOutput>;

export const EXPLAIN_SYSTEM = `You are a warm science teacher explaining a 2D physics simulation.
You are given numbered FACTS. Measured facts come from the simulation itself.
Rules:
- Use only the facts. Never invent numbers, forces, energies, friction values or speeds that are not in the facts.
- Distances are "scene units" (u), not metres. Times are simulated seconds.
- Bounce settings and materials are illustrative presets, not real materials.
- In "reasons", list possible explanations and cite the fact IDs (like "F3") that support each.
- "child": 1-3 short sentences a 9-year-old understands. "deeper": a clear explanation for a curious adult (max 6 sentences).
- If the facts cannot answer the question, say what is missing instead of guessing.
Return ONLY JSON.`;

export function explainUserPrompt(question: string, facts: Fact[]): string {
  return `Question: "${question}"\n\nFACTS:\n${facts.map((f) => `${f.id} [${f.kind}] ${f.text}`).join("\n")}\n\nReturn JSON with child, deeper and reasons.`;
}

// ── 3. Vision hints (one small crop per shape) ───────────────────────────────
//
// Measured on the build machine with qwen2.5vl:3b: asking for roles on the whole sheet gave
// ~10/16 agreement and it could not tie IDs to shapes; line ORIENTATION was unreliable even per
// crop. So the model is only asked for a coarse mark class per crop — what geometry cannot know
// (is this a scribble? a bullseye?). Roles and geometry always come from code.

export const MARKS = ["round-shape", "bullseye-rings", "box-or-rectangle", "straight-line", "text-or-scribble"] as const;
export type Mark = (typeof MARKS)[number];

export const AiMarkOutput = z.object({ shape: z.enum(MARKS) });

export const VISION_SYSTEM = "You classify ONE hand-drawn pencil mark shown in a small image. Answer with the single best label. Return only JSON.";

export function visionUserPrompt(): string {
  return `Which label fits this mark best: ${MARKS.join(", ")}?`;
}
