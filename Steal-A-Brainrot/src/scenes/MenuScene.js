// Title screen: name, PLAY, braindex count, and a parade of brainrots
// marching across the bottom. Rebuilt wholesale on resize.
class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    this.cameras.main.setBackgroundColor('#14213d');
    this.root = this.add.container(0, 0);
    this._build();

    this._onResize = () => this._build();
    this.scale.on('resize', this._onResize);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this._onResize);
      if (this._paradeTimer) this._paradeTimer.remove();
    });

    this.input.keyboard.on('keydown-SPACE', () => this._start());
    this.input.keyboard.on('keydown-ENTER', () => this._start());

    this._paradeTimer = this.time.addEvent({
      delay: 1400, loop: true, callback: () => this._marcher(),
    });
    for (let i = 0; i < 4; i++) this.time.delayedCall(i * 300, () => this._marcher(true));
  }

  _build() {
    const r = this.root;
    r.removeAll(true);
    const W = LAYOUT.width, H = LAYOUT.height;

    const title1 = this.add.text(W / 2, H * 0.26, 'BRAINROT', {
      fontFamily: 'Arial Black, Arial', fontSize: LAYOUT.landscape ? '84px' : '64px',
      color: '#ffd54f', stroke: '#000000', strokeThickness: 10,
    }).setOrigin(0.5);
    const title2 = this.add.text(W / 2, H * 0.26 + (LAYOUT.landscape ? 78 : 60), 'MERGE CLASH', {
      fontFamily: 'Arial Black, Arial', fontSize: LAYOUT.landscape ? '56px' : '44px',
      color: '#80deea', stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5);
    r.add([title1, title2]);

    const play = this.add.text(W / 2, H * 0.62, '▶ PLAY', {
      fontFamily: 'Arial Black, Arial', fontSize: '46px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 8,
      backgroundColor: '#43a047', padding: { x: 38, y: 14 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    play.on('pointerdown', () => this._start());
    this.tweens.add({ targets: play, scale: { from: 1, to: 1.06 }, duration: 600, yoyo: true, repeat: -1 });
    r.add(play);

    const found = SaveSys.data.discovered.length;
    const sub = this.add.text(W / 2, H * 0.62 + 70,
      '\u{1F4D6} ' + found + ' / ' + CREATURES.length + ' brainrots found', {
        fontFamily: 'Arial, sans-serif', fontSize: '18px', color: '#b0bec5',
      }).setOrigin(0.5);
    r.add(sub);
  }

  _marcher(startMid) {
    const def = CREATURES[Math.floor(Math.random() * CREATURES.length)];
    const H = LAYOUT.height;
    const img = this.add.image(startMid ? Math.random() * LAYOUT.width : -60, H - 24, 'cr_' + def.id)
      .setOrigin(0.5, 1);
    img.setScale(TextureFactory.scaleFor(this, 'cr_' + def.id, 76));
    this.tweens.add({
      targets: img, x: LAYOUT.width + 70,
      duration: (LAYOUT.width - img.x + 130) * 14,
      onComplete: () => img.destroy(),
    });
    this.tweens.add({
      targets: img, y: H - 30, duration: 260, yoyo: true, repeat: -1,
    });
  }

  _start() {
    AudioSys.ensure();
    AudioSys.setMuted(SaveSys.data.muted);
    AudioSys.sfx('tick');
    this.scene.start('Game');
  }
}
window.MenuScene = MenuScene;
