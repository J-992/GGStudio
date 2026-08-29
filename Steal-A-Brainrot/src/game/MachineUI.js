// The Brainrot Machine widget: big PULL button, a mini plinko window the
// capsule bounces through (pure theater -- GachaSystem already decided the
// result), and the rarity reveal ceremony. Tap-to-skip once the player has
// seen the show a few times.
class MachineUI {
  constructor(scene, gacha, economy) {
    this.scene = scene;
    this.gacha = gacha;
    this.economy = economy;
    this.busy = false;
    this._timers = [];
    this._tweens = [];
    this._pendingResult = null;
    this.onResult = null;      // set by GameScene: (result) => void
    this.root = scene.add.container(0, 0).setDepth(800);
    this._build();
  }

  _build() {
    const m = LAYOUT.machine;
    const r = this.root;
    r.removeAll(true);

    const g = this.scene.add.graphics();
    g.fillStyle(0x4a148c, 1);
    g.fillRoundedRect(m.x, m.y, m.w, m.h, 16);
    g.lineStyle(4, 0x7b1fa2, 1);
    g.strokeRoundedRect(m.x, m.y, m.w, m.h, 16);
    r.add(g);

    const title = this.scene.add.text(m.x + m.w / 2, m.y + 16, 'BRAINROT MACHINE', {
      fontFamily: 'Arial Black, Arial', fontSize: '16px', color: '#e1bee7',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);
    r.add(title);

    // plinko window
    const btnH = Math.min(58, m.h * 0.3);
    const win = {
      x: m.x + 12, y: m.y + 32,
      w: m.w - 24, h: Math.max(46, m.h - 32 - btnH - 22),
    };
    this.win = win;
    const wg = this.scene.add.graphics();
    wg.fillStyle(0x1a0533, 1);
    wg.fillRoundedRect(win.x, win.y, win.w, win.h, 10);
    r.add(wg);

    // pegs: 2 rows of 3
    this.pegs = [];
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 3; i++) {
        const px = win.x + win.w * (0.2 + i * 0.3) + (row % 2) * win.w * 0.15;
        const py = win.y + win.h * (0.3 + row * 0.34);
        const peg = this.scene.add.image(px, py, 'dot').setScale(0.28).setTint(0xba68c8);
        r.add(peg);
        this.pegs.push(peg);
      }
    }

