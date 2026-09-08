// Doom-style brainrot billboards: one InstancedMesh of unit quads with a
// custom cylindrical-billboard ShaderMaterial (rotates about Y only, so feet
// stay planted), plus a second InstancedMesh of flat blob-shadow discs. Used
// by `Enemies.js` for `tungtung` and (later, by P5's `Boss.js`) for the
// brainrot boss — both key off `render: 'sprite'` in `config.js`.
//
// Per-instance data lives in four attributes on the shared quad geometry:
//   aUv    (vec4  u0,v0,u1,v1)  which atlas rect this slot samples
//   aScale (vec2  w,h)          world-space width/height at this slot
//   aFlash (float 0..1)         white hit-flash intensity (see core/spriteAnim)
//   aTint  (vec3  r,g,b)        multiplicative tint (boss phases, etc.)
//   aAnim  (vec3  yOff,sx,sy)   per-frame bob/squash, computed on the CPU each
//                               step by `core/spriteAnim.bob`/`castRaise` and
//                               uploaded here — the shader itself is stateless.
//
// The base quad geometry has local x in [-0.5, 0.5] and y in [0, 1] with feet
// (y=0) at the instance's world position; local uv (0,0) is the quad's *top*
// and (1,1) its *feet*, which lines up directly with `brainrot.json`'s
// top-left-origin, y-down `u0,v0..u1,v1` rects with no inversion — see
// `docs/INTERFACES.md`'s "Billboard atlas UV convention".
//
// `instanceMatrix` (three's automatic per-instance attribute — always
// present on any material rendering an InstancedMesh, custom ShaderMaterial
// included) carries ONLY translation to the slot's feet position; the
// billboard's facing, size and bob are all applied in the vertex shader from
// `aScale`/`aAnim` and `cameraPosition` (a built-in uniform three provides to
// every shader). Zero-scale (`aScale = (0,0)`) is how a hidden/free slot is
// made invisible without touching the instance count.
import * as THREE from 'three';

const _matrix = new THREE.Matrix4();
const _shadowMatrix = new THREE.Matrix4();
const _quatIdentity = new THREE.Quaternion();
const _scaleOne = new THREE.Vector3(1, 1, 1);
const _pos = new THREE.Vector3();
const _shadowScale = new THREE.Vector3();

// Matches Arena.js's HemisphereLight colours exactly (Arena doesn't expose a
// getter for them, so these are the documented fallback constants).
const SKY_COLOR = 0xfff2e0;
const GROUND_COLOR = 0x2a1a12;

const SHADOW_RADIUS = 0.5; // world units; scaled per-instance by sprite width.
const SHADOW_Y = 0.01; // lifted slightly off the floor to avoid z-fighting.

const VERTEX_SHADER = /* glsl */ `
attribute vec4 aUv;
attribute vec2 aScale;
attribute float aFlash;
attribute vec3 aTint;
attribute vec3 aAnim;

varying vec2 vUv;
varying float vFlash;
varying vec3 vTint;
varying vec3 vLight;

uniform vec3 skyColor;
uniform vec3 groundColor;

void main() {
  vec3 feetWorld = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

  // Y-axis-only camera-facing basis: flatten the to-camera vector onto the
  // XZ plane so the quad rotates about Y but never tilts, keeping feet
  // planted regardless of the camera's pitch.
  vec3 toCameraFlat = cameraPosition - feetWorld;
  toCameraFlat.y = 0.0;
  float toCameraLen = length(toCameraFlat);
  vec3 forward = toCameraLen > 1e-5 ? toCameraFlat / toCameraLen : vec3(0.0, 0.0, 1.0);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(up, forward));

  float w = aScale.x * aAnim.y; // aAnim.y = sx (walk squash)
  float h = aScale.y * aAnim.z; // aAnim.z = sy (walk squash)

  vec3 localOffset = right * (position.x * w) + up * (position.y * h + aAnim.x);
  vec3 worldPos = feetWorld + localOffset;

  vUv = mix(aUv.xy, aUv.zw, uv);
  vFlash = aFlash;
  vTint = aTint;

  // Simple hemisphere term so billboards sit in roughly the same light as
  // the voxel MeshLambertMaterial models: blend ground/sky colour by how
  // much the (true, unflattened) to-camera direction points upward.
  vec3 trueToCamera = normalize(cameraPosition - worldPos);
  vLight = mix(groundColor, skyColor, 0.5 + 0.5 * trueToCamera.y);

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying float vFlash;
varying vec3 vTint;
varying vec3 vLight;

void main() {
  vec4 texel = texture2D(map, vUv);
  if (texel.a < 0.5) discard;

  // The atlas texture is marked SRGBColorSpace, but a fully custom
  // ShaderMaterial doesn't get three's automatic decode chunks — approximate
  // the sRGB->linear decode by hand so lit colour math below is correct.
  vec3 albedo = pow(texel.rgb, vec3(2.2));

  vec3 color = albedo * vLight * vTint;
  color = mix(color, vec3(1.0), vFlash);
  gl_FragColor = vec4(color, 1.0);

  // Built-in materials end their fragment shader with this exact chunk to
  // convert their linear result to the renderer's output colour space
  // (sRGB) before the value reaches the framebuffer; a custom ShaderMaterial
  // has to opt in explicitly or every billboard renders too dark next to the
  // voxel MeshLambertMaterial models, which get this for free.
  #include <colorspace_fragment>
}
`;

