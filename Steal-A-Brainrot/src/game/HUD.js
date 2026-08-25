// All screen-space UI: cash/income counters, objective line, lock button,
// event timer, mute/collection/rewarded buttons, the upgrade panel (auto-
// opens near the station), the collection overlay and the rebirth confirm.
class HUD {
  constructor(scene) {
    this.scene = scene;
    const D = 950;

    // ---- cash (top-left) ----
    scene.add.rectangle(110, 46, 220, 92, 0x000000, 0.62).setDepth(D - 1);
    scene.add.image(26, 26, 'coin').setDepth(D).setScale(1.3);
    this.cashText = scene.add.text(44, 14, '$0', {
      fontFamily: 'Arial Black, Arial', fontSize: '26px', color: '#ffe082',
      stroke: '#000000', strokeThickness: 5,
    }).setDepth(D);
    this.incomeText = scene.add.text(44, 44, '', {
      fontFamily: 'Arial', fontSize: '15px', color: '#b9f6ca',
      stroke: '#000000', strokeThickness: 3,
    }).setDepth(D);
    this.rebirthText = scene.add.text(44, 64, '', {
      fontFamily: 'Arial', fontSize: '14px', color: '#b388ff',
      stroke: '#000000', strokeThickness: 3,
    }).setDepth(D);
    this._lastCash = -1;

    // ---- objective (top-center) ----
    this.objectiveText = scene.add.text(CFG.W / 2, 16, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '18px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(D);
    this.eventText = scene.add.text(CFG.W / 2, 44, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '15px', color: '#ffd54f',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(D);

    // ---- buttons (top-right) ----
    this.muteBtn = this._button(CFG.W - 40, 30, SaveSys.data.muted ? '🔇' : '🔊', () => {
      SaveSys.data.muted = !SaveSys.data.muted;
      SaveSys.save();
      AudioSys.setMuted(SaveSys.data.muted);
      this.muteBtn.setText(SaveSys.data.muted ? '🔇' : '🔊');
    }, '22px');
    this.collBtn = this._button(CFG.W - 40, 74, '📖', () => this.toggleCollection(), '22px');
    scene.add.text(CFG.W - 40, 96, '[C]', { fontFamily: 'Arial', fontSize: '11px', color: '#ffffff' })
      .setOrigin(0.5, 0).setDepth(D).setAlpha(0.7);
    this.frenzyBtn = this._button(CFG.W - 52, 132, '📺 x2', () => this._frenzy(), '18px');
    this.frenzyBtn.setVisible(false);

    // ---- lock button (bottom-left) ----
    this.lockBtn = scene.add.text(20, CFG.H - 58, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '19px', color: '#ffffff',
      backgroundColor: '#00000088', padding: { x: 14, y: 10 },
    }).setDepth(D).setInteractive();
    this.lockBtn.on('pointerdown', () => this.tryLock());

    // ---- overlays ----
    this._buildUpgradePanel();
    this._buildCollection();
    this._buildRebirthConfirm();
    this._upgradeOpen = false;
  }

  _button(x, y, label, cb, size) {
    const b = this.scene.add.text(x, y, label, {
      fontFamily: 'Arial', fontSize: size || '18px', color: '#ffffff',
      backgroundColor: '#00000066', padding: { x: 8, y: 6 },
    }).setOrigin(0.5).setDepth(950).setInteractive();
    b.on('pointerdown', cb);
    return b;
  }

  // ---------- lock ----------
  tryLock() {
    const s = this.scene;
    const ok = s.bases.lock('player', s.bases.playerLockDuration());
    if (!ok) AudioSys.sfx('denied');
  }

  // ---------- rewarded frenzy ----------
  _frenzy() {
    const s = this.scene;
    if (s.time.now < s.economy.frenzyReadyAt || s.time.now < s.economy.frenzyUntil) return;
    Poki.rewardedBreak().then((ok) => {
      if (ok) {
        s.economy.startFrenzy();
        s.fx.banner('INCOME FRENZY!', '#ffd54f', 'x2 cash for 60 seconds!');
        AudioSys.sfx('legendary');
      } else {
        s.fx.floatText(CFG.W - 80, 140, 'No ad available', '#ff8a80', 14);
      }
    });
  }

  // ---------- upgrade panel ----------
  _buildUpgradePanel() {
    const s = this.scene;
    const w = 380, h = 320, x = CFG.W / 2 - w / 2, y = CFG.H / 2 - h / 2 - 20;
    const c = s.add.container(0, 0).setDepth(960).setVisible(false);
    const bg = s.add.rectangle(x + w / 2, y + h / 2, w, h, 0x1a237e, 0.94)
      .setStrokeStyle(4, 0x7986cb);
    c.add(bg);
    c.add(s.add.text(x + w / 2, y + 18, 'UPGRADES', {
      fontFamily: 'Arial Black, Arial', fontSize: '24px', color: '#ffd54f',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5, 0));
    this._upgRows = [];
    CFG.UPGRADES.forEach((u, i) => {
      const ry = y + 66 + i * 48;
      const row = s.add.text(x + 22, ry, '', {
        fontFamily: 'Arial Black, Arial', fontSize: '16px', color: '#ffffff',
        backgroundColor: '#00000055', padding: { x: 10, y: 8 }, fixedWidth: w - 44,
      }).setInteractive();
      row.on('pointerdown', () => this._buyUpgrade(u));
      c.add(row);
      this._upgRows.push({ u, row });
    });
    this.upgPanel = c;
  }

  upgradeCost(u) {
    const lvl = this.scene.upgrades[u.id] || 0;
    return Math.floor(u.base * Math.pow(u.mul, lvl));
  }

  _refreshUpgradePanel() {
    const s = this.scene;
    this._upgRows.forEach(({ u, row }) => {
      const lvl = s.upgrades[u.id] || 0;
      if (lvl >= u.max) {
        row.setText(u.name + '  (MAX)');
        row.setColor('#9e9e9e');
      } else {
        const cost = this.upgradeCost(u);
        row.setText(u.name + '  Lv' + lvl + '  —  $' + cost.toLocaleString());
        row.setColor(s.economy.canAfford('player', cost) ? '#b9f6ca' : '#ff8a80');
      }
    });
  }

  _buyUpgrade(u) {
    const s = this.scene;
    const lvl = s.upgrades[u.id] || 0;
    if (lvl >= u.max) return;
    const cost = this.upgradeCost(u);
    if (!s.economy.spend('player', cost)) { AudioSys.sfx('denied'); return; }
    s.upgrades[u.id] = lvl + 1;
    AudioSys.sfx('upgrade');
    s.fx.coinBurst(CFG.W / 2, CFG.H / 2, 10);
    s.fx.floatText(CFG.W / 2, CFG.H / 2 - 60, u.name + '!', '#69f0ae', 22);
    if (u.id === 'slot') s.bases.refreshPedestals('player');
    this._refreshUpgradePanel();
  }

  // ---------- collection ----------
  _buildCollection() {
    const s = this.scene;
    const c = s.add.container(0, 0).setDepth(970).setVisible(false);
    c.add(s.add.rectangle(CFG.W / 2, CFG.H / 2, CFG.W, CFG.H, 0x000000, 0.82).setInteractive()
      .on('pointerdown', () => this.toggleCollection()));
    this.collHeader = s.add.text(CFG.W / 2, 56, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '30px', color: '#ffd54f',
      stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5);
    c.add(this.collHeader);
    this._collSlots = [];
    // 7 across keeps the whole cast on three rows; a fourth row would fall off
    // the bottom of a 720-high screen.
    const cols = 7, cw = 174, ch = 168;
    const x0 = CFG.W / 2 - ((cols - 1) * cw) / 2;
    CREATURES.forEach((def, i) => {
      const cx = x0 + (i % cols) * cw;
      const cy = 170 + Math.floor(i / cols) * ch;
      const img = s.add.image(cx, cy, 'cr_' + def.id)
        .setScale(1.05 * TextureFactory.scaleFor(s, 'cr_' + def.id, CFG.CREATURE_H));
      const name = s.add.text(cx, cy + 50, '', {
        fontFamily: 'Arial', fontSize: '13px', color: '#ffffff', align: 'center',
        stroke: '#000000', strokeThickness: 3,
        wordWrap: { width: 162 },
      }).setOrigin(0.5, 0);
      const rar = s.add.text(cx, cy + 88, '', {
        fontFamily: 'Arial Black, Arial', fontSize: '11px', align: 'center',
      }).setOrigin(0.5, 0);
      c.add([img, name, rar]);
      this._collSlots.push({ def, img, name, rar });
    });
    c.add(s.add.text(CFG.W / 2, CFG.H - 34, 'tap anywhere to close', {
      fontFamily: 'Arial', fontSize: '14px', color: '#aaaaaa',
    }).setOrigin(0.5));
    this.collPanel = c;
  }

  toggleCollection() {
    const open = !this.collPanel.visible;
    this.collPanel.setVisible(open);
    if (!open) return;
    const found = SaveSys.data.discovered.length;
    this.collHeader.setText(found + ' / ' + CREATURES.length + ' FOUND');
    this._collSlots.forEach(({ def, img, name, rar }) => {
      const known = SaveSys.data.discovered.indexOf(def.id) !== -1;
      if (known) {
        img.clearTint();
        name.setText(def.name);
        rar.setText(RARITIES[def.rarity].name);
        rar.setColor('#' + RARITIES[def.rarity].color.toString(16).padStart(6, '0'));
      } else {
        img.setTintFill(0x111122);
        name.setText('???');
        rar.setText('');
      }
    });
  }

  // ---------- rebirth confirm ----------
  _buildRebirthConfirm() {
    const s = this.scene;
    const c = s.add.container(0, 0).setDepth(975).setVisible(false);
    c.add(s.add.rectangle(CFG.W / 2, CFG.H / 2, CFG.W, CFG.H, 0x000000, 0.7));
    c.add(s.add.rectangle(CFG.W / 2, CFG.H / 2, 480, 270, 0x311b92, 0.97).setStrokeStyle(4, 0xb388ff));
    c.add(s.add.text(CFG.W / 2, CFG.H / 2 - 92, 'REBIRTH?', {
      fontFamily: 'Arial Black, Arial', fontSize: '36px', color: '#ea80fc',
      stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5));
    c.add(s.add.text(CFG.W / 2, CFG.H / 2 - 30,
      'KEEP forever:  +25% income · +1 slot · better luck\nLOSE: cash, creatures, temporary upgrades', {
      fontFamily: 'Arial', fontSize: '16px', color: '#ffffff', align: 'center',
    }).setOrigin(0.5));
    this._rbYes = s.add.text(CFG.W / 2 - 90, CFG.H / 2 + 62, 'REBIRTH!', {
      fontFamily: 'Arial Black, Arial', fontSize: '22px', color: '#ffffff',
      backgroundColor: '#7b1fa2', padding: { x: 18, y: 10 },
    }).setOrigin(0.5).setInteractive();
    this._rbNo = s.add.text(CFG.W / 2 + 110, CFG.H / 2 + 62, 'NOT YET', {
      fontFamily: 'Arial Black, Arial', fontSize: '18px', color: '#cccccc',
      backgroundColor: '#00000066', padding: { x: 14, y: 10 },
    }).setOrigin(0.5).setInteractive();
    c.add([this._rbYes, this._rbNo]);
    this.rbPanel = c;
  }

  showRebirthConfirm(onYes, onNo) {
    this.rbPanel.setVisible(true);
    this._rbYes.removeAllListeners('pointerdown');
    this._rbNo.removeAllListeners('pointerdown');
    this._rbYes.on('pointerdown', () => { this.rbPanel.setVisible(false); onYes(); });
    this._rbNo.on('pointerdown', () => { this.rbPanel.setVisible(false); onNo(); });
  }

  // ---------- per-frame ----------
  update(time) {
    const s = this.scene;
    const cash = Math.floor(s.economy.cash.player);
    if (cash !== this._lastCash) {
      this.cashText.setText('$' + cash.toLocaleString());
      if (this._lastCash !== -1 && cash > this._lastCash) s.fx.squash(this.cashText, 0.12);
      this._lastCash = cash;
    }
    this.incomeText.setText('+$' + Math.floor(s.economy.incomePerSec('player')) + '/s' +
      (time < s.economy.frenzyUntil ? '  🔥x2' : ''));
    const rb = SaveSys.data.rebirths;
    this.rebirthText.setText(rb > 0 ? '⭐ REBIRTH x' + rb : '');

    // objective line: tutorial first, then the rebirth goal
    const tut = s.tutorial.objective();
    this.objectiveText.setText(tut ||
      ('GOAL: $' + CFG.REBIRTH_CASH.toLocaleString() + ' + 1 EPIC → REBIRTH PORTAL'));

    // event countdown
    const ev = s.eventMgr.activeName();
    this.eventText.setText(ev ? ev.name + ' ' + Math.ceil((s.eventMgr.until - time) / 1000) + 's' : '');

    // lock button state
    const st = s.bases.lockState.player;
    if (st.locked) {
      this.lockBtn.setText('🔒 LOCKED ' + Math.ceil((st.until - time) / 1000) + 's');
      this.lockBtn.setBackgroundColor('#33691e');
    } else if (time < st.cdUntil) {
      this.lockBtn.setText('🔒 WAIT ' + Math.ceil((st.cdUntil - time) / 1000) + 's');
      this.lockBtn.setBackgroundColor('#00000088');
      this.lockBtn.setColor('#888888');
    } else {
      this.lockBtn.setText('🔒 LOCK BASE [L]');
      this.lockBtn.setBackgroundColor('#b71c1c');
      this.lockBtn.setColor('#ffffff');
    }

    // frenzy button: only offered when an ad could actually play
    const canFrenzy = Poki.ready && time >= s.economy.frenzyReadyAt && time >= s.economy.frenzyUntil;
    this.frenzyBtn.setVisible(!!canFrenzy);

    // upgrade panel opens when near the station
    const nearStation = Phaser.Math.Distance.Between(
      s.player.x, s.player.y, CFG.UPGRADE_STATION.x, CFG.UPGRADE_STATION.y) < 92;
    if (nearStation && !this._upgradeOpen) {
      this._upgradeOpen = true;
      this.upgPanel.setVisible(true);
      this._refreshUpgradePanel();
    } else if (!nearStation && this._upgradeOpen) {
      this._upgradeOpen = false;
      this.upgPanel.setVisible(false);
    } else if (this._upgradeOpen && (time % 500) < 20) {
      this._refreshUpgradePanel();
    }
  }
}
window.HUD = HUD;
