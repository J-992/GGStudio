import * as THREE from "three";
import { TETHER_REST, TETHER_HARD_MAX } from "../game/Constants";
import type { Player } from "../player/Player";
import type { SurfaceFrame } from "../tunnel/SurfaceOrientation";

const SEGMENTS = 16;

const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _pnt = new THREE.Vector3();
const _sagDir = new THREE.Vector3();

export class TetherRenderer {
  readonly mesh: THREE.Mesh;
  private positions: Float32Array;
  private colors: Float32Array;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    const vertCount = (SEGMENTS + 1) * 2;
    this.positions = new Float32Array(vertCount * 3);
    this.colors = new Float32Array(vertCount * 3);
    const indices: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(indices);
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(
    p1: Player,
    p2: Player,
    frame: SurfaceFrame,
    tension: number,
    camPos: THREE.Vector3,
    time: number,
  ) {
    p1.position(_p1v);
    p2.position(_p2v);
    _mid.addVectors(_p1v, _p2v).multiplyScalar(0.5);
    _dir.subVectors(_p2v, _p1v);
    const dist = Math.max(1e-4, _dir.length());
    _dir.multiplyScalar(1 / dist);

    const slack = Math.max(0, TETHER_REST - dist);
    const sag = Math.min(1.9, slack * 0.55);
    const midDrop = -sag * (1 - tension);
    _sagDir.copy(frame.up).negate();

    _toCam.subVectors(camPos, _mid);
    _side.crossVectors(_dir, _toCam);
    if (_side.lengthSq() < 1e-6) _side.set(0, 1, 0);
    _side.normalize();

    const width = 0.05 + tension * 0.05 + Math.sin(time * (6 + tension * 26)) * 0.012 * tension;
    const heat = tension;

    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const mx = _p1v.x + (_p2v.x - _p1v.x) * t;
      const my = _p1v.y + (_p2v.y - _p1v.y) * t;
      const mz = _p1v.z + (_p2v.z - _p1v.z) * t;
      _pnt.set(mx, my, mz).addScaledVector(_sagDir, midDrop * 4 * t * (1 - t));
      const pulse = heat > 0.75 ? Math.sin(time * 30 - t * 12) * 0.25 + 0.85 : 1;

      const r = 0.45 + heat * 0.55 * pulse;
      const g = 0.62 + heat * 0.3 * pulse;
      const b = 0.85;

      const o = i * 6;
      this.positions[o] = _pnt.x - _side.x * width;
      this.positions[o + 1] = _pnt.y - _side.y * width;
      this.positions[o + 2] = _pnt.z - _side.z * width;
      this.positions[o + 3] = _pnt.x + _side.x * width;
      this.positions[o + 4] = _pnt.y + _side.y * width;
      this.positions[o + 5] = _pnt.z + _side.z * width;

      this.colors[o] = r * 0.8; this.colors[o + 1] = g * 0.8; this.colors[o + 2] = b * 0.8;
      this.colors[o + 3] = r; this.colors[o + 4] = g; this.colors[o + 5] = b;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.material.opacity = 0.55 + heat * 0.45;
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

const _p1v = new THREE.Vector3();
const _p2v = new THREE.Vector3();
