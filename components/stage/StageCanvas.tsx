"use client";

import { useEffect, useMemo, useRef } from "react";
import { fitStroke } from "@/lib/geometry/fit";
import { DEG, hitTest, normalizeDeg, toLocal, round2, type Vec } from "@/lib/geometry/math";
import { fitView, screenToWorld, type View } from "@/lib/geometry/transforms";
import { drawStage, selectionHandles, HANDLE_PX, type Ghost } from "@/lib/render/renderer";
import { makeObject, nextId, TOOL_DEFAULT_SHAPES } from "@/lib/scene/objects";
import type { Point, Role, SceneObject, SceneSpec } from "@/lib/scene/spec";
import { semanticIssues } from "@/lib/scene/validate";
import { getController, useRuntime } from "@/lib/state/controller";
import { useLab } from "@/lib/state/store";

type Drag =
  | { kind: "stroke"; points: Point[]; pointerType: string }
  | { kind: "shape"; role: Role; a: Vec; b: Vec }
  | { kind: "move"; id: string; start: Vec; orig: { x: number; y: number }; draft: SceneSpec; moved: boolean }
  | { kind: "resize"; id: string; draft: SceneSpec }
  | { kind: "rotate"; id: string; draft: SceneSpec }
  | { kind: "erase"; ids: Set<string>; pendingIds: Set<string> }
  | { kind: "live"; id: string };

const PADDING = 12;
/** Space kept clear for the status pill (top) and the copilot pill (bottom). */
const INSETS = { top: 34, bottom: 52 };

