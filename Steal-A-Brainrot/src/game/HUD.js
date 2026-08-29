// Screen-space UI: coin pill, ticket chip, lives, stage/wave label, mute and
// BRAINDEX buttons. The pill measures its text unscaled and only re-lays out
// on width change -- squashing the text on every earn is what once made the
// counter drift.
class HUD {
  static money(n) {
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
    return '$' + Math.floor(n);
  }

  constructor(scene, economy) {
    this.scene = scene;
    this.economy = economy;
    this._lastCoins = -1;
    this._lastTickets = -1;
    this._lives = 3;

    const D = 1100;
    this.bg = scene.add.graphics().setDepth(D - 2).setScrollFactor(0);

    // coin pill (right-anchored)
    this.pill = scene.add.graphics().setDepth(D).setScrollFactor(0);
    this.coinIcon = scene.add.image(0, 0, 'coin').setDepth(D + 1).setScale(1.2);
    this.coinText = scene.add.text(0, 0, '$0', {
      fontFamily: 'Arial Black, Arial', fontSize: '24px', color: '#ffe082',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0, 0.5).setDepth(D + 1);

    // ticket chip
    this.ticketText = scene.add.text(0, 0, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '20px', color: '#80deea',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(1, 0.5).setDepth(D + 1);

    // lives
    this.hearts = [];
    for (let i = 0; i < 3; i++) {
      this.hearts.push(scene.add.image(0, 0, 'heart').setDepth(D + 1));
    }

    // stage / wave label
    this.stageText = scene.add.text(0, 0, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '20px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(D + 1);

    // buttons
    this.muteBtn = this._button(SaveSys.data.muted ? '\u{1F507}' : '\u{1F50A}', () => {
      SaveSys.data.muted = !SaveSys.data.muted;
      SaveSys.save();
      AudioSys.ensure();
      AudioSys.setMuted(SaveSys.data.muted);
      this.muteBtn.setText(SaveSys.data.muted ? '\u{1F507}' : '\u{1F50A}');
    });
    this.bookBtn = this._button('\u{1F4D6}', () => {
      if (this.scene.braindex) this.scene.braindex.toggle();
    });

    this.relayout();
  }

  _button(label, onTap) {
    const t = this.scene.add.text(0, 0, label, {
      fontSize: '30px', padding: { x: 6, y: 4 },
    }).setOrigin(0.5).setDepth(1102).setInteractive({ useHandCursor: true });
    t.on('pointerdown', (p, lx, ly, ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      AudioSys.sfx('tick');
      onTap();
    });
    return t;
  }

  setLives(n) {
    const prev = this._lives;
    this._lives = n;
    this.hearts.forEach((h, i) => {
      const on = i < n;
      if (!on && i < prev) {
        this.scene.tweens.add({
          targets: h, scale: { from: 1.4, to: 0.8 }, alpha: { from: 1, to: 0.25 },
          duration: 300, ease: 'Quad.easeOut',
        });
      } else {
        h.setAlpha(on ? 1 : 0.25).setScale(on ? 1 : 0.8);
      }
    });
  }

  setStage(str) { this.stageText.setText(str); }

  coinTarget() { return { x: this.coinIcon.x, y: this.coinIcon.y }; }

  bumpCoins() {
    this.scene.fx.squash(this.coinIcon, 0.3);
    AudioSys.sfx('coin');
  }

  refresh() {
    const c = Math.floor(this.economy.coins);
    if (c !== this._lastCoins) {
      this._lastCoins = c;
      const str = HUD.money(c);
      if (str !== this.coinText.text) {
        this.coinText.setText(str);
        this._layoutPill();
      }
    }
    if (this.economy.tickets !== this._lastTickets) {
      this._lastTickets = this.economy.tickets;
      this.ticketText.setText(this.economy.tickets > 0 ? '\u{1F39F} ' + this.economy.tickets : '');
      this._layoutPill();
    }
  }

  _layoutPill() {
    const h = LAYOUT.hud, pad = h.pad;
    const w = this.coinText.width + 46;
    const x = LAYOUT.width - pad - w, y = h.h / 2;
    this.pill.clear();
    this.pill.fillStyle(0x000000, 0.45);
    this.pill.fillRoundedRect(x, y - 20, w, 40, 20);
    this.coinIcon.setPosition(x + 20, y);
    this.coinIcon._sqX = 1.2; this.coinIcon._sqY = 1.2;
    this.coinText.setPosition(x + 36, y);
    this.ticketText.setPosition(x - 12, y);
  }

  relayout() {
    const h = LAYOUT.hud, pad = h.pad, y = h.h / 2;
    this.bg.clear();
    this.bg.fillStyle(0x0d1526, 0.85);
    this.bg.fillRect(0, 0, LAYOUT.width, h.h);

    this.muteBtn.setPosition(pad + 18, y);
    this.bookBtn.setPosition(pad + 62, y);
    this.hearts.forEach((heart, i) => heart.setPosition(pad + 108 + i * 30, y));
    this.stageText.setPosition(LAYOUT.width / 2, y);
    this._lastCoins = -1; this._lastTickets = -1;
    this.refresh();
    this._layoutPill();
  }
}
window.HUD = HUD;
