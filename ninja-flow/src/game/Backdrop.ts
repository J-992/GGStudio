import {
  AdditiveBlending,
  BackSide,
  DoubleSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
  type Scene,
} from 'three';

/**
 * Everything beyond the garden.
 *
 * The arena used to end at a flat background colour, which reads as an empty
 * grey void the moment the camera lifts for a cinematic shot. This is the world
 * the fight happens inside: a graded sky, ridges of hills receding into haze, a
 * sun that agrees with the key light, drifting cloud banks, and the silhouettes
 * of a pagoda and a torii out on the far ridge.
 *
 * Two rules keep it honest:
 *   1. Everything here is FAR. It never fights the arena for attention, and it
 *      is graded toward the horizon colour so distance reads as air, not paint.
 *   2. It answers to the weather the arena already runs. One horizon colour and
 *      one gloom value drive the whole backdrop, so a storm darkens the hills
 *      and swallows the sun without a second weather system to keep in sync.
 */

const SKY_RADIUS = 108;

/** Ridge rings: distance, height, and how far each is graded into the haze. */
const RIDGES = [
  { radius: 92, height: 26, haze: 0.58, tint: 0x3d5f7d, points: 34, jitter: 0.55 },
  { radius: 74, height: 19, haze: 0.38, tint: 0x33506b, points: 30, jitter: 0.7 },
  { radius: 58, height: 13, haze: 0.2, tint: 0x284057, points: 26, jitter: 0.85 },
] as const;

const CLOUD_COUNT = 14;
const BIRD_COUNT = 7;

export class Backdrop {
  private readonly group = new Group();
  private readonly dome: Mesh;
  private readonly domeMaterial: ShaderMaterial;
  private readonly ridges: { mesh: Mesh; material: MeshBasicMaterial; tint: Color; haze: number }[] = [];
  private readonly sun: Mesh;
  private readonly sunGlow: Mesh;
  private readonly sunMaterial: MeshBasicMaterial;
  private readonly glowMaterial: MeshBasicMaterial;
  private readonly clouds: InstancedMesh;
  private readonly cloudMaterial: MeshBasicMaterial;
  private readonly cloudDrift: { x: number; y: number; z: number; scale: number; speed: number }[] = [];
  private readonly birds: InstancedMesh;
  private readonly birdMaterial: MeshBasicMaterial;
  private readonly birdPaths: { radius: number; height: number; phase: number; speed: number }[] = [];
  private readonly dummy = new Object3D();
  private readonly scratch = new Color();
  private time = 0;

