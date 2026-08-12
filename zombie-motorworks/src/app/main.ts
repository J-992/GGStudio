import '../ui/ui-system.css';
import '../style.css';
import '../mobile.css';

async function boot(): Promise<void> {
  const el = document.getElementById('app');
  if (!el) throw new Error('missing #app');

  const isMuseumPath = /^\/dev\/ui\/?$/.test(location.pathname);
  if (isMuseumPath) {
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

  const sdk = await import('./crazyGamesSdk.ts');
  const sdkReadyAtBoot = await sdk.initCrazyGamesForBoot();
  if (sdkReadyAtBoot) await sdk.startCrazyGamesLoading();

  let app: import('./App.ts').App;
  try {
    const [{ App }, { setPlatformAudioMuted }] = await Promise.all([
      import('./App.ts'),
      import('./sfx.ts'),
    ]);
    sdk.subscribeCrazyGamesAudioMute(setPlatformAudioMuted);
    app = new App(el);
    await app.start();
  } finally {
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