    // PULL button
    const by = m.y + m.h - btnH / 2 - 12;
    this.btnG = this.scene.add.graphics();
    r.add(this.btnG);
    this.btnText = this.scene.add.text(m.x + m.w / 2, by, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '22px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4, align: 'center',
    }).setOrigin(0.5);
    r.add(this.btnText);
    this.btnRect = { x: m.x + 12, y: by - btnH / 2, w: m.w - 24, h: btnH };

    this.btnZone = this.scene.add.zone(this.btnRect.x, this.btnRect.y, this.btnRect.w, this.btnRect.h)
      .setOrigin(0).setInteractive({ useHandCursor: true });
    this.btnZone.on('pointerdown', () => this._onPullTap());
    r.add(this.btnZone);

    // ticket pull button rides on top of the plinko window when available
    this.ticketBtn = this.scene.add.text(m.x + m.w / 2, win.y + win.h - 16, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '15px', color: '#80deea',
      stroke: '#000000', strokeThickness: 3, backgroundColor: '#00000088',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.ticketBtn.on('pointerdown', () => this._onTicketTap());
    r.add(this.ticketBtn);

    this.refresh();
  }

  refresh() {
    const why = this.gacha.whyNot();
    const cost = this.gacha.cost();
    const b = this.btnRect;
    this.btnG.clear();
    let label, color;
    if (this.busy) { label = '...'; color = 0x616161; }
    else if (why === 'coins') { label = 'NEED ' + HUD.money(cost); color = 0x757575; }
    else if (why === 'bench') { label = 'BENCH FULL!\nmerge or sell'; color = 0xbf360c; }
    else if (cost === 0) { label = 'FREE PULL!'; color = 0x43a047; }
    else { label = 'PULL  ' + HUD.money(cost); color = 0x43a047; }
    this.btnG.fillStyle(color, 1);
    this.btnG.fillRoundedRect(b.x, b.y, b.w, b.h, 14);
    this.btnG.lineStyle(3, 0x000000, 0.35);
    this.btnG.strokeRoundedRect(b.x, b.y, b.w, b.h, 14);
    this.btnText.setText(label);
    this.btnText.setFontSize(label.includes('\n') ? 15 : 22);

    const t = this.economy.tickets;
    this.ticketBtn.setText(t > 0 && !this.busy ? '\u{1F39F} GUARANTEED RARE (' + t + ')' : '');
    this.ticketBtn.setVisible(t > 0 && !this.busy);
  }

  // a tap anywhere on the machine can fast-forward the show
  handlePointerDown(pointer) {
    if (!this.busy || !this._pendingResult) return false;
    const m = LAYOUT.machine;
    if (pointer.x < m.x || pointer.x > m.x + m.w || pointer.y < m.y || pointer.y > m.y + m.h) return false;
    if (SaveSys.data.stats.pulls < CFG.MACHINE.skipAfterViews) return false;
    this._finishNow();
    return true;
  }

  _onPullTap() {
    if (this.busy) return;
    const why = this.gacha.whyNot();
    if (why) {
      AudioSys.sfx('denied');
      this.scene.tweens.add({ targets: this.btnText, x: this.btnText.x + 6, duration: 50, yoyo: true, repeat: 3 });
      if (why === 'bench') this.scene.fx.floatText(LAYOUT.machine.x + LAYOUT.machine.w / 2, LAYOUT.machine.y, 'MERGE OR SELL FIRST!', '#ff8a80', 18);
      return;
    }
    const result = this.gacha.pull();
    if (!result) return;
    this.scene.startGameplayOnInteraction();
    if (this.scene.tutorial) this.scene.tutorial.onPull();
    this._runTheater(result);
  }

  _onTicketTap() {
    if (this.busy) return;
    const result = this.gacha.ticketPull();
    if (!result) { AudioSys.sfx('denied'); return; }
    this.scene.startGameplayOnInteraction();
    this._runTheater(result);
  }

  // ---- the show ----

  _runTheater(result) {
    this.busy = true;
    this._pendingResult = result;
    this.refresh();
    AudioSys.sfx('pull');

    const win = this.win;
    const cap = this.scene.add.image(win.x + win.w / 2, win.y + 14, 'capsule')
      .setDepth(860).setScale(0.7);
    this._capsule = cap;

    // 3-5 bounces steered between pegs, then the landing
    const bounces = 3 + Math.floor(Math.random() * 3);
    const stepMs = Math.max(220, CFG.MACHINE.sequenceMs / (bounces + 2));
    let t = 0;
    for (let i = 0; i < bounces; i++) {
      t += stepMs;
      const tx = win.x + win.w * (0.2 + Math.random() * 0.6);
      const ty = win.y + win.h * (0.22 + (i + 1) * (0.6 / bounces));
      this._timers.push(this.scene.time.delayedCall(t, () => {
        AudioSys.sfx('bounce');
        this._tweens.push(this.scene.tweens.add({
          targets: cap, x: tx, y: ty, angle: cap.angle + 120,
          duration: stepMs * 0.9, ease: 'Bounce.easeOut',
        }));
      }));
    }
    t += stepMs * 1.4;
    this._timers.push(this.scene.time.delayedCall(t, () => this._land()));
  }

  _land() {
    if (!this._pendingResult) return;
    const result = this._pendingResult;
    const cap = this._capsule;
    const win = this.win;
    AudioSys.sfx('capsule');

    const tier = result.defs.length
      ? Math.max(...result.defs.map((d) => RARITIES[d.rarity].tier))
      : -1;

    const finish = () => this._finishNow();

    if (tier >= 4) {
      // legendary ceremony: the machine itself shakes, lights flash, a dark
      // silhouette beat, then the name in lights
      this._tweens.push(this.scene.tweens.add({
        targets: this.root, x: { from: -5, to: 5 }, duration: 60, yoyo: true, repeat: 7,
        onComplete: () => { this.root.x = 0; },
      }));
      this.pegs.forEach((p, i) => this._tweens.push(this.scene.tweens.add({
        targets: p, alpha: { from: 1, to: 0.2 }, duration: 120, yoyo: true, repeat: 6, delay: i * 40,
      })));
      this._timers.push(this.scene.time.delayedCall(520, () => {
        this.scene.fx.flash(0xffffff);
        AudioSys.sfx('legendary');
        if (cap) cap.setTint(0x111122);
        this._timers.push(this.scene.time.delayedCall(500, finish));
      }));
    } else if (tier >= 2) {
      const color = RARITIES[result.defs[0].rarity].color;
      this.scene.fx.ringPulse(cap.x, cap.y, color, 2.0);
      AudioSys.sfx('reveal');
      this._timers.push(this.scene.time.delayedCall(350, finish));
    } else {
      this._timers.push(this.scene.time.delayedCall(150, finish));
    }
  }

  _finishNow() {
    const result = this._pendingResult;
    if (!result) return;
    this._pendingResult = null;
    this._timers.forEach((t) => t.remove(false));
    this._tweens.forEach((t) => t.stop());
    this._timers = [];
    this._tweens = [];
    this.root.x = 0;
    this.pegs.forEach((p) => p.setAlpha(1));
    if (this._capsule) {
      const cap = this._capsule;
      this._capsule = null;
      this.scene.tweens.add({
        targets: cap, scale: 1.4, alpha: 0, duration: 200,
        onComplete: () => cap.destroy(),
      });
      this.scene.fx.sparks(cap.x, cap.y, 0xffffff, 10);
    }
    this.busy = false;
    if (this.onResult) this.onResult(result);
    this.refresh();
  }

  relayout() {
    // mid-show: settle instantly, then rebuild in place
    if (this.busy) this._finishNow();
    this._build();
  }
}
window.MachineUI = MachineUI;
