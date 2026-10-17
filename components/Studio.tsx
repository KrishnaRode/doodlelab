"use client";

import { useEffect } from "react";
import { StageCanvas } from "./stage/StageCanvas";
import { TopBar } from "./TopBar";
import { ToolRail } from "./ToolRail";
import { PlayBar } from "./PlayBar";
import { Inspector } from "./inspector/Inspector";
import { Tray } from "./tray/Tray";
import { Copilot } from "./copilot/Copilot";
import { StatusPill } from "./StatusPill";
import { EmptyState } from "./EmptyState";
import { Toast } from "./Toast";
import { CompareView } from "./compare/CompareView";
import { ImportDialog } from "./import/ImportDialog";
import { ReadinessDialog } from "./ReadinessDialog";
import { ProjectsDialog } from "./ProjectsDialog";
import { getController } from "@/lib/state/controller";
import { useLab, type Tool } from "@/lib/state/store";
import { useAi } from "@/lib/state/ai";
import { autosave, loadAutosave, loadSettings, saveSettings } from "@/lib/state/persistence";
import { bringToLife } from "@/lib/state/actions";
import type { SceneSpec } from "@/lib/scene/spec";

const TOOL_KEYS: Record<string, Tool> = { v: "select", p: "pencil", b: "ball", k: "block", r: "ramp", g: "ground", t: "target", e: "eraser" };

function onlyGravityChanged(a: SceneSpec, b: SceneSpec): boolean {
  if (a.gravity.scale === b.gravity.scale) return false;
  return JSON.stringify({ ...a, gravity: null, title: null }) === JSON.stringify({ ...b, gravity: null, title: null });
}

export function Studio() {
  const compareOpen = useLab((s) => s.compareOpen);
  const importOpen = useLab((s) => s.importOpen);
  const readinessOpen = useLab((s) => s.readinessOpen);
  const projectsOpen = useLab((s) => s.projectsOpen);
  const inspectorOpen = useLab((s) => s.inspectorOpen);
  // Restore autosave + settings once, then keep the live world in sync and autosave on change.
  useEffect(() => {
    const saved = loadAutosave();
    const st = useLab.getState();
    if (saved && saved.objects.length) {
      st.replaceScene(saved);
      st.set({ tool: "select" });
    }
    const s = loadSettings<typeof st.settings>();
    st.setSettings({
      ...(typeof s.speed === "number" ? { speed: s.speed } : {}),
      ...(typeof s.trails === "boolean" ? { trails: s.trails } : {}),
      ...(typeof s.vectors === "boolean" ? { vectors: s.vectors } : {}),
      ...(typeof s.textModel === "string" ? { textModel: s.textModel } : {}),
      ...(typeof s.visionModel === "string" ? { visionModel: s.visionModel } : {}),
      ...(typeof s.useVision === "boolean" ? { useVision: s.useVision } : {}),
    });
    void useAi.getState().refresh();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useLab.subscribe((cur, prev) => {
      if (cur.settings !== prev.settings) saveSettings(cur.settings);
      if (cur.scene === prev.scene) return;
      const c = getController();
      if (c.sim && cur.mode !== "edit") {
        if (onlyGravityChanged(prev.scene, cur.scene)) c.setGravity(cur.scene.gravity);
        else {
          c.reset();
          cur.notify("Scene edited — the run was reset to the new starting setup.", "info");
        }
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => autosave(useLab.getState().scene), 400);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Keyboard shortcuts (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const st = useLab.getState();
      if (st.compareOpen || st.importOpen) return;
      const c = getController();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod) return;
      if (e.key === " ") {
        if (st.mode === "live") {
          e.preventDefault();
          c.toggle();
        }
        return;
      }
      if (e.key === "Enter" && st.mode === "edit") {
        e.preventDefault();
        bringToLife();
        return;
      }
      if (e.key === "Escape") {
        if (st.mode !== "edit") c.backToEdit();
        else st.select([]);
        return;
      }
      if (st.mode === "live" && e.key.toLowerCase() === "r") {
        c.reset();
        return;
      }
      if (st.mode === "live" && e.key === ".") {
        c.stepOnce();
        return;
      }
      if (st.mode !== "edit") return;
      if ((e.key === "Delete" || e.key === "Backspace") && st.selection.length) {
        e.preventDefault();
        st.removeObjects(st.selection);
        return;
      }
      if (e.key.startsWith("Arrow") && st.selection.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
        const next = structuredClone(st.scene);
        for (const o of next.objects) if (st.selection.includes(o.id)) {
          o.x += dx;
          o.y += dy;
        }
        st.commit(next);
        return;
      }
      const t = TOOL_KEYS[e.key.toLowerCase()];
      if (t) st.setTool(t);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => getController().stop(), []);

  // Read-only inspection hook used by the browser tests (no setters are exposed).
  useEffect(() => {
    (window as unknown as { __doodlelab?: object }).__doodlelab = {
      scene: () => structuredClone(useLab.getState().scene),
      snapshot: () => getController().sim?.snapshot() ?? null,
      summary: () => getController().summary(),
      status: () => getController().currentStatus,
    };
  }, []);

  return (
    <div className="relative z-10 flex h-dvh flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ToolRail />
        <main className="flex min-w-0 flex-1 flex-col gap-2 px-2 pb-2">
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-[#0d1530] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.8)]">
            <StageCanvas />
            <StatusPill />
            <EmptyState />
            <Copilot />
            {compareOpen && <CompareView />}
          </div>
          <PlayBar />
          <Tray />
        </main>
        {inspectorOpen && <Inspector />}
      </div>
      {importOpen && <ImportDialog />}
      {readinessOpen && <ReadinessDialog />}
      {projectsOpen && <ProjectsDialog />}
      <Toast />
    </div>
  );
}
