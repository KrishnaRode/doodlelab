/**
 * LabController — owns the ONE live Simulation and the ONE animation loop for the main stage.
 * React components call its methods; it publishes a small, throttled status to `useRuntime`.
 * Switching tabs/inspector sections never touches it, so the world never resets by accident.
 */
import { create } from "zustand";
import { Simulation } from "../physics/simulation";
import type { RunSummary } from "../physics/telemetry";
import type { Gravity, SceneSpec } from "../scene/spec";
import { useLab } from "./store";

export type RunStatus = "idle" | "transition" | "running" | "paused";

export interface RuntimeState {
  status: RunStatus;
  time: number;
  steps: number;
  /** Bumps whenever a fresh telemetry summary is available (≈8 Hz while running). */
  tick: number;
  goalReachedAt: number | null;
  /** When set (paused only), the stage shows the recorded pose at this time — view only. */
  replayT: number | null;
}

export const useRuntime = create<RuntimeState>(() => ({ status: "idle", time: 0, steps: 0, tick: 0, goalReachedAt: null, replayT: null }));

export type DrawFn = (info: { now: number; transitionT: number | null }) => void;

export const TRANSITION_MS = 1100;

export class LabController {
  sim: Simulation | null = null;
  private raf = 0;
  private last = 0;
  private draw: DrawFn | null = null;
  private dirty = true;
  private transitionStart = 0;
  private transitionMs = TRANSITION_MS;
  private publishAt = 0;
  readonly flashes = new Map<string, number>();
  private running = false;
  private status: RunStatus = "idle";

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      try {
        this.frame(now);
      } catch (e) {
        // Never let one bad frame kill the loop (the world would freeze silently).
        console.error("[doodlelab] frame error", e);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  setDraw(fn: DrawFn | null): void {
    this.draw = fn;
    this.dirty = true;
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Draw synchronously (e.g. right after a canvas resize, which clears the canvas). */
  redrawNow(): void {
    if (!this.draw) return;
    const now = performance.now();
    const transitionT = this.status === "transition" ? Math.min(1, (now - this.transitionStart) / this.transitionMs) : null;
    this.draw({ now, transitionT });
    this.dirty = false;
  }

  get currentStatus(): RunStatus {
    return this.status;
  }

  private frame(now: number): void {
    const dt = now - this.last;
    this.last = now;
    let transitionT: number | null = null;
    if (this.status === "transition") {
      transitionT = Math.min(1, (now - this.transitionStart) / this.transitionMs);
      if (transitionT >= 1) {
        transitionT = null;
        this.setStatus("running");
        useLab.getState().setMode("live");
      }
      this.dirty = true;
    } else if (this.status === "running" && this.sim) {
      const speed = useLab.getState().settings.speed;
      if (this.sim.advance(dt, speed) > 0) this.dirty = true;
    }
    if (this.flashes.size) this.dirty = true;
    if (this.sim && now >= this.publishAt && (this.status === "running" || this.status === "paused")) {
      this.publishAt = now + 125;
      useRuntime.setState((s) => ({ time: this.sim!.time, steps: this.sim!.steps, tick: s.tick + 1 }));
    }
    if (this.dirty && this.draw) {
      this.dirty = false;
      this.draw({ now, transitionT });
    }
  }

  private setStatus(s: RunStatus): void {
    this.status = s;
    useRuntime.setState({ status: s });
  }

  /** Compile the authored scene and play the sketch→life transition, then run. */
  bringToLife(spec: SceneSpec, reducedMotion: boolean): void {
    this.archiveRun();
    this.sim?.destroy();
    this.sim = new Simulation(spec);
    this.sim.onTargetEnter = (tid, bid, t) => this.onTarget(tid, bid, t);
    useRuntime.setState({ time: 0, steps: 0, goalReachedAt: null });
    this.flashes.clear();
    this.transitionMs = reducedMotion ? 160 : TRANSITION_MS;
    this.transitionStart = performance.now();
    useLab.getState().setMode("transition");
    this.setStatus("transition");
    this.dirty = true;
  }

  private onTarget(targetId: string, bodyId: string, t: number): void {
    this.flashes.set(targetId, performance.now() + 900);
    const goal = this.sim?.spec.goal;
    if (goal && goal.targetId === targetId && (!goal.subjectId || goal.subjectId === bodyId) && useRuntime.getState().goalReachedAt === null) {
      useRuntime.setState({ goalReachedAt: t });
      useLab.getState().notify(`Target reached by ${bodyId} at ${t.toFixed(2)} s`, "ok");
    }
  }

  /** View a recorded moment while paused. Pass null to return to the live pose. */
  setReplay(t: number | null): void {
    if (t !== null && (this.status !== "paused" || !this.sim)) return;
    useRuntime.setState({ replayT: t });
    this.dirty = true;
  }

  play(): void {
    if (!this.sim) return;
    useRuntime.setState({ replayT: null });
    if (this.status === "paused" || this.status === "idle") {
      this.last = performance.now();
      this.setStatus("running");
    }
  }

  pause(): void {
    if (this.status === "running") {
      this.setStatus("paused");
      this.sim?.endDrag();
      this.publishNow();
    }
  }

  toggle(): void {
    if (this.status === "running") this.pause();
    else this.play();
  }

  /** Advance exactly one fixed step (only while paused). */
  stepOnce(): void {
    if (!this.sim || this.status !== "paused") return;
    useRuntime.setState({ replayT: null });
    this.sim.step();
    this.publishNow();
    this.dirty = true;
  }

  /** Restore the authored initial scene (positions, velocities, constraints, gravity). */
  reset(): void {
    if (!this.sim) return;
    this.archiveRun();
    this.sim.load(useLab.getState().scene);
    this.sim.onTargetEnter = (tid, bid, t) => this.onTarget(tid, bid, t);
    this.flashes.clear();
    useRuntime.setState({ time: 0, steps: 0, goalReachedAt: null, replayT: null });
    this.setStatus("paused");
    this.publishNow();
    this.dirty = true;
  }

  /** Leave the live world and go back to editing the authored sketch. */
  backToEdit(): void {
    this.archiveRun();
    this.sim?.destroy();
    this.sim = null;
    this.flashes.clear();
    this.setStatus("idle");
    useRuntime.setState({ time: 0, steps: 0, goalReachedAt: null, replayT: null });
    useLab.getState().setMode("edit");
    this.dirty = true;
  }

  setGravity(g: Gravity): void {
    this.sim?.setGravity(g);
  }

  summary(): RunSummary | null {
    return this.sim ? this.sim.summary() : null;
  }

  private publishNow(): void {
    if (!this.sim) return;
    useRuntime.setState((s) => ({ time: this.sim!.time, steps: this.sim!.steps, tick: s.tick + 1 }));
  }

  /** Keep the finished run so explanations can compare "this run vs the previous one". */
  private archiveRun(): void {
    if (!this.sim || this.sim.steps < 30) return;
    useLab.getState().pushRun({ spec: structuredClone(this.sim.spec), summary: this.sim.summary() });
  }
}

let singleton: LabController | null = null;
export function getController(): LabController {
  if (!singleton) singleton = new LabController();
  return singleton;
}
