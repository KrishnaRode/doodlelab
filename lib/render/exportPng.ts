/**
 * Export a PNG of the current scene (live pose if running) plus an optional notes footer
 * with measured observations. Rendered by the same renderer at a fixed size.
 */
import { drawStage } from "./renderer";
import { fitView } from "../geometry/transforms";
import { useLab } from "../state/store";
import { getController } from "../state/controller";
import { downloadBlob, slug } from "../state/persistence";
import { gravityLabel } from "../scene/spec";
import { appConfig } from "@/app.config";

export async function exportPng(): Promise<void> {
  const st = useLab.getState();
  const c = getController();
  const sim = c.sim;
  const live = st.mode !== "edit" && sim;
  const scene = live ? sim.spec : st.scene;
  const W = 1600;
  const stageH = Math.round((W * scene.world.height) / scene.world.width);
  const notes: string[] = [];
  notes.push(`${scene.title} · gravity ${gravityLabel(scene.gravity)} (${scene.gravity.scale}×) · ${scene.objects.length} objects`);
  if (live) {
    const s = sim.summary();
    notes.push(`Measured at t = ${s.simulatedSec.toFixed(2)} s: ${s.collisionCount} collisions${s.goal ? ` · goal ${s.goal.reached ? `reached at ${s.goal.atSec} s` : "not reached"}` : ""}.`);
  } else notes.push("Authored starting setup (not yet run).");
  notes.push(`${appConfig.name} — ${appConfig.tagline} · scene units, not metres · ${new Date().toLocaleString()}`);
  const footer = 30 + notes.length * 26;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = stageH + footer;
  const ctx = canvas.getContext("2d")!;
  await document.fonts?.ready;
  drawStage({
    ctx,
    width: W,
    height: stageH,
    view: fitView(scene.world, W, stageH, 0),
    scene,
    mode: live ? "live" : "edit",
    transitionT: null,
    bodies: live ? new Map(sim.snapshot().map((b) => [b.id, b])) : null,
    selection: [],
    hover: null,
    pending: live ? [] : st.pending,
    currentStroke: null,
    ghost: null,
    trails: live && st.settings.trails ? new Map(sim.recordOrder.map((id) => [id, sim.trail(id)] as const)) : null,
    showVectors: st.settings.vectors,
    flashes: new Map(),
    photo: null,
    photoMeta: null,
    now: performance.now(),
    reviewIds: new Set(),
    issueIds: new Set(),
    showLabels: !live,
    dragging: null,
  });
  ctx.fillStyle = "#0b1224";
  ctx.fillRect(0, stageH, W, footer);
  ctx.fillStyle = "#e9edf8";
  ctx.font = '600 20px "Inter Variable", system-ui, sans-serif';
  notes.forEach((n, i) => {
    ctx.fillStyle = i === notes.length - 1 ? "#6a7699" : "#e9edf8";
    ctx.fillText(n, 24, stageH + 36 + i * 26);
  });
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) {
    st.notify("Could not create the PNG.", "bad");
    return;
  }
  downloadBlob(`${slug(scene.title)}.png`, blob);
  st.notify("PNG exported.", "ok");
}
