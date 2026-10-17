/**
 * Measured run telemetry. Every number shown to the user — and every number handed to the
 * AI for explanations — comes from here. Units: scene units (u), simulated seconds (s).
 */
import type { Gravity, Role, SceneSpec } from "../scene/spec";

export type SimEventType = "collision" | "target-enter" | "left-world" | "drag" | "gravity-change";

export interface SimEvent {
  t: number;
  type: SimEventType;
  a: string;
  b?: string;
  /** Relative speed at impact (u/s), collisions only. */
  impactSpeed?: number;
  note?: string;
}

export interface BodyStats {
  id: string;
  role: Role;
  isStatic: boolean;
  startX: number;
  startY: number;
  finalX: number;
  finalY: number;
  finalAngleDeg: number;
  /** Highest point reached, as height of the body centre above the world's bottom edge. */
  peakHeight: number;
  /** How far the centre rose above its starting point at most (u, ≥ 0). */
  maxRise: number;
  maxDisplacement: number;
  pathLength: number;
  maxSpeed: number;
  finalSpeed: number;
  collisions: number;
  /** Simulated time of this body's first collision, or null. */
  firstImpactSec: number | null;
  /** First time the body came to rest and stayed at rest, or null. */
  restedAtSec: number | null;
  leftWorldAtSec: number | null;
  dragged: boolean;
}

export interface TargetStats {
  id: string;
  firstEntrySec: number | null;
  firstEntryBy: string | null;
  entries: number;
}

export interface RunSummary {
  simulatedSec: number;
  steps: number;
  gravity: Gravity;
  gravityChangedDuringRun: boolean;
  bodies: Record<string, BodyStats>;
  targets: Record<string, TargetStats>;
  goal: { targetId: string; subjectId: string | null; reached: boolean; atSec: number | null; by: string | null } | null;
  collisionCount: number;
  events: SimEvent[];
  eventsTruncated: boolean;
  userInteracted: boolean;
}

export const REST_SPEED = 12; // u/s
/** Contacts slower than this (relative u/s) are resting contacts, not collisions. */
export const MIN_IMPACT_SPEED = 8;
const REST_HOLD_SEC = 0.6;
const MAX_EVENTS = 400;
const COLLISION_DEDUPE_SEC = 0.12;

interface Live {
  stats: BodyStats;
  restCandidateSince: number | null;
}

export class TelemetryRecorder {
  private readonly worldH: number;
  private readonly live = new Map<string, Live>();
  private readonly targets = new Map<string, TargetStats>();
  private readonly events: SimEvent[] = [];
  private truncated = false;
  private collisionCount = 0;
  private readonly lastPairHit = new Map<string, number>();
  private gravityChanged = false;
  private interacted = false;
  private readonly occupancy = new Map<string, Set<string>>();

  constructor(private readonly spec: SceneSpec) {
    this.worldH = spec.world.height;
    for (const o of spec.objects) {
      if (o.role === "target") {
        this.targets.set(o.id, { id: o.id, firstEntrySec: null, firstEntryBy: null, entries: 0 });
        this.occupancy.set(o.id, new Set());
        continue;
      }
      this.live.set(o.id, {
        restCandidateSince: null,
        stats: {
          id: o.id,
          role: o.role,
          isStatic: o.isStatic,
          startX: o.x,
          startY: o.y,
          finalX: o.x,
          finalY: o.y,
          finalAngleDeg: o.rotationDeg,
          peakHeight: this.worldH - o.y,
          maxRise: 0,
          maxDisplacement: 0,
          pathLength: 0,
          maxSpeed: 0,
          finalSpeed: 0,
          collisions: 0,
          firstImpactSec: null,
          restedAtSec: null,
          leftWorldAtSec: null,
          dragged: false,
        },
      });
    }
  }

  sampleBody(id: string, t: number, x: number, y: number, angleDeg: number, speed: number): void {
    const l = this.live.get(id);
    if (!l || l.stats.isStatic || l.stats.leftWorldAtSec !== null) return;
    const s = l.stats;
    s.pathLength += Math.hypot(x - s.finalX, y - s.finalY);
    s.finalX = x;
    s.finalY = y;
    s.finalAngleDeg = angleDeg;
    s.finalSpeed = speed;
    s.maxSpeed = Math.max(s.maxSpeed, speed);
    s.peakHeight = Math.max(s.peakHeight, this.worldH - y);
    s.maxRise = Math.max(s.maxRise, s.startY - y);
    s.maxDisplacement = Math.max(s.maxDisplacement, Math.hypot(x - s.startX, y - s.startY));
    if (speed < REST_SPEED) {
      if (l.restCandidateSince === null) l.restCandidateSince = t;
      if (s.restedAtSec === null && t - l.restCandidateSince >= REST_HOLD_SEC) s.restedAtSec = l.restCandidateSince;
    } else {
      l.restCandidateSince = null;
      s.restedAtSec = null;
    }
  }

