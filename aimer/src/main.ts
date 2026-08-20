import StartGame from './game/main';
import { attachLifecycle } from './game/core/lifecycle';
import { initPlatformForBoot, startPlatformLoading } from './game/platform/platform';

/**
 * Mobile hardening: no rubber-band scrolling, no pinch zoom, no long-press
 * menu. All of it matters more on a portal than on its own page -- the game
 * lives in an iframe on somebody else's site, and a stray gesture that scrolls
 * or zooms lands on their layout, not ours.
 */
function hardenInput (): void
{
    const stop = (e: Event) => e.preventDefault();

    document.addEventListener('touchmove', stop, { passive: false });
    document.addEventListener('gesturestart', stop as EventListener);
    document.addEventListener('contextmenu', stop);
    document.addEventListener('dblclick', stop);
}

async function boot (): Promise<void>
{
    hardenInput();

    //  Poki wants the SDK up before anything else happens, and the loading
    //  bracket opened before the game starts pulling itself together -- until
    //  `gameLoadingFinished` lands the player is looking at their loader, not
    //  at us. The watchdog inside `initPlatformForBoot` means a slow or blocked
    //  CDN delays the boot by a moment rather than stopping it.
    await initPlatformForBoot();
    await startPlatformLoading();

    attachLifecycle(StartGame('game-container'));
}

if (document.readyState === 'loading')
{
    document.addEventListener('DOMContentLoaded', () => void boot());
}
else
{
    void boot();
}
