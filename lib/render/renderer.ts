/**
 * Custom Canvas2D renderer. Objects keep their hand-drawn identity: in edit mode they are
 * ink sketches with recognition overlays; in live mode the SAME sketch rides on top of a
 * material-coloured body. The transition traces outlines, adds colour and fades the paper.
 */
import { MATERIAL_PRESETS, objectColor } from "../scene/materials";
import type { SceneObject, SceneSpec } from "../scene/spec";
import type { BodyState } from "../physics/simulation";
import type { PendingStroke, Photo } from "../state/store";
import { DEG } from "../geometry/math";
import type { View } from "../geometry/transforms";

export interface Ghost {
  kind: "circle" | "rect" | "line";
  a: { x: number; y: number };
  b: { x: number; y: number };
  role: string;
}

export interface DrawParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  view: View;
  scene: SceneSpec;
  mode: "edit" | "transition" | "live";
  transitionT: number | null;
  bodies: Map<string, BodyState> | null;
  selection: string[];
  hover: string | null;
  pending: PendingStroke[];
  currentStroke: Array<[number, number]> | null;
  ghost: Ghost | null;
  trails: Map<string, ReadonlyArray<[number, number]>> | null;
  showVectors: boolean;
  flashes: Map<string, number>;
  photo: HTMLImageElement | null;
  photoMeta: Photo | null;
  now: number;
  reviewIds: Set<string>;
  issueIds: Set<string>;
  showLabels: boolean;
  dragging: string | null;
}

const INK = "#2a2f3d";
const PAPER = "#f8f3e8";
const PAPER_LINE = "rgba(150, 128, 92, 0.16)";
const LAB_BG = "#f3f1ec";
const OVERLAY = "#4b6bff";
const REVIEW = "#e8a317";
const SELECT = "#4b6bff";

const ease = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const phase = (t: number, a: number, b: number) => ease((t - a) / (b - a));

