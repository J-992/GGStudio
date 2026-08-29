import {
  Box3,
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Enemy } from './Enemy';
import {
  BRIDGE_HALF_SPAN,
  BRIDGE_RAIL_Z,
  POND_SURFACE_Y,
  bridgeHeightAt,
} from './ArenaLayout';

const GRAVITY = 26;
const BRIDGE_SECTIONS_PER_SIDE = 8;
const WATER_DROP_COUNT = 150;
const WATER_CONTACT_COUNT = 48;
const SPLINTER_COUNT = 84;
const ROUTES = ['pond', 'bridge', 'tree', 'pond', 'tree', 'bridge'] as const;

export type EnvironmentImpactKind = (typeof ROUTES)[number];

export interface EnvironmentImpactEvent {
  kind: EnvironmentImpactKind;
  x: number;
  y: number;
  z: number;
  energy: number;
}

interface BodyTrack {
  kind: EnvironmentImpactKind;
  age: number;
  hitAt: number;
  primaryHit: boolean;
  waterHit: boolean;
  side: number;
  targetX: number;
  targetZ: number;
  energy: number;
  tree: TreeReaction | null;
}

interface BridgeFragment {
  mesh: Mesh;
  restPosition: Vector3;
  restQuaternion: Quaternion;
  restScale: Vector3;
  velocity: Vector3;
  angular: Vector3;
  mass: number;
  delay: number;
  active: boolean;
  waterHit: boolean;
}

interface BridgeSection {
  x: number;
  z: number;
  broken: boolean;
  fragments: BridgeFragment[];
}

interface TreeReaction {
  object: Object3D;
  baseQuaternion: Quaternion;
  worldPosition: Vector3;
  side: number;
  sway: number;
  velocity: number;
}

interface WaterDrop {
  position: Vector3;
  velocity: Vector3;
  radius: number;
  life: number;
  ttl: number;
  active: boolean;
}

interface WaterContact {
  position: Vector3;
  radius: number;
  life: number;
  ttl: number;
  active: boolean;
}

interface Splinter {
  position: Vector3;
  velocity: Vector3;
  rotation: Vector3;
  angular: Vector3;
  life: number;
  active: boolean;
}

type ShedLeaves = (position: Vector3, count: number, energy: number, direction: number) => void;

/**
 * Secondary environment physics for bodies that have already left combat.
 *
 * Gameplay only decides that a hit landed. This layer redirects the resulting
 * rigid body toward a visible landmark, waits for the actual trajectory to
 * reach it, then applies equal-and-opposite reactions to water, wood, or trees.
 */
export class ArenaImpactSystem {
  private tracks = new WeakMap<Enemy, BodyTrack>();
  private readonly bridgeSections: BridgeSection[] = [];
  private readonly bridgeFragments: BridgeFragment[] = [];
  private readonly trees: TreeReaction[] = [];
  private readonly waterDrops: WaterDrop[] = [];
  private readonly waterContacts: WaterContact[] = [];
  private readonly splinters: Splinter[] = [];
  private readonly waterMesh: InstancedMesh;
  private readonly waterContactMesh: InstancedMesh;
  private readonly splinterMesh: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly tempQuaternion = new Quaternion();
  private readonly tempDirection = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly previewVelocity = new Vector3(0, -12, 0);
  private readonly treeAxis = new Vector3(0, 0, 1);
  private routeCursor = 0;
  private treeCursor = 0;
  private brokenCount = 0;
  private splashCount = 0;

  constructor(
    private readonly group: Group,
    private readonly shedLeaves: ShedLeaves,
  ) {
    this.buildBridgeRails();
    this.waterMesh = this.buildWaterDrops();
    this.waterContactMesh = this.buildWaterContacts();
    this.splinterMesh = this.buildSplinters();
    group.add(this.waterMesh, this.waterContactMesh, this.splinterMesh);
    this.updateInstances();
  }

