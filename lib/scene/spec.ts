/**
 * SceneSpec — the single declarative contract shared by drawing, image recognition,
 * samples, AI proposals, persistence and the physics compiler.
 *
 * Conventions (documented in README → "Scene coordinates"):
 *  - World is `world.width × world.height` scene units (u). Units are NOT calibrated metres.
 *  - Origin is the top-left corner. **+Y points down** (canvas convention).
 *  - `x`, `y` are the object's centre in scene units.
 *  - `rotationDeg` is in **degrees**, positive = clockwise on screen. Radians exist only
 *    inside the physics compiler.
 *  - Recognition produces normalized [0,1] coordinates which are converted explicitly with
 *    `lib/geometry/transforms.ts` (never implicitly).
 */
import { z } from "zod";

export const SCENE_VERSION = 1 as const;
export const MAX_OBJECTS = 60;
export const MAX_SKETCH_POINTS = 400;

export const WORLD_LIMITS = {
  minWidth: 400,
  maxWidth: 2400,
  minHeight: 300,
  maxHeight: 1600,
} as const;

/** Bounds for physical parameters. Kept conservative so Matter.js stays stable. */
export const PARAM_LIMITS = {
  radius: { min: 6, max: 200 },
  side: { min: 4, max: 1400 },
  restitution: { min: 0, max: 0.95 },
  friction: { min: 0, max: 1 },
  density: { min: 0.0002, max: 0.02 },
  gravityScale: { min: 0, max: 2.5 },
  initialSpeed: { min: 0, max: 1600 },
} as const;

export const ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

const finite = () => z.number().finite();

export const ObjectId = z
  .string()
  .regex(ID_PATTERN, "IDs are lowercase letters, digits and dashes, starting with a letter");
export type ObjectId = z.infer<typeof ObjectId>;

