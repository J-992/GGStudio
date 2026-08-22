// Core gameplay: messy drawer up top, organizers below, drag things where they belong.
class LevelScene extends Phaser.Scene {
  constructor() { super('Level'); }

  init(data) {
    this.levelId = (data && data.levelId) || 1;
    this.level = Progression.levelData(this.levelId);
    this.restore = (data && data.restore) || null; // progress carried across an orientation change
    this.levelCompleted = false;   // guards a double Progression.complete on the bonus pick
    this.doubleReward = false;     // set by a watched rewarded ad
  }

  create() {
    this.drawBackdrop();
    this.placement = new PlacementSystem(this, this.level);
    this.drag = new DragSystem(this, this.placement);
    this.spawnItems();
    this.drawHUD();

    // Scene-event listeners survive restarts (e.g. orientation changes), so
    // clear stale ones or completion would fire once per restart.
    this.events.off('level:progress');
    this.events.off('level:complete');
    this.events.on('level:progress', (placed, total) => this.updateProgress(placed, total));
    this.events.once('level:complete', () => this.onComplete());

    // Rotated the device after finishing? Bring the completion panel back.
    if (this.restore && this.placement.placed >= this.totalItems) {
      this.time.delayedCall(400, () => this.showCompletePanel());
    }

    // Occasional idle wiggle on a random loose item — keeps the drawer feeling alive.
    this.idleTimer = this.time.addEvent({
      delay: 2200, loop: true, callback: () => {
        const loose = this.items.filter(i => !i.locked && this.drag.active !== i);
        if (!loose.length) return;
        const pick = Phaser.Utils.Array.GetRandom(loose);
        this.tweens.add({ targets: pick, angle: pick.angle + 5, duration: 120, yoyo: true, repeat: 1 });
      }
    });

    // Poki: the player is actually playing from here until the drawer is tidy or
    // they leave — shutdown covers the back button, the restart button and completion.
    Poki.gameplayStart();
    this.events.once('shutdown', () => Poki.gameplayStop());

    this.cameras.main.fadeIn(300, 253, 238, 244);
  }

  // The drawer rectangle for the current orientation; the scatter zone derives from it.
  drawerRect() {
    return Layout.portrait
      ? { x: 40, y: 84, w: 560, h: 290 }
      : { x: 60, y: 64, w: 832, h: 260 };
  }

  drawBackdrop() {
    const { width: W, height: H } = this.scale;
    const g = this.add.graphics().setDepth(0);
    g.fillGradientStyle(0xf2e3f5, 0xf2e3f5, 0xfdeef4, 0xfdeef4, 1);
    g.fillRect(0, 0, W, H);
    g.fillStyle(0xffffff, 0.3);
    for (let i = 0; i < 22; i++) g.fillCircle((i * 149 + 30) % W, (i * 83) % H, 5);

    // The messy drawer.
    const d = this.drawerRect();
    g.fillStyle(0x5a3c50, 0.12); g.fillRoundedRect(d.x + 6, d.y + 10, d.w, d.h, 24);
    g.fillStyle(0xe8c39a, 1); g.fillRoundedRect(d.x, d.y, d.w, d.h, 24);
    g.fillStyle(0xd9a86c, 1); g.fillRoundedRect(d.x + 16, d.y + 16, d.w - 32, d.h - 32, 16);
    g.fillStyle(0xc79862, 1); g.fillRoundedRect(d.x + 16, d.y + 16, d.w - 32, 22, { tl: 16, tr: 16, bl: 0, br: 0 });
    g.lineStyle(3, 0xa8794a, 0.6);
    g.strokeRoundedRect(d.x + 16, d.y + 16, d.w - 32, d.h - 32, 16);
    // Wood grain.
    g.lineStyle(2, 0xc08f58, 0.5);
    const grainGap = (d.h - 90) / 4;
    for (let i = 0; i < 4; i++) g.lineBetween(d.x + 36, d.y + 76 + i * grainGap, d.x + d.w - 36, d.y + 74 + i * grainGap);
  }

