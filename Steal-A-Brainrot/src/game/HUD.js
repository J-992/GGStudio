// All screen-space UI: the cash panel (top-right, and the loudest thing on the
// screen), objective / tutorial card, lock button, event timer, the small
// buttons in the top-left, the upgrade panel (auto-opens near the station,
// with a world-space beacon pointing at it) and the collection overlay.
class HUD {
  // Right edge of the cash panel, in screen px. Everything in the panel hangs
  // off this rather than off CFG.W, so the inset is stated once.
  static get PILL_RIGHT() { return CFG.W - 14; }

  // Cash reaches six figures (the secret creature costs $120,000), so every
  // price in the game goes through here rather than toLocaleString: a compact
  // string is what keeps the counter inside its pill.
  static money(n) {
    const v = Math.floor(n);
    if (v >= 1000000) return '$' + (v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (v >= 10000) return '$' + (v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return '$' + v.toLocaleString();
  }

  constructor(scene) {
    this.scene = scene;
    const D = 950;
    this.D = D;

    this._buildCashPill();

    // ---- objective (top-center) ----
    this.objectiveText = scene.add.text(CFG.W / 2, 16, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '18px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(D);
    this.eventText = scene.add.text(CFG.W / 2, 44, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '15px', color: '#ffd54f',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(D);

    this._buildStepCard();

    // ---- buttons (top-left) ----
    // The whole top-right corner belongs to the cash counter now, so the small
    // stuff moved across rather than sharing the corner with it.
    this.muteBtn = this._button(38, 34, SaveSys.data.muted ? '🔇' : '🔊', () => {
      SaveSys.data.muted = !SaveSys.data.muted;
      SaveSys.save();
      AudioSys.setMuted(SaveSys.data.muted);
      this.muteBtn.setText(SaveSys.data.muted ? '🔇' : '🔊');
    }, '22px');
    this.collBtn = this._button(90, 34, '📖', () => this.toggleCollection(), '22px');
    this.helpBtn = this._button(142, 34, '❓', () => scene.tutorial.restart(), '22px');
    this.frenzyBtn = this._button(62, 84, '📺 x2', () => this._frenzy(), '18px');
    this.frenzyBtn.setVisible(false);

    // ---- lock button (bottom-left) ----
    this._kb = !scene.inputMgr.isTouch;
    this.lockBtn = scene.add.text(20, CFG.H - 58, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '19px', color: '#ffffff',
      backgroundColor: '#00000088', padding: { x: 14, y: 10 },
    }).setDepth(D).setInteractive();
    this.lockBtn.on('pointerdown', () => this.tryLock());

    // ---- overlays ----
    this._buildUpgradePanel();
    this._buildStationBeacon();
    this._buildCollection();
    this._buildPopup();
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

  // ---------- cash pill ----------
  // Top-right, and the biggest text on the screen: cash is the score, so it
  // takes the corner the player's eye already goes to.
  //
  // Everything in here is anchored to the RIGHT edge and grows leftward, which
  // is what keeps a six-figure number inside the panel. Widths are measured
  // unscaled (see _textW) so the counter's pop cannot feed back into the panel
  // it lives in.
  _buildCashPill() {
    const s = this.scene, D = this.D, R = HUD.PILL_RIGHT;
    this.pillG = s.add.graphics().setDepth(D - 1);
    this.coinIcon = s.add.image(R - 200, 52, 'coin').setDepth(D).setScale(2.2);
    this.cashText = s.add.text(R - 18, 52, '$0', {
      fontFamily: 'Arial Black, Arial', fontSize: '42px', color: '#ffe082',
      stroke: '#000000', strokeThickness: 6,
    }).setOrigin(1, 0.5).setDepth(D);
    this.incomeText = s.add.text(R - 18, 96, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '18px', color: '#b9f6ca',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(1, 0.5).setDepth(D);
    // chip sits under the pill and only exists when it has something to say
    this.frenzyChip = s.add.text(R - 18, 124, '🔥 x2', {
      fontFamily: 'Arial Black, Arial', fontSize: '14px', color: '#fff59d',
      backgroundColor: '#e65100cc', padding: { x: 8, y: 4 },
    }).setOrigin(1, 0).setDepth(D).setVisible(false);
    this._pillW = -1;
    this._lastCash = -1;
    this._lastInc = '';
    this._popAt = 0;
  }

  // A Text's `width` is its RENDERED width, scale included, so reading it
  // while the counter is mid-pop reports a stretched number. Dividing the
  // scale back out keeps the layout still.
  static _textW(t) { return t.displayWidth / (t.scaleX || 1); }

  _layoutPill() {
    const R = HUD.PILL_RIGHT;
    const cashW = HUD._textW(this.cashText);
    const coinW = this.coinIcon.displayWidth;
    // the coin sits just left of the number and slides out as the number grows
    this.coinIcon.x = R - 18 - cashW - 14 - coinW / 2;
    const w = Math.max(214, cashW + coinW + 52, HUD._textW(this.incomeText) + 40);
    if (w === this._pillW) return;
    this._pillW = w;
    const g = this.pillG;
    g.clear();
    g.fillStyle(0x000000, 0.58);
    g.fillRoundedRect(R - w, 12, w, 104, 18);
    g.lineStyle(3, 0xffd54f, 0.55);
    g.strokeRoundedRect(R - w, 12, w, 104, 18);
  }

  // where flying coins should land
  coinTarget() { return { x: this.coinIcon.x, y: this.coinIcon.y }; }

  // ---------- tutorial step card ----------
  _buildStepCard() {
    const s = this.scene;
    const c = s.add.container(0, 0).setDepth(this.D).setVisible(false);
    this.stepG = s.add.graphics();
    this.stepNum = s.add.text(CFG.W / 2, 22, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '13px', color: '#ffd54f',
    }).setOrigin(0.5, 0);
    this.stepText = s.add.text(CFG.W / 2, 38, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '22px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5, 0);
    c.add([this.stepG, this.stepNum, this.stepText]);
    this.stepCard = c;
    this._stepW = -1;
  }

  _showStep(card) {
    this.stepCard.setVisible(true);
    this.stepNum.setText(card.n + ' / ' + card.total);
    this.stepText.setText(card.text);
    const w = Math.max(220, this.stepText.width + 56);
    if (w !== this._stepW) {
      this._stepW = w;
      this.stepG.clear();
      this.stepG.fillStyle(0x000000, 0.6);
      this.stepG.fillRoundedRect(CFG.W / 2 - w / 2, 14, w, 60, 14);
      this.stepG.lineStyle(3, 0xffd54f, 0.6);
      this.stepG.strokeRoundedRect(CFG.W / 2 - w / 2, 14, w, 60, 14);
    }
  }

  // ---------- teaching popup ----------
  // One rebuilt card for every concept the game has to explain. Everything
  // stops while it is up: one idea on screen, dismissed by one button, and
  // only then does the player get asked to do anything.
  _buildPopup() {
    const s = this.scene;
    const c = s.add.container(0, 0).setDepth(985).setVisible(false);
    c.add(s.add.rectangle(CFG.W / 2, CFG.H / 2, CFG.W, CFG.H, 0x000000, 0.72).setInteractive());
    this.popBg = s.add.rectangle(CFG.W / 2, CFG.H / 2, 540, 250, 0x1a237e, 0.97)
      .setStrokeStyle(4, 0x7986cb);
    c.add(this.popBg);
    this.popIcon = s.add.text(CFG.W / 2, CFG.H / 2 - 92, '', {
      fontFamily: 'Arial', fontSize: '34px',
    }).setOrigin(0.5);
    this.popTitle = s.add.text(CFG.W / 2, CFG.H / 2 - 46, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '30px', color: '#ffd54f',
      stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5);
    this.popBody = s.add.text(CFG.W / 2, CFG.H / 2 + 12, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '19px', color: '#ffffff',
      align: 'center', lineSpacing: 7, wordWrap: { width: 470 },
    }).setOrigin(0.5);
    this.popBtn = s.add.text(CFG.W / 2, CFG.H / 2 + 86, 'GOT IT', {
      fontFamily: 'Arial Black, Arial', fontSize: '24px', color: '#ffffff',
      backgroundColor: '#43a047', padding: { x: 30, y: 10 },
    }).setOrigin(0.5).setInteractive();
    this.popBtn.on('pointerdown', () => this.hidePopup());
    c.add([this.popIcon, this.popTitle, this.popBody, this.popBtn]);
    this.popup = c;
    this.popupOpen = false;
    this._popOnClose = null;
  }

  showPopup(cfg) {
    this.popIcon.setText(cfg.icon || '');
    this.popTitle.setText(cfg.title || '');
    this.popBody.setText(cfg.body || '');
    this.popBtn.setText(cfg.button || 'GOT IT');
    // the card grows to fit its body rather than clipping longer copy
    this.popBg.setSize(540, Math.max(230, this.popBody.height + 190));
    this._popOnClose = cfg.onClose || null;
    this.popup.setVisible(true);
    this.popupOpen = true;
    AudioSys.sfx('tick');
  }

  hidePopup() {
    if (!this.popupOpen) return;
    this.popup.setVisible(false);
    this.popupOpen = false;
    const cb = this._popOnClose;
    this._popOnClose = null;
    if (cb) cb();
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
        s.fx.banner('INCOME FRENZY!', '#ffd54f', 'x2 for 60s');
        AudioSys.sfx('legendary');
      } else {
        s.fx.floatText(120, 122, 'No ad available', '#ff8a80', 14);
      }
    });
  }

  // ---------- upgrade panel ----------
  // Every row says what it DOES, not just what it is called. The old panel was
  // five bare names and five prices, which reads as a list of things you have
  // to already understand -- CFG carries a one-line `desc` for each and it was
  // going unused.
  ROW_H() { return 56; }

  _buildUpgradePanel() {
    const s = this.scene;
    const rh = this.ROW_H();
    const w = 440, top = 66;
    const h = top + (CFG.UPGRADES.length + 1) * rh + 42;
    const x = CFG.W / 2 - w / 2, y = CFG.H / 2 - h / 2 - 10;
    const c = s.add.container(0, 0).setDepth(960).setVisible(false);
    c.add(s.add.rectangle(x + w / 2, y + h / 2, w, h, 0x1a237e, 0.94)
      .setStrokeStyle(4, 0x7986cb));
    c.add(s.add.text(x + w / 2, y + 14, 'UPGRADES', {
      fontFamily: 'Arial Black, Arial', fontSize: '24px', color: '#ffd54f',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5, 0));
    c.add(s.add.text(x + w / 2, y + 42, 'tap a row to buy', {
      fontFamily: 'Arial', fontSize: '13px', color: '#9fa8da',
    }).setOrigin(0.5, 0));

    this._upgRows = [];
    CFG.UPGRADES.forEach((u, i) => {
      const row = this._panelRow(c, x, y + top + i * rh, w, () => this._buyUpgrade(u));
      row.desc.setText(u.desc);
      this._upgRows.push({ u, row });
    });

    // Consumable, not an upgrade: buy a 30s lock on the spot. Sits below a
    // divider so it does not read as another permanent level.
    const dy = y + top + CFG.UPGRADES.length * rh + 4;
    const rule = s.add.graphics();
    rule.lineStyle(2, 0x7986cb, 0.7);
    rule.beginPath(); rule.moveTo(x + 22, dy); rule.lineTo(x + w - 22, dy); rule.strokePath();
    c.add(rule);
    this.lockBuyRow = this._panelRow(c, x, dy + 8, w, () => this._buyLock());
    this.lockBuyRow.desc.setText('Shuts rivals out, no cooldown');

    this.upgPanel = c;
    this._locksBought = 0;
  }

  // one clickable row: title on the left, price on the right, what-it-does
  // underneath in a quieter colour
  _panelRow(c, x, y, w, onBuy) {
    const s = this.scene, rw = w - 44, rh = this.ROW_H() - 8;
    const bg = s.add.rectangle(x + 22 + rw / 2, y + rh / 2, rw, rh, 0x000000, 0.33)
      .setStrokeStyle(2, 0x5c6bc0, 0.5).setInteractive();
    bg.on('pointerdown', onBuy);
    const title = s.add.text(x + 34, y + 7, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '17px', color: '#ffffff',
    });
    const cost = s.add.text(x + w - 34, y + 7, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '17px', color: '#b9f6ca',
    }).setOrigin(1, 0);
    const desc = s.add.text(x + 34, y + 28, '', {
      fontFamily: 'Arial', fontSize: '13px', color: '#c5cae9',
    });
    c.add([bg, title, cost, desc]);
    return { bg, title, cost, desc };
  }

