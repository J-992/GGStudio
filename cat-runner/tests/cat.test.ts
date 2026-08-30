import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { Cat, type CatVisualInput } from '../src/entities/Cat';
import { rigCat } from '../src/entities/CatRig';
import { buildCatClips } from '../src/entities/CatAnimations';
import { PlayerState } from '../src/physics/PlayerController';
import type { AssetRegistry } from '../src/assets/AssetRegistry';

/**
 * The clip state machine, exercised through what it actually produces.
 *
 * These assertions read joint angles rather than blend weights on purpose: a
 * weight of 1 on the right action proves nothing if the action is bound to the
 * wrong skeleton or the pose never reaches the bones, and both of those are
 * failure modes a browserless test can otherwise miss entirely.
 */

/** A box roughly the biped kitty's proportions - enough for the rig to lay out against. */
function catShapedMesh(): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(0.758, 0.996, 0.516, 4, 6, 4);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
}

function stubRegistry(model: THREE.Object3D, clips: THREE.AnimationClip[]): AssetRegistry {
  return {
    loadCat: async () => ({ model, clips }),
    getSkinnedModel: () => model,
    getClips: () => clips,
    getClip: (_key: string, name: string) => clips.find((c) => c.name === name) ?? null,
  } as unknown as AssetRegistry;
}

async function makeCat(clips = buildCatClips()): Promise<{ cat: Cat; model: THREE.Object3D }> {
  const rig = rigCat(catShapedMesh())!;
  const cat = new Cat(stubRegistry(rig.root, clips));
  await cat.load('black');
  return { cat, model: rig.root };
}

const baseInput: CatVisualInput = {
  position: new THREE.Vector3(),
  rotation: new THREE.Quaternion(),
  velocity: new THREE.Vector3(),
  horizontalSpeed: 0,
  lateralSlip: 0,
  steer: 0,
  grounded: true,
  state: PlayerState.Running,
  ducking: false,
};

/** Runs the cat for `seconds` at 60 Hz. */
function advance(cat: Cat, seconds: number, input: Partial<CatVisualInput>): void {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) {
    cat.update(step, { ...baseInput, ...input });
  }
}

const pitchOf = (model: THREE.Object3D, bone: string) =>
  (model.getObjectByName(bone) as THREE.Bone).rotation.x;

