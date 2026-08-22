// 5x3 grid of levels with earned stars; locked levels are greyed out.
class LevelSelectScene extends Phaser.Scene {
  constructor() { super('LevelSelect'); }

  create() {
    const W = CFG.GAME_W, H = CFG.GAME_H;
    const bg = this.add.graphics();
    bg.fillGradientStyle(CFG.SKY_TOP, CFG.SKY_TOP, CFG.SKY_BOT, CFG.SKY_BOT, 1);
    bg.fillRect(0, 0, W, H);

    this.add.text(W / 2, 52, 'PICK A LEVEL', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '40px', fontStyle: 'bold',
      color: '#ffffff', stroke: '#e0537e', strokeThickness: 8
    }).setOrigin(0.5);

    const unlocked = Save.unlockedUpTo();
    const cols = 5, cw = 150, ch = 118;
    const x0 = W / 2 - ((cols - 1) * cw) / 2;
    const y0 = 150;

    LEVELS.forEach((lv, i) => {
      const x = x0 + (i % cols) * cw;
      const y = y0 + Math.floor(i / cols) * ch;
      const locked = lv.id > unlocked;
      const res = Save.levelResult(lv.id);

      const c = this.add.container(x, y);
      const g = this.add.graphics();
      g.fillStyle(0x33334d, 0.25); g.fillRoundedRect(-58, -40, 120, 88, 16);
      g.fillStyle(locked ? 0x9aa7b8 : 0xffffff, 1); g.fillRoundedRect(-60, -44, 120, 88, 16);
      g.lineStyle(4, locked ? 0x7f8b9c : 0xf2aac6, 1); g.strokeRoundedRect(-60, -44, 120, 88, 16);
      c.add(g);
      c.add(this.add.text(0, -16, locked ? '🔒' : String(lv.id), {
        fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '34px', fontStyle: 'bold',
        color: locked ? '#667788' : '#e0537e'
      }).setOrigin(0.5));
      const stars = res ? res.stars : 0;
      const grey = this.add.text(0, 22, '★★★', {
        fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '22px', color: '#d8dde4'
      }).setOrigin(0.5);
      c.add(grey);
      if (stars > 0) {
        c.add(this.add.text(-grey.width / 2, 22, '★'.repeat(stars), {
          fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '22px', color: '#ffd35c'
        }).setOrigin(0, 0.5));
      }

      if (!locked) {
        c.setSize(120, 88);
        c.setInteractive({ useHandCursor: true });
        c.on('pointerdown', () => {
          AudioSys.unlock(); AudioSys.play('click');
          Poki.startLevel(this, lv.id);
        });
        c.on('pointerover', () => c.setScale(1.06));
        c.on('pointerout', () => c.setScale(1));
      }
    });

    Effects.button(this, 86, H - 46, 130, 52, '← BACK', () => this.scene.start('Menu'),
      { color: 0x8899aa, fontSize: 20 });
  }
}
