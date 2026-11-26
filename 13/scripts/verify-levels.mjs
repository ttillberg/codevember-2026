/**
 * Exhaustive state-space puzzle verifier for Day 13 Sphere Labyrinth (all 10 levels).
 * Verifies every production-readiness invariant:
 *  1. Solvable under both permissive (can skirt toggle center) & strict (entering cell always flips) physics
 *  2. Every switch is individually mandatory (removing any single switch makes the level UNSOLVABLE)
 *  3. Portals are mandatory on every portal level (closing all shutters makes the level UNSOLVABLE)
 *  4. Zero soft-lock / dead-end states across the entire reachable state graph (player can never get permanently trapped)
 *  5. Zero cell overlaps or invalid placements (solid cells only, unique locations, non-empty toggles)
 *  6. Clean progressive difficulty curve from Level 1 -> Level 10
 */
import { createSphereGrid, solveLevel } from '../src/maze.ts';

const grid = createSphereGrid();
const { cells, walls, shutters, pipeNodes, pipeEdges } = grid;
const adj = Array.from({ length: cells.length }, () => []);
for (const w of walls) {
  adj[w.cellA].push(w);
  adj[w.cellB].push(w);
}

function analyzeStateGraph(level, strictToggleTrigger) {
  const totalCps = level.checkpoints.length;
  const maxMask = 1 << level.toggles.length;
  const cellToToggle = new Int8Array(cells.length).fill(-1);
  for (const tg of level.toggles) cellToToggle[tg.cellId] = tg.id;

  const wallsByMask = [];
  const shuttersByMask = [];
  for (let m = 0; m < maxMask; m++) {
    const wArr = level.raisedWalls.slice();
    const sArr = level.openShutters.slice();
    for (const tg of level.toggles) {
      if ((m & (1 << tg.id)) !== 0) {
        for (const wid of tg.wallIds) if (!walls[wid].locked) wArr[wid] = !wArr[wid];
        for (const sid of tg.shutterIds) sArr[sid] = !sArr[sid];
      }
    }
    wallsByMask.push(wArr);
    shuttersByMask.push(sArr);
  }

  const locStride = Math.max(cells.length, pipeNodes.length);
  const encode = (layer, loc, mask, cp) => (((cp * maxMask + mask) * 2 + layer) * locStride + loc);

  const advanceCp = (layer, loc, cp) => {
    let next = cp;
    while (next < totalCps) {
      const target = level.checkpoints[next];
      if (layer === 0 && target.layer === 'upper' && target.cellId === loc) next++;
      else if (layer === 1 && target.layer === 'pipe' && target.pipeNodeId === loc) next++;
      else break;
    }
    return next;
  };

  const startKey = encode(0, level.startCellId, 0, 0);
  const stateMap = new Map();
  const revAdj = new Map();
  const queue = [{ key: startKey, layer: 0, loc: level.startCellId, mask: 0, cp: 0, steps: 0 }];
  stateMap.set(startKey, queue[0]);

  let minWinSteps = -1;

  const addEdge = (fromKey, layer, loc, mask, curCp, curSteps) => {
    const nextCp = advanceCp(layer, loc, curCp);
    const toKey = encode(layer, loc, mask, nextCp);
    if (!revAdj.has(toKey)) revAdj.set(toKey, []);
    revAdj.get(toKey).push(fromKey);
    if (!stateMap.has(toKey)) {
      const st = { key: toKey, layer, loc, mask, cp: nextCp, steps: curSteps + 1 };
      stateMap.set(toKey, st);
      queue.push(st);
      if (nextCp >= totalCps && minWinSteps === -1) {
        minWinSteps = st.steps;
      }
    }
  };

  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur.cp >= totalCps) continue;

    if (cur.layer === 0) {
      const wState = wallsByMask[cur.mask];
      for (const w of adj[cur.loc]) {
        if (wState[w.id]) continue;
        const nextCell = w.cellA === cur.loc ? w.cellB : w.cellA;
        const tgIdx = cellToToggle[nextCell];
        if (tgIdx >= 0) {
          addEdge(cur.key, 0, nextCell, cur.mask ^ (1 << tgIdx), cur.cp, cur.steps);
          if (!strictToggleTrigger) {
            addEdge(cur.key, 0, nextCell, cur.mask, cur.cp, cur.steps);
          }
        } else {
          addEdge(cur.key, 0, nextCell, cur.mask, cur.cp, cur.steps);
        }
      }
      const shId = cells[cur.loc].shutterId;
      if (shId >= 0 && shuttersByMask[cur.mask][shId]) {
        addEdge(cur.key, 1, shutters[shId].pipeNodeId, cur.mask, cur.cp, cur.steps);
      }
    } else {
      const pNode = pipeNodes[cur.loc];
      for (const eid of pNode.edgeIds) {
        const e = pipeEdges[eid];
        const nextNode = e.nodeA === cur.loc ? e.nodeB : e.nodeA;
        addEdge(cur.key, 1, nextNode, cur.mask, cur.cp, cur.steps);
      }
      if (pNode.shutterId >= 0 && shuttersByMask[cur.mask][pNode.shutterId]) {
        addEdge(cur.key, 0, shutters[pNode.shutterId].cellId, cur.mask, cur.cp, cur.steps);
      }
    }
  }

  // Reverse BFS from all winning states to detect any soft-lock / inescapable dead-end states
  const canWin = new Set();
  const rQueue = [];
  for (const [k, st] of stateMap) {
    if (st.cp >= totalCps) {
      canWin.add(k);
      rQueue.push(k);
    }
  }
  for (let i = 0; i < rQueue.length; i++) {
    const u = rQueue[i];
    for (const prev of revAdj.get(u) || []) {
      if (!canWin.has(prev)) {
        canWin.add(prev);
        rQueue.push(prev);
      }
    }
  }

  return {
    solvable: minWinSteps >= 0,
    minWinSteps,
    totalStates: stateMap.size,
    deadStates: stateMap.size - canWin.size,
  };
}

