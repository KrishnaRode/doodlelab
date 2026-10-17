import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { AiError, chatJson, getStatus, isCloudModel, parseModelJson, pickDefaults } from "@/lib/ai/ollama";
import { convertAiPatch } from "@/lib/ai/convert";
import { groundText } from "@/lib/explain/ground";
import { buildFacts } from "@/lib/explain/facts";
import { runHeadless } from "@/lib/physics/simulation";
import { dominoChain } from "@/lib/scene/samples";
import { POST as patchRoute } from "@/app/api/ai/patch/route";
import { POST as explainRoute } from "@/app/api/ai/explain/route";
import { POST as visionRoute } from "@/app/api/ai/vision/route";

/** A fake Ollama whose /api/chat behaviour is chosen per test. */
let mode: "ok" | "slow" | "malformed" | "wrong-shape" | "missing" = "ok";
let reply = "{}";
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/version") return res.end(JSON.stringify({ version: "test" }));
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen3:4b", size: 2.5e9, digest: "a" }, { name: "gpt-oss:120b-cloud", size: 300, digest: "b" }, { name: "qwen2.5vl:3b", size: 3.2e9, digest: "c" }] }));
      if (req.url === "/api/show") {
        const m = JSON.parse(body).model as string;
        return res.end(JSON.stringify({ capabilities: m.includes("vl") ? ["completion", "vision"] : ["completion", "thinking"], details: { parameter_size: "4B" }, ...(m.includes("cloud") ? { remote_host: "https://ollama.com" } : {}) }));
      }
      if (req.url === "/api/chat") {
        if (mode === "missing") {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: "model 'nope' not found" }));
        }
        if (mode === "slow") return void setTimeout(() => res.end(JSON.stringify({ message: { content: reply } })), 4000);
        if (mode === "malformed") return res.end(JSON.stringify({ message: { content: "Sure! here you go: {ops: [" } }));
        if (mode === "wrong-shape") return res.end(JSON.stringify({ message: { content: JSON.stringify({ hello: "world" }) } }));
        return res.end(JSON.stringify({ message: { content: reply } }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.DOODLELAB_OLLAMA_URL = base;
});
afterAll(() => {
  server.close();
  delete process.env.DOODLELAB_OLLAMA_URL;
});

const Schema = z.object({ answer: z.string() });

describe("parsing model output defensively", () => {
  it("strips fences and think tags", () => {
    const r = parseModelJson('```json\n<think>hmm</think>{"answer":"x"}\n```', Schema);
    expect(r).toEqual({ ok: true, data: { answer: "x" } });
  });
  it("rejects malformed JSON and wrong shapes with distinct codes", () => {
    expect(parseModelJson("{answer: x", Schema)).toMatchObject({ ok: false, code: "bad-json" });
    expect(parseModelJson('{"other":1}', Schema)).toMatchObject({ ok: false, code: "invalid-output" });
    expect(parseModelJson("", Schema)).toMatchObject({ ok: false, code: "bad-json" });
  });
});

describe("Ollama transport", () => {
  it("reports real models + capabilities and never defaults to a cloud model", async () => {
    const s = await getStatus();
    expect(s.reachable).toBe(true);
    const cloud = s.models.find((m) => m.name.includes("cloud"))!;
    expect(cloud.cloud).toBe(true);
    expect(s.defaults.text).toBe("qwen3:4b");
    expect(s.defaults.vision).toBe("qwen2.5vl:3b");
    expect(isCloudModel("kimi-k2:1t-cloud", false)).toBe(true);
    expect(pickDefaults([{ name: "gpt-oss:20b-cloud", sizeBytes: 0, parameterSize: null, family: null, capabilities: ["completion"], cloud: true }]).text).toBeNull();
  });

  it("returns validated data on success", async () => {
    mode = "ok";
    reply = JSON.stringify({ answer: "hi" });
    const r = await chatJson({ model: "qwen3:4b", system: "s", user: "u", schema: Schema, timeoutMs: 5000 });
    expect(r.data.answer).toBe("hi");
  });

  it("maps bad model JSON to a bad-json error after one retry", async () => {
    mode = "malformed";
    await expect(chatJson({ model: "qwen3:4b", system: "s", user: "u", schema: Schema, timeoutMs: 5000 })).rejects.toMatchObject({ code: "bad-json" });
    mode = "wrong-shape";
    await expect(chatJson({ model: "qwen3:4b", system: "s", user: "u", schema: Schema, timeoutMs: 5000 })).rejects.toMatchObject({ code: "invalid-output" });
  });

  it("times out instead of hanging", async () => {
    mode = "slow";
    const t = Date.now();
    await expect(chatJson({ model: "qwen3:4b", system: "s", user: "u", schema: Schema, timeoutMs: 1600 })).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - t).toBeLessThan(3500);
  });

  it("propagates user cancellation", async () => {
    mode = "slow";
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 150);
    await expect(chatJson({ model: "qwen3:4b", system: "s", user: "u", schema: Schema, timeoutMs: 10000, signal: ctrl.signal })).rejects.toMatchObject({ code: "cancelled" });
  });

  it("reports a missing model", async () => {
    mode = "missing";
    await expect(chatJson({ model: "nope", system: "s", user: "u", schema: Schema, timeoutMs: 5000 })).rejects.toMatchObject({ code: "model-missing" });
  });

  it("reports Ollama offline when nothing listens", async () => {
    process.env.DOODLELAB_OLLAMA_URL = "http://127.0.0.1:9"; // discard port: refused
    try {
      const s = await getStatus();
      expect(s.reachable).toBe(false);
      await expect(chatJson({ model: "qwen3:4b", system: "s", user: "u", schema: Schema, timeoutMs: 3000 })).rejects.toBeInstanceOf(AiError);
      const res = await patchRoute(new Request("http://x/api/ai/patch", { method: "POST", body: JSON.stringify({ request: "make it pink", scene: dominoChain(), model: "qwen3:4b" }) }));
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe("ollama-offline");
    } finally {
      process.env.DOODLELAB_OLLAMA_URL = base;
    }
  });
});

