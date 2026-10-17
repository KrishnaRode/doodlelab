"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Camera, ChevronDown, FileJson, FolderOpen, ImageDown, Plus, Save, Stethoscope, Upload } from "lucide-react";
import { appConfig } from "@/app.config";
import { SAMPLES } from "@/lib/scene/samples";
import { loadSample, newScene } from "@/lib/state/actions";
import { useLab } from "@/lib/state/store";
import { useAi } from "@/lib/state/ai";
import { downloadText, parseProjectOrScene, saveProject, slug } from "@/lib/state/persistence";
import { getController } from "@/lib/state/controller";
import { exportPng } from "@/lib/render/exportPng";
import { Logo } from "./Logo";

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", h);
    return () => window.removeEventListener("pointerdown", h);
  }, [open, close]);
  return ref;
}

export function TopBar() {
  const title = useLab((s) => s.scene.title);
  const dirty = useLab((s) => s.dirty);
  const ai = useAi((s) => s.status);
  const textModel = useLab((s) => s.settings.textModel);
  const [menu, setMenu] = useState<null | "samples" | "file">(null);
  const close = () => setMenu(null);
  const samplesRef = useOutside(menu === "samples", close);
  const fileRef = useOutside(menu === "file", close);
  const importInput = useRef<HTMLInputElement>(null);

  const setTitle = (t: string) => {
    const st = useLab.getState();
    const next = structuredClone(st.scene);
    next.title = t.slice(0, 80) || "Untitled experiment";
    st.commit(next);
  };

  const save = () => {
    const st = useLab.getState();
    const r = saveProject({ id: st.projectId, name: st.scene.title, scene: st.scene, photo: st.photo });
    if (r.ok) {
      st.set({ projectId: r.id, dirty: false });
      st.notify(r.photoDropped ? "Saved (the photo was too large for browser storage and was not saved)." : "Saved to this browser.", r.photoDropped ? "warn" : "ok");
    } else st.notify(r.error, "bad");
    close();
  };

  const exportJson = () => {
    const st = useLab.getState();
    downloadText(`${slug(st.scene.title)}.doodlelab.json`, JSON.stringify(st.scene, null, 2));
    close();
  };

  const onImportFile = async (f: File | undefined) => {
    if (!f) return;
    const st = useLab.getState();
    try {
      const r = parseProjectOrScene(JSON.parse(await f.text()));
      if (!r.ok) {
        st.notify(r.error, "bad");
        return;
      }
      getController().backToEdit();
      st.replaceScene(r.project.scene, { photo: r.project.photo ?? null });
      st.notify(`Imported “${r.project.scene.title}”${r.warnings.length ? ` with ${r.warnings.length} warning(s) to review` : ""}.`, r.warnings.length ? "warn" : "ok");
    } catch {
      st.notify("That file is not valid JSON.", "bad");
    }
  };

  const aiDot = !ai ? "bg-text-faint" : !ai.reachable ? "bg-bad" : textModel ? "bg-ok" : "bg-warn";
  const aiLabel = !ai ? "Checking…" : !ai.reachable ? "Ollama offline" : textModel ? textModel : "No model";

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-3">
      <div className="flex items-center gap-2.5">
        <Logo className="h-7 w-7" />
        <div className="leading-tight">
          <div className="text-[15px] font-bold tracking-tight">{appConfig.name}</div>
          <div className="hidden text-[10px] font-medium text-text-faint lg:block">{appConfig.seriesShort}</div>
        </div>
      </div>
      <div className="mx-1 h-6 w-px bg-border" />
      <input
        aria-label="Experiment title"
        className="min-w-0 max-w-[260px] flex-1 truncate rounded-md bg-transparent px-2 py-1 text-sm font-medium text-text hover:bg-panel focus:bg-panel focus:outline-none"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      {dirty && <span className="hidden text-[11px] text-text-faint md:inline">unsaved</span>}
      <div className="ml-auto flex items-center gap-1.5">
        <div className="relative" ref={samplesRef}>
          <button className="btn" onClick={() => setMenu(menu === "samples" ? null : "samples")} aria-expanded={menu === "samples"}>
            <BookOpen size={15} /> Samples <ChevronDown size={14} />
          </button>
          {menu === "samples" && (
            <div className="absolute right-0 top-11 z-50 w-80 animate-rise rounded-xl border border-border bg-panel p-1.5 shadow-2xl">
              {SAMPLES.map((s) => (
                <button key={s.id} className="w-full rounded-lg p-2.5 text-left hover:bg-panel-hover" onClick={() => { loadSample(s); close(); }}>
                  <div className="text-sm font-semibold">{s.title}</div>
                  <div className="text-xs text-text-muted">{s.blurb}</div>
                </button>
              ))}
              <div className="px-2.5 pb-1 pt-2 text-[11px] text-text-faint">Samples are built-in scenes, not recognised drawings.</div>
            </div>
          )}
        </div>
        <button className="btn" onClick={() => useLab.getState().set({ importOpen: true })}>
          <Camera size={15} /> Photo
        </button>
        <div className="relative" ref={fileRef}>
          <button className="btn" onClick={() => setMenu(menu === "file" ? null : "file")} aria-expanded={menu === "file"}>
            <FolderOpen size={15} /> File <ChevronDown size={14} />
          </button>
          {menu === "file" && (
            <div className="absolute right-0 top-11 z-50 w-64 animate-rise rounded-xl border border-border bg-panel p-1.5 shadow-2xl">
              <MenuItem icon={<Plus size={15} />} label="New blank scene" onClick={() => { newScene(); close(); }} />
              <MenuItem icon={<Save size={15} />} label="Save to this browser" onClick={save} />
              <MenuItem icon={<FolderOpen size={15} />} label="Open saved projects…" onClick={() => { useLab.getState().set({ projectsOpen: true }); close(); }} />
              <div className="my-1 h-px bg-border-soft" />
              <MenuItem icon={<FileJson size={15} />} label="Export scene JSON" onClick={exportJson} />
              <MenuItem icon={<Upload size={15} />} label="Import scene JSON…" onClick={() => { importInput.current?.click(); close(); }} />
              <MenuItem icon={<ImageDown size={15} />} label="Export PNG with notes" onClick={() => { void exportPng(); close(); }} />
              <div className="px-2.5 pb-1 pt-2 text-[11px] leading-snug text-text-faint">
                Browser storage is local to this browser and limited (≈5 MB). Export JSON for backups.
              </div>
            </div>
          )}
        </div>
        <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void onImportFile(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="btn" onClick={() => useLab.getState().set({ readinessOpen: true })} title="Demo readiness check and model settings" data-testid="readiness-button">
          <span className={`h-2 w-2 rounded-full ${aiDot}`} />
          <span className="hidden max-w-[120px] truncate sm:inline">{aiLabel}</span>
          <Stethoscope size={15} />
        </button>
      </div>
    </header>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-panel-hover" onClick={onClick}>
      <span className="text-text-muted">{icon}</span>
      {label}
    </button>
  );
}