  spawnItems() {
    this.items = [];
    const d = this.drawerRect();
    const zone = { x1: d.x + 70, y1: d.y + 66, x2: d.x + d.w - 62, y2: d.y + d.h - 44 };
    const placedPts = [];
    let total = 0;

    // Flat spawn list: fresh from level data, or the carried-over state after a rotation.
    const entries = this.restore
      ? this.restore
      : this.level.items.flatMap(e => Array(e.count).fill({ key: e.key, placed: null }));

    entries.forEach(entry => {
      // Scatter with light overlap avoidance.
      let x, y, tries = 0;
      do {
        x = Phaser.Math.Between(zone.x1, zone.x2);
        y = Phaser.Math.Between(zone.y1, zone.y2);
        tries++;
      } while (tries < 14 && placedPts.some(p => Phaser.Math.Distance.Between(x, y, p.x, p.y) < 72));
      placedPts.push({ x, y });

      const sprite = this.add.image(x, y, entry.key)
        .setAngle(Phaser.Math.Between(-24, 24))
        .setDepth(10 + this.items.length);
      sprite.itemCategory = ITEM_DEFS[entry.key].category;
      sprite.baseScale = 1;
      sprite.homeX = x; sprite.homeY = y;
      sprite.homeAngle = sprite.angle;
      sprite.homeDepth = sprite.depth;
      sprite.locked = false;
      const restored = entry.placed && this.placement.prePlace(sprite, entry.placed.c, entry.placed.s);
      if (!restored) this.drag.enable(sprite);
      this.items.push(sprite);
      total++;
    });

    this.placement.registerItems(total);
    this.totalItems = total;
  }

  // Snapshot for orientation-change restarts: every item's key plus, if already
  // sorted, the container/slot it lives in (indices survive the portrait reflow).
  captureState() {
    return this.items.map(i => ({ key: i.texture.key, placed: i.placedSlot || null }));
  }

