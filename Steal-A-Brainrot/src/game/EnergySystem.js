// Brainz tokens: the tappable sun. Cocofanto pops them out next to himself,
// the sky drops a free one on a timer, and anything untapped fades out. The
// tap is the PvZ ritual -- collecting must feel like grabbing money.
class EnergySystem {
  constructor(scene, economy) {
    this.scene = scene;
    this.economy = economy;
    this.tokens = [];
    this._skyT = CFG.ENERGY.skyDropMs * 0.6;   // first freebie comes early
    this.onCollect = null;                     // tutorial hook
  }

  update(dtMs) {
    this._skyT -= dtMs;
    if (this._skyT <= 0) {
      this._skyT = CFG.ENERGY.skyDropMs;
      this.spawnSky();
    }
    const now = this.scene.time.now;
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const t = this.tokens[i];
      if (t.collected) continue;
      const age = now - t.bornAt;
      if (age > CFG.ENERGY.dropLifeMs) {
        t.collected = true;
        this.scene.tweens.add({
          targets: t.root, alpha: 0, scale: 0.3, duration: 300,
          onComplete: () => t.root.destroy(),
        });
        this.tokens.splice(i, 1);
      } else if (age > CFG.ENERGY.dropLifeMs - 2000) {
        t.root.setAlpha(0.35 + 0.65 * Math.abs(Math.sin(age / 130)));  // expiry blink
      }
    }
  }

  // a token from a producer: pops up and lands beside the unit
  spawnFrom(x, y) {
    const t = this._token(x, y - 30);
    const dx = (Math.random() - 0.5) * LAYOUT.field.colW * 1.2;
    this.scene.tweens.add({
      targets: t.root, x: x + dx, y: y + 6, duration: 420, ease: 'Bounce.easeOut',
    });
    return t;
  }

  // the sky freebie: falls onto a random active cell
  spawnSky(lane, col) {
    const f = LAYOUT.field;
    const lanes = this.scene.lawn.activeLanes;
    const L = lane !== undefined ? lane : lanes[Math.floor(Math.random() * lanes.length)];
    const C = col !== undefined ? col : 1 + Math.floor(Math.random() * (CFG.GRID.cols - 3));
    const x = f.colX(C), y = f.laneY(L) - f.laneH * 0.3;
    const t = this._token(x, f.y - 40);
    this.scene.tweens.add({ targets: t.root, y, duration: 1400, ease: 'Sine.easeIn' });
    return t;
  }

  _token(x, y) {
    const root = this.scene.add.container(x, y).setDepth(700);
    const img = this.scene.add.image(0, 0, 'brainz');
    const s = Math.min(1.35, LAYOUT.field.colW / 52);
    root.setScale(s);
    root.add(img);
    this.scene.tweens.add({
      targets: img, scale: { from: 1, to: 1.12 }, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    const t = { root, img, bornAt: this.scene.time.now, value: CFG.ENERGY.dropValue, collected: false };
    this.tokens.push(t);
    return t;
  }

  // returns true if the tap landed on a token (fat 44px finger radius)
  tryCollect(pointer) {
    for (let i = 0; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.collected) continue;
      const dx = pointer.x - t.root.x, dy = pointer.y - t.root.y;
      if (dx * dx + dy * dy <= 44 * 44) {
        this._collect(t, i);
        return true;
      }
    }
    return false;
  }

  _collect(t, i) {
    t.collected = true;
    this.tokens.splice(i, 1);
    const target = this.scene.hud.energyTarget();
    AudioSys.sfx('coin');
    this.scene.tweens.add({
      targets: t.root, x: target.x, y: target.y, scale: 0.4, duration: 320, ease: 'Quad.easeIn',
      onComplete: () => {
        t.root.destroy();
        this.economy.earnEnergy(t.value);
        this.scene.hud.bumpEnergy();
      },
    });
    if (this.onCollect) this.onCollect();
  }

  clear() {
    this.tokens.forEach((t) => t.root.destroy());
    this.tokens = [];
  }
}
window.EnergySystem = EnergySystem;
