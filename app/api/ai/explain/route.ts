import { z } from "zod";
import { AiError, chatJson } from "@/lib/ai/ollama";
import { AiExplainOutput, EXPLAIN_SYSTEM, explainUserPrompt } from "@/lib/ai/prompts";
import { aiErrorResponse, badRequest } from "@/lib/ai/http";
import { groundText, validCitations } from "@/lib/explain/ground";

export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().min(1).max(300),
  facts: z
    .array(z.object({ id: z.string().max(6), kind: z.enum(["measured", "setting", "change"]), text: z.string().max(400), numbers: z.array(z.number()).max(40), subject: z.string().max(40).optional() }))
    .min(1)
    .max(120),
  model: z.string().min(1).max(120),
  timeoutMs: z.number().int().min(3000).max(120_000).default(60_000),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid request: " + (parsed.error.issues[0]?.message ?? ""));
  const { question, facts, model, timeoutMs } = parsed.data;
  try {
    const { data, ms } = await chatJson({
      model,
      system: EXPLAIN_SYSTEM,
      user: explainUserPrompt(question, facts),
      schema: AiExplainOutput,
      timeoutMs,
      signal: req.signal,
      temperature: 0.3,
      numPredict: 700,
    });
    const child = groundText(data.child, facts);
    const deeper = groundText(data.deeper, facts);
    const reasons = data.reasons
      .map((r) => ({ text: groundText(r.text, facts), factIds: validCitations(r.factIds, facts) }))
      .filter((r) => r.text.text.length > 0);
    const removed = [...child.removed, ...deeper.removed, ...reasons.flatMap((r) => r.text.removed)];
    if (!child.text && !deeper.text) {
      return Response.json({ ok: false, code: "invalid-output", message: "The model's explanation quoted numbers that were not measured, so it was discarded." }, { status: 502 });
    }
    return Response.json({
      ok: true,
      explanation: { child: child.text, deeper: deeper.text, reasons: reasons.map((r) => ({ text: r.text.text, factIds: r.factIds })) },
      removed,
      ms,
      model,
    });
  } catch (e) {
    if (!(e instanceof AiError)) console.error("[explain]", e);
    return aiErrorResponse(e);
  }
}