/**
 * @param {number} cap
 * @returns {THREE.BufferGeometry}
 */
function buildQuadGeometry(cap) {
  const geometry = new THREE.BufferGeometry();
  // Local space: x in [-0.5, 0.5], y in [0 (feet), 1 (top)]. uv.y=0 at the
  // quad's top, 1 at its feet — see the file-top comment for why.
  const positions = new Float32Array([
    -0.5, 0, 0,
    0.5, 0, 0,
    0.5, 1, 0,
    -0.5, 1, 0,
  ]);
  const uvs = new Float32Array([
    0, 1,
    1, 1,
    1, 0,
    0, 0,
  ]);
  const indices = [0, 1, 2, 0, 2, 3];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const aUv = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  const aScale = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
  const aFlash = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
  const aTint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  const aAnim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  // aAnim.y/z (sx/sy squash) default to 1, not 0 — a fresh/hidden slot has
  // aScale = (0,0) already, so this just avoids a transient (0,0,0) triple.
  for (let i = 0; i < cap; i++) {
    aAnim.setXYZ(i, 0, 1, 1);
  }
  for (const attr of [aUv, aScale, aFlash, aTint, aAnim]) attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aUv', aUv);
  geometry.setAttribute('aScale', aScale);
  geometry.setAttribute('aFlash', aFlash);
  geometry.setAttribute('aTint', aTint);
  geometry.setAttribute('aAnim', aAnim);

  return geometry;
}

export class Billboards {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./assets.js').Assets} assets
   * @param {import('../core/types.js').GameConfig} cfg
   * @param {number} cap Max simultaneous billboard units (tungtung + a boss reservation).
   */
  constructor(scene, assets, cfg, cap) {
    this._scene = scene;
    this._assets = assets;
    this._cfg = cfg;
    this._cap = cap;

    const { texture, sprites } = assets.atlas();
    this._sprites = sprites;

    this._geometry = buildQuadGeometry(cap);

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        skyColor: { value: new THREE.Color(SKY_COLOR) },
        groundColor: { value: new THREE.Color(GROUND_COLOR) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: false,
      depthWrite: true,
    });

    this._mesh = new THREE.InstancedMesh(this._geometry, this._material, cap);
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._mesh.frustumCulled = false;
    this._mesh.count = cap;
    this._mesh.name = 'billboards';
    scene.add(this._mesh);

