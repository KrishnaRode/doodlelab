"use client";

import { Activity, ArrowLeftRight, Footprints, Pause, PencilLine, Play, RotateCcw, Sparkles, Spline } from "lucide-react";
import { useLab } from "@/lib/state/store";
import { getController, useRuntime } from "@/lib/state/controller";
import { bringToLife, setGravityPreset } from "@/lib/state/actions";
import { SPEEDS } from "@/lib/physics/simulation";
import { GRAVITY_PRESETS } from "@/lib/scene/spec";

function Seg({ active, children, onClick, title, testid, mono }: { active: boolean; children: React.ReactNode; onClick: () => void; title?: string; testid?: string; mono?: boolean }) {
  return (
    <button
      className={`h-7 rounded-md px-2 text-xs font-semibold transition ${mono ? "font-mono" : ""} ${active ? "bg-accent-soft text-white shadow-sm" : "text-text-muted hover:bg-panel-hover hover:text-text"}`}
      onClick={onClick}
      title={title}
      aria-pressed={active}
      data-testid={testid}
    >
      {children}
    </button>
  );
}

export function PlayBar() {
  const mode = useLab((s) => s.mode);
  const speed = useLab((s) => s.settings.speed);
  const trails = useLab((s) => s.settings.trails);
  const vectors = useLab((s) => s.settings.vectors);
  const gravity = useLab((s) => s.scene.gravity);
  const hasObjects = useLab((s) => s.scene.objects.length > 0);
  const status = useRuntime((s) => s.status);
  const time = useRuntime((s) => s.time);
  const replayT = useRuntime((s) => s.replayT);
  const c = getController();
  const live = mode !== "edit";

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto rounded-2xl border border-border bg-chrome/80 px-2 py-1.5 backdrop-blur" data-testid="playbar">
      {!live ? (
        <button className="btn btn-life h-10 shrink-0 px-5 text-sm" onClick={() => bringToLife()} data-testid="bring-to-life" title="Validate, compile and run (Enter)">
          <Sparkles size={17} /> Bring to Life
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button className="btn h-10" onClick={() => c.backToEdit()} title="Back to the sketch (Esc)" data-testid="back-to-sketch">
            <PencilLine size={16} /> <span className="hidden 2xl:inline">Edit sketch</span>
          </button>
          <button className="btn btn-primary btn-icon h-10 w-10" onClick={() => c.toggle()} disabled={mode === "transition"} aria-label={status === "running" ? "Pause" : "Play"} title="Play / pause (Space)" data-testid="play-pause">
            {status === "running" ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="btn btn-icon h-10 w-10" onClick={() => c.stepOnce()} disabled={status !== "paused"} aria-label="Step one frame" title="Step 1/120 s while paused (.)" data-testid="step">
            <Footprints size={16} />
          </button>
          <button className="btn btn-icon h-10 w-10" onClick={() => c.reset()} disabled={mode === "transition"} aria-label="Reset" title="Reset to the authored start (R)" data-testid="reset">
            <RotateCcw size={16} />
          </button>
        </div>
      )}

      {live && status === "paused" && time > 0.05 && (
        <label className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-panel px-2 py-1 text-[11px] text-text-muted" title="Scrub through the recorded run (view only). Play continues from the live moment.">
          <span className="label-micro">Replay</span>
          <input
            type="range"
            min={0}
            max={time}
            step={1 / 60}
            value={replayT ?? time}
            onChange={(e) => {
              const v = Number(e.target.value);
              c.setReplay(v >= time - 1 / 120 ? null : v);
            }}
            className="w-28"
            aria-label="Replay time"
            data-testid="replay-slider"
          />
          <span className="w-12 font-mono text-text">{(replayT ?? time).toFixed(2)}s</span>
        </label>
      )}

      <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-panel p-0.5" role="group" aria-label="Gravity">
        <span className="label-micro px-1.5">Gravity</span>
        {(Object.keys(GRAVITY_PRESETS) as Array<keyof typeof GRAVITY_PRESETS>).map((k) => (
          <Seg key={k} active={gravity.preset === k} onClick={() => setGravityPreset(k)} title={GRAVITY_PRESETS[k].note} testid={`gravity-${k}`}>
            {GRAVITY_PRESETS[k].label}
          </Seg>
        ))}
        {gravity.preset === "custom" && <span className="px-1.5 font-mono text-xs text-white">{gravity.scale}×</span>}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-panel p-0.5" role="group" aria-label="Speed">
        <span className="label-micro px-1.5">Speed</span>
        {SPEEDS.map((s) => (
          <Seg key={s} active={speed === s} onClick={() => useLab.getState().setSettings({ speed: s })} mono>
            {s}×
          </Seg>
        ))}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button className={`btn h-9 text-xs ${trails ? "border-accent/60 text-white" : "text-text-muted"}`} onClick={() => useLab.getState().setSettings({ trails: !trails })} aria-pressed={trails} title="Show motion trails" aria-label="Trails">
          <Spline size={14} /> <span className="hidden 2xl:inline">Trails</span>
        </button>
        <button className={`btn h-9 text-xs ${vectors ? "border-accent/60 text-white" : "text-text-muted"}`} onClick={() => useLab.getState().setSettings({ vectors: !vectors })} aria-pressed={vectors} title="Show velocity arrows" aria-label="Vectors">
          <Activity size={14} /> <span className="hidden 2xl:inline">Vectors</span>
        </button>
        <button
          className="btn h-9 text-xs"
          onClick={() => {
            c.pause();
            useLab.getState().set({ compareOpen: true });
          }}
          disabled={!hasObjects}
          title="Run the same scene side by side under different gravity"
          data-testid="open-compare"
        >
          <ArrowLeftRight size={14} /> Compare
        </button>
      </div>
    </div>
  );
}
