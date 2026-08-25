// Long-term progression: rebirth resets the run for permanent income, an
// extra starting slot, better conveyor luck and a new base look.
class RebirthSystem {
  constructor(scene) {
    this.scene = scene;
    const p = CFG.REBIRTH_PORTAL;
    this.portal = scene.add.image(p.x, p.y, 'portal').setDepth(p.y - 60);
    scene.tweens.add({ targets: this.portal, angle: 360, duration: 9000, repeat: -1 });
    this.reqText = scene.add.text(p.x, p.y + 54, this._reqStr(), {
      fontFamily: 'Arial Black, Arial', fontSize: '14px', color: '#d1c4e9',
      stroke: '#000000', strokeThickness: 3, align: 'center',
    }).setOrigin(0.5).setDepth(860);
    this.titleText = scene.add.text(p.x, p.y - 64, 'REBIRTH', {
      fontFamily: 'Arial Black, Arial', fontSize: '16px', color: '#b388ff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(860);
    this._confirmOpen = false;
  }

  _reqStr() {
    return '$' + CFG.REBIRTH_CASH.toLocaleString() + ' + own 1 ' + CFG.REBIRTH_RARITY.toUpperCase() + '+';
  }

  eligible() {
    const s = this.scene;
    return s.economy.cash.player >= CFG.REBIRTH_CASH &&
      s.creatures.hasTierAtLeast('player', RARITIES[CFG.REBIRTH_RARITY].tier);
  }

  openConfirm() {
    if (this._confirmOpen || !this.eligible()) return;
    this._confirmOpen = true;
    this.scene.hud.showRebirthConfirm(
      () => { this._confirmOpen = false; this.perform(); },
      () => { this._confirmOpen = false; }
    );
  }

  perform() {
    const s = this.scene;
    if (!this.eligible()) return;
    // natural break in play — the one interstitial slot in the game
    Poki.gameplayStop();
    Poki.commercialBreak().then(() => {
      Poki.gameplayStart();
      this._reset();
    });
  }

  _reset() {
    const s = this.scene;
    SaveSys.data.rebirths += 1;
    SaveSys.addStat('rebirths');
    const n = SaveSys.data.rebirths;

    s.creatures.removeAllOf('player');
    s.economy.cash.player = CFG.START_CASH;
    for (const k in s.upgrades) delete s.upgrades[k];
    s.bases.unlock('player');
    s.bases.lockState.player.cdUntil = 0;
    s.bases.refreshPedestals('player');
    s.bases.redrawPlayerFloor();
    SaveSys.clearRun();
    SaveSys.save();

    const home = s.bases.entranceOutside('player');
    s.player.sprite.setPosition(home.x, home.y - 10);
    s.player.carrying = null;

    AudioSys.sfx('rebirth');
    s.fx.flash(0xb388ff);
    s.fx.shake(0.01, 400);
    s.fx.confetti(CFG.W / 2, CFG.H / 2, 46);
    s.fx.banner('REBIRTH x' + n, '#b388ff',
      '+' + Math.round(CFG.REBIRTH_INCOME_BONUS * 100 * n) + '% PERMANENT INCOME  ·  +' + n + ' SLOT');
    Poki.happyTime(1);
  }

  update(time) {
    const ok = this.eligible();
    const pulse = 1 + (ok ? Math.sin(time / 200) * 0.08 : 0);
    this.portal.setScale(pulse);
    this.portal.setAlpha(ok ? 1 : 0.55);
    this.titleText.setColor(ok ? '#ea80fc' : '#b388ff');
    this.reqText.setText(ok ? 'READY! Hold SPACE inside' : this._reqStr());
  }
}
window.RebirthSystem = RebirthSystem;
