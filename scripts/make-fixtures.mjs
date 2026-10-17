/**
 * Generates the three paper-photo FIXTURES used to test the image pipeline.
 *
 * These are SYNTHETIC photos: hand-drawn-style pencil strokes rendered on textured paper,
 * then photographed in a headless browser with 3D perspective, uneven lighting, a table
 * background and JPEG compression. They are clearly labelled as synthetic in the UI.
 * Real phone photos can be dropped into public/fixtures/ the same way (see README).
 *
 * The true paper corners (in photo pixels) are written alongside each image so tests can
 * check perspective correction and recognition against ground truth.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "public", "fixtures");

const PAPER_W = 1100;
const PAPER_H = 778; // A4 landscape ratio

const FIXTURES = [
  {
    id: "paper-ramp-ball",
    title: "Ramp, ball, block",
    transform: "rotateX(16deg) rotateY(-7deg) rotateZ(-3deg)",
    light: "radial-gradient(1100px 700px at 15% 10%, rgba(255,255,255,0.10), rgba(0,0,0,0.20))",
    shapes: [
      { kind: "line", a: [120, 270], b: [560, 560] },
      { kind: "circle", c: [175, 195], r: 46 },
      { kind: "line", a: [60, 690], b: [1040, 692] },
      { kind: "rect", a: [790, 545], b: [900, 670] },
    ],
    expect: { ball: 1, ramp: 1, ground: 1, block: 1 },
  },
  {
    id: "paper-bullseye",
    title: "Ball, deflector, shelf, bullseye",
    transform: "rotateX(-12deg) rotateY(9deg) rotateZ(4deg)",
    light: "linear-gradient(115deg, rgba(0,0,0,0.0) 40%, rgba(0,0,0,0.22) 100%)",
    shapes: [
      { kind: "circle", c: [190, 150], r: 42 },
      { kind: "line", a: [110, 430], b: [390, 520] },
      { kind: "line", a: [610, 480], b: [930, 480] },
      { kind: "circle", c: [770, 360], r: 66 },
      { kind: "circle", c: [770, 360], r: 26 },
      { kind: "line", a: [60, 705], b: [1040, 700] },
    ],
    expect: { ball: 1, ramp: 1, platform: 1, target: 1, ground: 1 },
  },
  {
    id: "paper-dominoes",
    title: "Ramp, ball, three dominoes, a scribble",
    transform: "rotateX(20deg) rotateY(4deg) rotateZ(-6deg)",
    light: "radial-gradient(900px 600px at 80% 90%, rgba(0,0,0,0.25), rgba(255,255,255,0.06))",
    shapes: [
      { kind: "line", a: [100, 250], b: [430, 560] },
      { kind: "circle", c: [150, 185], r: 40 },
      { kind: "rect", a: [560, 545], b: [588, 676] },
      { kind: "rect", a: [660, 545], b: [688, 676] },
      { kind: "rect", a: [760, 545], b: [788, 676] },
      { kind: "line", a: [60, 690], b: [1040, 688] },
      { kind: "scribble", at: [900, 130] },
    ],
    expect: { ball: 1, ramp: 1, domino: 3, ground: 1 },
  },
];

const html = (f) => `<!doctype html><html><body style="margin:0;width:1400px;height:1000px;overflow:hidden;
  background: radial-gradient(1200px 800px at 30% 20%, #6b4f3a, #3b2a1f);">
<div style="position:absolute;inset:0;perspective:1500px;display:flex;align-items:center;justify-content:center;">
  <div id="paper" style="position:relative;width:${PAPER_W}px;height:${PAPER_H}px;transform:${f.transform};
     box-shadow: 0 30px 60px rgba(0,0,0,0.45);">
    <canvas id="c" width="${PAPER_W}" height="${PAPER_H}" style="position:absolute;inset:0"></canvas>
    <div style="position:absolute;inset:0;background:${f.light};pointer-events:none"></div>
    ${["tl", "tr", "br", "bl"].map((k) => `<i id="${k}" style="position:absolute;width:0;height:0;${k.includes("t") ? "top:0" : "bottom:0"};${k.includes("l") ? "left:0" : "right:0"}"></i>`).join("")}
  </div>
</div>
<script>
{
const shapes = ${JSON.stringify(f.shapes)};
let seed = ${f.id.length * 7919};
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const c = document.getElementById('c'); const ctx = c.getContext('2d');
ctx.fillStyle = '#f4efe2'; ctx.fillRect(0,0,c.width,c.height);
for (let i = 0; i < 26000; i++) { const g = 200 + rnd()*45; ctx.fillStyle = 'rgba('+g+','+(g-6)+','+(g-18)+',0.35)'; ctx.fillRect(rnd()*c.width, rnd()*c.height, 1.5, 1.5); }
function pencil(points, passes = 2) {
  for (let p = 0; p < passes; p++) {
    ctx.strokeStyle = 'rgba(38,40,48,' + (0.75 + rnd()*0.2) + ')';
    ctx.lineWidth = 3.2 + rnd()*1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach(([x,y], i) => { const jx = x + (rnd()-0.5)*2.2 + p*0.8, jy = y + (rnd()-0.5)*2.2 + p*0.6; i ? ctx.lineTo(jx,jy) : ctx.moveTo(jx,jy); });
    ctx.stroke();
  }
}
for (const s of shapes) {
  if (s.kind === 'line') { const pts = []; const n = 40; const bow = (rnd()-0.5)*10;
    for (let i = 0; i <= n; i++) { const t = i/n; const x = s.a[0] + (s.b[0]-s.a[0])*t, y = s.a[1] + (s.b[1]-s.a[1])*t; const nx = -(s.b[1]-s.a[1]), ny = s.b[0]-s.a[0]; const L = Math.hypot(nx,ny); const off = Math.sin(t*Math.PI)*bow; pts.push([x + nx/L*off, y + ny/L*off]); }
    pencil(pts); }
  if (s.kind === 'circle') { const pts = []; const n = 64; const st = rnd()*6.28; const over = 0.12 + rnd()*0.1;
    for (let i = 0; i <= n*(1+over); i++) { const t = st + i/n*6.283; const r = s.r*(1 + (rnd()-0.5)*0.05) + Math.sin(t*2)*s.r*0.03; pts.push([s.c[0] + Math.cos(t)*r, s.c[1] + Math.sin(t)*r]); }
    pencil(pts); }
  if (s.kind === 'rect') { const [x0,y0] = s.a, [x1,y1] = s.b; const sides = [[[x0-4,y0],[x1+5,y0+1]],[[x1,y0-4],[x1-1,y1+5]],[[x1+4,y1],[x0-5,y1-1]],[[x0,y1+4],[x0+1,y0-5]]];
    for (const [a,b] of sides) { const pts = []; for (let i = 0; i <= 12; i++) { const t = i/12; pts.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]); } pencil(pts, 2); } }
  if (s.kind === 'scribble') { const pts = []; for (let i = 0; i < 60; i++) { const t = i/60; pts.push([s.at[0] + t*90 + Math.sin(t*40)*6, s.at[1] + Math.cos(t*31)*12]); } pencil(pts, 1); }
}
}
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("pageerror", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console", m.text()));
const manifest = [];
for (const f of FIXTURES) {
  await page.goto("about:blank");
  await page.setContent(html(f));
  await page.waitForTimeout(150);
  const corners = await page.evaluate(() =>
    ["tl", "tr", "br", "bl"].map((k) => {
      const r = document.getElementById(k).getBoundingClientRect();
      return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10 };
    }),
  );
  const file = `${f.id}.jpg`;
  await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 82 });
  manifest.push({ id: f.id, title: f.title, file: `/fixtures/${file}`, synthetic: true, corners, paperAspect: PAPER_W / PAPER_H, expect: f.expect });
  console.log("wrote", file, JSON.stringify(corners));
}
writeFileSync(path.join(out, "fixtures.json"), JSON.stringify({ note: "SYNTHETIC test photos generated by scripts/make-fixtures.mjs — not real camera photos.", fixtures: manifest }, null, 2));
await browser.close();
