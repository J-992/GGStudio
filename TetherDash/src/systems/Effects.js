// Screen-space juice: dust, coin bursts, confetti, floating text, plus the
// shared rounded-rect button used by every scene.
class Effects {
  constructor(scene) {
    this.scene = scene;

    this.dust = scene.add.particles(0, 0, 'puff', {
      speed: { min: 30, max: 90 }, angle: { min: 220, max: 320 },
      scale: { start: 0.9, end: 0 }, alpha: { start: 0.8, end: 0 },
      lifespan: 380, gravityY: 120, emitting: false, tint: 0xfff3d6
    }).setDepth(90);

    this.coins = scene.add.particles(0, 0, 'spark', {
      speed: { min: 60, max: 160 }, scale: { start: 1.2, end: 0 },
      lifespan: 420, gravityY: 200, emitting: false, tint: 0xffd35c
    }).setDepth(90);

    this.confetti = scene.add.particles(0, 0, 'confetti', {
      x: { min: 0, max: CFG.GAME_W }, y: -20,
      speedY: { min: 120, max: 260 }, speedX: { min: -60, max: 60 },
      rotate: { min: 0, max: 360 }, scale: { min: 0.5, max: 1.1 },
      lifespan: 2600, emitting: false,
      tint: [0xff5c8a, 0x59d98c, 0x53c8d6, 0xffd35c, 0x9b7bff]
    }).setDepth(200);

    this.rescueSparks = scene.add.particles(0, 0, 'spark', {
      speed: { min: 40, max: 140 }, scale: { start: 1.3, end: 0 },
      lifespan: 500, emitting: false, tint: 0x9ef0e0
    }).setDepth(90);
  }

  landDust(player) {
    const pr = Projection.project(player.x, player.y, player.z);
    this.dust.explode(7, pr.x, pr.y);
  }

  coinBurst(sx, sy) { this.coins.explode(8, sx, sy); }

  rescueBurst(sx, sy) { this.rescueSparks.explode(14, sx, sy); }

  winConfetti() {
    this.confetti.emitting = true;
    this.scene.time.delayedCall(1600, () => { this.confetti.emitting = false; });
  }

  floatText(sx, sy, msg, color, size) {
    const t = this.scene.add.text(sx, sy, msg, {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif',
      fontSize: (size || 30) + 'px', fontStyle: 'bold',
      color: color || '#ffffff', stroke: '#33334d', strokeThickness: 5
    }).setOrigin(0.5).setDepth(150);
    this.scene.tweens.add({
      targets: t, y: sy - 46, alpha: { from: 1, to: 0 },
      scale: { from: 1, to: 1.15 }, duration: 950, ease: 'Cubic.easeOut',
      onComplete: () => t.destroy()
    });
  }

  // Big friendly rounded button. Returns a container.
  static button(scene, x, y, w, h, label, onClick, opts) {
    opts = opts || {};
    const c = scene.add.container(x, y).setDepth(opts.depth || 300);
    const g = scene.add.graphics();
    const bg = opts.color === undefined ? 0xff5c8a : opts.color;
    const draw = (fill) => {
      g.clear();
      g.fillStyle(0x33334d, 0.28); g.fillRoundedRect(-w / 2 + 3, -h / 2 + 5, w, h, 16);
      g.fillStyle(fill, 1); g.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
      g.lineStyle(3, 0xffffff, 0.35); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
    };
    draw(bg);
    const txt = scene.add.text(0, 0, label, {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif',
      fontSize: (opts.fontSize || 26) + 'px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5);
    c.add([g, txt]);
    c.txt = txt;
    c.setSize(w, h);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerover', () => draw(Phaser.Display.Color.IntegerToColor(bg).brighten(12).color));
    c.on('pointerout', () => draw(bg));
    c.on('pointerdown', () => {
      AudioSys.unlock(); AudioSys.play('click');
      scene.tweens.add({ targets: c, scale: { from: 0.92, to: 1 }, duration: 120 });
      onClick();
    });
    return c;
  }
}
