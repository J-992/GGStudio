// Keyboard + touch, folded into one { left, right, jump, jumpHeld } record per
// frame. Steering is the whole game -- holding a direction into a corner is how
// you get onto a wall -- so both key sets and the touch pads are merged rather
// than assigned to anything.
class InputManager {
  constructor(scene) {
    this.scene = scene;
    const K = Phaser.Input.Keyboard.KeyCodes;
    const kb = scene.input.keyboard;
    this.k = {
      a: kb.addKey(K.A), d: kb.addKey(K.D),
      w: kb.addKey(K.W), space: kb.addKey(K.SPACE),
      left: kb.addKey(K.LEFT), right: kb.addKey(K.RIGHT), up: kb.addKey(K.UP),
      pause: kb.addKey(K.ESC), retry: kb.addKey(K.R)
    };
    // written by GameScene's on-screen buttons
    this.touch = { left: false, right: false, jumpHeld: false, jumpJust: false };
  }

  pausePressed() { return Phaser.Input.Keyboard.JustDown(this.k.pause); }
  retryPressed() { return Phaser.Input.Keyboard.JustDown(this.k.retry); }

  get() {
    const k = this.k;
    const t = this.touch;
    const jumpKey = Phaser.Input.Keyboard.JustDown(k.w)
      || Phaser.Input.Keyboard.JustDown(k.space)
      || Phaser.Input.Keyboard.JustDown(k.up);
    const out = {
      left: k.a.isDown || k.left.isDown || t.left,
      right: k.d.isDown || k.right.isDown || t.right,
      jump: jumpKey || t.jumpJust,
      jumpHeld: k.w.isDown || k.space.isDown || k.up.isDown || t.jumpHeld
    };
    t.jumpJust = false;
    return out;
  }

  clear() {
    this.touch.left = false;
    this.touch.right = false;
    this.touch.jumpHeld = false;
    this.touch.jumpJust = false;
  }
}
