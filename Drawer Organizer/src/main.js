// Entry point. Base canvas is picked from device orientation:
// landscape 960x640, portrait 640x960 — FIT-scaled, swapped live on rotation (see Layout.js).
Layout.portrait = Layout.detect();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: Layout.size().w,
  height: Layout.size().h,
  backgroundColor: '#fdeef4',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  render: { antialias: true },
  input: { activePointers: 3 },
  scene: [BootScene, HomeScene, RoomScene, LevelScene]
});
Layout.install(game);
