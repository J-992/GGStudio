// Generates every texture, loads the save, and hands off to the menu.
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  create() {
    Save.load();
    AudioSys.init();
    AudioSys.setEnabled(Save.data.sound);
    TextureFactory.generate(this);
    this.input.once('pointerdown', () => AudioSys.unlock());
    this.scene.start('Menu');
  }
}
