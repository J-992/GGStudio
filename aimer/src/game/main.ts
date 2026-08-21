import { AUTO, Game, Scale } from 'phaser';
import type { Types } from 'phaser';
import { Boot } from './scenes/Boot';
import { MainMenu } from './scenes/MainMenu';
import { GameScene } from './scenes/GameScene';
import { WorldScene } from './scenes/WorldScene';
import { BonusScene } from './scenes/BonusScene';
import { ResultScene } from './scenes/ResultScene';
import { H, W } from './core/theme';

const config: Types.Core.GameConfig = {
    type: AUTO,
    width: W,
    height: H,
    parent: 'game-container',
    backgroundColor: '#080b1c',
    //  The portal's console is the first thing a reviewer looks at.
    banner: false,
    scale: {
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH,
        //  Poki sizes the iframe, and it changes: desktop, phone portrait,
        //  phone landscape and the moment a player rotates. FIT against a
        //  parent that is told to fill its box is what survives all four.
        expandParent: true,
        //  Whole-pixel canvas dimensions -- a half-pixel canvas is where the
        //  soft, slightly smeared look on some Android devices comes from.
        autoRound: true
    },
    input: {
        activePointers: 4,
        //  Portal builds are always in an iframe; without capture, a touch that
        //  starts on the canvas can still be stolen by the page around it.
        touch: { capture: true }
    },
    //  The game lives in an iframe, so it has to take focus itself for keyboard
    //  input to ever reach it.
    autoFocus: true,
    disableContextMenu: true,
    render: {
        antialias: true,
        //  The game is one fullscreen canvas of flat shapes -- there is nothing
        //  underneath worth compositing against, and an opaque canvas is
        //  measurably cheaper on mobile GPUs.
        transparent: false,
        powerPreference: 'high-performance'
    },
    fps: {
        target: 60,
        //  Smoothing keeps the delta sane across the spike that follows an ad
        //  break or a tab switch.
        smoothStep: true
    },
    scene: [ Boot, MainMenu, GameScene, BonusScene, WorldScene, ResultScene ]
};

const StartGame = (parent: string) =>
{
    return new Game({ ...config, parent });
};

export default StartGame;