  /** Finds the authored tree roots after the GLB joins the scene. */
  registerGarden(garden: Group): void {
    this.trees.length = 0;
    garden.updateMatrixWorld(true);
    for (const name of [
      'Cylinder001',
      'Cylinder003',
      'Cylinder006',
      'Cylinder007',
      'Icosphere001',
      'Icosphere016',
      'Icosphere017',
      'Icosphere018',
    ]) {
      const authoredTree = garden.getObjectByName(name);
      const parent = authoredTree?.parent;
      if (!authoredTree || !parent) continue;

      // Rotate the whole authored tree about its lowest point. Rotating the
      // mesh around Blender's arbitrary object origin makes the trunk slide;
      // inserting a base pivot keeps the roots planted while the crown whips.
      const bounds = new Box3().setFromObject(authoredTree);
      const baseWorld = new Vector3();
      if (bounds.isEmpty()) authoredTree.getWorldPosition(baseWorld);
      else {
        bounds.getCenter(baseWorld);
        baseWorld.y = bounds.min.y;
      }
      const pivot = new Group();
      pivot.name = `ImpactPivot_${name}`;
      parent.add(pivot);
      parent.updateMatrixWorld(true);
      pivot.position.copy(parent.worldToLocal(baseWorld.clone()));
      pivot.updateMatrixWorld(true);
      pivot.attach(authoredTree);
      pivot.updateMatrixWorld(true);

      this.trees.push({
        object: pivot,
        baseQuaternion: pivot.quaternion.clone(),
        worldPosition: baseWorld,
        side: Math.sign(baseWorld.x) || 1,
        sway: 0,
        velocity: 0,
      });
    }
  }

  update(dt: number): void {
    this.updateBridgeFragments(dt);
    this.updateSplinters(dt);
    this.updateSplashes(dt);
    this.updateTrees(dt);
    this.updateInstances();
  }

  /** Development capture hook; production gameplay reaches the same path via bodies. */
  previewSplash(x: number, z: number, energy = 12): void {
    this.spawnSplash(x, z, MathUtils.clamp(energy, 3, 18), this.previewVelocity);
  }

  /**
   * Advances one launched body's selected interaction and returns only newly
   * occurring impacts, allowing the game to attach audio/camera response.
   */
  interact(enemy: Enemy, dt: number): EnvironmentImpactEvent | null {
    if (enemy.state !== 'dying') {
      this.tracks.delete(enemy);
      return null;
    }

    let track = this.tracks.get(enemy);
    if (!track) {
      track = this.beginTrack(enemy);
      this.tracks.set(enemy, track);
    }
    track.age += dt;

    if (!track.primaryHit) {
      if (track.kind === 'pond') {
        if (this.reachedWater(enemy, track)) return this.landInPond(enemy, track);
      } else if (track.age >= track.hitAt) {
        track.primaryHit = true;
        if (track.kind === 'bridge') return this.hitBridge(enemy, track);
        return this.hitTree(enemy, track);
      }
    }

    if (track.primaryHit && !track.waterHit && this.reachedWater(enemy, track)) {
      return this.landInPond(enemy, track);
    }
    return null;
  }

  reset(): void {
    this.tracks = new WeakMap<Enemy, BodyTrack>();
    this.routeCursor = 0;
    this.treeCursor = 0;
    this.brokenCount = 0;
    this.splashCount = 0;

    for (const section of this.bridgeSections) section.broken = false;
    for (const fragment of this.bridgeFragments) {
      fragment.mesh.position.copy(fragment.restPosition);
      fragment.mesh.quaternion.copy(fragment.restQuaternion);
      fragment.mesh.scale.copy(fragment.restScale);
      fragment.mesh.visible = true;
      fragment.velocity.set(0, 0, 0);
      fragment.angular.set(0, 0, 0);
      fragment.active = false;
      fragment.waterHit = false;
    }
    for (const tree of this.trees) {
      tree.sway = 0;
      tree.velocity = 0;
      tree.object.quaternion.copy(tree.baseQuaternion);
    }
    for (const drop of this.waterDrops) drop.active = false;
    for (const contact of this.waterContacts) contact.active = false;
    for (const splinter of this.splinters) splinter.active = false;
    this.updateInstances();
  }

