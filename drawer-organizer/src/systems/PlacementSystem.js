// Builds containers from level data (auto-grid snap slots + silhouette hints),
// resolves drops with forgiving hit detection, and tracks level completion.
class PlacementSystem {
  constructor(scene, levelData) {
    this.scene = scene;
    this.containers = [];
    this.total = 0;
    this.placed = 0;
    levelData.containers.forEach(cfg => this.buildContainer(cfg));
  }

  buildContainer(cfg) {
    const scene = this.scene;
    const { x, y, w, h } = cfg;
    const g = scene.add.graphics().setDepth(5);
    const dark = Phaser.Display.Color.IntegerToColor(cfg.tint).darken(22).color;

    // Base tray: soft drop, body, inner well.
    g.fillStyle(0x5a3c50, 0.10); g.fillRoundedRect(x - w / 2 + 4, y - h / 2 + 8, w, h, 18);
    g.fillStyle(cfg.tint, 1); g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 18);
    g.fillStyle(0xffffff, 0.45); g.fillRoundedRect(x - w / 2 + 10, y - h / 2 + 26, w - 20, h - 36, 12);
    g.lineStyle(3, dark, 0.9); g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 18);

    // Label chip.
    const chipW = Math.min(w - 20, cfg.label.length * 11 + 26);
    g.fillStyle(dark, 0.9); g.fillRoundedRect(x - chipW / 2, y - h / 2 - 12, chipW, 26, 13);
    scene.add.text(x, y - h / 2 + 1, cfg.label, {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setDepth(6);

    // Hover glow (shown while dragging a matching item over the tray).
    const glow = scene.add.graphics().setDepth(6).setAlpha(0);
    glow.lineStyle(5, 0xffffff, 0.9);
    glow.strokeRoundedRect(x - w / 2 + 3, y - h / 2 + 3, w - 6, h - 6, 15);

    // Auto-grid snap slots with faint silhouettes of the accepted items.
    const slots = [];
    const cols = cfg.grid.cols, rows = cfg.grid.rows;
    const innerW = w - 36, innerH = h - 52;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sx = x - innerW / 2 + (innerW / (cols + 1)) * (c + 1) + (cols === 1 ? innerW / 2 - innerW / 2 : 0);
        const sy = y + 8 - innerH / 2 + (innerH / (rows + 1)) * (r + 1);
        const hintKey = cfg.accepts[(r * cols + c) % cfg.accepts.length];
        const hint = scene.add.image(sx, sy, hintKey)
          .setDepth(6).setAlpha(0.16).setTintFill(0x6b4a5e).setScale(0.9);
        slots.push({ x: sx, y: sy, taken: false, hint });
      }
    }

    this.containers.push({ cfg, glow, slots, rect: new Phaser.Geom.Rectangle(x - w / 2, y - h / 2, w, h) });
  }

  registerItems(count) { this.total = count; }

  findTarget(obj) {
    const margin = 34; // forgiving drop zone
    for (const cont of this.containers) {
      const r = Phaser.Geom.Rectangle.Inflate(Phaser.Geom.Rectangle.Clone(cont.rect), margin, margin);
      if (!r.contains(obj.x, obj.y)) continue;
      if (!cont.cfg.accepts.includes(obj.itemCategory)) continue;
      if (!cont.slots.some(s => !s.taken)) continue;
      return cont;
    }
    return null;
  }

  highlight(obj) {
    const target = this.findTarget(obj);
    this.containers.forEach(c => {
      const on = c === target;
      if (c.glow.alpha !== (on ? 1 : 0)) {
        this.scene.tweens.killTweensOf(c.glow);
        this.scene.tweens.add({ targets: c.glow, alpha: on ? 1 : 0, duration: 120 });
      }
    });
  }

  clearHighlight() {
    this.containers.forEach(c => {
      this.scene.tweens.killTweensOf(c.glow);
      this.scene.tweens.add({ targets: c.glow, alpha: 0, duration: 150 });
    });
  }

  tryPlace(obj, pointer) {
    const cont = this.findTarget(obj);
    if (!cont) return this.bounceBack(obj);

    // Nearest free slot to the drop point.
    let slot = null, best = Infinity;
    cont.slots.forEach(s => {
      if (s.taken) return;
      const d = Phaser.Math.Distance.Between(obj.x, obj.y, s.x, s.y);
      if (d < best) { best = d; slot = s; }
    });

    slot.taken = true;
    obj.locked = true;
    obj.disableInteractive();
    obj.setDepth(20 + Math.round(slot.y));
    this.scene.tweens.add({
      targets: obj, x: slot.x, y: slot.y, angle: 0, scale: obj.baseScale,
      duration: 240, ease: 'Back.easeOut',
      onComplete: () => {
        FX.sparkle(this.scene, slot.x, slot.y);
        slot.hint.setAlpha(0);
      }
    });
    AudioSys.play('drop');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    FX.pulse(this.scene, obj);

    this.placed++;
    this.scene.events.emit('level:progress', this.placed, this.total);
    if (this.placed >= this.total) {
      this.scene.time.delayedCall(550, () => this.scene.events.emit('level:complete'));
    }
  }

  bounceBack(obj) {
    AudioSys.play('wrong');
    this.scene.tweens.add({
      targets: obj, x: obj.homeX, y: obj.homeY, angle: obj.homeAngle, scale: obj.baseScale,
      duration: 420, ease: 'Back.easeOut',
      onComplete: () => obj.setDepth(obj.homeDepth)
    });
    // Little apologetic wiggle.
    this.scene.tweens.add({ targets: obj, angle: obj.homeAngle + 8, duration: 70, yoyo: true, repeat: 1, delay: 420 });
  }
}
