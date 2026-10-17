# DoodleLab — implementation plan & acceptance checklist

*The Sunday Builds #15 · "Draw it. Bring it to life."*

## Inputs inspected

- `KrishnaRode/sunday-ai-template` (`PROMPT.md`, `project.md`, `design.md`, `app.config.ts`, `run.sh`):
  reused its philosophy (the result is the product, local-only Ollama, calm premium dark chrome,
  every state designed, no mocks/TODOs, one-command launcher, `app.config.ts` as identity source).
  Adapted the single centred page into a **canvas-first studio**: large stage, compact tool rail,
  contextual inspector, collapsible experiment tray, a command pill instead of a chat sidebar.
- Earlier Sunday Builds (Migration Atlas, Fridge AI): reused the findings that `qwen3:4b` is a
  thinking model (send `think:false` + JSON schema format) and that moondream answers imperatives only.

## Architecture — four separated layers

| Layer | Where | Deterministic? |
| --- | --- | --- |
| 1. Acquisition (draw, upload, camera, crop/rotate/perspective) | `lib/geometry`, `lib/vision/warp.ts`, `components/import` | yes |
| 2. Recognition → validated `SceneSpec` | `lib/geometry/fit.ts` (strokes), `lib/vision/*` (image CV), optional Ollama vision for **roles only** | geometry yes; semantics optional AI |
| 3. Compile + simulate | `lib/scene/*` (Zod spec + semantic validator), `lib/physics/*` (Matter.js, fixed step) | yes |
| 4. AI explanations + proposed edits | `lib/ai/*`, `app/api/ai/*` | AI output is validated data (`ScenePatch`), never code |

The AI never writes JavaScript, never touches the loop, never reports measurements: all numbers
come from `lib/physics/telemetry.ts`.

## Decisions (resolved)

- Next.js 16 + React 19 + TS strict, Tailwind v4 tokens, Matter.js 0.20, Zod 4, Zustand 5, Vitest, Playwright.
- No Python/OpenCV: the image pipeline (Otsu threshold, connected components, hole fill, convex hull,
  min-area rect, circle fit, homography) is ~600 lines of TypeScript, runs in the browser, and is unit-tested.
- World: 1000 × 600 **scene units (u)**, **Y points down**, angles stored in **degrees** (clockwise
  positive on screen), converted to radians only inside the compiler. Recognition outputs
  normalized [0,1] coords mapped by an explicit transform.
- Physics: fixed 1/120 s step, bounded accumulator (≤ 8 steps/frame), speed setting scales how many
  fixed steps run — never the step size — so speed never changes outcomes. Velocity clamp + minimum
  static thickness against tunnelling. Reset = recompile from the authored spec.
- Gravity relative to Earth (1.0, Moon 0.165, Zero 0). No metres/newtons/joules shown.
- Port 3015 (Sunday builds each get their own).

## Acceptance checklist

P0
- [x] Draw with pencil/ball/block/ramp/ground/target tools (mouse, trackpad, touch); eraser; select/move/resize/rotate; undo/redo; static toggle
- [x] Freehand strokes fitted deterministically (circle/rect/line) with fit indicators and "Needs review" reasons
- [x] Recognition overlays + change-interpretation before play
- [x] Bring to Life transition (trace → fill → paper fade → physics), reduced-motion respected
- [x] Play / pause / step / reset / speed / gravity / drag-release / trails / vectors
- [x] Collision + target events; telemetry in scene units
- [x] Three samples through the same compiler, outcomes verified by headless runs
- [x] Compare: same spec cloned into isolated worlds, shared controls, measured table
- [x] Save/load (versioned localStorage), JSON import/export with validation, PNG export with notes
- [x] Every state designed: empty, drawing, recognizing, needs review, ready, running, paused, error

P1
- [x] Photo upload + camera capture, crop/rotate/perspective, local CV candidates overlaid on the original
- [x] Optional Ollama vision role hints (vision-capable local models only; cloud models excluded)
- [x] Copilot: deterministic parser + Ollama fallback → validated ScenePatch → proposal → Apply → Undo; stale-response guard
- [x] Explain: measured observations separated from AI explanation; labelled rule-based fallback
- [x] Demo readiness check (every check actually executed); runbook in README

P2 (only if P0/P1 solid)
- [x] Target challenge: bounded headless parameter search, reports only tested results
- [x] Timeline scrub/replay (view-only replay while paused)

Verification
- [x] Vitest: spec/patch validation, transforms, reset, compare isolation, gravity, target, bad JSON/timeout/cancel, stale responses, save/load
- [x] Playwright: draw→play→pause→reset, chain sample, compare, apply+undo, missing model, upload recognition
- [x] Production build, typecheck, lint; UI inspected at desktop and laptop sizes


Status (2026-10-17): every box above is implemented and covered by tests — see README → Validation results.
Vision double-check validated with qwen2.5vl:3b (15/16 agreement on synthetic fixtures). Not validated: real phone photos.
