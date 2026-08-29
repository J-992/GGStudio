// Title screen: the two mascots joined by their cord, Play, mode toggle,
// level select and sound.
class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    const W = CFG.GAME_W, H = CFG.GAME_H;

    // sky
    const bg = this.add.graphics();
    bg.fillGradientStyle(CFG.SKY_TOP, CFG.SKY_TOP, CFG.SKY_BOT, CFG.SKY_BOT, 1);
    bg.fillRect(0, 0, W, H);

    // drifting clouds
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      const c = this.add.image(Math.random() * W, 40 + Math.random() * (H - 120), 'cloud' + (i % 3));
      c.setAlpha(0.5 + Math.random() * 0.4).setScale(0.7 + Math.random() * 0.9);
      c.speed = 6 + Math.random() * 12;
      this.clouds.push(c);
    }

    // title
    this.add.text(W / 2, 86, 'TETHER DASH', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '64px', fontStyle: 'bold',
      color: '#ffffff', stroke: '#e0537e', strokeThickness: 10
    }).setOrigin(0.5).setShadow(0, 6, 'rgba(60,40,80,0.35)', 8);
    this.add.text(W / 2, 138, 'two robots, one bungee cord', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#4a6a8a'
    }).setOrigin(0.5);

    // mascots + cord
    const ax = W / 2 - 110, bx = W / 2 + 110, my = 235;
    this.cord = this.add.graphics();
    this.a = this.add.image(ax, my, 'runnerA').setScale(1.1);
    this.b = this.add.image(bx, my, 'runnerB').setScale(1.1);
    this.tweens.add({ targets: this.a, y: my - 14, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: this.b, y: my - 14, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 450 });

    // buttons
    const unlocked = Save.unlockedUpTo();
    Effects.button(this, W / 2, 350, 280, 64, 'PLAY', () => {
      Poki.startLevel(this, unlocked);
    }, { fontSize: 32 });

    this.modeBtn = Effects.button(this, W / 2 - 150, 432, 260, 52,
      this.modeLabel(), () => {
        Save.setMode(Save.data.mode === 'solo' ? 'coop' : 'solo');
        this.modeBtn.txt.setText(this.modeLabel());
      }, { color: 0x53a8d6, fontSize: 21 });

    Effects.button(this, W / 2 + 150, 432, 260, 52, 'LEVEL SELECT', () => {
      this.scene.start('LevelSelect');
    }, { color: 0x9b7bff, fontSize: 21 });

    this.soundBtn = Effects.button(this, W - 52, 46, 64, 52,
      Save.data.sound ? '♫' : '♫̸', () => {
        Save.setSound(!Save.data.sound);
        AudioSys.setEnabled(Save.data.sound);
        this.soundBtn.txt.setText(Save.data.sound ? '♫' : '♫̸');
      }, { color: 0x8899aa, fontSize: 24 });

    const stars = Save.totalStars();
    if (stars > 0) {
      this.add.text(20, 26, '★ ' + stars, {
        fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '26px', fontStyle: 'bold',
        color: '#ffd35c', stroke: '#a06b20', strokeThickness: 4
      }).setOrigin(0, 0.5);
    }

    this.add.text(W / 2, H - 22,
      'P1: A/D + W or Space      P2: ←/→ + ↑      Solo: Q swaps runner',
      { fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '16px', color: '#4a6a8a' }
    ).setOrigin(0.5);
  }

  modeLabel() { return Save.data.mode === 'solo' ? 'MODE: 1 PLAYER' : 'MODE: 2 PLAYERS'; }

  update(time, delta) {
    const dt = delta / 1000;
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x > CFG.GAME_W + 90) c.x = -90;
    }
    // bouncy cord between the mascots
    const g = this.cord;
    g.clear();
    g.lineStyle(6, 0x59d98c, 1);
    const ax = this.a.x, ay = this.a.y + 20, bx = this.b.x, by = this.b.y + 20;
    const midY = Math.max(ay, by) + 46 + Math.sin(time / 300) * 6;
    g.beginPath();
    g.moveTo(ax, ay);
    for (let i = 1; i <= 16; i++) {
      const t = i / 16, o = 1 - t;
      g.lineTo(o * o * ax + 2 * o * t * (ax + bx) / 2 + t * t * bx,
               o * o * ay + 2 * o * t * midY + t * t * by);
    }
    g.strokePath();
  }
}
