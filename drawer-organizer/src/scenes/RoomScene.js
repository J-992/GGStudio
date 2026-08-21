// The vanity room hub: shows earned decorations, level progress, and the play button.
class RoomScene extends Phaser.Scene {
  constructor() { super('Room'); }

  init(data) { this.newDeco = data && data.newDeco; }

  create() {
    const { width: W, height: H } = this.scale;
    this.drawRoom();
    this.drawDecorations();
    this.drawUI();
    this.cameras.main.fadeIn(300, 253, 238, 244);
  }

  drawRoom() {
    const { width: W, height: H } = this.scale;
    const g = this.add.graphics().setDepth(0);

    // Wall + floor.
    g.fillGradientStyle(0xf2e3f5, 0xf2e3f5, 0xead4ef, 0xead4ef, 1);
    g.fillRect(0, 0, W, 440);
    g.fillStyle(0xf7dcc8, 1); g.fillRect(0, 440, W, H - 440);
    g.fillStyle(0xe8c5a8, 1); g.fillRect(0, 440, W, 10); // baseboard shadow
    // Wall pattern.
    g.fillStyle(0xffffff, 0.25);
    for (let i = 0; i < 40; i++) g.fillCircle((i * 131 + 60) % W, (i * 67) % 420, 4);

    // Window with curtains (right wall).
    g.fillStyle(0xbde4f7, 1); g.fillRoundedRect(770, 120, 140, 180, 12);
    g.fillStyle(0xffffff, 0.5); g.fillTriangle(780, 290, 900, 130, 900, 290);
    g.lineStyle(6, 0xffffff, 1); g.strokeRoundedRect(770, 120, 140, 180, 12);
    g.lineBetween(840, 122, 840, 298); g.lineBetween(772, 210, 908, 210);

    // Vanity mirror.
    g.fillStyle(0xf7b32b, 1); g.fillEllipse(480, 235, 190, 230);
    g.fillStyle(0xd4ecf7, 1); g.fillEllipse(480, 235, 166, 206);
    g.fillStyle(0xffffff, 0.55); g.fillEllipse(450, 200, 50, 90);

    // Desk.
    g.fillStyle(0xe89ab8, 1); g.fillRoundedRect(300, 355, 360, 22, 8);
    g.fillStyle(0xf2aac6, 1); g.fillRoundedRect(300, 350, 360, 16, 8);
    // Drawer unit (the star of the show).
    g.fillStyle(0xf2aac6, 1); g.fillRoundedRect(350, 377, 260, 130, 10);
    g.fillStyle(0xe89ab8, 1);
    g.fillRoundedRect(362, 388, 236, 32, 6);
    g.fillRoundedRect(362, 426, 236, 32, 6);
    g.fillRoundedRect(362, 464, 236, 32, 6);
    g.fillStyle(0xfdf0c2, 1);
    [404, 442, 480].forEach(y => g.fillRoundedRect(466, y - 3, 28, 8, 4));
    // Peeking items in the top drawer.
    g.fillStyle(0xe84a7f, 1); g.fillRoundedRect(380, 382, 10, 12, 3);
    g.fillStyle(0x8ad9f2, 1); g.fillRoundedRect(560, 382, 14, 10, 3);
    // Legs.
    g.fillStyle(0xd989ab, 1); g.fillRect(315, 377, 14, 90); g.fillRect(631, 377, 14, 90);

    // Stool.
    g.fillStyle(0xbde8cf, 1); g.fillEllipse(760, 470, 90, 34);
    g.fillStyle(0x9bd4b3, 1); g.fillRect(738, 478, 10, 52); g.fillRect(772, 478, 10, 52);

    // Ambient sparkle drifting in the room.
    this.add.particles(0, 0, 'spark', {
      x: { min: 60, max: W - 60 }, y: { min: 60, max: 380 },
      scale: { start: 0.28, end: 0 }, alpha: { start: 0.7, end: 0 },
      lifespan: 2400, frequency: 900, tint: 0xffffff
    }).setDepth(1);
  }

