// One idea at a time: pull -> pull again -> merge -> deploy -> defend. The
// gacha rig (GachaSystem) guarantees the first two pulls are the same common,
// so the first merge is never left to luck. The pointing hand and the step
// card are the whole UI; the world is never frozen.
class TutorialSystem {
  static ORDER = ['pull', 'pull2', 'merge', 'deploy', 'battle'];

  constructor(scene, director) {
    this.scene = scene;
    this.director = director;
    this.active = !SaveSys.data.tutorialDone;

    this.hand = scene.add.image(0, 0, 'hand').setDepth(1050).setVisible(false);
    this.hand.setScale(CFG.ART.handH / 116 * 0.8);
    this.card = scene.add.text(0, 0, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '19px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 5, align: 'center',
      backgroundColor: '#00000088', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(1050).setVisible(false);

    this._handTween = null;

    if (this.active) {
      const saved = SaveSys.data.tutorialStep;
      this.step = TutorialSystem.ORDER.indexOf(saved) !== -1 ? saved : 'pull';
      this._enter(this.step);
    } else {
      this.step = null;
      this.director.holdPrep = false;
    }
  }

  _enter(step) {
    this.step = step;
    SaveSys.data.tutorialStep = step;
    SaveSys.save();
    this.director.holdPrep = step !== 'battle';
    this._stopHand();

    const m = LAYOUT.machine;
    const machineBtn = { x: m.x + m.w / 2, y: m.y + m.h - 40 };

    switch (step) {
      case 'pull':
        this._say('TAP THE MACHINE\nTO GET A BRAINROT!');
        this._pointAt(machineBtn.x, machineBtn.y);
        break;
      case 'pull2':
        this._say('PULL AGAIN!');
        this._pointAt(machineBtn.x, machineBtn.y);
        break;
      case 'merge': {
        this._say('SAME + SAME = STRONGER!\nDrag them together!');
        const pair = this.scene.board.mergePair();
        if (pair) this._dragDemo(pair[0], pair[1]);
        break;
      }
      case 'deploy': {
        this._say('PUT HIM ON\nTHE BATTLEFIELD!');
        const unit = this.scene.board.allUnits()[0];
        const from = unit ? unit.slot : 9;
        // aim at the centre field slot, or the first empty one if taken
        let to = 4;
        if (this.scene.board.at(4)) {
          for (let i = 0; i < BoardModel.FIELD; i++) {
            if (!this.scene.board.at(i)) { to = i; break; }
          }
        }
        this._dragDemo(from, to);
        break;
      }
      case 'battle':
        this._say('DEFEND THE BASE!');
        this._stopHand();
        break;
    }
    this._layoutCard();
  }

  _say(text) {
    this.card.setText(text).setVisible(true);
  }

  _layoutCard() {
    if (!this.card.visible) return;
    const f = LAYOUT.field;
    this.card.setPosition(f.x + f.w / 2, f.y + f.h - 40);
  }

  _pointAt(x, y) {
    this._stopHand();
    this.hand.setVisible(true).setPosition(x + 20, y - 70);
    this._handTween = this.scene.tweens.add({
      targets: this.hand, y: y - 46, duration: 420, yoyo: true, repeat: -1, ease: 'Quad.easeInOut',
    });
  }

  _dragDemo(fromSlot, toSlot) {
    this._stopHand();
    const a = LAYOUT.slotPos(fromSlot), b = LAYOUT.slotPos(toSlot);
    this.hand.setVisible(true).setPosition(a.x + 16, a.y - 30);
    this._handTween = this.scene.tweens.add({
      targets: this.hand,
      x: b.x + 16, y: b.y - 30,
      duration: 900, delay: 300, repeat: -1, repeatDelay: 500, ease: 'Quad.easeInOut',
    });
  }

  _stopHand() {
    if (this._handTween) { this._handTween.stop(); this._handTween = null; }
    this.hand.setVisible(false);
  }

  // ---- hooks from the rest of the game ----

  onPull() {
    if (!this.active) return;
    if (this.step === 'pull') this._enter('pull2');
    else if (this.step === 'pull2') this._enter('merge');
  }

  onMerge() {
    if (!this.active) return;
    if (this.step === 'merge') this._enter('deploy');
  }

  onDeploy() {
    if (!this.active) return;
    if (this.step === 'deploy') this._enter('battle');
  }

  onBattleStart() {
    if (!this.active) return;
    if (this.step === 'battle') this._say('DEFEND THE BASE!');
  }

  onVictory() {
    if (!this.active) return;
    this.active = false;
    SaveSys.data.tutorialDone = true;
    SaveSys.data.tutorialStep = null;
    SaveSys.save();
    this._stopHand();
    this.card.setVisible(false);
    this.scene.fx.banner('YOU GOT IT!', '#ffd54f', 'Pull, merge, conquer!');
    Poki.happyTime(0.8);
  }

  relayout() {
    if (this.active && this.step) this._enter(this.step);
  }
}
window.TutorialSystem = TutorialSystem;
