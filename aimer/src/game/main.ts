import { AUTO, Game, Scale } from 'phaser';
import type { Types } from 'phaser';
import { Boot } from './scenes/Boot';
import { MainMenu } from './scenes/MainMenu';
import { GameScene } from './scenes/GameScene';
import { UpgradeScene } from './scenes/UpgradeScene';
import { ResultScene } from './scenes/ResultScene';
import { H, W } from './core/theme';

const config: Types.Core.GameConfig = {
    type: AUTO,
    width: W,
    height: H,
    parent: 'game-container',
    backgroundColor: '#080b1c',
    scale: {
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH
    },
    input: {
        activePointers: 4
    },
    render: {
        antialias: true
    },
    scene: [ Boot, MainMenu, GameScene, UpgradeScene, ResultScene ]
};

const StartGame = (parent: string) =>
{
    return new Game({ ...config, parent });
};

export default StartGame;
