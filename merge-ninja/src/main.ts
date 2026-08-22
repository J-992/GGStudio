import Phaser from 'phaser';
import { initPlatformForBoot, reportPlatformError, startPlatformLoading } from './platform/platform';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { configureLayout, theme } from './ui/theme';

function boot(): void {
  configureLayout(window.innerWidth, window.innerHeight);
  const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: theme.layout.width, height: theme.layout.height, backgroundColor: theme.colors.background, scene: [BootScene, GameScene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, render: { pixelArt: true }, input: { activePointers: 2 } });
  window.addEventListener('resize', () => { configureLayout(window.innerWidth, window.innerHeight); game.scale.resize(theme.layout.width, theme.layout.height); });
}

// Anything the game throws is worth a line in Poki's dashboard. On every other
// build these resolve false, and the handlers cost nothing.
window.addEventListener('error', (event) => { void reportPlatformError(event.error ?? event.message); });
window.addEventListener('unhandledrejection', (event) => { void reportPlatformError(event.reason); });

// The portal gets its head start before Phaser is constructed: Poki's own
// loader is what the player is looking at until BootScene reports the game up,
// and their SDK has to be alive to be told. The watchdog inside
// `initPlatformForBoot` caps a blocked or slow CDN at three seconds, after
// which the game boots regardless.
void (async () => {
  await initPlatformForBoot();
  void startPlatformLoading();
  boot();
})();
