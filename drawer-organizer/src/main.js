// Entry point. Base canvas is picked from device orientation:
// landscape 960x640, portrait 640x960 — FIT-scaled, swapped live on rotation (see Layout.js).
// The Poki SDK gets initialised first; the game boots either way (see PokiSDK.js).
function startGame() {
  Layout.portrait = Layout.detect();
  window.game = new Phaser.Game({
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
  Layout.install(window.game);
}

Poki.init().then(startGame);
