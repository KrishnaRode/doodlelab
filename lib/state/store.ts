/**
 * Authoring state (React-facing). The live physics world is NOT here — it lives in
 * LabController outside React so renders never touch the simulation loop.
 */
import { create } from "zustand";
import type { StrokeFit } from "../geometry/fit";
import type { Point, SceneObject, SceneSpec } from "../scene/spec";
import { emptyScene } from "../scene/spec";
import type { RunRecord } from "../explain/facts";

export type Tool = "select" | "pencil" | "ball" | "block" | "ramp" | "ground" | "target" | "eraser";
export type Mode = "edit" | "transition" | "live";
export type TrayTab = "observe" | "explain" | "challenge" | "events";

export interface PendingStroke {
  id: string;
  points: Point[];
  fit: StrokeFit;
}

export interface Photo {
  /** Rectified photo shown as the paper underlay in edit mode (object URL / data URL). */
  src: string;
  width: number;
  height: number;
}

export interface Settings {
  speed: number;
  trails: boolean;
  vectors: boolean;
  textModel: string | null;
  visionModel: string | null;
  useVision: boolean;
}

const HISTORY_LIMIT = 120;

export interface LabState {
  scene: SceneSpec;
  /** Increments on every authored-scene change; used to discard stale AI responses. */
  revision: number;
  past: SceneSpec[];
  future: SceneSpec[];
  selection: string[];
  tool: Tool;
  mode: Mode;
  pending: PendingStroke[];
  photo: Photo | null;
  projectId: string | null;
  dirty: boolean;
  settings: Settings;
  inspectorOpen: boolean;
  trayOpen: boolean;
  trayTab: TrayTab;
  compareOpen: boolean;
  importOpen: boolean;
  readinessOpen: boolean;
  projectsOpen: boolean;
  runs: RunRecord[];
  toast: { id: number; text: string; tone: "info" | "ok" | "warn" | "bad" } | null;

  commit: (next: SceneSpec, opts?: { keepSelection?: boolean; select?: string[]; coalesce?: string }) => void;
  replaceScene: (next: SceneSpec, opts?: { photo?: Photo | null; projectId?: string | null }) => void;
  undo: () => void;
  redo: () => void;
  updateObject: (id: string, fn: (o: SceneObject) => void, coalesce?: string | false) => void;
  addObjects: (objs: SceneObject[], select?: boolean) => void;
  removeObjects: (ids: string[]) => void;
  select: (ids: string[]) => void;
  setTool: (t: Tool) => void;
  setMode: (m: Mode) => void;
  addPending: (p: PendingStroke) => void;
  removePending: (id: string) => void;
  setSettings: (s: Partial<Settings>) => void;
  set: (p: Partial<LabState>) => void;
  pushRun: (r: RunRecord) => void;
  notify: (text: string, tone?: "info" | "ok" | "warn" | "bad") => void;
}

let toastId = 0;
/** Rapid edits with the same key (slider drags, typing) collapse into one undo step. */
const COALESCE_MS = 900;
let lastCoalesce: { key: string; at: number } | null = null;

export const useLab = create<LabState>((set, get) => ({
  scene: emptyScene(),
  revision: 0,
  past: [],
  future: [],
  selection: [],
  tool: "pencil",
  mode: "edit",
  pending: [],
  photo: null,
  projectId: null,
  dirty: false,
  settings: { speed: 1, trails: true, vectors: false, textModel: null, visionModel: null, useVision: true },
  inspectorOpen: true,
  trayOpen: false,
  trayTab: "observe",
  compareOpen: false,
  importOpen: false,
  readinessOpen: false,
  projectsOpen: false,
  runs: [],
  toast: null,

  commit: (next, opts) => {
    const { scene, past, selection } = get();
    if (next === scene) return;
    const ids = new Set(next.objects.map((o) => o.id));
    const now = Date.now();
    const merge = !!opts?.coalesce && lastCoalesce?.key === opts.coalesce && now - lastCoalesce.at < COALESCE_MS && past.length > 0;
    lastCoalesce = opts?.coalesce ? { key: opts.coalesce, at: now } : null;
    set({
      scene: next,
      past: merge ? past : [...past, scene].slice(-HISTORY_LIMIT),
      future: [],
      revision: get().revision + 1,
      dirty: true,
      selection: opts?.select ?? (opts?.keepSelection === false ? [] : selection.filter((id) => ids.has(id))),
    });
  },
  replaceScene: (next, opts) =>
    set({
      scene: next,
      past: [],
      future: [],
      revision: get().revision + 1,
      selection: [],
      pending: [],
      mode: "edit",
      runs: [],
      dirty: false,
      photo: opts?.photo === undefined ? null : opts.photo,
      projectId: opts?.projectId === undefined ? null : opts.projectId,
    }),
  undo: () => {
    const { past, scene, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    const ids = new Set(prev.objects.map((o) => o.id));
    set({ scene: prev, past: past.slice(0, -1), future: [scene, ...future], revision: get().revision + 1, dirty: true, selection: get().selection.filter((id) => ids.has(id)) });
  },
  redo: () => {
    const { past, scene, future } = get();
    const next = future[0];
    if (!next) return;
    const ids = new Set(next.objects.map((o) => o.id));
    set({ scene: next, past: [...past, scene], future: future.slice(1), revision: get().revision + 1, dirty: true, selection: get().selection.filter((id) => ids.has(id)) });
  },
  updateObject: (id, fn, coalesce) => {
    const next = structuredClone(get().scene);
    const o = next.objects.find((x) => x.id === id);
    if (!o) return;
    fn(o);
    get().commit(next, coalesce === false ? undefined : { coalesce: coalesce ?? `obj:${id}` });
  },
  addObjects: (objs, select = true) => {
    const next = structuredClone(get().scene);
    next.objects.push(...objs);
    get().commit(next, select ? { select: objs.map((o) => o.id) } : undefined);
  },
  removeObjects: (ids) => {
    if (!ids.length) return;
    const drop = new Set(ids);
    const next = structuredClone(get().scene);
    next.objects = next.objects.filter((o) => !drop.has(o.id));
    next.constraints = next.constraints.filter((c) => (c.kind === "pin" ? !drop.has(c.objectId) : !drop.has(c.a) && !(c.b && drop.has(c.b))));
    if (next.goal && (drop.has(next.goal.targetId) || (next.goal.subjectId && drop.has(next.goal.subjectId)))) next.goal = undefined;
    get().commit(next, { keepSelection: false });
  },
  select: (ids) => set({ selection: ids, inspectorOpen: ids.length > 0 ? true : get().inspectorOpen }),
  setTool: (t) => set({ tool: t }),
  setMode: (m) => set({ mode: m }),
  addPending: (p) => set({ pending: [...get().pending, p] }),
  removePending: (id) => set({ pending: get().pending.filter((p) => p.id !== id) }),
  setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
  set: (p) => set(p),
  pushRun: (r) => set({ runs: [...get().runs, r].slice(-6) }),
  notify: (text, tone = "info") => set({ toast: { id: ++toastId, text, tone } }),
}));

export const EMPTY_IDS: string[] = [];