export function StageCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ scale: 1, offsetX: 0, offsetY: 0 });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const dragRef = useRef<Drag | null>(null);
  const hoverRef = useRef<string | null>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const controller = getController();

  const scene = useLab((s) => s.scene);
  const photo = useLab((s) => s.photo);
  const tool = useLab((s) => s.tool);
  const mode = useLab((s) => s.mode);

  // Validation overlay ids (recomputed only when the authored scene changes).
  const issueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const i of semanticIssues(scene)) for (const id of i.objectIds) ids.add(id);
    return ids;
  }, [scene]);
  const issueRef = useRef(issueIds);
  useEffect(() => {
    issueRef.current = issueIds;
    controller.invalidate();
  }, [issueIds, controller]);

  useEffect(() => {
    if (!photo) {
      photoRef.current = null;
      controller.invalidate();
      return;
    }
    const img = new Image();
    img.onload = () => {
      photoRef.current = img;
      controller.invalidate();
    };
    img.src = photo.src;
  }, [photo, controller]);

  // Resize → recompute the letterboxed world view.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      viewRef.current = fitView(useLab.getState().scene.world, r.width, r.height, PADDING, INSETS);
      // Resizing cleared the canvas; repaint in this same frame to avoid a blank flash.
      controller.redrawNow();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [controller]);

  useEffect(() => {
    const r = sizeRef.current;
    if (r.w) viewRef.current = fitView(scene.world, r.w, r.h, PADDING, INSETS);
  }, [scene.world]);

  // Register the draw function with the controller's single animation loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    controller.setDraw(({ now, transitionT }) => {
      const st = useLab.getState();
      const { w, h, dpr } = sizeRef.current;
      if (!w) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const drag = dragRef.current;
      const draft = drag && (drag.kind === "move" || drag.kind === "resize" || drag.kind === "rotate") ? drag.draft : null;
      const sim = controller.sim;
      const live = st.mode !== "edit" && sim;
      const replayT = useRuntime.getState().replayT;
      const replay = live && replayT !== null ? sim.frameAt(replayT) : null;
      const bodies = live ? new Map((replay ?? sim.snapshot()).map((b) => [b.id, b])) : null;
      let trails: Map<string, ReadonlyArray<[number, number]>> | null = null;
      if (live && st.settings.trails && !replay) {
        trails = new Map();
        for (const id of sim.recordOrder) trails.set(id, sim.trail(id));
      }
      for (const [id, until] of controller.flashes) if (until < now) controller.flashes.delete(id);
      const sceneToDraw = live ? sim.spec : (draft ?? st.scene);
      drawStage({
        ctx,
        width: w,
        height: h,
        view: viewRef.current,
        scene: sceneToDraw,
        mode: st.mode,
        transitionT,
        bodies,
        selection: st.mode === "edit" ? st.selection : [],
        hover: hoverRef.current,
        pending: st.pending,
        currentStroke: drag?.kind === "stroke" ? drag.points : null,
        ghost: drag?.kind === "shape" ? ghostFor(drag.role, drag.a, drag.b) : null,
        trails,
        showVectors: st.settings.vectors && !replay,
        flashes: controller.flashes,
        photo: photoRef.current,
        photoMeta: st.photo,
        now,
        reviewIds: new Set(sceneToDraw.objects.filter((o) => o.source.needsReview).map((o) => o.id)),
        issueIds: issueRef.current,
        showLabels: true,
        dragging: sim?.dragging ?? null,
      });
    });
    controller.start();
    const unsub = useLab.subscribe(() => controller.invalidate());
    return () => {
      unsub();
      controller.setDraw(null);
    };
  }, [controller]);

  const toWorld = (e: React.PointerEvent | PointerEvent): Vec => {
    const r = canvasRef.current!.getBoundingClientRect();
    return screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top }, viewRef.current);
  };

  const topObjectAt = (sceneNow: SceneSpec, p: Vec, pad: number): SceneObject | null => {
    const order = [...sceneNow.objects].reverse().sort((a, b) => rank(b) - rank(a));
    return order.find((o) => hitTest(o, p, pad)) ?? null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const st = useLab.getState();
    const p = toWorld(e);
    canvasRef.current!.setPointerCapture(e.pointerId);
    const s = viewRef.current.scale;

    if (st.mode === "live") {
      const sim = controller.sim;
      if (!sim) return;
      const id = sim.bodyAt(p.x, p.y);
      if (!id) return;
      if (controller.currentStatus !== "running") {
        st.notify("Press Play, then grab and throw objects.", "info");
        return;
      }
      if (sim.startDrag(id, p.x, p.y)) dragRef.current = { kind: "live", id };
      return;
    }
    if (st.mode !== "edit") return;

    switch (st.tool) {
      case "pencil":
        dragRef.current = { kind: "stroke", points: [[round2(p.x), round2(p.y)]], pointerType: e.pointerType };
        break;
      case "ball":
      case "block":
      case "ramp":
      case "ground":
      case "target":
        dragRef.current = { kind: "shape", role: st.tool, a: p, b: p };
        break;
      case "eraser": {
        const d: Drag = { kind: "erase", ids: new Set(), pendingIds: new Set() };
        dragRef.current = d;
        eraseAt(d, p);
        break;
      }
      case "select": {
        // Handles of the current selection first.
        const sel = st.selection.length === 1 ? st.scene.objects.find((o) => o.id === st.selection[0]) : null;
        if (sel) {
          const l = toLocal(sel, p);
          const h = selectionHandles(sel, s);
          const tol = (HANDLE_PX + 6) / s;
          if (h.rotate && Math.hypot(l.x - h.rotate.x, l.y - h.rotate.y) < tol) {
            dragRef.current = { kind: "rotate", id: sel.id, draft: structuredClone(st.scene) };
            return;
          }
          if (Math.hypot(l.x - h.resize.x, l.y - h.resize.y) < tol) {
            dragRef.current = { kind: "resize", id: sel.id, draft: structuredClone(st.scene) };
            return;
          }
        }
        const hit = topObjectAt(st.scene, p, 4 / s);
        if (!hit) {
          st.select([]);
          return;
        }
        if (e.shiftKey) {
          st.select(st.selection.includes(hit.id) ? st.selection.filter((x) => x !== hit.id) : [...st.selection, hit.id]);
          return;
        }
        st.select([hit.id]);
        dragRef.current = { kind: "move", id: hit.id, start: p, orig: { x: hit.x, y: hit.y }, draft: structuredClone(st.scene), moved: false };
        break;
      }
    }
    controller.invalidate();
  };

  const eraseAt = (d: Extract<Drag, { kind: "erase" }>, p: Vec) => {
    const st = useLab.getState();
    const s = viewRef.current.scale;
    for (const o of st.scene.objects) if (hitTest(o, p, 6 / s)) d.ids.add(o.id);
    for (const ps of st.pending) {
      if (ps.points.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 12 / s)) d.pendingIds.add(ps.id);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    const p = toWorld(e);
    const st = useLab.getState();
    if (!d) {
      if (st.mode === "edit" && st.tool === "select") {
        const hit = topObjectAt(st.scene, p, 4 / viewRef.current.scale);
        const id = hit?.id ?? null;
        if (id !== hoverRef.current) {
          hoverRef.current = id;
          canvasRef.current!.style.cursor = id ? "move" : "default";
        }
      } else if (st.mode === "live" && controller.sim) {
        canvasRef.current!.style.cursor = controller.sim.bodyAt(p.x, p.y) ? "grab" : "default";
      }
      return;
    }
    switch (d.kind) {
      case "stroke": {
        const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const q = toWorld(ev);
          const last = d.points[d.points.length - 1]!;
          if (Math.hypot(q.x - last[0], q.y - last[1]) >= 1.2 && d.points.length < 4000) d.points.push([round2(q.x), round2(q.y)]);
        }
        break;
      }
      case "shape":
        d.b = p;
        break;
      case "move": {
        const o = d.draft.objects.find((x) => x.id === d.id)!;
        let nx = d.orig.x + (p.x - d.start.x);
        let ny = d.orig.y + (p.y - d.start.y);
        if (e.altKey === false && e.shiftKey) {
          nx = Math.round(nx / 10) * 10;
          ny = Math.round(ny / 10) * 10;
        }
        o.x = round2(nx);
        o.y = round2(ny);
        d.moved = d.moved || Math.hypot(p.x - d.start.x, p.y - d.start.y) > 2;
        break;
      }
      case "resize": {
        const o = d.draft.objects.find((x) => x.id === d.id)!;
        const l = toLocal(o, p);
        if (o.shape.kind === "circle") o.shape.radius = round2(Math.min(200, Math.max(6, Math.hypot(l.x, l.y))));
        else {
          o.shape.width = round2(Math.min(1400, Math.max(4, Math.abs(l.x) * 2)));
          o.shape.height = round2(Math.min(1400, Math.max(4, Math.abs(l.y) * 2)));
        }
        rescaleSketch(o, useLab.getState().scene.objects.find((x) => x.id === d.id)!);
        break;
      }
      case "rotate": {
        const o = d.draft.objects.find((x) => x.id === d.id)!;
        let deg = Math.atan2(p.y - o.y, p.x - o.x) / DEG + 90;
        deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
        o.rotationDeg = normalizeDeg(deg);
        break;
      }
      case "erase":
        eraseAt(d, p);
        break;
      case "live":
        controller.sim?.moveDrag(p.x, p.y);
        break;
    }
    controller.invalidate();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const st = useLab.getState();
    switch (d.kind) {
      case "stroke":
        finishStroke(d.points);
        break;
      case "shape":
        finishShape(d.role, d.a, toWorld(e));
        break;
      case "move":
        if (d.moved) st.commit(d.draft);
        break;
      case "resize":
      case "rotate":
        st.commit(d.draft);
        break;
      case "erase":
        if (d.ids.size) st.removeObjects([...d.ids]);
        for (const id of d.pendingIds) st.removePending(id);
        break;
      case "live":
        controller.sim?.endDrag();
        break;
    }
    controller.invalidate();
  };

  const cursor = mode === "edit" ? (tool === "select" ? "default" : tool === "eraser" ? "cell" : "crosshair") : "default";

  return (
    <div ref={wrapRef} className="absolute inset-0" data-testid="stage">
      <canvas
        ref={canvasRef}
        className="block touch-none select-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Drawing and simulation stage"
        role="img"
      />
    </div>
  );
}

