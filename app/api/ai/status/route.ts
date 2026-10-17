import { getStatus } from "@/lib/ai/ollama";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getStatus();
  return Response.json(status, { headers: { "cache-control": "no-store" } });
}
