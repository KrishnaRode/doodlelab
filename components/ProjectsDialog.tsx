"use client";

import { useState } from "react";
import { FolderOpen, Trash2, X } from "lucide-react";
import { useLab } from "@/lib/state/store";
import { deleteProject, listProjects, loadProject } from "@/lib/state/persistence";
import { getController } from "@/lib/state/controller";

export function ProjectsDialog() {
  const [projects, setProjects] = useState(() => listProjects());
  const close = () => useLab.getState().set({ projectsOpen: false });
  const open = (id: string) => {
    const r = loadProject(id);
    const st = useLab.getState();
    if (!r.ok) {
      st.notify(r.error, "bad");
      return;
    }
    getController().backToEdit();
    st.replaceScene(r.project.scene, { photo: r.project.photo ?? null, projectId: id });
    st.set({ tool: "select" });
    st.notify(`Opened “${r.project.name}”.`, "ok");
    close();
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={close}>
      <div className="w-full max-w-[520px] animate-rise rounded-2xl border border-border bg-chrome p-5 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Saved projects">
        <div className="flex items-center">
          <h2 className="text-lg font-bold">Saved in this browser</h2>
          <button className="btn btn-ghost btn-icon ml-auto h-8 w-8" onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          {projects.length === 0 && <p className="text-sm text-text-muted">No saved projects yet. Use File → Save to this browser.</p>}
          {projects.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-xl border border-border bg-panel p-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{p.name}</div>
                <div className="text-[11px] text-text-faint">{new Date(p.updatedAt).toLocaleString()} · {p.objectCount} objects</div>
              </div>
              <button className="btn h-8 text-xs" onClick={() => open(p.id)}>
                <FolderOpen size={14} /> Open
              </button>
              <button className="btn btn-ghost btn-icon h-8 w-8 text-bad" aria-label={`Delete ${p.name}`} onClick={() => { deleteProject(p.id); setProjects(listProjects()); }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-text-faint">Stored in this browser only (localStorage, typically ≈5 MB). Clearing site data removes them — export JSON for backups.</p>
      </div>
    </div>
  );
}