describe("AI routes validate everything the model says", () => {
  it("patch route converts and validates model ops; unknown IDs are rejected", async () => {
    mode = "ok";
    reply = JSON.stringify({ understood: true, summary: "Make ramp slippery", ops: [{ op: "setMaterial", objectId: "ramp-1", material: "slippery" }, { op: "move", objectId: "ghost-9", dx: 5 }] });
    const res = await patchRoute(new Request("http://x", { method: "POST", body: JSON.stringify({ request: "ice ramp", scene: dominoChain(), model: "qwen3:4b" }) }));
    const j = (await res.json()) as { kind: string; patch: { ops: unknown[] }; rejected: string[] };
    expect(j.kind).toBe("patch");
    expect(j.patch.ops).toHaveLength(1);
    expect(j.rejected[0]).toMatch(/ghost-9/);
  });

  it("patch route never accepts code or non-allowlisted ops", async () => {
    reply = JSON.stringify({ understood: true, summary: "x", ops: [{ op: "eval", code: "rm -rf /" }] });
    const res = await patchRoute(new Request("http://x", { method: "POST", body: JSON.stringify({ request: "do it", scene: dominoChain(), model: "qwen3:4b" }) }));
    expect(res.status).toBe(502);
  });

  it("explain route removes sentences with unmeasured numbers", async () => {
    const spec = dominoChain();
    const facts = buildFacts(spec, runHeadless(spec));
    reply = JSON.stringify({ child: "The ball rolled into the dominoes.", deeper: "It hit them. It lost 37.25 joules of energy.", reasons: [{ text: "Low bounce", factIds: ["F3", "F999"] }] });
    const res = await explainRoute(new Request("http://x", { method: "POST", body: JSON.stringify({ question: "why?", facts, model: "qwen3:4b" }) }));
    const j = (await res.json()) as { explanation: { deeper: string; reasons: Array<{ factIds: string[] }> }; removed: string[] };
    expect(j.explanation.deeper).toBe("It hit them.");
    expect(j.removed[0]).toMatch(/37.25/);
    expect(j.explanation.reasons[0]!.factIds).toEqual(["F3"]);
  });
});

describe("vision route", () => {
  const crop = (id: string) => ({ id, image: "A".repeat(200) });
  it("refuses models without the vision capability, and cloud models", async () => {
    const r1 = await visionRoute(new Request("http://x", { method: "POST", body: JSON.stringify({ crops: [crop("s1")], model: "qwen3:4b" }) }));
    expect(r1.status).toBe(409);
    expect(((await r1.json()) as { message: string }).message).toMatch(/no vision capability/);
    const r2 = await visionRoute(new Request("http://x", { method: "POST", body: JSON.stringify({ crops: [crop("s1")], model: "gpt-oss:120b-cloud" }) }));
    expect(r2.status).toBe(409);
  });
  it("asks once per crop and returns only coarse marks (never geometry or roles)", async () => {
    mode = "ok";
    reply = JSON.stringify({ shape: "round-shape" });
    const r = await visionRoute(new Request("http://x", { method: "POST", body: JSON.stringify({ crops: [crop("s1"), crop("s2")], model: "qwen2.5vl:3b" }) }));
    const j = (await r.json()) as { hints: Array<{ id: string; mark: string }>; skipped: string[] };
    expect(j.hints.map((h) => [h.id, h.mark])).toEqual([["s1", "round-shape"], ["s2", "round-shape"]]);
    expect(j.skipped).toEqual([]);
  });
  it("an unusable answer for one crop is skipped, not fatal", async () => {
    mode = "wrong-shape";
    const r = await visionRoute(new Request("http://x", { method: "POST", body: JSON.stringify({ crops: [crop("s1")], model: "qwen2.5vl:3b" }) }));
    const j = (await r.json()) as { ok: boolean; hints: unknown[]; skipped: string[] };
    expect(j.ok).toBe(true);
    expect(j.hints).toEqual([]);
    expect(j.skipped).toEqual(["s1"]);
  });
});

describe("conversion + grounding helpers", () => {
  it("convertAiPatch never invents IDs", () => {
    const scene = dominoChain();
    const r = convertAiPatch({ understood: true, summary: "x", ops: [{ op: "remove", objectId: "nope" }, { op: "set", objectId: "ball-1" }] }, scene);
    expect(r.patch).toBeNull();
    expect(r.rejected).toHaveLength(2);
  });
  it("groundText keeps sentences whose numbers are measured", () => {
    const g = groundText("It rested at 2.81 s. Speed was 999 u/s.", [{ id: "F1", kind: "measured", text: "came to rest at 2.81 s", numbers: [2.81] }]);
    expect(g.text).toBe("It rested at 2.81 s.");
    expect(g.removed).toHaveLength(1);
  });
});
