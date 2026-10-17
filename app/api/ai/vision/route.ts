import { z } from "zod";
import { AiError, chatJson, getStatus } from "@/lib/ai/ollama";
import { AiVisionOutput, VISION_SYSTEM, visionUserPrompt } from "@/lib/ai/prompts";
import { aiErrorResponse, badRequest } from "@/lib/ai/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  /** Base64 JPEG/PNG without the data: prefix, already rectified + downscaled by the browser. */
  image: z.string().min(100).max(6_000_000),
  candidates: z
    .array(z.object({ id: z.string().max(12), kind: z.string().max(20), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]) }))
    .max(40),
  model: z.string().min(1).max(120),
  timeoutMs: z.number().int().min(5000).max(180_000).default(90_000),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid request: " + (parsed.error.issues[0]?.message ?? ""));
  const { image, candidates, model, timeoutMs } = parsed.data;
  try {
    const status = await getStatus();
    if (!status.reachable) throw new AiError("ollama-offline", "Ollama is not running. Start it with: ollama serve");
    const info = status.models.find((m) => m.name === model);
    if (!info) throw new AiError("model-missing", `Model "${model}" is not installed`);
    if (info.cloud) throw new AiError("no-model", `"${model}" is a cloud model; DoodleLab only uses local models`);
    if (!info.capabilities.includes("vision")) throw new AiError("no-model", `"${model}" cannot read images (no vision capability)`);
    const { data, ms } = await chatJson({
      model,
      system: VISION_SYSTEM,
      user: visionUserPrompt(candidates),
      images: [image],
      schema: AiVisionOutput,
      timeoutMs,
      signal: req.signal,
      temperature: 0.1,
      numPredict: 500,
    });
    const known = new Set(candidates.map((c) => c.id));
    return Response.json({ ok: true, hints: data.shapes.filter((s) => known.has(s.id)), missed: data.missed ?? [], ms, model });
  } catch (e) {
    if (!(e instanceof AiError)) console.error("[vision]", e);
    return aiErrorResponse(e);
  }
}
