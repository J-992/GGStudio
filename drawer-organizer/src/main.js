// Entry point. 960x640 base, FIT-scaled — plays nicely in landscape and tolerates portrait.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 640,
  backgroundColor: '#fdeef4',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  render: { antialias: true },
  input: { activePointers: 2 },
  scene: [BootScene, HomeScene, RoomScene, LevelScene]
});