  collision(t: number, a: string, b: string, impactSpeed: number): void {
    // Resting/settling contacts (e.g. dominoes standing on the ground at t=0) are not impacts.
    if (impactSpeed < MIN_IMPACT_SPEED) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const last = this.lastPairHit.get(key);
    this.lastPairHit.set(key, t);
    if (last !== undefined && t - last < COLLISION_DEDUPE_SEC) return;
    this.collisionCount++;
    for (const id of [a, b]) {
      const l = this.live.get(id);
      if (l && !l.stats.isStatic) {
        l.stats.collisions++;
        if (l.stats.firstImpactSec === null) l.stats.firstImpactSec = t;
      }
    }
    this.push({ t, type: "collision", a, b, impactSpeed: Math.round(impactSpeed) });
  }

  /** Called every step with the set of dynamic bodies currently overlapping each target. */
  targetOccupancy(t: number, targetId: string, inside: Set<string>): string[] {
    const prev = this.occupancy.get(targetId);
    const ts = this.targets.get(targetId);
    if (!prev || !ts) return [];
    const entered: string[] = [];
    for (const id of inside) {
      if (!prev.has(id)) {
        entered.push(id);
        ts.entries++;
        if (ts.firstEntrySec === null) {
          ts.firstEntrySec = t;
          ts.firstEntryBy = id;
        }
        this.push({ t, type: "target-enter", a: id, b: targetId });
      }
    }
    this.occupancy.set(targetId, new Set(inside));
    return entered;
  }

  leftWorld(t: number, id: string): void {
    const l = this.live.get(id);
    if (!l || l.stats.leftWorldAtSec !== null) return;
    l.stats.leftWorldAtSec = t;
    this.push({ t, type: "left-world", a: id });
  }

  drag(t: number, id: string): void {
    const l = this.live.get(id);
    if (l) l.stats.dragged = true;
    this.interacted = true;
    this.push({ t, type: "drag", a: id, note: "moved by hand" });
  }

  gravityChange(t: number, note: string): void {
    this.gravityChanged = true;
    this.push({ t, type: "gravity-change", a: "world", note });
  }

  private push(e: SimEvent): void {
    if (this.events.length >= MAX_EVENTS) {
      this.truncated = true;
      return;
    }
    this.events.push({ ...e, t: round(e.t, 3) });
  }

  summary(simulatedSec: number, steps: number, gravity: Gravity): RunSummary {
    const bodies: Record<string, BodyStats> = {};
    for (const [id, l] of this.live) {
      const s = l.stats;
      bodies[id] = {
        ...s,
        finalX: round(s.finalX),
        finalY: round(s.finalY),
        finalAngleDeg: round(s.finalAngleDeg),
        peakHeight: round(s.peakHeight),
        maxRise: round(s.maxRise),
        maxDisplacement: round(s.maxDisplacement),
        pathLength: round(s.pathLength),
        maxSpeed: round(s.maxSpeed),
        finalSpeed: round(s.finalSpeed),
        restedAtSec: s.restedAtSec === null ? null : round(s.restedAtSec, 2),
        firstImpactSec: s.firstImpactSec === null ? null : round(s.firstImpactSec, 2),
        leftWorldAtSec: s.leftWorldAtSec === null ? null : round(s.leftWorldAtSec, 2),
      };
    }
    const targets: Record<string, TargetStats> = {};
    for (const [id, t] of this.targets) {
      targets[id] = { ...t, firstEntrySec: t.firstEntrySec === null ? null : round(t.firstEntrySec, 2) };
    }
    let goal: RunSummary["goal"] = null;
    const g = this.spec.goal;
    if (g && targets[g.targetId]) {
      const hit = this.events.find(
        (e) => e.type === "target-enter" && e.b === g.targetId && (!g.subjectId || e.a === g.subjectId),
      );
      goal = {
        targetId: g.targetId,
        subjectId: g.subjectId ?? null,
        reached: !!hit,
        atSec: hit ? round(hit.t, 2) : null,
        by: hit ? hit.a : null,
      };
    }
    return {
      simulatedSec: round(simulatedSec, 3),
      steps,
      gravity,
      gravityChangedDuringRun: this.gravityChanged,
      bodies,
      targets,
      goal,
      collisionCount: this.collisionCount,
      events: this.events.slice(),
      eventsTruncated: this.truncated,
      userInteracted: this.interacted,
    };
  }
}

export function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
