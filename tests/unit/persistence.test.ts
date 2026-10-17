import { describe, expect, it } from "vitest";
import { listProjects, loadProject, parseProjectOrScene, saveProject, deleteProject, autosave, loadAutosave, MAX_STORED_PHOTO_CHARS, type StorageLike } from "@/lib/state/persistence";
import { bounceToTarget, dominoChain } from "@/lib/scene/samples";

class MemStore implements StorageLike {
  m = new Map<string, string>();
  quota = Infinity;
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw Object.assign(new Error("exceeded the quota"), { name: "QuotaExceededError" });
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe("local persistence", () => {
  it("save → list → load round-trips the exact scene", () => {
    const s = new MemStore();
    const scene = bounceToTarget();
    const r = saveProject({ name: "Puzzle", scene, notes: "try bouncy" }, s, new Date("2026-10-17T10:00:00Z"));
    expect(r.ok).toBe(true);
    const list = listProjects(s);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Puzzle", objectCount: scene.objects.length });
    const loaded = loadProject(list[0]!.id, s);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.project.scene).toEqual(scene);
      expect(loaded.project.notes).toBe("try bouncy");
    }
    deleteProject(list[0]!.id, s);
    expect(listProjects(s)).toHaveLength(0);
  });

  it("overwrites when saving with the same id", () => {
    const s = new MemStore();
    const a = saveProject({ name: "A", scene: dominoChain() }, s);
    if (!a.ok) throw new Error();
    saveProject({ id: a.id, name: "A2", scene: dominoChain() }, s);
    expect(listProjects(s).map((p) => p.name)).toEqual(["A2"]);
  });

  it("refuses corrupted or invalid saved data with a clear error", () => {
    const s = new MemStore();
    s.setItem("doodlelab.v1.project.x", "{not json");
    expect(loadProject("x", s)).toMatchObject({ ok: false });
    const bad = { schema: "doodlelab.project", version: 1, id: "y", name: "y", updatedAt: "", notes: "", scene: { ...dominoChain(), objects: [{ id: "BAD ID" }] } };
    expect(parseProjectOrScene(bad).ok).toBe(false);
    expect(parseProjectOrScene({ schema: "doodlelab.project", version: 9 }).ok).toBe(false);
    expect(parseProjectOrScene({ hello: 1 }).ok).toBe(false);
  });

  it("imports a bare SceneSpec export", () => {
    const r = parseProjectOrScene(JSON.parse(JSON.stringify(dominoChain())));
    expect(r.ok).toBe(true);
  });

  it("drops photos too large for browser storage, and reports quota errors", () => {
    const s = new MemStore();
    const big = { src: "x".repeat(MAX_STORED_PHOTO_CHARS + 1), width: 10, height: 10 };
    const r = saveProject({ name: "P", scene: dominoChain(), photo: big }, s);
    expect(r).toMatchObject({ ok: true, photoDropped: true });
    s.quota = 100;
    const q = saveProject({ name: "Q", scene: dominoChain() }, s);
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.error).toMatch(/full/);
  });

  it("autosave round-trips and ignores invalid content", () => {
    const s = new MemStore();
    autosave(dominoChain(), s);
    expect(loadAutosave(s)).toEqual(dominoChain());
    s.setItem("doodlelab.v1.autosave", JSON.stringify({ scene: { nope: true } }));
    expect(loadAutosave(s)).toBeNull();
  });

  it("no storage available → explicit error", () => {
    expect(saveProject({ name: "x", scene: dominoChain() }, null)).toMatchObject({ ok: false });
  });
});