  drawDecorations() {
    SaveSystem.decorations.forEach((key, i) => {
      const def = DECORATIONS[key];
      if (!def) return;
      const img = this.add.image(def.x, def.y, 'deco_' + key)
        .setOrigin(0.5, def.origin === 'bottom' ? 1 : 0.5)
        .setDepth(def.depth !== undefined ? def.depth : 10);
      // Gentle idle bob.
      this.tweens.add({
        targets: img, y: img.y - 4, duration: 1800 + (i % 5) * 200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
      if (key === this.newDeco) {
        FX.pop(this, img);
        this.time.delayedCall(300, () => {
          FX.sparkle(this, img.x, img.y - img.displayHeight / 2);
          AudioSys.play('sparkle');
        });
      }
    });
  }

  drawUI() {
    const { width: W, height: H } = this.scale;

    // Level dots.
    const total = Progression.levelCount;
    const spacing = 54;
    const startX = W / 2 - ((total - 1) * spacing) / 2;
    for (let i = 1; i <= total; i++) {
      const x = startX + (i - 1) * spacing, y = H - 92;
      const done = i <= SaveSystem.completed;
      const unlocked = Progression.isUnlocked(i);
      const g = this.add.graphics().setDepth(20);
      g.fillStyle(done ? 0xf25aa3 : unlocked ? 0xffffff : 0xd9c8d4, 1);
      g.fillCircle(x, y, 17);
      g.lineStyle(3, done || unlocked ? 0xd9438c : 0xb8a3b0, 1);
      g.strokeCircle(x, y, 17);
      const label = this.add.text(x, y, done ? '✓' : String(i), {
        fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '17px', fontStyle: 'bold',
        color: done ? '#ffffff' : unlocked ? '#d9438c' : '#b8a3b0'
      }).setOrigin(0.5).setDepth(21);
      if (unlocked) {
        const zone = this.add.zone(x, y, 46, 46).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => this.startLevel(i));
      }
      if (i === Progression.currentLevel && !Progression.allDone) {
        const ring = this.add.graphics().setDepth(19);
        ring.lineStyle(3, 0xf25aa3, 0.7); ring.strokeCircle(x, y, 24);
        this.tweens.add({ targets: ring, alpha: 0.15, duration: 700, yoyo: true, repeat: -1 });
      }
    }

    const btnLabel = Progression.allDone ? 'PLAY AGAIN' : 'PLAY  LEVEL ' + Progression.currentLevel;
    FX.button(this, W / 2, H - 40, 300, 62, btnLabel, 0xf25aa3, () => this.startLevel(Progression.currentLevel));

    // Sound toggle + home.
    this.soundBtn = FX.iconButton(this, W - 42, 42, 24, icon => this.drawSoundIcon(icon), () => {
      SaveSystem.soundOn = !SaveSystem.soundOn;
      if (SaveSystem.soundOn) AudioSys.resume(); else AudioSys.suspend();
      this.soundBtn.iconG.clear();
      this.drawSoundIcon(this.soundBtn.iconG);
    }).setDepth(30);

    FX.iconButton(this, 42, 42, 24, icon => {
      icon.fillStyle(0xd9438c, 1);
      icon.fillTriangle(-10, 1, 0, -11, 10, 1);
      icon.fillRoundedRect(-8, 0, 16, 10, 2);
    }, () => this.scene.start('Home')).setDepth(30);

    if (Progression.allDone) {
      this.add.text(W / 2, H - 128, 'All tidy! Replay any level ♥', {
        fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '18px', color: '#a06b8a'
      }).setOrigin(0.5).setDepth(20);
    }
  }

  drawSoundIcon(icon) {
    const on = SaveSystem.soundOn;
    icon.fillStyle(on ? 0xd9438c : 0xb8a3b0, 1);
    icon.fillTriangle(-10, -4, -2, -10, -2, 10);
    icon.fillRect(-12, -4, 6, 8);
    if (on) {
      icon.lineStyle(3, 0xd9438c, 1);
      icon.beginPath(); icon.arc(2, 0, 7, -0.9, 0.9); icon.strokePath();
      icon.beginPath(); icon.arc(2, 0, 12, -0.9, 0.9); icon.strokePath();
    } else {
      icon.lineStyle(3, 0xb8a3b0, 1);
      icon.lineBetween(3, -6, 13, 6); icon.lineBetween(13, -6, 3, 6);
    }
  }

  startLevel(id) {
    this.cameras.main.fadeOut(250, 253, 238, 244);
    this.time.delayedCall(260, () => {
      // Interstitial slot: skipped for the session's first level, then rate-limited.
      Poki.breakBeforeLevel().then(() => this.scene.start('Level', { levelId: id }));
    });
  }
}
