// Boot: derive the responsive layout from the real window, load the save,
// kick off Poki SDK init (racing a timeout so an adblocker never stalls the
// game), then start Phaser. Window resizes re-derive the layout and resize
// the canvas; scenes hear about it through Phaser's scale 'resize' event.
SaveSys.load();
SaveSys.addStat('sessions');

configureLayout(window.innerWidth || 720, window.innerHeight || 1280);

Poki.init().then(() => {
  // measure again right before boot -- some embeds report 0x0 at script time
  configureLayout(window.innerWidth || 720, window.innerHeight || 1280);
  window.game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: LAYOUT.width,
    height: LAYOUT.height,
    backgroundColor: '#101a30',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    // Some embedded webviews never deliver requestAnimationFrame; ?settimeout
    // switches Phaser to its timer loop so the game still runs there.
    fps: { forceSetTimeOut: /settimeout/.test(window.location.search) },
    scene: [BootScene, MenuScene, HQScene, GameScene],
  });
});

let _resizeDebounce = null;
window.addEventListener('resize', () => {
  if (_resizeDebounce) clearTimeout(_resizeDebounce);
  _resizeDebounce = setTimeout(() => {
    const prev = { w: LAYOUT.width, h: LAYOUT.height };
    configureLayout(window.innerWidth || 720, window.innerHeight || 1280);
    if (window.game && (prev.w !== LAYOUT.width || prev.h !== LAYOUT.height)) {
      // setGameSize (not resize) is the call that keeps FIT's aspect honest
      window.game.scale.setGameSize(LAYOUT.width, LAYOUT.height);
      window.game.scale.refresh();
    }
  }, 120);
});

window.addEventListener('beforeunload', () => SaveSys.save());
