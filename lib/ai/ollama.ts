/**
 * Server-side Ollama client. Used only from app/api/ai/* route handlers.
 * - Bounded by timeouts and the caller's AbortSignal (cancel from the UI propagates here).
 * - Inspects real installed models + capabilities via /api/show; cloud models are flagged
 *   and never auto-selected.
 * - Structured output via JSON-schema `format`; `think:false` for thinking models
 *   (qwen3 otherwise leaves `content` empty or narrates its reasoning).
 */
import { z } from "zod";

export const OLLAMA_URL = (process.env.OLLAMA_HOST?.startsWith("http") ? process.env.OLLAMA_HOST : process.env.OLLAMA_HOST ? `http://${process.env.OLLAMA_HOST}` : "http://127.0.0.1:11434").replace(/\/$/, "");

export function ollamaUrl(): string {
  // Read lazily so tests can point at an unreachable host.
  const h = process.env.DOODLELAB_OLLAMA_URL || OLLAMA_URL;
  return h.replace(/\/$/, "");
}

export type AiErrorCode = "ollama-offline" | "model-missing" | "no-model" | "timeout" | "cancelled" | "bad-json" | "http" | "invalid-output";

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ModelInfo {
  name: string;
  sizeBytes: number;
  parameterSize: string | null;
  family: string | null;
  capabilities: string[];
  cloud: boolean;
}

export interface AiStatus {
  reachable: boolean;
  url: string;
  version: string | null;
  models: ModelInfo[];
  defaults: { text: string | null; vision: string | null };
  error?: string;
}

/** Preference order for defaults; only used if actually installed. */
export const TEXT_MODEL_PREFERENCE = ["qwen3:4b", "qwen2.5:3b", "qwen2.5:7b", "llama3.2:3b", "llama3.2", "gemma3:4b", "phi4-mini"];
export const VISION_MODEL_PREFERENCE = ["qwen2.5vl:3b", "qwen2.5vl:7b", "gemma3:4b", "llava:7b", "llama3.2-vision", "moondream"];

/** Approximate download sizes (qwen3:4b from `ollama list` on the build machine; others per the Ollama library). */
export const KNOWN_MODEL_SIZES: Record<string, string> = {
  "qwen3:4b": "≈2.5 GB",
  "qwen2.5vl:3b": "≈3.2 GB",
  moondream: "≈1.7 GB",
};

const showCache = new Map<string, { digest: string; caps: string[]; family: string | null; params: string | null; remote: boolean }>();

