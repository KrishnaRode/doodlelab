/**
 * Client-side view of local AI availability + cancellable, revision-guarded requests.
 */
import { create } from "zustand";
import type { AiStatus } from "../ai/ollama";
import { useLab } from "./store";

interface AiState {
  status: AiStatus | null;
  checking: boolean;
  checkedAt: number | null;
  refresh: () => Promise<AiStatus | null>;
}

export const useAi = create<AiState>((set, get) => ({
  status: null,
  checking: false,
  checkedAt: null,
  refresh: async () => {
    if (get().checking) return get().status;
    set({ checking: true });
    try {
      const res = await fetch("/api/ai/status", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const status = (await res.json()) as AiStatus;
      set({ status, checkedAt: Date.now() });
      // Fill in defaults only if the user has not chosen (or their choice disappeared).
      const lab = useLab.getState();
      const names = new Set(status.models.filter((m) => !m.cloud).map((m) => m.name));
      const patch: { textModel?: string | null; visionModel?: string | null } = {};
      if (!lab.settings.textModel || !names.has(lab.settings.textModel)) patch.textModel = status.defaults.text;
      const visionNames = new Set(status.models.filter((m) => !m.cloud && m.capabilities.includes("vision")).map((m) => m.name));
      if (!lab.settings.visionModel || !visionNames.has(lab.settings.visionModel)) patch.visionModel = status.defaults.vision;
      if (Object.keys(patch).length) lab.setSettings(patch);
      return status;
    } catch (e) {
      const status: AiStatus = { reachable: false, url: "", version: null, models: [], defaults: { text: null, vision: null }, error: e instanceof Error ? e.message : String(e) };
      set({ status, checkedAt: Date.now() });
      return status;
    } finally {
      set({ checking: false });
    }
  },
}));

export interface AiCallError {
  ok: false;
  code: string;
  message: string;
}

/**
 * POST to an AI route with cancellation. Returns `stale: true` when the authored scene changed
 * while the model was thinking — callers must not apply stale results.
 */
export async function aiPost<T>(
  path: string,
  body: unknown,
  signal: AbortSignal,
  revisionAtStart: number,
): Promise<{ data: T | AiCallError; stale: boolean }> {
  let data: T | AiCallError;
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    data = (await res.json()) as T | AiCallError;
  } catch (e) {
    const cancelled = signal.aborted || (e as { name?: string })?.name === "AbortError";
    data = { ok: false, code: cancelled ? "cancelled" : "network", message: cancelled ? "Cancelled" : "Could not reach the DoodleLab server" };
  }
  return { data, stale: useLab.getState().revision !== revisionAtStart };
}

export function friendlyAiError(code: string, message: string): string {
  switch (code) {
    case "ollama-offline":
      return "Ollama is not running. Start it with: ollama serve";
    case "model-missing":
      return `${message}. Pull it with ollama pull, or choose another model in Settings.`;
    case "timeout":
      return `${message}. Try again, or use a smaller model.`;
    case "cancelled":
      return "Cancelled.";
    default:
      return message;
  }
}
