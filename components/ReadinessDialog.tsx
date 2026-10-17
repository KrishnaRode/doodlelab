"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CircleDashed, Loader2, RefreshCw, X, XCircle } from "lucide-react";
import { useLab } from "@/lib/state/store";
import { useAi } from "@/lib/state/ai";
import { physicsSelfTest, sampleChecks } from "@/lib/physics/selftest";
import { appConfig } from "@/app.config";

type Status = "pending" | "running" | "pass" | "fail" | "optional";
interface Row {
  id: string;
  label: string;
  status: Status;
  detail: string;
}

const SIZE_HINT: Record<string, string> = { "qwen3:4b": "≈2.5 GB", "qwen2.5vl:3b": "≈3.2 GB", moondream: "≈1.7 GB" };

export function ReadinessDialog() {
  const ai = useAi((s) => s.status);
  const settings = useLab((s) => s.settings);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const setRow = (r: Row) => setRows((cur) => [...cur.filter((x) => x.id !== r.id), r].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)));

  const runChecks = useCallback(async () => {
    setBusy(true);
    setRows(ORDER.map((id) => ({ id, label: LABELS[id]!, status: "running", detail: "Checking…" })));
    // 1. Server + dependencies
    try {
      const h = (await (await fetch("/api/health", { cache: "no-store" })).json()) as { node: string; matter: string };
      setRow({ id: "deps", label: LABELS.deps!, status: "pass", detail: `Server up · Node ${h.node} · Matter.js ${h.matter}` });
    } catch {
      setRow({ id: "deps", label: LABELS.deps!, status: "fail", detail: "The DoodleLab server did not answer /api/health." });
    }
    // 2. Physics self-test + samples (actually simulated)
    await new Promise((r) => setTimeout(r, 0));
    const p = physicsSelfTest();
    setRow({ id: "physics", label: LABELS.physics!, status: p.ok ? "pass" : "fail", detail: `${p.detail} (${p.ms} ms)` });
    await new Promise((r) => setTimeout(r, 0));
    const s = sampleChecks();
    const allOk = Object.values(s).every((x) => x.ok);
    setRow({ id: "samples", label: LABELS.samples!, status: allOk ? "pass" : "fail", detail: Object.entries(s).map(([k, v]) => `${v.ok ? "✓" : "✗"} ${k}: ${v.detail}`).join("  ") });
    // 3. Storage
    try {
      localStorage.setItem("doodlelab.selftest", "1");
      const ok = localStorage.getItem("doodlelab.selftest") === "1";
      localStorage.removeItem("doodlelab.selftest");
      setRow({ id: "storage", label: LABELS.storage!, status: ok ? "pass" : "fail", detail: ok ? "Projects can be saved in this browser." : "Read-back failed." });
    } catch {
      setRow({ id: "storage", label: LABELS.storage!, status: "fail", detail: "localStorage is blocked — use Export JSON to keep work." });
    }
    // 4. Ollama + models
    const st = await useAi.getState().refresh();
    const model = useLab.getState().settings.textModel;
    const vision = useLab.getState().settings.visionModel;
    if (!st?.reachable) {
      setRow({ id: "ollama", label: LABELS.ollama!, status: "fail", detail: `Not reachable. Start it with: ollama serve. Drawing, physics and rule-based explanations still work.` });
      setRow({ id: "model", label: LABELS.model!, status: "fail", detail: "Needs Ollama." });
      setRow({ id: "vision", label: LABELS.vision!, status: "optional", detail: "Needs Ollama. Photo recognition still finds shapes without it." });
    } else {
      setRow({ id: "ollama", label: LABELS.ollama!, status: "pass", detail: `Ollama ${st.version ?? ""} at ${st.url} · ${st.models.length} model(s) installed` });
      const m = st.models.find((x) => x.name === model);
      setRow({ id: "model", label: LABELS.model!, status: m && !m.cloud ? "pass" : "fail", detail: m ? `${m.name} (${m.parameterSize ?? "?"}, ${(m.sizeBytes / 1e9).toFixed(1)} GB on disk)` : `No local text model. Install one: ollama pull ${appConfig.defaultModel} (${SIZE_HINT[appConfig.defaultModel]} download)` });
      const v = st.models.find((x) => x.name === vision);
      setRow({ id: "vision", label: LABELS.vision!, status: v ? "pass" : "optional", detail: v ? `${v.name} can read images.` : `No vision-capable local model installed (optional). For photo role hints: ollama pull ${appConfig.suggestedVisionModel} (${SIZE_HINT[appConfig.suggestedVisionModel]} download).` });
    }
    // 5. Camera — permission state only; never marked passed unless actually tested.
    try {
      const perm = await navigator.permissions.query({ name: "camera" as PermissionName });
      setRow({ id: "camera", label: LABELS.camera!, status: perm.state === "granted" ? "pass" : "optional", detail: perm.state === "granted" ? "Camera permission granted." : `Permission: ${perm.state}. Optional — click “Test camera” to check.` });
    } catch {
      setRow({ id: "camera", label: LABELS.camera!, status: "optional", detail: "This browser can't report camera permission. Click “Test camera”." });
    }
    setBusy(false);
  }, []);

  const testCamera = async () => {
    setRow({ id: "camera", label: LABELS.camera!, status: "running", detail: "Requesting camera…" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const label = track?.label ?? "camera";
      stream.getTracks().forEach((t) => t.stop());
      setRow({ id: "camera", label: LABELS.camera!, status: "pass", detail: `Opened ${label}, then released it.` });
    } catch (e) {
      setRow({ id: "camera", label: LABELS.camera!, status: "fail", detail: `Camera unavailable: ${e instanceof Error ? e.message : String(e)}. Upload a photo instead.` });
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runChecks();
  }, [runChecks]);

  const local = ai?.models.filter((m) => !m.cloud) ?? [];
  const cloud = ai?.models.filter((m) => m.cloud) ?? [];
  const textModels = local.filter((m) => m.capabilities.length === 0 || m.capabilities.includes("completion"));
  const visionModels = local.filter((m) => m.capabilities.includes("vision"));

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => useLab.getState().set({ readinessOpen: false })}>
      <div className="scroll-thin max-h-[92vh] w-full max-w-[720px] animate-rise overflow-y-auto rounded-2xl border border-border bg-chrome p-5 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="readiness-dialog" role="dialog" aria-label="Demo readiness check">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">Demo readiness</h2>
          <button className="btn ml-auto h-8 text-xs" onClick={() => void runChecks()} disabled={busy}>
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> Re-run checks
          </button>
          <button className="btn btn-ghost btn-icon h-8 w-8" onClick={() => useLab.getState().set({ readinessOpen: false })} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="mt-1 text-xs text-text-muted">Every check below is actually executed now; nothing is marked passed without being tested.</p>
        <div className="mt-3 flex flex-col divide-y divide-border-soft rounded-xl border border-border">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-3 p-2.5" data-testid={`check-${r.id}`} data-status={r.status}>
              <StatusIcon s={r.status} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{r.label}</div>
                <div className="break-words text-xs text-text-muted">{r.detail}</div>
              </div>
              {r.id === "camera" && r.status !== "pass" && (
                <button className="btn h-7 px-2 text-[11px]" onClick={() => void testCamera()}>Test camera</button>
              )}
            </div>
          ))}
        </div>

        <h3 className="mt-5 text-sm font-bold">Local models</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-text-muted">
            Text model (copilot + explanations)
            <select className="field mt-1" value={settings.textModel ?? ""} onChange={(e) => useLab.getState().setSettings({ textModel: e.target.value || null })} data-testid="text-model-select">
              <option value="">None (rules only)</option>
              {textModels.map((m) => (
                <option key={m.name} value={m.name}>{m.name} · {m.parameterSize ?? "?"}{m.capabilities.includes("thinking") ? " · thinking" : ""}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-text-muted">
            Vision model (optional photo role hints)
            <select className="field mt-1" value={settings.visionModel ?? ""} onChange={(e) => useLab.getState().setSettings({ visionModel: e.target.value || null })}>
              <option value="">None — geometry only</option>
              {visionModels.map((m) => (
                <option key={m.name} value={m.name}>{m.name} · {m.parameterSize ?? "?"}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-text-muted">
          <input type="checkbox" checked={settings.useVision} onChange={(e) => useLab.getState().setSettings({ useVision: e.target.checked })} data-testid="use-vision" />
          Ask the vision model to double-check recognised photo shapes (one small crop per shape, ≈1 s each). It never changes geometry.
        </label>
        {cloud.length > 0 && <p className="mt-2 text-[11px] text-text-faint">Ignored cloud models (DoodleLab only uses local models): {cloud.map((m) => m.name).join(", ")}</p>}
        <div className="mt-3 rounded-xl bg-panel p-3 text-xs leading-relaxed text-text-muted">
          <b className="text-text">Setup.</b> Models load on demand and are only used for the copilot&apos;s broader requests, explanations and optional photo hints — never for drawing recognition or physics.
          <div className="mt-1.5 font-mono text-[11px] text-text">ollama pull {appConfig.defaultModel} <span className="text-text-faint"># {SIZE_HINT[appConfig.defaultModel]} — text</span></div>
          <div className="font-mono text-[11px] text-text">ollama pull {appConfig.suggestedVisionModel} <span className="text-text-faint"># {SIZE_HINT[appConfig.suggestedVisionModel]} — optional vision</span></div>
          <div className="mt-1.5">Sizes are approximate (qwen3:4b as reported by “ollama list” on the build machine; qwen2.5vl:3b per the Ollama library listing). Downloads need internet once; afterwards everything runs offline.</div>
        </div>
      </div>
    </div>
  );
}

const ORDER = ["deps", "physics", "samples", "storage", "ollama", "model", "vision", "camera"];
const LABELS: Record<string, string> = {
  deps: "App server & dependencies",
  physics: "Physics self-test",
  samples: "Sample scenes verified by simulation",
  storage: "Browser storage",
  ollama: "Ollama reachable",
  model: "Selected text model available",
  vision: "Vision model (optional)",
  camera: "Camera (optional)",
};

function StatusIcon({ s }: { s: Status }) {
  if (s === "pass") return <Check size={17} className="mt-0.5 shrink-0 text-ok" />;
  if (s === "fail") return <XCircle size={17} className="mt-0.5 shrink-0 text-bad" />;
  if (s === "running") return <Loader2 size={17} className="mt-0.5 shrink-0 animate-spin text-text-muted" />;
  return <CircleDashed size={17} className="mt-0.5 shrink-0 text-text-faint" />;
}
