/**
 * Stop Rapier's WebAssembly from riding into the bundle as base64.
 *
 * `@dimforge/rapier3d-compat` inlines its 1.4 MB wasm module as a base64 string
 * literal inside `rapier.es.js`. That is convenient and expensive: base64
 * inflates the payload by a third before compression, the string has to be
 * decoded on the main thread before anything can start, and — worst of the
 * three — the browser cannot compile the module while it downloads, because by
 * the time the bytes exist they are already in memory rather than in flight.
 * It made Rapier the single largest thing on the critical path by some margin.
 *
 * The package also ships the real `rapier_wasm3d_bg.wasm` next to the JS, and
 * the wasm-bindgen loader underneath `init()` already knows what to do with a
 * URL: it fetches it and hands the `Response` to `WebAssembly.instantiate-
 * Streaming`. It is only ever handed the base64 blob instead. So this rewrites
 * that one call site to pass the URL of the real file, which Vite emits as a
 * hashed asset. Download and compile then overlap, and the JS chunk loses the
 * whole blob.
 *
 * The match is structural rather than name-based: the identifiers in that file
 * are minified and will be renamed by any version bump, but the argument is
 * always a base64 string starting with the wasm magic number (`\0asm` encodes
 * as `AGFzbQ`). If a future release changes shape enough that the pattern stops
 * matching, the build fails loudly rather than silently shipping the base64.
 */

import type { Plugin } from 'vite';

/**
 * The whole inlined-wasm argument expression.
 *
 * In the shipped file this reads `Yg.toByteArray("AGFzbQ...").buffer` — the
 * decoded bytes, then the `ArrayBuffer` behind them. The trailing `.buffer` is
 * part of the expression being replaced and must be consumed with it: matching
 * only as far as the closing paren leaves `<url>.buffer` behind, which reads a
 * missing property off a string and hands `init()` `undefined`. wasm-bindgen
 * then falls back to resolving a relative URL against a bundler-erased
 * `import.meta.url` and throws `Invalid base URL`.
 *
 * `.buffer` is optional in the pattern so a future release that drops it still
 * matches, rather than silently failing the build.
 */
const INLINE_WASM =
  /[A-Za-z_$][\w$]*\.toByteArray\(\s*"AGFzbQ[A-Za-z0-9+/=]+"\s*\)(?:\s*\.buffer)?/;

const WASM_IMPORT_NAME = '__scrapRigRapierWasmUrl';
const RESPONSE_IMPORT_NAME = '__scrapRigRapierWasmResponse';

/**
 * Absolute, POSIX-separated path to the response helper.
 *
 * The import is injected into a file inside `node_modules`, so a path relative
 * to this plugin would resolve against the wrong directory. An absolute
 * specifier sidesteps that; the separators are normalised because Rollup wants
 * forward slashes even where the filesystem does not.
 */
function responseHelperPath(): string {
  return new URL('../src/app/rapierWasmResponse.ts', import.meta.url).pathname;
}

export function rapierWasm(): Plugin {
  return {
    name: 'scrap-rig:rapier-wasm',
    // Ahead of Vite's own asset handling so the `?url` import this injects is
    // still processed normally.
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('rapier3d-compat')) return undefined;
      if (!INLINE_WASM.test(code)) return undefined;

      // ESM imports hoist, so prepending is enough to have both of these in
      // scope by the time `init()` can run.
      //
      // The loader is handed a promise for a `Response` rather than the bare
      // URL it would otherwise fetch itself. It awaits whatever it is given and
      // only calls `fetch` on a string/Request/URL, so this simply takes over
      // the fetch — which is what lets `rapierWasmResponse` correct a
      // `Content-Type` the host got wrong before `instantiateStreaming` sees
      // it and bails to the buffered path.
      const patched = code.replace(
        INLINE_WASM,
        `${RESPONSE_IMPORT_NAME}(${WASM_IMPORT_NAME})`,
      );

      // The URL has to reach `init()` as a bare string. Anything read off it
      // means the match stopped short of the end of the original expression,
      // and the value handed over would be `undefined` — which fails at boot,
      // in the browser, rather than here. Catch it here.
      const danglingAccess = new RegExp(`${WASM_IMPORT_NAME}\\s*[.[]`);
      if (danglingAccess.test(patched)) {
        this.error(
          'rapier-wasm: rewrote the inlined wasm but left a property access on ' +
            'the URL. The expression around the base64 blob has changed shape — ' +
            'widen INLINE_WASM to cover all of it.',
        );
      }

      return {
        code:
          `import ${WASM_IMPORT_NAME} from ` +
          `'@dimforge/rapier3d-compat/rapier_wasm3d_bg.wasm?url';\n` +
          `import { rapierWasmResponse as ${RESPONSE_IMPORT_NAME} } from ` +
          `'${responseHelperPath()}';\n${patched}`,
        map: null,
      };
    },
  };
}

/**
 * Fail the build if the rewrite above never fired.
 *
 * Silently falling back to the inlined base64 would look like a working build
 * and quietly undo the largest boot-time saving in the project, so a version
 * bump that breaks the pattern has to be noticed.
 */
export function rapierWasmAssertion(): Plugin {
  let rewritten = false;
  return {
    name: 'scrap-rig:rapier-wasm-assert',
    apply: 'build',
    transform(code, id) {
      if (id.includes('rapier3d-compat') && code.includes(WASM_IMPORT_NAME)) {
        rewritten = true;
      }
      return undefined;
    },
    buildEnd() {
      if (!rewritten) {
        this.error(
          'rapier-wasm: could not find the inlined base64 wasm in ' +
            '@dimforge/rapier3d-compat. The package layout has changed — update ' +
            'vite-plugins/rapierWasm.ts, or the build will ship 1.4 MB of ' +
            'base64 on the critical path.',
        );
      }
    },
  };
}
