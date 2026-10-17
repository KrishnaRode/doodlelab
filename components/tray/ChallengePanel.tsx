"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { useLab } from "@/lib/state/store";
import { searchTarget, currentValue, type SearchOutcome, type SearchParam } from "@/lib/physics/solver";
import { getController } from "@/lib/state/controller";

export function ChallengePanel() {
  const scene = useLab((s) => s.scene);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const revAtRun = useRef(0);

  const options = useMemo(() => {
    const out: Array<{ key: string; label: string; param: SearchParam }> = [];
    for (const o of scene.objects) {
      if (o.role === "ramp" && o.isStatic) out.push({ key: `a:${o.id}`, label: `${o.label || o.id} angle (±15°)`, param: { kind: "ramp-angle", objectId: o.id } });
    }
    for (const o of scene.objects) {
      if (!o.isStatic && o.role === "ball") {
        out.push({ key: `b:${o.id}`, label: `${o.label || o.id} bounce (0.05–0.95)`, param: { kind: "bounce", objectId: o.id } });
        out.push({ key: `x:${o.id}`, label: `${o.label || o.id} release x (±120 u)`, param: { kind: "release-x", objectId: o.id } });
      }
    }
    return out;
  }, [scene]);
  const [choice, setChoice] = useState<string>("");
  const selected = options.find((o) => o.key === choice) ?? options.find((o) => o.param.objectId === scene.goal?.subjectId && o.param.kind === "bounce") ?? options[0];

  if (!scene.goal) {
    return <p className="pt-2 text-sm text-text-muted">Can you make the ball reach the target? Add a <b>Target</b> zone and pick it as the goal in the inspector (Scene → Goal). The <i>Bounce to target</i> sample is ready to go.</p>;
  }
  if (!selected) return <p className="pt-2 text-sm text-text-muted">Add a ball or a ramp to search over.</p>;

  const run = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setOutcome(null);
    setError(null);
    revAtRun.current = useLab.getState().revision;
    setRunning({ done: 0, total: 13 });
    try {
      const r = await searchTarget(useLab.getState().scene, selected.param, { signal: ctrl.signal, onProgress: (done, total) => setRunning({ done, total }) });
      if (!ctrl.signal.aborted) setOutcome(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  };

  const apply = () => {
    if (!outcome?.best) return;
    const st = useLab.getState();
    if (st.revision !== revAtRun.current) {
      st.notify("The scene changed since the search ran — run the search again.", "warn");
      return;
    }
    const next = structuredClone(st.scene);
    const src = outcome.best.spec.objects.find((o) => o.id === outcome.param.objectId)!;
    const i = next.objects.findIndex((o) => o.id === src.id);
    next.objects[i] = structuredClone(src);
    st.commit(next);
    st.notify(`Applied ${outcome.best.label}. Press Bring to Life (or Reset) to watch it. Undo with ⌘Z.`, "ok");
    if (getController().sim) getController().reset();
  };

  const fmt = (v: number) => (selected.param.kind === "bounce" ? v.toFixed(3) : String(v));
  return (
    <div className="flex flex-col gap-2 pt-1" data-testid="challenge-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{scene.goal.prompt ?? "Can you make it reach the target?"}</span>
        <select className="field h-8 w-auto" value={selected.key} onChange={(e) => setChoice(e.target.value)} aria-label="Parameter to search">
          {options.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        {!running ? (
          <button className="btn btn-primary h-8 text-xs" onClick={() => void run()} data-testid="search-run">
            <Search size={14} /> Search 13 settings
          </button>
        ) : (
          <button className="btn h-8 text-xs" onClick={() => abortRef.current?.abort()}>
            <Loader2 size={14} className="animate-spin" /> Testing {running.done}/{running.total} · Cancel <X size={12} />
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-faint">
        Each setting is simulated headlessly for {scene.simulation.durationSec} s through the same physics compiler. Only tested results are shown; this is a small search, not a guaranteed best answer.
      </p>
      {error && <p className="text-xs text-bad">{error}</p>}
      {outcome && (
        <>
          <div className="flex flex-wrap gap-1" data-testid="search-results">
            {outcome.results.map((r) => (
              <span
                key={r.value}
                title={r.tested ? (r.reached ? `reached at ${r.atSec} s` : "did not reach") : `skipped: ${r.skippedReason}`}
                className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${!r.tested ? "border-border text-text-faint line-through" : r.reached ? "border-ok/60 bg-ok/10 text-ok" : "border-border text-text-muted"} ${Math.abs(r.value - outcome.current) < 1e-6 ? "ring-1 ring-accent" : ""}`}
              >
                {selected.param.kind === "ramp-angle" ? `${r.value}°` : fmt(r.value)}
              </span>
            ))}
          </div>
          {outcome.best ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ok/40 bg-ok/5 p-2.5 text-xs" data-testid="search-best">
              <span>
                Best tested: <b>{outcome.best.label}</b> (now {fmt(currentValue(scene, outcome.param))}) → reached the target at <b>{outcome.best.atSec} s</b> in simulation. {outcome.results.filter((r) => r.reached).length} of {outcome.testedCount} tested settings reached it ({outcome.ms} ms).
              </span>
              <button className="btn btn-primary h-7 px-2 text-[11px]" onClick={apply} data-testid="search-apply">
                <Check size={12} /> Apply
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-panel p-2.5 text-xs" data-testid="search-none">
              No successful configuration found in this search ({outcome.testedCount} settings tested). Try another parameter, or move things by hand.
            </div>
          )}
        </>
      )}
    </div>
  );
}
