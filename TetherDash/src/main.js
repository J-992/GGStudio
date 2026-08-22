// Entry point. 960x540 (16:9) base canvas, FIT-scaled to the window.
window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: CFG.GAME_W,
  height: CFG.GAME_H,
  backgroundColor: '#8ecdf4',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  render: { antialias: true },
  input: { activePointers: 4 },
  scene: [BootScene, MenuScene, LevelSelectScene, GameScene]
});
