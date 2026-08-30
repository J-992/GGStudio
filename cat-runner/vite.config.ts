import { defineConfig, type Plugin } from 'vite';

/**
 * Makes the built `index.html` load its own bundle from the directory the
 * document actually came from, rather than from whatever `./` happens to
 * resolve to.
 *
 * Poki iframes a build at `https://games.poki.com/<gameId>/<buildId>?tag=...`
 * with no trailing slash. A document-relative `./assets/index-<hash>.js`
 * resolves against everything up to the last `/`, which drops `<buildId>`
 * entirely, so the four tags Vite injects here - entry script, modulepreloads,
 * stylesheet - all 404 and the game never boots. `base: './'` is still the
 * right setting (Poki forbids absolute paths, and the build must survive being
 * served from any prefix); it just cannot be resolved by the browser's default
 * rule under that URL shape.
 *
 * So the tags are replaced with an inline loader that re-creates them against
 * `window.__ASSET_BASE__`, the build directory computed in index.html's head.
 * The runtime asset loaders read the same global, which is what keeps the
 * hundreds of later `assets/...` fetches pointed at the right place too.
 *
 * Build only. In dev, Vite's injected tags are absolute and already correct.
 */
function pokiBaseUrl(): Plugin {
  const SCRIPT = /<script([^>]*?)\ssrc="\.\/([^"]+)"([^>]*)><\/script>/g;
  const LINK = /<link([^>]*?)\shref="\.\/([^"]+)"([^>]*)>/g;

  return {
    name: 'poki-base-url',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      const entries: string[] = [];

      let out = html.replace(SCRIPT, (tag, before: string, src: string, after: string) => {
        if (!/type="module"/.test(before + after)) return tag;
        entries.push(`m(${JSON.stringify(src)},${/crossorigin/.test(before + after)})`);
        return '';
      });

      out = out.replace(LINK, (tag, before: string, href: string, after: string) => {
        const attrs = before + after;
        const rel = /rel="(modulepreload|stylesheet)"/.exec(attrs)?.[1];
        if (!rel) return tag;
        const fn = rel === 'stylesheet' ? 'c' : 'p';
        entries.push(`${fn}(${JSON.stringify(href)},${/crossorigin/.test(attrs)})`);
        return '';
      });

      if (entries.length === 0) return html;

      // Stylesheet first so the loading screen is never painted unstyled, then
      // the preloads, then the entry - the order Vite emits them in.
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

  function rank(call: string): number {
    return call.startsWith('c(') ? 0 : call.startsWith('p(') ? 1 : 2;
  }
}

export default defineConfig({
  base: './',
  plugins: [pokiBaseUrl()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
  server: {
    host: true,
    open: true,
  },
});
