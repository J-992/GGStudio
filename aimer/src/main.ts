import StartGame from './game/main';

function boot ()
{
    StartGame('game-container');

    //  Mobile hardening: no rubber-band scrolling, no pinch zoom, no long-press menu.
    const stop = (e: Event) => e.preventDefault();

    document.addEventListener('touchmove', stop, { passive: false });
    document.addEventListener('gesturestart', stop as EventListener);
    document.addEventListener('contextmenu', stop);
    document.addEventListener('dblclick', stop);
}

if (document.readyState === 'loading')
{
    document.addEventListener('DOMContentLoaded', boot);
}
else
{
    boot();
}