  drawHUD() {
    const { width: W } = this.scale;

    // Level chip.
    const chip = this.add.graphics().setDepth(50);
    chip.fillStyle(0xf25aa3, 1); chip.fillRoundedRect(18, 16, 130, 42, 21);
    chip.fillStyle(0xffffff, 0.25); chip.fillRoundedRect(24, 20, 118, 16, 8);
    this.add.text(83, 37, 'Level ' + this.levelId, {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setDepth(51);

    // Progress bar (narrower in portrait so it clears the chip and the icon buttons).
    this.barW = Layout.portrait ? 190 : 260;
    this.progressBg = this.add.graphics().setDepth(50);
    this.progressBg.fillStyle(0xffffff, 0.85); this.progressBg.fillRoundedRect(W / 2 - this.barW / 2, 20, this.barW, 26, 13);
    this.progressBg.lineStyle(3, 0xdba8c4, 1); this.progressBg.strokeRoundedRect(W / 2 - this.barW / 2, 20, this.barW, 26, 13);
    this.progressFill = this.add.graphics().setDepth(51);
    this.progressText = this.add.text(W / 2, 33, '0 / ' + this.totalItems, {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '16px', fontStyle: 'bold', color: '#a06b8a'
    }).setOrigin(0.5).setDepth(52);
    this.updateProgress(this.placement.placed, this.totalItems);

    // Sound, restart, back.
    this.soundBtn = FX.iconButton(this, W - 42, 38, 22, icon => this.drawSoundIcon(icon), () => {
      SaveSystem.soundOn = !SaveSystem.soundOn;
      if (SaveSystem.soundOn) AudioSys.resume(); else AudioSys.suspend();
      this.soundBtn.iconG.clear();
      this.drawSoundIcon(this.soundBtn.iconG);
    }).setDepth(50);

    FX.iconButton(this, W - 96, 38, 22, icon => {
      icon.lineStyle(4, 0xd9438c, 1);
      icon.beginPath(); icon.arc(0, 0, 10, -1.2, Math.PI * 1.4); icon.strokePath();
      icon.fillStyle(0xd9438c, 1); icon.fillTriangle(4, -14, 14, -8, 3, -2);
    }, () => this.scene.restart({ levelId: this.levelId })).setDepth(50);

    FX.iconButton(this, W - 150, 38, 22, icon => {
      icon.fillStyle(0xd9438c, 1);
      icon.fillTriangle(-9, 0, 0, -10, 9, 0);
      icon.fillRoundedRect(-7, -1, 14, 9, 2);
    }, () => {
      this.cameras.main.fadeOut(200, 253, 238, 244);
      this.time.delayedCall(210, () => this.scene.start('Room'));
    }).setDepth(50);
  }

  drawSoundIcon(icon) {
    const on = SaveSystem.soundOn;
    icon.fillStyle(on ? 0xd9438c : 0xb8a3b0, 1);
    icon.fillTriangle(-9, -4, -2, -9, -2, 9);
    icon.fillRect(-11, -4, 6, 8);
    if (on) {
      icon.lineStyle(3, 0xd9438c, 1);
      icon.beginPath(); icon.arc(2, 0, 6, -0.9, 0.9); icon.strokePath();
    } else {
      icon.lineStyle(3, 0xb8a3b0, 1);
      icon.lineBetween(2, -5, 11, 5); icon.lineBetween(11, -5, 2, 5);
    }
  }

  updateProgress(placed, total) {
    const { width: W } = this.scale;
    this.progressFill.clear();
    if (placed > 0) {
      const w = Math.max(26, (this.barW - 6) * (placed / total));
      this.progressFill.fillStyle(0xf25aa3, 1);
      this.progressFill.fillRoundedRect(W / 2 - this.barW / 2 + 3, 23, w, 20, 10);
    }
    this.progressText.setText(placed + ' / ' + total);
    if (placed > 0) FX.pulse(this, this.progressText);
  }

  // ---------- completion & reward ----------
  onComplete() {
    this.idleTimer.remove();
    Poki.gameplayStop();
    Poki.happyTime(1);
    AudioSys.play('complete');
    FX.confetti(this);
    this.time.delayedCall(700, () => this.showCompletePanel());
  }

  // Decorations on offer that the player does not already own. rewardOptions() can
  // fall back to owned keys once everything is collected, and those grant nothing —
  // so the rewarded ad is only ever offered against this list.
  freshRewards() {
    const owned = SaveSystem.decorations;
    return Progression.rewardOptions(this.levelId).filter(k => !owned.includes(k));
  }

  showCompletePanel() {
    const { width: W, height: H } = this.scale;
    // The bonus pick only makes sense when there is a second decoration left to win.
    const offerBonus = Poki.canReward() && this.freshRewards().length > 1;
    const panelH = offerBonus ? 352 : 300;
    const top = -panelH / 2;

    const blocker = this.add.zone(W / 2, H / 2, W, H).setInteractive().setDepth(4000);
    const panel = this.add.container(W / 2, H / 2).setDepth(4100);

    const g = this.add.graphics();
    g.fillStyle(0x5a3c50, 0.35); g.fillRect(-W / 2, -H / 2, W, H);
    g.fillStyle(0xffffff, 1); g.fillRoundedRect(-230, top, 460, panelH, 26);
    g.lineStyle(4, 0xf2aac6, 1); g.strokeRoundedRect(-230, top, 460, panelH, 26);
    panel.add(g);

    panel.add(this.add.text(0, top + 50, 'Sparkling!', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '44px', fontStyle: 'bold', color: '#f25aa3'
    }).setOrigin(0.5));

    // Three stars pop in.
    [-70, 0, 70].forEach((x, i) => {
      const star = this.add.image(x, top + 120, 'star').setScale(0);
      panel.add(star);
      this.tweens.add({ targets: star, scale: i === 1 ? 1.5 : 1.1, delay: 200 + i * 180, duration: 380, ease: 'Back.easeOut' });
      this.time.delayedCall(220 + i * 180, () => AudioSys.play('sparkle'));
    });

    panel.add(this.add.text(0, top + 185, 'The drawer is perfectly tidy ♥', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '19px', color: '#a06b8a'
    }).setOrigin(0.5));

    const close = () => { panel.destroy(); blocker.destroy(); };
    const btn = FX.button(this, 0, top + 250, 260, 60, 'PICK A REWARD', 0x62c48f, () => {
      close();
      this.showRewardChoice();
    });
    panel.add(btn);

    if (offerBonus) {
      const adBtn = FX.button(this, 0, top + 312, 320, 50, '▶  WATCH AD: 2 REWARDS', 0xf7b32b, () => {
        // One tap, one ad: lock both buttons so nothing can start twice.
        adBtn.disableInteractive(); btn.disableInteractive();
        Poki.rewardedBreak().then(watched => {
          this.doubleReward = watched;
          close();
          this.showRewardChoice();
        });
      }, { fontSize: '19px' });
      panel.add(adBtn);
    }

    panel.setScale(0.3).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 380, ease: 'Back.easeOut' });
  }

  showRewardChoice(isBonus) {
    const { width: W, height: H } = this.scale;
    const options = Progression.rewardOptions(this.levelId).slice(0, 3);
    AudioSys.play('reward');

    const blocker = this.add.zone(W / 2, H / 2, W, H).setInteractive().setDepth(4000);
    const layer = this.add.container(W / 2, H / 2).setDepth(4100);

    const g = this.add.graphics();
    g.fillStyle(0x5a3c50, 0.35); g.fillRect(-W / 2, -H / 2, W, H);
    layer.add(g);

    const portrait = Layout.portrait;
    const heading = isBonus ? 'One more, on the house!'
      : this.doubleReward ? 'Choose a decoration — then one more!'
      : 'Choose a decoration!';
    layer.add(this.add.text(0, portrait ? -300 : -190, heading, {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '36px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setShadow(0, 3, 'rgba(90,60,80,0.4)', 4));

    // Landscape: three tall cards side by side. Portrait: three wide cards stacked.
    const spacing = portrait ? 180 : 250;
    const start = -((options.length - 1) * spacing) / 2;
    options.forEach((key, i) => {
      const card = this.add.container(portrait ? 0 : start + i * spacing, portrait ? start + i * spacing - 30 : 10);
      const cw = portrait ? 400 : 200, ch = portrait ? 156 : 260;
      const cg = this.add.graphics();
      cg.fillStyle(0xffffff, 1); cg.fillRoundedRect(-cw / 2, -ch / 2, cw, ch, 22);
      cg.lineStyle(4, 0xf2aac6, 1); cg.strokeRoundedRect(-cw / 2, -ch / 2, cw, ch, 22);
      card.add(cg);

      const img = this.add.image(portrait ? -115 : 0, portrait ? 0 : -25, 'deco_' + key);
      const fit = portrait ? 120 : 150;
      const maxDim = Math.max(img.width, img.height);
      if (maxDim > fit) img.setScale(fit / maxDim);
      card.add(img);

      card.add(this.add.text(portrait ? 55 : 0, portrait ? 0 : 85, DECORATIONS[key].label, {
        fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#a06b8a'
      }).setOrigin(0.5));

      card.setSize(cw, ch).setInteractive({ useHandCursor: true });
      card.on('pointerover', () => this.tweens.add({ targets: card, scale: 1.07, duration: 130 }));
      card.on('pointerout', () => this.tweens.add({ targets: card, scale: 1, duration: 130 }));
      card.on('pointerdown', () => this.chooseReward(key, card, layer, blocker));

      card.setScale(0);
      this.tweens.add({ targets: card, scale: 1, delay: 150 + i * 130, duration: 360, ease: 'Back.easeOut' });
      layer.add(card);
    });
  }

  chooseReward(key, card, layer, blocker) {
    layer.iterate(child => { if (child.input) child.disableInteractive(); });
    AudioSys.play('drop');
    const wx = this.scale.width / 2 + card.x, wy = this.scale.height / 2 + card.y;
    FX.sparkle(this, wx, wy - 20);
    this.tweens.add({ targets: card, scale: 1.18, duration: 220, yoyo: true });

    if (!this.levelCompleted) {
      Progression.complete(this.levelId);
      this.levelCompleted = true;
    }
    Progression.chooseReward(key);

    // Rewarded-ad bonus: hand back a second, fresh set of cards.
    if (this.doubleReward) {
      this.doubleReward = false;
      this.time.delayedCall(650, () => {
        layer.destroy(); blocker.destroy();
        if (this.freshRewards().length) {
          this.showRewardChoice(true);
        } else {
          this.leaveToRoom(key);   // nothing left to give — just head home
        }
      });
      return;
    }

    this.time.delayedCall(650, () => this.leaveToRoom(key));
  }

  leaveToRoom(newDeco) {
    this.cameras.main.fadeOut(300, 253, 238, 244);
    this.time.delayedCall(320, () => this.scene.start('Room', { newDeco: newDeco }));
  }
}
