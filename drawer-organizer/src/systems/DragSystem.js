// Drag handling for item sprites: lift/scale on grab, drop shadow, smooth follow.
// Delegates the actual drop resolution to PlacementSystem.
class DragSystem {
  constructor(scene, placement) {
    this.scene = scene;
    this.placement = placement;
    this.active = null;

    scene.input.on('dragstart', (pointer, obj) => this.onStart(obj, pointer));
    scene.input.on('drag', (pointer, obj, dragX, dragY) => this.onDrag(obj, dragX, dragY));
    scene.input.on('dragend', (pointer, obj) => this.onEnd(obj, pointer));
  }

  enable(sprite) {
    sprite.setInteractive({ useHandCursor: true, draggable: true });
    // Forgiving hit area — pad the sprite bounds so every item is at least
    // ~64px square to grab, which matters on small touch screens.
    const padX = Math.max(14, (64 - sprite.width) / 2);
    const padY = Math.max(14, (64 - sprite.height) / 2);
    sprite.input.hitArea.setTo(-padX, -padY, sprite.width + padX * 2, sprite.height + padY * 2);
  }

  onStart(obj, pointer) {
    if (obj.locked) return;
    this.active = obj;
    // On touch, float the item above the finger so it isn't hidden under it.
    obj.lift = 0;
    obj.dragY = obj.y;
    if (pointer && pointer.wasTouch) {
      this.scene.tweens.add({
        targets: obj, lift: 48, duration: 150, ease: 'Sine.easeOut',
        onUpdate: () => { if (!obj.locked && this.active === obj) obj.y = obj.dragY - obj.lift; }
      });
    }
    obj.setDepth(1000);
    obj.shadow = this.scene.add.image(obj.x, obj.y + obj.displayHeight * 0.55, 'softshadow')
      .setDepth(999).setAlpha(0).setScale(obj.displayWidth / 60, 0.8);
    this.scene.tweens.add({ targets: obj, scale: obj.baseScale * 1.14, angle: 0, duration: 130, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: obj.shadow, alpha: 0.9, duration: 130 });
    AudioSys.play('pick');
  }

  onDrag(obj, dragX, dragY) {
    if (obj.locked) return;
    obj.dragY = dragY;
    obj.x = dragX;
    obj.y = dragY - (obj.lift || 0);
    if (obj.shadow) {
      // The shadow tracks the finger point, which reads as the ground under a lifted item.
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
