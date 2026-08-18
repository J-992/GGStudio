import { describe, expect, it } from 'vitest';
import { App } from '../src/app/App.ts';

/**
 * `WebGLRenderer.setSize` assigns `canvas.width`/`canvas.height` every time it
 * is called, and assigning either — even the identical value — destroys and
 * rebuilds the whole drawing buffer. With `antialias: true` at a pixel ratio of
 * 2 that is tens of megabytes of multisampled colour and depth per call, and
 * `visualViewport` fires a resize on every frame the mobile URL bar slides. The
 * guard in `applyViewport` is what stops that from churning the GPU, so these
 * tests count the calls rather than the resulting size.
 */

/**
 * `applyViewport` reads `window.devicePixelRatio`, and this suite runs on the
 * node environment, so the window it reads has to be stood up here.
 */
function setDevicePixelRatio(value: number): void {
  const scope = globalThis as unknown as {
    window?: { devicePixelRatio: number };
    devicePixelRatio: number;
  };
  scope.window ??= { devicePixelRatio: value };
  scope.window.devicePixelRatio = value;
  scope.devicePixelRatio = value;
}

function harness(width: number, height: number, pixelRatio: number) {
  const calls = { setSize: 0, setPixelRatio: 0 };
  const app = Object.create(App.prototype) as App;
  const internals = app as unknown as {
    renderer: unknown;
    root: { clientWidth: number; clientHeight: number };
    appliedPixelRatio: number;
    appliedDeviceWidth: number;
    appliedDeviceHeight: number;
    applyViewport: () => void;
  };
  internals.renderer = {
    setSize: () => {
      calls.setSize += 1;
    },
    setPixelRatio: () => {
      calls.setPixelRatio += 1;
    },
  };
  internals.root = { clientWidth: width, clientHeight: height };
  internals.appliedPixelRatio = 0;
  internals.appliedDeviceWidth = 0;
  internals.appliedDeviceHeight = 0;
  setDevicePixelRatio(pixelRatio);
  return {
    calls,
    apply: () => internals.applyViewport(),
    resizeTo: (w: number, h: number) => {
      internals.root.clientWidth = w;
      internals.root.clientHeight = h;
    },
    setDpr: setDevicePixelRatio,
  };
}

describe('viewport re-fit', () => {
  it('reallocates the drawing buffer once for a real size change', () => {
    const view = harness(390, 844, 2);
    view.apply();
    // One `setSize`, and no `setPixelRatio` chasing it: the old code called
    // both unconditionally, and `setPixelRatio` re-runs `setSize` internally,
    // so every event cost two reallocations rather than one.
    expect(view.calls.setSize).toBe(1);
    expect(view.calls.setPixelRatio).toBe(1);
  });

  it('does nothing when the viewport reports the same size again', () => {
    const view = harness(390, 844, 2);
    view.apply();
    const after = { ...view.calls };

    // A URL-bar slide on mobile: many events, no change in layout metrics.
    for (let i = 0; i < 30; i++) view.apply();

    expect(view.calls.setSize).toBe(after.setSize);
    expect(view.calls.setPixelRatio).toBe(after.setPixelRatio);
  });

  it('does not touch the buffer when a ratio change rounds to the same pixels', () => {
    const view = harness(390, 844, 2);
    view.apply();
    const after = { ...view.calls };

    // Above the cap of 2, so the effective ratio — and therefore the backing
    // store — is identical. A phone reporting 3 after a rotation must not cost
    // a reallocation.
    view.setDpr(3);
    view.apply();

    expect(view.calls.setSize).toBe(after.setSize);
  });

  it('re-fits when the size genuinely moves', () => {
    const view = harness(390, 844, 2);
    view.apply();
    const after = { ...view.calls };

    view.resizeTo(844, 390);
    view.apply();

    expect(view.calls.setSize).toBe(after.setSize + 1);
    // The ratio did not move, so this half is still skipped.
    expect(view.calls.setPixelRatio).toBe(after.setPixelRatio);
  });

  it('ignores a collapsed layout rather than resizing to nothing', () => {
    const view = harness(390, 844, 2);
    view.apply();
    const after = { ...view.calls };

    // A container mid-transition. Resizing to zero would cost one reallocation
    // now and another on the way back out, for a buffer nobody ever saw.
    view.resizeTo(0, 0);
    view.apply();

    expect(view.calls.setSize).toBe(after.setSize);
  });
});
