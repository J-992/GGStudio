import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PointLight,
  Scene,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Backdrop } from './Backdrop';
import { ArenaImpactSystem, TREE_LEAF_COLOR, type EnvironmentImpactEvent } from './ArenaImpacts';
import {
  BRIDGE_DECK_LOCAL_Y,
  GARDEN_SCALE_X,
  GARDEN_SCALE_YZ,
  bridgeHeightAt,
} from './ArenaLayout';
import type { Enemy } from './Enemy';

export { bridgeHeightAt } from './ArenaLayout';

/**
 * The imported Japanese bridge garden that frames every fight.
 *
 * The bridge is the gameplay floor: its crest is world Y=0 and the enemies'
 * world height follows its arch, so they visibly climb in from both ends.
 */

const BASE = import.meta.env.BASE_URL;
const GARDEN_URL = `${BASE}models/japanese_bridge_garden.glb`;
const PETAL_COUNT = 190;
const RAIN_COUNT = 280;

export type WeatherKind = 'sunny' | 'overcast' | 'rain' | 'thunder';

const WEATHER: ReadonlyArray<{
  kind: WeatherKind;
  duration: number;
  sky: number;
  key: number;
  hemi: number;
  rim: number;
  rain: number;
}> = [
  { kind: 'sunny', duration: 24, sky: 0xa8cad4, key: 2.35, hemi: 1.45, rim: 20, rain: 0 },
  { kind: 'overcast', duration: 12, sky: 0x7e929b, key: 1.35, hemi: 1.12, rim: 16, rain: 0 },
  { kind: 'rain', duration: 24, sky: 0x536a78, key: 0.9, hemi: 0.9, rim: 13, rain: 0.78 },
  { kind: 'thunder', duration: 20, sky: 0x293745, key: 0.55, hemi: 0.68, rim: 11, rain: 1 },
];

const FRONT_OCCLUDERS = new Set([
  'Cylinder.004',
  'Cylinder.005',
  'Cylinder.008',
  'Cylinder.002',
  'Cylinder.009',
  'Cylinder.010',
  'Cylinder.011',
  'Cylinder.012',
  'Cylinder.013',
  'Icosphere.002',
  'Icosphere.010',
]);

interface FallingPetal {
  x: number;
  y: number;
  z: number;
  fall: number;
  sway: number;
  phase: number;
  spin: number;
  vx: number;
  vy: number;
  vz: number;
  burst: number;
}

interface RainDrop {
  x: number;
  y: number;
  z: number;
  speed: number;
}

export class Arena {
  readonly group = new Group();
  readonly keyLight: DirectionalLight;
  readonly rimLight: PointLight;
  /** Pulsed on impact for the flash effect. */
  readonly impactLight: PointLight;

  private readonly loader = new GLTFLoader();
  private readonly skyLight: HemisphereLight;
  private readonly stormLight: DirectionalLight;
  private readonly fog: Fog;
  /** True while the run's difficulty owns the sky; see `setPhase`. */
  private phaseDriven = false;
  private readonly sky = new Color(WEATHER[0].sky);
  private readonly displayedSky = new Color(WEATHER[0].sky);
  private readonly weatherTarget = new Color(WEATHER[0].sky);
  private readonly lightningColor = new Color(0xdce8ff);
  private readonly backdrop: Backdrop;
  private readonly petalMesh: InstancedMesh;
  private readonly petalDummy = new Object3D();
  private readonly petals: FallingPetal[] = [];
  private readonly rainGeometry: BufferGeometry;
  private readonly rainMaterial: LineBasicMaterial;
  private readonly rainLines: LineSegments;
  private readonly rainDrops: RainDrop[] = [];
  private readonly rainPositions = new Float32Array(RAIN_COUNT * 6);
  private readonly impacts: ArenaImpactSystem;
  private loadPromise: Promise<void> | null = null;
  private weatherIndex = 0;
  private weatherClock = 0;
  private weatherTime = 0;
  private rainAmount = 0;
  private keyBase = WEATHER[0].key;
  private rimBase = WEATHER[0].rim;
  private flowEmphasis = 0;
  private lightning = 0;
  private lightningIn = 2.4;
  private petalCursor = 0;

