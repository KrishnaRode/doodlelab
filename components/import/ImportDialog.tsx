"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ImageUp, Loader2, RotateCw, ScanSearch, Undo2, X } from "lucide-react";
import { useLab } from "@/lib/state/store";
import { useAi } from "@/lib/state/ai";
import { getController } from "@/lib/state/controller";
import {
  findPaperQuad,
  fullQuad,
  recognizeShapes,
  rectSize,
  rectToOriginal,
  warpToRect,
  worldForAspect,
  type Candidate,
  type Quad,
  type RGBAImage,
  type RecognitionResult,
} from "@/lib/vision/pipeline";
import type { Homography } from "@/lib/geometry/transforms";
import { makeObject, nextId } from "@/lib/scene/objects";
import { emptyScene, ROLES, type Role, type SceneObject, type SceneSpec } from "@/lib/scene/spec";
import { ROLE_DEFAULTS } from "@/lib/scene/materials";
import { useElapsed } from "../tray/ExplainPanel";
import { compareHint, type HintVerdict } from "@/lib/vision/hints";
import type { Mark } from "@/lib/ai/prompts";

type Step = "source" | "adjust" | "recognize" | "review";
type StageKey = "rectify" | "ink" | "shapes" | "vision";
interface StageState {
  key: StageKey;
  label: string;
  status: "waiting" | "running" | "done" | "skipped" | "error" | "cancelled";
  ms?: number;
  detail?: string;
}

interface Fixture {
  id: string;
  title: string;
  file: string;
  synthetic: boolean;
}

interface Loaded {
  name: string;
  img: HTMLImageElement;
  rgba: RGBAImage;
  synthetic: boolean;
}

interface Review {
  result: RecognitionResult;
  H: Homography;
  rect: RGBAImage;
  rectUrl: string;
  world: { width: number; height: number };
  choices: Record<string, { include: boolean; role: Role }>;
  hints: Record<string, { mark: Mark; verdict: HintVerdict; ms: number }>;
  visionModel: string | null;
  visionSkipped: string[];
}

const MAX_SRC = 1600;

