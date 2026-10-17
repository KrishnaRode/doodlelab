"use client";

import { useState } from "react";
import { ArrowRight, Camera, X } from "lucide-react";
import { SAMPLES } from "@/lib/scene/samples";
import { loadSample } from "@/lib/state/actions";
import { useLab } from "@/lib/state/store";
import { appConfig } from "@/app.config";

export function EmptyState() {
  const empty = useLab((s) => s.scene.objects.length === 0 && s.pending.length === 0 && s.mode === "edit");
  const [dismissed, setDismissed] = useState(false);
  if (!empty || dismissed) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="pointer-events-auto relative w-full max-w-[560px] animate-rise rounded-2xl border border-black/5 bg-white/80 p-6 text-[#2a2f3d] shadow-xl backdrop-blur-sm">
        <button className="absolute right-3 top-3 rounded-md p-1 text-[#6b7285] hover:bg-black/5" aria-label="Hide and start drawing" title="Hide and start drawing" onClick={() => setDismissed(true)}>
          <X size={16} />
        </button>
        <div className="font-[family-name:var(--font-hand)] text-4xl font-bold leading-none text-[#2a2f3d]">{appConfig.tagline}</div>
        <p className="mt-2 text-sm text-[#565d70]">
          Draw a <b>ball</b> (circle), a <b>block</b> (box) and a <b>ramp</b> (straight line) right on the paper — or pick a tool on the left. Then press <b>Bring to Life</b>.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {SAMPLES.map((s) => (
            <button key={s.id} onClick={() => loadSample(s)} className="group rounded-xl border border-black/10 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-[#7c9bff] hover:shadow-md" data-testid={`sample-${s.id}`}>
              <div className="text-[13px] font-semibold">{s.title}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-[#6b7285]">{s.blurb}</div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-[#4b6bff]">
                Open <ArrowRight size={12} className="transition group-hover:translate-x-0.5" />
              </div>
            </button>
          ))}
        </div>
        <button className="mt-3 flex items-center gap-2 text-xs font-semibold text-[#4b6bff] hover:underline" onClick={() => useLab.getState().set({ importOpen: true })}>
          <Camera size={14} /> Or recognise a photo of a paper drawing
        </button>
      </div>
    </div>
  );
}
