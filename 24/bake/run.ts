// Bake the knot: try many, settle each under hard physics, keep the best as src/tracks.json.
//   node bake/run.ts            40 knots from seed 1
//   node bake/run.ts 200 1000   200 knots from seed 1000
//   node bake/run.ts 1 17       just seed 17 (to re-bake a known good one)
import { writeFileSync } from 'node:fs';
import { AREA, BAKE, VIEW, candidate, settle, smoothRings, score, clearance, LOOPS } from '../src/bake.ts';

const tries = Number(process.argv[2] ?? 40);
const from = Number(process.argv[3] ?? 1);
const quick = { seconds: 3, substeps: 3, iters: 6 };
const fmt = (s: ReturnType<typeof score>) =>
  `score ${s.score.toFixed(1)}  cover ${(s.coverage * 100).toFixed(1)}%  pen max ${s.maxPen.toFixed(1)} mm sum ${s.sumPen.toFixed(0)}  layers ${s.layers.toFixed(2)}`;

// a quick settle to rank them all, then the best few again, hard
const ranked: { seed: number; s: ReturnType<typeof score> }[] = [];
for (let seed = from; seed < from + tries; seed++) {
  const t0 = performance.now();
  const c = candidate(seed);
  const st = settle(c, quick.seconds, quick.substeps, quick.iters);
  const s = score(st);
  ranked.push({ seed, s });
  console.log(`seed ${seed}  ${fmt(s)}  (${c.tangle.crossings.length} crossings, ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
ranked.sort((a, b) => b.s.score - a.s.score);
let best: { seed: number; s: ReturnType<typeof score>; st: ReturnType<typeof settle>; c: ReturnType<typeof candidate> } | null = null;
for (const { seed } of ranked.slice(0, Math.min(4, ranked.length))) {
  const t0 = performance.now();
  const c = candidate(seed);
  const st = settle(c, 5, 4, 12);
  smoothRings(st, 2);
  const s = score(st);
  console.log(`hard  seed ${seed}  ${fmt(s)}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  if (!best || s.score > best.s.score) best = { seed, s, st, c };
}
const { st, c, s, seed } = best!;
const clear = clearance(st);
const tracks = [];
for (let k = 0; k < LOOPS; k++) {
  const o = st.off[k], n = st.cnt[k];
  const xyz: number[] = [];
  const cl: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) xyz.push(Math.round(st.pos[(o + i) * 3 + a] * 1e5)); // hundredths of a millimetre
    cl.push(clear[o + i]);
  }
  tracks.push({ species: c.species[k], radius: +c.radii[k].toFixed(5), len: +(n * st.seg[k]).toFixed(5), n, xyz, clear: cl });
}
// what the run time must agree with travels with the tracks: how much wider the bodies were baked,
// the patch they lie on and how much of it the camera frames
writeFileSync(new URL('../src/tracks.json', import.meta.url), JSON.stringify({ seed, score: s, inflate: BAKE.inflate, area: AREA, view: VIEW, tracks }));
console.log(`\nkept seed ${seed}: ${fmt(s)}`);
