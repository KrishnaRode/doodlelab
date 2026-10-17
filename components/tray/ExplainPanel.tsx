"use client";

import { useEffect, useState } from "react";
import { Bot, Lightbulb, Loader2, Ruler, X } from "lucide-react";
import { useExplain } from "@/lib/state/explain";
import { useLab } from "@/lib/state/store";
import { useAi } from "@/lib/state/ai";
import type { Explanation } from "@/lib/explain/rules";
import type { Fact } from "@/lib/explain/facts";

export function ExplainPanel() {
  const ex = useExplain();
  const model = useLab((s) => s.settings.textModel);
  const ai = useAi((s) => s.status);
  const q = ex.draft;
  const setQ = ex.setDraft;
  const [deeper, setDeeper] = useState(false);

  const elapsed = useElapsed(ex.startedAt);
  const aiAvailable = !!ai?.reachable && !!model;

  return (
    <div className="flex flex-col gap-2 pt-1" data-testid="explain-panel">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ex.run(q.trim() || "Explain what happened"); }}>
        <input className="field h-8 flex-1" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Question about the run" placeholder="Why did the ball stop?" />
        <button className="btn btn-primary h-8 text-xs" type="submit" data-testid="explain-run">
          <Lightbulb size={14} /> Explain
        </button>
      </form>
      {ex.aiError && !ex.rules && <p className="text-sm text-text-muted">{ex.aiError}</p>}
      {ex.rules && (
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
          <div className="flex flex-col gap-2">
            <Observations facts={ex.facts} source={ex.source} />
          </div>
          <div className="flex flex-col gap-2">
            {ex.aiState === "thinking" && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-panel p-2.5 text-xs text-text-muted" data-testid="explain-thinking">
                <Loader2 size={14} className="animate-spin" /> {model} is reading the measured facts… {elapsed}s
                <button className="btn btn-ghost ml-auto h-6 px-2 text-[11px]" onClick={ex.cancel}>
                  <X size={12} /> Cancel
                </button>
              </div>
            )}
            {ex.ai && (
              <ExplanationCard
                title={`Local AI · ${ex.ai.model} · ${(ex.ai.ms / 1000).toFixed(1)} s`}
                icon={<Bot size={13} />}
                e={ex.ai.explanation}
                facts={ex.facts}
                deeper={deeper}
                note={[
                  ex.ai.removed.length ? `Grounding check removed ${ex.ai.removed.length} sentence(s) quoting numbers that were not measured.` : "",
                  ex.ai.stale ? "The scene changed after you asked — this explains the earlier run." : "",
                ].filter(Boolean).join(" ")}
                testid="explain-ai"
              />
            )}
            {ex.aiState === "error" && ex.aiError && (
              <div className="rounded-xl border border-bad/40 bg-bad/5 p-2.5 text-xs" data-testid="explain-ai-error">
                <b>AI explanation unavailable.</b> {ex.aiError}
                <button className="btn ml-2 h-6 px-2 text-[11px]" onClick={ex.askAi}>Retry</button>
              </div>
            )}
            <ExplanationCard title="Rule-based summary (no AI model)" icon={<Ruler size={13} />} e={ex.rules} facts={ex.facts} deeper={deeper} testid="explain-rules" />
            <div className="flex items-center gap-2">
              <button className="btn h-7 px-2 text-[11px]" onClick={() => setDeeper(!deeper)}>{deeper ? "Simple explanation" : "Deeper explanation"}</button>
              {!aiAvailable && <span className="text-[11px] text-text-faint">{ai?.reachable ? "No local text model selected." : "Ollama is offline — showing the rule-based summary only."}</span>}
              {aiAvailable && !ex.ai && ex.aiState !== "thinking" && (
                <button className="btn h-7 px-2 text-[11px]" onClick={ex.askAi}><Bot size={12} /> Ask {model}</button>
              )}
            </div>
          </div>
        </div>
      )}
      {!ex.rules && !ex.aiError && <p className="text-sm text-text-muted">Ask about the latest run. Measured observations are listed separately from possible explanations.</p>}
    </div>
  );
}

function Observations({ facts, source }: { facts: Fact[]; source: string | null }) {
  const measured = facts.filter((f) => f.kind !== "setting");
  const settings = facts.filter((f) => f.kind === "setting");
  return (
    <div className="rounded-xl border border-border bg-panel p-2.5" data-testid="observations">
      <div className="label-micro mb-1">Observations — measured {source === "headless" ? "(quick headless run of the current scene)" : source === "archived" ? "(previous run)" : "(this run)"}</div>
      <ul className="flex flex-col gap-0.5 text-[11px] text-text-muted">
        {measured.map((f) => (
          <li key={f.id}><span className="mr-1 font-mono text-text-faint">{f.id}</span>{f.text}</li>
        ))}
      </ul>
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[11px] text-text-faint">Scene settings ({settings.length})</summary>
        <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-text-muted">
          {settings.map((f) => (
            <li key={f.id}><span className="mr-1 font-mono text-text-faint">{f.id}</span>{f.text}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ExplanationCard({ title, icon, e, facts, deeper, note, testid }: { title: string; icon: React.ReactNode; e: Explanation; facts: Fact[]; deeper: boolean; note?: string; testid: string }) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  return (
    <div className="rounded-xl border border-border bg-panel p-2.5" data-testid={testid}>
      <div className="label-micro mb-1 flex items-center gap-1">{icon} {title}</div>
      <p className="text-[13px] leading-snug">{deeper ? e.deeper : e.child}</p>
      {e.reasons.length > 0 && (
        <div className="mt-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Possible explanations</div>
          <ul className="mt-0.5 flex flex-col gap-0.5 text-[11px] text-text-muted">
            {e.reasons.map((r, i) => (
              <li key={i}>
                {r.text}{" "}
                {r.factIds.map((id) => (
                  <span key={id} className="ml-0.5 cursor-help rounded bg-panel-hover px-1 font-mono text-[10px] text-text-faint" title={byId.get(id)?.text}>{id}</span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {note && <p className="mt-1 text-[10px] text-text-faint">{note}</p>}
    </div>
  );
}

function useElapsed(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [since]);
  return since ? ((now - since) / 1000).toFixed(1) : "0";
}

export { useElapsed };