  get debug(): { brokenBridgeSections: number; activeSplashes: number; shakingTrees: number } {
    let activeSplashes = 0;
    let shakingTrees = 0;
    for (const drop of this.waterDrops) if (drop.active) activeSplashes += 1;
    for (const contact of this.waterContacts) if (contact.active) activeSplashes += 1;
    for (const tree of this.trees) if (Math.abs(tree.sway) > 0.003) shakingTrees += 1;
    return { brokenBridgeSections: this.brokenCount, activeSplashes, shakingTrees };
  }

  private beginTrack(enemy: Enemy): BodyTrack {
    const position = enemy.deathPosition;
    const velocity = enemy.deathVelocity;
    const side = Math.sign(velocity.x) || Math.sign(position.x) || 1;
    let kind = ROUTES[this.routeCursor++ % ROUTES.length];
    if (kind === 'bridge' && !this.bridgeSections.some((section) => !section.broken)) kind = 'pond';
    if (kind === 'tree' && this.trees.length === 0) kind = 'pond';
    const energy = MathUtils.clamp(enemy.deathSpeed, 4, 18);
    const track: BodyTrack = {
      kind,
      age: 0,
      hitAt: 0.45,
      primaryHit: false,
      waterHit: false,
      side,
      targetX: side * 4,
      targetZ: BRIDGE_RAIL_Z,
      energy,
      tree: null,
    };

    enemy.setDeathFloor(POND_SURFACE_Y);
    if (kind === 'bridge') this.aimAtBridge(enemy, track);
    else if (kind === 'tree') this.aimAtTree(enemy, track);
    else this.aimAtPond(enemy, track);
    return track;
  }

  private aimAtPond(enemy: Enemy, track: BodyTrack): void {
    const time = 0.46 + hash(this.routeCursor, 2) * 0.08;
    track.hitAt = time;
    track.targetX = track.side * (3.5 + hash(this.routeCursor, 3) * 1.3);
    track.targetZ = (this.routeCursor % 2 ? 1 : -1) * (1.55 + hash(this.routeCursor, 4) * 0.75);
    this.aimBallistic(enemy, track.targetX, POND_SURFACE_Y + 0.22, track.targetZ, time);
  }

  private aimAtBridge(enemy: Enemy, track: BodyTrack): void {
    const time = 0.17 + hash(this.routeCursor, 5) * 0.045;
    track.hitAt = time;
    track.targetX = track.side * (2.9 + hash(this.routeCursor, 6) * 1.45);
    track.targetZ = BRIDGE_RAIL_Z;
    this.aimBallistic(
      enemy,
      track.targetX,
      bridgeHeightAt(track.targetX) + 0.56,
      track.targetZ,
      time,
    );
  }

  private aimAtTree(enemy: Enemy, track: BodyTrack): void {
    const idealX = track.side * 5;
    const candidates = this.trees
      .filter((tree) => tree.side === track.side)
      .sort(
        (a, b) =>
          Math.abs(a.worldPosition.x - idealX) - Math.abs(b.worldPosition.x - idealX),
      );
    track.tree = candidates[this.treeCursor++ % Math.max(1, candidates.length)] ?? this.trees[0] ?? null;
    const time = 0.29 + hash(this.routeCursor, 7) * 0.07;
    track.hitAt = time;
    track.targetX = track.tree?.worldPosition.x ?? track.side * 5.4;
    track.targetZ = track.tree?.worldPosition.z ?? -3.8;
    this.aimBallistic(enemy, track.targetX, 0.72, track.targetZ, time);
  }

  private aimBallistic(enemy: Enemy, x: number, y: number, z: number, seconds: number): void {
    const position = enemy.deathPosition;
    enemy.deathVelocity.set(
      (x - position.x) / seconds,
      (y - position.y + 0.5 * GRAVITY * seconds * seconds) / seconds,
      (z - position.z) / seconds,
    );
  }

