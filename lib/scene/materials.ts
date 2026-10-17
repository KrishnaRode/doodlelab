import type { MaterialName, MaterialOverrides, Role, SceneObject } from "./spec";

/**
 * Illustrative simulation presets — NOT measured real-world materials.
 * Values are Matter.js parameters chosen so differences are easy to see.
 */
export interface MaterialPreset {
  name: MaterialName;
  label: string;
  blurb: string;
  restitution: number;
  friction: number;
  frictionStatic: number;
  frictionAir: number;
  density: number;
  /** Fill colour in "life" mode, plus a darker edge tone. */
  color: string;
  edge: string;
}

export const MATERIAL_PRESETS: Record<MaterialName, MaterialPreset> = {
  bouncy: {
    name: "bouncy",
    label: "Bouncy",
    blurb: "Springs back after impacts",
    restitution: 0.82,
    friction: 0.05,
    frictionStatic: 0.2,
    frictionAir: 0.0005,
    density: 0.0012,
    color: "#ff6b5b",
    edge: "#c2412f",
  },
  wood: {
    name: "wood",
    label: "Wood-like",
    blurb: "Medium grip, small bounce",
    restitution: 0.25,
    friction: 0.45,
    frictionStatic: 0.6,
    frictionAir: 0.001,
    density: 0.002,
    color: "#e0a458",
    edge: "#a26a26",
  },
  heavy: {
    name: "heavy",
    label: "Heavy, low bounce",
    blurb: "Dense and thuddy",
    restitution: 0.05,
    friction: 0.6,
    frictionStatic: 0.8,
    frictionAir: 0.0005,
    density: 0.008,
    color: "#6b7a99",
    edge: "#3f4a63",
  },
  slippery: {
    name: "slippery",
    label: "Slippery",
    blurb: "Almost no grip",
    restitution: 0.2,
    friction: 0.0,
    frictionStatic: 0.0,
    frictionAir: 0.0005,
    density: 0.0015,
    color: "#5ec8e5",
    edge: "#2b8aa6",
  },
  rough: {
    name: "rough",
    label: "Rough",
    blurb: "Lots of grip, little bounce",
    restitution: 0.1,
    friction: 0.95,
    frictionStatic: 1,
    frictionAir: 0.001,
    density: 0.002,
    color: "#9bbf6a",
    edge: "#5e7f33",
  },
};

export const TARGET_COLOR = "#f5b301";
export const STATIC_TINT = "#3b4466";

export interface ResolvedMaterial {
  restitution: number;
  friction: number;
  frictionStatic: number;
  frictionAir: number;
  density: number;
}

export function resolveMaterial(name: MaterialName, overrides: MaterialOverrides = {}): ResolvedMaterial {
  const p = MATERIAL_PRESETS[name];
  return {
    restitution: overrides.restitution ?? p.restitution,
    friction: overrides.friction ?? p.friction,
    frictionStatic: overrides.friction !== undefined ? Math.min(1, overrides.friction * 1.25) : p.frictionStatic,
    frictionAir: p.frictionAir,
    density: overrides.density ?? p.density,
  };
}

export const ROLE_DEFAULTS: Record<Role, { isStatic: boolean; material: MaterialName; label: string }> = {
  ball: { isStatic: false, material: "bouncy", label: "Ball" },
  block: { isStatic: false, material: "wood", label: "Block" },
  domino: { isStatic: false, material: "wood", label: "Domino" },
  ramp: { isStatic: true, material: "wood", label: "Ramp" },
  ground: { isStatic: true, material: "rough", label: "Ground" },
  platform: { isStatic: true, material: "wood", label: "Platform" },
  wall: { isStatic: true, material: "wood", label: "Wall" },
  target: { isStatic: true, material: "wood", label: "Target" },
};

export const MASS_NOTE =
  "In the same gravity, a heavier object does not fall faster on its own — mass changes how hard it pushes in collisions.";

export function objectColor(o: Pick<SceneObject, "role" | "material" | "isStatic">): { fill: string; edge: string } {
  if (o.role === "target") return { fill: TARGET_COLOR, edge: "#b07f00" };
  const p = MATERIAL_PRESETS[o.material];
  if (o.isStatic && (o.role === "ground" || o.role === "platform" || o.role === "wall" || o.role === "ramp")) {
    return { fill: mix(p.color, STATIC_TINT, 0.55), edge: mix(p.edge, STATIC_TINT, 0.5) };
  }
  return { fill: p.color, edge: p.edge };
}

function mix(a: string, b: string, t: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + ((pb[i] ?? 0) - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function hex(h: string): number[] {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
