import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Landmines } from '../src/survival/zombies/Landmines.ts';
import { LANDMINE_ARM_SECONDS } from '../src/survival/zombies/zombieConfig.ts';

describe('Landmines', () => {
  it('arms for exactly the configured window and cannot detonate during it', () => {
    const mines = new Landmines(new THREE.Scene());
    let detonations = 0;

    mines.plant(0, 0);
    mines.update(LANDMINE_ARM_SECONDS - 0.01, () => {
      detonations++;
      return true;
    });

    expect(mines.activeMines()).toHaveLength(1);
    expect(mines.activeMines()[0]?.state).toBe('arming');
    expect(detonations).toBe(0);

    mines.update(0.01, () => false);
    expect(mines.activeMines()[0]?.state).toBe('armed');

    mines.dispose();
  });

  it('detonates on contact after arming', () => {
    const mines = new Landmines(new THREE.Scene());

    mines.plant(0, 0);
    mines.update(LANDMINE_ARM_SECONDS, () => false);
    mines.update(1 / 60, () => true);

    expect(mines.activeMines()).toHaveLength(0);
    mines.dispose();
  });

  it('draws every mine, however far from the vehicle and whatever the wave', () => {
    // The whole rule, in one test: there is no reveal radius, no wave window and
    // no Mine Sweeper level that can leave an armed mine unpainted. A mine 200m
    // out on wave 40 is still drawn.
    const scene = new THREE.Scene();
    const mines = new Landmines(scene);

    mines.plant(200, 0);
    mines.update(LANDMINE_ARM_SECONDS, () => false);

    expect(mines.activeMines()[0]?.state).toBe('armed');
    expect(scene.children[0]?.visible).toBe(true);
    mines.dispose();
  });

  it('draws a mine during its arming window too', () => {
    const scene = new THREE.Scene();
    const mines = new Landmines(scene);

    mines.plant(60, 0);
    mines.update(LANDMINE_ARM_SECONDS / 2, () => false);

    expect(mines.activeMines()[0]?.state).toBe('arming');
    expect(scene.children[0]?.visible).toBe(true);
    mines.dispose();
  });

  it('hides the mesh again once the mine detonates', () => {
    const scene = new THREE.Scene();
    const mines = new Landmines(scene);

    mines.plant(4, 0);
    mines.update(LANDMINE_ARM_SECONDS, () => false);
    mines.update(1 / 60, () => true);

    expect(mines.activeMines()).toHaveLength(0);
    expect(scene.children[0]?.visible).toBe(false);
    mines.dispose();
  });
});
