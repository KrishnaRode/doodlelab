/**
 * Explain flow state lives outside components so switching tray tabs never cancels a request.
 */
import { create } from "zustand";
import { buildFacts, type Fact, type RunRecord } from "../explain/facts";
import { ruleBasedExplanation, type Explanation } from "../explain/rules";
import { runHeadless } from "../physics/simulation";
import { getController } from "./controller";
import { useLab } from "./store";
import { aiPost, friendlyAiError, useAi } from "./ai";

export interface ExplainState {
  draft: string;
  setDraft: (q: string) => void;
  question: string;
  facts: Fact[];
  source: "live" | "archived" | "headless" | null;
  rules: Explanation | null;
  ai: { explanation: Explanation; ms: number; model: string; removed: string[]; stale: boolean } | null;
  aiState: "idle" | "thinking" | "error";
  aiError: string | null;
  startedAt: number | null;
  controller: AbortController | null;
  run: (question: string) => void;
  askAi: () => void;
  cancel: () => void;
}

export const useExplain = create<ExplainState>((set, get) => ({
  draft: "Explain what happened",
  setDraft: (q) => set({ draft: q }),
  question: "Explain what happened",
  facts: [],
  source: null,
  rules: null,
  ai: null,
  aiState: "idle",
  aiError: null,
  startedAt: null,
  controller: null,

  run: (question) => {
    get().cancel();
    set({ draft: question });
    const lab = useLab.getState();
    const c = getController();
    let current: RunRecord;
    let previous: RunRecord | null = null;
    let source: ExplainState["source"];
    if (c.sim && c.sim.steps > 0) {
      current = { spec: c.sim.spec, summary: c.sim.summary() };
      previous = lab.runs[lab.runs.length - 1] ?? null;
      source = "live";
    } else if (lab.runs.length) {
      current = lab.runs[lab.runs.length - 1]!;
      previous = lab.runs[lab.runs.length - 2] ?? null;
      source = "archived";
    } else {
      if (!lab.scene.objects.length) {
        set({ question, facts: [], rules: null, ai: null, source: null, aiState: "idle", aiError: "Nothing to explain yet — draw something and bring it to life." });
        return;
      }
      current = { spec: lab.scene, summary: runHeadless(lab.scene) };
      source = "headless";
    }
    const facts = buildFacts(current.spec, current.summary, previous);
    const rules = ruleBasedExplanation(current.spec, current.summary, facts, question, lab.selection);
    set({ question, facts, source, rules, ai: null, aiState: "idle", aiError: null });
    const ai = useAi.getState().status;
    if (ai?.reachable && lab.settings.textModel) get().askAi();
  },

  askAi: () => {
    const { facts, question } = get();
    const model = useLab.getState().settings.textModel;
    if (!facts.length || !model) return;
    get().controller?.abort();
    const ctrl = new AbortController();
    const rev = useLab.getState().revision;
    set({ aiState: "thinking", aiError: null, ai: null, startedAt: Date.now(), controller: ctrl });
    void aiPost<{ ok: true; explanation: Explanation; ms: number; model: string; removed: string[] }>("/api/ai/explain", { question, facts, model }, ctrl.signal, rev).then(({ data, stale }) => {
      if (get().controller !== ctrl) return; // superseded by a newer request
      if (!data.ok) {
        set({ aiState: data.code === "cancelled" ? "idle" : "error", aiError: data.code === "cancelled" ? null : friendlyAiError(data.code, data.message), controller: null, startedAt: null });
        return;
      }
      set({ ai: { explanation: data.explanation, ms: data.ms, model: data.model, removed: data.removed, stale }, aiState: "idle", controller: null, startedAt: null });
    });
  },

  cancel: () => {
    const c = get().controller;
    if (c) {
      c.abort();
      set({ controller: null, aiState: "idle", startedAt: null });
    }
  },
}));
