import type { Game, Scene } from 'phaser';
import { setExternalMute } from './audio';
import {
    reportPlatformError,
    setPlatformGameplayActive,
    subscribePlatformAudioMute
} from '../platform/platform';

/**
 * Freezes the whole game while something outside it owns the screen.
 *
 * Poki's checklist has two hard rules the game cannot meet by itself: nothing
 * may move or make noise while an ad is on screen, and nothing may move or make
 * noise while the page is hidden -- their iframe can be scrolled out of view
 * without ever firing a blur. A phone turned sideways is the same problem
 * again: this is a 9:16 game, and a landscape phone can only show it as a
 * sliver, so the level timer must not be running behind the rotate prompt.
 * All three are holds on one gate, and the game stays frozen until every hold
 * is gone.
 *
 * The freeze is deliberately belt-and-braces: the scenes are paused *and* the
 * render loop is put to sleep. Pausing the scenes alone would keep burning
 * frames behind an ad; sleeping the loop alone would leave Phaser's own
 * visibility handler free to wake it back up mid-break.
 */

type Hold = 'ad' | 'hidden' | 'rotate';

const holds = new Set<Hold>();

let game: Game | null = null;
let paused: Scene[] = [];

//  What the scenes asked for, which is not the same as what Poki is told: a
//  frozen game is never "playing", however sure the scene is that it is.
let gameplayWanted = false;

function syncGameplay (): void
{
    setPlatformGameplayActive(gameplayWanted && holds.size === 0);
}

/**
 * Report whether the player is actively shooting, as opposed to reading a menu,
 * picking an upgrade or watching a results card. Poki uses the playing/not
 * playing split to decide when an ad is acceptable, so it has to be honest.
 */
export function setGameplayActive (active: boolean): void
{
    gameplayWanted = !!active;
    syncGameplay();
}

function freeze (): void
{
    if (!game) return;

    setExternalMute(true);

    paused = game.scene.getScenes(true);
    for (const scene of paused) scene.scene.pause();

    game.loop.sleep();
}

function thaw (): void
{
    if (!game) return;

    //  Wake the loop first: a resumed scene with a sleeping loop would sit on a
    //  stale delta until the next frame that never comes.
    game.loop.wake();
    game.loop.resetDelta();

    for (const scene of paused)
    {
        //  A scene that was stopped or restarted while frozen is gone; resuming
        //  it would put a dead scene back in the update list.
        if (scene.scene.isPaused()) scene.scene.resume();
    }

    paused = [];

    setExternalMute(false);
}

function apply (before: number): void
{
    if (before === 0 && holds.size > 0) freeze();
    else if (before > 0 && holds.size === 0) thaw();

    syncGameplay();
}

function holdGame (reason: Hold): void
{
    const before = holds.size;
    holds.add(reason);
    apply(before);
}

function releaseGame (reason: Hold): void
{
    const before = holds.size;
    holds.delete(reason);
    apply(before);
}

/**
 * Wire the game up to the page and to the platform. Called once, right after
 * the Phaser game is constructed.
 */
export function attachLifecycle (instance: Game): void
{
    game = instance;

    //  The ad break drives this channel: Poki calls back the moment before the
    //  ad renders and again once it is gone.
    subscribePlatformAudioMute((muted) => (muted ? holdGame('ad') : releaseGame('ad')));

    if (typeof document !== 'undefined')
    {
        document.addEventListener('visibilitychange', () =>
        {
            if (document.visibilityState === 'hidden') holdGame('hidden');
            else releaseGame('hidden');
        });
    }

    if (typeof window !== 'undefined')
    {
        //  A phone held sideways: CSS puts the rotate prompt up (see
        //  public/style.css), and this stops the clock behind it.
        //
        //  Both the first check and the listener wait for the game to be up. A
        //  freeze before boot would put the render loop to sleep with the Boot
        //  scene still unrun, so `gameLoadingFinished` would never fire and a
        //  player who arrived -- or rotated -- during the load would be left
        //  looking at Poki's loading screen forever.
        const sideways = window.matchMedia('(orientation: landscape) and (max-height: 520px)');

        const applyOrientation = (): void =>
        {
            if (sideways.matches) holdGame('rotate');
            else releaseGame('rotate');
        };

        instance.events.once('ready', () =>
        {
            applyOrientation();
            sideways.addEventListener('change', applyOrientation);
        });

        //  Poki surfaces runtime errors from the game in their dashboard, which
        //  is the only view into a crash on a device nobody here owns.
        window.addEventListener('error', (e) => void reportPlatformError(e.error ?? e.message));
        window.addEventListener('unhandledrejection', (e) => void reportPlatformError(e.reason));
    }
}
