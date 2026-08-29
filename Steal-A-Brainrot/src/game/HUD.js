// In-level UI: brainz pill (left -- the energy counter every token flies to),
// this level's coin take (right), the level label + wave progress bar
// (centre) and the mute button. The pill measures its text unscaled and only
// re-lays out on change -- squashing the text on every earn is what once made
// the counter drift.
class HUD {
  static money(n) {
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
    return '$' + Math.floor(n);
  }

  constructor(scene, economy) {
    this.scene = scene;
    this.economy = economy;
    this._lastEnergy = -1;
    this._lastCoins = -1;
    this._progress = 0;

    const D = 1100;
    this.bg = scene.add.graphics().setDepth(D - 2).setScrollFactor(0);

    // brainz pill (left)
    this.energyPill = scene.add.graphics().setDepth(D);
    this.energyIcon = scene.add.image(0, 0, 'brainz').setDepth(D + 1).setScale(0.8);
    this.energyText = scene.add.text(0, 0, '0', {
      fontFamily: 'Arial Black, Arial', fontSize: '26px', color: '#f8bbd0',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0, 0.5).setDepth(D + 1);

    // coin chip (right of centre-right)
    this.coinPill = scene.add.graphics().setDepth(D);
    this.coinIcon = scene.add.image(0, 0, 'coin').setDepth(D + 1).setScale(1.1);
    this.coinText = scene.add.text(0, 0, '$0', {
      fontFamily: 'Arial Black, Arial', fontSize: '20px', color: '#ffe082',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0, 0.5).setDepth(D + 1);

    // level label + progress bar
    this.levelText = scene.add.text(0, 0, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '17px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(D + 1);
    this.barBg = scene.add.rectangle(0, 0, 100, 8, 0x263238).setDepth(D + 1).setOrigin(0, 0.5);
    this.barFg = scene.add.rectangle(0, 0, 100, 6, 0xef5350).setDepth(D + 2).setOrigin(0, 0.5);
    this.barSkull = scene.add.image(0, 0, 'star').setDepth(D + 3).setScale(0.5).setTint(0xff8a80);

    this.muteBtn = this._button(SaveSys.data.muted ? '\u{1F507}' : '\u{1F50A}', () => {
      SaveSys.data.muted = !SaveSys.data.muted;
      SaveSys.save();
      AudioSys.ensure();
      AudioSys.setMuted(SaveSys.data.muted);
      this.muteBtn.setText(SaveSys.data.muted ? '\u{1F507}' : '\u{1F50A}');
    });

    this.relayout();
  }

  _button(label, onTap) {
    const t = this.scene.add.text(0, 0, label, {
      fontSize: '26px', padding: { x: 6, y: 4 },
    }).setOrigin(0.5).setDepth(1102).setInteractive({ useHandCursor: true });
    t.on('pointerdown', (p, lx, ly, ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      AudioSys.sfx('tick');
      onTap();
    });
    return t;
  }

  setLevelLabel(str) { this.levelText.setText(str); this._layoutCenter(); }

  setProgress(f) {
    this._progress = Math.max(0, Math.min(1, f));
    this.barFg.width = this.barBg.width * this._progress;
    this.barSkull.x = this.barBg.x + this.barBg.width * this._progress;
  }

  energyTarget() { return { x: this.energyIcon.x, y: this.energyIcon.y }; }
  coinTarget() { return { x: this.coinIcon.x, y: this.coinIcon.y }; }

  bumpEnergy() { this.scene.fx.squash(this.energyIcon, 0.3); }
  bumpCoins() { this.scene.fx.squash(this.coinIcon, 0.3); AudioSys.sfx('coin'); }

  refresh() {
    const e = Math.floor(this.economy.energy);
    if (e !== this._lastEnergy) {
      this._lastEnergy = e;
      this.energyText.setText(String(e));
      this._layoutEnergy();
    }
    const c = Math.floor(this.economy.pendingCoins);
    if (c !== this._lastCoins) {
      this._lastCoins = c;
      this.coinText.setText(HUD.money(c));
      this._layoutCoins();
    }
  }

  _layoutEnergy() {
    const h = LAYOUT.hud, pad = h.pad, y = h.h / 2;
    const w = this.energyText.width + 58;
    this.energyPill.clear();
    this.energyPill.fillStyle(0x000000, 0.45);
    this.energyPill.fillRoundedRect(pad, y - 21, w, 42, 21);
    this.energyIcon.setPosition(pad + 24, y);
    this.energyIcon._sqX = 0.8; this.energyIcon._sqY = 0.8;
    this.energyText.setPosition(pad + 46, y);
  }

  _layoutCoins() {
    const h = LAYOUT.hud, y = h.h / 2;
    const w = this.coinText.width + 44;
    const x = LAYOUT.width - h.pad - 46 - w;
    this.coinPill.clear();
    this.coinPill.fillStyle(0x000000, 0.45);
    this.coinPill.fillRoundedRect(x, y - 17, w, 34, 17);
    this.coinIcon.setPosition(x + 18, y);
    this.coinIcon._sqX = 1.1; this.coinIcon._sqY = 1.1;
    this.coinText.setPosition(x + 32, y);
  }

  _layoutCenter() {
    const h = LAYOUT.hud, y = h.h / 2;
    const barW = Math.min(220, LAYOUT.width * 0.24);
    this.levelText.setPosition(LAYOUT.width / 2, y - 12);
    this.barBg.setPosition(LAYOUT.width / 2 - barW / 2, y + 12).width = barW;
    this.barFg.setPosition(LAYOUT.width / 2 - barW / 2, y + 12);
    this.setProgress(this._progress);
  }

  relayout() {
    const h = LAYOUT.hud;
    this.bg.clear();
    this.bg.fillStyle(0x0d1526, 0.88);
    this.bg.fillRect(0, 0, LAYOUT.width, h.h);
    this.muteBtn.setPosition(LAYOUT.width - h.pad - 20, h.h / 2);
    this._lastEnergy = -1; this._lastCoins = -1;
    this._layoutCenter();
    this.refresh();
  }
}
window.HUD = HUD;
