/**
 * Deterministic copilot parser for the common command vocabulary. Runs instantly, with no
 * model. Anything it cannot parse confidently returns `unknown`, and only then is the
 * local LLM asked to propose an allowlisted ScenePatch.
 */
import { MASS_NOTE, resolveMaterial } from "../scene/materials";
import { makeObject, nextId } from "../scene/objects";
import type { PatchOp, ScenePatch } from "../scene/patch";
import { GRAVITY_PRESETS, PARAM_LIMITS, type MaterialName, type Role, type SceneObject, type SceneSpec } from "../scene/spec";
import { hitTest, rectCorners } from "../geometry/math";

export type ControlAction = "reset" | "play" | "pause" | "compare" | "bring-to-life";

export type CommandResult =
  | { kind: "patch"; patch: ScenePatch; note?: string; source: "rules" }
  | { kind: "control"; action: ControlAction; label: string }
  | { kind: "explain"; question: string }
  | { kind: "clarify"; question: string; options: { label: string; objectId: string }[] }
  | { kind: "error"; message: string }
  | { kind: "unknown" };

export interface CommandContext {
  scene: SceneSpec;
  selection: string[];
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3,
};

const ROLE_WORDS: Array<[RegExp, Role[]]> = [
  [/\bballs?\b/, ["ball"]],
  [/\bramps?\b|\bslopes?\b/, ["ramp"]],
  [/\bdominos?\b|\bdominoes\b/, ["domino"]],
  [/\bblocks?\b|\bboxe?s?\b|\bcubes?\b/, ["block"]],
  [/\bplatforms?\b|\bshelf\b|\bshelves\b|\bledges?\b/, ["platform"]],
  [/\bground\b|\bfloor\b/, ["ground"]],
  [/\bwalls?\b/, ["wall"]],
  [/\btargets?\b|\bgoal\b|\bbasket\b/, ["target"]],
  [/\bdeflector\b/, ["ramp"]],
];

function roleFromText(t: string): Role[] | null {
  for (const [re, roles] of ROLE_WORDS) if (re.test(t)) return roles;
  return null;
}

/** Resolve which object a command refers to — or ask. Never guesses between several. */
export function resolveTarget(
  text: string,
  ctx: CommandContext,
  fallbackRoles: Role[] | null = null,
): { id: string } | { clarify: CommandResult } | { none: string } {
  const t = text.toLowerCase();
  const byId = ctx.scene.objects.find((o) => new RegExp(`\\b${o.id}\\b`).test(t));
  if (byId) return { id: byId.id };
  const byLabel = ctx.scene.objects.find((o) => o.label && t.includes(o.label.toLowerCase()) && o.label.length > 3);
  const deictic = /\b(this|it|that|selected|selection)\b/.test(t);
  const roles = roleFromText(t) ?? fallbackRoles;
  const selected = ctx.selection.map((id) => ctx.scene.objects.find((o) => o.id === id)).filter(Boolean) as SceneObject[];

  if (deictic || !roles) {
    if (selected.length === 1 && (!roles || roles.includes(selected[0]!.role))) return { id: selected[0]!.id };
    if (selected.length > 1) {
      return { clarify: { kind: "clarify", question: "Which selected object do you mean?", options: selected.map((o) => ({ label: o.label || o.id, objectId: o.id })) } };
    }
    if (!roles) return { none: "Select an object first, or name it (for example “the ball”)." };
  }
  if (byLabel && (!roles || roles.includes(byLabel.role))) return { id: byLabel.id };
  const candidates = ctx.scene.objects.filter((o) => roles!.includes(o.role));
  if (candidates.length === 0) return { none: `There is no ${roles![0]} in this scene yet.` };
  if (candidates.length === 1) return { id: candidates[0]!.id };
  const selectedMatch = selected.filter((o) => roles!.includes(o.role));
  if (selectedMatch.length === 1) return { id: selectedMatch[0]!.id };
  return {
    clarify: {
      kind: "clarify",
      question: `Which ${roles![0]} do you mean?`,
      options: candidates.slice(0, 8).map((o) => ({ label: o.label || o.id, objectId: o.id })),
    },
  };
}