  private reachedWater(enemy: Enemy, track: BodyTrack): boolean {
    return track.age >= Math.min(0.2, track.hitAt) && enemy.deathPosition.y <= POND_SURFACE_Y + 0.34;
  }

  private landInPond(enemy: Enemy, track: BodyTrack): EnvironmentImpactEvent {
    const position = enemy.deathPosition;
    const velocity = enemy.deathVelocity;
    const energy = MathUtils.clamp(Math.max(track.energy * 0.65, enemy.deathSpeed), 3, 18);
    this.spawnSplash(position.x, position.z, energy, velocity);
    enemy.settleDeathInWater(POND_SURFACE_Y);
    track.primaryHit = true;
    track.waterHit = true;
    this.splashCount += 1;
    return { kind: 'pond', x: position.x, y: POND_SURFACE_Y, z: position.z, energy };
  }

  private hitBridge(enemy: Enemy, track: BodyTrack): EnvironmentImpactEvent {
    const velocity = enemy.deathVelocity;
    const energy = MathUtils.clamp(Math.max(track.energy, enemy.deathSpeed), 4, 18);
    this.breakBridgeAt(track.targetX, track.targetZ, velocity, energy);
    velocity.set(
      -track.side * (1.25 + energy * 0.055),
      1.65 + energy * 0.07,
      1.8 + energy * 0.06,
    );
    enemy.deathAngularVelocity.multiplyScalar(0.72);
    enemy.deathAngularVelocity.z += -track.side * energy * 0.35;
    return {
      kind: 'bridge',
      x: track.targetX,
      y: bridgeHeightAt(track.targetX) + 0.56,
      z: track.targetZ,
      energy,
    };
  }

  private hitTree(enemy: Enemy, track: BodyTrack): EnvironmentImpactEvent {
    const energy = MathUtils.clamp(Math.max(track.energy, enemy.deathSpeed), 4, 18);
    const tree = track.tree;
    if (tree) {
      tree.velocity += -track.side * (0.42 + energy * 0.045);
      tree.object.getWorldPosition(tree.worldPosition);
      tree.worldPosition.y = MathUtils.clamp(tree.worldPosition.y + 2.5, 1.8, 5.2);
      this.shedLeaves(tree.worldPosition, Math.round(42 + energy * 1.8), energy, track.side);
    }
    enemy.deathVelocity.set(
      -track.side * (1.05 + energy * 0.045),
      1.3 + energy * 0.045,
      1.7 + energy * 0.05,
    );
    enemy.deathAngularVelocity.multiplyScalar(0.58);
    return { kind: 'tree', x: track.targetX, y: 0.78, z: track.targetZ, energy };
  }

  private buildBridgeRails(): void {
    const geometry = new BoxGeometry(1, 1, 1);
    const backMaterial = new MeshStandardMaterial({ color: 0xe75650, roughness: 0.74, metalness: 0.02 });
    const frontMaterial = backMaterial.clone();
    frontMaterial.transparent = true;
    frontMaterial.opacity = 0.84;
    frontMaterial.depthWrite = false;
    const width = (BRIDGE_HALF_SPAN * 2) / BRIDGE_SECTIONS_PER_SIDE;

    for (const z of [-BRIDGE_RAIL_Z, BRIDGE_RAIL_Z]) {
      const material = z > 0 ? frontMaterial : backMaterial;
      for (let i = 0; i < BRIDGE_SECTIONS_PER_SIDE; i++) {
        const x0 = -BRIDGE_HALF_SPAN + i * width;
        const x1 = x0 + width;
        const section: BridgeSection = { x: (x0 + x1) * 0.5, z, broken: false, fragments: [] };
        section.fragments.push(
          this.makeRailFragment(geometry, material, x0, x1, z, 0.34, 1.35),
          this.makeRailFragment(geometry, material, x0, x1, z, 0.76, 1.2),
          this.makePostFragment(geometry, material, MathUtils.lerp(x0, x1, 0.5), z, 0.93, 1.65),
        );
        this.bridgeSections.push(section);
      }
    }
  }