    const shadowGeom = new THREE.CircleGeometry(1, 16);
    shadowGeom.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: cfg.sprites.shadowOpacity,
      depthWrite: false,
    });
    this._shadowMesh = new THREE.InstancedMesh(shadowGeom, shadowMat, cap);
    this._shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._shadowMesh.frustumCulled = false;
    this._shadowMesh.count = cap;
    this._shadowMesh.name = 'billboard-shadows';
    scene.add(this._shadowMesh);

    /** @type {({spriteName:string, width:number, height:number}|null)[]} */
    this._slots = new Array(cap).fill(null);
    /** @type {number[]} */
    this._free = [];
    for (let i = cap - 1; i >= 0; i--) {
      this._free.push(i);
      this._mesh.setMatrixAt(i, _matrix.identity());
      this._shadowMesh.setMatrixAt(i, _shadowMatrix.makeScale(0, 0, 0));
    }
    this._mesh.instanceMatrix.needsUpdate = true;
    this._shadowMesh.instanceMatrix.needsUpdate = true;

    this.count = 0;
  }

  /**
   * @param {string} spriteName Key into `assets.atlas().sprites`.
   * @param {number} height Metres; width is `height * sprite.aspect`.
   * @returns {number} Slot id, or -1 if the pool is exhausted.
   */
  alloc(spriteName, height) {
    const id = this._free.pop();
    if (id === undefined) return -1;

    const sprite = this._sprites[spriteName];
    if (!sprite) throw new Error(`Billboards.alloc: no sprite named "${spriteName}"`);
    const width = height * sprite.aspect;

    this._slots[id] = { spriteName, width, height };
    this.count++;

    this._writeUv(id, sprite);
    this._writeScale(id, 0, 0); // hidden until the first set()
    this._writeAnim(id, 0, 1, 1);
    this._writeFlash(id, 0);
    this._writeTint(id, 1, 1, 1);

    return id;
  }

  /**
   * @param {number} id
   */
  free(id) {
    if (id < 0 || !this._slots[id]) return;
    this._slots[id] = null;
    this._free.push(id);
    this.count--;

    this._writeScale(id, 0, 0);
    _matrix.identity();
    this._mesh.setMatrixAt(id, _matrix);
    _shadowMatrix.makeScale(0, 0, 0);
    this._shadowMesh.setMatrixAt(id, _shadowMatrix);
    this._matrixDirty = true;
    this._shadowDirty = true;
  }

  /**
   * @param {number} id
   * @param {number} x
   * @param {number} z
   * @param {{y:number, sx:number, sy:number}} anim From `core/spriteAnim.bob` (optionally combined with `castRaise`).
   * @param {number} flash 0..1, from `core/spriteAnim.hitFlash`.
   */
  set(id, x, z, anim, flash) {
    const slot = this._slots[id];
    if (!slot) return;

    _pos.set(x, 0, z);
    _matrix.compose(_pos, _quatIdentity, _scaleOne);
    this._mesh.setMatrixAt(id, _matrix);
    this._matrixDirty = true;

    _pos.set(x, SHADOW_Y, z);
    const shadowRadius = SHADOW_RADIUS * slot.width;
    _shadowScale.set(shadowRadius, 1, shadowRadius);
    _shadowMatrix.compose(_pos, _quatIdentity, _shadowScale);
    this._shadowMesh.setMatrixAt(id, _shadowMatrix);
    this._shadowDirty = true;

    // Restore the slot's real world size every call — cheap, and correct
    // whether or not it was previously hidden at (0,0).
    this._writeScale(id, slot.width, slot.height);
    this._writeAnim(id, anim.y, anim.sx, anim.sy);
    this._writeFlash(id, flash);
  }

  /**
   * @param {number} id
   * @param {number} r
   * @param {number} g
   * @param {number} b
   */
  setTint(id, r, g, b) {
    if (!this._slots[id]) return;
    this._writeTint(id, r, g, b);
  }

  /**
   * @param {number} id
   * @param {{x:number,y:number,w:number,h:number,u0:number,v0:number,u1:number,v1:number,aspect:number}} sprite
   */
  _writeUv(id, sprite) {
    const attr = this._geometry.getAttribute('aUv');
    attr.setXYZW(id, sprite.u0, sprite.v0, sprite.u1, sprite.v1);
    this._uvDirty = true;
  }

  /**
   * @param {number} id
   * @param {number} w
   * @param {number} h
   */
  _writeScale(id, w, h) {
    const attr = this._geometry.getAttribute('aScale');
    attr.setXY(id, w, h);
    this._scaleDirty = true;
  }

  /**
   * @param {number} id
   * @param {number} y
   * @param {number} sx
   * @param {number} sy
   */
  _writeAnim(id, y, sx, sy) {
    const attr = this._geometry.getAttribute('aAnim');
    attr.setXYZ(id, y, sx, sy);
    this._animDirty = true;
  }

  /**
   * @param {number} id
   * @param {number} flash
   */
  _writeFlash(id, flash) {
    const attr = this._geometry.getAttribute('aFlash');
    attr.setX(id, flash);
    this._flashDirty = true;
  }

  /**
   * @param {number} id
   * @param {number} r
   * @param {number} g
   * @param {number} b
   */
  _writeTint(id, r, g, b) {
    const attr = this._geometry.getAttribute('aTint');
    attr.setXYZ(id, r, g, b);
    this._tintDirty = true;
  }

  /**
   * Uploads attributes to the GPU, only for what actually changed since the
   * last call.
   * @param {number} _dt Unused — kept for API symmetry with other systems.
   */
  update(_dt) {
    if (this._matrixDirty) {
      this._mesh.instanceMatrix.needsUpdate = true;
      this._matrixDirty = false;
    }
    if (this._shadowDirty) {
      this._shadowMesh.instanceMatrix.needsUpdate = true;
      this._shadowDirty = false;
    }
    if (this._uvDirty) {
      this._geometry.getAttribute('aUv').needsUpdate = true;
      this._uvDirty = false;
    }
    if (this._scaleDirty) {
      this._geometry.getAttribute('aScale').needsUpdate = true;
      this._scaleDirty = false;
    }
    if (this._flashDirty) {
      this._geometry.getAttribute('aFlash').needsUpdate = true;
      this._flashDirty = false;
    }
    if (this._tintDirty) {
      this._geometry.getAttribute('aTint').needsUpdate = true;
      this._tintDirty = false;
    }
    if (this._animDirty) {
      this._geometry.getAttribute('aAnim').needsUpdate = true;
      this._animDirty = false;
    }
  }

  dispose() {
    this._geometry.dispose();
    this._material.dispose();
    this._mesh.removeFromParent();
    this._shadowMesh.geometry.dispose();
    this._shadowMesh.material.dispose();
    this._shadowMesh.removeFromParent();
  }
}
