/**
 * Deterministic comparison of a vision model's coarse mark class with the geometry fit.
 * The model never changes geometry or roles by itself: it can only agree, or raise a
 * "needs review" with a suggested role the user may accept.
 */
import type { Mark } from "../ai/prompts";
import type { FitKind } from "../geometry/fit";
import type { Role } from "../scene/spec";

export interface HintVerdict {
  agrees: boolean;
  suggestion: Role | null;
  reason: string;
}

const LABEL: Record<Mark, string> = {
  "round-shape": "a round shape",
  "bullseye-rings": "bullseye rings",
  "box-or-rectangle": "a box",
  "straight-line": "a straight line",
  "text-or-scribble": "text or a scribble",
};

export function compareHint(kind: FitKind, aspect: number, role: Role | null, mark: Mark): HintVerdict {
  const sees = `Vision model sees ${LABEL[mark]}`;
  if (mark === "text-or-scribble") return { agrees: false, suggestion: null, reason: `${sees} — consider leaving it out.` };
  if (mark === "bullseye-rings") {
    return role === "target" ? { agrees: true, suggestion: null, reason: `${sees} (agrees: target).` } : { agrees: false, suggestion: "target", reason: `${sees} — maybe a target?` };
  }
  if (mark === "round-shape") {
    return kind === "circle" ? { agrees: true, suggestion: null, reason: `${sees} (agrees).` } : { agrees: false, suggestion: "ball", reason: `${sees}; geometry says ${kind}.` };
  }
  if (mark === "box-or-rectangle") {
    return kind === "rect" ? { agrees: true, suggestion: null, reason: `${sees} (agrees).` } : { agrees: false, suggestion: "block", reason: `${sees}; geometry says ${kind}.` };
  }
  // straight-line: a thin box (aspect ≥ 3, e.g. a domino) honestly looks like a line too.
  if (kind === "line" || (kind === "rect" && aspect >= 3)) return { agrees: true, suggestion: null, reason: `${sees} (agrees).` };
  return { agrees: false, suggestion: "ramp", reason: `${sees}; geometry says ${kind}.` };
}