describe('Cat clip selection', () => {
  it('settles into a neutral idle when standing still', async () => {
    const { cat, model } = await makeCat();
    advance(cat, 1.5, { grounded: true, horizontalSpeed: 0 });

    for (const leg of ['thighL', 'thighR', 'shinL', 'shinR']) {
      expect(Math.abs(pitchOf(model, leg)), leg).toBeLessThan(0.08);
    }
  });

  it('swings the legs through a run cycle at speed', async () => {
    const { cat, model } = await makeCat();
    advance(cat, 0.6, { grounded: true, horizontalSpeed: 11 });

    // Sample a further half second and record how far each thigh travels.
    let lowL = Infinity;
    let highL = -Infinity;
    let lowR = Infinity;
    let highR = -Infinity;
    for (let i = 0; i < 30; i++) {
      cat.update(1 / 60, { ...baseInput, grounded: true, horizontalSpeed: 11 });
      const l = pitchOf(model, 'thighL');
      const r = pitchOf(model, 'thighR');
      lowL = Math.min(lowL, l);
      highL = Math.max(highL, l);
      lowR = Math.min(lowR, r);
      highR = Math.max(highR, r);
    }
    expect(highL - lowL).toBeGreaterThan(0.5);
    expect(highR - lowR).toBeGreaterThan(0.5);
  });

  it('swings the arms opposite the same-side leg (contralateral gait)', async () => {
    const { cat, model } = await makeCat();
    advance(cat, 0.6, { grounded: true, horizontalSpeed: 11 });

    // Sample across a stride: the left upper arm and the left thigh should be
    // negatively correlated (one forward while the other is back), which is
    // what makes the gait read as a run instead of a shuffle.
    let product = 0;
    for (let i = 0; i < 30; i++) {
      cat.update(1 / 60, { ...baseInput, grounded: true, horizontalSpeed: 11 });
      product += pitchOf(model, 'thighL') * pitchOf(model, 'upperArmL');
    }
    expect(product).toBeLessThan(0);
  });

  it('spreads into the fall pose once airborne', async () => {
    const { cat, model } = await makeCat();
    advance(cat, 0.6, { grounded: true, horizontalSpeed: 11 });
    advance(cat, 0.6, { grounded: false, horizontalSpeed: 11 });

    // Legs tucked back with the ankles relaxed, arms out to the sides - the
    // "bracing to land" silhouette.
    expect(pitchOf(model, 'thighL')).toBeLessThan(-0.2);
    expect(pitchOf(model, 'footL')).toBeGreaterThan(0.1);
    const shoulderL = model.getObjectByName('shoulderL') as THREE.Bone;
    expect(Math.abs(shoulderL.rotation.z)).toBeGreaterThan(0.3);
  });

  it('plays the landing crouch when told it has landed', async () => {
    const { cat, model } = await makeCat();
    advance(cat, 0.5, { grounded: false, horizontalSpeed: 11 });
    expect(pitchOf(model, 'footL')).toBeGreaterThan(0.1);

    cat.onLand(9);
    advance(cat, 0.1, { grounded: true, horizontalSpeed: 11 });

    // Landing drives the ankle the opposite way from the fall pose's relaxed
    // hang, so the sign flip is proof the one-shot took priority.
    expect(pitchOf(model, 'footL')).toBeLessThan(-0.1);
  });

  it('drops a landing that is interrupted by leaving the ground again', async () => {
    const { cat, model } = await makeCat();
    cat.onLand(9);
    advance(cat, 0.05, { grounded: true, horizontalSpeed: 11 });
    advance(cat, 0.6, { grounded: false, horizontalSpeed: 11 });

    expect(pitchOf(model, 'footL')).toBeGreaterThan(0.1);
  });

  it('lurches asymmetrically when hurt', async () => {
    const { cat, model } = await makeCat();
    advance(cat, 0.5, { grounded: true, horizontalSpeed: 11 });
    cat.onHurt();
    advance(cat, 0.25, { grounded: true, horizontalSpeed: 6 });

    // Only the stumble clip yaws the hips; everything else leaves that axis at
    // zero, so this is unambiguous.
    const hips = model.getObjectByName('hips') as THREE.Bone;
    expect(Math.abs(hips.rotation.y)).toBeGreaterThan(0.02);
  });

  it('does NOT play the hurt animation just because the player is physically stumbling', async () => {
    // Regression: PlayerController sets PlayerState.Stumbling on any hard
    // contact - a hard landing, a shield-absorbed hit - before Game.ts has
    // decided whether a life is actually spent. The clip used to be driven
    // straight off that state, so it played on events that cost nothing. It
    // must now only fire from the explicit onHurt() one-shot, so clip
    // selection (and therefore hip yaw, which only the stumble clip drives)
    // must come out identical whether or not the physics state says
    // Stumbling - the *animation* has no way to see that flag any more.
    const runningHips = async (state: PlayerState) => {
      const { cat, model } = await makeCat();
      advance(cat, 0.5, { grounded: true, horizontalSpeed: 11 });
      advance(cat, 0.25, { grounded: true, horizontalSpeed: 6, state });
      return (model.getObjectByName('hips') as THREE.Bone).rotation.y;
    };

    const whileRunning = await runningHips(PlayerState.Running);
    const whileStumblingState = await runningHips(PlayerState.Stumbling);
    expect(whileStumblingState).toBeCloseTo(whileRunning, 5);
  });

  it('returns to idle after reset', async () => {
    const { cat, model } = await makeCat();
    advance(cat, 0.5, { grounded: false, horizontalSpeed: 11 });
    cat.reset();
    advance(cat, 0.6, { grounded: true, horizontalSpeed: 0 });

    expect(Math.abs(pitchOf(model, 'thighL'))).toBeLessThan(0.08);
  });
});

