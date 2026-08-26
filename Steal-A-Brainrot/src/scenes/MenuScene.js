// One-tap menu: title, a parade of weirdos, PLAY. Nothing else between the
// player and the game.
class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    const W = CFG.W, H = CFG.H;
    this.add.rectangle(W / 2, H / 2, W, H, 0x1a237e);
    this.add.rectangle(W / 2, H - 130, W, 260, 0x283593);

    this.add.text(W / 2, 150, 'BRAINROT', {
      fontFamily: 'Arial Black, Arial', fontSize: '54px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5);
    const title = this.add.text(W / 2, 226, 'FACTORY', {
      fontFamily: 'Arial Black, Arial', fontSize: '96px', color: '#ffd54f',
      stroke: '#7b1fa2', strokeThickness: 12,
    }).setOrigin(0.5);
    this.tweens.add({ targets: title, scale: { from: 1, to: 1.05 }, angle: { from: -1.5, to: 1.5 },
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.add.text(W / 2, 300, 'collect italian brainrots · print cash · rob your neighbors', {
      fontFamily: 'Arial', fontSize: '20px', color: '#b3e5fc',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);

    // parade of creatures marching across the bottom
    this.paradeys = [];
    for (let i = 0; i < 7; i++) {
      const def = CREATURES[Math.floor(Math.random() * CREATURES.length)];
      const img = this.add.image(((i * 200) + 100) % (W + 200) - 100, H - 120, 'cr_' + def.id)
        .setScale(TextureFactory.scaleFor(this, 'cr_' + def.id, CFG.CREATURE_H));
      img.wobble = Math.random() * 10;
      this.paradeys.push(img);
    }

    const play = this.add.text(W / 2, H / 2 + 110, '▶  PLAY', {
      fontFamily: 'Arial Black, Arial', fontSize: '46px', color: '#ffffff',
      backgroundColor: '#43a047', padding: { x: 44, y: 18 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.tweens.add({ targets: play, scale: { from: 1, to: 1.06 }, duration: 600, yoyo: true, repeat: -1 });
    play.on('pointerdown', () => this._start());
    this.input.keyboard.on('keydown-SPACE', () => this._start());
    this.input.keyboard.on('keydown-ENTER', () => this._start());

    const rb = SaveSys.data.rebirths;
    if (rb > 0 || SaveSys.data.discovered.length > 0) {
      this.add.text(W / 2, H / 2 + 190,
        '⭐ Rebirth x' + rb + '   ·   📖 ' + SaveSys.data.discovered.length + '/' + CREATURES.length + ' found', {
        fontFamily: 'Arial', fontSize: '18px', color: '#ffe082',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5);
    }

    this._started = false;
  }

  _start() {
    if (this._started) return;
    this._started = true;
    AudioSys.ensure();
    AudioSys.setMuted(SaveSys.data.muted);
    this.scene.start('Game');
  }

  update(t, dt) {
    for (const img of this.paradeys) {
      img.x += dt * 0.06;
      img.wobble += dt * 0.008;
      img.setAngle(Math.sin(img.wobble) * 6);
      if (img.x > CFG.W + 60) img.x = -60;
    }
  }
}
window.MenuScene = MenuScene;
