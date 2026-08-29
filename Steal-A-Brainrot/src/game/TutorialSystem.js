// The level-1 script, one idea at a time: plant a shooter -> tap brainz ->
// plant the money elephant -> survive. The pointing hand (Derek's merge-ninja
// asset, assets/ui/tutorial-hand.webp) and a step card are the whole UI; the
// world is never frozen, the waves are just held back until the first plant.
class TutorialSystem {
  static ORDER = ['plant', 'collect', 'producer', 'battle'];

  constructor(scene, director) {
    this.scene = scene;
    this.director = director;
    this.active = !SaveSys.data.tutorialDone && scene.levelN === 1;

    this.hand = scene.add.image(0, 0, 'hand').setDepth(1050).setVisible(false);
    this.hand.setScale(TextureFactory.scaleFor(scene, 'hand', CFG.ART.handH));
    this.card = scene.add.text(0, 0, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '19px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 5, align: 'center',
      backgroundColor: '#00000088', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(1050).setVisible(false);

    this._handTween = null;

    if (this.active) {
      this.step = 'plant';
      this._enter(this.step);
    } else {
      this.step = null;
      this.director.holdPrep = false;
    }
  }

  _enter(step) {
    this.step = step;
    this.director.holdPrep = step !== 'battle';
    this._stopHand();

    switch (step) {
      case 'plant': {
        this._say('PLANT TRIPPI TROPPI\nON THE LAWN!');
        const i = this.scene.cards.indexOf('trippi');
        const from = this.scene.cards.cardPos(i === -1 ? 0 : i);
        const f = LAYOUT.field;
        this._dragDemo(from, { x: f.colX(2), y: f.laneY(2) - f.laneH * 0.3 });
        break;
      }
      case 'collect': {
        this._say('TAP THE BRAINZ\nTO COLLECT THEM!');
        // a guaranteed token to point at, right in the middle
        if (this.scene.energy.tokens.length === 0) this.scene.energy.spawnSky(3, 4);
        const t = this.scene.energy.tokens[0];
        if (t) this._pointAt(t.root.x, t.root.y);
        break;
      }
      case 'producer': {
        this._say('PLANT COCOFANTO!\nHE MAKES BRAINZ!');
        const i = this.scene.cards.indexOf('cocofanto');
        const from = this.scene.cards.cardPos(i === -1 ? 0 : i);
        const f = LAYOUT.field;
        // behind the shooter, in the lane it defends
        this._dragDemo(from, { x: f.colX(0), y: f.laneY(2) - f.laneH * 0.3 });
        break;
      }
      case 'battle':
        this._say('STOP THE EVIL BRAINROTS!');
        this.scene.time.delayedCall(3500, () => {
          if (this.step === 'battle' && this.active) this.card.setVisible(false);
        });
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

  _dragDemo(a, b) {
    this._stopHand();
    this.hand.setVisible(true).setPosition(a.x + 16, a.y - 20);
    this._handTween = this.scene.tweens.add({
      targets: this.hand,
      x: b.x + 16, y: b.y - 20,
      duration: 900, delay: 300, repeat: -1, repeatDelay: 500, ease: 'Quad.easeInOut',
    });
  }

  _stopHand() {
    if (this._handTween) { this._handTween.stop(); this._handTween = null; }
    this.hand.setVisible(false);
  }

  // ---- hooks from the rest of the game ----

  onPlant(id) {
    if (!this.active) return;
    if (this.step === 'plant') this._enter('collect');
    else if (this.step === 'producer' && id === 'cocofanto') this._enter('battle');
  }

  onCollect() {
    if (!this.active) return;
    if (this.step === 'collect') this._enter('producer');
  }

  onBattleStart() {
    if (!this.active) return;
    if (this.step === 'battle') this._say('STOP THE EVIL BRAINROTS!');
  }

  onVictory() {
    if (!this.active) return;
    this.active = false;
    SaveSys.data.tutorialDone = true;
    SaveSys.save();
    this._stopHand();
    this.card.setVisible(false);
    this.scene.fx.banner('LAWN DEFENDED!', '#ffd54f', 'Time to grow the squad!');
    Poki.happyTime(0.8);
  }

  relayout() {
    if (this.active && this.step) this._enter(this.step);
  }
}
window.TutorialSystem = TutorialSystem;
