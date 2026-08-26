// Boot: load the save, kick off Poki SDK init (racing a timeout so an
// adblocker never stalls the game), then start Phaser.
SaveSys.load();
SaveSys.addStat('sessions');

Poki.init().then(() => {
  window.game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: CFG.W,
    height: CFG.H,
    backgroundColor: '#14213d',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'arcade',
      arcade: { debug: false },
    },
    scene: [BootScene, MenuScene, GameScene],
  });
});

window.addEventListener('beforeunload', () => {
  const scene = window.game && window.game.scene ? window.game.scene.getScene('Game') : null;
  if (scene && scene.scene.isActive()) scene.snapshot();
  else SaveSys.save();
});
