// Juice helpers: sparkles, confetti, pops, and a shared rounded button factory.
const FX = {
  sparkle(scene, x, y, tint) {
    const emitter = scene.add.particles(x, y, 'spark', {
      speed: { min: 60, max: 190 },
      scale: { start: 0.9, end: 0 },
      rotate: { start: 0, end: 180 },
      lifespan: { min: 280, max: 520 },
      quantity: 10,
      tint: tint !== undefined ? tint : [0xfff3b8, 0xffffff, 0xf9c8e0],
      emitting: false
    }).setDepth(3000);
    emitter.explode(10);
    scene.time.delayedCall(700, () => emitter.destroy());
  },

  confetti(scene, count) {
    const W = scene.scale.width;
    const emitter = scene.add.particles(0, -20, 'confetti', {
      x: { min: 0, max: W },
      speedY: { min: 180, max: 340 },
      speedX: { min: -60, max: 60 },
      rotate: { start: 0, end: 360 },
      scale: { min: 0.5, max: 1.1 },
      lifespan: 2600,
      quantity: 2,
      frequency: 18,
      tint: [0xf25aa3, 0xf7b32b, 0x62c48f, 0x8ad9f2, 0x8a5ad9, 0xffe08a],
      emitting: true
    }).setDepth(2500);
    scene.time.delayedCall(1400, () => emitter.stop());
    scene.time.delayedCall(4200, () => emitter.destroy());
    return emitter;
  },

  pop(scene, target, scaleTo) {
    const base = scaleTo || 1;
    target.setScale(base * 0.2);
    scene.tweens.add({ targets: target, scale: base, duration: 380, ease: 'Back.easeOut' });
  },

  pulse(scene, target) {
    scene.tweens.add({ targets: target, scaleX: target.scaleX * 1.05, scaleY: target.scaleY * 1.05, duration: 110, yoyo: true, ease: 'Sine.easeInOut' });
  },

  // Rounded pill button with label. Returns a container.
  button(scene, x, y, w, h, label, color, onClick, textStyle) {
    const c = scene.add.container(x, y);
    const g = scene.add.graphics();
    const dark = Phaser.Display.Color.IntegerToColor(color).darken(18).color;
    g.fillStyle(dark, 1); g.fillRoundedRect(-w / 2, -h / 2 + 4, w, h, h / 2);
    g.fillStyle(color, 1); g.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    g.fillStyle(0xffffff, 0.25); g.fillRoundedRect(-w / 2 + 8, -h / 2 + 5, w - 16, h / 2.6, h / 4);
    const t = scene.add.text(0, -2, label, Object.assign({
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: Math.round(h * 0.42) + 'px',
      fontStyle: 'bold', color: '#ffffff'
    }, textStyle || {})).setOrigin(0.5);
    t.setShadow(0, 2, 'rgba(0,0,0,0.2)', 2);
    c.add([g, t]);
    c.setSize(w, h);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerover', () => scene.tweens.add({ targets: c, scale: 1.06, duration: 120 }));
    c.on('pointerout', () => scene.tweens.add({ targets: c, scale: 1, duration: 120 }));
    c.on('pointerdown', () => {
      AudioSys.play('click');
      scene.tweens.add({ targets: c, scale: 0.94, duration: 70, yoyo: true, onComplete: () => onClick && onClick() });
    });
    return c;
  },

  // Small circular icon button (sound / restart / home).
  iconButton(scene, x, y, r, draw, onClick) {
    const c = scene.add.container(x, y);
    const g = scene.add.graphics();
    g.fillStyle(0xffffff, 0.92); g.fillCircle(0, 0, r);
    g.lineStyle(3, 0xdba8c4, 1); g.strokeCircle(0, 0, r);
    const icon = scene.add.graphics();
    draw(icon);
    c.add([g, icon]);
    c.setSize(r * 2, r * 2);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerdown', () => { AudioSys.play('click'); FX.pulse(scene, c); onClick && onClick(); });
    c.iconG = icon;
    return c;
  }
};
