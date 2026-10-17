"use client";

import { useMemo } from "react";
import { useLab } from "@/lib/state/store";
import { useRuntime } from "@/lib/state/controller";
import { semanticIssues } from "@/lib/scene/validate";

/** The stage's single source of "what state am I in". */
export function StatusPill() {
  const mode = useLab((s) => s.mode);
  const scene = useLab((s) => s.scene);
  const pending = useLab((s) => s.pending.length);
  const status = useRuntime((s) => s.status);
  const time = useRuntime((s) => s.time);
  const goal = useRuntime((s) => s.goalReachedAt);
  const replayT = useRuntime((s) => s.replayT);

  const { errors, review } = useMemo(() => {
    const issues = semanticIssues(scene);
    return { errors: issues.filter((i) => i.severity === "error").length, review: scene.objects.filter((o) => o.source.needsReview).length };
  }, [scene]);

  let label: string;
  let tone: "muted" | "ok" | "warn" | "bad" | "live" = "muted";
  if (mode === "transition") {
    label = "Bringing to life…";
    tone = "live";
  } else if (mode === "live") {
    label = status === "running" ? `Running · ${time.toFixed(1)} s` : `Paused · ${time.toFixed(2)} s`;
    tone = status === "running" ? "live" : "muted";
    if (goal !== null) label += ` · target reached ${goal.toFixed(2)} s`;
    if (replayT !== null && status === "paused") label = `Replay view · ${replayT.toFixed(2)} s of ${time.toFixed(2)} s`;
  } else if (scene.objects.length === 0 && pending === 0) {
    label = "Empty — start drawing";
  } else if (errors) {
    label = `${errors} problem${errors > 1 ? "s" : ""} to fix`;
    tone = "bad";
  } else if (review + pending) {
    label = `Needs review · ${review + pending}`;
    tone = "warn";
  } else {
    label = `Ready · ${scene.objects.length} object${scene.objects.length === 1 ? "" : "s"}`;
    tone = "ok";
  }
  const dot = { muted: "bg-text-faint", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", live: "bg-life animate-pulse-soft" }[tone];
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-2 rounded-full border border-black/5 bg-white/85 px-3 py-1 text-xs font-semibold text-[#2a2f3d] shadow-sm backdrop-blur" data-testid="status-pill">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </div>
  );
}
