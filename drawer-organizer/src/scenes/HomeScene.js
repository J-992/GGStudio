// Title screen: name, big play button, floaty cosmetics.
class HomeScene extends Phaser.Scene {
  constructor() { super('Home'); }

  create() {
    const { width: W, height: H } = this.scale;
    const g = this.add.graphics();
    g.fillGradientStyle(0xfdeef4, 0xfdeef4, 0xf7d9ea, 0xf7d9ea, 1);
    g.fillRect(0, 0, W, H);
    // Soft polka dots.
    g.fillStyle(0xffffff, 0.35);
    for (let i = 0; i < 26; i++) {
      g.fillCircle((i * 173) % W, (i * 97 + 40) % H, 6 + (i % 3) * 4);
    }

    // Floating items around the title.
    const floaties = ['lipstick', 'brush', 'polish', 'perfume', 'palette', 'compact', 'hairclip', 'mascara'];
    floaties.forEach((key, i) => {
      const x = Phaser.Math.Clamp(W * (0.09 + (i % 4) * 0.27) + (i > 3 ? W * 0.09 : 0), 44, W - 44);
      const y = i < 4 ? 100 : H - 110;
      const s = this.add.image(x, y, key).setScale(0.9).setAngle(-14 + (i * 9) % 28).setAlpha(0.95);
      this.tweens.add({
        targets: s, y: y - 14, angle: s.angle + 6, duration: 1600 + i * 180,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
    });

    const title = this.add.text(W / 2, H / 2 - 90, 'Drawer\nOrganizer', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '72px', fontStyle: 'bold',
      color: '#f25aa3', align: 'center', lineSpacing: -8
    }).setOrigin(0.5);
    title.setShadow(0, 5, 'rgba(107,74,94,0.25)', 0, false, true);
    this.tweens.add({ targets: title, scale: 1.03, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    FX.button(this, W / 2, H / 2 + 70, 240, 76, 'PLAY', 0xf25aa3, () => {
      this.cameras.main.fadeOut(250, 253, 238, 244);
      this.time.delayedCall(260, () => this.scene.start('Room'));
    });

    const sub = SaveSystem.completed > 0
      ? `Level ${Progression.currentLevel} • ${SaveSystem.decorations.length} decorations`
      : 'Tidy the drawer, decorate your room!';
    this.add.text(W / 2, H / 2 + 140, sub, {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '20px', color: '#a06b8a'
    }).setOrigin(0.5);

    this.cameras.main.fadeIn(300, 253, 238, 244);
  }
}
