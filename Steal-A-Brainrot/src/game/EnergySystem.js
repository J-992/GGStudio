// Doge coins: the tappable sun. Cocofanto trumpets them out next to himself,
// the sky drops a free one on a timer, and anything untapped fades out. The
// tap is the PvZ ritual -- collecting must feel like grabbing money, which is
// most of why the token is a coin now and not an abstract blob.
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
      if (t.collected || t.noExpire) continue;
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

  // a coin from a producer: pops up and lands beside the unit
  spawnFrom(x, y) {
    const t = this._token(x, y - 30);
    const f = LAYOUT.field;
    const dx = (Math.random() - 0.5) * f.colW * 1.2;
    // A producer in column 0 would otherwise fling coins off the left edge,
    // where they cannot be tapped -- and column 0 is exactly where the
    // tutorial teaches you to put one.
    t.restX = Math.min(Math.max(x + dx, f.gridX + f.colW * 0.4), f.right - f.colW * 0.4);
    t.restY = y + 6;
    this.scene.tweens.add({
      targets: t.root, x: t.restX, y: t.restY, duration: 420, ease: 'Bounce.easeOut',
    });
    return t;
  }

  // the sky freebie: drops onto a random active cell.
  // `opts.noExpire` keeps the coin on the lawn forever -- the tutorial needs a
  // coin that is still there when the player finally reaches for it.
  spawnSky(lane, col, opts) {
    const f = LAYOUT.field;
    const lanes = this.scene.lawn.activeLanes;
    const L = lane !== undefined ? lane : lanes[Math.floor(Math.random() * lanes.length)];
    const C = col !== undefined ? col : 1 + Math.floor(Math.random() * (CFG.GRID.cols - 3));
    const x = f.colX(C), y = f.laneY(L) - f.laneH * 0.3;
    const t = this._token(x, f.y - 40);
    t.restX = x; t.restY = y;
    if (opts && opts.noExpire) t.noExpire = true;
    this.scene.tweens.add({ targets: t.root, y, duration: 1400, ease: 'Sine.easeIn' });
    return t;
  }

  _token(x, y) {
    const root = this.scene.add.container(x, y).setDepth(700);
    const img = this.scene.add.image(0, 0, 'dogecoin');
    img.setScale(TextureFactory.scaleFor(this.scene, 'dogecoin', CFG.ART.coinH));
    const s = Math.min(1.35, LAYOUT.field.colW / 52);
    root.setScale(s);
    root.add(img);
    const base = img.scale;
    this.scene.tweens.add({
      targets: img, scale: { from: base, to: base * 1.12 },
      duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    // restX/restY are where the coin comes to a stop. Anything that wants to
    // point at a coin (the tutorial) has to aim there, not at the spawn point
    // it is currently falling from.
    const t = {
      root, img, bornAt: this.scene.time.now, value: CFG.ENERGY.dropValue,
      collected: false, restX: x, restY: y,
    };
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
