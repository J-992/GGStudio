import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  CAMERA_FOV_DEG,
  layoutThreatStage,
  type StageSubjectSize,
} from '../src/survival/threatStageLayout.ts';
import { threatPreviewForWave } from '../src/survival/threatPreview.ts';

/** Aspects the stage element actually takes, from a wide desktop to a phone. */
const ASPECTS = [760 / 340, 760 / 240, 420 / 300, 340 / 220] as const;

/**
 * Project the eight corners of a subject's bounding box, at the worst yaw for
 * that corner, and report the widest normalised-device coordinate any of them
 * reaches. Anything past 1 is off the edge of the stage.
 */
function worstNdc(sizes: readonly StageSubjectSize[], aspect: number): number {
  const layout = layoutThreatStage(sizes, aspect);
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, aspect, 0.05, 400);
  camera.position.set(0, layout.cameraY, layout.cameraZ);
  camera.lookAt(0, layout.lookAtY, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const point = new THREE.Vector3();
  let worst = 0;
  sizes.forEach((size, index) => {
    // A turning body sweeps a cylinder, so the extreme it can reach on either
    // horizontal axis is its half-width in every direction at once.
    const reach = Math.max(0.4, size.widthM) / 2;
    for (const dx of [-reach, reach]) {
      for (const dz of [-reach, reach]) {
        for (const y of [0, size.heightM]) {
          point.set(layout.positionsX[index] + dx, y, dz);
          point.project(camera);
          worst = Math.max(worst, Math.abs(point.x), Math.abs(point.y));
        }
      }
    }
  });
  return worst;
}

describe('threat stage layout', () => {
  it('keeps a lone subject inside the frame at every stage size', () => {
    for (const aspect of ASPECTS) {
      // A behemoth is the tallest thing the stage ever holds.
      expect(worstNdc([{ heightM: 5, widthM: 2.4 }], aspect)).toBeLessThan(1);
      // A kamikaze is the smallest.
      expect(worstNdc([{ heightM: 1.5, widthM: 0.7 }], aspect)).toBeLessThan(1);
    }
  });

  it('keeps two subjects of wildly different size both in frame', () => {
    for (const aspect of ASPECTS) {
      const worst = worstNdc(
        [
          { heightM: 5, widthM: 2.4 },
          { heightM: 1.5, widthM: 0.7 },
        ],
        aspect,
      );
      expect(worst).toBeLessThan(1);
    }
  });

  it('frames every preview the wave roster can actually produce', () => {
    for (let wave = 1; wave <= 30; wave += 1) {
      const preview = threatPreviewForWave(wave);
      if (preview === null) continue;
      // Real posed widths are measured at runtime; a body roughly half as wide
      // as it is tall is the widest any of these models comes out.
      const sizes = preview.subjects.map((subject) => ({
        heightM: subject.heightM,
        widthM: subject.heightM * 0.55,
      }));
      for (const aspect of ASPECTS) {
        expect(worstNdc(sizes, aspect)).toBeLessThan(1);
      }
    }
  });

  it('actually fills the frame rather than parking everything in the distance', () => {
    // The counterpart to the clipping check: a camera far enough away is
    // trivially safe and shows the player a speck.
    for (const aspect of ASPECTS) {
      expect(worstNdc([{ heightM: 5, widthM: 2.4 }], aspect)).toBeGreaterThan(
        0.55,
      );
    }
  });

  it('stands subjects in the given order, centred on the stage', () => {
    const layout = layoutThreatStage(
      [
        { heightM: 3, widthM: 1 },
        { heightM: 2, widthM: 1 },
      ],
      3.5,
    );
    expect(layout.positionsX[0]).toBeLessThan(layout.positionsX[1]);
    expect(layout.positionsX[0] + layout.positionsX[1]).toBeCloseTo(0, 6);
  });

  it('survives an empty stage', () => {
    const layout = layoutThreatStage([], 3.5);
    expect(layout.positionsX).toEqual([]);
    expect(layout.cameraZ).toBeGreaterThan(0);
  });
});