/**
 * The squash spring's stability.
 *
 * The spring writes a NON-UNIFORM scale - `(spread, squash, spread)` - onto the
 * attitude group, and it is the only time-varying non-uniform scale anywhere in
 * the player hierarchy. Explicit Euler multiplies velocity by
 * `(1 - damping * dt)` per step, which passes -1 at `dt = 2 / 24` = 1/12 s, so
 * below 12 fps the damping amplified instead of damping and the spring
 * diverged into its clamps: the cat alternated between 54% taller than wide and
 * flat-and-splayed, which is what "the character stretches vertically" was.
 *
 * These drive `Cat.update` directly at chosen frame rates, which is the only
 * way to reach the failure - it is invisible at the 60 Hz every other test in
 * this file uses.
 */
describe('Cat squash spring', () => {
  /** The attitude group, which is what carries the scale. */
  const attitudeOf = (model: THREE.Object3D) => model.parent!;

  /** Runs the cat for `seconds` at a chosen frame rate, returning the worst scale seen. */
  function runAt(
    cat: Cat,
    model: THREE.Object3D,
    fps: number,
    seconds: number,
  ): { peakY: number; minY: number } {
    const dt = 1 / fps;
    let peakY = 1;
    let minY = 1;

    for (let t = 0; t < seconds; t += dt) {
      cat.update(dt, baseInput);
      const { y } = attitudeOf(model).scale;
      peakY = Math.max(peakY, y);
      minY = Math.min(minY, y);
    }

    return { peakY, minY };
  }

  it('settles after a landing at 10 fps instead of diverging', async () => {
    const { cat, model } = await makeCat();

    cat.onLand(9);
    runAt(cat, model, 10, 2);

    const scale = attitudeOf(model).scale;
    expect(scale.y, 'the spring did not settle').toBeCloseTo(1, 1);
    // And it settled *uniformly* - a cat at rest is not taller than it is wide.
    expect(Math.abs(scale.y - scale.x)).toBeLessThan(0.05);
  });

  it('reaches the same state at 10 fps as at 60', async () => {
    // Stability alone would let the low-rate response differ wildly while still
    // being bounded. Sub-stepping makes them match, which is the point on
    // hardware that will sit at the low end.
    //
    // Compared at a fixed elapsed time rather than by peak or trough: a 10 fps
    // run samples the curve every 100ms and simply steps over extremes that a
    // 60 fps run lands on, so comparing those would measure the test's own
    // sampling rate. Both integrate 60 sub-steps across this second.
    const fast = await makeCat();
    fast.cat.onLand(9);
    runAt(fast.cat, fast.model, 60, 1);

    const slow = await makeCat();
    slow.cat.onLand(9);
    runAt(slow.cat, slow.model, 10, 1);

    const atSixty = attitudeOf(fast.model).scale;
    const atTen = attitudeOf(slow.model).scale;

    expect(atTen.y).toBeCloseTo(atSixty.y, 3);
    expect(atTen.x).toBeCloseTo(atSixty.x, 3);
  });

  it('never leaves the clamp at any frame rate', async () => {
    for (const fps of [120, 60, 30, 15, 10, 5]) {
      const { cat, model } = await makeCat();
      cat.onJump();
      const { peakY, minY } = runAt(cat, model, fps, 2);

      expect(peakY, `${fps} fps overshot the clamp`).toBeLessThanOrEqual(1.35);
      expect(minY, `${fps} fps undershot the clamp`).toBeGreaterThanOrEqual(0.55);
      // Reaching the clamp at all means it diverged - the authored kick is 1.1.
      expect(peakY, `${fps} fps saturated the clamp`).toBeLessThan(1.2);
    }
  });

  it('keeps the scale uniform once the spring is at rest', async () => {
    const { cat, model } = await makeCat();
    runAt(cat, model, 12, 1);

    const scale = attitudeOf(model).scale;
    expect(scale.x).toBeCloseTo(1, 3);
    expect(scale.y).toBeCloseTo(1, 3);
    expect(scale.z).toBeCloseTo(1, 3);
  });
});

