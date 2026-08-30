import * as THREE from 'three';
import type { LightingDef } from '../levels/LevelTypes';

/**
 * Sun + moon + stars + ambient fill + fog + sky colour, shared by the
 * procedural endless track (`ChunkBuilder`) - the only caller now that the
 * campaign has been retired.
 *
 * `updateTimeOfDay` can drive a full day/night cycle (see its own doc
 * comment, and `tests/lighting.test.ts`), but `ChunkBuilder` deliberately
 * never calls it: the endless track asked to remove the cycle entirely in
 * favour of consistent, bright, warm daytime lighting throughout a run, and
 * the state `buildLighting()` constructs everything into already *is* that
 * (full sun at the authored colour/intensity, day sky/fog, moon and stars
 * hidden) - simply never advancing the cycle is what "no day/night cycle"
 * looks like here, not a second code path. The capability is kept, not
 * deleted, so a future mode that does want the cycle doesn't have to
 * reinvent it.
 *
 * -------------------------------------------------------------------------
 * STATIC LIGHTING
 * -------------------------------------------------------------------------
 * Not advancing the cycle was never the whole story, though, and a report of
 * "active lighting" on a track with no day/night cycle running is what
 * surfaced the rest of it. The sun cast a real-time shadow map, and a
 * directional light's shadow camera covers a *finite* box - `SHADOW_HALF_EXTENT`
 * (32 units) either side of a centre that `updateFocus` therefore had to drag
 * along behind the runner, every single frame, forever. Two things followed
 * from that, both visible:
 *
 *  - Geometry crossed in and out of the frustum as it slid, so a shadow
 *    appeared, firmed up, and vanished purely as a function of how far the
 *    runner had travelled - nothing in the scene had changed.
 *  - The centre was snapped to the shadow map's texel grid to stop shadow
 *    edges resampling continuously. That helps, but it quantises: the whole
 *    shadow field steps by a texel at a time rather than sliding, which at
 *    `runSpeed` reads as a low-frequency crawl across every roof.
 *
 * So the sun no longer casts (`castShadow = false`), and it is parked once at
 * build time instead of being repositioned per frame. Illumination is
 * unaffected by the parking - a directional light shades from its *direction*,
 * which is now a constant for the entire route - and the scene is lit by the
 * sun plus the hemisphere fill exactly as before, minus the moving shadows.
 *
 * The trade this makes, stated plainly because it is a real one: dynamic
 * shadows are gone, including the runner's own. Nothing else in the scene was
 * relying on them (the skyline and gap facades already set
 * `castShadow = false`, see `Buildings.ts`), but the cat's contact shadow was
 * a grounding cue during jumps. Re-enabling is the one `castShadow` line above
 * plus restoring this file's `updateFocus` sun block; a cheaper middle ground,
 * if grounding is wanted back without the crawl, is a blob shadow parented to
 * the cat rather than a re-centred shadow map.
 */

/**
 * Half-width of the sun's shadow frustum, in world units.
 *
 * Sized to what the follow camera can actually see, and re-centred on the
 * runner every frame by {@link LightingHandle.updateFocus} rather than
 * pinned to the world origin, or a long run would eventually leave the
 * runner outside the shadow camera's frustum entirely.
 */
export const SHADOW_HALF_EXTENT = 32;
/** Shadow map resolution. Paired with the extent above to fix texel size. */
export const SHADOW_MAP_SIZE = 1024;

/** How far out the visible moon disc and star field sit - comfortably
 *  inside the follow camera's far plane (400) and the fog's far distance
 *  isn't a concern since both get `fog: false` materials (sky elements
 *  read as infinitely distant, not fogged like nearby geometry). */
const SKY_DOME_RADIUS = 300;
const MOON_VISUAL_RADIUS = 9;
const STAR_COUNT = 500;

/** Warm horizon tone the sun's colour dips toward near sunrise/sunset. */
const SUNSET_COLOR = new THREE.Color(0xff8a3d);
/** Cool white-blue the moon light and disc are lit with. */
const MOON_COLOR = new THREE.Color(0xaebeff);
const MOON_MAX_INTENSITY = 0.55;

/** Night sky/fog palette, cross-faded against the authored (day) palette. */
const NIGHT_SKY_COLOR = new THREE.Color(0x060a1a);
const NIGHT_FOG_COLOR = new THREE.Color(0x0a1024);

