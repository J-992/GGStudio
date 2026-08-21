// Drag handling for item sprites: lift/scale on grab, drop shadow, smooth follow.
// Delegates the actual drop resolution to PlacementSystem.
class DragSystem {
  constructor(scene, placement) {
    this.scene = scene;
    this.placement = placement;
    this.active = null;

    scene.input.on('dragstart', (pointer, obj) => this.onStart(obj));
    scene.input.on('drag', (pointer, obj, dragX, dragY) => this.onDrag(obj, dragX, dragY));
    scene.input.on('dragend', (pointer, obj) => this.onEnd(obj, pointer));
  }

  enable(sprite) {
    sprite.setInteractive({ useHandCursor: true, draggable: true });
    // Forgiving hit area — pad the sprite bounds for small fingers.
    const pad = 14;
    sprite.input.hitArea.setTo(-pad, -pad, sprite.width + pad * 2, sprite.height + pad * 2);
  }

  onStart(obj) {
    if (obj.locked) return;
    this.active = obj;
    obj.setDepth(1000);
    obj.shadow = this.scene.add.image(obj.x, obj.y + obj.displayHeight * 0.55, 'softshadow')
      .setDepth(999).setAlpha(0).setScale(obj.displayWidth / 60, 0.8);
    this.scene.tweens.add({ targets: obj, scale: obj.baseScale * 1.14, angle: 0, duration: 130, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: obj.shadow, alpha: 0.9, duration: 130 });
    AudioSys.play('pick');
  }

  onDrag(obj, dragX, dragY) {
    if (obj.locked) return;
    obj.x = dragX;
    obj.y = dragY;
    if (obj.shadow) {
      obj.shadow.x = dragX;
      obj.shadow.y = dragY + obj.displayHeight * 0.55;
    }
    this.placement.highlight(obj);
  }

  onEnd(obj, pointer) {
    if (obj.locked) return;
    this.active = null;
    if (obj.shadow) { obj.shadow.destroy(); obj.shadow = null; }
    this.placement.clearHighlight();
    this.placement.tryPlace(obj, pointer);
  }
}
