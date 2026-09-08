/**
 * Just enough DOM for three.js's asset loaders to run under Node.
 *
 * The asset scripts drive the real `OBJLoader`, `FBXLoader` and `GLTFLoader`
 * rather than reimplementing their parsers, because the whole point of those
 * scripts is to compare what the game actually draws. Those loaders reach for
 * `document` to build textures, and `GLTFLoader` in particular will not call
 * its `onLoad` until every texture has resolved — so a stub that merely exists
 * is not enough, it has to actually finish the load.
 *
 * Nothing here decodes pixels. The scripts that need image bytes read them off
 * disk themselves; this only has to unblock the loaders.
 */

/**
 * An `<img>` that reports success on the next tick.
 *
 * three's `ImageLoader` attaches `load`/`error` listeners and then assigns
 * `src`. Firing `load` asynchronously from the setter is what lets a
 * texture-bearing glTF finish parsing here.
 */
class StubImage {
  constructor() {
    this.width = 1;
    this.height = 1;
    this.naturalWidth = 1;
    this.naturalHeight = 1;
    this.complete = false;
    this._src = '';
    this._listeners = new Map();
  }

  get src() {
    return this._src;
  }

  set src(value) {
    this._src = value;
    queueMicrotask(() => {
      this.complete = true;
      for (const listener of this._listeners.get('load') ?? []) {
        listener({ type: 'load', target: this });
      }
    });
  }

  addEventListener(type, listener) {
    const existing = this._listeners.get(type);
    if (existing) existing.push(listener);
    else this._listeners.set(type, [listener]);
  }

  removeEventListener(type, listener) {
    const existing = this._listeners.get(type);
    if (!existing) return;
    const index = existing.indexOf(listener);
    if (index >= 0) existing.splice(index, 1);
  }

  setAttribute() {}
  removeAttribute() {}
}

function stubCanvas() {
  return {
    width: 1,
    height: 1,
    style: {},
    getContext: () => null,
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
  };
}

function createElement(tag) {
  return tag === 'img' ? new StubImage() : stubCanvas();
}

/** Install the stubs once. Safe to call from several scripts in one process. */
export function installDomStub() {
  globalThis.document ??= {
    createElement,
    createElementNS: (_namespace, tag) => createElement(tag),
  };
  globalThis.window ??= globalThis;
  globalThis.self ??= globalThis;
  // Without this three picks `ImageBitmapLoader`, whose `createImageBitmap`
  // does not exist here; leaving it undefined keeps it on the `<img>` path the
  // stub above implements.
  delete globalThis.createImageBitmap;
}
