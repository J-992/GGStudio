// The board's presentation: zone backgrounds, slot pads, unit sprites, and the
// raw-pointer drag machinery (no Phaser drag plugin -- the scene forwards
// pointer events). Gameplay state lives in BoardModel; sprites are keyed by
// unit uid and re-derived from the model, never the other way round.
class BoardUI {
  constructor(scene, board) {
    this.scene = scene;
    this.board = board;
    this.sprites = new Map();      // uid -> container
    this.pads = [];                // slot index -> pad image
    this.dragged = null;           // { uid, fromSlot }
    this.hover = { kind: 'none', slot: -1 };
    this._lastActionAt = Date.now();
    this._hintTween = null;

    this.static = scene.add.graphics().setDepth(10);
    this._buildPads();
    this.trash = scene.add.image(0, 0, 'trash').setDepth(60).setAlpha(0.85);
    this._drawStatic();
    this.syncFromModel();
  }

  // ------------------------------------------------------------ statics

  _drawStatic() {
    const g = this.static;
    const f = LAYOUT.field, b = LAYOUT.bench;
    g.clear();

    // battlefield turf + alternating lane stripes
    g.fillStyle(0x2f5d3a, 1);
    g.fillRoundedRect(f.x, f.y, f.w, f.h, 14);
    for (let lane = 0; lane < 3; lane++) {
      if (lane % 2 === 1) {
        g.fillStyle(0x000000, 0.07);
        g.fillRect(f.x + 4, f.y + lane * f.laneH + 3, f.w - 8, f.laneH - 6);
      }
    }
    // base line the enemies must not cross
    g.lineStyle(4, 0xffca28, 0.75);
    g.lineBetween(f.baseX + 8, f.y + 6, f.baseX + 8, f.y + f.h - 6);
    g.fillStyle(0xffca28, 0.25);
    g.fillRect(f.x, f.y, f.baseX + 8 - f.x, f.h);

    // bench panel
    g.fillStyle(0x1c2a4a, 1);
    g.fillRoundedRect(b.x, b.y, b.w, b.h, 14);
    g.lineStyle(3, 0x3a4f7a, 1);
    g.strokeRoundedRect(b.x, b.y, b.w, b.h, 14);

    this.trash.setPosition(LAYOUT.trash.x, LAYOUT.trash.y);
    const tScale = (LAYOUT.trash.r * 1.5) / 68;
    this.trash.setScale(tScale);
    this.trash._sqX = tScale; this.trash._sqY = tScale;
  }

  _buildPads() {
    for (let i = 0; i < BoardModel.SIZE; i++) {
      const pad = this.scene.add.image(0, 0, 'slotPad').setDepth(20);
      this.pads.push(pad);
    }
    this._layoutPads();
  }

  _layoutPads() {
    for (let i = 0; i < BoardModel.SIZE; i++) {
      const pad = this.pads[i];
      const p = LAYOUT.slotPos(i);
      const size = this._padSize(i);
      pad.setPosition(p.x, p.y + (i < BoardModel.FIELD ? this._unitH(i) * 0.12 : 0));
      pad.setScale(size / 96);
      pad.setTint(i < BoardModel.FIELD ? 0x9ccc65 : 0x90caf9);
      pad.setAlpha(0.85);
    }
  }

  _padSize(slot) {
    if (slot < BoardModel.FIELD) return Math.min(LAYOUT.field.colW, LAYOUT.field.laneH) * 0.8;
    return LAYOUT.bench.cell * 0.88;
  }

  _unitH(slot) { return slot < BoardModel.FIELD ? LAYOUT.unitH : LAYOUT.benchUnitH; }

  // ------------------------------------------------------------ sprites

  unitSprite(uid) { return this.sprites.get(uid) || null; }

  syncFromModel() {
    const seen = new Set();
    this.board.slots.forEach((u, slot) => {
      if (!u) return;
      seen.add(u.uid);
      let c = this.sprites.get(u.uid);
      if (!c) c = this._makeSprite(u);
      this._styleSprite(c, u, slot);
      const p = LAYOUT.slotPos(slot);
      if (!this.dragged || this.dragged.uid !== u.uid) {
        c.setPosition(p.x, p.y).setScale(1).setAngle(0).setAlpha(1);
      }
    });
    for (const [uid, c] of [...this.sprites]) {
      if (!seen.has(uid)) { c.destroy(); this.sprites.delete(uid); }
    }
  }

