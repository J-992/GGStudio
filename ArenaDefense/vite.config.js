import { defineConfig } from 'vite';

/**
 * Makes the built `index.html` load its own bundle from the directory the
 * document actually came from, rather than from whatever `./` happens to
 * resolve to.
 *
 * Poki iframes a build at `https://games.poki.com/<gameId>/<buildId>?tag=...`
 * with no trailing slash. A document-relative `./assets/index-<hash>.js`
 * resolves against everything up to the last `/`, which drops `<buildId>`
 * entirely, so the tags Vite injects here — entry script, modulepreloads,
 * stylesheet — all 404 and the game never boots. `base: './'` is still the
 * right setting (Poki forbids absolute paths, and the build must survive
 * being served from any prefix); it just cannot be resolved by the browser's
 * default rule under that URL shape.
 *
 * So the tags are replaced with an inline loader that re-creates them against
 * `window.__ASSET_BASE__`, the build directory computed in index.html's head.
 * The runtime asset loaders read the same global, which is what keeps the
 * later `assets/...` fetches pointed at the right place too.
 *
 * Build only. In dev, Vite's injected tags are absolute and already correct.
 *
 * @returns {import('vite').Plugin}
 */
function pokiBaseUrl() {
  const SCRIPT = /<script([^>]*?)\ssrc="\.\/([^"]+)"([^>]*)><\/script>/g;
  const LINK = /<link([^>]*?)\shref="\.\/([^"]+)"([^>]*)>/g;

  return {
    name: 'poki-base-url',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      const entries = [];

      let out = html.replace(SCRIPT, (tag, before, src, after) => {
        if (!/type="module"/.test(before + after)) return tag;
        entries.push(`m(${JSON.stringify(src)},${/crossorigin/.test(before + after)})`);
        return '';
      });

      out = out.replace(LINK, (tag, before, href, after) => {
        const attrs = before + after;
        const relMatch = /rel="(modulepreload|stylesheet)"/.exec(attrs);
        const rel = relMatch ? relMatch[1] : undefined;
        if (!rel) return tag;
        const fn = rel === 'stylesheet' ? 'c' : 'p';
        entries.push(`${fn}(${JSON.stringify(href)},${/crossorigin/.test(attrs)})`);
        return '';
      });

      if (entries.length === 0) return html;

      // Stylesheet first so the loading screen is never painted unstyled,
      // then the preloads, then the entry — the order Vite emits them in.
      entries.sort((a, b) => rank(a) - rank(b));

      const loader = `<script>
(function () {
  var b = window.__ASSET_BASE__;
  function add(tag, rel, url, cors) {
    var e = document.createElement(tag);
    if (rel) e.rel = rel;
    if (cors) e.crossOrigin = 'anonymous';
    e[tag === 'script' ? 'src' : 'href'] = b + url;
    document.head.appendChild(e);
  }
  function c(u, x) { add('link', 'stylesheet', u, x); }
  function p(u, x) { add('link', 'modulepreload', u, x); }
  function m(u, x) { var e = document.createElement('script'); e.type = 'module'; if (x) e.crossOrigin = 'anonymous'; e.src = b + u; document.head.appendChild(e); }
  ${entries.join('\n  ')};
})();
</script>`;

      return out.replace('</head>', `${loader}\n</head>`);
    },
  };

  function rank(call) {
    return call.startsWith('c(') ? 0 : call.startsWith('p(') ? 1 : 2;
  }
}

/**
 * Removes the static Poki SDK `<script>` tag from `index.html` for any build
 * that is not the Poki target (plain `vite build`, used for a Playables/other
 * distribution). Leaving it in a non-Poki build would make every load try to
 * fetch `game-cdn.poki.com`, which does not exist for that distribution and
 * only costs a failed request; stripping it also keeps the `PokiSDK` string
 * itself out of the plain build entirely.
 *
 * @returns {import('vite').Plugin}
 */
function stripPokiSdkTag() {
  const TAG = /<script[^>]*\ssrc="https:\/\/game-cdn\.poki\.com\/scripts\/v2\/poki-sdk\.js"[^>]*><\/script>\s*/;

  return {
    name: 'strip-poki-sdk-tag',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(TAG, '');
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [pokiBaseUrl(), ...(mode === 'poki' ? [] : [stripPokiSdkTag()])],
  define: {
    __POKI__: JSON.stringify(mode === 'poki'),
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        // three is the only heavy vendor chunk; splitting it keeps the game
        // code cache-bustable on its own during rapid Poki iteration.
        // Vite 8's rolldown bundler only accepts the function form here
        // (the classic `{ three: ['three'] }` object throws at build time).
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  server: {
    host: true,
  },
}));