export const ROLES = ["ball", "block", "domino", "ramp", "ground", "platform", "wall", "target"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const MATERIALS = ["bouncy", "wood", "heavy", "slippery", "rough"] as const;
export const MaterialName = z.enum(MATERIALS);
export type MaterialName = z.infer<typeof MaterialName>;

export const CircleShape = z.object({
  kind: z.literal("circle"),
  radius: finite().min(PARAM_LIMITS.radius.min).max(PARAM_LIMITS.radius.max),
});
export const RectShape = z.object({
  kind: z.literal("rect"),
  width: finite().min(PARAM_LIMITS.side.min).max(PARAM_LIMITS.side.max),
  height: finite().min(PARAM_LIMITS.side.min).max(PARAM_LIMITS.side.max),
});
export const Shape = z.discriminatedUnion("kind", [CircleShape, RectShape]);
export type Shape = z.infer<typeof Shape>;

/** Optional per-object overrides on top of the named material preset. */
export const MaterialOverrides = z
  .object({
    restitution: finite().min(PARAM_LIMITS.restitution.min).max(PARAM_LIMITS.restitution.max),
    friction: finite().min(PARAM_LIMITS.friction.min).max(PARAM_LIMITS.friction.max),
    density: finite().min(PARAM_LIMITS.density.min).max(PARAM_LIMITS.density.max),
  })
  .partial();
export type MaterialOverrides = z.infer<typeof MaterialOverrides>;

export const Point = z.tuple([finite(), finite()]);
export type Point = z.infer<typeof Point>;

/** Where an object came from, plus honest recognition-quality indicators. */
export const Provenance = z.object({
  kind: z.enum(["tool", "freehand", "image", "sample", "copilot", "import"]),
  /** Measured geometric fit (e.g. "circle fit", 0.04 = 4% mean deviation). Never a confidence. */
  fit: z
    .object({
      method: z.enum(["circle", "rect", "line", "manual"]),
      deviation: finite().min(0).max(10),
      note: z.string().max(160).optional(),
    })
    .optional(),
  needsReview: z.boolean().default(false),
  reasons: z.array(z.string().max(200)).max(6).default([]),
  /** Optional semantic hint returned by a local vision model (roles only, never geometry). */
  aiHint: z.string().max(200).optional(),
});
export type Provenance = z.infer<typeof Provenance>;

export const SceneObject = z.object({
  id: ObjectId,
  label: z.string().max(40).optional(),
  role: Role,
  shape: Shape,
  x: finite(),
  y: finite(),
  rotationDeg: finite().min(-360).max(360).default(0),
  isStatic: z.boolean(),
  material: MaterialName,
  overrides: MaterialOverrides.default({}),
  /** Initial velocity in u/s (scene units per simulated second). */
  initialVelocity: z.tuple([finite(), finite()]).default([0, 0]),
  /** The original hand-drawn outline(s) in the object's LOCAL frame (u, unrotated). */
  sketch: z.array(z.array(Point).max(MAX_SKETCH_POINTS)).max(8).default([]),
  source: Provenance.default({ kind: "tool", needsReview: false, reasons: [] }),
});
export type SceneObject = z.infer<typeof SceneObject>;
export type SceneObjectInput = z.input<typeof SceneObject>;

export const Constraint = z.discriminatedUnion("kind", [
  z.object({
    id: ObjectId,
    kind: z.literal("pin"),
    /** Pins the object's centre (plus optional local offset) to its starting world position. */
    objectId: ObjectId,
    offset: z.tuple([finite(), finite()]).default([0, 0]),
  }),
  z.object({
    id: ObjectId,
    kind: z.literal("rope"),
    a: ObjectId,
    /** Second object, or omit to tie to a fixed world anchor. */
    b: ObjectId.optional(),
    anchor: z.tuple([finite(), finite()]).optional(),
    length: finite().min(10).max(2000).optional(),
  }),
]);
export type Constraint = z.infer<typeof Constraint>;

export const GRAVITY_PRESETS = {
  earth: { scale: 1, label: "Earth", note: "Reference gravity (1×)" },
  moon: { scale: 0.165, label: "Moon", note: "About 1/6 of Earth" },
  zero: { scale: 0, label: "Zero-g", note: "No gravity" },
} as const;
export type GravityPreset = keyof typeof GRAVITY_PRESETS | "custom";

export const Gravity = z.object({
  preset: z.enum(["earth", "moon", "zero", "custom"]),
  /** Multiple of the scene's Earth gravity. Direction is always +Y (down). */
  scale: finite().min(PARAM_LIMITS.gravityScale.min).max(PARAM_LIMITS.gravityScale.max),
});
export type Gravity = z.infer<typeof Gravity>;

export const Goal = z.object({
  kind: z.literal("reach-target"),
  targetId: ObjectId,
  /** Which object must reach it; omitted = any dynamic object. */
  subjectId: ObjectId.optional(),
  prompt: z.string().max(160).optional(),
});
export type Goal = z.infer<typeof Goal>;

export const SceneSpec = z.object({
  schema: z.literal("doodlelab.scene"),
  version: z.literal(SCENE_VERSION),
  id: ObjectId,
  title: z.string().min(1).max(80),
  world: z.object({
    width: finite().min(WORLD_LIMITS.minWidth).max(WORLD_LIMITS.maxWidth),
    height: finite().min(WORLD_LIMITS.minHeight).max(WORLD_LIMITS.maxHeight),
    units: z.literal("scene-units"),
    yAxis: z.literal("down"),
    angleUnits: z.literal("degrees"),
  }),
  gravity: Gravity,
  simulation: z
    .object({
      /** Observation window used by headless runs, comparisons and the target search. */
      durationSec: finite().min(2).max(60).default(12),
    })
    .default({ durationSec: 12 }),
  objects: z.array(SceneObject).max(MAX_OBJECTS),
  constraints: z.array(Constraint).max(20).default([]),
  goal: Goal.optional(),
  provenance: z
    .object({
      kind: z.enum(["drawing", "image", "sample", "import"]),
      note: z.string().max(200).optional(),
    })
    .default({ kind: "drawing" }),
});
export type SceneSpec = z.infer<typeof SceneSpec>;
export type SceneSpecInput = z.input<typeof SceneSpec>;

export const DEFAULT_WORLD = {
  width: 1000,
  height: 600,
  units: "scene-units",
  yAxis: "down",
  angleUnits: "degrees",
} as const;

export function emptyScene(id = "scene-1", title = "Untitled experiment"): SceneSpec {
  return SceneSpec.parse({
    schema: "doodlelab.scene",
    version: SCENE_VERSION,
    id,
    title,
    world: DEFAULT_WORLD,
    gravity: { preset: "earth", scale: 1 },
    objects: [],
  });
}

export function gravityFromPreset(preset: keyof typeof GRAVITY_PRESETS): Gravity {
  return { preset, scale: GRAVITY_PRESETS[preset].scale };
}

export function gravityLabel(g: Gravity): string {
  if (g.preset !== "custom") return GRAVITY_PRESETS[g.preset].label;
  return `${g.scale.toFixed(2)}× Earth`;
}