  _makeSprite(u) {
    const c = this.scene.add.container(0, 0);
    c.shadow = this.scene.add.image(0, 8, 'shadow');
    c.aura = this.scene.add.image(0, 0, 'ring').setAlpha(0);
    c.img = this.scene.add.image(0, 10, 'cr_' + u.id).setOrigin(0.5, 1);
    c.stars = this.scene.add.container(0, 0);
    c.add([c.shadow, c.aura, c.img, c.stars]);
    c.uid = u.uid;
    this.sprites.set(u.uid, c);
    return c;
  }

  _styleSprite(c, u, slot) {
    const def = CREATURES_BY_ID[u.id];
    const H = this._unitH(slot) * (1 + (u.star - 1) * 0.12);
    const k = TextureFactory.scaleFor(this.scene, 'cr_' + u.id, H);
    c.img.setTexture('cr_' + u.id).setScale(k);
    c.img.y = 10;
    c.shadow.setScale(H / 52).setY(10);
    c.homeSlot = slot;
    c.unitRef = u;
    c.grabH = H;
    c.setDepth(slot < BoardModel.FIELD ? 200 + this.board.laneOf(slot) * 10 : 700);

    // star pips under the feet
    c.stars.removeAll(true);
    const pip = 13;
    for (let s = 0; s < u.star; s++) {
      const st = this.scene.add.image((s - (u.star - 1) / 2) * pip, 22, 'star')
        .setScale(0.42).setTint(u.star >= CFG.STAR.max ? 0xff1744 : 0xffca28);
      c.stars.add(st);
    }

    // aura by star: none / rarity ring / gold / rainbow (hue-cycled in update)
    if (u.star >= 2) {
      const color = u.star >= 4 ? 0xffd54f : RARITIES[def.rarity].color;
      c.aura.setAlpha(0.4 + u.star * 0.08).setTint(color)
        .setScale(H / 46).setY(-H * 0.42);
      c.auraCycle = u.star >= 5;
    } else {
      c.aura.setAlpha(0);
      c.auraCycle = false;
    }
  }

  // pop-in for a freshly pulled / spawned unit
  spawnAnim(u) {
    this.syncFromModel();
    const c = this.sprites.get(u.uid);
    if (!c) return;
    const p = LAYOUT.slotPos(u.slot);
    c.setPosition(p.x, p.y).setScale(0.2).setAlpha(0.4);
    this.scene.tweens.add({
      targets: c, scale: 1, alpha: 1, duration: 300, ease: 'Back.easeOut',
    });
    this.scene.fx.ringPulse(p.x, p.y, RARITIES[CREATURES_BY_ID[u.id].rarity].color, 1.3);
  }

  // The 3-beat merge: both fly together + squash (175ms) -> flash -> result
  // pops with Back.easeOut. ~0.6s total, per the design doc.
  animateMerge(fromSlot, toSlot, consumedUids, result) {
    const p = LAYOUT.slotPos(toSlot);
    const movers = consumedUids.map((uid) => this.sprites.get(uid)).filter(Boolean);
    movers.forEach((c) => {
      this.scene.tweens.add({
        targets: c, x: p.x, y: p.y, scaleX: 0.68, scaleY: 1.16,
        angle: (c.x < p.x ? 8 : -8), alpha: 0.25,
        duration: 175, ease: 'Cubic.easeIn',
        onComplete: () => { c.destroy(); this.sprites.delete(c.uid); },
      });
    });

    this.scene.time.delayedCall(135, () => {
      this.scene.fx.sparks(p.x, p.y - 20, 0xffffff, 10);
      this.scene.fx.ringPulse(p.x, p.y - 10, 0xffd54f, 1.6);
    });

    this.scene.time.delayedCall(225, () => {
      this.syncFromModel();
      const c = this.sprites.get(result.uid);
      if (c) {
        c.setPosition(p.x, p.y).setScale(1.36, 0.82).setAlpha(0.3);
        this.scene.tweens.add({ targets: c, scaleX: 1, scaleY: 1, alpha: 1, duration: 330, ease: 'Back.easeOut' });
      }
      const def = CREATURES_BY_ID[result.id];
      this.scene.fx.starBurst(p.x, p.y - 30, 4 + result.star * 2);
      this.scene.fx.floatText(p.x, p.y - this._unitH(toSlot) - 14,
        def.name.split(' ')[0].toUpperCase() + ' ' + '★'.repeat(result.star),
        '#ffd54f', 20);
      AudioSys.sfx('merge');
      if (result.star >= 4) { this.scene.fx.shake(0.006, 200); this.scene.fx.flash(0xfff3c4); }
    });
  }

