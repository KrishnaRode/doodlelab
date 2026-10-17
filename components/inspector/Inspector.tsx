"use client";

import { useMemo } from "react";
import { AlertTriangle, Check, ChevronRight, CircleAlert, PanelRightClose, Trash2, Wand2 } from "lucide-react";
import { useLab } from "@/lib/state/store";
import { semanticIssues, type SceneIssue } from "@/lib/scene/validate";
import { MATERIAL_PRESETS, MASS_NOTE, resolveMaterial, ROLE_DEFAULTS } from "@/lib/scene/materials";
import { GRAVITY_PRESETS, MATERIALS, PARAM_LIMITS, ROLES, type Role, type SceneObject } from "@/lib/scene/spec";
import { acceptAllReview, confirmObject, convertPending, setGravityScale } from "@/lib/state/actions";
import { wobbleOutline } from "@/lib/scene/objects";

export function Inspector() {
  const selection = useLab((s) => s.selection);
  const scene = useLab((s) => s.scene);
  const selected = selection.length === 1 ? scene.objects.find((o) => o.id === selection[0]) : undefined;
  return (
    <aside className="scroll-thin flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border-soft bg-chrome/60 px-3 pb-4 pt-1" data-testid="inspector" aria-label="Inspector">
      <div className="flex items-center justify-between py-2">
        <div className="label-micro">{selected ? "Object" : selection.length > 1 ? `${selection.length} selected` : "Scene"}</div>
        <button className="btn btn-ghost btn-icon h-7 w-7" aria-label="Hide inspector" title="Hide inspector" onClick={() => useLab.getState().set({ inspectorOpen: false })}>
          <PanelRightClose size={15} />
        </button>
      </div>
      {selected ? <ObjectPanel o={selected} /> : selection.length > 1 ? <MultiPanel ids={selection} /> : <ScenePanel />}
    </aside>
  );
}

// ── Scene overview + review queue ──────────────────────────────────────────