function rank(o: SceneObject): number {
  if (o.role === "target") return 1;
  return o.isStatic ? 0 : 2;
}

function ghostFor(role: Role, a: Vec, b: Vec): Ghost {
  if (role === "ball") return { kind: "circle", a, b, role };
  if (role === "ramp" || role === "ground") return { kind: "line", a, b, role };
  return { kind: "rect", a, b, role };
}

/** Keep the hand-drawn outline in proportion when an object is resized. */
function rescaleSketch(o: SceneObject, orig: SceneObject) {
  if (!orig.sketch.length) return;
  let sx = 1,
    sy = 1;
  if (o.shape.kind === "circle" && orig.shape.kind === "circle") sx = sy = o.shape.radius / orig.shape.radius;
  else if (o.shape.kind === "rect" && orig.shape.kind === "rect") {
    sx = o.shape.width / orig.shape.width;
    sy = o.shape.height / orig.shape.height;
  }
  o.sketch = orig.sketch.map((line) => line.map(([x, y]) => [round2(x * sx), round2(y * sy)] as Point));
}

function finishStroke(points: Point[]) {
  const st = useLab.getState();
  const fit = fitStroke(points, { world: st.scene.world });
  if (fit.kind === "too-small") {
    if (points.length > 2) st.notify("That stroke was too small to recognise — draw a bit bigger.", "warn");
    return;
  }
  if (fit.kind === "unsupported" || !fit.role || !fit.shape) {
    st.addPending({ id: `stroke-${Date.now().toString(36)}`, points, fit });
    st.notify("Not sure what that is — choose an interpretation in the inspector.", "warn");
    st.set({ inspectorOpen: true });
    return;
  }
  const id = nextId(st.scene, fit.role);
  const obj = makeObject({
    id,
    role: fit.role,
    x: fit.x,
    y: fit.y,
    rotationDeg: fit.rotationDeg,
    shape: fit.shape,
    sketch: [fit.localSketch],
    source: {
      kind: "freehand",
      fit: { method: fit.method ?? "manual", deviation: Math.min(10, fit.deviation), note: fit.note },
      needsReview: fit.needsReview,
      reasons: fit.reasons,
    },
  });
  st.addObjects([obj]);
}

