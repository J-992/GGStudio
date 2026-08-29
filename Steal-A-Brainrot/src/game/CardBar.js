// The seed-packet bar: one card per squad member (sprite + brainz cost +
// recharge sweep) and the shovel. Cards support both gestures: drag a card
// onto a cell, or tap the card then tap the cell. GameScene owns the actual
// placement rules (tryPlace/tryDig); this is presentation + intent.
class CardBar {
  constructor(scene, teamIds, economy) {
    this.scene = scene;
    this.economy = economy;
    this.teamIds = teamIds;
    this.selected = null;              // card index | 'shovel' | null
    this.dragging = false;             // pointer is down and moving a ghost
    this.root = scene.add.container(0, 0).setDepth(900);
    this.ghost = scene.add.image(0, 0, 'cr_trippi').setDepth(950).setAlpha(0.65).setVisible(false);
    this.cards = [];
    this._build();
  }

  _build() {
    const r = this.root;
    const oldCd = this.cards ? this.cards.map((c) => c.cdMs) : [];
    r.removeAll(true);
    this.cards = [];
    const cb = LAYOUT.cards;

    this.teamIds.forEach((id, i) => {
      const def = CREATURES_BY_ID[id];
      const x = cb.slotX(i), y = cb.slotY;
      const bg = this.scene.add.graphics();
      const sprite = this.scene.add.image(x, y - 6, 'cr_' + id).setOrigin(0.5, 0.62);
      sprite.setScale((cb.cardH * 0.52) / sprite.height);
      const costText = this.scene.add.text(x + 4, y + cb.cardH / 2 - 12, String(def.cost), {
        fontFamily: 'Arial Black, Arial', fontSize: '15px', color: '#f8bbd0',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5);
      const brain = this.scene.add.image(x - costText.width / 2 - 8, y + cb.cardH / 2 - 12, 'brainz').setScale(0.34);
      const cdOverlay = this.scene.add.rectangle(x, y - cb.cardH / 2, cb.cardW - 4, 0, 0x000000, 0.62).setOrigin(0.5, 0);
      r.add([bg, sprite, brain, costText, cdOverlay]);
      this.cards.push({ def, i, bg, sprite, costText, brain, cdOverlay, cdMs: oldCd[i] || 0 });
    });

    // shovel in the last slot
    const sx = cb.slotX(CFG.TEAM.size), sy = cb.slotY;
    this.shovelBg = this.scene.add.graphics();
    this.shovelImg = this.scene.add.image(sx, sy, 'shovel');
    this.shovelImg.setScale((cb.cardH * 0.55) / this.shovelImg.height);
    r.add([this.shovelBg, this.shovelImg]);

    this._paint();
  }

  _cardRect(i) {
    const cb = LAYOUT.cards;
    return { x: cb.slotX(i) - cb.cardW / 2, y: cb.y + 5, w: cb.cardW, h: cb.cardH };
  }

  _paint() {
    const cb = LAYOUT.cards;
    this.cards.forEach((c, i) => {
      const rect = this._cardRect(i);
      const sel = this.selected === i;
      const affordable = this.economy.canAfford(c.def.cost);
      const ready = c.cdMs <= 0;
      c.bg.clear();
      c.bg.fillStyle(sel ? 0x2f4d73 : 0x1c2b47, 1);
      c.bg.fillRoundedRect(rect.x, rect.y, rect.w, rect.h, 10);
      c.bg.lineStyle(3, sel ? 0xffd54f : RARITIES[c.def.rarity].color, sel ? 1 : 0.85);
      c.bg.strokeRoundedRect(rect.x, rect.y, rect.w, rect.h, 10);
      c.sprite.setTint(affordable && ready ? 0xffffff : 0x666677);
      c.costText.setColor(affordable ? '#f8bbd0' : '#ef9a9a');
    });
    const s = this._cardRect(CFG.TEAM.size);
    const sel = this.selected === 'shovel';
    this.shovelBg.clear();
    this.shovelBg.fillStyle(sel ? 0x6d4c41 : 0x33261f, 1);
    this.shovelBg.fillRoundedRect(s.x, s.y, s.w, s.h, 10);
    this.shovelBg.lineStyle(3, sel ? 0xffd54f : 0x8d6e63, 1);
    this.shovelBg.strokeRoundedRect(s.x, s.y, s.w, s.h, 10);
  }

  // ---------------------------------------------------------------- state

  isReady(i) {
    const c = this.cards[i];
    return c && c.cdMs <= 0 && this.economy.canAfford(c.def.cost);
  }

  startCooldown(i) {
    const c = this.cards[i];
    if (c) c.cdMs = c.def.cooldownMs;
  }

  update(dtMs) {
    const cb = LAYOUT.cards;
    let dirty = false;
    this.cards.forEach((c) => {
      if (c.cdMs > 0) {
        c.cdMs = Math.max(0, c.cdMs - dtMs);
        c.cdOverlay.height = (cb.cardH - 4) * (c.cdMs / c.def.cooldownMs);
        if (c.cdMs === 0) { dirty = true; AudioSys.sfx('tick'); }
      }
      // affordability can change every frame; only repaint on flips
      const ok = this.economy.canAfford(c.def.cost) && c.cdMs <= 0;
      if (ok !== c._wasOk) { c._wasOk = ok; dirty = true; }
    });
    if (dirty) this._paint();
  }

  // ------------------------------------------------------------- gestures

  // pointerdown: true if it landed on a card / the shovel
  handleDown(p) {
    for (let i = 0; i < this.cards.length; i++) {
      const r = this._cardRect(i);
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        if (!this.isReady(i)) {
          AudioSys.sfx('denied');
          this.scene.tweens.add({ targets: this.cards[i].sprite, x: this.cards[i].sprite.x + 5, duration: 45, yoyo: true, repeat: 3 });
          this.clearSelection();
          return true;
        }
        this.selected = i;
        this.dragging = true;
        this._showGhost(this.cards[i].def, p);
        AudioSys.sfx('pickup');
        this._paint();
        return true;
      }
    }
    const s = this._cardRect(CFG.TEAM.size);
    if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) {
      this.selected = this.selected === 'shovel' ? null : 'shovel';
      this.dragging = this.selected === 'shovel';
      this.ghost.setVisible(false);
      AudioSys.sfx('pickup');
      this._paint();
      return true;
    }
    return false;
  }

  moveDrag(p) {
    if (this.selected === null) return;
    const f = LAYOUT.field;
    const lane = f.laneAt(p.y), col = f.colAt(p.x);
    const onField = p.y >= f.y && p.y <= f.y + f.h && col >= 0 && col < CFG.GRID.cols;

    if (this.selected === 'shovel') {
      if (this.dragging) {
        this.shovelImg.setPosition(p.x, p.y - 10);
        if (onField && this.scene.lawn.unitAt(lane, col)) this.scene.lawn.showHighlight(lane, col, true);
        else this.scene.lawn.hideHighlight();
      }
      return;
    }
    if (this.dragging) this.ghost.setVisible(true).setPosition(p.x, p.y + LAYOUT.unitH * 0.3);
    if (onField) this.scene.lawn.showHighlight(lane, col, this.scene.lawn.canPlace(lane, col));
    else this.scene.lawn.hideHighlight();
  }

  // pointerup: returns {kind, lane, col} intent or null
  handleUp(p) {
    if (this.selected === null) return null;
    const f = LAYOUT.field;
    const lane = f.laneAt(p.y), col = f.colAt(p.x);
    const onField = p.y >= f.y && p.y <= f.y + f.h && col >= 0 && col < CFG.GRID.cols;
    const wasDragging = this.dragging;
    this.dragging = false;
    this.ghost.setVisible(false);
    this.scene.lawn.hideHighlight();
    this._resetShovel();

    if (onField) {
      const intent = { kind: this.selected === 'shovel' ? 'dig' : 'place', card: this.selected, lane, col };
      if (this.selected !== 'shovel') this.clearSelection();
      return intent;
    }
    // released on the card itself -> sticky tap-tap mode stays armed
    if (wasDragging) {
      const idx = this.selected;
      if (idx !== 'shovel') {
        const r = this._cardRect(idx);
        if (!(p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)) this.clearSelection();
      }
    }
    return null;
  }

  // a tap on the field while a card is sticky-selected
  fieldTap(p) {
    if (this.selected === null) return null;
    const f = LAYOUT.field;
    const lane = f.laneAt(p.y), col = f.colAt(p.x);
    if (p.y < f.y || p.y > f.y + f.h || col < 0 || col >= CFG.GRID.cols) {
      this.clearSelection();
      return null;
    }
    const intent = { kind: this.selected === 'shovel' ? 'dig' : 'place', card: this.selected, lane, col };
    if (this.selected !== 'shovel') this.clearSelection();
    return intent;
  }

  clearSelection() {
    this.selected = null;
    this.dragging = false;
    this.ghost.setVisible(false);
    this.scene.lawn.hideHighlight();
    this._resetShovel();
    this._paint();
  }

  _resetShovel() {
    const cb = LAYOUT.cards;
    this.shovelImg.setPosition(cb.slotX(CFG.TEAM.size), cb.slotY);
  }

  _showGhost(def, p) {
    this.ghost.setTexture('cr_' + def.id);
    this.ghost.setScale(LAYOUT.unitH / this.ghost.height).setOrigin(0.5, 1);
    this.ghost.setVisible(true).setPosition(p.x, p.y + LAYOUT.unitH * 0.3);
  }

  cardPos(i) {
    const cb = LAYOUT.cards;
    return { x: cb.slotX(i), y: cb.slotY };
  }

  indexOf(id) { return this.teamIds.indexOf(id); }

  relayout() { this._build(); }
}
window.CardBar = CardBar;