export function ImportDialog() {
  const [step, setStep] = useState<Step>("source");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [autoQuad, setAutoQuad] = useState<"found" | "none" | null>(null);
  const [stages, setStages] = useState<StageState[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const settings = useLab((s) => s.settings);
  const ai = useAi((s) => s.status);
  const elapsed = useElapsed(startedAt);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  useEffect(() => {
    fetch("/fixtures/fixtures.json")
      .then((r) => r.json())
      .then((j: { fixtures: Fixture[] }) => setFixtures(j.fixtures))
      .catch(() => setFixtures([]));
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const close = () => {
    abortRef.current?.abort();
    stopCamera();
    useLab.getState().set({ importOpen: false });
  };

  const loadImage = async (src: string, name: string, synthetic: boolean) => {
    setError(null);
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const scale = Math.min(1, MAX_SRC / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const scaledImg = new Image();
      scaledImg.src = c.toDataURL("image/jpeg", 0.9);
      await scaledImg.decode();
      const rgba: RGBAImage = { width: c.width, height: c.height, data: id.data };
      setLoaded({ name, img: scaledImg, rgba, synthetic });
      const q = findPaperQuad(rgba);
      setQuad(q ?? insetQuad(fullQuad(c.width, c.height), 0.02));
      setAutoQuad(q ? "found" : "none");
      setReview(null);
      setStep("adjust");
    } catch {
      setError("Could not read that image. Use a PNG or JPEG.");
    }
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g)$/.test(f.type)) {
      setError("Please choose a PNG or JPEG image.");
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError("That image is larger than 25 MB.");
      return;
    }
    const url = URL.createObjectURL(f);
    void loadImage(url, f.name, false).finally(() => setTimeout(() => URL.revokeObjectURL(url), 5000));
  };

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } });
      streamRef.current = stream;
      setCameraOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch (e) {
      setError(`Camera unavailable (${e instanceof Error ? e.message : String(e)}). You can upload a photo instead.`);
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    stopCamera();
    void loadImage(c.toDataURL("image/jpeg", 0.92), "Camera capture", false);
  };

  const rotate = () => {
    if (!loaded) return;
    const c = document.createElement("canvas");
    c.width = loaded.rgba.height;
    c.height = loaded.rgba.width;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(loaded.img, 0, 0);
    void loadImage(c.toDataURL("image/jpeg", 0.92), loaded.name, loaded.synthetic);
  };

  const recognize = async () => {
    if (!loaded || !quad) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const visionModel = settings.useVision && ai?.reachable ? settings.visionModel : null;
    const init: StageState[] = [
      { key: "rectify", label: "Correcting perspective", status: "waiting" },
      { key: "ink", label: "Finding ink on the paper", status: "waiting" },
      { key: "shapes", label: "Tracing and fitting shapes", status: "waiting" },
      {
        key: "vision",
        label: visionModel ? `Asking ${visionModel} for roles (optional)` : "Vision model roles",
        status: visionModel ? "waiting" : "skipped",
        detail: visionModel ? undefined : ai?.reachable ? "No vision-capable local model selected. Geometry alone is used." : "Ollama is offline. Geometry alone is used.",
      },
    ];
    setStages(init);
    setStep("recognize");
    setError(null);
    setStartedAt(Date.now());
    const upd = (key: StageKey, patch: Partial<StageState>) => setStages((cur) => cur.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    const tick = () => new Promise((r) => setTimeout(r, 30));
    const abortIfNeeded = () => {
      if (ctrl.signal.aborted) throw new DOMException("cancelled", "AbortError");
    };
    try {
      upd("rectify", { status: "running" });
      await tick();
      const t = performance.now();
      const size = rectSize(quad, 900);
      const { image: rect, H } = warpToRect(loaded.rgba, quad, size.width, size.height);
      const world = worldForAspect(size.aspect);
      upd("rectify", { status: "done", ms: Math.round(performance.now() - t), detail: `${size.width}×${size.height} px, paper aspect ${size.aspect.toFixed(2)}` });
      abortIfNeeded();
      upd("ink", { status: "running" });
      await tick();
      const result = recognizeShapes(rect, { world });
      upd("ink", { status: "done", ms: result.timings.threshold, detail: `${(result.inkFraction * 100).toFixed(1)}% of the paper is ink` });
      upd("shapes", { status: "done", ms: (result.timings.components ?? 0) + (result.timings.fitting ?? 0), detail: `${result.candidates.filter((c) => !c.ignored).length} shape(s) kept, ${result.candidates.filter((c) => c.ignored).length} left out, ${result.ignoredSpecks} speck(s) ignored` });
      abortIfNeeded();
      const rectUrl = rgbaToJpegUrl(rect);
      const choices: Review["choices"] = {};
      for (const c of result.candidates) choices[c.id] = { include: !c.ignored && !!c.fit.role, role: (c.fit.role ?? "block") as Role };
      const base: Review = { result, H, rect, rectUrl, world, choices, hints: {}, visionModel, visionSkipped: [] };
      setReview(base);
      const kept = result.candidates.filter((c) => !c.ignored && c.fit.shape).slice(0, 24);
      if (visionModel && kept.length) {
        upd("vision", { status: "running", label: `Asking ${visionModel} about ${kept.length} shape${kept.length === 1 ? "" : "s"} (one crop each, optional)` });
        const vt = performance.now();
        const crops = kept.map((c) => ({ id: c.id, image: cropJpeg(rect, c.bboxPx) }));
        try {
          const res = await fetch("/api/ai/vision", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ crops, model: visionModel }),
            signal: ctrl.signal,
          });
          const j = (await res.json()) as { ok: boolean; hints?: Array<{ id: string; mark: Mark; ms: number }>; skipped?: string[]; message?: string };
          if (!j.ok) throw new Error(j.message ?? "vision request failed");
          const hints: Review["hints"] = {};
          for (const h of j.hints ?? []) {
            const c = kept.find((k) => k.id === h.id);
            if (c) hints[h.id] = { mark: h.mark, ms: h.ms, verdict: compareHint(c.fit.kind, c.fit.metrics.aspect, c.fit.role, h.mark) };
          }
          setReview({ ...base, hints, visionSkipped: j.skipped ?? [] });
          const disagree = Object.values(hints).filter((h) => !h.verdict.agrees).length;
          upd("vision", { status: "done", ms: Math.round(performance.now() - vt), detail: `${Object.keys(hints).length} answered, ${disagree} to double-check${j.skipped?.length ? `, ${j.skipped.length} unanswered` : ""}. Hints never change geometry.` });
        } catch (e) {
          if (ctrl.signal.aborted) upd("vision", { status: "cancelled", detail: "Cancelled — geometry results kept." });
          else upd("vision", { status: "error", ms: Math.round(performance.now() - vt), detail: `${e instanceof Error ? e.message : String(e)} — geometry results kept.` });
        }
      }
      setStartedAt(null);
      setStep("review");
    } catch (e) {
      setStartedAt(null);
      if ((e as { name?: string }).name === "AbortError") {
        setStages((cur) => cur.map((s) => (s.status === "running" || s.status === "waiting" ? { ...s, status: "cancelled" } : s)));
        setStep("adjust");
        return;
      }
      setError(`Recognition failed: ${e instanceof Error ? e.message : String(e)}`);
      setStep("adjust");
    }
  };

  const applyShapes = (mode: "replace" | "add") => {
    if (!review || !loaded) return;
    const st = useLab.getState();
    const target: SceneSpec =
      mode === "replace"
        ? { ...emptyScene(`scene-${Date.now().toString(36)}`, `From photo: ${loaded.name}`.slice(0, 80)), world: { ...emptyScene().world, ...review.world } }
        : structuredClone(st.scene);
    // Explicit, uniform mapping from the recognised world into the target world.
    const s = Math.min(target.world.width / review.world.width, target.world.height / review.world.height);
    const ox = (target.world.width - review.world.width * s) / 2;
    const oy = (target.world.height - review.world.height * s) / 2;
    const taken = new Set<string>();
    const objs: SceneObject[] = [];
    for (const c of review.result.candidates) {
      const ch = review.choices[c.id];
      if (!ch?.include || !c.fit.shape) continue;
      const id = nextId(target, ch.role, taken);
      taken.add(id);
      const fitted = c.fit.shape.kind === "circle" ? { kind: "circle" as const, radius: clampN(c.fit.shape.radius * s, 6, 200) } : { kind: "rect" as const, width: clampN(c.fit.shape.width * s, 4, 1400), height: clampN(c.fit.shape.height * s, 4, 1400) };
      const shape =
        ch.role === "ball" && fitted.kind === "rect"
          ? { kind: "circle" as const, radius: clampN(Math.min(fitted.width, fitted.height) / 2, 6, 200) }
          : ch.role !== "ball" && ch.role !== "target" && fitted.kind === "circle"
            ? { kind: "rect" as const, width: fitted.radius * 2, height: fitted.radius * 2 }
            : fitted;
      // Review reasons gate Bring to Life; informational notes do not.
      const reasons = [...c.fit.reasons];
      const hint = review.hints[c.id];
      let aiHint: string | undefined;
      if (hint) {
        if (!hint.verdict.agrees && !(hint.verdict.suggestion && hint.verdict.suggestion === ch.role)) reasons.push(hint.verdict.reason);
        aiHint = `${review.visionModel}: ${hint.mark}`.slice(0, 200);
      }
      // A role the user explicitly chose in this dialog counts as reviewed.
      const userChose = ch.role !== c.fit.role;
      objs.push(
        makeObject({
          id,
          role: ch.role,
          x: c.fit.x * s + ox,
          y: c.fit.y * s + oy,
          rotationDeg: shape.kind === "circle" ? 0 : c.fit.rotationDeg,
          shape,
          sketch: [c.fit.localSketch.map(([x, y]) => [Math.round(x * s * 100) / 100, Math.round(y * s * 100) / 100] as [number, number])],
          source: {
            kind: "image",
            fit: c.fit.method ? { method: c.fit.method, deviation: Math.min(10, c.fit.deviation), note: c.fit.note } : undefined,
            needsReview: !userChose && reasons.length > 0,
            reasons: [...reasons, ...c.notes].slice(0, 6).map((r) => r.slice(0, 200)),
            aiHint,
          },
        }),
      );
    }
    getController().backToEdit();
    if (mode === "replace") {
      target.objects = objs;
      target.provenance = { kind: "image", note: `Recognised from ${loaded.synthetic ? "a synthetic test photo" : "a photo"}: ${loaded.name}`.slice(0, 200) };
      st.replaceScene(target, { photo: { src: review.rectUrl, width: review.rect.width, height: review.rect.height } });
    } else {
      st.addObjects(objs);
    }
    st.set({ importOpen: false, tool: "select", inspectorOpen: true, selection: [] });
    const n = objs.filter((o) => o.source.needsReview).length;
    st.notify(`Added ${objs.length} recognised shape${objs.length === 1 ? "" : "s"}${n ? ` — ${n} need review` : ""}.`, n ? "warn" : "ok");
    stopCamera();
  };

  const included = review ? Object.values(review.choices).filter((c) => c.include).length : 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm" data-testid="import-dialog">
      <div className="flex max-h-[95vh] w-full max-w-[1180px] animate-rise flex-col overflow-hidden rounded-2xl border border-border bg-chrome shadow-2xl" role="dialog" aria-label="Recognise a photo">
        <div className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
          <h2 className="text-base font-bold">Recognise a paper drawing</h2>
          <Steps step={step} />
          <button className="btn btn-ghost btn-icon ml-auto h-8 w-8" onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-sm" data-testid="import-error">
              {error}
            </div>
          )}

          {step === "source" && (
            <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
              <div className="flex flex-col gap-3">
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-panel p-8 text-center hover:border-accent" data-testid="upload-drop">
                  <ImageUp size={28} className="text-accent" />
                  <span className="text-sm font-semibold">Upload a photo (PNG or JPEG)</span>
                  <span className="text-xs text-text-muted">It stays on this computer. Nothing is uploaded anywhere.</span>
                  <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="upload-input" />
                </label>
                {!cameraOn ? (
                  <button className="btn h-11" onClick={() => void startCamera()}>
                    <Camera size={16} /> Use this computer&apos;s camera
                  </button>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-border">
                    <video ref={videoRef} className="aspect-video w-full bg-black object-contain" playsInline muted />
                    <div className="flex gap-2 p-2">
                      <button className="btn btn-primary h-9 flex-1" onClick={capture}>
                        <Camera size={15} /> Capture
                      </button>
                      <button className="btn h-9" onClick={stopCamera}>
                        Stop
                      </button>
                    </div>
                  </div>
                )}
                <div className="rounded-xl bg-panel p-3 text-xs leading-relaxed text-text-muted">
                  <b className="text-text">For best results:</b> dark pen or marker on plain light paper · circles for balls, boxes for blocks, straight lines for ramps and ground · two rings for a target · leave a finger-width gap between shapes · avoid shadows and fill most of the frame.
                </div>
              </div>
              <div>
                <div className="label-micro mb-2">Test photos — synthetic fixtures</div>
                <p className="mb-2 text-[11px] text-text-faint">
                  Rendered test images (pencil-style drawings photographed in a virtual scene with perspective and uneven light). They run through the exact same recognition pipeline as your photos — they are not real camera photos, and nothing is pre-recognised.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
                  {fixtures.map((f) => (
                    <button key={f.id} className="overflow-hidden rounded-xl border border-border bg-panel text-left hover:border-accent" onClick={() => void loadImage(f.file, `${f.title} (synthetic)`, true)} data-testid={`fixture-${f.id}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.file} alt={f.title} className="aspect-[1.4] w-full object-cover" />
                      <div className="p-2 text-[11px] font-medium">{f.title}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === "adjust" && loaded && quad && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <span>
                  Drag the four corners onto the paper&apos;s corners. {autoQuad === "found" ? "They were placed automatically — check them." : "Couldn't find the paper automatically; adjust the corners."}
                </span>
                <button className="btn ml-auto h-8 text-xs" onClick={rotate}>
                  <RotateCw size={14} /> Rotate 90°
                </button>
                <button className="btn h-8 text-xs" onClick={() => setQuad(fullQuad(loaded.rgba.width, loaded.rgba.height))}>
                  Whole image
                </button>
                <button
                  className="btn h-8 text-xs"
                  onClick={() => {
                    const q = findPaperQuad(loaded.rgba);
                    if (q) setQuad(q);
                    setAutoQuad(q ? "found" : "none");
                  }}
                >
                  Auto-detect paper
                </button>
                <button className="btn h-8 text-xs" onClick={() => setStep("source")}>
                  <Undo2 size={14} /> Other photo
                </button>
              </div>
              <QuadEditor img={loaded.img} w={loaded.rgba.width} h={loaded.rgba.height} quad={quad} onChange={setQuad} />
              <div className="flex justify-end">
                <button className="btn btn-primary h-10 px-5" onClick={() => void recognize()} data-testid="recognize">
                  <ScanSearch size={16} /> Recognise shapes
                </button>
              </div>
            </div>
          )}

          {step === "recognize" && (
            <div className="mx-auto flex max-w-[520px] flex-col gap-2 py-6" data-testid="recognize-stages">
              <div className="mb-1 text-sm font-semibold">
                Recognising… <span className="font-mono text-xs text-text-muted">{elapsed} s</span>
              </div>
              {stages.map((s) => (
                <StageRow key={s.key} s={s} />
              ))}
              <button className="btn mt-3 self-start" onClick={() => abortRef.current?.abort()}>
                <X size={14} /> Cancel (keeps your photo)
              </button>
            </div>
          )}

          {step === "review" && review && loaded && quad && <ReviewPane review={review} setReview={setReview} loaded={loaded} quad={quad} stages={stages} />}
        </div>
        {step === "review" && review && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border-soft px-4 py-3">
            <span className="text-xs text-text-muted">Nothing is final: every shape stays editable on the stage, and doubtful ones are marked “needs review”.</span>
            <button className="btn ml-auto" onClick={() => setStep("adjust")}>
              Adjust corners
            </button>
            <button className="btn" onClick={() => applyShapes("add")} disabled={!included}>
              Add to current scene
            </button>
            <button className="btn btn-primary" onClick={() => applyShapes("replace")} disabled={!included} data-testid="use-shapes">
              <Check size={15} /> Use {included} shapes in a new scene
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const all: Array<[Step, string]> = [
    ["source", "Photo"],
    ["adjust", "Crop"],
    ["recognize", "Recognise"],
    ["review", "Review"],
  ];
  const idx = all.findIndex(([s]) => s === step);
  return (
    <div className="hidden items-center gap-1.5 text-[11px] sm:flex">
      {all.map(([s, l], i) => (
        <span key={s} className={`rounded-full px-2 py-0.5 ${i === idx ? "bg-accent-soft text-white" : i < idx ? "text-text-muted" : "text-text-faint"}`}>
          {i + 1}. {l}
        </span>
      ))}
    </div>
  );
}

function StageRow({ s }: { s: StageState }) {
  const icon =
    s.status === "running" ? (
      <Loader2 size={15} className="animate-spin text-accent" />
    ) : s.status === "done" ? (
      <Check size={15} className="text-ok" />
    ) : s.status === "error" ? (
      <X size={15} className="text-bad" />
    ) : (
      <span className="block h-[15px] w-[15px] rounded-full border border-border" />
    );
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-panel px-3 py-2" data-stage={s.key} data-status={s.status}>
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm">{s.label}</div>
        {s.detail && <div className="text-[11px] text-text-muted">{s.detail}</div>}
      </div>
      {s.ms !== undefined && <span className="font-mono text-[11px] text-text-faint">{s.ms} ms</span>}
      {(s.status === "skipped" || s.status === "cancelled") && <span className="text-[11px] text-text-faint">{s.status}</span>}
    </div>
  );
}

function QuadEditor({ img, w, h, quad, onChange }: { img: HTMLImageElement; w: number; h: number; quad: Quad; onChange: (q: Quad) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const toImg = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(w - 1, Math.max(0, ((e.clientX - r.left) / r.width) * w)), y: Math.min(h - 1, Math.max(0, ((e.clientY - r.top) / r.height) * h)) };
  };
  return (
    <div className="flex justify-center">
      <div
        ref={ref}
        className="relative w-full touch-none select-none"
        style={{ maxWidth: `min(100%, ${Math.round((62 * w) / h)}vh)`, aspectRatio: `${w} / ${h}` }}
        onPointerMove={(e) => {
          if (dragging === null) return;
          const q = quad.slice() as Quad;
          q[dragging] = toImg(e);
          onChange(q);
        }}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.src} alt="Photo to recognise" className="absolute inset-0 h-full w-full rounded-lg" draggable={false} />
        <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" aria-hidden>
          <polygon points={quad.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(124,155,255,0.12)" stroke="#7c9bff" strokeWidth={Math.max(2, w / 400)} />
        </svg>
        {quad.map((p, i) => (
          <div
            key={i}
            role="slider"
            aria-label={`${["Top-left", "Top-right", "Bottom-right", "Bottom-left"][i]} corner`}
            aria-valuenow={Math.round(p.x)}
            tabIndex={0}
            className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-accent shadow-lg"
            style={{ left: `${(p.x / w) * 100}%`, top: `${(p.y / h) * 100}%` }}
            onPointerDown={(e) => {
              ref.current?.setPointerCapture(e.pointerId);
              setDragging(i);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ReviewPane({ review, setReview, loaded, quad, stages }: { review: Review; setReview: (r: Review) => void; loaded: Loaded; quad: Quad; stages: StageState[] }) {
  const cands = review.result.candidates;
  const [hover, setHover] = useState<string | null>(null);
  const colorFor = (c: Candidate) => (c.ignored ? "#9aa3b5" : review.choices[c.id]?.include ? (c.fit.needsReview ? "#e8a317" : "#4b6bff") : "#9aa3b5");
  const originalPaths = useMemo(
    () =>
      Object.fromEntries(
        cands.map((c) => {
          const step = Math.max(1, Math.floor(c.contour.length / 160));
          const pts = c.contour.filter((_, i) => i % step === 0).map((p) => rectToOriginal(p, review.H));
          return [c.id, pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")];
        }),
      ),
    [cands, review.H],
  );
  const set = (id: string, patch: Partial<{ include: boolean; role: Role }>) => setReview({ ...review, choices: { ...review.choices, [id]: { ...review.choices[id]!, ...patch } } });
  const hasStatic = cands.some((c) => review.choices[c.id]?.include && ["ground", "platform", "ramp", "wall"].includes(review.choices[c.id]!.role));
  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]" data-testid="review-pane">
      <div className="flex flex-col gap-3">
        <div>
          <div className="label-micro mb-1">Overlaid on your original photo — check the alignment</div>
          <div className="relative w-full overflow-hidden rounded-lg" style={{ aspectRatio: `${loaded.rgba.width} / ${loaded.rgba.height}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={loaded.img.src} alt="Original photo" className="absolute inset-0 h-full w-full" />
            <svg viewBox={`0 0 ${loaded.rgba.width} ${loaded.rgba.height}`} className="absolute inset-0 h-full w-full" aria-hidden>
              <polygon points={quad.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="rgba(124,155,255,0.7)" strokeDasharray="8 6" strokeWidth={2} />
              {cands.map((c) => (
                <polygon
                  key={c.id}
                  points={originalPaths[c.id]}
                  fill={hover === c.id ? "rgba(75,107,255,0.18)" : "none"}
                  stroke={colorFor(c)}
                  strokeWidth={hover === c.id ? 5 : 3}
                  strokeDasharray={c.ignored || !review.choices[c.id]?.include ? "6 5" : undefined}
                />
              ))}
            </svg>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] text-text-muted">
          {stages.map((s) => (
            <span key={s.key} className="chip">
              {s.label.replace(/ \(optional\)/, "")}: {s.status}
              {s.ms !== undefined ? ` · ${s.ms} ms` : ""}
            </span>
          ))}
        </div>
        {review.visionSkipped.length > 0 && <p className="text-[11px] text-text-muted">The vision model gave no usable answer for: {review.visionSkipped.join(", ")} (geometry kept).</p>}
        <p className="text-[11px] text-text-faint">
          Threshold {review.result.threshold}, ink {(review.result.inkFraction * 100).toFixed(1)}%. Shapes map to a {review.world.width} × {review.world.height} u world (paper aspect preserved). Fit numbers are measured deviations, not confidence scores.
        </p>
      </div>
      <div className="flex flex-col gap-1.5" data-testid="candidate-list">
        <div className="label-micro mb-1">{cands.filter((c) => !c.ignored).length} shapes found</div>
        {cands.length === 0 && <p className="text-sm text-text-muted">No shapes found. Try darker lines, better light, or adjust the corners.</p>}
        {cands.map((c) => {
          const ch = review.choices[c.id]!;
          const hint = review.hints[c.id];
          return (
            <div key={c.id} className={`rounded-xl border p-2 ${c.ignored ? "border-border-soft opacity-70" : "border-border bg-panel"}`} onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)} data-testid="candidate" data-role={ch.role} data-included={ch.include}>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={ch.include} onChange={(e) => set(c.id, { include: e.target.checked })} aria-label={`Include ${c.id}`} disabled={!c.fit.shape} />
                <span className="font-mono text-[11px] text-text-faint">{c.id}</span>
                <select className="field h-7 w-auto py-0 text-xs" value={ch.role} onChange={(e) => set(c.id, { role: e.target.value as Role, include: true })} aria-label={`Role for ${c.id}`}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_DEFAULTS[r].label}
                    </option>
                  ))}
                </select>
                <span className="ml-auto text-right text-[11px] text-text-muted">{c.fit.note}</span>
              </div>
              {(c.ignored || c.fit.reasons.length > 0 || c.notes.length > 0 || hint) && (
                <ul className="mt-1 list-disc pl-6 text-[11px] text-text-muted">
                  {c.ignored && <li>Left out: {c.ignored}</li>}
                  {c.fit.reasons.map((r, i) => (
                    <li key={`r${i}`} className="text-warn">
                      Needs review: {r}
                    </li>
                  ))}
                  {c.notes.map((n, i) => (
                    <li key={`n${i}`}>{n}</li>
                  ))}
                  {hint && (
                    <li className={hint.verdict.agrees ? "" : "text-warn"} data-testid="vision-hint" data-agrees={hint.verdict.agrees}>
                      {hint.verdict.reason}
                      {hint.verdict.suggestion && hint.verdict.suggestion !== ch.role && (
                        <button className="ml-1.5 rounded border border-border px-1.5 text-[10px] text-text hover:bg-panel-hover" onClick={() => set(c.id, { role: hint.verdict.suggestion!, include: true })}>
                          Use {ROLE_DEFAULTS[hint.verdict.suggestion].label}
                        </button>
                      )}
                      {hint.mark === "text-or-scribble" && ch.include && (
                        <button className="ml-1.5 rounded border border-border px-1.5 text-[10px] text-text hover:bg-panel-hover" onClick={() => set(c.id, { include: false })}>
                          Leave out
                        </button>
                      )}
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
        {!hasStatic && cands.length > 0 && <p className="mt-1 text-[11px] text-warn">No ground or ramp selected — things will fall out of the world. You can add ground on the stage afterwards.</p>}
      </div>
    </div>
  );
}

function insetQuad(q: Quad, f: number): Quad {
  const cx = (q[0].x + q[2].x) / 2;
  const cy = (q[0].y + q[2].y) / 2;
  return q.map((p) => ({ x: p.x + (cx - p.x) * f, y: p.y + (cy - p.y) * f })) as Quad;
}

function clampN(v: number, lo: number, hi: number) {
  return Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;
}

/** A 336 px square crop of one shape on a paper-coloured background (base64 JPEG, no prefix). */
function cropJpeg(img: RGBAImage, bb: [number, number, number, number]): string {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const pad = 16;
  const x0 = Math.max(0, bb[0] - pad),
    y0 = Math.max(0, bb[1] - pad),
    x1 = Math.min(img.width, bb[2] + pad),
    y1 = Math.min(img.height, bb[3] + pad);
  const side = Math.max(x1 - x0, y1 - y0, 1);
  const e = document.createElement("canvas");
  e.width = e.height = 336;
  const x = e.getContext("2d")!;
  x.fillStyle = "#f4efe2";
  x.fillRect(0, 0, 336, 336);
  const s = 300 / side;
  const w = (x1 - x0) * s,
    h = (y1 - y0) * s;
  x.drawImage(c, x0, y0, x1 - x0, y1 - y0, 168 - w / 2, 168 - h / 2, w, h);
  return e.toDataURL("image/jpeg", 0.9).split(",")[1]!;
}

function rgbaToJpegUrl(img: RGBAImage, maxSide = 0): string {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  if (maxSide && Math.max(img.width, img.height) > maxSide) {
    const s = maxSide / Math.max(img.width, img.height);
    const d = document.createElement("canvas");
    d.width = Math.round(img.width * s);
    d.height = Math.round(img.height * s);
    d.getContext("2d")!.drawImage(c, 0, 0, d.width, d.height);
    return d.toDataURL("image/jpeg", 0.85);
  }
  return c.toDataURL("image/jpeg", 0.85);
}
