"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Footprints, Pause, Play, RotateCcw, X } from "lucide-react";
import { Simulation } from "@/lib/physics/simulation";
import type { RunSummary } from "@/lib/physics/telemetry";
import { drawStage } from "@/lib/render/renderer";
import { fitView } from "@/lib/geometry/transforms";
import { GRAVITY_PRESETS, gravityFromPreset, type SceneSpec } from "@/lib/scene/spec";
import { useLab } from "@/lib/state/store";

type PresetKey = keyof typeof GRAVITY_PRESETS;

/**
 * Side-by-side worlds. Each world is a NEW Simulation built from a clone of the SAME authored
 * SceneSpec; only gravity differs. Shared controls drive all worlds from one loop, so every
 * world gets exactly the same number of fixed steps.
 */
export function CompareView() {
  const authored = useLab((s) => s.scene);
  const speed = useLab((s) => s.settings.speed);
  const [presets, setPresets] = useState<PresetKey[]>(["earth", "moon"]);
  const [playing, setPlaying] = useState(false);
  const [summaries, setSummaries] = useState<RunSummary[]>([]);
  const simsRef = useRef<Simulation[]>([]);
  const canvasesRef = useRef<Array<HTMLCanvasElement | null>>([]);
  const playingRef = useRef(false);
  const speedRef = useRef(speed);
  const flashRef = useRef(new Map<string, number>());
  const movers = authored.objects.filter((o) => !o.isStatic && o.role !== "target");
  const [subject, setSubject] = useState<string>(authored.goal?.subjectId ?? movers[0]?.id ?? "");

  const specs = useMemo<SceneSpec[]>(
    () =>
      presets.map((p) => {
        const s = structuredClone(authored);
        s.gravity = gravityFromPreset(p);
        return s;
      }),
    [authored, presets],
  );

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // (Re)build isolated worlds whenever the authored scene or chosen presets change.
  useEffect(() => {
    simsRef.current.forEach((s) => s.destroy());
    simsRef.current = specs.map((s) => new Simulation(s));
    playingRef.current = false;
    // Syncing React state with the freshly built (external) simulations.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlaying(false);
    setSummaries(simsRef.current.map((s) => s.summary()));
    return () => {
      simsRef.current.forEach((s) => s.destroy());
      simsRef.current = [];
    };
  }, [specs]);

  // One loop for all worlds, with a shared step budget per frame.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let publish = 0;
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      const sims = simsRef.current;
      if (playingRef.current && sims.length) {
        const n = sims[0]!.advance(dt, speedRef.current);
        // Keep the others in lock-step: exactly the same number of fixed steps.
        for (let i = 1; i < sims.length; i++) for (let k = 0; k < n; k++) sims[i]!.step();
        const limit = sims[0]!.spec.simulation.durationSec;
        if (sims[0]!.time >= limit) {
          playingRef.current = false;
          setPlaying(false);
        }
      }
      sims.forEach((sim, i) => {
        const c = canvasesRef.current[i];
        if (!c) return;
        const r = c.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
          c.width = Math.round(r.width * dpr);
          c.height = Math.round(r.height * dpr);
        }
        const ctx = c.getContext("2d");
        if (!ctx || !r.width) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const trails = new Map(sim.recordOrder.map((id) => [id, sim.trail(id)] as const));
        drawStage({
          ctx,
          width: r.width,
          height: r.height,
          view: fitView(sim.spec.world, r.width, r.height, 6),
          scene: sim.spec,
          mode: "live",
          transitionT: null,
          bodies: new Map(sim.snapshot().map((b) => [b.id, b])),
          selection: [],
          hover: null,
          pending: [],
          currentStroke: null,
          ghost: null,
          trails,
          showVectors: false,
          flashes: flashRef.current,
          photo: null,
          photoMeta: null,
          now,
          reviewIds: new Set(),
          issueIds: new Set(),
          showLabels: false,
          dragging: null,
        });
      });
      if (now > publish) {
        publish = now + 150;
        setSummaries(sims.map((s) => s.summary()));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const play = () => {
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
  };
  const reset = () => {
    simsRef.current.forEach((s) => s.reset());
    playingRef.current = false;
    setPlaying(false);
    setSummaries(simsRef.current.map((s) => s.summary()));
  };
  const step = () => {
    if (playingRef.current) return;
    simsRef.current.forEach((s) => s.step());
    setSummaries(simsRef.current.map((s) => s.summary()));
  };
  const toggle = (p: PresetKey) => {
    setPresets((cur) => (cur.includes(p) ? (cur.length > 2 ? cur.filter((x) => x !== p) : cur) : [...cur, p].sort((a, b) => order(a) - order(b))));
  };

  const goal = authored.goal;
  const time = summaries[0]?.simulatedSec ?? 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#0d1530]/97 p-3 backdrop-blur" data-testid="compare-view">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">What if gravity were different?</div>
        <span className="text-[11px] text-text-faint">Same starting scene cloned into isolated worlds — only gravity differs.</span>
        <div className="ml-auto flex items-center gap-1">
          {(Object.keys(GRAVITY_PRESETS) as PresetKey[]).map((p) => (
            <button key={p} className={`btn h-7 px-2 text-xs ${presets.includes(p) ? "border-accent bg-accent-soft/40 text-white" : ""}`} onClick={() => toggle(p)} aria-pressed={presets.includes(p)} data-testid={`compare-toggle-${p}`}>
              {GRAVITY_PRESETS[p].label}
            </button>
          ))}
          <button className="btn btn-ghost btn-icon h-8 w-8" onClick={() => useLab.getState().set({ compareOpen: false })} aria-label="Close comparison" data-testid="compare-close">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="mt-2 grid min-h-0 flex-1 gap-2" style={{ gridTemplateColumns: `repeat(${presets.length}, minmax(0, 1fr))` }}>
        {presets.map((p, i) => (
          <div key={p} className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between bg-panel px-2.5 py-1 text-xs">
              <span className="font-semibold">{GRAVITY_PRESETS[p].label}</span>
              <span className="font-mono text-text-faint">{GRAVITY_PRESETS[p].scale}× · {(summaries[i]?.simulatedSec ?? 0).toFixed(2)} s</span>
            </div>
            <canvas ref={(el) => { canvasesRef.current[i] = el; }} className="min-h-0 w-full flex-1" data-testid={`compare-canvas-${p}`} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="btn btn-primary h-9 w-9 p-0" onClick={play} aria-label={playing ? "Pause all" : "Play all"} data-testid="compare-play">
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button className="btn h-9 w-9 p-0" onClick={step} disabled={playing} aria-label="Step all" title="Step every world by 1/120 s">
          <Footprints size={15} />
        </button>
        <button className="btn h-9 w-9 p-0" onClick={reset} aria-label="Reset all" data-testid="compare-reset">
          <RotateCcw size={15} />
        </button>
        <span className="font-mono text-xs text-text-muted">{time.toFixed(2)} / {authored.simulation.durationSec} s</span>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-text-muted">
          Measure
          <select className="field h-8 w-auto" value={subject} onChange={(e) => setSubject(e.target.value)}>
            {movers.map((o) => (
              <option key={o.id} value={o.id}>{o.label || o.id}</option>
            ))}
          </select>
        </label>
      </div>
      <table className="mt-2 w-full text-left text-xs" data-testid="compare-table">
        <thead className="text-[10px] uppercase tracking-wider text-text-faint">
          <tr>
            <th className="py-1 font-semibold">World</th>
            <th className="font-semibold">{goal ? "Time to target" : "Target"}</th>
            <th className="font-semibold">Reached target</th>
            <th className="font-semibold">Max rise (u)</th>
            <th className="font-semibold">Max displacement (u)</th>
            <th className="font-semibold">First impact</th>
            <th className="font-semibold">Collisions (all)</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {presets.map((p, i) => {
            const s = summaries[i];
            const b = s?.bodies[subject];
            return (
              <tr key={p} className="border-t border-border-soft">
                <td className="py-1 font-sans font-semibold">{GRAVITY_PRESETS[p].label}</td>
                <td>{goal ? (s?.goal?.atSec != null ? `${s.goal.atSec} s` : "—") : "no goal set"}</td>
                <td className={s?.goal?.reached ? "text-ok" : "text-text-muted"}>{goal ? (s?.goal?.reached ? "yes" : time >= authored.simulation.durationSec ? "no" : "not yet") : "—"}</td>
                <td>{b ? Math.round(b.maxRise) : "—"}</td>
                <td>{b ? Math.round(b.maxDisplacement) : "—"}</td>
                <td>{b?.firstImpactSec != null ? `${b.firstImpactSec} s` : "—"}</td>
                <td>{s?.collisionCount ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-text-faint">All numbers are measured from these simulations (scene units, simulated seconds). Gravity is relative: Moon ≈ 1/6 of this scene&apos;s Earth.</p>
    </div>
  );
}

function order(p: PresetKey) {
  return { earth: 0, moon: 1, zero: 2 }[p];
}
