/**
 * Rule-based explanation used when no local model is available (and as the always-correct
 * baseline). It is clearly labelled as rule-based in the UI — never shown as an AI answer.
 */
import { MASS_NOTE, resolveMaterial } from "../scene/materials";
import type { SceneSpec } from "../scene/spec";
import type { RunSummary } from "../physics/telemetry";
import { questionSubject, type Fact } from "./facts";

export interface Explanation {
  child: string;
  deeper: string;
  reasons: { text: string; factIds: string[] }[];
}

function factFor(facts: Fact[], pred: (f: Fact) => boolean): string[] {
  return facts.filter(pred).map((f) => f.id);
}

export function ruleBasedExplanation(spec: SceneSpec, run: RunSummary, facts: Fact[], question: string, selection: string[] = []): Explanation {
  const subj = questionSubject(question, spec, selection);
  const reasons: Explanation["reasons"] = [];
  const childBits: string[] = [];
  const deepBits: string[] = [];
  const g = run.gravity.scale;

  if (subj && !subj.isStatic && run.bodies[subj.id]) {
    const b = run.bodies[subj.id]!;
    const m = resolveMaterial(subj.material, subj.overrides);
    const nm = subj.label || subj.id;
    const about = factFor(facts, (f) => f.subject === subj.id);
    if (b.leftWorldAtSec !== null) {
      childBits.push(`The ${nm.toLowerCase()} flew out of the picture — nothing was there to stop it.`);
      deepBits.push(`${nm} left the world at ${b.leftWorldAtSec} s. With nothing in its path, it kept going until it passed the edge.`);
      reasons.push({ text: "Nothing blocked its path before the world edge.", factIds: about });
    } else if (b.restedAtSec !== null) {
      if (b.collisions >= 2 && m.restitution < 0.9) {
        childBits.push(`The ${nm.toLowerCase()} lost a bit of its speed every time it hit something, until it had none left.`);
        deepBits.push(
          `${nm} collided ${b.collisions} times. Its bounce setting is ${m.restitution}, below perfect elasticity (1), so each collision keeps only part of the motion. ` +
            `Friction (${m.friction}) with the surfaces it touched then slowed any rolling or sliding until it rested at ${b.restedAtSec} s.`,
        );
        reasons.push({ text: `Bounce setting ${m.restitution} is below 1, so every impact removes motion.`, factIds: about });
        reasons.push({ text: `Friction ${m.friction} slows rolling and sliding.`, factIds: about });
      } else if (g === 0) {
        childBits.push(`With no gravity, nothing pulled the ${nm.toLowerCase()} anywhere, so it stayed put.`);
        deepBits.push(`Gravity was set to zero, so ${nm} only moves if something pushes it.`);
        reasons.push({ text: "Zero gravity — no force pulling it down.", factIds: factFor(facts, (f) => f.text.startsWith("Gravity")) });
      } else {
        childBits.push(`The ${nm.toLowerCase()} found a resting place where the ground held it up.`);
        deepBits.push(`${nm} settled at ${b.restedAtSec} s. Once a surface supports it and friction (${m.friction}) stops any sliding, gravity can't move it further.`);
        reasons.push({ text: "It settled on a supporting surface.", factIds: about });
      }
    } else {
      childBits.push(`The ${nm.toLowerCase()} was still moving when the run ended.`);
      deepBits.push(`${nm} was moving at ${Math.round(b.finalSpeed)} u/s at the end. Low friction (${m.friction}) or a slope can keep things rolling for a long time.`);
      reasons.push({ text: "Still moving at the end of the observation window.", factIds: about });
    }
    if (/heav|mass|weigh/.test(question.toLowerCase())) deepBits.push(MASS_NOTE);
  }

  if (run.goal) {
    const gf = factFor(facts, (f) => f.text.startsWith("Goal"));
    if (run.goal.reached) {
      childBits.push(`It made it into the target!`);
      reasons.push({ text: `The goal was reached at ${run.goal.atSec} s.`, factIds: gf });
    } else {
      childBits.push(`It didn't reach the target this time — try changing one thing and run it again.`);
      reasons.push({ text: "The goal was not reached in this run.", factIds: gf });
    }
  }
  const dom = facts.find((f) => /dominoes ended tipped/.test(f.text));
  if (dom) {
    deepBits.push(dom.text.replace(/\.$/, "") + ": each falling domino pushes the next one over, passing the motion down the line.");
    reasons.push({ text: "A chain reaction passes motion from domino to domino.", factIds: [dom.id] });
  }
  const changes = facts.filter((f) => f.kind === "change");
  if (changes.length && !changes[0]!.text.startsWith("No settings")) {
    deepBits.push(`Compared with the previous run, these settings changed: ${changes.map((c) => c.text.replace("Since the previous run: ", "").replace(/\.$/, "")).join("; ")}.`);
    reasons.push({ text: "Parameter changes since the previous run.", factIds: changes.map((c) => c.id) });
  }
  if (!childBits.length) childBits.push("Here's what the simulation measured.");
  return { child: childBits.join(" "), deeper: deepBits.join(" ") || "Nothing dynamic moved in this run.", reasons };
}
