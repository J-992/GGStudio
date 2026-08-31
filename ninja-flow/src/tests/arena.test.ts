import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial, Scene } from 'three';
import { bridgeHeightAt } from '../game/Arena';
import { Arena } from '../game/Arena';

describe('bridge combat floor', () => {
  it('places the fighter at the crest and sends both lanes uphill symmetrically', () => {
    expect(bridgeHeightAt(0)).toBeCloseTo(0);
    expect(bridgeHeightAt(-4)).toBeCloseTo(bridgeHeightAt(4));
    expect(bridgeHeightAt(4)).toBeLessThan(bridgeHeightAt(2));
    expect(bridgeHeightAt(8)).toBeLessThan(bridgeHeightAt(4));
  });

  it('clamps the floor beyond the ends of the bridge', () => {
    expect(bridgeHeightAt(20)).toBeCloseTo(bridgeHeightAt(8));
  });

  it('activates rain and lightning for their weather phases', () => {
    const arena = new Arena(new Scene());
    const effects = arena as unknown as {
      rainLines: { visible: boolean };
      rainMaterial: { opacity: number };
      stormLight: { intensity: number };
    };

    arena.setWeather('rain');
    arena.update(3);
    expect(effects.rainLines.visible).toBe(true);
    expect(effects.rainMaterial.opacity).toBeGreaterThan(0.4);

    arena.setWeather('thunder');
    arena.update(0.25);
    expect(effects.stormLight.intensity).toBeGreaterThan(0);
  });

  it('uses the authored red tree-leaf colour for every falling petal', () => {
    const arena = new Arena(new Scene());
    const effects = arena as unknown as {
      petalMesh: { material: MeshBasicMaterial; instanceColor: unknown };
    };

    expect(effects.petalMesh.material.color.getHexString()).toBe('e75650');
    expect(effects.petalMesh.instanceColor).toBeNull();
  });

  it('can skip ambient buffer uploads on constrained frames', () => {
    const arena = new Arena(new Scene());
    const effects = arena as unknown as {
      petalMesh: { instanceMatrix: { version: number } };
    };
    const before = effects.petalMesh.instanceMatrix.version;

    arena.update(1 / 60, 0);
    expect(effects.petalMesh.instanceMatrix.version).toBe(before);

    arena.update(1 / 60, 1 / 30);
    expect(effects.petalMesh.instanceMatrix.version).toBeGreaterThan(before);
  });
});
