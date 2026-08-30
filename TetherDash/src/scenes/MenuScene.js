// Title screen: the mascots, the personal best, and one button into the run.
//
// The backdrop is a live tunnel drawn with the real projection, spinning
// slowly, so the first thing a new player sees is the thing the game is about:
// a square tube whose walls are floors.
class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    const W = CFG.GAME_W, H = CFG.GAME_H;
    this.t = 0;

    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(CFG.VOID_TOP, CFG.VOID_TOP, CFG.VOID_BOT, CFG.VOID_BOT, 1);
    bg.fillRect(0, 0, W, H);

    this.tunnelGfx = this.add.graphics().setDepth(1);
    this.scroll = 0;

    // dim veil so the title stays legible over the moving tunnel
    this.add.rectangle(W / 2, H / 2, W, H, 0x070b1c, 0.3).setDepth(2);

    this.add.text(W / 2, 92, 'TETHER DASH', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '66px', fontStyle: 'bold',
      color: '#ffffff', stroke: '#e0537e', strokeThickness: 10
    }).setOrigin(0.5).setDepth(10).setShadow(0, 6, 'rgba(0,0,0,0.45)', 10);

    this.add.text(W / 2, 146, 'the walls are floors too', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '21px', fontStyle: 'bold',
      color: '#9ec7ff'
    }).setOrigin(0.5).setDepth(10);

    // the two factory robots -- one of them is the one you run
    this.a = this.add.image(W / 2 - 118, 258, 'runnerA').setScale(0.62).setDepth(10);
    this.b = this.add.image(W / 2 + 118, 262, 'runnerB').setScale(0.5).setDepth(10).setAlpha(0.5);
    this.tweens.add({ targets: this.a, y: 244, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: this.b, y: 250, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 450 });

    Effects.button(this, W / 2, 352, 300, 68, 'PLAY', () => Poki.startRun(this),
      { fontSize: 34, depth: 10 });

    if (Save.data.best > 0) {
      this.add.text(W / 2, 416, 'BEST  ' + Save.data.best + '   ·   ' + Save.data.bestDist + ' m', {
        fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '24px', fontStyle: 'bold',
        color: '#ffd35c', stroke: '#101838', strokeThickness: 5
      }).setOrigin(0.5).setDepth(10);
    }

    this.soundBtn = Effects.button(this, W - 52, 46, 64, 52,
      Save.data.sound ? '♫' : '♫̸', () => {
        Save.setSound(!Save.data.sound);
        AudioSys.setEnabled(Save.data.sound);
        this.soundBtn.txt.setText(Save.data.sound ? '♫' : '♫̸');
      }, { color: 0x4a5a92, fontSize: 24, depth: 10 });

    this.add.text(W / 2, H - 26,
      'A / D  or  ← →  to steer      W / ↑ / Space to jump      run off a corner to take the wall',
      { fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '16px', color: '#7f9ac9' }
    ).setOrigin(0.5).setDepth(10);
  }

  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.033);
    this.t += dt;
    this.scroll += 9 * dt;

    // A bare tube, no holes: enough to say "this is the shape of the game"
    // without the menu needing a Track.
    Projection.setRoll(Math.sin(this.t * 0.25) * 0.9);
    Projection.cam.x = 0;
    Projection.cam.y = CFG.CAM_HEIGHT;
    Projection.cam.z = -CFG.CAM_BACK;

    const g = this.tunnelGfx;
    g.clear();
    const step = CFG.STRIP;
    const start = CFG.NEAR - CFG.CAM_BACK;
    const slices = [];
    for (let z = start; z < CFG.DRAW_DIST - CFG.CAM_BACK; z += step) slices.push(z);
    for (let i = slices.length - 1; i >= 0; i--) {
      const z0 = slices[i] + (this.scroll % step);
      const z1 = z0 + step;
      for (let f = 0; f < 4; f++) {
        const n1 = Projection.face(f, -CFG.TUBE_R, 0, z0);
        const n2 = Projection.face(f, CFG.TUBE_R, 0, z0);
        const f1 = Projection.face(f, -CFG.TUBE_R, 0, z1);
        const f2 = Projection.face(f, CFG.TUBE_R, 0, z1);
        const fog = Projection.fog((n1.dz + f1.dz) / 2);
        const even = Math.floor((z0 + this.scroll) / step) % 2 === 0;
        g.fillStyle(Projection.fogColor(even ? CFG.FACE_A[f] : CFG.FACE_B[f], fog), 1);
        g.beginPath();
        g.moveTo(f1.x, f1.y); g.lineTo(f2.x, f2.y);
        g.lineTo(n2.x, n2.y); g.lineTo(n1.x, n1.y);
        g.closePath(); g.fillPath();
        g.lineStyle(Math.max(1.2, n1.s * 0.05), Projection.fogColor(CFG.FACE_EDGE[f], fog), 0.9);
        g.beginPath(); g.moveTo(f1.x, f1.y); g.lineTo(n1.x, n1.y); g.strokePath();
        g.beginPath(); g.moveTo(f2.x, f2.y); g.lineTo(n2.x, n2.y); g.strokePath();
      }
    }
  }
}
