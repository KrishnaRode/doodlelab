"use client";

import { Circle, Eraser, Minus, MousePointer2, Pencil, Redo2, Square, Target, TrendingUp, Undo2 } from "lucide-react";
import { useLab, type Tool } from "@/lib/state/store";

const TOOLS: Array<{ id: Tool; label: string; key: string; icon: React.ReactNode; hint: string }> = [
  { id: "select", label: "Select", key: "V", icon: <MousePointer2 size={18} />, hint: "Select, move, resize (corner) and rotate (top handle)" },
  { id: "pencil", label: "Pencil", key: "P", icon: <Pencil size={18} />, hint: "Freehand: circles become balls, boxes become blocks, lines become ramps" },
  { id: "ball", label: "Ball", key: "B", icon: <Circle size={18} />, hint: "Click for a ball, or drag to set its size" },
  { id: "block", label: "Block", key: "K", icon: <Square size={18} />, hint: "Click for a block, or drag a rectangle" },
  { id: "ramp", label: "Ramp", key: "R", icon: <TrendingUp size={18} />, hint: "Drag a line: it becomes a fixed ramp" },
  { id: "ground", label: "Ground", key: "G", icon: <Minus size={18} />, hint: "Click for full-width ground, or drag a platform line" },
  { id: "target", label: "Target", key: "T", icon: <Target size={18} />, hint: "A goal zone (a sensor — things pass through it)" },
  { id: "eraser", label: "Eraser", key: "E", icon: <Eraser size={18} />, hint: "Click or drag over objects to remove them" },
];

export function ToolRail() {
  const tool = useLab((s) => s.tool);
  const mode = useLab((s) => s.mode);
  const canUndo = useLab((s) => s.past.length > 0);
  const canRedo = useLab((s) => s.future.length > 0);
  const disabled = mode !== "edit";
  return (
    <nav className="flex w-[58px] shrink-0 flex-col items-center gap-1 px-1.5 pb-2" aria-label="Drawing tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          disabled={disabled}
          title={`${t.label} (${t.key}) — ${t.hint}`}
          aria-label={t.label}
          aria-pressed={tool === t.id}
          data-testid={`tool-${t.id}`}
          onClick={() => useLab.getState().setTool(t.id)}
          className={`focus-ring group flex h-11 w-11 flex-col items-center justify-center rounded-xl transition ${
            tool === t.id && !disabled ? "bg-accent-soft text-white shadow-[0_6px_18px_-8px_rgba(124,155,255,0.9)]" : "text-text-muted hover:bg-panel hover:text-text"
          } disabled:opacity-35`}
        >
          {t.icon}
          <span className="mt-0.5 text-[9px] font-semibold leading-none">{t.label}</span>
        </button>
      ))}
      <div className="my-1.5 h-px w-8 bg-border" />
      <button className="btn btn-ghost btn-icon" title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} onClick={() => useLab.getState().undo()} data-testid="undo">
        <Undo2 size={17} />
      </button>
      <button className="btn btn-ghost btn-icon" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo} onClick={() => useLab.getState().redo()}>
        <Redo2 size={17} />
      </button>
    </nav>
  );
}