export function drawStage(p: DrawParams): void {
  const { ctx, width, height, view, scene } = p;
  const W = scene.world.width;
  const H = scene.world.height;
  const t = p.mode === "transition" ? (p.transitionT ?? 0) : p.mode === "live" ? 1 : 0;
  const paperAlpha = 1 - phase(t, 0.25, 0.9);
  const fillAlpha = phase(t, 0.3, 0.8);
  const traceT = phase(t, 0, 0.5);

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  // Letterbox outside the world (chrome colour), world area as paper/lab.
  ctx.fillStyle = "#0d1530";
  ctx.fillRect(0, 0, width, height);
  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);

  // ── Background: lab surface, then fading paper + photo on top ─────────────
  ctx.fillStyle = LAB_BG;
  ctx.fillRect(0, 0, W, H);
  drawLabGrid(ctx, W, H, view.scale, 1 - paperAlpha);
  if (paperAlpha > 0.01) {
    ctx.globalAlpha = paperAlpha;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    drawPaperRuling(ctx, W, H, view.scale);
    if (p.photo && p.photoMeta) {
      ctx.globalAlpha = paperAlpha * 0.55;
      ctx.drawImage(p.photo, 0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  }

  // ── Trails (live) ─────────────────────────────────────────────────────────
  if (p.trails && t >= 1) {
    for (const [id, tr] of p.trails) {
      const o = scene.objects.find((x) => x.id === id);
      if (!o || tr.length < 2) continue;
      const col = objectColor(o).fill;
      ctx.lineCap = "round";
      for (let i = 1; i < tr.length; i++) {
        const a = tr[i - 1]!;
        const b = tr[i]!;
        ctx.strokeStyle = col;
        ctx.globalAlpha = (i / tr.length) * 0.45;
        ctx.lineWidth = 3 / Math.max(view.scale, 0.4);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ── Objects: statics first, targets, then dynamics ────────────────────────
  const ordered = [...scene.objects].sort((a, b) => rank(a) - rank(b));
  for (const o of ordered) {
    const live = t > 0 ? p.bodies?.get(o.id) : undefined;
    const pose = live ? { x: live.x, y: live.y, angle: live.angle } : { x: o.x, y: o.y, angle: o.rotationDeg * DEG };
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.angle);
    if (o.role === "target") drawTarget(ctx, o, p, fillAlpha);
    else drawBody(ctx, o, p, { fillAlpha, traceT, t });
    ctx.restore();
  }

  // ── Velocity vectors (live) ────────────────────────────────────────────────
  if (p.showVectors && p.bodies && t >= 1) {
    for (const o of scene.objects) {
      if (o.isStatic) continue;
      const b = p.bodies.get(o.id);
      if (!b) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp < 15) continue;
      const k = 0.18; // arrow length = distance covered in 0.18 s
      drawArrow(ctx, b.x, b.y, b.x + b.vx * k, b.y + b.vy * k, "#1f6feb", view.scale, `${Math.round(sp)} u/s`);
    }
  }

  // ── Edit-mode overlays ─────────────────────────────────────────────────────
  if (t === 0) {
    for (const ps of p.pending) drawPending(ctx, ps, view.scale);
    if (p.currentStroke && p.currentStroke.length > 1) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(p.currentStroke[0]![0], p.currentStroke[0]![1]);
      for (const [x, y] of p.currentStroke) ctx.lineTo(x, y);
      ctx.stroke();
    }
    if (p.ghost) drawGhost(ctx, p.ghost, view.scale);
    for (const id of p.selection) {
      const o = scene.objects.find((x) => x.id === id);
      if (o) drawSelection(ctx, o, view.scale);
    }
  }
  ctx.restore();
}

function rank(o: SceneObject): number {
  if (o.role === "target") return 1;
  return o.isStatic ? 0 : 2;
}

function drawLabGrid(ctx: CanvasRenderingContext2D, W: number, H: number, scale: number, alpha: number) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "rgba(60, 72, 110, 0.08)";
  ctx.lineWidth = 1 / scale;
  for (let x = 0; x <= W; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(60, 72, 110, 0.35)";
  ctx.font = `${10 / scale}px "JetBrains Mono Variable", monospace`;
  for (let x = 100; x < W; x += 100) ctx.fillText(String(x), x + 3 / scale, 12 / scale);
  for (let y = 100; y < H; y += 100) ctx.fillText(String(y), 3 / scale, y - 3 / scale);
  ctx.restore();
}

function drawPaperRuling(ctx: CanvasRenderingContext2D, W: number, H: number, scale: number) {
  ctx.save();
  ctx.fillStyle = PAPER_LINE;
  const r = 1.3 / Math.max(scale, 0.5);
  for (let y = 25; y < H; y += 25) {
    for (let x = 25; x < W; x += 25) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function outlinePath(ctx: CanvasRenderingContext2D, o: SceneObject) {
  ctx.beginPath();
  if (o.shape.kind === "circle") ctx.arc(0, 0, o.shape.radius, 0, Math.PI * 2);
  else {
    const w = o.shape.width;
    const h = o.shape.height;
    const r = Math.min(3, w / 4, h / 4);
    ctx.roundRect(-w / 2, -h / 2, w, h, r);
  }
}

/** The original hand-drawn outline, smoothed with quadratic curves through midpoints. */
function sketchPath(ctx: CanvasRenderingContext2D, o: SceneObject): boolean {
  if (!o.sketch.length) return false;
  ctx.beginPath();
  for (const line of o.sketch) {
    if (line.length < 2) continue;
    ctx.moveTo(line[0]![0], line[0]![1]);
    for (let i = 1; i < line.length - 1; i++) {
      const [x, y] = line[i]!;
      const [nx, ny] = line[i + 1]!;
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    const last = line[line.length - 1]!;
    ctx.lineTo(last[0], last[1]);
  }
  return true;
}

function drawBody(ctx: CanvasRenderingContext2D, o: SceneObject, p: DrawParams, a: { fillAlpha: number; traceT: number; t: number }) {
  const s = p.view.scale;
  const { fill, edge } = objectColor(o);
  // Material body (fades in during the transition).
  if (a.fillAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = a.fillAlpha;
    outlinePath(ctx, o);
    if (o.shape.kind === "circle") {
      const r = o.shape.radius;
      const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
      g.addColorStop(0, lighten(fill, 0.35));
      g.addColorStop(1, fill);
      ctx.fillStyle = g;
    } else {
      const h = o.shape.height;
      const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, lighten(fill, 0.18));
      g.addColorStop(1, fill);
      ctx.fillStyle = g;
    }
    ctx.fill();
    if (o.isStatic) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 2;
      const ext = o.shape.kind === "rect" ? Math.max(o.shape.width, o.shape.height) : o.shape.radius * 2;
      for (let x = -ext; x < ext; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, -ext);
        ctx.lineTo(x + ext, ext);
        ctx.stroke();
      }
      ctx.restore();
    }
    // Re-create the outline: the hatch loop above replaced the current path.
    outlinePath(ctx, o);
    ctx.lineWidth = 1.6 / Math.max(s, 0.5);
    ctx.strokeStyle = edge;
    ctx.stroke();
    if (o.shape.kind === "circle" && !o.isStatic) {
      // Spin marker so rolling is visible.
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.arc(o.shape.radius * 0.55, 0, Math.max(2, o.shape.radius * 0.14), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Hand-drawn identity: the original sketch, always present (lighter once alive).
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.globalAlpha = a.t >= 1 ? 0.55 : 0.92;
  ctx.lineWidth = 2.4;
  if (sketchPath(ctx, o)) ctx.stroke();
  ctx.restore();

  // Recognition overlay: fitted outline (edit) / tracing animation (transition).
  const review = p.reviewIds.has(o.id);
  const issue = p.issueIds.has(o.id);
  if (a.t === 0 || (a.t > 0 && a.t < 1)) {
    ctx.save();
    outlinePath(ctx, o);
    ctx.lineWidth = 1.5 / Math.max(s, 0.5);
    if (a.t === 0) {
      ctx.setLineDash([6 / s, 5 / s]);
      ctx.strokeStyle = review ? REVIEW : issue ? "#e5484d" : OVERLAY;
      ctx.globalAlpha = 0.85;
      ctx.stroke();
    } else {
      const per = perimeter(o);
      ctx.setLineDash([per * a.traceT, per]);
      ctx.strokeStyle = OVERLAY;
      ctx.lineWidth = 3 / Math.max(s, 0.5);
      ctx.globalAlpha = 1 - phase(a.t, 0.75, 1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Label chip under the object (edit mode only), counter-rotated to stay readable.
  // Busy scenes only label what matters right now, so chips never pile up.
  const wantLabel = p.scene.objects.length <= 6 || review || issue || p.selection.includes(o.id) || p.hover === o.id;
  if (p.showLabels && a.t < 1 && wantLabel) {
    ctx.save();
    ctx.rotate(-o.rotationDeg * DEG);
    ctx.globalAlpha = 1 - a.t;
    const label = o.label || ROLE_LABEL[o.role] || o.role;
    const bottom = o.shape.kind === "circle" ? o.shape.radius : Math.abs(Math.sin(o.rotationDeg * DEG)) * o.shape.width / 2 + Math.abs(Math.cos(o.rotationDeg * DEG)) * o.shape.height / 2;
    drawChip(ctx, label, 0, bottom + 14 / s, s, review ? REVIEW : issue ? "#e5484d" : OVERLAY, review ? "needs review" : undefined);
    ctx.restore();
  }
}

const ROLE_LABEL: Record<string, string> = {
  ball: "Ball",
  block: "Block",
  domino: "Domino",
  ramp: "Ramp",
  ground: "Ground",
  platform: "Platform",
  wall: "Wall",
  target: "Target",
};

function drawTarget(ctx: CanvasRenderingContext2D, o: SceneObject, p: DrawParams, fillAlpha: number) {
  const s = p.view.scale;
  const flashUntil = p.flashes.get(o.id) ?? 0;
  const flash = flashUntil > p.now ? (flashUntil - p.now) / 900 : 0;
  ctx.save();
  outlinePath(ctx, o);
  ctx.fillStyle = `rgba(245, 179, 1, ${0.08 + 0.1 * fillAlpha + flash * 0.35})`;
  ctx.fill();
  ctx.setLineDash([7 / s, 5 / s]);
  ctx.lineWidth = 2 / Math.max(s, 0.5);
  ctx.strokeStyle = flash > 0 ? "#f59e0b" : "#c58a00";
  ctx.stroke();
  ctx.setLineDash([]);
  // Bullseye mark
  const r = o.shape.kind === "circle" ? o.shape.radius * 0.35 : Math.min(o.shape.width, o.shape.height) * 0.22;
  ctx.strokeStyle = "rgba(197, 138, 0, 0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(197, 138, 0, 0.75)";
  ctx.fill();
  if (flash > 0) {
    ctx.strokeStyle = `rgba(245, 158, 11, ${flash})`;
    ctx.lineWidth = 6 * flash;
    ctx.beginPath();
    ctx.arc(0, 0, r * (2.6 - flash), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  if (p.showLabels && p.mode === "edit") {
    ctx.save();
    ctx.rotate(-o.rotationDeg * DEG);
    const bottom = o.shape.kind === "circle" ? o.shape.radius : o.shape.height / 2;
    drawChip(ctx, o.label ?? "Target", 0, bottom + 14 / s, s, "#c58a00", "sensor");
    ctx.restore();
  }
}

function drawChip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, s: number, color: string, tag?: string) {
  const fs = 12 / s;
  ctx.font = `600 ${fs}px "Inter Variable", system-ui, sans-serif`;
  const full = tag ? `${text} · ${tag}` : text;
  const w = ctx.measureText(full).width + 12 / s;
  const h = 18 / s;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 / s;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(full, x, y + 0.5 / s);
}

function drawPending(ctx: CanvasRenderingContext2D, ps: PendingStroke, s: number) {
  if (ps.points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ps.points[0]![0], ps.points[0]![1]);
  for (const [x, y] of ps.points) ctx.lineTo(x, y);
  ctx.stroke();
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of ps.points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([5 / s, 4 / s]);
  ctx.strokeStyle = REVIEW;
  ctx.lineWidth = 1.5 / s;
  ctx.strokeRect(minX - 6, minY - 6, maxX - minX + 12, maxY - minY + 12);
  ctx.setLineDash([]);
  drawChip(ctx, "?", (minX + maxX) / 2, maxY + 18 / s, s, REVIEW, "needs review");
  ctx.restore();
}

function drawGhost(ctx: CanvasRenderingContext2D, g: Ghost, s: number) {
  ctx.save();
  ctx.strokeStyle = OVERLAY;
  ctx.fillStyle = "rgba(75,107,255,0.08)";
  ctx.lineWidth = 2 / s;
  ctx.setLineDash([6 / s, 4 / s]);
  ctx.beginPath();
  if (g.kind === "circle") {
    const r = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
    ctx.arc(g.a.x, g.a.y, r, 0, Math.PI * 2);
  } else if (g.kind === "rect") {
    ctx.rect(Math.min(g.a.x, g.b.x), Math.min(g.a.y, g.b.y), Math.abs(g.b.x - g.a.x), Math.abs(g.b.y - g.a.y));
  } else {
    ctx.moveTo(g.a.x, g.a.y);
    ctx.lineTo(g.b.x, g.b.y);
    ctx.lineWidth = 16;
    ctx.globalAlpha = 0.35;
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export const HANDLE_PX = 9;
export const ROTATE_OFFSET_PX = 26;

/** Local-frame handle positions for a selected object. */
export function selectionHandles(o: SceneObject, s: number): { resize: { x: number; y: number }; rotate: { x: number; y: number } | null } {
  if (o.shape.kind === "circle") return { resize: { x: o.shape.radius * Math.SQRT1_2, y: o.shape.radius * Math.SQRT1_2 }, rotate: null };
  return { resize: { x: o.shape.width / 2, y: o.shape.height / 2 }, rotate: { x: 0, y: -o.shape.height / 2 - ROTATE_OFFSET_PX / s } };
}

function drawSelection(ctx: CanvasRenderingContext2D, o: SceneObject, s: number) {
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.rotationDeg * DEG);
  ctx.strokeStyle = SELECT;
  ctx.lineWidth = 1.5 / s;
  const pad = 5 / s;
  if (o.shape.kind === "circle") {
    ctx.beginPath();
    ctx.arc(0, 0, o.shape.radius + pad, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeRect(-o.shape.width / 2 - pad, -o.shape.height / 2 - pad, o.shape.width + pad * 2, o.shape.height + pad * 2);
  }
  const h = selectionHandles(o, s);
  const hs = HANDLE_PX / s;
  ctx.fillStyle = "#fff";
  ctx.fillRect(h.resize.x - hs / 2, h.resize.y - hs / 2, hs, hs);
  ctx.strokeRect(h.resize.x - hs / 2, h.resize.y - hs / 2, hs, hs);
  if (h.rotate) {
    const top = o.shape.kind === "rect" ? -o.shape.height / 2 : 0;
    ctx.beginPath();
    ctx.moveTo(0, top - pad);
    ctx.lineTo(h.rotate.x, h.rotate.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(h.rotate.x, h.rotate.y, hs / 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, s: number, label: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2 / s;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1);
  const hl = 9 / s;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - hl * Math.cos(a - 0.4), y2 - hl * Math.sin(a - 0.4));
  ctx.lineTo(x2 - hl * Math.cos(a + 0.4), y2 - hl * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fill();
  ctx.font = `600 ${10 / s}px "JetBrains Mono Variable", monospace`;
  ctx.fillText(label, x2 + 4 / s, y2 - 4 / s);
  ctx.restore();
}

function perimeter(o: SceneObject): number {
  return o.shape.kind === "circle" ? 2 * Math.PI * o.shape.radius : 2 * (o.shape.width + o.shape.height);
}

function lighten(hex: string, t: number): string {
  const s = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  return `#${c.map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

export { MATERIAL_PRESETS };