async function fetchJson(path: string, init: RequestInit & { timeoutMs: number; signal?: AbortSignal }): Promise<unknown> {
  const signals = [AbortSignal.timeout(init.timeoutMs)];
  if (init.signal) signals.push(init.signal);
  const signal = AbortSignal.any(signals);
  let res: Response;
  try {
    res = await fetch(`${ollamaUrl()}${path}`, { ...init, signal, cache: "no-store" });
  } catch (e) {
    throw mapFetchError(e, init.signal, init.timeoutMs);
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    if (res.status === 404 && /model/i.test(text)) throw new AiError("model-missing", extractError(text) || "Model not found");
    throw new AiError("http", `Ollama returned HTTP ${res.status}: ${extractError(text) || text.slice(0, 160)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("bad-json", "Ollama returned a non-JSON response");
  }
}

function extractError(text: string): string | null {
  try {
    const j = JSON.parse(text) as { error?: string };
    return j.error ?? null;
  } catch {
    return null;
  }
}

export function mapFetchError(e: unknown, callerSignal: AbortSignal | undefined, timeoutMs: number): AiError {
  if (callerSignal?.aborted) return new AiError("cancelled", "Request cancelled");
  const name = (e as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") return new AiError("timeout", `The local model did not answer within ${Math.round(timeoutMs / 1000)} s`);
  return new AiError("ollama-offline", "Ollama is not running. Start it with: ollama serve");
}

export function isCloudModel(name: string, remote: boolean): boolean {
  return remote || /(^|[-:])cloud\b/i.test(name);
}

export async function getStatus(): Promise<AiStatus> {
  const url = ollamaUrl();
  let version: string | null = null;
  try {
    const v = (await fetchJson("/api/version", { method: "GET", timeoutMs: 2500 })) as { version?: string };
    version = v.version ?? null;
  } catch (e) {
    return { reachable: false, url, version: null, models: [], defaults: { text: null, vision: null }, error: e instanceof AiError ? e.message : String(e) };
  }
  const tags = (await fetchJson("/api/tags", { method: "GET", timeoutMs: 4000 }).catch(() => ({ models: [] }))) as {
    models?: Array<{ name: string; size?: number; digest?: string; remote_host?: string; details?: { family?: string; parameter_size?: string } }>;
  };
  const models: ModelInfo[] = [];
  for (const m of tags.models ?? []) {
    let info = showCache.get(m.name);
    if (!info || info.digest !== m.digest) {
      try {
        const s = (await fetchJson("/api/show", { method: "POST", body: JSON.stringify({ model: m.name }), headers: { "content-type": "application/json" }, timeoutMs: 5000 })) as {
          capabilities?: string[];
          details?: { family?: string; parameter_size?: string };
          remote_host?: string;
        };
        info = {
          digest: m.digest ?? "",
          caps: s.capabilities ?? [],
          family: s.details?.family ?? m.details?.family ?? null,
          params: s.details?.parameter_size ?? m.details?.parameter_size ?? null,
          remote: !!(s.remote_host || m.remote_host),
        };
        showCache.set(m.name, info);
      } catch {
        info = { digest: m.digest ?? "", caps: [], family: m.details?.family ?? null, params: m.details?.parameter_size ?? null, remote: !!m.remote_host };
      }
    }
    models.push({
      name: m.name,
      sizeBytes: m.size ?? 0,
      parameterSize: info.params,
      family: info.family,
      capabilities: info.caps,
      cloud: isCloudModel(m.name, info.remote),
    });
  }
  return { reachable: true, url, version, models, defaults: pickDefaults(models) };
}

export function pickDefaults(models: ModelInfo[]): { text: string | null; vision: string | null } {
  const local = models.filter((m) => !m.cloud);
  const text = local.filter((m) => m.capabilities.includes("completion") || m.capabilities.length === 0);
  const vision = local.filter((m) => m.capabilities.includes("vision"));
  const pref = (list: ModelInfo[], order: string[]) =>
    order.map((n) => list.find((m) => m.name === n || m.name === `${n}:latest`)).find(Boolean)?.name ?? list[0]?.name ?? null;
  return { text: pref(text, TEXT_MODEL_PREFERENCE), vision: pref(vision, VISION_MODEL_PREFERENCE) };
}

export interface ChatJsonOptions<T> {
  model: string;
  system: string;
  user: string;
  images?: string[];
  schema: z.ZodType<T>;
  timeoutMs: number;
  signal?: AbortSignal;
  temperature?: number;
  numPredict?: number;
}

/** One structured chat call; validates the output against `schema`. One retry on bad JSON. */
export async function chatJson<T>(opts: ChatJsonOptions<T>): Promise<{ data: T; ms: number; raw: string }> {
  const jsonSchema = z.toJSONSchema(opts.schema, { target: "draft-7", io: "input" });
  const started = Date.now();
  let lastErr: AiError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = opts.timeoutMs - (Date.now() - started);
    if (remaining < 1500) break;
    const body = {
      model: opts.model,
      stream: false,
      think: false,
      format: jsonSchema,
      keep_alive: "10m",
      options: { temperature: opts.temperature ?? 0.2, num_ctx: 6144, num_predict: opts.numPredict ?? 700 },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user, ...(opts.images?.length ? { images: opts.images } : {}) },
      ],
    };
    let res: { message?: { content?: string; thinking?: string } };
    try {
      res = (await fetchJson("/api/chat", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        timeoutMs: remaining,
        signal: opts.signal,
      })) as typeof res;
    } catch (e) {
      if (e instanceof AiError && e.code === "http" && /think/i.test(e.message)) {
        // Older Ollama / non-thinking models may reject `think`; retry without it.
        delete (body as { think?: boolean }).think;
        continue;
      }
      throw e;
    }
    const raw = res.message?.content?.trim() || res.message?.thinking?.trim() || "";
    const parsed = parseModelJson(raw, opts.schema);
    if (parsed.ok) return { data: parsed.data, ms: Date.now() - started, raw };
    lastErr = new AiError(parsed.code, parsed.message);
  }
  throw lastErr ?? new AiError("timeout", "The local model ran out of time");
}

/** Defensive JSON extraction + validation. Exported for tests. */
export function parseModelJson<T>(raw: string, schema: z.ZodType<T>): { ok: true; data: T } | { ok: false; code: "bad-json" | "invalid-output"; message: string } {
  if (!raw) return { ok: false, code: "bad-json", message: "The model returned an empty answer" };
  let text = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, code: "bad-json", message: "The model did not return JSON" };
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, code: "bad-json", message: "The model returned malformed JSON" };
  }
  const r = schema.safeParse(value);
  if (!r.success) {
    return { ok: false, code: "invalid-output", message: `The model's answer did not match the expected shape (${r.error.issues[0]?.path.join(".") || "root"}: ${r.error.issues[0]?.message})` };
  }
  return { ok: true, data: r.data };
}
