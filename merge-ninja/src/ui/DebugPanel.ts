import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
export class DebugPanel extends Phaser.GameObjects.Container {
  private readonly readout: Phaser.GameObjects.BitmapText; private tier = 1;
  constructor(scene: Phaser.Scene, private readonly core: GameCore, private readonly setHighIntensity: (value: boolean) => void) {
    super(scene, 12, 80); scene.add.existing(this).setDepth(200).setVisible(false); const bg = scene.add.nineslice(0, 0, 'game', 'panel_frame_9', 300, 400, 8, 8, 8, 8).setOrigin(0); this.readout = scene.add.bitmapText(12, 12, 'pixel', '', 14).setTint(0xffffff); this.add([bg, this.readout]); let high = false;
    const buttons: Array<[string, () => void]> = [['+1000', () => core.grantCoins(1000)], ['SPAWNTIER', () => core.spawnTier(this.tier)], ['TIER+', () => { this.tier = this.tier >= 12 ? 1 : this.tier + 1; }], ['CLEAR', () => core.clearBoard()], ['SKIP', () => core.skipEnemy()], ['BOSS', () => core.spawnBossNow()], ['HIGHFX', () => { high = !high; this.setHighIntensity(high); }], ['SPEED', () => core.setSpeed(core.speed >= 8 ? 1 : core.speed * 2)], ['RESET', () => core.resetRun()], ['WIPEMETA', () => core.wipeEverything()]];
    buttons.forEach(([label, action], index) => { const button = scene.add.bitmapText(12 + (index % 2) * 140, 215 + Math.floor(index / 2) * 35, 'pixel', label, 14).setTint(0xffffff).setInteractive(); button.on('pointerdown', action); this.add(button); }); scene.input.keyboard?.on('keydown-BACKTICK', () => this.setVisible(!this.visible));
  }
  refresh(): void { const m = this.core.metrics; this.readout.setText(`DEBUG T${this.tier} SPEED${this.core.speed}\nTIME ${Math.floor(m.timePlayedMs / 1000)}\nBUYS ${m.purchases} MERGES ${m.merges}\nHIGHEST ${m.highestTier} DPS ${this.core.totalDps}\nSTAGE ${this.core.boss.stage} BOSSES ${m.bossDefeats}\nFULL ${m.boardFullCount}`); }
}