export interface LightingHandle {
  readonly sun: THREE.DirectionalLight;
  /** Re-centres the shadow frustum, moon disc and star field on the runner. */
  updateFocus(target: THREE.Vector3): void;
  /** Advances the day/night cycle. `t` is 0..1 and loops - 0 is sunrise,
   *  0.25 is midday, 0.5 is sunset, 0.75 is midnight. */
  updateTimeOfDay(t: number): void;
  /** Removes and disposes every light/mesh, and clears the scene's sky/fog. */
  dispose(): void;
}

const _focus = new THREE.Vector3();
const _moonDir = new THREE.Vector3();

function randomOnSphere(radius: number, out: THREE.Vector3): THREE.Vector3 {
  // Uniform-on-sphere via rejection would be pedantic for a decorative
  // starfield - a normalized Gaussian-ish spread from uniform components is
  // close enough that no clustering reads at a glance.
  out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
  if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
  return out.normalize().multiplyScalar(radius);
}

function buildStarField(radius: number, count: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    randomOnSphere(radius, p);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = Math.abs(p.y) * 0.6 + radius * 0.15; // bias upward - stars, not a full sphere of ground clutter
    positions[i * 3 + 2] = p.z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.6,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.visible = false;
  return points;
}

/**
 * Builds sun + moon + stars + hemisphere into `parent`, and sets
 * `scene.background`/`scene.fog` directly (those two are scene-level, not
 * parentable). `parent` is disposed by the caller removing it from the
 * scene graph as usual; this only owns the lights/meshes themselves plus
 * resetting the two scene properties on `dispose()`.
 */
