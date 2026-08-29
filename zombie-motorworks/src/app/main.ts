import '../ui/ui-system.css';
import '../style.css';
import '../mobile.css';
import { inject } from '@vercel/analytics';
import { dismissBootSplash, reportBootStage } from './bootSplash.ts';

// This game is a Vite/vanilla TypeScript app rather than a React app, so use
// the package's framework-agnostic entry point. It installs the analytics
// script as soon as the app module loads, covering every game mode.
inject({ framework: 'vite' });

async function boot(): Promise<void> {
  const el = document.getElementById('app');
  if (!el) throw new Error('missing #app');

  const isMuseumPath = /^\/dev\/ui\/?$/.test(location.pathname);
  if (isMuseumPath) {
    dismissBootSplash();
    if (!import.meta.env.DEV) {
      document.title = 'Not found';
      el.innerHTML =
        '<main class="dev-route-unavailable"><span>404</span><p>Nothing lives here.</p></main>';
      return;
    }
    const { mountUIMuseum } = await import('../ui/Museum.ts');
    mountUIMuseum(el);
    return;
  }

  reportBootStage('scriptsReady');

  // Kick the physics wasm off before anything is awaited. It is the single
  // largest thing a cold boot fetches, nothing before the first mode needs it,
  // and it compiles while it downloads — so the only way to waste it is to
  // start it late. Deliberately not awaited here; `App.start` picks it up.
  const physicsReady = import('./physics.ts').then((physics) =>
    physics.beginPhysicsInit(),
  );
  // A rejection reaching the microtask queue with no handler attached is an
  // unhandled rejection even though `start()` awaits this later, so park a
  // no-op handler on it now. The real error still surfaces at the await.
  physicsReady.catch(() => undefined);

  const platform = await import('./platform.ts');
  // The portal seam exists now, so the retention funnel can have its real
  // sinks. Everything recorded before this — the boot stages above — was
  // buffered and is replayed on connection.
  (await import('./funnelSink.ts')).connectFunnel();
  // Give the SDK a head start before the module graph is fetched. The result is
  // deliberately discarded: it reports whether init won a short race, which is
  // not the same question as whether the loading bracket below should run.
  await platform.initPlatformForBoot();
  // Both halves of the loading bracket hang off this one promise, so the pair
  // can never invert or go half-reported. Gating them on the boot watchdog
  // instead — which is what this used to do — meant an SDK that finished
  // initializing a moment after the watchdog gave up never got a
  // `gameLoadingStart`/`gameLoadingFinished` pair at all, and a portal's
  // integration check reads that as a missing integration.
  const loadingBracket = platform.startPlatformLoading();
  // Only awaited in the `finally` below, which can be seconds away. Same reason
  // as `physicsReady` above: a rejection landing before then would count as
  // unhandled even though it is awaited eventually.
  loadingBracket.catch(() => undefined);
  reportBootStage('platformReady');

  let app: import('./App.ts').App;
  try {
    const [{ App }, { setPlatformAudioMuted }] = await Promise.all([
      import('./App.ts'),
      import('./sfx.ts'),
    ]);
    reportBootStage('modulesReady');
    platform.subscribePlatformAudioMute(setPlatformAudioMuted);
    app = new App(el);
    await app.start(physicsReady);
  } finally {
    // The splash comes down even when boot threw: a stuck splash would hide
    // whatever the failure put on screen.
    dismissBootSplash();
    // Never report the game as loaded before the report that it started
    // loading. Both calls no-op on a platform that has no loading screen, and
    // on one whose SDK never arrived.
    await loadingBracket;
    await platform.stopPlatformLoading();
  }

  // Read every parameter before rewriting the URL below, so stripping the
  // share code cannot take the debug seam down with it.
  const params = new URLSearchParams(location.search);
  const build = params.get('build');
  // Developer builds only. The seam drives the whole game from the console —
  // place parts, jump waves, set controls — so the public build must not expose
  // it however the URL is dressed up. The Playwright suite drives a production
  // preview through this seam, so it builds with `VITE_E2E=1` to opt back in;
  // that flag is set by `playwright.config.ts` and by nothing that ships.
  const debugSeamAllowed =
    import.meta.env.DEV || import.meta.env.VITE_E2E === '1';
  if (debugSeamAllowed && params.get('debug') === '1') {
    (window as unknown as { __scrapRig: unknown }).__scrapRig = app.debugSeam();
  }
  if (build) {
    // Drop only `build`, keeping any other parameters, so a refresh or a back
    // navigation does not import the same rig again.
    params.delete('build');
    const query = params.toString();
    history.replaceState(
      null,
      '',
      `${location.pathname}${query ? `?${query}` : ''}${location.hash}`,
    );
    void app.importBuildCode(build);
  }
}

void boot();
