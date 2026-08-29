// Between levels: one screen that is both the shop and the squad picker.
// Every brainrot in the game is on the wall -- unlocked ones toggle in and
// out of the squad (max CFG.TEAM.size), locked ones show their coin price and
// buy on tap. START launches the next level with whatever is selected.
class HQScene extends Phaser.Scene {
  constructor() { super('HQ'); }

  create() {
    this.cameras.main.setBackgroundColor('#14213d');
    this.team = SaveSys.data.team.slice(0, CFG.TEAM.size);
    this.fx = new Effects(this);
    this.info = null;          // last tapped def, for the blurb line
    this.root = this.add.container(0, 0);
    this._build();

    this._onResize = () => this._build();
    this.scale.on('resize', this._onResize);
    this.events.once('shutdown', () => this.scale.off('resize', this._onResize));
  }

  _build() {
    const r = this.root;
    r.removeAll(true);
    const W = LAYOUT.width, H = LAYOUT.height;
    const land = LAYOUT.landscape;

    // ---- header ----
    const title = this.add.text(W / 2, 30, 'LEVEL ' + SaveSys.data.level + ' — PICK YOUR SQUAD', {
      fontFamily: 'Arial Black, Arial', fontSize: land ? '32px' : '26px', color: '#ffd54f',
      stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5);
    r.add(title);

    const coins = this.add.text(W - 14, 30, '\u{1FA99} ' + HUD.money(SaveSys.data.coins), {
      fontFamily: 'Arial Black, Arial', fontSize: '24px', color: '#ffe082',
      stroke: '#000000', strokeThickness: 5,
    }).setOrigin(1, 0.5);
    this.coinsText = coins;
    r.add(coins);

    // ---- squad tray ----
    const trayY = 92;
    const slotW = Math.min(96, (W - 40) / CFG.TEAM.size - 8);
    const trayW = CFG.TEAM.size * (slotW + 8);
    const tray = this.add.graphics();
    r.add(tray);
    this.traySlots = [];
    for (let i = 0; i < CFG.TEAM.size; i++) {
      const x = W / 2 - trayW / 2 + i * (slotW + 8) + slotW / 2;
      tray.fillStyle(0x1c2b47, 1);
      tray.fillRoundedRect(x - slotW / 2, trayY - slotW / 2, slotW, slotW, 10);
      tray.lineStyle(2, 0x3a4f7a, 1);
      tray.strokeRoundedRect(x - slotW / 2, trayY - slotW / 2, slotW, slotW, 10);
      const id = this.team[i];
      if (id) {
        const img = this.add.image(x, trayY + slotW * 0.32, 'cr_' + id).setOrigin(0.5, 1);
        img.setScale((slotW * 0.72) / img.height);
        r.add(img);
      }
    }

    // ---- roster grid ----
    const cols = land ? 7 : 4;
    const gridTop = trayY + slotW / 2 + 18;
    const gridBottom = H - 150;
    const cellW = Math.min(land ? 170 : 165, (W - 24) / cols);
    const cellH = Math.min(150, Math.max(112, (gridBottom - gridTop) / Math.ceil(CREATURES.length / cols)));
    const gridW = cols * cellW;
    const sorted = [...CREATURES].sort((a, b) =>
      (RARITIES[a.rarity].tier - RARITIES[b.rarity].tier) || (a.price - b.price));

    sorted.forEach((def, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = W / 2 - gridW / 2 + col * cellW + cellW / 2;
      const y = gridTop + row * cellH + cellH / 2;
      this._rosterCard(def, x, y, cellW - 8, cellH - 8);
    });

    // ---- info line ----
    this.infoText = this.add.text(W / 2, H - 108, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '16px', color: '#b0bec5',
      align: 'center', wordWrap: { width: W - 60 },
    }).setOrigin(0.5);
    r.add(this.infoText);
    this._refreshInfo();

    // ---- start button ----
    const canStart = this.team.length > 0;
    const start = this.add.text(W / 2, H - 52, '▶ START LEVEL ' + SaveSys.data.level, {
      fontFamily: 'Arial Black, Arial', fontSize: land ? '34px' : '28px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 7,
      backgroundColor: canStart ? '#43a047' : '#455a64', padding: { x: 30, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    start.on('pointerdown', () => this._start());
    if (canStart) {
      this.tweens.add({ targets: start, scale: { from: 1, to: 1.04 }, duration: 600, yoyo: true, repeat: -1 });
    }
    r.add(start);
  }

  _rosterCard(def, x, y, w, h) {
    const unlocked = SaveSys.data.unlocked.includes(def.id);
    const inTeam = this.team.includes(def.id);
    const rc = RARITIES[def.rarity];

    const g = this.add.graphics();
    g.fillStyle(inTeam ? 0x24503a : 0x1c2b47, 1);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 10);
    g.lineStyle(3, inTeam ? 0x69f0ae : rc.color, unlocked ? 1 : 0.45);
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 10);
    this.root.add(g);

    const img = this.add.image(x, y + h * 0.16, 'cr_' + def.id).setOrigin(0.5, 1);
    img.setScale((h * 0.52) / img.height);
    if (!unlocked) img.setTintFill(0x111a2e);
    this.root.add(img);

    const name = this.add.text(x, y + h * 0.24, unlocked ? def.name.split(' ')[0].toUpperCase() : '???', {
      fontFamily: 'Arial Black, Arial', fontSize: '12px', color: unlocked ? '#ffffff' : '#5c6b8a',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5);
    this.root.add(name);

    // bottom chip: brainz cost (unlocked) or coin price + BUY (locked)
    const chip = this.add.text(x, y + h / 2 - 12,
      unlocked ? '\u{1F9E0} ' + def.cost : (SaveSys.data.coins >= def.price ? 'BUY ' : '') + HUD.money(def.price), {
        fontFamily: 'Arial Black, Arial', fontSize: '13px',
        color: unlocked ? '#f8bbd0' : (SaveSys.data.coins >= def.price ? '#69f0ae' : '#ef9a9a'),
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5);
    this.root.add(chip);

    if (inTeam) {
      const badge = this.add.text(x + w / 2 - 12, y - h / 2 + 12, '✓', {
        fontFamily: 'Arial Black, Arial', fontSize: '18px', color: '#69f0ae',
        stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5);
      this.root.add(badge);
    }

    const zone = this.add.zone(x - w / 2, y - h / 2, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => this._tapCard(def, unlocked, img));
    this.root.add(zone);
  }

  _tapCard(def, unlocked, img) {
    AudioSys.ensure();
    this.info = def;

    if (!unlocked) {
      if (SaveSys.data.coins >= def.price) {
        SaveSys.data.coins -= def.price;
        SaveSys.unlock(def.id);
        SaveSys.addStat('bought');
        if (this.team.length < CFG.TEAM.size) this.team.push(def.id);
        this._saveTeam();
        AudioSys.sfx('victory');
        this.fx.confetti(img.x, img.y - 40, 24);
        this.time.delayedCall(350, () => this._build());
      } else {
        AudioSys.sfx('denied');
        this.tweens.add({ targets: this.coinsText, x: this.coinsText.x - 6, duration: 50, yoyo: true, repeat: 3 });
        this._refreshInfo();
      }
      return;
    }

    // toggle squad membership
    const i = this.team.indexOf(def.id);
    if (i !== -1) {
      this.team.splice(i, 1);
      AudioSys.sfx('sell');
    } else if (this.team.length < CFG.TEAM.size) {
      this.team.push(def.id);
      AudioSys.sfx('place');
    } else {
      AudioSys.sfx('denied');
      this.info = { blurbOverride: 'SQUAD FULL — tap a picked brainrot to drop it first.' };
    }
    this._saveTeam();
    this._build();
  }

  _refreshInfo() {
    if (!this.infoText) return;
    const d = this.info;
    if (!d) {
      const noProducer = !this.team.some((id) => CREATURES_BY_ID[id].role === 'producer');
      this.infoText.setText(noProducer
        ? '⚠ No Cocofanto in the squad -- who will pay for all this?'
        : 'Tap a brainrot to add or drop it. Tap a locked one to buy it.');
      return;
    }
    if (d.blurbOverride) { this.infoText.setText(d.blurbOverride); return; }
    const unlocked = SaveSys.data.unlocked.includes(d.id);
    if (!unlocked) {
      this.infoText.setText(d.name + ' — ' + RARITIES[d.rarity].name + ' — costs ' + HUD.money(d.price) + ' to recruit.');
    } else {
      const stats = d.role === 'producer' ? '+' + d.produceAmount + ' brainz / ' + (d.produceMs / 1000) + 's'
        : d.role === 'wall' ? d.hp + ' HP wall'
        : Math.round(Units.dps(d)) + ' dps';
      this.infoText.setText(d.name + ' — ' + d.special + ' — ' + stats + ' — ' + d.blurb);
    }
  }

  _saveTeam() {
    SaveSys.data.team = this.team.slice();
    SaveSys.save();
  }

  _start() {
    if (this.team.length === 0) { AudioSys.sfx('denied'); return; }
    this._saveTeam();
    AudioSys.sfx('tick');
    this.scene.start('Game', { level: SaveSys.data.level, team: this.team.slice() });
  }
}
window.HQScene = HQScene;