function ScenePanel() {
  const scene = useLab((s) => s.scene);
  const pending = useLab((s) => s.pending);
  const mode = useLab((s) => s.mode);
  const issues = useMemo(() => semanticIssues(scene), [scene]);
  const review = scene.objects.filter((o) => o.source.needsReview);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const needs = review.length + pending.length;

  return (
    <div className="flex flex-col gap-4">
      {(needs > 0 || errors.length > 0) && (
        <section className="rounded-xl border border-warn/40 bg-warn/5 p-3" data-testid="review-panel">
          <div className="flex items-center gap-2 text-sm font-semibold text-warn">
            <AlertTriangle size={15} /> Review before it comes to life
          </div>
          <p className="mt-1 text-xs text-text-muted">DoodleLab never hides a doubtful guess. Confirm or change each one.</p>
          <div className="mt-2 flex flex-col gap-2">
            {errors.map((i, k) => (
              <IssueRow key={`e${k}`} issue={i} />
            ))}
            {review.map((o) => (
              <div key={o.id} className="rounded-lg border border-border bg-panel p-2">
                <button className="flex w-full items-center justify-between text-left text-[13px] font-semibold" onClick={() => useLab.getState().select([o.id])}>
                  {o.label || o.id} <span className="text-[11px] font-medium text-text-muted">as {o.role}</span>
                  <ChevronRight size={14} className="text-text-faint" />
                </button>
                <ul className="mt-1 list-disc pl-4 text-[11px] text-text-muted">
                  {o.source.reasons.map((r, k) => (
                    <li key={k}>{r}</li>
                  ))}
                </ul>
                <button className="btn mt-2 h-7 w-full text-xs" onClick={() => confirmObject(o.id)}>
                  <Check size={13} /> Looks right
                </button>
              </div>
            ))}
            {pending.map((p) => (
              <div key={p.id} className="rounded-lg border border-border bg-panel p-2" data-testid="pending-stroke">
                <div className="text-[13px] font-semibold">Unrecognised stroke</div>
                <ul className="mt-1 list-disc pl-4 text-[11px] text-text-muted">
                  {p.fit.reasons.map((r, k) => (
                    <li key={k}>{r}</li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(["ball", "block", "ramp", "platform", "target"] as Role[]).map((r) => (
                    <button key={r} className="btn h-7 px-2 text-[11px]" onClick={() => convertPending(p, r)}>
                      {ROLE_DEFAULTS[r].label}
                    </button>
                  ))}
                  <button className="btn h-7 px-2 text-[11px] text-bad" onClick={() => useLab.getState().removePending(p.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          {needs > 0 && errors.length === 0 && (
            <button className="btn btn-primary mt-3 h-8 w-full text-xs" onClick={acceptAllReview} data-testid="accept-all">
              <Check size={14} /> Accept all as shown
            </button>
          )}
        </section>
      )}

      {warnings.length > 0 && (
        <section>
          <div className="label-micro mb-1.5">Heads-up ({warnings.length})</div>
          <div className="flex flex-col gap-1.5">
            {warnings.map((i, k) => (
              <IssueRow key={k} issue={i} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="label-micro mb-1.5">Gravity</div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={PARAM_LIMITS.gravityScale.max}
            step={0.005}
            value={scene.gravity.scale}
            onChange={(e) => setGravityScale(Number(e.target.value))}
            className="flex-1"
            aria-label="Gravity relative to Earth"
          />
          <span className="w-16 text-right font-mono text-xs">{scene.gravity.scale.toFixed(3)}×</span>
        </div>
        <p className="mt-1 text-[11px] text-text-faint">
          Relative to this scene&apos;s Earth gravity. Moon = {GRAVITY_PRESETS.moon.scale}× (about 1/6).
        </p>
      </section>

      <section>
        <div className="label-micro mb-1.5">Observation window</div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={4}
            max={30}
            step={1}
            value={scene.simulation.durationSec}
            onChange={(e) => {
              const st = useLab.getState();
              const next = structuredClone(st.scene);
              next.simulation.durationSec = Number(e.target.value);
              st.commit(next);
            }}
            className="flex-1"
            aria-label="Observation window seconds"
          />
          <span className="w-16 text-right font-mono text-xs">{scene.simulation.durationSec} s</span>
        </div>
        <p className="mt-1 text-[11px] text-text-faint">Used by comparisons and the target search.</p>
      </section>

      <GoalSection />

      <section>
        <div className="label-micro mb-1.5">Objects ({scene.objects.length})</div>
        {scene.objects.length === 0 ? (
          <p className="text-xs text-text-faint">Nothing yet. Draw on the paper or use a tool.</p>
        ) : (
          <div className="flex flex-col">
            {scene.objects.map((o) => (
              <button key={o.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-panel" onClick={() => useLab.getState().select([o.id])} disabled={mode === "transition"}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.role === "target" ? "#f5b301" : MATERIAL_PRESETS[o.material].color }} />
                <span className="truncate font-medium">{o.label || o.id}</span>
                <span className="ml-auto text-text-faint">{o.role}{o.isStatic && o.role !== "target" ? " · fixed" : ""}</span>
                {o.source.needsReview && <CircleAlert size={12} className="text-warn" />}
              </button>
            ))}
          </div>
        )}
      </section>
      <p className="text-[11px] leading-relaxed text-text-faint">
        Units are <b>scene units (u)</b>, not metres: the world is {scene.world.width} × {scene.world.height} u, y grows downward, angles are degrees (clockwise +).
      </p>
    </div>
  );
}

function GoalSection() {
  const scene = useLab((s) => s.scene);
  const targets = scene.objects.filter((o) => o.role === "target");
  const movers = scene.objects.filter((o) => !o.isStatic && o.role !== "target");
  if (!targets.length) return null;
  const goal = scene.goal;
  const setGoal = (targetId: string | null, subjectId: string | null) => {
    const st = useLab.getState();
    const next = structuredClone(st.scene);
    next.goal = targetId ? { kind: "reach-target", targetId, subjectId: subjectId || undefined, prompt: next.goal?.prompt } : undefined;
    st.commit(next);
  };
  return (
    <section>
      <div className="label-micro mb-1.5">Goal</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-text-muted">
          Target
          <select className="field mt-1" value={goal?.targetId ?? ""} onChange={(e) => setGoal(e.target.value || null, goal?.subjectId ?? null)}>
            <option value="">No goal</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>{t.label || t.id}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-text-muted">
          Who must reach it
          <select className="field mt-1" value={goal?.subjectId ?? ""} disabled={!goal} onChange={(e) => setGoal(goal!.targetId, e.target.value || null)}>
            <option value="">Anything</option>
            {movers.map((t) => (
              <option key={t.id} value={t.id}>{t.label || t.id}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function IssueRow({ issue }: { issue: SceneIssue }) {
  const err = issue.severity === "error";
  return (
    <div className={`rounded-lg border p-2 text-[11px] ${err ? "border-bad/40 bg-bad/5" : "border-border bg-panel"}`} data-testid="issue">
      <div className="flex gap-1.5">
        {err ? <CircleAlert size={13} className="mt-px shrink-0 text-bad" /> : <AlertTriangle size={13} className="mt-px shrink-0 text-warn" />}
        <button className="text-left text-text-muted hover:text-text" onClick={() => issue.objectIds[0] && useLab.getState().select([issue.objectIds[0]])}>
          {issue.message}
        </button>
      </div>
      {issue.fix && (
        <button
          className="btn mt-1.5 h-7 w-full text-[11px]"
          onClick={() =>
            useLab.getState().updateObject(issue.fix!.objectId, (o) => {
              if (issue.fix!.set.x !== undefined) o.x = issue.fix!.set.x;
              if (issue.fix!.set.y !== undefined) o.y = issue.fix!.set.y;
            })
          }
        >
          <Wand2 size={12} /> {issue.fix.label}
        </button>
      )}
    </div>
  );
}

// ── Single object ────────────────────────────────────────────────────────────

function NumberField({ label, value, onChange, step = 1, min, max, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <label className="text-[11px] text-text-muted">
      {label}
      <div className="relative mt-1">
        <input
          type="number"
          className="field pr-6 font-mono"
          value={Number.isInteger(value) ? value : Number(value.toFixed(2))}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(min !== undefined || max !== undefined ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)) : v);
          }}
        />
        {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-faint">{suffix}</span>}
      </div>
    </label>
  );
}

function ObjectPanel({ o }: { o: SceneObject }) {
  const st = useLab.getState;
  const upd = (fn: (x: SceneObject) => void) => st().updateObject(o.id, fn);
  const m = resolveMaterial(o.material, o.overrides);
  const preset = MATERIAL_PRESETS[o.material];
  const isTarget = o.role === "target";

  const setRole = (r: Role) =>
    upd((x) => {
      x.role = r;
      const d = ROLE_DEFAULTS[r];
      x.isStatic = r === "target" ? true : d.isStatic;
      x.material = d.material;
      x.overrides = {};
      x.source.needsReview = false;
      if (r === "target") x.initialVelocity = [0, 0];
    });

  return (
    <div className="flex flex-col gap-4" data-testid="object-panel">
      <div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: isTarget ? "#f5b301" : preset.color }} />
          <input className="min-w-0 flex-1 rounded bg-transparent px-1 text-base font-semibold hover:bg-panel focus:bg-panel focus:outline-none" value={o.label ?? ""} placeholder={ROLE_DEFAULTS[o.role].label} onChange={(e) => upd((x) => void (x.label = e.target.value.slice(0, 40) || undefined))} aria-label="Object name" />
        </div>
        <div className="mt-0.5 pl-5 font-mono text-[11px] text-text-faint">id: {o.id} · from {o.source.kind}</div>
      </div>

      {o.source.needsReview && (
        <div className="rounded-xl border border-warn/40 bg-warn/5 p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-warn">
            <AlertTriangle size={13} /> Needs review
          </div>
          <ul className="mt-1 list-disc pl-4 text-[11px] text-text-muted">
            {o.source.reasons.map((r, k) => (
              <li key={k}>{r}</li>
            ))}
          </ul>
          {o.source.aiHint && <p className="mt-1 text-[11px] text-text-muted">Vision model: {o.source.aiHint}</p>}
          <button className="btn mt-2 h-7 w-full text-xs" onClick={() => confirmObject(o.id)} data-testid="confirm-object">
            <Check size={13} /> Looks right
          </button>
        </div>
      )}

      <section>
        <div className="label-micro mb-1.5">Interpretation</div>
        <div className="grid grid-cols-4 gap-1">
          {ROLES.map((r) => (
            <button key={r} className={`btn h-7 px-1 text-[11px] ${o.role === r ? "border-accent bg-accent-soft/40 text-white" : ""}`} onClick={() => setRole(r)} aria-pressed={o.role === r}>
              {ROLE_DEFAULTS[r].label}
            </button>
          ))}
        </div>
        {o.source.fit && (
          <p className="mt-1.5 text-[11px] text-text-faint">
            Measured fit: {o.source.fit.note ?? `${o.source.fit.method}, deviation ${o.source.fit.deviation}`}. {o.source.fit.method !== "manual" && "Lower is a closer match; this is not a confidence score."}
          </p>
        )}
      </section>

      {!isTarget && (
        <section>
          <div className="flex items-center justify-between">
            <div className="label-micro">Behaviour</div>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            <button className={`btn h-8 text-xs ${!o.isStatic ? "border-accent bg-accent-soft/40 text-white" : ""}`} onClick={() => upd((x) => void (x.isStatic = false))} data-testid="make-dynamic">
              Moves (dynamic)
            </button>
            <button className={`btn h-8 text-xs ${o.isStatic ? "border-accent bg-accent-soft/40 text-white" : ""}`} onClick={() => upd((x) => void ((x.isStatic = true), (x.initialVelocity = [0, 0])))} data-testid="make-static">
              Fixed (static)
            </button>
          </div>
        </section>
      )}
      {isTarget && <p className="rounded-lg bg-panel p-2 text-[11px] text-text-muted">A target is a <b>sensor</b>: objects pass through it and DoodleLab records when they enter.</p>}

      <section>
        <div className="label-micro mb-1.5">Position & shape</div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="x" value={o.x} onChange={(v) => upd((x) => void (x.x = v))} suffix="u" />
          <NumberField label="y (down +)" value={o.y} onChange={(v) => upd((x) => void (x.y = v))} suffix="u" />
          {o.shape.kind === "circle" ? (
            <NumberField label="radius" value={o.shape.radius} min={PARAM_LIMITS.radius.min} max={PARAM_LIMITS.radius.max} onChange={(v) => upd((x) => { if (x.shape.kind === "circle") { x.shape.radius = v; x.sketch = wobbleOutline(x.shape, x.id); } })} suffix="u" />
          ) : (
            <>
              <NumberField label="width" value={o.shape.width} min={PARAM_LIMITS.side.min} max={PARAM_LIMITS.side.max} onChange={(v) => upd((x) => { if (x.shape.kind === "rect") { x.shape.width = v; x.sketch = wobbleOutline(x.shape, x.id); } })} suffix="u" />
              <NumberField label="height" value={o.shape.height} min={PARAM_LIMITS.side.min} max={PARAM_LIMITS.side.max} onChange={(v) => upd((x) => { if (x.shape.kind === "rect") { x.shape.height = v; x.sketch = wobbleOutline(x.shape, x.id); } })} suffix="u" />
            </>
          )}
          {o.shape.kind === "rect" && <NumberField label="rotation" value={o.rotationDeg} min={-180} max={180} onChange={(v) => upd((x) => void (x.rotationDeg = v))} suffix="°" />}
        </div>
      </section>

      {!isTarget && (
        <section>
          <div className="label-micro mb-1.5">Material (illustrative preset)</div>
          <div className="grid grid-cols-1 gap-1">
            {MATERIALS.map((name) => {
              const p = MATERIAL_PRESETS[name];
              return (
                <button key={name} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left ${o.material === name ? "border-accent bg-accent-soft/25" : "border-border hover:bg-panel"}`} onClick={() => upd((x) => void ((x.material = name), (x.overrides = {})))} aria-pressed={o.material === name} data-testid={`material-${name}`}>
                  <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
                  <span className="text-xs font-semibold">{p.label}</span>
                  <span className="ml-auto text-[10px] text-text-faint">{p.blurb}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            <Slider label="Bounce (restitution)" value={m.restitution} min={0} max={PARAM_LIMITS.restitution.max} step={0.01} presetValue={preset.restitution} onChange={(v) => upd((x) => void (x.overrides = { ...x.overrides, restitution: v }))} testid="bounce-slider" />
            <Slider label="Friction" value={m.friction} min={0} max={1} step={0.01} presetValue={preset.friction} onChange={(v) => upd((x) => void (x.overrides = { ...x.overrides, friction: v }))} />
            <Slider label="Density" value={m.density} min={PARAM_LIMITS.density.min} max={PARAM_LIMITS.density.max} step={0.0002} presetValue={preset.density} onChange={(v) => upd((x) => void (x.overrides = { ...x.overrides, density: v }))} />
          </div>
          <p className="mt-2 text-[11px] leading-snug text-text-faint">{MASS_NOTE} Presets are simulation settings, not measured real materials.</p>
        </section>
      )}

      {!o.isStatic && !isTarget && (
        <section>
          <div className="label-micro mb-1.5">Starting push</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="vx →" value={o.initialVelocity[0]} min={-1600} max={1600} step={10} onChange={(v) => upd((x) => void (x.initialVelocity = [v, x.initialVelocity[1]]))} suffix="u/s" />
            <NumberField label="vy ↓" value={o.initialVelocity[1]} min={-1600} max={1600} step={10} onChange={(v) => upd((x) => void (x.initialVelocity = [x.initialVelocity[0], v]))} suffix="u/s" />
          </div>
        </section>
      )}

      <button className="btn h-8 text-xs text-bad" onClick={() => st().removeObjects([o.id])} data-testid="delete-object">
        <Trash2 size={14} /> Delete
      </button>
    </div>
  );
}

function Slider({ label, value, min, max, step, presetValue, onChange, testid }: { label: string; value: number; min: number; max: number; step: number; presetValue: number; onChange: (v: number) => void; testid?: string }) {
  const changed = Math.abs(value - presetValue) > 1e-9;
  return (
    <label className="text-[11px] text-text-muted">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className="font-mono text-text">
          {value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}
          {changed && <span className="ml-1 text-text-faint">(preset {presetValue < 0.01 && presetValue > 0 ? presetValue.toFixed(4) : presetValue})</span>}
        </span>
      </div>
      <input type="range" className="mt-1 w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testid} />
    </label>
  );
}

function MultiPanel({ ids }: { ids: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text-muted">{ids.join(", ")}</p>
      <button className="btn h-8 text-xs text-bad" onClick={() => useLab.getState().removeObjects(ids)}>
        <Trash2 size={14} /> Delete {ids.length} objects
      </button>
    </div>
  );
}
