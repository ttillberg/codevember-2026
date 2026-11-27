import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildHouseNet, generateHouseSpec, type V2 } from '../src/origamiHouseNet';
import { PAPER_THICK } from '../src/origamiPaperMesh';
import { fitFlatNetToSilhouetteNDC, unprojectNdcToPlaneY, type SilhouetteCameraPose } from '../src/silhouetteMatch';

function makeCam(pose: SilhouetteCameraPose, fov = 28, aspect = 1.6): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.3, 650);
  cam.up.set(0, 1, 0);
  cam.position.set(
    pose.lookX + pose.dist * Math.cos(pose.pitch) * Math.sin(pose.yaw),
    pose.lookY + pose.dist * Math.sin(pose.pitch),
    pose.lookZ + pose.dist * Math.cos(pose.pitch) * Math.cos(pose.yaw),
  );
  cam.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  if (Math.abs(pose.roll) > 1e-5) cam.rotateZ(pose.roll);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

describe('silhouette-to-flat-net projective matcher', () => {
  it('verifies 2D similarity-transform unprojection matches PerspectiveCamera exactly', () => {
    const ndc: V2[] = [
      [0, 0],
      [-0.22, 0.18],
      [0.25, -0.14],
      [-0.12, -0.25],
      [0.19, 0.21],
    ];
    const pitch = 0.72;
    const roll = -0.34;
    const baseDist = 34;
    const yaw = 1.47;
    const scale = 0.74;
    const lx = 2.8;
    const lz = -3.4;

    const canonCam = makeCam({ yaw: 0, pitch, roll, dist: baseDist, lookX: 0, lookY: PAPER_THICK, lookZ: 0 });
    const f0 = unprojectNdcToPlaneY(ndc, canonCam, PAPER_THICK)!;

    const targetCam = makeCam({
      yaw,
      pitch,
      roll,
      dist: baseDist * scale,
      lookX: lx,
      lookY: PAPER_THICK,
      lookZ: lz,
    });
    const actual = unprojectNdcToPlaneY(ndc, targetCam, PAPER_THICK)!;

    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    for (let i = 0; i < ndc.length; i++) {
      const predX = lx + scale * (f0[i][0] * cy + f0[i][1] * sy);
      const predZ = lz + scale * (-f0[i][0] * sy + f0[i][1] * cy);
      expect(predX).toBeCloseTo(actual[i][0], 5);
      expect(predZ).toBeCloseTo(actual[i][1], 5);
    }
  });

  it('dramatically improves coverage of 3D house silhouettes across diverse flat nets', () => {
    // Representative centered 3D house silhouette (~34% height, ~30% width in NDC)
    const sil: V2[] = [];
    for (let ix = -5; ix <= 5; ix++) {
      for (let iy = -5; iy <= 5; iy++) {
        const nx = (ix / 5) * 0.22;
        const ny = (iy / 5) * 0.30;
        // Gable-like silhouette
        if (ny > 0.08 && Math.abs(nx) > 0.22 * (1 - (ny - 0.08) / 0.24)) continue;
        sil.push([nx, ny]);
      }
    }

    let sumBase = 0;
    let sumOpt = 0;
    for (let gen = 1; gen <= 10; gen++) {
      const net = buildHouseNet(generateHouseSpec(gen));
      const basePose: SilhouetteCameraPose = {
        yaw: 0.44 + gen * 0.9,
        pitch: 0.68,
        roll: gen % 2 === 0 ? 0.28 : -0.32,
        dist: Math.max(31, net.sheetHalfMm * 0.28),
        lookX: 0,
        lookY: 1.2,
        lookZ: 0,
      };
      const fit = fitFlatNetToSilhouetteNDC(sil, net, basePose, {
        fovDeg: 28,
        aspect: 1.6,
        allowYawSearch: true,
      });
      sumBase += fit.baselineCoverage;
      sumOpt += fit.coverage;
      expect(fit.coverage).toBeGreaterThanOrEqual(fit.baselineCoverage - 0.02);
    }
    const meanBase = sumBase / 10;
    const meanOpt = sumOpt / 10;
    expect(meanOpt).toBeGreaterThan(meanBase + 0.10);
    expect(meanOpt).toBeGreaterThan(0.84);
  });

  it('leaves pose untouched when baseline already meets targetCoverage (75% accepted ratio)', () => {
    const sil: V2[] = [];
    for (let ix = -3; ix <= 3; ix++) {
      for (let iy = -3; iy <= 3; iy++) {
        sil.push([(ix / 3) * 0.12, (iy / 3) * 0.14]);
      }
    }
    const net = buildHouseNet(generateHouseSpec(1));
    const basePose: SilhouetteCameraPose = {
      yaw: 0.44,
      pitch: 0.82,
      roll: 0.15,
      dist: 31,
      lookX: 0,
      lookY: 1.2,
      lookZ: 0,
    };
    const fit = fitFlatNetToSilhouetteNDC(sil, net, basePose, {
      fovDeg: 28,
      aspect: 1.6,
      allowYawSearch: true,
      targetCoverage: 0.75,
    });
    expect(fit.baselineCoverage).toBeGreaterThanOrEqual(0.75);
    expect(fit.yaw).toBe(basePose.yaw);
    expect(fit.dist).toBe(basePose.dist);
    expect(fit.lookY).toBe(basePose.lookY);
  });
});
