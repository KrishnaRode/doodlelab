"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useLab, type TrayTab } from "@/lib/state/store";
import { getController, useRuntime } from "@/lib/state/controller";
import { ExplainPanel } from "./ExplainPanel";
import { ChallengePanel } from "./ChallengePanel";
import type { RunSummary } from "@/lib/physics/telemetry";

const TABS: Array<{ id: TrayTab; label: string }> = [
  { id: "observe", label: "Observe" },
  { id: "explain", label: "Explain" },
  { id: "challenge", label: "Target challenge" },
  { id: "events", label: "Events" },
];

export function Tray() {
  const open = useLab((s) => s.trayOpen);
  const tab = useLab((s) => s.trayTab);
  const setTab = (t: TrayTab) => useLab.getState().set({ trayTab: t, trayOpen: true });
  return (
    <section className={`shrink-0 overflow-hidden rounded-2xl border border-border bg-chrome/80 backdrop-blur transition-[height] ${open ? "h-[248px]" : "h-10"}`} data-testid="tray">
      <div className="flex h-10 items-center gap-1 px-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${open && tab === t.id ? "bg-panel-hover text-text" : "text-text-muted hover:text-text"}`} data-testid={`tray-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
        <button className="btn btn-ghost btn-icon ml-auto h-7 w-7" onClick={() => useLab.getState().set({ trayOpen: !open })} aria-label={open ? "Collapse experiment tray" : "Expand experiment tray"}>
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {open && (
        <div className="scroll-thin h-[208px] overflow-y-auto px-3 pb-3">
          {/* Panels stay mounted only while visible; none of them touch the live world. */}
          {tab === "observe" && <ObservePanel />}
          {tab === "explain" && <ExplainPanel />}
          {tab === "challenge" && <ChallengePanel />}
          {tab === "events" && <EventsPanel />}
        </div>
      )}
    </section>
  );
}

function useLiveSummary(): RunSummary | null {
  const tick = useRuntime((s) => s.tick);
  const status = useRuntime((s) => s.status);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getController().summary(), [tick, status]);
}

function ObservePanel() {
  const summary = useLiveSummary();
  const scene = useLab((s) => s.scene);
  const mode = useLab((s) => s.mode);
  if (!summary || mode === "edit") {
    return <p className="pt-2 text-sm text-text-muted">Press <b>Bring to Life</b> to start measuring. Everything shown here is measured by the simulation — in scene units (u) and simulated seconds.</p>;
  }
  const labels = new Map(scene.objects.map((o) => [o.id, o.label || o.id]));
  const bodies = Object.values(summary.bodies).filter((b) => !b.isStatic);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 text-xs">
        <Stat label="Time" value={`${summary.simulatedSec.toFixed(2)} s`} />
        <Stat label="Steps" value={String(summary.steps)} />
        <Stat label="Collisions" value={String(summary.collisionCount)} />
        <Stat label="Gravity" value={`${summary.gravity.scale}×`} />
        {summary.goal && <Stat label="Goal" value={summary.goal.reached ? `reached ${summary.goal.atSec} s` : "not yet"} tone={summary.goal.reached ? "ok" : undefined} />}
      </div>
      <table className="w-full text-left text-xs" data-testid="telemetry-table">
        <thead className="text-[10px] uppercase tracking-wider text-text-faint">
          <tr>
            <th className="py-1 font-semibold">Object</th>
            <th className="font-semibold">Speed now</th>
            <th className="font-semibold">Top speed</th>
            <th className="font-semibold">Max rise</th>
            <th className="font-semibold">Max displacement</th>
            <th className="font-semibold">Hits</th>
            <th className="font-semibold">State</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {bodies.slice(0, 30).map((b) => (
            <tr key={b.id} className="border-t border-border-soft">
              <td className="py-1 font-sans font-medium">{labels.get(b.id)}</td>
              <td>{Math.round(b.finalSpeed)} u/s</td>
              <td>{Math.round(b.maxSpeed)} u/s</td>
              <td>{Math.round(b.maxRise)} u</td>
              <td>{Math.round(b.maxDisplacement)} u</td>
              <td>{b.collisions}</td>
              <td className="font-sans text-text-muted">{b.leftWorldAtSec !== null ? `left world ${b.leftWorldAtSec}s` : b.restedAtSec !== null ? `at rest ${b.restedAtSec}s` : "moving"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" }) {
  return (
    <div className={`rounded-lg border px-2.5 py-1 ${tone === "ok" ? "border-ok/50 text-ok" : "border-border"}`}>
      <span className="text-text-faint">{label} </span>
      <span className="font-mono font-semibold">{value}</span>
    </div>
  );
}

function EventsPanel() {
  const summary = useLiveSummary();
  if (!summary) return <p className="pt-2 text-sm text-text-muted">Collision and target events appear here while the experiment runs.</p>;
  const ev = summary.events.slice(-80).reverse();
  return (
    <div className="font-mono text-[11px]" data-testid="events">
      {ev.length === 0 && <p className="font-sans text-sm text-text-muted">No events yet.</p>}
      {ev.map((e, i) => (
        <div key={i} className="flex gap-3 border-b border-border-soft py-0.5">
          <span className="w-14 text-text-faint">{e.t.toFixed(2)} s</span>
          <span className={e.type === "target-enter" ? "text-warn" : e.type === "collision" ? "text-text-muted" : "text-accent"}>{e.type}</span>
          <span>
            {e.a}
            {e.b ? ` ↔ ${e.b}` : ""}
            {e.impactSpeed !== undefined ? ` · ${e.impactSpeed} u/s` : ""}
            {e.note ? ` · ${e.note}` : ""}
          </span>
        </div>
      ))}
      {summary.eventsTruncated && <p className="pt-1 font-sans text-text-faint">Event log capped at 400 entries.</p>}
    </div>
  );
}
