// Generates all procedural textures, shows a quick loading heart, then heads home.
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  create() {
    const { width: W, height: H } = this.scale;
    this.cameras.main.setBackgroundColor('#fdeef4');
    const txt = this.add.text(W / 2, H / 2, '♥', { fontSize: '64px', color: '#f25aa3' }).setOrigin(0.5);
    this.tweens.add({ targets: txt, scale: 1.25, duration: 300, yoyo: true, repeat: -1 });

    TextureFactory.generateAll(this);
    SaveSystem.load();
    Poki.loadingFinished();   // everything is procedural — we are ready the moment textures exist

    // Unlock audio on the very first interaction anywhere.
    this.input.once('pointerdown', () => AudioSys.ensure());

    this.time.delayedCall(350, () => this.scene.start('Home'));
  }
}