export function buildLighting(
  scene: THREE.Scene,
  parent: THREE.Object3D,
  def: LightingDef,
  /** Defaults to the full-quality size; callers pass a smaller value under a
   *  lower `graphicsQuality` tier (see `Game.shadowMapSizeForQuality()`). */
  shadowMapSize: number = SHADOW_MAP_SIZE,
): LightingHandle {
  const daySkyColor = new THREE.Color(def.skyColor);
  const dayFogColor = new THREE.Color(def.fogColor);
  const daySunColor = new THREE.Color(def.sunColor);

  scene.background = daySkyColor.clone();
  scene.fog = new THREE.Fog(dayFogColor.getHex(), def.fogNear, def.fogFar);

  const sun = new THREE.DirectionalLight(def.sunColor, def.sunIntensity);
  // STATIC LIGHTING - see this module's doc comment. The shadow camera is
  // still configured (so re-enabling `castShadow` is a one-line change, and so
  // `shadowMapSize` still means something to callers), but the sun does not
  // cast: a shadow map is the only part of this rig that was ever dynamic, and
  // it is what "the lighting is active" was describing.
  sun.castShadow = false;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.camera.left = -SHADOW_HALF_EXTENT;
  sun.shadow.camera.right = SHADOW_HALF_EXTENT;
  sun.shadow.camera.top = SHADOW_HALF_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_HALF_EXTENT;
  sun.shadow.bias = -0.0012;
  parent.add(sun);
  parent.add(sun.target);

  // Dimmer, no shadow map of its own - the task's own mobile-cost note is
  // explicit that a second shadow caster isn't worth it for a light that's
  // only ever on at night, softly lighting a scene the player is moving
  // through quickly.
  const moon = new THREE.DirectionalLight(MOON_COLOR.getHex(), 0);
  moon.castShadow = false;
  parent.add(moon);
  parent.add(moon.target);

  const hemi = new THREE.HemisphereLight(def.ambientSky, def.ambientGround, def.ambientIntensity);
  parent.add(hemi);

  const accentLights: THREE.PointLight[] = [];
  for (const accent of def.accents ?? []) {
    const point = new THREE.PointLight(accent.color, accent.intensity, accent.distance, 2);
    point.position.fromArray(accent.position);
    parent.add(point);
    accentLights.push(point);
  }

  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_VISUAL_RADIUS, 16, 12),
    new THREE.MeshBasicMaterial({ color: MOON_COLOR, transparent: true, opacity: 0, fog: false }),
  );
  moonMesh.visible = false;
  parent.add(moonMesh);

  const stars = buildStarField(SKY_DOME_RADIUS * 0.95, STAR_COUNT);
  parent.add(stars);

  // The authored `sunPosition` is really a direction: the light is
  // directional, so only the offset from its target matters. Its length
  // becomes the arc's radius and its horizontal (XZ) bearing becomes the
  // fixed plane the sun/moon swing through - `updateTimeOfDay` only ever
  // varies how far around that one arc the time-of-day has gone, so the
  // scene keeps being lit from the same authored general direction it
  // always was, just animated through a full day rather than pinned at
  // one moment of it.
  const authoredSun = new THREE.Vector3().fromArray(def.sunPosition);
  const sunRadius = authoredSun.length();
  const sunHorizontalDir =
    Math.abs(authoredSun.x) + Math.abs(authoredSun.z) > 1e-6
      ? new THREE.Vector3(authoredSun.x, 0, authoredSun.z).normalize()
      : new THREE.Vector3(1, 0, 0);

  const sunOffset = authoredSun.clone();
  const moonOffset = authoredSun.clone().negate();

  // Placed once, here, and never touched again. Only the sun -> target
  // direction affects a directional light's shading, so one fixed placement
  // lights the entire endless route uniformly and permanently.
  sun.position.copy(sunOffset);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();

  return {
    sun,
    updateFocus(target: THREE.Vector3): void {
      // The sun is deliberately NOT moved here any more - it is a static
      // light, and this is the method that used to make it not one. It had to
      // chase the runner because a directional light's *shadow* camera is a
      // finite box (`SHADOW_HALF_EXTENT`), so anything beyond 32 units of the
      // frustum's centre simply stopped casting; with `castShadow` off there
      // is no frustum left to keep the runner inside of, and a directional
      // light's illumination has never depended on where the light object sits
      // - only on the direction from it to its target, which is now fixed for
      // the whole track. Leaving it parked is what makes the lighting on a
      // rooftop 50,000 units down the route identical to the lighting on the
      // first one, instead of subtly re-quantising every frame.
      //
      // The sky elements still follow, because those genuinely are positional:
      // the moon disc and star field sit on a dome of finite radius, so a
      // runner who out-travelled them would leave them behind.
      _focus.copy(target);

      moon.position.copy(_focus).add(moonOffset);
      moon.target.position.copy(_focus);
      moon.target.updateMatrixWorld();
      moon.updateMatrixWorld();

      _moonDir.copy(moonOffset).normalize();
      moonMesh.position.copy(_focus).addScaledVector(_moonDir, SKY_DOME_RADIUS);
      stars.position.copy(_focus);
    },
    updateTimeOfDay(t: number): void {
      const phase = t * Math.PI * 2;
      const elevation = Math.sin(phase); // -1 (midnight) .. +1 (midday)
      const swing = Math.cos(phase);

      sunOffset.copy(sunHorizontalDir).multiplyScalar(sunRadius * swing);
      sunOffset.y = sunRadius * elevation;
      moonOffset.copy(sunOffset).multiplyScalar(-1);

      const dayAmount = THREE.MathUtils.clamp(elevation, 0, 1);
      const nightAmount = THREE.MathUtils.clamp(-elevation, 0, 1);

      // The sun stays at its authored colour through most of the day and
      // only warms toward sunset/sunrise orange in the last third of its
      // climb from the horizon - not a flat lerp across the whole day,
      // which would tint midday too.
      const warmth = THREE.MathUtils.clamp(dayAmount * 3, 0, 1);
      sun.color.copy(SUNSET_COLOR).lerp(daySunColor, warmth);
      sun.intensity = def.sunIntensity * dayAmount;
      sun.visible = dayAmount > 0.001; // skips the shadow pass entirely once the sun contributes nothing

      moon.intensity = MOON_MAX_INTENSITY * nightAmount;

      // Ambient never bottoms out completely - a fully unlit scene at 11
      // units/sec is a visibility problem, not atmosphere.
      hemi.intensity = def.ambientIntensity * (0.3 + 0.7 * dayAmount);

      (scene.background as THREE.Color).copy(NIGHT_SKY_COLOR).lerp(daySkyColor, dayAmount);
      (scene.fog as THREE.Fog).color.copy(NIGHT_FOG_COLOR).lerp(dayFogColor, dayAmount);

      moonMesh.visible = nightAmount > 0.02;
      (moonMesh.material as THREE.MeshBasicMaterial).opacity = nightAmount;

      stars.visible = nightAmount > 0.02;
      (stars.material as THREE.PointsMaterial).opacity = nightAmount;
    },
    dispose(): void {
      sun.removeFromParent();
      sun.target.removeFromParent();
      moon.removeFromParent();
      moon.target.removeFromParent();
      hemi.removeFromParent();
      for (const point of accentLights) point.removeFromParent();

      moonMesh.removeFromParent();
      moonMesh.geometry.dispose();
      (moonMesh.material as THREE.Material).dispose();

      stars.removeFromParent();
      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();

      scene.background = null;
      scene.fog = null;
    },
  };
}