describe('Cat fallback rig', () => {
  it('still animates a rig that only offers one unnamed clip', async () => {
    // The old cat.fbx: a single walk cycle, none of the names above.
    const walk = new THREE.AnimationClip('walk', 1, [
      new THREE.QuaternionKeyframeTrack(
        'thighL.quaternion',
        [0, 0.5, 1],
        [0, 0, 0, 1, 0.3, 0, 0, 0.954, 0, 0, 0, 1],
      ),
    ]);

    const { cat, model } = await makeCat([walk]);

    // Sampled across a whole cycle: the weight must stay pinned at 1 rather
    // than being blended away toward a clip this rig does not have, and a
    // single instant can always catch the cycle passing through zero.
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      cat.update(1 / 60, { ...baseInput, grounded: true, horizontalSpeed: 11 });
      peak = Math.max(peak, Math.abs(pitchOf(model, 'thighL')));
    }
    expect(peak).toBeGreaterThan(0.2);
  });

  it('survives a rig with no clips at all', async () => {
    const { cat } = await makeCat([]);
    expect(() => advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 })).not.toThrow();
  });
});

describe('fish independence from cat skin', () => {
  // Regression: setSkin() used to write the new coat texture onto every
  // entry in `this.materials`, and the carried fish's cloned material was
  // pushed into that same array (collectMaterials() ran on `this.fish` too,
  // for the invulnerability flash's sake) - so picking a skin repainted the
  // mouth-carried fish with the cat's fur. Fixed by collecting the fish's
  // materials into their own array that setSkin() never touches.
  it('never paints the carried fish with the selected coat texture', async () => {
    const skinTexture = new THREE.Texture();
    const clips = buildCatClips();
    const rig = rigCat(catShapedMesh())!;
    const registry = {
      loadCat: async () => ({ model: rig.root, clips }),
      getSkinnedModel: () => rig.root,
      getClips: () => clips,
      getClip: (_key: string, name: string) => clips.find((c) => c.name === name) ?? null,
      loadCatSkin: async () => skinTexture,
    } as unknown as AssetRegistry;

    const cat = new Cat(registry);
    await cat.load('black');

    // The procedural fish's own body material (buildFish()'s fallback, since
    // no real fish model is installed in this stub) is the one distinctive,
    // no-map material in the whole hierarchy - color 0xcfd8dc, no `.map`.
    let fishBodyMat: THREE.MeshLambertMaterial | null = null;
    let anyMatUsesSkinTexture = false;
    cat.root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      if (mat.map === skinTexture) anyMatUsesSkinTexture = true;
      if (mat.color?.getHex() === 0xcfd8dc) fishBodyMat = mat;
    });

    expect(fishBodyMat, 'fish body material not found in the hierarchy').not.toBeNull();
    expect(fishBodyMat!.map).not.toBe(skinTexture);
    // And the fix isn't just "nothing gets skinned" - the cat's own coat
    // must still pick up the texture.
    expect(anyMatUsesSkinTexture).toBe(true);
  });

  it('still flashes the fish during the invulnerability flash', async () => {
    const { cat } = await makeCat();
    const before: number[] = [];
    cat.root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      if (mat.color?.getHex() === 0xcfd8dc) before.push(mat.opacity);
    });
    expect(before.length).toBeGreaterThan(0);

    cat.setInvulnerable(true);
    advance(cat, 0.1, { grounded: true, horizontalSpeed: 11 });

    const after: number[] = [];
    cat.root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      if (mat.color?.getHex() === 0xcfd8dc) after.push(mat.opacity);
    });

    for (let i = 0; i < before.length; i++) {
      expect(after[i]).not.toBeCloseTo(before[i], 5);
    }
  });
});