  constructor(scene: Scene) {
    // --- sky dome ---------------------------------------------------------
    this.domeMaterial = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        horizon: { value: new Color(0xa8cad4) },
        zenith: { value: new Color(0x4d80ad) },
        glow: { value: new Color(0xffd9a8) },
        sunDir: { value: new Object3D().position.set(0.38, 0.32, -0.87) },
        glowStrength: { value: 1 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 horizon;
        uniform vec3 zenith;
        uniform vec3 glow;
        uniform vec3 sunDir;
        uniform float glowStrength;
        varying vec3 vDir;
        void main() {
          // Height gradient, eased so the horizon band stays tight rather than
          // washing halfway up the sky.
          float h = clamp(vDir.y * 1.35 + 0.06, 0.0, 1.0);
          vec3 col = mix(horizon, zenith, pow(h, 0.62));
          // Warm bloom around the sun, strongest at the horizon.
          float d = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += glow * pow(d, 6.0) * 0.55 * glowStrength;
          col += glow * pow(d, 2.0) * 0.09 * glowStrength;
          // A raw ShaderMaterial gets none of three's output chunks, so the
          // linear working colour is converted to sRGB here. Without this the
          // whole sky renders roughly a stop and a half too dark.
          vec3 srgb = mix(
            col * 12.92,
            1.055 * pow(max(col, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
            step(vec3(0.0031308), col)
          );
          gl_FragColor = vec4(srgb, 1.0);
        }
      `,
    });
    this.dome = new Mesh(new SphereGeometry(SKY_RADIUS, 24, 16), this.domeMaterial);
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // --- sun --------------------------------------------------------------
    this.sunMaterial = new MeshBasicMaterial({
      color: 0xfff2d0,
      fog: false,
      transparent: true,
      depthWrite: false,
    });
    this.sun = new Mesh(new SphereGeometry(2.6, 14, 10), this.sunMaterial);
    this.glowMaterial = new MeshBasicMaterial({
      color: 0xffd9a0,
      fog: false,
      transparent: true,
      opacity: 0.3,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.sunGlow = new Mesh(new SphereGeometry(6.4, 14, 10), this.glowMaterial);
    // Placed along the key light's own direction, so the brightest part of the
    // sky is where the shadows say the light comes from.
    // The camera looks down -Z, so the sun belongs there — behind the dojo,
    // in frame, and on the same side the key light throws its shadows from.
    const sunPos = { x: 0.38, y: 0.3, z: -0.87 };
    const at = SKY_RADIUS * 0.86;
    this.sun.position.set(sunPos.x * at, sunPos.y * at, sunPos.z * at);
    this.sunGlow.position.copy(this.sun.position);
    this.group.add(this.sun, this.sunGlow);

    // --- ridges -----------------------------------------------------------
    for (const spec of RIDGES) {
      // Double-sided: a ring seen from inside is easy to wind the wrong way,
      // and a hundred triangles are not worth the risk of an invisible ridge.
      const material = new MeshBasicMaterial({ color: spec.tint, fog: false, side: DoubleSide });
      const mesh = new Mesh(ridgeGeometry(spec.radius, spec.height, spec.points, spec.jitter), material);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.ridges.push({ mesh, material, tint: new Color(spec.tint), haze: spec.haze });
    }
    this.group.add(this.landmarks());

    // --- clouds -----------------------------------------------------------
    this.cloudMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      fog: false,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.clouds = new InstancedMesh(cloudGeometry(), this.cloudMaterial, CLOUD_COUNT);
    this.clouds.frustumCulled = false;
    for (let i = 0; i < CLOUD_COUNT; i++) {
      // Deterministic placement: the backdrop never draws gameplay randomness.
      const t = i / CLOUD_COUNT;
      this.cloudDrift.push({
        x: (t * 2 - 1) * 78,
        y: 20 + Math.sin(i * 2.7) * 7,
        z: -34 - ((i * 37) % 52),
        scale: 5 + ((i * 13) % 7),
        speed: 0.32 + ((i * 7) % 5) * 0.06,
      });
    }
    this.group.add(this.clouds);

    // --- birds ------------------------------------------------------------
    this.birdMaterial = new MeshBasicMaterial({ color: 0x2b3a4a, fog: false, transparent: true });
    this.birds = new InstancedMesh(birdGeometry(), this.birdMaterial, BIRD_COUNT);
    this.birds.frustumCulled = false;
    for (let i = 0; i < BIRD_COUNT; i++) {
      this.birdPaths.push({
        radius: 26 + i * 2.4,
        height: 13 + Math.sin(i * 1.9) * 3.5,
        phase: i * 0.9,
        speed: 0.055 + (i % 3) * 0.012,
      });
    }
    this.group.add(this.birds);

    this.group.renderOrder = -10;
    scene.add(this.group);
    this.update(0, new Color(WEATHER_HORIZON), 0, 0);
  }

  /**
   * @param horizon the arena's current sky colour, so fog and backdrop agree
   * @param gloom   0 clear, 1 storm — dims the sun and flattens the hills
   * @param flash   lightning, 0..1
   */
  update(dt: number, horizon: Color, gloom: number, flash: number): void {
    this.time += dt;

    const h = this.domeMaterial.uniforms.horizon.value as Color;
    const z = this.domeMaterial.uniforms.zenith.value as Color;
    h.copy(horizon);
    // A clear sky deepens toward the zenith; an overcast one flattens out, which
    // is most of what makes weather read at a glance.
    z.copy(horizon).lerp(this.scratch.setHex(0x35618f), 0.72 * (1 - gloom * 0.82));
    if (flash > 0) {
      h.lerp(this.scratch.setHex(0xdce8ff), flash * 0.65);
      z.lerp(this.scratch.setHex(0xdce8ff), flash * 0.5);
    }
    this.domeMaterial.uniforms.glowStrength.value = (1 - gloom) * 0.9 + 0.1;

    const sunFade = 1 - gloom;
    this.sunMaterial.opacity = 0.15 + sunFade * 0.85;
    this.glowMaterial.opacity = 0.05 + sunFade * 0.3;

    // Ridges are graded toward the horizon by distance: the far ring almost
    // dissolves, the near one keeps its shape. That gradient IS the depth.
    for (const ridge of this.ridges) {
      ridge.material.color
        .copy(ridge.tint)
        .lerp(horizon, ridge.haze * (0.7 + gloom * 0.3))
        .lerp(this.scratch.setHex(0xdce8ff), flash * 0.4);
    }

    this.cloudMaterial.opacity = 0.28 + gloom * 0.5;
    this.cloudMaterial.color.copy(this.scratch.setHex(0xffffff)).lerp(horizon, gloom * 0.55);
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const c = this.cloudDrift[i];
      // Wrapped by hand rather than by modulo on a growing number, so this stays
      // exact over a long session.
      c.x += c.speed * dt;
      if (c.x > 82) c.x = -82;
      this.dummy.position.set(c.x, c.y, c.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(c.scale, c.scale * 0.42, 1);
      this.dummy.updateMatrix();
      this.clouds.setMatrixAt(i, this.dummy.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true;

    // Birds only come out when the weather is kind.
    this.birdMaterial.opacity = Math.max(0, 1 - gloom * 1.6);
    this.birds.visible = this.birdMaterial.opacity > 0.02;
    if (this.birds.visible) {
      for (let i = 0; i < BIRD_COUNT; i++) {
        const b = this.birdPaths[i];
        const a = b.phase + this.time * b.speed;
        this.dummy.position.set(
          Math.cos(a) * b.radius,
          b.height + Math.sin(a * 2.3) * 0.8,
          Math.sin(a) * b.radius - 18,
        );
        this.dummy.rotation.set(0, -a, Math.sin(a * 3.1) * 0.25);
        this.dummy.scale.setScalar(0.9);
        this.dummy.updateMatrix();
        this.birds.setMatrixAt(i, this.dummy.matrix);
      }
      this.birds.instanceMatrix.needsUpdate = true;
    }
  }

  /** Dev-only: the colours currently driving the sky, for visual debugging. */
  get debug(): { horizon: string; zenith: string; glow: number } {
    const h = this.domeMaterial.uniforms.horizon.value as Color;
    const z = this.domeMaterial.uniforms.zenith.value as Color;
    return {
      horizon: `#${h.getHexString()}`,
      zenith: `#${z.getHexString()}`,
      glow: this.domeMaterial.uniforms.glowStrength.value as number,
    };
  }

  /** A pagoda and a torii on the far ridge — the theme, read at a glance. */
  private landmarks(): Group {
    const g = new Group();
    const material = new MeshBasicMaterial({ color: 0x22394d, fog: false });

    const pagoda = new Group();
    for (let i = 0; i < 5; i++) {
      const w = 4.6 - i * 0.72;
      const roof = new Mesh(coneGeometry(w, 1.15, 4), material);
      roof.position.y = 3 + i * 2.5;
      roof.rotation.y = Math.PI * 0.25;
      const body = new Mesh(boxGeometry(w * 0.52, 1.5, w * 0.52), material);
      body.position.y = 4.1 + i * 2.5;
      pagoda.add(roof, body);
    }
    pagoda.position.set(-34, 7, -66);
    pagoda.scale.setScalar(1.15);

    const torii = new Group();
    const postL = new Mesh(boxGeometry(0.7, 9, 0.7), material);
    postL.position.set(-3.1, 4.5, 0);
    const postR = new Mesh(boxGeometry(0.7, 9, 0.7), material);
    postR.position.set(3.1, 4.5, 0);
    const top = new Mesh(boxGeometry(9.2, 0.9, 1), material);
    top.position.y = 9.2;
    const under = new Mesh(boxGeometry(7.4, 0.6, 0.8), material);
    under.position.y = 7.6;
    torii.add(postL, postR, top, under);
    torii.position.set(33, 5, -60);

    g.add(pagoda, torii);
    return g;
  }
}

const WEATHER_HORIZON = 0xa8cad4;

/** A ring of hills: a closed strip with a jagged top edge. */
function ridgeGeometry(radius: number, height: number, points: number, jitter: number): BufferGeometry {
  const positions: number[] = [];
  const heights: number[] = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    // Layered sines rather than random, so a ridge is reproducible and smooth.
    const n =
      Math.sin(t * Math.PI * 2 * 3 + radius) * 0.5 +
      Math.sin(t * Math.PI * 2 * 7 + radius * 0.7) * 0.3 +
      Math.sin(t * Math.PI * 2 * 13 + radius * 1.3) * 0.2;
    heights.push(height * (0.45 + (n * 0.5 + 0.5) * jitter));
  }
  heights[points] = heights[0];

  for (let i = 0; i < points; i++) {
    const a0 = (i / points) * Math.PI * 2;
    const a1 = ((i + 1) / points) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius;
    const z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const z1 = Math.sin(a1) * radius;
    const y0 = heights[i];
    const y1 = heights[i + 1];
    // Two triangles per segment, skirted well below the horizon so no gap can
    // ever show between the hills and the ground.
    positions.push(x0, -8, z0, x1, -8, z1, x1, y1, z1);
    positions.push(x0, -8, z0, x1, y1, z1, x0, y0, z0);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.computeVertexNormals();
  return geo;
}

function cloudGeometry(): BufferGeometry {
  // A soft lozenge built from three overlapping quads — low poly, reads as a
  // stylised cloud bank rather than a sprite.
  const positions: number[] = [];
  const blobs = [
    [0, 0, 1],
    [-0.62, -0.12, 0.72],
    [0.66, -0.08, 0.66],
  ];
  for (const [cx, cy, r] of blobs) {
    const segments = 7;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      positions.push(cx, cy, 0);
      positions.push(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r * 0.75, 0);
      positions.push(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r * 0.75, 0);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.computeVertexNormals();
  return geo;
}

function birdGeometry(): BufferGeometry {
  const positions = new Float32Array([
    -0.5, 0, 0, 0, 0.18, 0, -0.42, 0.06, 0,
    0.5, 0, 0, 0.42, 0.06, 0, 0, 0.18, 0,
  ]);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function boxGeometry(w: number, h: number, d: number): BufferGeometry {
  const geo = new BufferGeometry();
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  const v = [
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
    [-x, -y, -z], [-x, y, -z], [x, y, -z], [x, -y, -z],
  ];
  const faces = [
    [0, 1, 2, 3], [7, 4, 5, 6], [3, 2, 6, 5], [4, 7, 1, 0], [1, 7, 6, 2], [4, 0, 3, 5],
  ];
  const positions: number[] = [];
  for (const [a, b, c, d2] of faces) {
    positions.push(...v[a], ...v[b], ...v[c]);
    positions.push(...v[a], ...v[c], ...v[d2]);
  }
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.computeVertexNormals();
  return geo;
}

function coneGeometry(radius: number, height: number, sides: number): BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    positions.push(0, height, 0);
    positions.push(Math.cos(a0) * radius, 0, Math.sin(a0) * radius);
    positions.push(Math.cos(a1) * radius, 0, Math.sin(a1) * radius);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.computeVertexNormals();
  return geo;
}
