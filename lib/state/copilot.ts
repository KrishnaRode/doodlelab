/**
 * Copilot flow: deterministic parser first; local LLM only for what it cannot parse.
 * Every edit becomes a validated proposal that needs Apply; stale proposals are refused.
 */
import { create } from "zustand";
import { parseCommand, type ControlAction } from "../copilot/commands";
import { applyPatch, type Change, type ScenePatch } from "../scene/patch";
import type { SceneIssue } from "../scene/validate";
import { getController } from "./controller";
import { useLab } from "./store";
import { aiPost, friendlyAiError, useAi } from "./ai";
import { bringToLife } from "./actions";
import { useExplain } from "./explain";

export type CopilotCard =
  | { kind: "proposal"; text: string; patch: ScenePatch; changes: Change[]; warnings: SceneIssue[]; note?: string; source: string; revision: number; applied: boolean; appliedRevision?: number }
  | { kind: "clarify"; text: string; question: string; options: { label: string; objectId: string }[] }
  | { kind: "info"; text: string; message: string; tone: "info" | "ok" | "warn" | "bad"; examples?: boolean }
  | { kind: "thinking"; text: string; model: string; startedAt: number };

interface CopilotState {
  card: CopilotCard | null;
  controller: AbortController | null;
  submit: (text: string) => void;
  apply: () => void;
  undoApplied: () => void;
  cancel: () => void;
  dismiss: () => void;
}

function runControl(action: ControlAction) {
  const c = getController();
  if (action === "bring-to-life") return bringToLife();
  if (action === "compare") {
    c.pause();
    useLab.getState().set({ compareOpen: true });
    return true;
  }
  if (!c.sim) {
    if (action === "play") return bringToLife();
    return false;
  }
  if (action === "reset") c.reset();
  if (action === "play") c.play();
  if (action === "pause") c.pause();
  return true;
}

export const useCopilot = create<CopilotState>((set, get) => ({
  card: null,
  controller: null,

  submit: (raw) => {
    const text = raw.trim();
    if (!text) return;
    get().cancel();
    const lab = useLab.getState();
    const result = parseCommand(text, { scene: lab.scene, selection: lab.selection });
    switch (result.kind) {
      case "patch": {
        const r = applyPatch(lab.scene, result.patch);
        if (!r.ok) {
          set({ card: { kind: "info", text, message: `Can't do that: ${r.errors.join(" ")}`, tone: "bad" } });
          return;
        }
        set({ card: { kind: "proposal", text, patch: result.patch, changes: r.changes, warnings: r.warnings, note: result.note, source: "Rules (instant, no AI)", revision: lab.revision, applied: false } });
        return;
      }
      case "control": {
        const ok = runControl(result.action);
        set({ card: { kind: "info", text, message: ok ? `Done: ${result.label}.` : result.action === "reset" ? "Nothing to reset — the scene isn't running." : `Couldn't ${result.label.toLowerCase()} right now.`, tone: ok ? "ok" : "warn" } });
        return;
      }
      case "explain":
        lab.set({ trayOpen: true, trayTab: "explain" });
        useExplain.getState().run(result.question);
        set({ card: { kind: "info", text, message: "Explaining from the measured run — see the Explain tab below.", tone: "info" } });
        return;
      case "clarify":
        set({ card: { kind: "clarify", text, question: result.question, options: result.options } });
        return;
      case "error":
        set({ card: { kind: "info", text, message: result.message, tone: "warn" } });
        return;
      case "unknown":
        break;
    }
    // Not in the deterministic vocabulary → ask the local model for a proposal.
    const ai = useAi.getState().status;
    const model = lab.settings.textModel;
    if (!ai?.reachable || !model) {
      set({ card: { kind: "info", text, message: ai?.reachable ? "I didn't understand that, and no local text model is selected for broader requests." : "I didn't understand that, and Ollama is offline, so only the built-in commands work right now.", tone: "warn", examples: true } });
      return;
    }
    const ctrl = new AbortController();
    const rev = lab.revision;
    set({ controller: ctrl, card: { kind: "thinking", text, model, startedAt: Date.now() } });
    type PatchResp =
      | { ok: true; kind: "patch"; patch: ScenePatch; ms: number; model: string; rejected: string[] }
      | { ok: true; kind: "clarify"; question: string; ms: number }
      | { ok: true; kind: "rejected"; reasons: string[]; summary: string };
    void aiPost<PatchResp>("/api/ai/patch", { request: text, scene: lab.scene, selection: lab.selection, model }, ctrl.signal, rev).then(({ data, stale }) => {
      if (get().controller !== ctrl) return;
      set({ controller: null });
      if (!data.ok) {
        if (data.code === "cancelled") return set({ card: null });
        return set({ card: { kind: "info", text, message: friendlyAiError(data.code, data.message), tone: "bad" } });
      }
      if (stale) return set({ card: { kind: "info", text, message: "The scene changed while the model was thinking, so its proposal was discarded. Ask again.", tone: "warn" } });
      if (data.kind === "clarify") return set({ card: { kind: "info", text, message: data.question, tone: "info" } });
      if (data.kind === "rejected") return set({ card: { kind: "info", text, message: `The model's proposal was rejected by validation: ${data.reasons.slice(0, 3).join("; ")}`, tone: "warn" } });
      // Re-validate against the CURRENT scene before showing it.
      const cur = useLab.getState();
      const r = applyPatch(cur.scene, data.patch);
      if (!r.ok) return set({ card: { kind: "info", text, message: `The model's proposal didn't validate: ${r.errors.join(" ")}`, tone: "warn" } });
      set({ card: { kind: "proposal", text, patch: data.patch, changes: r.changes, warnings: r.warnings, source: `Local AI · ${data.model} · ${(data.ms / 1000).toFixed(1)} s`, revision: cur.revision, applied: false, note: data.rejected.length ? `Ignored: ${data.rejected.join("; ")}` : undefined } });
    });
  },

  apply: () => {
    const card = get().card;
    if (!card || card.kind !== "proposal" || card.applied) return;
    const lab = useLab.getState();
    if (lab.revision !== card.revision) {
      set({ card: { kind: "info", text: card.text, message: "The scene changed since this proposal was made — ask again so it matches.", tone: "warn" } });
      return;
    }
    const r = applyPatch(lab.scene, card.patch);
    if (!r.ok || !r.scene) {
      set({ card: { kind: "info", text: card.text, message: `Could not apply: ${r.errors.join(" ")}`, tone: "bad" } });
      return;
    }
    lab.commit(r.scene, { select: r.touched.filter((id) => r.scene!.objects.some((o) => o.id === id)) });
    set({ card: { ...card, applied: true, appliedRevision: useLab.getState().revision } });
  },

  undoApplied: () => {
    const card = get().card;
    if (card?.kind === "proposal" && card.applied) {
      if (useLab.getState().revision !== card.appliedRevision) {
        set({ card: { kind: "info", text: card.text, message: "Other edits happened after this change — use Undo (⌘Z) to step back through them.", tone: "warn" } });
        return;
      }
      useLab.getState().undo();
      set({ card: { kind: "info", text: card.text, message: "Undone.", tone: "info" } });
    }
  },

  cancel: () => {
    const c = get().controller;
    if (c) {
      c.abort();
      set({ controller: null, card: null });
    }
  },

  dismiss: () => {
    get().cancel();
    set({ card: null });
  },
}));