  sellAnim(uid, price) {
    const c = this.sprites.get(uid);
    const t = LAYOUT.trash;
    if (c) {
      this.scene.tweens.add({
        targets: c, x: t.x, y: t.y, scale: 0.1, alpha: 0.4, duration: 220, ease: 'Quad.easeIn',
        onComplete: () => { c.destroy(); this.sprites.delete(uid); },
      });
    }
    this.scene.fx.squash(this.trash, 0.3);
    this.scene.fx.floatText(t.x, t.y - 40, '+$' + price, '#ffca28', 20);
    AudioSys.sfx('sell');
  }

  // ------------------------------------------------------------ dragging

  beginDrag(pointer) {
    if (this.dragged) return false;
    let best = null, bestD = Infinity;
    for (const c of this.sprites.values()) {
      const H = c.grabH || 80;
      const cx = c.x, cy = c.y - H * 0.4;
      if (Math.abs(pointer.x - cx) > H * 0.55 || Math.abs(pointer.y - cy) > H * 0.62) continue;
      const d = (pointer.x - cx) * (pointer.x - cx) + (pointer.y - cy) * (pointer.y - cy);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) return false;
    const slot = best.homeSlot;
    if (this.board.at(slot) === null || this.board.at(slot).uid !== best.uid) {
      this.syncFromModel();
      return false;
    }
    this.dragged = { uid: best.uid, fromSlot: slot, c: best };
    best.setDepth(950);
    best.setScale(1.14);
    best.setAngle(-6);
    AudioSys.sfx('pickup');
    this._lastActionAt = Date.now();
    this._stopHint();
    return true;
  }

  moveDrag(pointer) {
    if (!this.dragged) return;
    const c = this.dragged.c;
    c.x = pointer.x;
    c.y = pointer.y + (c.grabH || 80) * 0.4;
    this._setHover(this._hoverAt(pointer));
  }

  endDrag(pointer) {
    if (!this.dragged) return;
    const drag = this.dragged;
    this.dragged = null;
    this._setHover({ kind: 'none', slot: -1 });
    drag.c.setAngle(0);

    let target = null;
    if (pointer && this._overTrash(pointer)) {
      target = { kind: 'trash' };
    } else if (pointer) {
      const slot = this._nearestSlot(pointer);
      if (slot !== -1) target = { kind: 'slot', slot };
    }

    const result = target ? this.scene.drop(drag.fromSlot, target) : 'rejected';
    this._lastActionAt = Date.now();

    if (result === 'rejected' || result === null) {
      // spring home
      const p = LAYOUT.slotPos(drag.fromSlot);
      this.scene.tweens.add({
        targets: drag.c, x: p.x, y: p.y, scale: 1, duration: 260, ease: 'Back.easeOut',
      });
      drag.c.setDepth(drag.fromSlot < BoardModel.FIELD ? 200 : 700);
      if (target) { AudioSys.sfx('denied'); this.scene.tweens.add({ targets: drag.c, angle: { from: -5, to: 0 }, duration: 180 }); }
    } else if (result === 'moved' || result === 'swapped') {
      this.syncFromModel();
      AudioSys.sfx(result === 'swapped' ? 'swap' : 'place');
    }
    // 'merged' and 'sold' animations are driven by the scene
  }

  cancelDrag() {
    if (!this.dragged) return;
    const drag = this.dragged;
    this.dragged = null;
    this._setHover({ kind: 'none', slot: -1 });
    drag.c.setAngle(0).setScale(1);
    this.syncFromModel();
  }

  _overTrash(pointer) {
    const t = LAYOUT.trash;
    const d = Math.sqrt((pointer.x - t.x) * (pointer.x - t.x) + (pointer.y - t.y) * (pointer.y - t.y));
    return d <= t.r * 1.35;
  }

  _nearestSlot(pointer) {
    // vertical bias: releasing over the character or over its pad mean the
    // same thing, because the art stands above the slot centre
    const px = pointer.x, py = pointer.y + LAYOUT.benchUnitH * 0.3;
    let nearest = -1, best = Infinity;
    for (let i = 0; i < BoardModel.SIZE; i++) {
      const p = LAYOUT.slotPos(i);
      const rad = this._padSize(i) * 0.72;
      const d = Math.sqrt((px - p.x) * (px - p.x) + (py - p.y) * (py - p.y));
      if (d <= rad && d < best) { best = d; nearest = i; }
    }
    return nearest;
  }