function patch(summary: string, ops: PatchOp[], note?: string): CommandResult {
  return { kind: "patch", patch: { summary, ops }, note, source: "rules" };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function parseCommand(input: string, ctx: CommandContext): CommandResult {
  const text = input.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (!text) return { kind: "unknown" };

  // ── Explanations ────────────────────────────────────────────────────────
  if (/^(explain|why|what happened|how come|tell me why)\b/.test(text) || /\bexplain\b/.test(text)) {
    return { kind: "explain", question: input.trim() };
  }

  // ── Controls (never modify the scene) ───────────────────────────────────
  if (/^(reset|restart|start over|rewind)\b|\breset (the )?(experiment|scene|run|simulation)\b/.test(text)) {
    return { kind: "control", action: "reset", label: "Reset to the authored scene" };
  }
  if (/^(play|run|go|start)( it| the (experiment|simulation))?$/.test(text)) return { kind: "control", action: "play", label: "Play" };
  if (/^(pause|stop|freeze|hold on)\b/.test(text)) return { kind: "control", action: "pause", label: "Pause" };
  if (/^compare\b/.test(text)) return { kind: "control", action: "compare", label: "Open gravity comparison" };
  if (/^bring (it )?to life\b/.test(text)) return { kind: "control", action: "bring-to-life", label: "Bring to Life" };

  // ── Gravity ─────────────────────────────────────────────────────────────
  if (/\bgravity\b|\bmoon\b|\bzero[- ]?g\b|\bweightless\b|\bin space\b/.test(text)) {
    const g = ctx.scene.gravity;
    if (/\bmoon\b/.test(text)) return patch("Switch to Moon gravity", [{ op: "gravity", preset: "moon" }]);
    if (/\bearth\b|\bnormal\b|\bdefault\b/.test(text)) return patch("Switch to Earth gravity", [{ op: "gravity", preset: "earth" }]);
    if (/\bzero\b|\bno gravity\b|\bweightless\b|\bspace\b|\boff\b/.test(text)) return patch("Turn gravity off", [{ op: "gravity", preset: "zero" }]);
    const num = text.match(/(\d+(?:\.\d+)?)\s*(x|×|times)?/);
    if (num && /\bset\b|\bto\b/.test(text)) {
      const v = Math.min(PARAM_LIMITS.gravityScale.max, Number(num[1]));
      return patch(`Set gravity to ${v}× Earth`, [{ op: "gravity", preset: "custom", scale: v }]);
    }
    if (/\b(weaker|lower|less|lighter|reduce|decrease|smaller)\b/.test(text)) {
      if (g.scale === 0) return { kind: "error", message: "Gravity is already off." };
      const v = round2(Math.max(0, g.scale * 0.5));
      return patch(`Halve gravity (${g.scale}× → ${v}× Earth)`, [{ op: "gravity", preset: "custom", scale: v }]);
    }
    if (/\b(stronger|higher|more|heavier|increase|bigger)\b/.test(text)) {
      const v = round2(Math.min(PARAM_LIMITS.gravityScale.max, g.scale === 0 ? 0.5 : g.scale * 1.5));
      return patch(`Strengthen gravity (${g.scale}× → ${v}× Earth)`, [{ op: "gravity", preset: "custom", scale: v }]);
    }
  }

  // ── Add things ──────────────────────────────────────────────────────────
  const add = text.match(/\b(add|place|put|insert)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|a couple of|a few)?\s*(more\s+)?(dominos?|dominoes|balls?|blocks?|boxes)\b/);
  if (add) {
    const countWord = (add[2] ?? "a").replace("a couple of", "couple").replace("a few", "few");
    const n = Math.min(12, Number.isFinite(Number(countWord)) ? Number(countWord) : (NUMBER_WORDS[countWord] ?? 1));
    const what = add[4]!;
    if (what.startsWith("domino")) return addDominoes(n, text, ctx);
    return addSimple(what.startsWith("ball") ? "ball" : "block", n, ctx);
  }

  // ── Bounciness ──────────────────────────────────────────────────────────
  const bouncier = /\b(bouncier|more bouncy|bounce more|bounce higher|springier)\b/.test(text);
  const lessBouncy = /\b(less bouncy|bounce less|not bounce|deader|stop bouncing)\b/.test(text);
  if (bouncier || lessBouncy) {
    const r = resolveTarget(text, ctx, ["ball"]);
    if ("clarify" in r) return r.clarify;
    if ("none" in r) return { kind: "error", message: r.none };
    const o = ctx.scene.objects.find((x) => x.id === r.id)!;
    const cur = resolveMaterial(o.material, o.overrides).restitution;
    const v = round2(bouncier ? Math.min(PARAM_LIMITS.restitution.max, cur + 0.25) : Math.max(0, cur - 0.25));
    if (v === cur) return { kind: "error", message: `${o.label || o.id} is already at the ${bouncier ? "maximum" : "minimum"} bounce.` };
    return patch(`${bouncier ? "More" : "Less"} bounce for ${o.label || o.id}`, [{ op: "set", objectId: o.id, field: "restitution", value: v }]);
  }

  // ── Heavier / lighter ───────────────────────────────────────────────────
  const heavier = /\b(heavier|more mass|denser)\b/.test(text);
  const lighter = /\b(lighter|less mass|less dense)\b/.test(text);
  if (heavier || lighter) {
    const r = resolveTarget(text, ctx, ["ball"]);
    if ("clarify" in r) return r.clarify;
    if ("none" in r) return { kind: "error", message: r.none };
    const o = ctx.scene.objects.find((x) => x.id === r.id)!;
    const cur = resolveMaterial(o.material, o.overrides).density;
    const lim = PARAM_LIMITS.density;
    const v = Math.min(lim.max, Math.max(lim.min, heavier ? cur * 2 : cur / 2));
    return patch(`${heavier ? "Double" : "Halve"} the density of ${o.label || o.id}`, [{ op: "set", objectId: o.id, field: "density", value: Number(v.toPrecision(3)) }], MASS_NOTE);
  }

  // ── Materials ───────────────────────────────────────────────────────────
  const mat = text.match(/\b(make|set|turn|change)\b.*\b(slippery|icy|rough|grippy|heavy|wood|wooden|bouncy|rubber)\b/);
  if (mat) {
    const m: MaterialName = ({ slippery: "slippery", icy: "slippery", rough: "rough", grippy: "rough", heavy: "heavy", wood: "wood", wooden: "wood", bouncy: "bouncy", rubber: "bouncy" } as const)[mat[2] as "slippery"];
    const r = resolveTarget(text, ctx);
    if ("clarify" in r) return r.clarify;
    if ("none" in r) return { kind: "error", message: r.none };
    const o = ctx.scene.objects.find((x) => x.id === r.id)!;
    return patch(`Make ${o.label || o.id} ${m}`, [{ op: "setMaterial", objectId: o.id, material: m }]);
  }

  // ── Static / dynamic ────────────────────────────────────────────────────
  const staticM = text.match(/\b(make|set|turn)\b.*\b(static|fixed|pinned|stuck|dynamic|movable|loose|fall)\b/);
  if (staticM) {
    const r = resolveTarget(text, ctx);
    if ("clarify" in r) return r.clarify;
    if ("none" in r) return { kind: "error", message: r.none };
    const o = ctx.scene.objects.find((x) => x.id === r.id)!;
    const isStatic = /static|fixed|pinned|stuck/.test(staticM[2]!);
    if (o.isStatic === isStatic) return { kind: "error", message: `${o.label || o.id} is already ${isStatic ? "static" : "dynamic"}.` };
    return patch(`Make ${o.label || o.id} ${isStatic ? "static" : "dynamic"}`, [{ op: "setStatic", objectId: o.id, isStatic }]);
  }

  // ── Raise / lower / steeper / move ──────────────────────────────────────
  const amount = /\b(a lot|much|way|lots)\b/.test(text) ? 3 : /\b(slightly|a bit|a little|little|tad|bit)\b/.test(text) ? 1 : 2;
  const raise = text.match(/\b(raise|lift|higher|lower|drop)\b/);
  if (raise && !/\bgravity\b/.test(text)) {
    const r = resolveTarget(text, ctx);
    if ("clarify" in r) return r.clarify;
    if ("none" in r) return { kind: "error", message: r.none };
    const o = ctx.scene.objects.find((x) => x.id === r.id)!;
    const up = /raise|lift|higher/.test(raise[1]!);
    const d = [0, 20, 40, 80][amount]!;
    return patch(`${up ? "Raise" : "Lower"} ${o.label || o.id} by ${d} u`, [{ op: "move", objectId: o.id, dx: 0, dy: up ? -d : d }]);
  }
  const steep = text.match(/\b(steeper|flatter|less steep|tilt more|tilt less)\b/);
  if (steep) {
    const r = resolveTarget(text, ctx, ["ramp"]);
    if ("clarify" in r) return r.clarify;
    if ("none" in r) return { kind: "error", message: r.none };
    const o = ctx.scene.objects.find((x) => x.id === r.id)!;
    const more = /steeper|tilt more/.test(steep[1]!);
    const d = [0, 3, 6, 12][amount]!;
    const sign = o.rotationDeg >= 0 ? 1 : -1;
    return patch(`Make ${o.label || o.id} ${more ? "steeper" : "flatter"} by ${d}°`, [{ op: "rotate", objectId: o.id, dDeg: (more ? d : -d) * sign }]);
  }
  const move = text.match(/\bmove\b.*\b(left|right|up|down)\b(?:.*?(\d+))?/);
  if (move) {
    const r = resolveTarget(text, ctx);
    if ("clarify" in r) return r.clarify;
    if ("none" in r) return { kind: "error", message: r.none };
    const o = ctx.scene.objects.find((x) => x.id === r.id)!;
    const d = Math.min(400, move[2] ? Number(move[2]) : [0, 20, 40, 100][amount]!);
    const dir = move[1]!;
    const dx = dir === "left" ? -d : dir === "right" ? d : 0;
    const dy = dir === "up" ? -d : dir === "down" ? d : 0;
    return patch(`Move ${o.label || o.id} ${dir} by ${d} u`, [{ op: "move", objectId: o.id, dx, dy }]);
  }

  // ── Remove ──────────────────────────────────────────────────────────────
  if (/^(remove|delete|erase|get rid of)\b/.test(text)) {
    const r = resolveTarget(text, ctx);
    if ("clarify" in r) return r.clarify;
    if ("none" in r) return { kind: "error", message: r.none };
    const o = ctx.scene.objects.find((x) => x.id === r.id)!;
    return patch(`Remove ${o.label || o.id}`, [{ op: "remove", objectId: o.id }]);
  }

  return { kind: "unknown" };
}

