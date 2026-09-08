// Builds the circular arena: floor, gapped wall, three gates (pillars + arch
// + barricade/barbed-wire that toggle with `setActiveGates`), and the
// deterministic ring of outside dressing (fence/pillar/tomb/rocks). Lighting
// and fog live here too since they are part of "the arena" rather than any
// one system's concern.
import * as THREE from 'three';
import { gatePositions } from '../core/arenaGeometry.js';
import { makeRng, pick } from '../core/rng.js';

const DEG2RAD = Math.PI / 180;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Dressing placement is cosmetic-only randomness, so per `AGENTS.md` it must
// not share the gameplay (wave/spawn) rng stream — this fixed seed gives the
// arena its own independent, still-deterministic stream.
const DRESSING_SEED = 0x4a2e17;

const SKY_COLOR = 0x1b1310;

/**
 * @param {number} angleDeg
 * @param {number} radius
 * @returns {{ x: number, z: number }}
 */
function angleToXZ(angleDeg, radius) {
  const a = angleDeg * DEG2RAD;
  return { x: radius * Math.sin(a), z: -radius * Math.cos(a) };
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number} Smallest angular distance in degrees, 0..180.
 */
function angleDist(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/**
 * @param {THREE.Vector3} position
 * @param {number} rotY Radians.
 * @param {number} scale
 * @param {THREE.Matrix4} localMatrix
 * @param {THREE.Matrix4} out
 * @returns {THREE.Matrix4}
 */
function composeInstance(position, rotY, scale, localMatrix, out) {
  const place = new THREE.Matrix4().compose(
    position,
    new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rotY),
    new THREE.Vector3(scale, scale, scale),
  );
  return out.multiplyMatrices(place, localMatrix);
}

export class Arena {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./assets.js').Assets} assets
   * @param {import('../core/types.js').GameConfig} config
   */
  constructor(scene, assets, config) {
    this._scene = scene;
    this._assets = assets;
    this._config = config;
    /** @type {THREE.Object3D[]} */
    this._owned = [];
    /** @type {(THREE.BufferGeometry|THREE.Material)[]} */
    this._disposables = [];

    this._buildFloor();
    this._buildWall();
    this._buildGates();
    this._buildDressing();
    this._buildLights();

    /** @type {{id:number, angle:number, x:number, z:number, active:boolean}[]} */
    this.gates = gatePositions(config).map((g) => ({ id: g.id, angle: g.angleDeg, x: g.x, z: g.z, active: false }));
  }

