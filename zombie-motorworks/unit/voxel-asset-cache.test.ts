/**
 * The template cache must never hold on to a failed load.
 *
 * An arena requests a hundred-odd assets at once and places each prop from its
 * own async callback, so a single dropped fetch used to be inherited by every
 * later placement of that asset: one hiccup turned every crate, tomb or fence
 * of that kind into a grey placeholder box for the rest of the run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearVoxelAssetCache,
  instantiateVoxelAsset,
} from '../src/survival/VoxelAssetLoader.ts';

const OBJ = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
const MTL = 'newmtl material\nKd 1 1 1\n';

const originalFetch = globalThis.fetch;

// three's FileLoader reports a failed request by constructing a ProgressEvent,
// which node does not define; without it the loader's error path throws instead
// of rejecting and nothing here would ever settle.
globalThis.ProgressEvent ??= class extends Event {
  constructor(type: string) {
    super(type);
  }
} as unknown as typeof globalThis.ProgressEvent;

/** Serves the OBJ/MTL pair, failing the first `failures` requests. */
function serveWithFailures(failures: number): { calls: () => number } {
  let calls = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    calls += 1;
    if (calls <= failures) throw new TypeError('network error');
    const url = String(input);
    return new Response(url.endsWith('.mtl') ? MTL : OBJ, { status: 200 });
  }) as typeof globalThis.fetch;
  return { calls: () => calls };
}

describe('voxel template cache', () => {
  beforeEach(() => {
    clearVoxelAssetCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearVoxelAssetCache();
  });

  it('retries a transient failure instead of falling back on the first drop', async () => {
    // Both files are fetched per attempt, so failing two requests loses one
    // whole attempt and the retry is what has to save the prop.
    serveWithFailures(2);

    const model = await instantiateVoxelAsset('http://assets.test/test/Prop');

    expect(model.children.length).toBeGreaterThan(0);
  });

  it('does not cache a rejection, so a later placement loads the prop', async () => {
    const failing = serveWithFailures(Number.MAX_SAFE_INTEGER);
    await expect(instantiateVoxelAsset('http://assets.test/test/Prop')).rejects.toThrow();
    const attempted = failing.calls();
    expect(attempted).toBeGreaterThan(1);

    // Second placement of the same asset, network now healthy: it must issue
    // fresh requests rather than inherit the earlier failure.
    serveWithFailures(0);
    const model = await instantiateVoxelAsset('http://assets.test/test/Prop');

    expect(model.children.length).toBeGreaterThan(0);
  });
});
