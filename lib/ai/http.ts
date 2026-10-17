import { AiError, type AiErrorCode } from "./ollama";

const STATUS: Record<AiErrorCode, number> = {
  "ollama-offline": 503,
  "model-missing": 404,
  "no-model": 409,
  timeout: 504,
  cancelled: 499,
  "bad-json": 502,
  "invalid-output": 502,
  http: 502,
};

export function aiErrorResponse(e: unknown): Response {
  if (e instanceof AiError) return Response.json({ ok: false, code: e.code, message: e.message }, { status: STATUS[e.code] });
  return Response.json({ ok: false, code: "http", message: e instanceof Error ? e.message : "Unexpected error" }, { status: 500 });
}

export function badRequest(message: string): Response {
  return Response.json({ ok: false, code: "bad-request", message }, { status: 400 });
}