  _buildFloor() {
    const radius = this._config.arena.radius + 1;
    const geometry = new THREE.CircleGeometry(radius, 64);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const dark = new THREE.Color(0x1f1712);
    const ring = new THREE.Color(0x2a1f18);
    const scratch = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getX(i), position.getZ(i));
      const wave = Math.sin(r * 1.15) * 0.5 + 0.5;
      scratch.copy(dark).lerp(ring, wave * 0.6);
      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const floor = new THREE.Mesh(geometry, material);
    floor.name = 'arena-floor';
    this._scene.add(floor);
    this._owned.push(floor);
    this._disposables.push(geometry, material);
  }

  _buildWall() {
    const { radius, wallHeight, gateAngles, gateWidth } = this._config.arena;
    const wallRadius = radius + 0.5;
    const segments = 96;

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let vertCount = 0;

    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * 360;
      const a1 = ((i + 1) / segments) * 360;
      const mid = (a0 + a1) / 2;
      const inGap = gateAngles.some((g) => angleDist(mid, g) <= gateWidth / 2);
      if (inGap) continue;

      const p0 = angleToXZ(a0, wallRadius);
      const p1 = angleToXZ(a1, wallRadius);
      const nMid = angleToXZ(mid, 1);

      const base = vertCount;
      positions.push(
        p0.x, 0, p0.z,
        p1.x, 0, p1.z,
        p1.x, wallHeight, p1.z,
        p0.x, wallHeight, p0.z,
      );
      for (let k = 0; k < 4; k++) normals.push(nMid.x, 0, nMid.z);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      vertCount += 4;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    const material = new THREE.MeshLambertMaterial({ color: 0x3a2e26, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(geometry, material);
    wall.name = 'arena-wall';
    this._scene.add(wall);
    this._owned.push(wall);
    this._disposables.push(geometry, material);
  }

  _buildGates() {
    const { gateAngles, gateWidth, wallHeight, radius } = this._config.arena;
    const wallRadius = radius + 0.5;
    const halfWidthDeg = gateWidth / 2;
    const chordWidth = 2 * wallRadius * Math.sin((gateWidth * DEG2RAD) / 2);

    const pillarSource = this._assets.instanceSource('SM-8-Pillar');
    const pillarGeom = pillarSource.geometry;
    const pillarMat = pillarSource.material.clone();
    const pillarMesh = new THREE.InstancedMesh(pillarGeom, pillarMat, gateAngles.length * 2);
    pillarMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pillarMesh.name = 'gate-pillars';
    this._scene.add(pillarMesh);
    this._owned.push(pillarMesh);
    this._disposables.push(pillarMat);

    /** @type {{barricade: THREE.Mesh, barbedWire: THREE.Mesh, arch: THREE.Mesh}[]} */
    this._gateVisuals = [];

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();

    gateAngles.forEach((angleDeg, gateId) => {
      const leftAngle = angleDeg - halfWidthDeg - 3;
      const rightAngle = angleDeg + halfWidthDeg + 3;
      const left = angleToXZ(leftAngle, wallRadius);
      const right = angleToXZ(rightAngle, wallRadius);
      position.set(left.x, 0, left.z);
      composeInstance(position, leftAngle * DEG2RAD, 1, pillarSource.localMatrix, matrix);
      pillarMesh.setMatrixAt(gateId * 2, matrix);
      position.set(right.x, 0, right.z);
      composeInstance(position, rightAngle * DEG2RAD, 1, pillarSource.localMatrix, matrix);
      pillarMesh.setMatrixAt(gateId * 2 + 1, matrix);

      const gatePos = angleToXZ(angleDeg, wallRadius);
      const archGeom = new THREE.BoxGeometry(chordWidth + 0.6, 0.6, 0.5);
      const archMat = new THREE.MeshLambertMaterial({ color: 0x3a2e26, emissive: 0x000000, emissiveIntensity: 0 });
      const arch = new THREE.Mesh(archGeom, archMat);
      arch.position.set(gatePos.x, wallHeight + 0.3, gatePos.z);
      arch.rotation.y = angleDeg * DEG2RAD;
      arch.name = `gate-arch-${gateId}`;
      this._scene.add(arch);
      this._owned.push(arch);
      this._disposables.push(archGeom, archMat);

      const barricade = this._assets.propMesh('Barricade_03');
      const bPos = angleToXZ(angleDeg, wallRadius - 0.3);
      barricade.position.set(bPos.x + barricade.position.x, barricade.position.y, bPos.z + barricade.position.z);
      barricade.rotation.y += angleDeg * DEG2RAD;
      barricade.name = `gate-barricade-${gateId}`;
      this._scene.add(barricade);
      this._owned.push(barricade);
      this._disposables.push(barricade.material);

      const barbedWire = this._assets.propMesh('BarbedWires');
      const wPos = angleToXZ(leftAngle + 1.5, wallRadius - 0.4);
      barbedWire.position.set(wPos.x + barbedWire.position.x, barbedWire.position.y, wPos.z + barbedWire.position.z);
      barbedWire.rotation.y += angleDeg * DEG2RAD;
      barbedWire.name = `gate-barbedwire-${gateId}`;
      this._scene.add(barbedWire);
      this._owned.push(barbedWire);
      this._disposables.push(barbedWire.material);

      this._gateVisuals[gateId] = { barricade, barbedWire, arch };
    });

    pillarMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param {number[]} ids Gate ids to mark active (lit, barricade cleared); the rest are closed.
   */
  setActiveGates(ids) {
    for (const gate of this.gates) {
      gate.active = ids.includes(gate.id);
      const visuals = this._gateVisuals[gate.id];
      if (!visuals) continue;
      visuals.barricade.visible = !gate.active;
      visuals.barbedWire.visible = !gate.active;
      const emissive = /** @type {THREE.MeshLambertMaterial} */ (visuals.arch.material);
      emissive.emissive.setHex(gate.active ? 0xff2222 : 0x000000);
      emissive.emissiveIntensity = gate.active ? 1.2 : 0;
    }
  }

  _buildDressing() {
    const { dressingRadius, dressingCount } = this._config.arena;
    const rng = makeRng(DRESSING_SEED);
    const [rMin, rMax] = dressingRadius;

    this._addRing('SM-7-Fence', dressingCount.fence, rMin, rMax, rng, 0);
    this._addRing('SM-8-Pillar', dressingCount.pillar, rMin, rMax, rng, 0);
    this._addRing('SM-3-Tomb1', dressingCount.tomb, rMin, rMax, rng, Math.PI * 2);

    const rockNames = ['Rock_1', 'Rock_2', 'Rock_4'];
    /** @type {Record<string, number[]>} name -> instance indices (as flat placement list). */
    const rockAssignment = { Rock_1: [], Rock_2: [], Rock_4: [] };
    for (let i = 0; i < dressingCount.rock; i++) {
      rockAssignment[pick(rng, rockNames)].push(i);
    }
    for (const name of rockNames) {
      const count = rockAssignment[name].length;
      if (count === 0) continue;
      this._addScattered(name, count, rMin, rMax, rng, Math.PI * 2);
    }
  }

  /**
   * Places `count` instances of a single named mesh evenly around a ring
   * (radius jittered within `[rMin, rMax]`), each rotated to face outward
   * plus up to `rotJitter` radians of extra randomness.
   *
   * @param {string} meshName
   * @param {number} count
   * @param {number} rMin
   * @param {number} rMax
   * @param {() => number} rng
   * @param {number} rotJitter
   */
  _addRing(meshName, count, rMin, rMax, rng, rotJitter) {
    if (count === 0) return;
    const source = this._assets.instanceSource(meshName);
    const material = source.material.clone();
    const mesh = new THREE.InstancedMesh(source.geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = `dressing-${meshName}`;
    this._scene.add(mesh);
    this._owned.push(mesh);
    this._disposables.push(material);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const angleDeg = (i / count) * 360 + (rng() - 0.5) * (360 / count) * 0.3;
      const r = rMin + rng() * (rMax - rMin);
      const p = angleToXZ(angleDeg, r);
      position.set(p.x, 0, p.z);
      const rotY = angleDeg * DEG2RAD + (rng() - 0.5) * rotJitter;
      composeInstance(position, rotY, 1, source.localMatrix, matrix);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Places `count` instances of a single named mesh at fully random angle
   * and radius within `[rMin, rMax]` — used for the rocks, which read better
   * scattered than evenly spaced.
   *
   * @param {string} meshName
   * @param {number} count
   * @param {number} rMin
   * @param {number} rMax
   * @param {() => number} rng
   * @param {number} rotJitter
   */
  _addScattered(meshName, count, rMin, rMax, rng, rotJitter) {
    const source = this._assets.instanceSource(meshName);
    const material = source.material.clone();
    const mesh = new THREE.InstancedMesh(source.geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = `dressing-${meshName}`;
    this._scene.add(mesh);
    this._owned.push(mesh);
    this._disposables.push(material);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const angleDeg = rng() * 360;
      const r = rMin + rng() * (rMax - rMin);
      const p = angleToXZ(angleDeg, r);
      position.set(p.x, 0, p.z);
      const rotY = rng() * rotJitter;
      const scale = 0.8 + rng() * 0.5;
      composeInstance(position, rotY, scale, source.localMatrix, matrix);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xfff2e0, 0x2a1a12, 1.1);
    this._scene.add(hemi);
    this._owned.push(hemi);

    const sun = new THREE.DirectionalLight(0xffe9c7, 1.0);
    sun.position.set(18, 24, 10);
    this._scene.add(sun);
    this._owned.push(sun);

    this._scene.fog = new THREE.Fog(SKY_COLOR, this._config.arena.radius * 1.1, this._config.arena.radius * 2.4);
    if (!this._scene.background) this._scene.background = new THREE.Color(SKY_COLOR);
  }

  dispose() {
    for (const obj of this._owned) {
      this._scene.remove(obj);
    }
    for (const resource of this._disposables) {
      resource.dispose();
    }
    this._scene.fog = null;
    this._owned = [];
    this._disposables = [];
    this._gateVisuals = [];
  }
}
