import { z } from "zod";
import { AiError, chatJson, getStatus } from "@/lib/ai/ollama";
import { AiMarkOutput, VISION_SYSTEM, visionUserPrompt } from "@/lib/ai/prompts";
import { aiErrorResponse, badRequest } from "@/lib/ai/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  /** One small JPEG crop (base64, no data: prefix) per already-found shape. */
  crops: z.array(z.object({ id: z.string().max(12), image: z.string().min(100).max(400_000) })).min(1).max(24),
  model: z.string().min(1).max(120),
  timeoutMs: z.number().int().min(5000).max(180_000).default(90_000),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid request: " + (parsed.error.issues[0]?.message ?? ""));
  const { crops, model, timeoutMs } = parsed.data;
  const started = Date.now();
  try {
    const status = await getStatus();
    if (!status.reachable) throw new AiError("ollama-offline", "Ollama is not running. Start it with: ollama serve");
    const info = status.models.find((m) => m.name === model);
    if (!info) throw new AiError("model-missing", `Model "${model}" is not installed`);
    if (info.cloud) throw new AiError("no-model", `"${model}" is a cloud model; DoodleLab only uses local models`);
    if (!info.capabilities.includes("vision")) throw new AiError("no-model", `"${model}" cannot read images (no vision capability)`);
    const hints: Array<{ id: string; mark: string; ms: number }> = [];
    const skipped: string[] = [];
    for (const c of crops) {
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining < 3000) {
        skipped.push(c.id);
        continue;
      }
      const t = Date.now();
      try {
        const { data } = await chatJson({ model, system: VISION_SYSTEM, user: visionUserPrompt(), images: [c.image], schema: AiMarkOutput, timeoutMs: Math.min(remaining, 30_000), signal: req.signal, temperature: 0, numPredict: 30, keepAlive: "2m" });
        hints.push({ id: c.id, mark: data.shape, ms: Date.now() - t });
      } catch (e) {
        if (e instanceof AiError && (e.code === "cancelled" || e.code === "ollama-offline" || e.code === "model-missing")) throw e;
        skipped.push(c.id); // one unreadable answer must not sink the others
      }
    }
    return Response.json({ ok: true, hints, skipped, ms: Date.now() - started, model });
  } catch (e) {
    if (!(e instanceof AiError)) console.error("[vision]", e);
    return aiErrorResponse(e);
  }
}
