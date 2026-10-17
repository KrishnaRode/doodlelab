"use client";

import { useRef, useState } from "react";
import { ArrowUp, Bot, Check, Loader2, Undo2, Wand2, X } from "lucide-react";
import { useCopilot } from "@/lib/state/copilot";
import { COMMAND_EXAMPLES } from "@/lib/copilot/commands";
import { useLab } from "@/lib/state/store";
import { useElapsed } from "../tray/ExplainPanel";

export function Copilot() {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const card = useCopilot((s) => s.card);
  const compareOpen = useLab((s) => s.compareOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = (t: string) => {
    useCopilot.getState().submit(t);
    setText("");
  };
  if (compareOpen) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex flex-col items-center gap-2 px-3">
      {card && (
        <div className="pointer-events-auto w-full max-w-[540px]">
          <CardView />
        </div>
      )}
      {focused && !text && !card && (
        <div className="pointer-events-auto flex max-w-[600px] flex-wrap justify-center gap-1.5">
          {COMMAND_EXAMPLES.map((e) => (
            <button key={e} className="rounded-full border border-black/10 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-[#3a4155] shadow-sm hover:bg-white" onMouseDown={(ev) => ev.preventDefault()} onClick={() => submit(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
      <form
        className="pointer-events-auto flex w-full max-w-[540px] items-center gap-2 rounded-full border border-black/10 bg-white/90 py-1 pl-4 pr-1 shadow-lg backdrop-blur"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <Wand2 size={15} className="shrink-0 text-[#4b6bff]" />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Tell DoodleLab… “make the ball bouncier”"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm text-[#22283a] placeholder:text-[#8a90a2] focus:outline-none"
          aria-label="Copilot command"
          data-testid="copilot-input"
          maxLength={300}
        />
        <button type="submit" disabled={!text.trim()} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4b6bff] text-white transition disabled:opacity-30" aria-label="Send">
          <ArrowUp size={16} />
        </button>
      </form>
    </div>
  );
}

function CardView() {
  const card = useCopilot((s) => s.card)!;
  const { apply, dismiss, undoApplied, cancel, submit } = useCopilot.getState();
  const elapsed = useElapsed(card.kind === "thinking" ? card.startedAt : null);
  const shell = "animate-rise rounded-2xl border border-black/10 bg-white/95 p-3 text-[#22283a] shadow-xl backdrop-blur";
  const Close = (
    <button className="ml-auto rounded-md p-1 text-[#8a90a2] hover:bg-black/5" onClick={dismiss} aria-label="Dismiss">
      <X size={14} />
    </button>
  );
  if (card.kind === "thinking") {
    return (
      <div className={shell} data-testid="copilot-thinking">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 size={15} className="animate-spin text-[#4b6bff]" />
          <span>
            Asking <b>{card.model}</b> to turn “{card.text}” into a proposal… <span className="font-mono text-xs text-[#6b7285]">{elapsed}s</span>
          </span>
          <button className="ml-auto rounded-full border border-black/10 px-2.5 py-0.5 text-xs hover:bg-black/5" onClick={cancel}>
            Cancel
          </button>
        </div>
        <p className="mt-1 text-[11px] text-[#6b7285]">Physics controls keep working while it thinks.</p>
      </div>
    );
  }
  if (card.kind === "info") {
    return (
      <div className={shell} data-testid="copilot-info">
        <div className="flex items-start gap-2 text-sm">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${{ info: "bg-[#4b6bff]", ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-rose-500" }[card.tone]}`} />
          <span>{card.message}</span>
          {Close}
        </div>
        {card.examples && <p className="mt-1.5 text-[11px] text-[#6b7285]">Try: {COMMAND_EXAMPLES.slice(0, 4).join(" · ")}</p>}
      </div>
    );
  }
  if (card.kind === "clarify") {
    return (
      <div className={shell} data-testid="copilot-clarify">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {card.question}
          {Close}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.options.map((o) => (
            <button key={o.objectId} className="rounded-full border border-[#4b6bff]/40 px-2.5 py-1 text-xs font-medium text-[#3550d8] hover:bg-[#4b6bff]/10" onClick={() => submit(`${card.text} (${o.objectId})`)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  // proposal
  return (
    <div className={shell} data-testid="copilot-proposal">
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold">{card.patch.summary}</div>
        {Close}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#8a90a2]">
        {card.source.startsWith("Local AI") ? <Bot size={11} /> : <Wand2 size={11} />} {card.source}
      </div>
      <table className="mt-2 w-full text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-[#8a90a2]">
          <tr>
            <th className="font-semibold">Object</th>
            <th className="font-semibold">Change</th>
            <th className="font-semibold">Before</th>
            <th className="font-semibold">After</th>
          </tr>
        </thead>
        <tbody>
          {card.changes.map((c, i) => (
            <tr key={i} className="border-t border-black/5">
              <td className="py-0.5 font-mono">{c.target}</td>
              <td>{c.what}</td>
              <td className="font-mono text-[#6b7285]">{c.before}</td>
              <td className="font-mono font-semibold">{c.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {card.note && <p className="mt-1.5 text-[11px] text-[#6b7285]">{card.note}</p>}
      {card.warnings.length > 0 && <p className="mt-1 text-[11px] text-amber-700">Heads-up: {card.warnings.slice(0, 2).map((w) => w.message).join(" ")}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        {!card.applied ? (
          <>
            <button className="flex h-8 items-center gap-1.5 rounded-full bg-[#4b6bff] px-3.5 text-xs font-semibold text-white hover:bg-[#3d5cf0]" onClick={apply} data-testid="copilot-apply">
              <Check size={14} /> Apply
            </button>
            <button className="h-8 rounded-full border border-black/10 px-3 text-xs hover:bg-black/5" onClick={dismiss}>
              Discard
            </button>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600" data-testid="copilot-applied">
              <Check size={14} /> Applied
            </span>
            <button className="flex h-8 items-center gap-1.5 rounded-full border border-black/10 px-3 text-xs hover:bg-black/5" onClick={undoApplied} data-testid="copilot-undo">
              <Undo2 size={13} /> Undo
            </button>
          </>
        )}
      </div>
    </div>
  );
}
