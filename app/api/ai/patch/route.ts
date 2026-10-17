import { z } from "zod";
import { AiError, chatJson } from "@/lib/ai/ollama";
import { AiPatchOutput, PATCH_SYSTEM, patchUserPrompt } from "@/lib/ai/prompts";
import { convertAiPatch } from "@/lib/ai/convert";
import { aiErrorResponse, badRequest } from "@/lib/ai/http";
import { applyPatch } from "@/lib/scene/patch";
import { SceneSpec } from "@/lib/scene/spec";

export const dynamic = "force-dynamic";

const Body = z.object({
  request: z.string().min(1).max(400),
  scene: SceneSpec,
  selection: z.array(z.string().max(40)).max(60).default([]),
  model: z.string().min(1).max(120),
  timeoutMs: z.number().int().min(3000).max(120_000).default(45_000),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid request: " + (parsed.error.issues[0]?.message ?? ""));
  const { request, scene, selection, model, timeoutMs } = parsed.data;
  try {
    const { data, ms } = await chatJson({
      model,
      system: PATCH_SYSTEM,
      user: patchUserPrompt(request, scene, selection),
      schema: AiPatchOutput,
      timeoutMs,
      signal: req.signal,
      temperature: 0.1,
      numPredict: 600,
    });
    if (!data.understood || data.ops.length === 0) {
      return Response.json({ ok: true, kind: "clarify", question: data.clarifyingQuestion || "I'm not sure what to change — could you name the object?", ms, model });
    }
    const conv = convertAiPatch(data, scene);
    if (!conv.patch) {
      return Response.json({ ok: true, kind: "rejected", reasons: conv.rejected, summary: data.summary, ms, model });
    }
    const result = applyPatch(scene, conv.patch);
    if (!result.ok) {
      return Response.json({ ok: true, kind: "rejected", reasons: [...conv.rejected, ...result.errors], summary: data.summary, ms, model });
    }
    return Response.json({ ok: true, kind: "patch", patch: conv.patch, changes: result.changes, rejected: conv.rejected, ms, model });
  } catch (e) {
    if (!(e instanceof AiError)) console.error("[patch]", e);
    return aiErrorResponse(e);
  }
}
