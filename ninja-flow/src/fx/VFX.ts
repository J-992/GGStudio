import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  Sprite,
  SpriteMaterial,
  Texture,
  TorusGeometry,
} from 'three';
import { VFX as CFG } from '../config';

/**
 * Pooled combat effects.
 *
 * Everything is allocated once at construction and recycled: mid-run garbage is
 * the fastest way to lose 60 FPS on a phone. Effects are also deliberately
 * short and centred on the impact point, so they never sit between the camera
 * and an approaching threat.
 */

type Live<T> = { obj: T; life: number; ttl: number; data: number[] };

function radialTexture(inner: string, outer: string): Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, outer);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new Texture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** A crescent slash arc, built as a partial torus so it reads as a blade path. */
function slashGeometry(): BufferGeometry {
  return new TorusGeometry(0.72, 0.11, 6, 22, Math.PI * 1.15);
}

export class VFX {
  private readonly group = new Group();
  private readonly slashes: Live<Mesh>[] = [];
  private readonly rings: Live<Mesh>[] = [];
  private readonly sparks: Live<Points>[] = [];
  private readonly flashes: Live<Sprite>[] = [];
  private readonly trail: Live<Sprite>[] = [];
  private readonly blades: Live<Mesh>[] = [];

  constructor(scene: Scene) {
    scene.add(this.group);

    const slashGeo = slashGeometry();
    for (let i = 0; i < CFG.poolSize.slash; i++) {
      const mesh = new Mesh(
        slashGeo,
        new MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      mesh.visible = false;
      this.group.add(mesh);
      this.slashes.push({ obj: mesh, life: 0, ttl: 0, data: [] });
    }

    const ringGeo = new RingGeometry(0.5, 0.62, 28);
    for (let i = 0; i < CFG.poolSize.burst; i++) {
      const mesh = new Mesh(
        ringGeo,
        new MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
          side: 2,
        }),
      );
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ obj: mesh, life: 0, ttl: 0, data: [] });
    }

    const flashTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,214,150,0.75)');
    for (let i = 0; i < CFG.poolSize.burst; i++) {
      const sprite = new Sprite(
        new SpriteMaterial({
          map: flashTex,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      sprite.visible = false;
      this.group.add(sprite);
      this.flashes.push({ obj: sprite, life: 0, ttl: 0, data: [] });
    }

    const trailTex = radialTexture('rgba(180,230,255,0.9)', 'rgba(110,160,255,0.4)');
    for (let i = 0; i < 18; i++) {
      const sprite = new Sprite(
        new SpriteMaterial({
          map: trailTex,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      sprite.visible = false;
      this.group.add(sprite);
      this.trail.push({ obj: sprite, life: 0, ttl: 0, data: [] });
    }

    // Thrown steel: a small quantised blade that spins along its flight path.
    const bladeGeo = new BoxGeometry(0.46, 0.055, 0.11);
    for (let i = 0; i < 6; i++) {
      const mesh = new Mesh(
        bladeGeo,
        new MeshBasicMaterial({ color: 0xe8f2ff, transparent: true, depthWrite: false }),
      );
      mesh.visible = false;
      this.group.add(mesh);
      this.blades.push({ obj: mesh, life: 0, ttl: 0, data: [] });
    }

    for (let i = 0; i < CFG.poolSize.spark; i++) {
      const count = 14;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 3), 3));
      const pts = new Points(
        geo,
        new PointsMaterial({
          size: 0.16,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
          color: 0xfff0c0,
        }),
      );
      pts.visible = false;
      pts.frustumCulled = false;
      this.group.add(pts);
      this.sparks.push({ obj: pts, life: 0, ttl: 0, data: new Array(count * 3).fill(0) });
    }
  }

  /** Main impact effect. `intensity` maps GOOD → PERFECT → FINISHER. */
  impact(x: number, y: number, intensity: number, color: number): void {
    const scale = intensity;

    const slash = this.take(this.slashes);
    if (slash) {
      slash.obj.position.set(x, y, 0.35);
      slash.obj.rotation.set(0, 0, Math.sign(x) * 0.9 + Math.PI * 0.15);
      slash.obj.scale.setScalar(scale * 0.7);
      (slash.obj.material as MeshBasicMaterial).color.setHex(color);
      slash.ttl = 0.22;
      slash.life = 0;
      slash.data = [scale];
      slash.obj.visible = true;
    }

    const flash = this.take(this.flashes);
    if (flash) {
      flash.obj.position.set(x, y, 0.5);
      flash.obj.scale.setScalar(scale * 1.3);
      (flash.obj.material as SpriteMaterial).color.setHex(color);
      flash.ttl = 0.16;
      flash.life = 0;
      flash.data = [scale];
      flash.obj.visible = true;
    }

    if (intensity >= CFG.slashScale.perfect) {
      const ring = this.take(this.rings);
      if (ring) {
        ring.obj.position.set(x, y, 0.2);
        ring.obj.rotation.set(0, 0, 0);
        ring.obj.scale.setScalar(0.4);
        (ring.obj.material as MeshBasicMaterial).color.setHex(color);
        ring.ttl = 0.34;
        ring.life = 0;
        ring.data = [scale];
        ring.obj.visible = true;
      }
    }

    const spark = this.take(this.sparks);
    if (spark) {
      const pos = spark.obj.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = (0.5 + Math.random()) * scale;
        spark.data[i * 3] = Math.cos(a) * s * 5;
        spark.data[i * 3 + 1] = Math.sin(a) * s * 5 + 2;
        spark.data[i * 3 + 2] = (Math.random() - 0.5) * s * 3;
        pos.setXYZ(i, x, y, 0.2);
      }
      pos.needsUpdate = true;
      (spark.obj.material as PointsMaterial).color.setHex(color);
      spark.ttl = 0.42;
      spark.life = 0;
      spark.obj.visible = true;
    }
  }

  /** Speed streak left behind a Flow dash. */
  dashTrail(fromX: number, toX: number, y: number): void {
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const sprite = this.take(this.trail);
      if (!sprite) return;
      sprite.obj.position.set(fromX + (toX - fromX) * t, y + Math.sin(t * Math.PI) * 0.15, 0.1);
      sprite.obj.scale.set(1.5, 0.45, 1);
      sprite.ttl = 0.26 + t * 0.08;
      sprite.life = 0;
      sprite.data = [1];
      sprite.obj.visible = true;
    }
  }

  /**
   * A thrown weapon in flight. The blade travels a slight arc and spins; the
   * caller lands the impact separately, so the flight is purely what the eye
   * follows between the throw and the hit.
   */
  blade(fromX: number, fromY: number, toX: number, toY: number, seconds: number): void {
    const b = this.take(this.blades);
    if (!b) return;
    b.obj.position.set(fromX, fromY, 0.05);
    b.obj.visible = true;
    b.ttl = Math.max(0.08, seconds);
    b.life = 0;
    b.data = [fromX, fromY, toX, toY, Math.sign(toX - fromX) || 1];
    this.dashTrail(fromX, fromX + (toX - fromX) * 0.2, fromY);
  }

  /** Struck-metal sparks, used when a strike is stopped by a guard plate. */
  sparkBurst(x: number, y: number, color: number): void {
    const spark = this.take(this.sparks);
    if (!spark) return;
    const pos = spark.obj.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, x, y, 0);
      const a = (i / pos.count) * Math.PI * 2;
      spark.data[i * 3] = Math.cos(a) * 3.4 - Math.sign(x) * 2.2;
      spark.data[i * 3 + 1] = Math.sin(a) * 3.4 + 2;
      spark.data[i * 3 + 2] = 0;
    }
    pos.needsUpdate = true;
    (spark.obj.material as PointsMaterial).color.setHex(color);
    spark.ttl = 0.34;
    spark.life = 0;
    spark.obj.visible = true;
  }

  /** Floor puff for slides, landings and slams. */
  dust(x: number, scale = 1): void {
    const ring = this.take(this.rings);
    if (ring) {
      ring.obj.position.set(x, 0.08, 0.1);
      ring.obj.rotation.set(-Math.PI / 2, 0, 0);
      ring.obj.scale.setScalar(0.25 * scale);
      (ring.obj.material as MeshBasicMaterial).color.setHex(0xbfc6e0);
      ring.ttl = 0.42;
      ring.life = 0;
      ring.data = [scale * 2.2];
      ring.obj.visible = true;
    }
    const sprite = this.take(this.trail);
    if (!sprite) return;
    sprite.obj.position.set(x, 0.22 * scale, 0.08);
    sprite.obj.scale.set(1.1 * scale, 0.6 * scale, 1);
    sprite.ttl = 0.3;
    sprite.life = 0;
    sprite.data = [1];
    sprite.obj.visible = true;
  }

  /** Expanding shockwave used for Flow activation and the finisher. */
  shockwave(x: number, y: number, scale: number, color: number): void {
    const ring = this.take(this.rings);
    if (!ring) return;
    ring.obj.position.set(x, y, 0.1);
    ring.obj.rotation.set(0, 0, 0);
    ring.obj.scale.setScalar(0.3);
    (ring.obj.material as MeshBasicMaterial).color.setHex(color);
    ring.ttl = 0.55;
    ring.life = 0;
    ring.data = [scale * 3];
    ring.obj.visible = true;
  }

  /** Thrown blades currently in the air. Used by dev-only verification. */
  get bladesInFlight(): number {
    let n = 0;
    for (const b of this.blades) if (b.obj.visible) n++;
    return n;
  }

  update(dt: number): void {
    for (const b of this.blades) {
      if (!b.obj.visible) continue;
      b.life += dt;
      const t = b.life / b.ttl;
      if (t >= 1) {
        b.obj.visible = false;
        continue;
      }
      const [fx, fy, tx, ty, dir] = b.data;
      b.obj.position.x = fx + (tx - fx) * t;
      b.obj.position.y = fy + (ty - fy) * t + Math.sin(t * Math.PI) * 0.22;
      b.obj.rotation.z += dt * 34 * dir;
      (b.obj.material as MeshBasicMaterial).opacity = 1;
    }

    for (const s of this.slashes) {
      if (!s.obj.visible) continue;
      s.life += dt;
      const t = s.life / s.ttl;
      if (t >= 1) {
        s.obj.visible = false;
        continue;
      }
      s.obj.scale.setScalar(s.data[0] * (0.7 + t * 0.85));
      s.obj.rotation.z += dt * 3.5 * Math.sign(s.obj.position.x || 1);
      (s.obj.material as MeshBasicMaterial).opacity = 1 - t * t;
    }

    for (const r of this.rings) {
      if (!r.obj.visible) continue;
      r.life += dt;
      const t = r.life / r.ttl;
      if (t >= 1) {
        r.obj.visible = false;
        continue;
      }
      r.obj.scale.setScalar(0.3 + easeOut(t) * (r.data[0] ?? 2));
      (r.obj.material as MeshBasicMaterial).opacity = (1 - t) * 0.85;
    }

    for (const f of this.flashes) {
      if (!f.obj.visible) continue;
      f.life += dt;
      const t = f.life / f.ttl;
      if (t >= 1) {
        f.obj.visible = false;
        continue;
      }
      f.obj.scale.setScalar(f.data[0] * (1.3 + t * 1.4));
      (f.obj.material as SpriteMaterial).opacity = 1 - t;
    }

    for (const s of this.trail) {
      if (!s.obj.visible) continue;
      s.life += dt;
      const t = s.life / s.ttl;
      if (t >= 1) {
        s.obj.visible = false;
        continue;
      }
      (s.obj.material as SpriteMaterial).opacity = (1 - t) * 0.7;
      s.obj.scale.x = 1.5 + t * 0.8;
    }

    for (const p of this.sparks) {
      if (!p.obj.visible) continue;
      p.life += dt;
      const t = p.life / p.ttl;
      if (t >= 1) {
        p.obj.visible = false;
        continue;
      }
      const pos = p.obj.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        p.data[i * 3 + 1] -= 22 * dt;
        pos.setXYZ(
          i,
          pos.getX(i) + p.data[i * 3] * dt,
          pos.getY(i) + p.data[i * 3 + 1] * dt,
          pos.getZ(i) + p.data[i * 3 + 2] * dt,
        );
      }
      pos.needsUpdate = true;
      (p.obj.material as PointsMaterial).opacity = 1 - t;
    }
  }

  private take<T extends { visible: boolean }>(pool: Live<T>[]): Live<T> | null {
    for (const item of pool) if (!item.obj.visible) return item;
    // Pool exhausted: steal the oldest rather than allocating mid-combat.
    let oldest = pool[0];
    for (const item of pool) if (item.life > oldest.life) oldest = item;
    return oldest ?? null;
  }
}

export const IMPACT_COLOR = {
  good: 0xbfd8ff,
  perfect: 0xffd88a,
  flow: 0x8affd8,
  finisher: 0xffb347,
  damage: 0xff5b5b,
  rare: 0xffe066,
  guard: 0xdfe7f5,
} as const;

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export function colorOf(hex: number): Color {
  return new Color(hex);
}