  // Merge = gold pulse, swap = cool blue, move = brighter pad, trash = red.
  // (merge-ninja shipped with the merge branch unreachable -- equal tiers fell
  // through to swap. Fixed here: equal id + star + below max reads as merge.)
  _hoverAt(pointer) {
    if (!this.dragged) return { kind: 'none', slot: -1 };
    if (this._overTrash(pointer)) return { kind: 'trash', slot: -1 };
    const slot = this._nearestSlot(pointer);
    if (slot === -1 || slot === this.dragged.fromSlot) return { kind: 'none', slot: -1 };
    const dragUnit = this.board.at(this.dragged.fromSlot);
    const other = this.board.at(slot);
    if (!other) return { kind: 'move', slot };
    if (dragUnit && other.id === dragUnit.id && other.star === dragUnit.star && other.star < CFG.STAR.max) {
      return { kind: 'merge', slot };
    }
    return { kind: 'swap', slot };
  }

  _setHover(h) {
    if (h.kind === this.hover.kind && h.slot === this.hover.slot) return;
    // clear previous
    if (this.hover.slot >= 0) {
      const pad = this.pads[this.hover.slot];
      pad.setTint(this.hover.slot < BoardModel.FIELD ? 0x9ccc65 : 0x90caf9).setAlpha(0.85);
      pad.setScale(this._padSize(this.hover.slot) / 96);
      const occ = this.board.at(this.hover.slot);
      if (occ) {
        const c = this.sprites.get(occ.uid);
        if (c && (!this.dragged || c.uid !== this.dragged.uid)) c.setAngle(0);
      }
    }
    this.trash.clearTint();
    this.hover = h;
    if (h.kind === 'trash') {
      this.trash.setTint(0xff8a80);
    } else if (h.slot >= 0) {
      const pad = this.pads[h.slot];
      if (h.kind === 'merge') {
        pad.setTint(0xffd54f).setAlpha(1);
        pad.setScale((this._padSize(h.slot) / 96) * 1.12);
        const occ = this.board.at(h.slot);
        if (occ) {
          const c = this.sprites.get(occ.uid);
          if (c) this.scene.fx.squash(c, 0.16);
        }
      } else if (h.kind === 'swap') {
        pad.setTint(0xbfe0ff).setAlpha(1);
        const occ = this.board.at(h.slot);
        if (occ) {
          const c = this.sprites.get(occ.uid);
          if (c) c.setAngle(7);
        }
      } else if (h.kind === 'move') {
        pad.setAlpha(1);
        pad.setScale((this._padSize(h.slot) / 96) * 1.06);
      }
    }
  }

  // ------------------------------------------------------------ per-frame

  update(time) {
    // rainbow aura on 5-star units
    for (const c of this.sprites.values()) {
      if (c.auraCycle) {
        const hue = (time / 12) % 360;
        const col = Phaser.Display.Color.HSLToColor(hue / 360, 0.9, 0.6).color;
        c.aura.setTint(col);
      }
    }
    // idle merge hint: pulse a mergeable pair when nothing has happened for 6s
    if (!this.dragged && Date.now() - this._lastActionAt > 6000 && !this._hintTween) {
      const pair = this.board.mergePair();
      if (pair) {
        const targets = pair.map((s) => {
          const u = this.board.at(s);
          return u ? this.sprites.get(u.uid) : null;
        }).filter(Boolean);
        if (targets.length === 2) {
          this._hintTween = this.scene.tweens.add({
            targets, scale: { from: 1, to: 1.09 }, duration: 380,
            yoyo: true, repeat: 5,
            onComplete: () => { this._hintTween = null; this._lastActionAt = Date.now(); },
          });
        }
      }
    }
  }

  _stopHint() {
    if (this._hintTween) {
      this._hintTween.stop();
      this._hintTween = null;
      for (const c of this.sprites.values()) if (!this.dragged || c.uid !== this.dragged.uid) c.setScale(1);
    }
  }

  relayout() {
    if (this.dragged) this.cancelDrag();
    this._drawStatic();
    this._layoutPads();
    this.syncFromModel();
  }
}
window.BoardUI = BoardUI;
