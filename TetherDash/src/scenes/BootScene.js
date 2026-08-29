// Generates every texture, loads the save, and hands off to the menu.
//
// The two runners prefer rendered Meshy sheets in assets/; everything else is
// still drawn at runtime. A missing or unreadable sheet is not an error -- the
// procedural mascot is drawn instead, so the game runs on a half-finished
// asset set and on a checkout where the PNGs were never fetched.
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    this.meshRunners = true;
    this.load.on('loaderror', (file) => {
      if (file.key === 'runnerA' || file.key === 'runnerB') this.meshRunners = false;
    });
    const frame = { frameWidth: CFG.RUNNER_FRAME_W, frameHeight: CFG.RUNNER_FRAME_H };
    this.load.spritesheet('runnerA', 'assets/runnerA.png', frame);
    this.load.spritesheet('runnerB', 'assets/runnerB.png', frame);
  }

  create() {
    Save.load();
    AudioSys.init();
    AudioSys.setEnabled(Save.data.sound);

    // A sheet that loaded but is the wrong shape would animate garbage.
    if (this.meshRunners) {
      for (const key of ['runnerA', 'runnerB']) {
        const tex = this.textures.get(key);
        if (!tex || tex.frameTotal - 1 < CFG.RUNNER_FRAMES) this.meshRunners = false;
      }
    }
    if (!this.meshRunners) {
      this.textures.remove('runnerA');
      this.textures.remove('runnerB');
    }
    Save.meshRunners = this.meshRunners;

    TextureFactory.generate(this);   // fills in whatever is not already a texture

    if (this.meshRunners) {
      for (const key of ['runnerA', 'runnerB']) {
        this.anims.create({
          key: key + '_run',
          frames: this.anims.generateFrameNumbers(key, { start: 0, end: CFG.RUNNER_FRAMES - 1 }),
          frameRate: CFG.RUNNER_FPS,
          repeat: -1
        });
      }
    }

    Poki.loadingFinished();
    this.input.once('pointerdown', () => AudioSys.unlock());
    this.scene.start('Menu');
  }
}
