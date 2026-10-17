/**
 * Grounding check for AI explanations: any sentence quoting a number that does not appear
 * in the supplied facts is removed and reported. Fact citations must exist.
 */
import type { Fact } from "./facts";

const SMALL_OK = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

function numbersIn(s: string): number[] {
  return (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function known(n: number, factNums: number[]): boolean {
  if (SMALL_OK.has(Math.abs(n))) return true;
  return factNums.some((f) => Math.abs(f - n) <= Math.max(0.011, Math.abs(f) * 0.02));
}

export function groundText(text: string, facts: Fact[]): { text: string; removed: string[] } {
  const factNums = facts.flatMap((f) => f.numbers);
  // Split only where punctuation is followed by whitespace, so decimals like 2.81 stay intact.
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const kept: string[] = [];
  const removed: string[] = [];
  for (const s of sentences) {
    const bad = numbersIn(s).filter((n) => !known(n, factNums));
    if (bad.length) removed.push(s.trim());
    else kept.push(s.trim());
  }
  return { text: kept.join(" ").trim(), removed };
}

export function validCitations(ids: string[], facts: Fact[]): string[] {
  const set = new Set(facts.map((f) => f.id));
  return ids.filter((id) => set.has(id));
}
