import { afterEach, describe, expect, it, vi } from "vitest";
import { useLab } from "@/lib/state/store";
import { useAi } from "@/lib/state/ai";
import { useCopilot } from "@/lib/state/copilot";
import { useExplain } from "@/lib/state/explain";
import { dominoChain } from "@/lib/scene/samples";

function setup() {
  useLab.getState().replaceScene(dominoChain());
  useLab.getState().setSettings({ textModel: "qwen3:4b" });
  useAi.setState({ status: { reachable: true, url: "", version: "x", models: [], defaults: { text: "qwen3:4b", vision: null } } });
}

/** fetch stub whose response is released manually. */
function deferredFetch(body: unknown) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    await gate;
    if (init?.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return { release, fn };
}

afterEach(() => vi.unstubAllGlobals());

const aiPatch = { ok: true, kind: "patch", model: "qwen3:4b", ms: 1200, rejected: [], patch: { summary: "Make ramp slippery", ops: [{ op: "setMaterial", objectId: "ramp-1", material: "slippery" }] } };

describe("stale AI responses never override a newer scene", () => {
  it("discards a proposal that arrives after the scene changed", async () => {
    setup();
    const { release } = deferredFetch(aiPatch);
    useCopilot.getState().submit("give the ramp an icy coating");
    expect(useCopilot.getState().card?.kind).toBe("thinking");
    // The user edits the scene while the model is thinking.
    useLab.getState().updateObject("ball-1", (o) => void (o.x += 5));
    release();
    await vi.waitFor(() => expect(useCopilot.getState().card?.kind).toBe("info"));
    const card = useCopilot.getState().card!;
    expect(card.kind === "info" && card.message).toMatch(/scene changed/i);
    expect(useLab.getState().scene.objects.find((o) => o.id === "ramp-1")!.material).toBe("wood");
  });

  it("shows a fresh proposal but refuses to apply it if the scene changes before Apply", async () => {
    setup();
    const { release } = deferredFetch(aiPatch);
    useCopilot.getState().submit("give the ramp an icy coating");
    release();
    await vi.waitFor(() => expect(useCopilot.getState().card?.kind).toBe("proposal"));
    useLab.getState().updateObject("ball-1", (o) => void (o.y -= 5));
    useCopilot.getState().apply();
    expect(useLab.getState().scene.objects.find((o) => o.id === "ramp-1")!.material).toBe("wood");
    expect(useCopilot.getState().card?.kind).toBe("info");
  });

  it("applies with one click and undoes with one click", async () => {
    setup();
    const { release } = deferredFetch(aiPatch);
    useCopilot.getState().submit("give the ramp an icy coating");
    release();
    await vi.waitFor(() => expect(useCopilot.getState().card?.kind).toBe("proposal"));
    useCopilot.getState().apply();
    expect(useLab.getState().scene.objects.find((o) => o.id === "ramp-1")!.material).toBe("slippery");
    useCopilot.getState().undoApplied();
    expect(useLab.getState().scene.objects.find((o) => o.id === "ramp-1")!.material).toBe("wood");
  });

  it("cancel aborts the in-flight request and leaves the scene alone", async () => {
    setup();
    const { release, fn } = deferredFetch(aiPatch);
    useCopilot.getState().submit("give the ramp an icy coating");
    useCopilot.getState().cancel();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(useCopilot.getState().card).toBeNull();
    expect(useLab.getState().scene.objects.find((o) => o.id === "ramp-1")!.material).toBe("wood");
  });

  it("rule-based commands never touch the network", () => {
    setup();
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    useCopilot.getState().submit("make gravity weaker");
    expect(fn).not.toHaveBeenCalled();
    expect(useCopilot.getState().card?.kind).toBe("proposal");
  });

  it("an explanation that arrives after an edit is labelled stale; the rule-based one is always present", async () => {
    setup();
    const { release } = deferredFetch({ ok: true, model: "qwen3:4b", ms: 900, removed: [], explanation: { child: "It rolled.", deeper: "It rolled down.", reasons: [] } });
    useExplain.getState().run("Explain what happened");
    expect(useExplain.getState().rules).not.toBeNull();
    expect(useExplain.getState().source).toBe("headless");
    useLab.getState().updateObject("ball-1", (o) => void (o.x += 1));
    release();
    await vi.waitFor(() => expect(useExplain.getState().ai).not.toBeNull());
    expect(useExplain.getState().ai!.stale).toBe(true);
  });

  it("without a model, explanations are rule-based only (never shown as AI)", () => {
    setup();
    useAi.setState({ status: { reachable: false, url: "", version: null, models: [], defaults: { text: null, vision: null } } });
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    useExplain.getState().run("Why did the ball stop?");
    expect(fn).not.toHaveBeenCalled();
    expect(useExplain.getState().ai).toBeNull();
    expect(useExplain.getState().rules!.child.length).toBeGreaterThan(10);
  });
});