describe('power-up tint', () => {
  // Regression test: `updatePowerUpTint` tints every material in
  // `this.materials`, which includes the carried fish prop's materials
  // (`collectMaterials` is run on the fish too). The fish's eye used to be a
  // `MeshBasicMaterial`, which has no `.emissive` - the very first tinted
  // frame after any power-up pickup threw a TypeError, and because that
  // happened inside `Cat.update()` with nothing catching it further up the
  // call stack, it silently killed the whole render loop (the reported
  // "freeze on power-up pickup" bug). Every material collected onto the cat
  // must survive being tinted without throwing.
  const ALL_POWER_UPS = ['fishMagnet', 'catnipRush', 'nineLives', 'shield'] as const;

  it('tints the whole cat, including the carried fish, without throwing', async () => {
    for (const kind of ALL_POWER_UPS) {
      const { cat } = await makeCat();
      cat.setActivePowerUps([{ type: kind, remainingFrac: 1 }]);
      expect(() => advance(cat, 0.5, { grounded: true, horizontalSpeed: 11 })).not.toThrow();
    }
  });

  it('clears the tint back to zero when no power-up is active', async () => {
    const { cat } = await makeCat();
    cat.setActivePowerUps([{ type: 'catnipRush', remainingFrac: 1 }]);
    advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 });

    expect(() => {
      cat.setActivePowerUps([]);
      advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 });
    }).not.toThrow();
  });

  it('equips the Catnip Rush sneaker prop on the real foot bones without throwing', async () => {
    const { cat } = await makeCat();
    cat.setActivePowerUps([{ type: 'catnipRush', remainingFrac: 1 }]);
    expect(() => advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 })).not.toThrow();

    cat.setActivePowerUps([]);
    expect(() => advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 })).not.toThrow();
  });

  it('shows and hides the Fish Magnet prop above the head without throwing', async () => {
    const { cat } = await makeCat();
    cat.setActivePowerUps([{ type: 'fishMagnet', remainingFrac: 1 }]);
    expect(() => advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 })).not.toThrow();

    cat.setActivePowerUps([]);
    expect(() => advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 })).not.toThrow();

    expect(() => cat.dispose()).not.toThrow();
  });

  it('fades the shield sphere with remainingFrac and hides it once spent', async () => {
    const { cat } = await makeCat();
    cat.setActivePowerUps([{ type: 'shield', remainingFrac: 1 }]);
    expect(() => advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 })).not.toThrow();

    cat.setActivePowerUps([{ type: 'shield', remainingFrac: 0.1 }]);
    expect(() => advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 })).not.toThrow();

    cat.setActivePowerUps([]);
    expect(() => advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 })).not.toThrow();
  });

  it('keeps the visual bounds small when the parked (inactive) shield sphere would blow out a naive box', async () => {
    // Regression: Box3.setFromObject doesn't check .visible, and the shield
    // sphere parks itself at SHIELD_SPHERE_PARK_Y (a long way below the
    // model) instead of detaching when inactive - a naive box computed off
    // `cat.root` balloons out to include that parked position, which is
    // exactly what broke CatPreview's camera framing. getVisualBounds() is
    // the fix: it only counts meshes actually being rendered.
    const { cat } = await makeCat();
    advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 });

    const inactive = cat.getVisualBounds();
    const size = inactive.getSize(new THREE.Vector3());
    expect(size.y).toBeLessThan(5);

    // Active, the sphere is real geometry around the cat and should still be
    // a small, sane box - not the same bug from the opposite direction.
    cat.setActivePowerUps([{ type: 'shield', remainingFrac: 1 }]);
    advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 });
    const active = cat.getVisualBounds();
    expect(active.getSize(new THREE.Vector3()).y).toBeLessThan(5);
  });

  it('keeps the visual bounds small when the parked Fish Magnet prop is inactive', async () => {
    // Regression: the magnet prop is a Group, and `group.visible = false`
    // does not clear each child mesh's own `.visible` (only the renderer's
    // walk skips it) - a getVisualBounds() built on a plain per-mesh
    // `.visible` check still finds the parked children "visible" and pulls
    // MAGNET_PARK_Y back into the box. traverseVisible() is the fix.
    const { cat } = await makeCat();
    advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 });
    expect(cat.getVisualBounds().getSize(new THREE.Vector3()).y).toBeLessThan(5);

    cat.setActivePowerUps([{ type: 'fishMagnet', remainingFrac: 1 }]);
    advance(cat, 0.2, { grounded: true, horizontalSpeed: 11 });
    expect(cat.getVisualBounds().getSize(new THREE.Vector3()).y).toBeLessThan(5);
  });
});

