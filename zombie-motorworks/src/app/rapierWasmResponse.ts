/**
 * Hands Rapier's loader a `Response` the browser will agree to stream-compile.
 *
 * `vite-plugins/rapierWasm.ts` already got the wasm out of the bundle and onto
 * a real URL so that download and compile overlap. That only pays off if
 * `WebAssembly.instantiateStreaming` actually accepts the response, and it
 * refuses anything not served as `application/wasm`. Rapier's wasm-bindgen
 * loader reacts to the refusal like this:
 *
 * ```js
 * try { return await WebAssembly.instantiateStreaming(A, I) }
 * catch (I) {
 *   if ('application/wasm' == A.headers.get('Content-Type')) throw I;
 *   console.warn('… Falling back to `WebAssembly.instantiate` which is slower …');
 * }
 * const g = await A.arrayBuffer();
 * return await WebAssembly.instantiate(g, I);
 * ```
 *
 * That fallback is what the portal's crash reports were pointing at: they name
 * `WebAssembly.instantiate()`, not `WebAssembly.instantiateStreaming()`, and V8
 * tags the two entry points distinctly — so players were reaching the buffered
 * path, which means the host was not sending the MIME type. The buffered path
 * is strictly worse in exactly the way that was failing: it holds the whole
 * 1.4 MB response, the compiled module and the new instance in memory at once,
 * with no streaming compile, on the critical boot path.
 *
 * So the header is corrected here, before the loader ever looks at it.
 */

/**
 * Attempts so far. The first goes down the streaming path; a retry buffers, on
 * the theory that if streaming failed for some reason other than the MIME type
 * we have now ruled out, an in-memory response is the more conservative thing
 * to hand over. See `beginPhysicsInit`, which owns the retry.
 */
let attempt = 0;

/** Rapier's loader accepts a promise here and awaits it before use. */
export async function rapierWasmResponse(url: string): Promise<Response> {
  const first = attempt === 0;
  attempt += 1;
  const response = await fetch(url);

  // A failed fetch is not ours to interpret. Handing the original back lets the
  // loader fail on it the way it always would.
  if (!response.ok) return response;

  if (first) {
    if (response.headers.get('Content-Type') === 'application/wasm') {
      return response;
    }
    const body = response.body;
    // Re-wrapping the *stream* rather than the bytes is the whole point: the
    // body is piped through untouched, so the compile still overlaps the
    // download and nothing is held in memory that was not already in flight.
    if (body !== null) {
      try {
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: { 'Content-Type': 'application/wasm' },
        });
      } catch {
        // A browser that will not build a Response from a stream falls through
        // to the buffered path below rather than losing the fix entirely.
      }
    }
  }

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: { 'Content-Type': 'application/wasm' },
  });
}
