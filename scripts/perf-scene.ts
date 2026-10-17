/** Builds a 30-dynamic-body stress scene (balls, blocks, dominoes) for performance checks. */
import { writeFileSync } from "node:fs";
import { emptyScene } from "../lib/scene/spec";
import { makeObject } from "../lib/scene/objects";
import { ground, rampBetween } from "../lib/scene/samples";

export function perfScene() {
  const s = emptyScene("perf-30", "Performance: 30 moving bodies");
  s.objects.push(ground(), rampBetween("ramp-1", 40, 200, 450, 420), rampBetween("ramp-2", 960, 240, 560, 430));
  let n = 0;
  for (let i = 0; i < 12; i++) s.objects.push(makeObject({ id: `ball-${++n}`, role: "ball", x: 80 + i * 70, y: 40 + (i % 3) * 18, shape: { kind: "circle", radius: 14 + (i % 3) * 3 }, material: (["bouncy", "wood", "heavy"] as const)[i % 3] }));
  for (let i = 0; i < 8; i++) s.objects.push(makeObject({ id: `block-${i + 1}`, role: "block", x: 150 + i * 95, y: 120, shape: { kind: "rect", width: 34, height: 34 } }));
  for (let i = 0; i < 10; i++) s.objects.push(makeObject({ id: `domino-${i + 1}`, role: "domino", x: 470 + i * 26, y: 570 - 35, shape: { kind: "rect", width: 10, height: 70 } }));
  return s;
}

if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(perfScene(), null, 2));