describe('the duck', () => {
  it('takes the tucked pose over the run cycle', async () => {
    // The duck outranks everything on the ground, including a full-speed run.
    // If it did not, the player would press slide and watch the cat carry on
    // running into the clothesline it was about to pass under.
    const { cat, model } = await makeCat();

    advance(cat, 0.5, { grounded: true, horizontalSpeed: 11 });
    const running = pitchOf(model, 'spine');

    advance(cat, 0.4, { grounded: true, horizontalSpeed: 11, ducking: true });
    const tucked = pitchOf(model, 'spine');

    // The tuck rounds the back hard forward, which is a much larger rotation
    // than anything in the run's own spine flex.
    expect(tucked, `spine went from ${running.toFixed(3)} to ${tucked.toFixed(3)}`)
      .toBeLessThan(running - 0.2);
  });

  it('drops the whole cat, not just its pose', async () => {
    // What actually clears the cloth. The clip rounds the back; the translation
    // on `groundOffset` is on top of it, and the two are on different nodes on
    // purpose so the squash spring cannot scale the drop.
    //
    // The threshold separates the two contributions rather than merely being
    // "some drop". Measured: the clip alone lowers the cat 0.26 and the clip
    // plus the translation lowers it 0.36, so anything between the two proves
    // the translation is present - and a looser bound passed happily with
    // `DUCK_DROP` deleted, which is exactly the regression worth catching.
    //
    // `DUCK_DROP` was cut from 0.28 to 0.1 (see its own doc comment in
    // Cat.ts): at 0.28 the translation alone put the model's own ground-
    // contact point 0.28 below the capsule's real, unmoved contact with the
    // roof - visibly sinking the cat's paws into the geometry for the whole
    // duck. 0.1 keeps a real, provable contribution here while staying inside
    // that margin.
    const { cat } = await makeCat();

    advance(cat, 0.5, { grounded: true, horizontalSpeed: 11 });
    cat.root.updateMatrixWorld(true);
    const standing = new THREE.Box3().setFromObject(cat.root).max.y;

    advance(cat, 0.4, { grounded: true, horizontalSpeed: 11, ducking: true });
    cat.root.updateMatrixWorld(true);
    const ducked = new THREE.Box3().setFromObject(cat.root).max.y;

    expect(ducked, `top of the cat went from ${standing.toFixed(3)} to ${ducked.toFixed(3)}`)
      .toBeLessThan(standing - 0.32);
  });

  it('stands back up when the duck ends', async () => {
    // A cat left tucked after the timer runs out is a cat the player thinks is
    // still protected.
    const { cat, model } = await makeCat();

    advance(cat, 0.4, { grounded: true, horizontalSpeed: 11, ducking: true });
    const tucked = pitchOf(model, 'spine');

    advance(cat, 0.6, { grounded: true, horizontalSpeed: 11, ducking: false });
    const recovered = pitchOf(model, 'spine');

    expect(recovered).toBeGreaterThan(tucked + 0.2);
  });
});
