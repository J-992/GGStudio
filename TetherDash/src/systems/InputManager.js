// Keyboard + touch, folded into one { left, right, jump, jumpHeld } record
// per runner per frame. In solo mode both keyboard sets drive whichever
// runner the human currently controls.
class InputManager {
  constructor(scene, mode) {
    this.scene = scene;
    this.mode = mode; // 'solo' | 'coop'
    const K = Phaser.Input.Keyboard.KeyCodes;
    const kb = scene.input.keyboard;
    this.k = {
      a: kb.addKey(K.A), d: kb.addKey(K.D),
      w: kb.addKey(K.W), space: kb.addKey(K.SPACE),
      left: kb.addKey(K.LEFT), right: kb.addKey(K.RIGHT), up: kb.addKey(K.UP),
      swap: kb.addKey(K.Q), swap2: kb.addKey(K.SHIFT),
      pause: kb.addKey(K.ESC), retry: kb.addKey(K.R)
    };
    // touch state, written by GameScene's on-screen buttons
    this.touch = {
      A: { left: false, right: false, jumpHeld: false, jumpJust: false },
      B: { left: false, right: false, jumpHeld: false, jumpJust: false }
    };
  }

  swapPressed() {
    return Phaser.Input.Keyboard.JustDown(this.k.swap) || Phaser.Input.Keyboard.JustDown(this.k.swap2);
  }
  pausePressed() { return Phaser.Input.Keyboard.JustDown(this.k.pause); }
  retryPressed() { return Phaser.Input.Keyboard.JustDown(this.k.retry); }

  // keyboard slice for player-1 keys (WASD) or player-2 keys (arrows)
  kbSet(which) {
    const k = this.k;
    if (which === 1) {
      return {
        left: k.a.isDown, right: k.d.isDown,
        jump: Phaser.Input.Keyboard.JustDown(k.w) || Phaser.Input.Keyboard.JustDown(k.space),
        jumpHeld: k.w.isDown || k.space.isDown
      };
    }
    return {
      left: k.left.isDown, right: k.right.isDown,
      jump: Phaser.Input.Keyboard.JustDown(k.up),
      jumpHeld: k.up.isDown
    };
  }

  touchSet(id) {
    const t = this.touch[id];
    const out = { left: t.left, right: t.right, jump: t.jumpJust, jumpHeld: t.jumpHeld };
    t.jumpJust = false;
    return out;
  }

  static merge(a, b) {
    return {
      left: a.left || b.left, right: a.right || b.right,
      jump: a.jump || b.jump, jumpHeld: a.jumpHeld || b.jumpHeld
    };
  }

  // In solo the human drives `activeId`; the other runner returns null (AI turn).
  // In co-op, runner A = P1 keys + left touch cluster, runner B = P2 keys + right cluster.
  getFor(runnerId, activeId) {
    if (this.mode === 'coop') {
      const kb = this.kbSet(runnerId === 'A' ? 1 : 2);
      return InputManager.merge(kb, this.touchSet(runnerId));
    }
    if (runnerId !== activeId) return null;
    const kb = InputManager.merge(this.kbSet(1), this.kbSet(2));
    return InputManager.merge(kb, InputManager.merge(this.touchSet('A'), this.touchSet('B')));
  }
}
