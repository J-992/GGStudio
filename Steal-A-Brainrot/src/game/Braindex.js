// The collection book. Undiscovered entries are the real art tinted black
// behind ???, so the silhouette always matches the eventual reveal.
class Braindex {
  constructor(scene) {
    this.scene = scene;
    this.open = false;
    this.root = scene.add.container(0, 0).setDepth(1200).setVisible(false);
  }

  toggle() { this.open ? this.hide() : this.show(); }

  show() {
    this.open = true;
    this._build();
    this.root.setVisible(true).setAlpha(0);
    this.scene.tweens.add({ targets: this.root, alpha: 1, duration: 160 });
    this.scene.modalOpen = true;
    AudioSys.sfx('tick');
  }

  hide() {
    this.open = false;
    this.root.setVisible(false);
    this.scene.modalOpen = false;
  }

  _build() {
    const r = this.root;
    r.removeAll(true);
    const W = LAYOUT.width, H = LAYOUT.height;

    const dim = this.scene.add.rectangle(W / 2, H / 2, W, H, 0x060a14, 0.94)
      .setInteractive();   // swallow taps behind the panel
    r.add(dim);

    const found = SaveSys.data.discovered.length;
    const title = this.scene.add.text(W / 2, 46, 'BRAINDEX', {
      fontFamily: 'Arial Black, Arial', fontSize: '40px', color: '#ffd54f',
      stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5);
    const sub = this.scene.add.text(W / 2, 86, found + ' / ' + CREATURES.length + ' FOUND', {
      fontFamily: 'Arial Black, Arial', fontSize: '18px', color: '#b0bec5',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5);
    r.add([title, sub]);

    const cols = LAYOUT.landscape ? 7 : 4;
    const rows = Math.ceil(CREATURES.length / cols);
    const cellW = Math.min((W - 40) / cols, 170);
    const cellH = Math.min((H - 160) / rows, 170);
    const x0 = W / 2 - (cols * cellW) / 2 + cellW / 2;
    const y0 = 120 + cellH / 2;

    CREATURES.forEach((def, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const cx = x0 + col * cellW, cy = y0 + row * cellH;
      const isFound = SaveSys.data.discovered.indexOf(def.id) !== -1;
      const rc = RARITIES[def.rarity];

      const cellBg = this.scene.add.rectangle(cx, cy, cellW - 8, cellH - 8, 0x131c31)
        .setStrokeStyle(2, isFound ? rc.color : 0x2a3550);
      r.add(cellBg);

      const artH = cellH * 0.52;
      const img = this.scene.add.image(cx, cy + artH * 0.28, 'cr_' + def.id).setOrigin(0.5, 1);
      img.setScale(TextureFactory.scaleFor(this.scene, 'cr_' + def.id, artH));
      if (!isFound) img.setTintFill(0x111122);
      r.add(img);

      if (isFound) {
        const name = this.scene.add.text(cx, cy + cellH * 0.24, def.name.toUpperCase(), {
          fontFamily: 'Arial Black, Arial', fontSize: '11px', color: '#eceff1',
          align: 'center', wordWrap: { width: cellW - 14 },
        }).setOrigin(0.5, 0);
        r.add(name);
        const best = SaveSys.data.bestStars[def.id] || 1;
        const stars = this.scene.add.text(cx, cy - cellH * 0.36,
          '★'.repeat(best), {
            fontSize: '13px', color: best >= CFG.STAR.max ? '#ff1744' : '#ffd54f',
          }).setOrigin(0.5);
        r.add(stars);
      } else {
        const q = this.scene.add.text(cx, cy + cellH * 0.24, '???', {
          fontFamily: 'Arial Black, Arial', fontSize: '14px', color: '#546e7a',
        }).setOrigin(0.5, 0);
        r.add(q);
      }
    });

    const close = this.scene.add.text(W - 30, 40, '✕', {
      fontFamily: 'Arial Black, Arial', fontSize: '34px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 5, padding: { x: 10, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => this.hide());
    r.add(close);
    dim.on('pointerdown', () => this.hide());
  }

  relayout() { if (this.open) this._build(); }
}
window.Braindex = Braindex;