  constructor(scene: Scene) {
    // The backdrop paints the sky now, so the scene needs no flat background
    // colour behind it — but fog still tracks the horizon so the garden's
    // distance haze and the sky always agree.
    this.backdrop = new Backdrop(scene);
    this.fog = new Fog(this.sky, 22, 48);
    scene.fog = this.fog;

    this.skyLight = new HemisphereLight(0xc9e3ff, 0x47362c, WEATHER[0].hemi);
    scene.add(this.skyLight);

    this.keyLight = new DirectionalLight(0xffedcf, WEATHER[0].key);
    this.keyLight.position.set(5.5, 10, 7);
    this.keyLight.target.position.set(0, 0.8, -1.5);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(512, 512);
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 34;
    const shadowExtent = 11;
    this.keyLight.shadow.camera.left = -shadowExtent;
    this.keyLight.shadow.camera.right = shadowExtent;
    this.keyLight.shadow.camera.top = shadowExtent;
    this.keyLight.shadow.camera.bottom = -shadowExtent;
    this.keyLight.shadow.bias = -0.0012;
    scene.add(this.keyLight);
    scene.add(this.keyLight.target);

    this.rimLight = new PointLight(0x86b8ff, WEATHER[0].rim, 24, 2);
    this.rimLight.position.set(-3, 4.5, -7);
    scene.add(this.rimLight);

    this.impactLight = new PointLight(0xffe8b0, 0, 12, 2);
    this.impactLight.position.set(0, 1.6, 1.5);
    scene.add(this.impactLight);

    this.stormLight = new DirectionalLight(0xdce8ff, 0);
    this.stormLight.position.set(-5, 9, 4);
    scene.add(this.stormLight);

    this.petalMesh = this.buildPetals();
    this.rainGeometry = new BufferGeometry();
    this.rainGeometry.setAttribute('position', new BufferAttribute(this.rainPositions, 3));
    this.rainMaterial = new LineBasicMaterial({
      color: 0xc8deed,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.rainLines = new LineSegments(this.rainGeometry, this.rainMaterial);
    this.rainLines.frustumCulled = false;
    this.seedRain();

    this.impacts = new ArenaImpactSystem(
      this.group,
      (position, count, energy, direction) => this.shedLeaves(position, count, energy, direction),
    );

    this.group.add(this.petalMesh, this.rainLines);
    scene.add(this.group);
    this.updatePetals(0);
    this.updateRain(0);
  }

  /** Dev-only view of the backdrop's current palette. */
  get skyDebug() {
    return this.backdrop.debug;
  }

  get weather(): WeatherKind {
    return WEATHER[this.weatherIndex].kind;
  }

  /** Loads and prepares the garden while the game's loading screen is visible. */
  load(onProgress: (ratio: number) => void = () => {}): Promise<void> {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise((resolve, reject) => {
      this.loader.load(
        GARDEN_URL,
        (gltf) => {
          const garden = gltf.scene;
          garden.scale.set(GARDEN_SCALE_X, GARDEN_SCALE_YZ, GARDEN_SCALE_YZ);
          garden.position.set(0, -BRIDGE_DECK_LOCAL_Y * GARDEN_SCALE_YZ, 0);

          // GLTFLoader strips periods because they are reserved by animation
          // track paths, so authored names such as Cylinder.013 become
          // Cylinder013 at runtime.
          for (const name of FRONT_OCCLUDERS) {
            garden.getObjectByName(name.replace('.', ''))?.removeFromParent();
          }
          garden.traverse((object) => {
            if (!(object instanceof Mesh)) return;
            // The static garden contributed almost one hundred extra shadow
            // draws every frame. Fighters still cast onto the receiving set;
            // the environment itself is already shaded by authored materials.
            object.castShadow = false;
            object.receiveShadow = true;

            // Damage needs removable pieces. The impact layer reconstructs the
            // authored red railing as independently simulated sections, while
            // the bridge deck and all of the original ornament stay intact.
            if (object.name.startsWith('Cube005_Material003')) {
              object.visible = false;
            }
          });

          this.group.add(garden);
          this.impacts.registerGarden(garden);
          // Weather must stay in front of the environment in scene traversal.
          this.group.add(this.petalMesh, this.rainLines);
          onProgress(1);
          resolve();
        },
        (event) => {
          if (event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
          else onProgress(0.5);
        },
        (error) => reject(error),
      );
    });

    return this.loadPromise;
  }

  /**
   * Walks the sky forward with the run's difficulty rather than with a timer.
   *
   * The set never changed, so a three-minute run looked identical at second ten
   * and second a hundred and seventy — which quietly tells a player they are not
   * getting anywhere. Tying the weather to the difficulty phase makes progress
   * something you can see out of the window: the fight starts in sun, and by the
   * time the spacing is at its floor it is happening in a thunderstorm.
   *
   * @param phase 0-based difficulty phase, or null in menus, where the old
   *              free-running cycle is the right behaviour
   */
  setPhase(phase: number | null): void {
    if (phase === null) {
      this.phaseDriven = false;
      return;
    }
    this.phaseDriven = true;
    // Six phases across four skies: sun holds through the gentle opening, and
    // the last two phases share the storm so the peak has one look, not a
    // change every twenty seconds.
    const step = [0, 0, 1, 2, 3, 3][Math.min(phase, 5)];
    if (step === this.weatherIndex) return;
    this.weatherIndex = step;
    this.weatherClock = 0;
    if (step === 3) this.lightningIn = 0.6;
  }

  update(dt: number, ambientDt = dt): void {
    this.weatherTime += dt;
    this.weatherClock += dt;
    const active = WEATHER[this.weatherIndex];
    // Under phase control the sky is held by the run's difficulty, so the
    // free-running cycle stands down rather than fighting it.
    if (!this.phaseDriven && this.weatherClock >= active.duration) {
      this.weatherClock -= active.duration;
      this.weatherIndex = (this.weatherIndex + 1) % WEATHER.length;
    }

    this.updateWeather(dt);
    if (ambientDt > 0) {
      this.updatePetals(ambientDt);
      this.updateRain(ambientDt);
    }
    this.impacts.update(dt);
  }

  setShadowMapSize(size: number): void {
    if (this.keyLight.shadow.mapSize.x === size) return;
    this.keyLight.shadow.map?.dispose();
    this.keyLight.shadow.map = null;
    this.keyLight.shadow.mapSize.set(size, size);
  }

  /** Allows playtests to jump directly to a weather state. */
  setWeather(kind: WeatherKind): void {
    const index = WEATHER.findIndex((entry) => entry.kind === kind);
    if (index < 0) return;
    this.weatherIndex = index;
    this.weatherClock = 0;
    this.lightningIn = 0.2;
  }

  bridgeHeightAt(x: number): number {
    return bridgeHeightAt(x);
  }

  /** Couples one launched body to the scenery at its physical contact time. */
  interactBody(enemy: Enemy, dt: number): EnvironmentImpactEvent | null {
    return this.impacts.interact(enemy, dt);
  }

  /** Rebuilds damaged scenery between runs, never during a live exchange. */
  resetDamage(): void {
    this.impacts.reset();
  }

  /** Dev/test capture of the exact splash used by a real body impact. */
  /** Hides the player-side railing so the character screen has a clear view. */
  setNearRailVisible(visible: boolean): void {
    this.impacts.setNearRailVisible(visible);
  }

  previewSplash(x: number, z: number, energy = 12): void {
    this.impacts.previewSplash(x, z, energy);
  }

  get impactDebug() {
    return this.impacts.debug;
  }

  /** Pushes the arena back visually so Flow Mode reads as a spotlight. */
  setFlowEmphasis(amount: number): void {
    this.flowEmphasis = MathUtils.clamp(amount, 0, 1);
    this.applyLighting();
  }

  private updateWeather(dt: number): void {
    const active = WEATHER[this.weatherIndex];
    const blend = 1 - Math.exp(-dt * 0.75);
    this.weatherTarget.setHex(active.sky);
    this.sky.lerp(this.weatherTarget, blend);
    this.keyBase = MathUtils.damp(this.keyBase, active.key, 1.25, dt);
    this.rimBase = MathUtils.damp(this.rimBase, active.rim, 1.25, dt);
    this.skyLight.intensity = MathUtils.damp(this.skyLight.intensity, active.hemi, 1.25, dt);
    this.rainAmount = MathUtils.damp(this.rainAmount, active.rain, 1.8, dt);

    if (active.kind === 'thunder') {
      this.lightningIn -= dt;
      if (this.lightningIn <= 0) {
        this.lightning = 1;
        // Irregular but deterministic spacing; weather never draws gameplay RNG.
        this.lightningIn = 2.2 + (Math.sin(this.weatherTime * 4.17) * 0.5 + 0.5) * 3.6;
      }
    } else {
      this.lightningIn = 1.4;
    }
    // A long frame must not consume an entire lightning flash before it is
    // rendered once.
    this.lightning = Math.max(0, this.lightning - Math.min(dt, 0.05) * 4.8);
    this.stormLight.intensity = this.lightning * 5.5;

    this.displayedSky.copy(this.sky).lerp(this.lightningColor, this.lightning * 0.72);
    this.fog.color.copy(this.displayedSky);
    // One weather source of truth: the backdrop is told the same horizon colour
    // the fog uses, how overcast it is, and the lightning, and derives the rest.
    this.backdrop.update(dt, this.displayedSky, this.gloom(), this.lightning);
    this.fog.near = MathUtils.lerp(22, 13, this.rainAmount);
    this.fog.far = MathUtils.lerp(48, 34, this.rainAmount);
    this.applyLighting();
  }

  /** How overcast the sky currently is, 0 clear to 1 storm. */
  private gloom(): number {
    const clearKey = WEATHER[0].key;
    const stormKey = WEATHER[WEATHER.length - 1].key;
    return MathUtils.clamp((clearKey - this.keyBase) / (clearKey - stormKey), 0, 1);
  }

  private applyLighting(): void {
    this.keyLight.intensity = this.keyBase * (1 - this.flowEmphasis * 0.55) + this.lightning * 2.2;
    this.rimLight.intensity = this.rimBase * (1 + this.flowEmphasis * 0.8) + this.lightning * 4;
  }

  private buildPetals(): InstancedMesh {
    const mesh = new InstancedMesh(
      new CircleGeometry(0.09, 5),
      new MeshBasicMaterial({
        color: TREE_LEAF_COLOR,
        side: DoubleSide,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      }),
      PETAL_COUNT,
    );
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    for (let i = 0; i < PETAL_COUNT; i++) {
      this.petals.push({
        x: hash(i, 1) * 21 - 10.5,
        y: hash(i, 2) * 10 - 1.2,
        z: hash(i, 3) * 8 - 3.5,
        fall: 0.35 + hash(i, 4) * 0.55,
        sway: 0.65 + hash(i, 5) * 1.4,
        phase: hash(i, 6) * Math.PI * 2,
        spin: 0.8 + hash(i, 7) * 2.4,
        vx: 0,
        vy: 0,
        vz: 0,
        burst: 0,
      });
    }
    return mesh;
  }

  private updatePetals(dt: number): void {
    const wind = this.weather === 'thunder' ? 1.15 : this.weather === 'rain' ? 0.55 : 0.2;
    for (let i = 0; i < this.petals.length; i++) {
      const petal = this.petals[i];
      if (petal.burst > 0) {
        petal.burst = Math.max(0, petal.burst - dt);
        petal.vy -= 3.8 * dt;
        petal.vx += wind * dt * 0.35;
        petal.x += petal.vx * dt;
        petal.y += petal.vy * dt;
        petal.z += petal.vz * dt;
        const drag = Math.exp(-1.15 * dt);
        petal.vx *= drag;
        petal.vy *= Math.exp(-0.3 * dt);
        petal.vz *= drag;
      } else {
        petal.y -= petal.fall * dt * (1 + this.rainAmount * 0.65);
        petal.x += (Math.sin(this.weatherTime * petal.sway + petal.phase) * 0.28 + wind) * dt;
        petal.z += Math.cos(this.weatherTime * 0.7 + petal.phase) * dt * 0.12;
      }
      if (petal.y < -1.45 || petal.x > 11.5) {
        petal.x = hash(i, 8 + Math.floor(this.weatherTime)) * 21 - 10.5;
        petal.y = 7.5 + hash(i, 9) * 2.5;
        petal.z = hash(i, 10) * 8 - 3.5;
        petal.vx = 0;
        petal.vy = 0;
        petal.vz = 0;
        petal.burst = 0;
      }

      this.petalDummy.position.set(petal.x, petal.y, petal.z);
      this.petalDummy.rotation.set(
        petal.phase + this.weatherTime * petal.spin,
        this.weatherTime * petal.spin * 0.6,
        petal.phase * 0.7 + this.weatherTime * petal.spin * 0.45,
      );
      this.petalDummy.scale.set(0.72, 1.25, 1);
      this.petalDummy.updateMatrix();
      this.petalMesh.setMatrixAt(i, this.petalDummy.matrix);
    }
    this.petalMesh.instanceMatrix.needsUpdate = true;
  }

  /** Recycles the ambient leaf pool into a dense, directional tree-impact burst. */
  private shedLeaves(origin: Vector3, count: number, energy: number, direction: number): void {
    const amount = Math.min(count, this.petals.length);
    for (let n = 0; n < amount; n++) {
      const i = this.petalCursor++ % this.petals.length;
      const petal = this.petals[i];
      const angle = hash(i, this.petalCursor + 71) * Math.PI * 2;
      const radius = hash(i, this.petalCursor + 72) * 1.15;
      const speed = 0.8 + hash(i, this.petalCursor + 73) * (1.7 + energy * 0.055);
      petal.x = origin.x + Math.cos(angle) * radius;
      petal.y = origin.y + (hash(i, this.petalCursor + 74) - 0.5) * 1.4;
      petal.z = origin.z + Math.sin(angle) * radius;
      petal.vx = Math.cos(angle) * speed + direction * (0.45 + energy * 0.025);
      petal.vy = 0.8 + hash(i, this.petalCursor + 75) * (1.7 + energy * 0.06);
      petal.vz = Math.sin(angle) * speed;
      petal.phase = hash(i, this.petalCursor + 76) * Math.PI * 2;
      petal.spin = 2.2 + hash(i, this.petalCursor + 77) * 5.4;
      petal.burst = 1.1 + hash(i, this.petalCursor + 78) * 0.8;
    }
  }

  private seedRain(): void {
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainDrops.push({
        x: hash(i, 31) * 23 - 11.5,
        y: hash(i, 32) * 10 - 1.2,
        z: hash(i, 33) * 9 - 4,
        speed: 7 + hash(i, 34) * 6,
      });
    }
  }

  private updateRain(dt: number): void {
    const stormWind = this.weather === 'thunder' ? 1.8 : 0.75;
    for (let i = 0; i < this.rainDrops.length; i++) {
      const drop = this.rainDrops[i];
      drop.y -= drop.speed * dt;
      drop.x += stormWind * dt;
      if (drop.y < -1.6 || drop.x > 12) {
        drop.x = hash(i, 35 + Math.floor(this.weatherTime)) * 23 - 11.5;
        drop.y = 7.5 + hash(i, 36) * 2.5;
        drop.z = hash(i, 37) * 9 - 4;
      }
      const p = i * 6;
      this.rainPositions[p] = drop.x;
      this.rainPositions[p + 1] = drop.y;
      this.rainPositions[p + 2] = drop.z;
      this.rainPositions[p + 3] = drop.x - stormWind * 0.055;
      this.rainPositions[p + 4] = drop.y + 0.55;
      this.rainPositions[p + 5] = drop.z;
    }
    (this.rainGeometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.rainMaterial.opacity = this.rainAmount * 0.58;
    this.rainLines.visible = this.rainAmount > 0.015;
  }
}

function hash(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}
