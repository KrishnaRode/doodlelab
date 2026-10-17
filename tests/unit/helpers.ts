import { emptyScene, type SceneSpec } from "@/lib/scene/spec";
import { makeObject } from "@/lib/scene/objects";
import { ground } from "@/lib/scene/samples";

/** Ground + one ball dropped from `y`. */
export function dropScene(y = 100, material: "bouncy" | "wood" | "heavy" = "heavy"): SceneSpec {
  const s = emptyScene("drop", "Drop");
  s.objects.push(ground(), makeObject({ id: "ball-1", role: "ball", x: 500, y, shape: { kind: "circle", radius: 20 }, material }));
  return s;
}
