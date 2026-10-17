/**
 * Local project persistence (browser localStorage) with schema versioning.
 * Every load re-validates the SceneSpec; nothing is trusted just because it was saved.
 * localStorage is per-browser and typically limited to ~5 MB — use JSON export for backups.
 */
import { z } from "zod";
import { validateSceneInput } from "../scene/validate";
import type { SceneSpec } from "../scene/spec";

export const PROJECT_SCHEMA = "doodlelab.project";
export const PROJECT_VERSION = 1;
const INDEX_KEY = "doodlelab.v1.index";
const PROJECT_KEY = (id: string) => `doodlelab.v1.project.${id}`;
const AUTOSAVE_KEY = "doodlelab.v1.autosave";
const SETTINGS_KEY = "doodlelab.v1.settings";
/** Photos larger than this are not stored in localStorage (quota). */
export const MAX_STORED_PHOTO_CHARS = 1_500_000;

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
  objectCount: number;
}

export interface ProjectFile {
  schema: typeof PROJECT_SCHEMA;
  version: typeof PROJECT_VERSION;
  id: string;
  name: string;
  updatedAt: string;
  notes: string;
  scene: unknown;
  photo?: { src: string; width: number; height: number } | null;
}

const Meta = z.object({ id: z.string(), name: z.string(), updatedAt: z.string(), objectCount: z.number() });
const Index = z.object({ version: z.literal(1), projects: z.array(Meta) });

function store(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function listProjects(s: StorageLike | null = store()): ProjectMeta[] {
  if (!s) return [];
  try {
    const raw = s.getItem(INDEX_KEY);
    if (!raw) return [];
    const r = Index.safeParse(JSON.parse(raw));
    return r.success ? r.data.projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  } catch {
    return [];
  }
}

export type SaveResult = { ok: true; id: string; photoDropped: boolean } | { ok: false; error: string };

export function saveProject(
  input: { id?: string | null; name: string; scene: SceneSpec; notes?: string; photo?: ProjectFile["photo"] },
  s: StorageLike | null = store(),
  now = new Date(),
): SaveResult {
  if (!s) return { ok: false, error: "Browser storage is not available (private mode?). Use Export JSON instead." };
  const id = input.id || `p-${now.getTime().toString(36)}`;
  let photo = input.photo ?? null;
  let photoDropped = false;
  if (photo && photo.src.length > MAX_STORED_PHOTO_CHARS) {
    photo = null;
    photoDropped = true;
  }
  const file: ProjectFile = {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    id,
    name: input.name.slice(0, 80) || "Untitled",
    updatedAt: now.toISOString(),
    notes: (input.notes ?? "").slice(0, 4000),
    scene: input.scene,
    photo,
  };
  try {
    s.setItem(PROJECT_KEY(id), JSON.stringify(file));
    const others = listProjects(s).filter((p) => p.id !== id);
    const meta: ProjectMeta = { id, name: file.name, updatedAt: file.updatedAt, objectCount: input.scene.objects.length };
    s.setItem(INDEX_KEY, JSON.stringify({ version: 1, projects: [meta, ...others] }));
    return { ok: true, id, photoDropped };
  } catch (e) {
    const quota = e instanceof Error && /quota/i.test(e.name + e.message);
    return { ok: false, error: quota ? "Browser storage is full. Delete old projects or use Export JSON." : `Could not save: ${String(e)}` };
  }
}

export type LoadResult =
  | { ok: true; project: Omit<ProjectFile, "scene"> & { scene: SceneSpec }; warnings: string[] }
  | { ok: false; error: string };

export function parseProjectOrScene(raw: unknown): LoadResult {
  // Accept a full project file or a bare SceneSpec export.
  const obj = raw as Omit<Partial<ProjectFile>, "schema"> & { schema?: string };
  if (obj && obj.schema === PROJECT_SCHEMA) {
    if (obj.version !== PROJECT_VERSION) return { ok: false, error: `Unsupported project version ${String(obj.version)}.` };
    const v = validateSceneInput(obj.scene);
    if (!v.ok || !v.scene) return { ok: false, error: `Invalid scene: ${v.issues.map((i) => i.message).join("; ")}` };
    return {
      ok: true,
      project: { schema: PROJECT_SCHEMA, version: PROJECT_VERSION, id: String(obj.id ?? ""), name: String(obj.name ?? "Imported"), updatedAt: String(obj.updatedAt ?? ""), notes: String(obj.notes ?? ""), photo: obj.photo ?? null, scene: v.scene },
      warnings: v.issues.map((i) => i.message),
    };
  }
  if (obj && obj.schema === "doodlelab.scene") {
    const v = validateSceneInput(obj);
    if (!v.ok || !v.scene) return { ok: false, error: `Invalid scene: ${v.issues.map((i) => i.message).join("; ")}` };
    return {
      ok: true,
      project: { schema: PROJECT_SCHEMA, version: PROJECT_VERSION, id: "", name: v.scene.title, updatedAt: "", notes: "", photo: null, scene: v.scene },
      warnings: v.issues.map((i) => i.message),
    };
  }
  return { ok: false, error: "This file is not a DoodleLab scene or project." };
}

export function loadProject(id: string, s: StorageLike | null = store()): LoadResult {
  if (!s) return { ok: false, error: "Browser storage is not available." };
  const raw = s.getItem(PROJECT_KEY(id));
  if (!raw) return { ok: false, error: "Project not found." };
  try {
    return parseProjectOrScene(JSON.parse(raw));
  } catch {
    return { ok: false, error: "Saved project is corrupted (not valid JSON)." };
  }
}

export function deleteProject(id: string, s: StorageLike | null = store()): void {
  if (!s) return;
  s.removeItem(PROJECT_KEY(id));
  s.setItem(INDEX_KEY, JSON.stringify({ version: 1, projects: listProjects(s).filter((p) => p.id !== id) }));
}

export function autosave(scene: SceneSpec, s: StorageLike | null = store()): void {
  try {
    s?.setItem(AUTOSAVE_KEY, JSON.stringify({ schema: "doodlelab.autosave", version: 1, scene }));
  } catch {
    /* quota: autosave is best-effort */
  }
}

export function loadAutosave(s: StorageLike | null = store()): SceneSpec | null {
  try {
    const raw = s?.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const v = validateSceneInput((JSON.parse(raw) as { scene: unknown }).scene);
    return v.scene && v.ok ? v.scene : null;
  } catch {
    return null;
  }
}

export function saveSettings(settings: object, s: StorageLike | null = store()): void {
  try {
    s?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function loadSettings<T>(s: StorageLike | null = store()): Partial<T> {
  try {
    const raw = s?.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Partial<T>) : {};
  } catch {
    return {};
  }
}

export function downloadText(filename: string, text: string, type = "application/json"): void {
  const blob = new Blob([text], { type });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "doodlelab";
}
