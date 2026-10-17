import Matter from "matter-js";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, node: process.version, matter: (Matter as unknown as { version: string }).version, time: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