  private makeRailFragment(
    geometry: BoxGeometry,
    material: MeshStandardMaterial,
    x0: number,
    x1: number,
    z: number,
    height: number,
    mass: number,
  ): BridgeFragment {
    const y0 = bridgeHeightAt(x0) + height;
    const y1 = bridgeHeightAt(x1) + height;
    const mesh = new Mesh(geometry, material);
    mesh.position.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, z);
    mesh.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    mesh.scale.set(Math.hypot(x1 - x0, y1 - y0) * 0.98, 0.09, 0.12);
    return this.registerBridgeFragment(mesh, mass);
  }

  private makePostFragment(
    geometry: BoxGeometry,
    material: MeshStandardMaterial,
    x: number,
    z: number,
    height: number,
    mass: number,
  ): BridgeFragment {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, bridgeHeightAt(x) + height * 0.5, z);
    mesh.scale.set(0.115, height, 0.135);
    return this.registerBridgeFragment(mesh, mass);
  }

  private registerBridgeFragment(mesh: Mesh, mass: number): BridgeFragment {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const fragment: BridgeFragment = {
      mesh,
      restPosition: mesh.position.clone(),
      restQuaternion: mesh.quaternion.clone(),
      restScale: mesh.scale.clone(),
      velocity: new Vector3(),
      angular: new Vector3(),
      mass,
      delay: 0,
      active: false,
      waterHit: false,
    };
    this.bridgeFragments.push(fragment);
    return fragment;
  }

  private breakBridgeAt(x: number, z: number, bodyVelocity: Vector3, energy: number): void {
    let section: BridgeSection | null = null;
    let distance = Infinity;
    for (const candidate of this.bridgeSections) {
      if (candidate.broken || Math.sign(candidate.z) !== Math.sign(z)) continue;
      const d = Math.abs(candidate.x - x);
      if (d < distance) {
        section = candidate;
        distance = d;
      }
    }
    if (!section) return;
    section.broken = true;
    this.brokenCount += 1;

    for (let i = 0; i < section.fragments.length; i++) {
      const fragment = section.fragments[i];
      const spread = i / Math.max(1, section.fragments.length - 1) - 0.5;
      fragment.active = true;
      fragment.delay = i * 0.022;
      fragment.waterHit = false;
      fragment.velocity.set(
        bodyVelocity.x * (0.2 / fragment.mass) + spread * 1.8,
        1.7 + energy * 0.09 + Math.abs(spread) * 1.2,
        bodyVelocity.z * 0.24 + Math.sign(section.z) * (1.4 + Math.abs(spread)),
      );
      fragment.angular.set(
        spread * (8 + energy * 0.25),
        (i % 2 ? -1 : 1) * (5 + energy * 0.18),
        -Math.sign(bodyVelocity.x) * (4 + energy * 0.22),
      );
    }
    this.spawnSplinters(x, bridgeHeightAt(x) + 0.55, z, bodyVelocity, energy);
  }

  private updateBridgeFragments(dt: number): void {
    for (const fragment of this.bridgeFragments) {
      if (!fragment.active) continue;
      if (fragment.delay > 0) {
        fragment.delay -= dt;
        continue;
      }
      fragment.velocity.y -= 20 * dt;
      fragment.mesh.position.addScaledVector(fragment.velocity, dt);
      fragment.mesh.rotation.x += fragment.angular.x * dt;
      fragment.mesh.rotation.y += fragment.angular.y * dt;
      fragment.mesh.rotation.z += fragment.angular.z * dt;
      fragment.angular.multiplyScalar(Math.exp(-1.1 * dt));

      if (fragment.mesh.position.y <= POND_SURFACE_Y + 0.03) {
        fragment.mesh.position.y = POND_SURFACE_Y + 0.03;
        if (!fragment.waterHit) {
          fragment.waterHit = true;
          this.spawnSplash(fragment.mesh.position.x, fragment.mesh.position.z, 2.6, fragment.velocity);
          fragment.velocity.y = Math.abs(fragment.velocity.y) * 0.12;
          fragment.velocity.x *= 0.28;
          fragment.velocity.z *= 0.28;
          fragment.angular.multiplyScalar(0.4);
        } else {
          fragment.velocity.multiplyScalar(Math.exp(-7 * dt));
          fragment.angular.multiplyScalar(Math.exp(-6 * dt));
          if (fragment.velocity.lengthSq() < 0.01) fragment.active = false;
        }
      }
    }
  }

  private buildWaterDrops(): InstancedMesh {
    const mesh = new InstancedMesh(
      makeWaterDropGeometry(),
      new MeshStandardMaterial({
        color: 0x79bde7,
        roughness: 0.12,
        metalness: 0,
        transparent: true,
        opacity: 0.76,
        depthWrite: false,
      }),
      WATER_DROP_COUNT,
    );
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    for (let i = 0; i < WATER_DROP_COUNT; i++) {
      this.waterDrops.push({
        position: new Vector3(),
        velocity: new Vector3(),
        radius: 0.04,
        life: 0,
        ttl: 1,
        active: false,
      });
    }
    return mesh;
  }

  /**
   * A droplet does not vanish when it reaches the pond. It briefly pushes up a
   * narrow tongue of water that collapses back into the surface. These are
   * compact vertical contacts, deliberately not flat graphic ripple rings.
   */
  private buildWaterContacts(): InstancedMesh {
    const mesh = new InstancedMesh(
      makeWaterDropGeometry(),
      new MeshStandardMaterial({
        color: 0x79bde7,
        roughness: 0.16,
        metalness: 0,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      }),
      WATER_CONTACT_COUNT,
    );
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    for (let i = 0; i < WATER_CONTACT_COUNT; i++) {
      this.waterContacts.push({
        position: new Vector3(),
        radius: 0.08,
        life: 0,
        ttl: 0.2,
        active: false,
      });
    }
    return mesh;
  }

  private spawnSplash(x: number, z: number, energy: number, sourceVelocity: Vector3): void {
    // The displaced volume starts as several uneven surface lifts around the
    // body's footprint. One perfect dome looks as synthetic as one perfect
    // ring, so both their placement and size deliberately differ.
    const lifts = 7;
    for (let i = 0; i < lifts; i++) {
      const angle = (i / lifts) * Math.PI * 2 + hash(i, this.splashCount + 31) * 0.55;
      const offset = 0.045 + hash(i, this.splashCount + 32) * (0.12 + energy * 0.004);
      this.spawnWaterContact(
        x + Math.cos(angle) * offset,
        z + Math.sin(angle) * offset,
        0.045 + hash(i, this.splashCount + 33) * (0.045 + energy * 0.0025),
        0.2 + hash(i, this.splashCount + 34) * 0.12,
      );
    }

    const count = Math.min(48, Math.round(20 + energy * 1.8));
    for (let i = 0; i < count; i++) {
      const drop = this.takeWaterDrop();
      const angle =
        (i / count) * Math.PI * 2 + (hash(i, this.splashCount + 41) - 0.5) * 0.62;
      const sizeBias = Math.pow(hash(i, this.splashCount + 42), 1.7);
      const radial = 0.8 + sizeBias * (3.1 + energy * 0.11);
      const footprint = hash(i, this.splashCount + 43) * (0.12 + energy * 0.008);
      drop.position.set(
        x + Math.cos(angle) * footprint,
        POND_SURFACE_Y + 0.035,
        z + Math.sin(angle) * footprint,
      );
      drop.velocity.set(
        Math.cos(angle) * radial + sourceVelocity.x * 0.08,
        2.1 + hash(i, this.splashCount + 44) * (2.8 + energy * 0.16),
        Math.sin(angle) * radial + sourceVelocity.z * 0.08,
      );
      // Surface tension makes most spray fine, with a few visibly heavier
      // globules. Radius also determines the size of the secondary re-entry.
      drop.radius = 0.014 + Math.pow(hash(i, this.splashCount + 45), 2.2) * 0.042;
      drop.life = 0;
      drop.ttl = 0.65 + hash(i, this.splashCount + 46) * 0.65;
      drop.active = true;
    }
  }

  private takeWaterDrop(): WaterDrop {
    for (const drop of this.waterDrops) if (!drop.active) return drop;
    let oldest = this.waterDrops[0];
    for (const drop of this.waterDrops) if (drop.life > oldest.life) oldest = drop;
    return oldest;
  }

  private updateSplashes(dt: number): void {
    for (let i = 0; i < this.waterDrops.length; i++) {
      const drop = this.waterDrops[i];
      if (!drop.active) continue;
      drop.life += dt;
      drop.velocity.y -= 18 * dt;
      drop.position.addScaledVector(drop.velocity, dt);
      const drag = Math.exp(-0.22 * dt);
      drop.velocity.x *= drag;
      drop.velocity.z *= drag;
      if (drop.life > 0.1 && drop.position.y <= POND_SURFACE_Y) {
        drop.position.y = POND_SURFACE_Y;
        // Enough separated secondary contacts to read as water returning, but
        // not one pulse per pixel-sized mist droplet.
        if (i % 3 === 0 || drop.radius > 0.052) {
          this.spawnWaterContact(
            drop.position.x,
            drop.position.z,
            drop.radius * (1.25 + Math.min(1.4, Math.abs(drop.velocity.y) * 0.1)),
            0.16 + drop.radius * 1.4,
          );
        }
        drop.active = false;
      } else if (drop.life >= drop.ttl) {
        drop.active = false;
      }
    }

    for (const contact of this.waterContacts) {
      if (!contact.active) continue;
      contact.life += dt;
      if (contact.life >= contact.ttl) contact.active = false;
    }
  }

  private spawnWaterContact(x: number, z: number, radius: number, ttl: number): void {
    let contact = this.waterContacts.find((candidate) => !candidate.active);
    if (!contact) {
      contact = this.waterContacts[0];
      for (const candidate of this.waterContacts) {
        if (candidate.life > contact.life) contact = candidate;
      }
    }
    contact.position.set(x, POND_SURFACE_Y + 0.012, z);
    contact.radius = radius;
    contact.life = 0;
    contact.ttl = ttl;
    contact.active = true;
  }

  private buildSplinters(): InstancedMesh {
    const mesh = new InstancedMesh(
      new BoxGeometry(0.045, 0.2, 0.035),
      new MeshStandardMaterial({ color: 0x8e2e29, roughness: 0.9 }),
      SPLINTER_COUNT,
    );
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    for (let i = 0; i < SPLINTER_COUNT; i++) {
      this.splinters.push({
        position: new Vector3(),
        velocity: new Vector3(),
        rotation: new Vector3(),
        angular: new Vector3(),
        life: 0,
        active: false,
      });
    }
    return mesh;
  }

  private spawnSplinters(x: number, y: number, z: number, bodyVelocity: Vector3, energy: number): void {
    const count = Math.min(34, Math.round(17 + energy));
    for (let i = 0; i < count; i++) {
      const splinter = this.takeSplinter();
      const angle = hash(i, this.brokenCount + 51) * Math.PI * 2;
      const speed = 1.4 + hash(i, this.brokenCount + 52) * (2.5 + energy * 0.12);
      splinter.position.set(x, y, z);
      splinter.velocity.set(
        bodyVelocity.x * 0.12 + Math.cos(angle) * speed,
        1.2 + hash(i, this.brokenCount + 53) * (2.6 + energy * 0.09),
        bodyVelocity.z * 0.12 + Math.sin(angle) * speed,
      );
      splinter.rotation.set(angle, angle * 0.7, angle * 1.3);
      splinter.angular.set(
        5 + hash(i, 54) * 12,
        -8 + hash(i, 55) * 16,
        -10 + hash(i, 56) * 20,
      );
      splinter.life = 0;
      splinter.active = true;
    }
  }

  private takeSplinter(): Splinter {
    for (const splinter of this.splinters) if (!splinter.active) return splinter;
    let oldest = this.splinters[0];
    for (const splinter of this.splinters) if (splinter.life > oldest.life) oldest = splinter;
    return oldest;
  }

  private updateSplinters(dt: number): void {
    for (const splinter of this.splinters) {
      if (!splinter.active) continue;
      splinter.life += dt;
      splinter.velocity.y -= 21 * dt;
      splinter.position.addScaledVector(splinter.velocity, dt);
      splinter.rotation.addScaledVector(splinter.angular, dt);
      splinter.angular.multiplyScalar(Math.exp(-1.5 * dt));
      if (splinter.position.y <= POND_SURFACE_Y || splinter.life > 2.4) splinter.active = false;
    }
  }

  private updateTrees(dt: number): void {
    for (const tree of this.trees) {
      const acceleration = -tree.sway * 42 - tree.velocity * 7.8;
      tree.velocity += acceleration * dt;
      tree.sway += tree.velocity * dt;
      if (Math.abs(tree.sway) < 0.0001 && Math.abs(tree.velocity) < 0.0001) {
        tree.sway = 0;
        tree.velocity = 0;
      }
      tree.object.quaternion
        .copy(tree.baseQuaternion)
        .multiply(this.tempQuaternion.setFromAxisAngle(this.treeAxis, tree.sway));
    }
  }

  private updateInstances(): void {
    for (let i = 0; i < this.waterDrops.length; i++) {
      const drop = this.waterDrops[i];
      if (drop.active) {
        const stretch = 1 + Math.min(2.8, drop.velocity.length() * 0.14);
        this.dummy.position.copy(drop.position);
        this.dummy.quaternion.setFromUnitVectors(
          this.up,
          this.tempDirection.copy(drop.velocity).normalize(),
        );
        this.dummy.scale.set(drop.radius, drop.radius * stretch, drop.radius);
      } else {
        this.dummy.position.set(0, POND_SURFACE_Y - 2, 0);
        this.dummy.quaternion.identity();
        this.dummy.scale.setScalar(0.001);
      }
      this.dummy.updateMatrix();
      this.waterMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.waterMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.waterContacts.length; i++) {
      const contact = this.waterContacts[i];
      if (contact.active) {
        const t = MathUtils.clamp(contact.life / contact.ttl, 0, 1);
        const rise = Math.sin(t * Math.PI);
        const width = MathUtils.lerp(0.42, 0.88, easeOut(t)) * (1 - t * 0.5);
        const height = (0.12 + rise * 2.15) * (1 - t * 0.68);
        this.dummy.position.copy(contact.position);
        this.dummy.position.y += contact.radius * height * 0.28;
        this.dummy.quaternion.identity();
        this.dummy.scale.set(
          contact.radius * width,
          contact.radius * height,
          contact.radius * width,
        );
      } else {
        this.dummy.position.set(0, POND_SURFACE_Y - 2, 0);
        this.dummy.quaternion.identity();
        this.dummy.scale.setScalar(0.001);
      }
      this.dummy.updateMatrix();
      this.waterContactMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.waterContactMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < this.splinters.length; i++) {
      const splinter = this.splinters[i];
      if (splinter.active) {
        this.dummy.position.copy(splinter.position);
        this.dummy.rotation.set(splinter.rotation.x, splinter.rotation.y, splinter.rotation.z);
        this.dummy.scale.setScalar(1);
      } else {
        this.dummy.position.set(0, POND_SURFACE_Y - 2, 0);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(0.001);
      }
      this.dummy.updateMatrix();
      this.splinterMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.splinterMesh.instanceMatrix.needsUpdate = true;
  }
}

function hash(index: number, salt: number): number {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/** Rounded leading edge with a narrowed wake, oriented to velocity per instance. */
function makeWaterDropGeometry(): SphereGeometry {
  const geometry = new SphereGeometry(1, 9, 7);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const wakeTaper = MathUtils.lerp(0.58, 1, (y + 1) * 0.5);
    position.setX(i, position.getX(i) * wakeTaper);
    position.setZ(i, position.getZ(i) * wakeTaper);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** Exact sRGB equivalent of the GLB's Material.003 leaf base colour. */
export const TREE_LEAF_COLOR = new Color(0xe75650);