let failures = 0;

console.log('Day 13 Sphere Labyrinth — 10-Level Production Puzzle Verification');
console.log('-----------------------------------------------------------------------------------------------');

for (const lvl of grid.levels) {
  const issues = [];
  const s = lvl.stats;

  // 1. Solvability (both permissive and strict-trigger models)
  if (!s.solvable) issues.push('UNSOLVABLE(permissive)');
  const strict = analyzeStateGraph(lvl, true);
  const permissive = analyzeStateGraph(lvl, false);
  if (!strict.solvable) issues.push('UNSOLVABLE(strict-trigger)');

  // 2. Zero soft-lock states under either model
  if (strict.deadStates > 0) issues.push(`SOFTLOCK_STRICT(${strict.deadStates}/${strict.totalStates})`);
  if (permissive.deadStates > 0) issues.push(`SOFTLOCK_PERM(${permissive.deadStates}/${permissive.totalStates})`);

  // 3. Every switch must be individually mandatory (cannot beat level if that switch is untouched)
  for (const tg of lvl.toggles) {
    if (tg.wallIds.length === 0 && tg.shutterIds.length === 0) {
      issues.push(`EMPTY_SW_${tg.label}`);
      continue;
    }
    const withoutTg = {
      ...lvl,
      toggles: lvl.toggles.filter((t) => t.id !== tg.id).map((t, i) => ({ ...t, id: i })),
    };
    const r = solveLevel(withoutTg, cells, walls, adj, shutters, pipeNodes, pipeEdges);
    if (r.solvable) {
      issues.push(`SKIPPABLE_SW_${tg.label}(steps=${r.minSteps})`);
    }
  }

  // 4. Portals must be mandatory on every level that exposes any shutter
  const hasAnyShutter = lvl.openShutters.some(Boolean) || lvl.toggles.some((t) => t.shutterIds.length > 0);
  if (hasAnyShutter) {
    const noPortals = {
      ...lvl,
      openShutters: lvl.openShutters.map(() => false),
      toggles: lvl.toggles.map((t) => ({ ...t, shutterIds: [] })),
    };
    const r = solveLevel(noPortals, cells, walls, adj, shutters, pipeNodes, pipeEdges);
    if (r.solvable) {
      issues.push(`SKIPPABLE_PORTALS(steps=${r.minSteps})`);
    }
    // On pure-portal levels (no switches), upper deck alone must NOT reach South Pole without crossing via portal!
    if (lvl.toggles.length === 0) {
      const upperOnly = {
        ...lvl,
        openShutters: lvl.openShutters.map(() => false),
        checkpoints: [lvl.checkpoints[lvl.checkpoints.length - 1]],
      };
      const rFinish = solveLevel(upperOnly, cells, walls, adj, shutters, pipeNodes, pipeEdges);
      if (rFinish.solvable) {
        issues.push(`UPPER_BYPASS_TO_FINISH(steps=${rFinish.minSteps})`);
      }
    }
  }

  // 5. Placement integrity (unique solid cells, no overlap with start/window/shutter, no duplicate gate walls)
  const usedUpper = new Set([lvl.startCellId]);
  const usedWalls = new Set();
  for (const cp of lvl.checkpoints) {
    if (cp.layer === 'upper') {
      if (usedUpper.has(cp.cellId)) issues.push(`OVERLAP_CP_${cp.label}`);
      usedUpper.add(cp.cellId);
      if (cells[cp.cellId].panelKind !== 'solid') issues.push(`NON_SOLID_CP_${cp.label}`);
    }
  }
  for (const tg of lvl.toggles) {
    if (usedUpper.has(tg.cellId)) issues.push(`OVERLAP_SW_${tg.label}`);
    usedUpper.add(tg.cellId);
    if (cells[tg.cellId].panelKind !== 'solid') issues.push(`NON_SOLID_SW_${tg.label}`);
    for (const wid of tg.wallIds) {
      if (walls[wid].locked) issues.push(`LOCKED_GATE_SW_${tg.label}`);
      if (usedWalls.has(wid)) issues.push(`DUP_GATE_WALL_${wid}`);
      usedWalls.add(wid);
    }
  }

  // 6. Difficulty pacing sanity (Level 1 dead easy <= 12, Level 2 <= 20, Level 3 <= 35, Level 10 >= 90)
  const stepBounds = [
    [5, 14], // L1
    [8, 22], // L2
    [14, 34], // L3
    [20, 45], // L4
    [26, 56], // L5
    [35, 75], // L6
    [45, 90], // L7
    [60, 125], // L8
    [75, 145], // L9
    [95, 175], // L10
  ];
  const [minB, maxB] = stepBounds[lvl.level - 1] || [1, 999];
  if (s.minSteps < minB || s.minSteps > maxB) {
    issues.push(`PACING_OUT_OF_RANGE(${s.minSteps} not in ${minB}..${maxB})`);
  }

  const swSummary = lvl.toggles.map((t) => `${t.label}(w${t.wallIds.length}/s${t.shutterIds.length})`).join(',') || '-';
  const status = issues.length ? `FAIL: ${issues.join(' ; ')}` : 'PASS';
  if (issues.length) failures++;

  console.log(
    `LVL ${String(lvl.level).padStart(2, '0')} ${lvl.name.padEnd(14)} | steps=${String(s.minSteps).padStart(3)} ` +
      `| portals=${s.portalTransitions} | flips=${s.toggleFlips} | states=${String(strict.totalStates).padStart(4)} ` +
      `| sw=${swSummary.padEnd(17)} | ${status}`,
  );
}

console.log('-----------------------------------------------------------------------------------------------');
if (failures > 0) {
  console.error(`FAILED: ${failures} level(s) failed production checks.`);
  process.exit(1);
}
console.log('ALL 10 LEVELS PASSED ALL PRODUCTION CHECKS (0 skippable switches, 0 skippable portals, 0 soft-locks).');
