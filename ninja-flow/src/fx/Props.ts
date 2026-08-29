import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TetrahedronGeometry,
  type Scene,
} from 'three';
import { PHYSICS } from '../config';
import { DEBRIS_SHAPES } from '../game/Weapons';
import { RigidBody } from './Physics';

/**
 * Physical debris: the weapons and armour that leave a fight when a body does.
 *
 * When a strike lands, the enemy is not the only thing that should move. Its
 * blade leaves its hand and clatters across the floor; a broken guard plate
 * comes apart into pieces that bounce and settle. These props are what tell the
 * eye the hit had force behind it, and unlike the bodies they stay on the
 * ground afterwards, so the arena accumulates evidence of the fight.
 *
 * Everything is pooled and drawn from a fixed budget: a long run must never
 * allocate, and a crowded wave must never outgrow its frame time.
 */

interface Prop {
  mesh: Mesh;
  body: RigidBody;
  life: number;
  ttl: number;
  active: boolean;
}

const BLADES = 10;
const SHARDS = 28;

export class Props {
  private readonly group = new Group();
  private readonly blades: Prop[] = [];
  private readonly shards: Prop[] = [];
  private readonly materials = new Map<number, MeshStandardMaterial>();

  constructor(scene: Scene) {
    scene.add(this.group);

    // One pool per silhouette, so a dropped staff lands as a staff.
    for (let i = 0; i < BLADES; i++) this.blades.push(this.make(DEBRIS_SHAPES.blade));

    const shardGeo = new TetrahedronGeometry(0.11);
    for (let i = 0; i < SHARDS; i++) this.shards.push(this.make(shardGeo));
  }

  private make(geometry: BoxGeometry | TetrahedronGeometry): Prop {
    const mesh = new Mesh(geometry, this.materialFor(0x9fb0c8));
    mesh.castShadow = true;
    mesh.visible = false;
    this.group.add(mesh);
    return { mesh, body: new RigidBody(), life: 0, ttl: 0, active: false };
  }

  private materialFor(color: number): MeshStandardMaterial {
    let m = this.materials.get(color);
    if (!m) {
      m = new MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.65 });
      this.materials.set(color, m);
    }
    return m;
  }

  /**
   * A weapon knocked out of a hand. `outward` is the direction the body was
   * struck in, so the blade follows the force rather than a canned arc.
   */
  dropBlade(
    x: number,
    y: number,
    z: number,
    outward: number,
    power: number,
    color: number,
    shape: keyof typeof DEBRIS_SHAPES = 'blade',
  ): void {
    const prop = take(this.blades);
    if (!prop) return;
    prop.mesh.material = this.materialFor(color);
    prop.mesh.geometry = DEBRIS_SHAPES[shape];
    prop.body.reset({
      gravity: PHYSICS.propGravity,
      restitution: PHYSICS.propRestitution,
      friction: PHYSICS.propFriction,
      angularDamping: 0.7,
      sleepSpeed: 0.5,
      radius: 0.07,
    });
    // A blade leaving a hand keeps the swing that took it: mostly outward,
    // with enough lift to arc and enough spin to tumble on the way down.
    prop.body.launch(
      { x, y, z },
      { x: outward * (2.4 + power * 1.6), y: 3.4 + power * 1.4, z: -0.8 - power * 0.4 },
      { x: 5 + power * 3, y: 2.5, z: outward * (9 + power * 5) },
    );
    activate(prop, PHYSICS.propLife);
  }

  /**
   * Armour coming apart. Pieces are thrown back along the strike, which is what
   * makes a broken guard read as broken rather than merely dropped.
   */
  shatter(x: number, y: number, z: number, outward: number, count: number, color: number): void {
    for (let i = 0; i < count; i++) {
      const prop = take(this.shards);
      if (!prop) return;
      prop.mesh.material = this.materialFor(color);
      prop.body.reset({
        gravity: PHYSICS.propGravity,
        restitution: 0.3,
        friction: 0.5,
        angularDamping: 1.1,
        sleepSpeed: 0.45,
        radius: 0.055,
      });
      // Fanned deterministically rather than randomly: physics must never draw
      // from the seeded gameplay stream.
      const spread = (i / Math.max(1, count - 1)) * 2 - 1;
      prop.body.launch(
        { x, y, z },
        {
          x: outward * (1.6 + Math.abs(spread) * 2.2),
          y: 2.6 + spread * 1.4,
          z: spread * 1.8,
        },
        { x: 8 * spread, y: 6, z: outward * 11 },
      );
      activate(prop, PHYSICS.propLife * 0.8);
    }
  }

  update(dt: number): void {
    step(this.blades, dt);
    step(this.shards, dt);
  }

  /** Clears the floor, e.g. when a run restarts. */
  clear(): void {
    for (const p of [...this.blades, ...this.shards]) {
      p.active = false;
      p.mesh.visible = false;
    }
  }

  /** Props currently on screen. Dev-only verification reads this. */
  get activeCount(): number {
    let n = 0;
    for (const p of this.blades) if (p.active) n++;
    for (const p of this.shards) if (p.active) n++;
    return n;
  }
}

function activate(prop: Prop, ttl: number): void {
  prop.life = 0;
  prop.ttl = ttl;
  prop.active = true;
  prop.mesh.visible = true;
  prop.mesh.scale.setScalar(1);
}

function take(pool: Prop[]): Prop | null {
  for (const p of pool) if (!p.active) return p;
  // Pool exhausted: recycle the oldest rather than allocate mid-fight.
  let oldest = pool[0];
  for (const p of pool) if (p.life > oldest.life) oldest = p;
  return oldest ?? null;
}

function step(pool: Prop[], dt: number): void {
  for (const p of pool) {
    if (!p.active) continue;
    p.life += dt;
    if (p.life >= p.ttl) {
      p.active = false;
      p.mesh.visible = false;
      continue;
    }
    p.body.step(dt);
    p.mesh.position.copy(p.body.position);
    p.mesh.rotation.set(p.body.rotation.x, p.body.rotation.y, p.body.rotation.z);
    // Props sink out in their last moments rather than popping, and only once
    // they have finished moving, so nothing vanishes mid-bounce.
    const fade = (p.life - p.ttl * 0.82) / (p.ttl * 0.18);
    if (fade > 0) p.mesh.scale.setScalar(Math.max(0.001, 1 - fade));
  }
}
