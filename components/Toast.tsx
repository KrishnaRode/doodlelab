"use client";

import { useEffect, useState } from "react";
import { useLab } from "@/lib/state/store";

const TONE: Record<string, string> = {
  info: "border-border text-text",
  ok: "border-ok/50 text-text",
  warn: "border-warn/60 text-text",
  bad: "border-bad/60 text-text",
};
const DOT: Record<string, string> = { info: "bg-accent", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };

export function Toast() {
  const toast = useLab((s) => s.toast);
  const [hiddenId, setHiddenId] = useState<number | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setHiddenId(toast.id), toast.tone === "bad" ? 6500 : 4200);
    return () => clearTimeout(t);
  }, [toast]);
  const visible = toast && toast.id !== hiddenId ? toast : null;
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed left-1/2 top-14 z-[60] -translate-x-1/2" role="status" aria-live="polite">
      <div key={visible.id} className={`pointer-events-auto flex max-w-[560px] animate-rise items-center gap-2.5 rounded-xl border bg-panel/95 px-3.5 py-2.5 text-sm shadow-2xl backdrop-blur ${TONE[visible.tone]}`} data-testid="toast">
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[visible.tone]}`} />
        {visible.text}
      </div>
    </div>
  );
}
