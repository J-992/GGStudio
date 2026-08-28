import Phaser from 'phaser';

export type AttackTrailKind = 'blade' | 'water' | 'fire' | 'lightning' | 'shadow';

type Trail = {
  active: boolean;
  age: number;
  lifetime: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  controlX: number;
  controlY: number;
  width: number;
  color: number;
  kind: AttackTrailKind;
  phase: number;
  graphics: Phaser.GameObjects.Graphics;
};

const POOL_SIZE = 18;
const SAMPLES = 12;

/** Bounded procedural trails for fast attacks; every Graphics object is reused. */
export class TrailSystem {
  private readonly trails: Trail[] = [];
  private cursor = 0;

  constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container) {
    for (let index = 0; index < POOL_SIZE; index += 1) {
      const graphics = scene.add.graphics();
      parent.add(graphics);
      this.trails.push({
        active: false,
        age: 0,
        lifetime: 180,
        fromX: 0,
        fromY: 0,
        toX: 0,
        toY: 0,
        controlX: 0,
        controlY: 0,
        width: 5,
        color: 0xffffff,
        kind: 'blade',
        phase: index * 1.37,
        graphics,
      });
    }
  }

  emit(
    from: Phaser.Math.Vector2,
    to: Phaser.Math.Vector2,
    color: number,
    kind: AttackTrailKind,
    strong = false,
  ): void {
    const trail = this.trails.find((candidate) => !candidate.active) ?? this.trails[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.trails.length;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const curve = kind === 'water' ? 38 : kind === 'fire' ? 24 : kind === 'shadow' ? -30 : 18;
    trail.active = true;
    trail.age = 0;
    trail.lifetime = strong ? 255 : kind === 'lightning' ? 125 : 190;
    trail.fromX = from.x;
    trail.fromY = from.y;
    trail.toX = to.x;
    trail.toY = to.y;
    trail.controlX = (from.x + to.x) / 2 + nx * curve;
    trail.controlY = (from.y + to.y) / 2 + ny * curve;
    trail.width = strong ? 8 : 5;
    trail.color = color;
    trail.kind = kind;
    trail.phase += 0.83;
    trail.graphics.clear().setVisible(true);
  }

  update(dtMs: number): void {
    const dt = Math.min(50, Math.max(0, dtMs));
    for (const trail of this.trails) {
      if (!trail.active) continue;
      trail.age += dt;
      if (trail.age >= trail.lifetime) {
        trail.active = false;
        trail.graphics.clear().setVisible(false);
        continue;
      }
      this.draw(trail);
    }
  }

  private draw(trail: Trail): void {
    const progress = Phaser.Math.Clamp(trail.age / trail.lifetime, 0, 1);
    const reveal = Phaser.Math.Clamp(progress / 0.36, 0, 1);
    const fade = 1 - Phaser.Math.Clamp((progress - 0.28) / 0.72, 0, 1);
    const tail = Math.max(0, reveal - (trail.kind === 'lightning' ? 0.92 : 0.72));
    const graphics = trail.graphics.clear();

    this.stroke(graphics, trail, tail, reveal, trail.width * 2.25, 0.12 * fade, false);
    this.stroke(graphics, trail, tail, reveal, trail.width, 0.82 * fade, false);
    this.stroke(graphics, trail, Math.max(tail, reveal - 0.34), reveal, Math.max(1.5, trail.width * 0.34), fade, true);

    if (trail.kind === 'water') {
      this.stroke(graphics, trail, Math.max(0, tail - 0.08), Math.max(0, reveal - 0.08), trail.width * 0.52, 0.34 * fade, false, 14);
    }
  }

  private stroke(
    graphics: Phaser.GameObjects.Graphics,
    trail: Trail,
    start: number,
    end: number,
    width: number,
    alpha: number,
    highlight: boolean,
    offset = 0,
  ): void {
    if (end <= start || alpha <= 0) return;
    graphics.lineStyle(width, highlight ? 0xf3fbff : trail.color, alpha);
    graphics.beginPath();
    for (let index = 0; index <= SAMPLES; index += 1) {
      const t = start + (end - start) * (index / SAMPLES);
      const inv = 1 - t;
      let x = inv * inv * trail.fromX + 2 * inv * t * trail.controlX + t * t * trail.toX;
      let y = inv * inv * trail.fromY + 2 * inv * t * trail.controlY + t * t * trail.toY;
      if (trail.kind === 'lightning') {
        const jitter = Math.sin((index + trail.phase) * 5.17) * 5 * Math.sin(t * Math.PI);
        x += jitter;
        y -= jitter * 0.55;
      }
      if (trail.kind === 'fire') y -= Math.sin(t * Math.PI) * 7;
      if (trail.kind === 'shadow') x -= Math.sin(t * Math.PI) * 6;
      y += Math.sin(t * Math.PI) * offset;
      if (index === 0) graphics.moveTo(x, y);
      else graphics.lineTo(x, y);
    }
    graphics.strokePath();
  }
}
