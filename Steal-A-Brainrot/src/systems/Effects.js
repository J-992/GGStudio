// Juice central: floating numbers, coin bursts, sparks, confetti, camera
// shake, hit-stop/slow-mo and the big center-screen announcement banners.
// Everything is short tweened sprites -- no particle emitters to manage.
class Effects {
  constructor(scene) {
    this.scene = scene;
    this._bannerBusy = false;
    this._bannerQueue = [];
    this._hitUntil = 0;
    this._slowUntil = 0;
    this._slowScale = 1;
  }

  // ---- combat time control -------------------------------------------
  // GameScene multiplies the combat dt by timeScale() every frame. Wall-clock
  // timestamps, so a stretched scene clock can never strand the game slow
  // (the merge-ninja hit-stop lesson).
  hitStop(ms) { this._hitUntil = Math.max(this._hitUntil, Date.now() + ms); }
  slowMo(scale, ms) { this._slowScale = scale; this._slowUntil = Date.now() + ms; }
  timeScale() {
    const now = Date.now();
    if (now < this._hitUntil) return 0;
    if (now < this._slowUntil) return this._slowScale;
    return 1;
  }

  floatText(x, y, str, color, size) {
    const t = this.scene.add.text(x, y, str, {
      fontFamily: 'Arial Black, Arial', fontSize: (size || 18) + 'px',
      color: color || '#ffffff', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(900);
    this.scene.tweens.add({
      targets: t, y: y - 46, alpha: { from: 1, to: 0 }, duration: 900,
      ease: 'Cubic.easeOut', onComplete: () => t.destroy(),
    });
  }

  coinBurst(x, y, n) {
    for (let i = 0; i < n; i++) {
      const c = this.scene.add.image(x, y, 'coin').setDepth(890);
      const a = Math.random() * Math.PI * 2, d = 24 + Math.random() * 46;
      this.scene.tweens.add({
        targets: c, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d - 24,
        alpha: { from: 1, to: 0 }, scale: { from: 1, to: 0.5 },
        duration: 500 + Math.random() * 300, ease: 'Cubic.easeOut',
        onComplete: () => c.destroy(),
      });
    }
  }

  // one coin arcs from the world to the HUD coin counter
  coinFly(x, y, tx, ty, onArrive) {
    const c = this.scene.add.image(x, y, 'coin').setDepth(950);
    this.scene.tweens.add({
      targets: c, x: tx, y: ty, duration: 550, ease: 'Quad.easeIn',
      onComplete: () => { c.destroy(); if (onArrive) onArrive(); },
    });
  }

  sparks(x, y, color, n) {
    for (let i = 0; i < (n || 8); i++) {
      const s = this.scene.add.image(x, y, 'spark').setDepth(890)
        .setTint(color || 0xffffff).setScale(0.5 + Math.random() * 0.7);
      const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 60;
      this.scene.tweens.add({
        targets: s, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
        alpha: { from: 1, to: 0 }, angle: Math.random() * 360,
        duration: 400 + Math.random() * 300, onComplete: () => s.destroy(),
      });
    }
  }

  // gold stars flying out of a merge
  starBurst(x, y, n) {
    for (let i = 0; i < (n || 8); i++) {
      const s = this.scene.add.image(x, y, 'star').setDepth(905)
        .setTint(0xffd54f).setScale(0.4 + Math.random() * 0.6);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, d = 40 + Math.random() * 80;
      this.scene.tweens.add({
        targets: s, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d + 20,
        alpha: { from: 1, to: 0 }, angle: Math.random() * 360 - 180,
        duration: 550 + Math.random() * 350, ease: 'Quad.easeOut',
        onComplete: () => s.destroy(),
      });
    }
  }

  confetti(x, y, n) {
    const colors = [0xef5350, 0xffca28, 0x66bb6a, 0x42a5f5, 0xab47bc, 0x26c6da];
    for (let i = 0; i < (n || 26); i++) {
      const p = this.scene.add.rectangle(x, y, 8, 8, colors[i % colors.length]).setDepth(895);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = 90 + Math.random() * 170;
      this.scene.tweens.add({
        targets: p,
        x: x + Math.cos(a) * sp, y: y + Math.sin(a) * sp + 130,
        angle: Math.random() * 720 - 360, alpha: { from: 1, to: 0 },
        duration: 900 + Math.random() * 500, ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  ringPulse(x, y, color, scale) {
    const r = this.scene.add.image(x, y, 'ring').setDepth(880).setTint(color || 0xffffff);
    this.scene.tweens.add({
      targets: r, scale: { from: 0.3, to: scale || 1.6 }, alpha: { from: 0.9, to: 0 },
      duration: 450, onComplete: () => r.destroy(),
    });
  }

  shake(intensity, dur) {
    this.scene.cameras.main.shake(dur || 180, intensity || 0.006);
  }

  flash(color) {
    const c = Phaser.Display.Color.IntegerToColor(color === undefined ? 0xffffff : color);
    this.scene.cameras.main.flash(220, c.red, c.green, c.blue);
  }

  // Squash & stretch a sprite briefly.
  //
  // The resting scale is remembered on the target rather than read at the
  // moment of the call, so rapid repeat squashes cannot compound the scale
  // (that is what once made the cash counter grow without end).
  squash(target, amount) {
    const a = amount || 0.22;
    const live = target._sqTween;
    if (live) {
      this.scene.tweens.remove(live);
    } else {
      target._sqX = target.scaleX;
      target._sqY = target.scaleY;
    }
    const sx = target._sqX, sy = target._sqY;
    target.setScale(sx, sy);
    target._sqTween = this.scene.tweens.add({
      targets: target, scaleX: sx * (1 + a), scaleY: sy * (1 - a),
      duration: 90, yoyo: true, ease: 'Quad.easeOut',
      onComplete: () => { target.setScale(sx, sy); target._sqTween = null; },
    });
  }

  // big center-screen announcement; queued so banners never overlap
  banner(str, colorStr, subStr) {
    this._bannerQueue.push({ str, colorStr, subStr });
    this._pumpBanner();
  }

  _pumpBanner() {
    if (this._bannerBusy || this._bannerQueue.length === 0) return;
    this._bannerBusy = true;
    const { str, colorStr, subStr } = this._bannerQueue.shift();
    const cx = LAYOUT.width / 2, cy = LAYOUT.height * 0.3;
    const t = this.scene.add.text(cx, cy, str, {
      fontFamily: 'Arial Black, Arial', fontSize: LAYOUT.landscape ? '52px' : '42px',
      color: colorStr || '#ffffff', stroke: '#000000', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(980).setScale(0.2);
    let sub = null;
    if (subStr) {
      sub = this.scene.add.text(cx, cy + 44, subStr, {
        fontFamily: 'Arial Black, Arial', fontSize: '24px',
        color: '#ffffff', stroke: '#000000', strokeThickness: 5,
      }).setOrigin(0.5).setDepth(980).setAlpha(0);
    }
    this.scene.tweens.add({
      targets: t, scale: 1, duration: 260, ease: 'Back.easeOut',
      onComplete: () => {
        if (sub) this.scene.tweens.add({ targets: sub, alpha: 1, duration: 150 });
        this.scene.tweens.add({
          targets: sub ? [t, sub] : t, alpha: 0, delay: 1250, duration: 300,
          onComplete: () => {
            t.destroy(); if (sub) sub.destroy();
            this._bannerBusy = false;
            this._pumpBanner();
          },
        });
      },
    });
  }
}
window.Effects = Effects;