/** Top surface y of the first solid static object directly below (x, fromY), or null. */
export function supportTopAt(scene: SceneSpec, x: number, fromY = 0, ignore: Set<string> = new Set()): number | null {
  const solids = scene.objects.filter((o) => o.isStatic && o.role !== "target" && !ignore.has(o.id));
  for (let y = Math.max(0, fromY); y <= scene.world.height; y += 1) {
    for (const o of solids) if (hitTest(o, { x, y })) return y;
  }
  return null;
}

function addDominoes(n: number, text: string, ctx: CommandContext): CommandResult {
  const W = ctx.scene.world.width;
  let startX: number;
  let dir = 1;
  let anchorNote = "";
  if (/\b(after|past|beyond|behind|next to|at the end of|below|bottom of)\b.*\b(ramp|slope|deflector)\b|\bramp\b/.test(text)) {
    const r = resolveTarget(text, ctx, ["ramp"]);
    if ("clarify" in r) return r.clarify;
    if ("none" in r) return { kind: "error", message: r.none };
    const ramp = ctx.scene.objects.find((o) => o.id === r.id)!;
    if (ramp.shape.kind !== "rect") return { kind: "error", message: "That ramp is not a straight piece." };
    const cs = rectCorners({ x: ramp.x, y: ramp.y, rotationDeg: ramp.rotationDeg, w: ramp.shape.width, h: ramp.shape.height });
    const low = cs.reduce((a, b) => (b.y > a.y ? b : a));
    dir = low.x >= ramp.x ? 1 : -1;
    startX = low.x + dir * 70;
    anchorNote = ` after ${ramp.label || ramp.id}`;
  } else {
    const xs = ctx.scene.objects.filter((o) => o.role === "domino").map((o) => o.x);
    startX = xs.length ? Math.max(...xs) + 52 : W * 0.5;
  }
  const ops: PatchOp[] = [];
  const taken = new Set<string>();
  const spacing = 52;
  for (let i = 0; i < n; i++) {
    const x = startX + dir * i * spacing;
    if (x < 20 || x > W - 20) return { kind: "error", message: `Only room for ${i} domino${i === 1 ? "" : "es"} before the world edge.` };
    const top = supportTopAt(ctx.scene, x, 0);
    if (top === null) return { kind: "error", message: `There is no ground under x=${Math.round(x)} to stand a domino on.` };
    const id = nextId(ctx.scene, "domino", taken);
    taken.add(id);
    const obj = makeObject({ id, role: "domino", x, y: top - 40 - 0.5, shape: { kind: "rect", width: 14, height: 80 }, source: { kind: "copilot", needsReview: false, reasons: [] } });
    ops.push({ op: "add", object: obj });
  }
  return patch(`Add ${n} domino${n === 1 ? "" : "es"}${anchorNote}`, ops);
}

function addSimple(role: "ball" | "block", n: number, ctx: CommandContext): CommandResult {
  const ops: PatchOp[] = [];
  const taken = new Set<string>();
  const W = ctx.scene.world.width;
  for (let i = 0; i < n; i++) {
    const id = nextId(ctx.scene, role, taken);
    taken.add(id);
    const x = W / 2 + (i - (n - 1) / 2) * 70;
    const obj = makeObject({
      id,
      role,
      x,
      y: 80,
      shape: role === "ball" ? { kind: "circle", radius: 22 } : { kind: "rect", width: 56, height: 56 },
      source: { kind: "copilot", needsReview: false, reasons: [] },
    });
    ops.push({ op: "add", object: obj });
  }
  return patch(`Add ${n} ${role}${n === 1 ? "" : "s"} near the top`, ops);
}

export const COMMAND_EXAMPLES = [
  "Make this ball bouncier",
  "Make gravity weaker",
  "Add three dominoes after the ramp",
  "Raise the selected ramp slightly",
  "Reset the experiment",
  "Explain why the ball stopped",
];

export { GRAVITY_PRESETS };
