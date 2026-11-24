import { MAX_LEVEL, buildLevel } from './levels.ts';
import { validateLevel } from './level-check.ts';

const STAGE_WIDTHS = [
  { name: 'desktop', halfW: 0.88 },
  { name: 'tablet', halfW: 0.56 },
  { name: 'mobile', halfW: 0.32 },
];

const t0 = performance.now();
let failures = 0;
const samples: string[] = [];

let totalGems = 0;
let totalBlack = 0;

for (let lv = 1; lv <= MAX_LEVEL; lv++) {
  const a = buildLevel(lv);
  const b = buildLevel(lv);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    if (samples.length < 20) samples.push(`Lv ${lv}: NOT deterministic!`);
    continue;
  }

  totalGems += a.clearCount;
  totalBlack += a.poisonCount;

  for (const sw of STAGE_WIDTHS) {
    const err = validateLevel(a, sw.halfW);
    if (err) {
      failures++;
      if (samples.length < 20) {
        samples.push(`Lv ${lv} [${sw.name}]: ${err.reason}`);
      }
      break;
    }
  }
}

const ms = (performance.now() - t0).toFixed(0);
if (failures === 0) {
  console.log(
    `✓ All ${MAX_LEVEL} levels validated across desktop, tablet & mobile in ${ms}ms ` +
    `(${totalGems} gems, ${totalBlack} black diamonds — 100% deterministic & solvable)`,
  );
} else {
  console.error(`✗ ${failures} / ${MAX_LEVEL} levels failed validation (${ms}ms):`);
  for (const s of samples) console.error('  -', s);
  throw new Error(`${failures} level(s) failed validation`);
}
