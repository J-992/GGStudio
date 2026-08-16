import '../ui/ui-system.css';
import '../style.css';
import '../mobile.css';
import { dismissBootSplash, reportBootStage } from './bootSplash.ts';

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

  const sdk = await import('./crazyGamesSdk.ts');
  const sdkReadyAtBoot = await sdk.initCrazyGamesForBoot();
  if (sdkReadyAtBoot) await sdk.startCrazyGamesLoading();
  reportBootStage('platformReady');

  let app: import('./App.ts').App;
  try {
    const [{ App }, { setPlatformAudioMuted }] = await Promise.all([
      import('./App.ts'),
      import('./sfx.ts'),
    ]);
    reportBootStage('modulesReady');
    sdk.subscribeCrazyGamesAudioMute(setPlatformAudioMuted);
    app = new App(el);
    await app.start(physicsReady);
  } finally {
    // The splash comes down even when boot threw: a stuck splash would hide
    // whatever the failure put on screen.
    dismissBootSplash();
    if (sdkReadyAtBoot) await sdk.stopCrazyGamesLoading();
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
