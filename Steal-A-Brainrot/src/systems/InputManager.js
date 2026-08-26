// One input surface for desktop and mobile. Exposes a normalized move vector,
// action pressed/held (Space/E or the touch button), and lock (L or HUD
// button). The touch joystick appears wherever the left half is pressed; the
// contextual action button lives bottom-right and relabels itself.
class InputManager {
  constructor(scene) {
    this.scene = scene;
    this.vec = { x: 0, y: 0 };
    this.actionHeld = false;
    this._actionJust = false;
    this._btnJust = false;
    this._btnHeld = false;

    this.cursors = scene.input.keyboard.createCursorKeys();
    this.keys = scene.input.keyboard.addKeys('W,A,S,D,E,L,C,SPACE');

    this.isTouch = scene.sys.game.device.input.touchAvailable;
    this._joy = null;   // { base, knob, pointerId, ox, oy }
    if (this.isTouch) this._makeTouch();
  }

  _makeTouch() {
    const s = this.scene;
    s.input.addPointer(2);

    // joystick: appears under the finger on the left 55% of the screen
    s.input.on('pointerdown', (p) => {
      if (p.x < CFG.W * 0.55 && !this._joy) {
        const base = s.add.image(p.x, p.y, 'joyBase').setDepth(996).setScrollFactor(0);
        const knob = s.add.image(p.x, p.y, 'joyKnob').setDepth(997).setScrollFactor(0);
        this._joy = { base, knob, pointerId: p.id, ox: p.x, oy: p.y };
      }
    });
    s.input.on('pointermove', (p) => {
      if (this._joy && p.id === this._joy.pointerId) {
        const dx = p.x - this._joy.ox, dy = p.y - this._joy.oy;
        const len = Math.hypot(dx, dy), max = 52;
        const cl = Math.min(len, max);
        const nx = len > 4 ? dx / len : 0, ny = len > 4 ? dy / len : 0;
        this._joy.knob.setPosition(this._joy.ox + nx * cl, this._joy.oy + ny * cl);
        this.vec.x = nx * (cl / max);
        this.vec.y = ny * (cl / max);
      }
    });
    const end = (p) => {
      if (this._joy && p.id === this._joy.pointerId) {
        this._joy.base.destroy(); this._joy.knob.destroy();
        this._joy = null;
        this.vec.x = 0; this.vec.y = 0;
      }
    };
    s.input.on('pointerup', end);
    s.input.on('pointerupoutside', end);

    // contextual action button (bottom-right)
    this.btn = s.add.image(CFG.W - 96, CFG.H - 178, 'btnA').setDepth(996)
      .setScrollFactor(0).setInteractive();
    this.btnLabel = s.add.text(CFG.W - 96, CFG.H - 178, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '17px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4, align: 'center',
    }).setOrigin(0.5).setDepth(997).setScrollFactor(0);
    this.btn.on('pointerdown', () => { this._btnJust = true; this._btnHeld = true; this.btn.setAlpha(0.7); });
    const bUp = () => { this._btnHeld = false; this.btn.setAlpha(1); };
    this.btn.on('pointerup', bUp);
    this.btn.on('pointerout', bUp);
  }

  // called by PlayerController each frame with current context label
  setActionLabel(label) {
    if (this.btnLabel) {
      this.btnLabel.setText(label || '');
      this.btn.setAlpha(label ? (this._btnHeld ? 0.7 : 1) : 0.35);
    }
  }

  update() {
    // keyboard vector (overrides joystick when pressed)
    let kx = 0, ky = 0;
    if (this.cursors.left.isDown || this.keys.A.isDown) kx -= 1;
    if (this.cursors.right.isDown || this.keys.D.isDown) kx += 1;
    if (this.cursors.up.isDown || this.keys.W.isDown) ky -= 1;
    if (this.cursors.down.isDown || this.keys.S.isDown) ky += 1;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      this.vec.x = kx / l; this.vec.y = ky / l;
    } else if (!this._joy) {
      this.vec.x = 0; this.vec.y = 0;
    }

    const keyJust = Phaser.Input.Keyboard.JustDown(this.keys.SPACE) ||
                    Phaser.Input.Keyboard.JustDown(this.keys.E);
    this._actionJust = keyJust || this._btnJust;
    this._btnJust = false;
    this.actionHeld = this.keys.SPACE.isDown || this.keys.E.isDown || this._btnHeld;
  }

  get actionJust() { return this._actionJust; }
  get lockJust() { return Phaser.Input.Keyboard.JustDown(this.keys.L); }
  get collectionJust() { return Phaser.Input.Keyboard.JustDown(this.keys.C); }
}
window.InputManager = InputManager;