function finishShape(role: Role, a: Vec, b: Vec) {
  const st = useLab.getState();
  const W = st.scene.world.width;
  const H = st.scene.world.height;
  const dragDist = Math.hypot(b.x - a.x, b.y - a.y);
  const id = nextId(st.scene, role);
  let obj: SceneObject;
  if (role === "ball") {
    const r = dragDist < 6 ? 22 : Math.min(200, Math.max(8, dragDist));
    obj = makeObject({ id, role, x: a.x, y: a.y, shape: { kind: "circle", radius: round2(r) } });
  } else if (role === "ramp" || role === "ground") {
    if (dragDist < 12) {
      if (role === "ground") obj = makeObject({ id, role, x: W / 2, y: Math.min(H - 15, Math.max(a.y, 40)), shape: { kind: "rect", width: W, height: 30 } });
      else obj = makeObject({ id, role, x: a.x, y: a.y, rotationDeg: 20, shape: TOOL_DEFAULT_SHAPES.ramp });
    } else {
      let angle = Math.atan2(b.y - a.y, b.x - a.x) / DEG;
      if (Math.abs(angle) > 90) angle = normalizeDeg(angle - 180);
      if (Math.abs(angle) < 2) angle = 0;
      obj = makeObject({
        id,
        role,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        rotationDeg: angle,
        shape: { kind: "rect", width: round2(Math.min(1400, dragDist)), height: role === "ground" ? 30 : 16 },
      });
    }
  } else {
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (w < 6 || h < 6) {
      obj = makeObject({ id, role, x: a.x, y: a.y, shape: TOOL_DEFAULT_SHAPES[role] });
    } else {
      obj = makeObject({ id, role, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, shape: { kind: "rect", width: round2(w), height: round2(h) } });
    }
  }
  st.addObjects([obj]);
}