  // ---------- purchasable lock ----------
  lockBuyCost() {
    return Math.floor(CFG.LOCK_BUY_COST * Math.pow(CFG.LOCK_BUY_GROWTH, this._locksBought || 0));
  }

  _buyLock() {
    const s = this.scene;
    if (s.bases.isLocked('player')) {
      s.fx.floatText(CFG.W / 2, CFG.H / 2 + 120, 'ALREADY LOCKED', '#ff8a80', 18);
      AudioSys.sfx('denied');
      return;
    }
    const cost = this.lockBuyCost();
    if (!s.economy.spend('player', cost)) { AudioSys.sfx('denied'); return; }
    this._locksBought = (this._locksBought || 0) + 1;
    s.bases.lock('player', CFG.LOCK_BUY_MS, true);
    s.fx.floatText(CFG.W / 2, CFG.H / 2 + 120, 'BASE SHUT FOR 30s', '#69f0ae', 20);
    this._refreshUpgradePanel();
  }

  upgradeCost(u) {
    const lvl = this.scene.upgrades[u.id] || 0;
    return Math.floor(u.base * Math.pow(u.mul, lvl));
  }

  _refreshUpgradePanel() {
    const s = this.scene;
    this._upgRows.forEach(({ u, row }) => {
      const lvl = s.upgrades[u.id] || 0;
      const maxed = lvl >= u.max;
      const cost = maxed ? 0 : this.upgradeCost(u);
      const afford = !maxed && s.economy.canAfford('player', cost);
      row.title.setText(u.name + (lvl > 0 ? '   Lv ' + lvl + ' / ' + u.max : ''));
      row.title.setColor(maxed ? '#9e9e9e' : '#ffffff');
      row.cost.setText(maxed ? 'MAXED' : HUD.money(cost));
      row.cost.setColor(maxed ? '#9e9e9e' : (afford ? '#b9f6ca' : '#ff8a80'));
      row.desc.setColor(maxed ? '#757575' : '#c5cae9');
      // an affordable row lights up, so "what can I buy right now" is one look
      row.bg.setStrokeStyle(2, afford ? 0x69f0ae : 0x5c6bc0, afford ? 0.95 : 0.5);
    });

    const lc = this.lockBuyCost();
    const held = s.bases.isLocked('player');
    const afford = !held && s.economy.canAfford('player', lc);
    this.lockBuyRow.title.setText('🔒 LOCK BASE 30s');
    this.lockBuyRow.title.setColor(held ? '#9e9e9e' : '#ffffff');
    this.lockBuyRow.cost.setText(held ? 'ON NOW' : HUD.money(lc));
    this.lockBuyRow.cost.setColor(held ? '#9e9e9e' : (afford ? '#b9f6ca' : '#ff8a80'));
    this.lockBuyRow.bg.setStrokeStyle(2, afford ? 0x69f0ae : 0x5c6bc0, afford ? 0.95 : 0.5);
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
    c.add(s.add.text(CFG.W / 2, CFG.H - 34, 'tap to close', {
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

  // ---------- per-frame ----------
  update(time) {
    const s = this.scene;
    const cash = Math.floor(s.economy.cash.player);
    if (cash !== this._lastCash) {
      this.cashText.setText(HUD.money(cash));
      // The counter changes many times a second at any real income. Popping it
      // on every one of those is both illegible and, before the fix in
      // Effects.squash, the thing that stretched it off the screen.
      if (this._lastCash !== -1 && cash > this._lastCash && time > this._popAt) {
        this._popAt = time + 320;
        s.fx.squash(this.cashText, 0.1);
      }
      this._lastCash = cash;
    }
    const inc = '+' + HUD.money(s.economy.incomePerSec('player')) + ' / sec';
    if (inc !== this._lastInc) { this.incomeText.setText(inc); this._lastInc = inc; }
    this._layoutPill();

    this.frenzyChip.setVisible(time < s.economy.frenzyUntil);

    // top-center: the tutorial card while it runs, the collection goal after.
    // During a lesson neither shows -- the popup is the only thing talking.
    const card = s.tutorial.card();
    this.stepCard.setVisible(!!card);
    if (card) this._showStep(card);
    this.objectiveText.setText(card || s.tutorial.quiet() ? ''
      : '📖 ' + SaveSys.data.discovered.length + ' / ' + CREATURES.length + ' COLLECTED');

    // Everything below is an "extra". While the tutorial is running they all
    // stand down, so a new player is never reading four things at once.
    const quiet = s.tutorial.quiet();

    // event countdown
    const ev = quiet ? null : s.eventMgr.activeName();
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
      this.lockBtn.setText(this._kb ? '🔒 LOCK [L]' : '🔒 LOCK');
      this.lockBtn.setBackgroundColor('#b71c1c');
      this.lockBtn.setColor('#ffffff');
    }

    // frenzy button: only offered when an ad could actually play
    const canFrenzy = !quiet && Poki.ready &&
      time >= s.economy.frenzyReadyAt && time >= s.economy.frenzyUntil;
    this.frenzyBtn.setVisible(!!canFrenzy);
    this.collBtn.setVisible(!quiet);
    this.helpBtn.setVisible(!quiet);

    // Upgrade panel opens when near the station. The tutorial keeps it shut
    // until the step that exists to open it -- see blocksUpgradePanel().
    const nearStation = !s.tutorial.blocksUpgradePanel() && Phaser.Math.Distance.Between(
      s.player.x, s.player.y, CFG.UPGRADE_STATION.x, CFG.UPGRADE_STATION.y) < 92;
    if (nearStation && !this._upgradeOpen) {
      this._upgradeOpen = true;
      this.upgPanel.setVisible(true);
      this._refreshUpgradePanel();
      AudioSys.sfx('tick');
    } else if (!nearStation && this._upgradeOpen) {
      this._upgradeOpen = false;
      this.upgPanel.setVisible(false);
    } else if (this._upgradeOpen && (time % 500) < 20) {
      this._refreshUpgradePanel();
    }

    this._updateStationBeacon(time);
  }

  upgradeOpen() { return this._upgradeOpen; }

  // ---------- station beacon ----------
  // The upgrade truck is a prop in the corner of a busy map, and a player who
  // has never opened it has no reason to walk over. So the moment they can
  // actually afford something, the truck says so in world space -- the nudge
  // only ever appears when acting on it would work.
  _buildStationBeacon() {
    const st = CFG.UPGRADE_STATION;
    this.stationBeacon = this.scene.add.text(st.x, st.y - 104, 'CAN AFFORD AN UPGRADE\n▼', {
      fontFamily: 'Arial Black, Arial', fontSize: '14px', color: '#b9f6ca',
      align: 'center', lineSpacing: 2, stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(872).setVisible(false);
  }

  cheapestUpgradeCost() {
    let best = Infinity;
    CFG.UPGRADES.forEach((u) => {
      if ((this.scene.upgrades[u.id] || 0) < u.max) best = Math.min(best, this.upgradeCost(u));
    });
    if (!this.scene.bases.isLocked('player')) best = Math.min(best, this.lockBuyCost());
    return best;
  }

  _updateStationBeacon(time) {
    const s = this.scene;
    const show = !s.tutorial.blocksUpgradePanel() && !this._upgradeOpen &&
      s.economy.canAfford('player', this.cheapestUpgradeCost());
    this.stationBeacon.setVisible(show);
    if (!show) return;
    this.stationBeacon.y = CFG.UPGRADE_STATION.y - 104 + Math.sin(time / 220) * 6;
  }
}
window.HUD = HUD;
