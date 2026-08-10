export interface AimPadSample {
  /** Client-space point the thumb is at, for the consumer to raycast. */
  readonly clientX: number;
  readonly clientY: number;
}

export interface AimPadOptions {
  readonly zone: HTMLElement;
  readonly onAim?: (sample: AimPadSample) => void;
  readonly onFireChange?: (firing: boolean) => void;
  /** ms a thumb must be held before it counts as firing; default 0. */
  readonly holdToFireMs?: number;
}

interface AimGesture {
  fireTimer: ReturnType<typeof setTimeout> | null;
}

const NON_PASSIVE: AddEventListenerOptions = { passive: false };

export class AimPad {
  readonly #zone: HTMLElement;
  readonly #onAim?: (sample: AimPadSample) => void;
  readonly #onFireChange?: (firing: boolean) => void;
  readonly #holdToFireMs: number;
  readonly #gestures = new Map<number, AimGesture>();

  #firing = false;
  #disposed = false;

  constructor(options: AimPadOptions) {
    this.#zone = options.zone;
    this.#onAim = options.onAim;
    this.#onFireChange = options.onFireChange;
    this.#holdToFireMs = Math.max(0, options.holdToFireMs ?? 0);

    this.#zone.addEventListener(
      'pointerdown',
      this.#handlePointerDown,
      NON_PASSIVE,
    );
    this.#zone.addEventListener(
      'pointermove',
      this.#handlePointerMove,
      NON_PASSIVE,
    );
    this.#zone.addEventListener(
      'pointerup',
      this.#handlePointerEnd,
      NON_PASSIVE,
    );
    this.#zone.addEventListener(
      'pointercancel',
      this.#handlePointerEnd,
      NON_PASSIVE,
    );
    this.#zone.addEventListener(
      'lostpointercapture',
      this.#handleLostPointerCapture,
      NON_PASSIVE,
    );
  }

  get firing(): boolean {
    return this.#firing;
  }

  reset(): void {
    const entries = [...this.#gestures.entries()];
    if (entries.length === 0 && !this.#firing) return;

    this.#gestures.clear();
    for (const [pointerId, gesture] of entries) {
      if (gesture.fireTimer !== null) clearTimeout(gesture.fireTimer);
      this.#releaseCapture(pointerId);
    }
    this.#setFiring(false);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.reset();
    this.#zone.removeEventListener('pointerdown', this.#handlePointerDown);
    this.#zone.removeEventListener('pointermove', this.#handlePointerMove);
    this.#zone.removeEventListener('pointerup', this.#handlePointerEnd);
    this.#zone.removeEventListener('pointercancel', this.#handlePointerEnd);
    this.#zone.removeEventListener(
      'lostpointercapture',
      this.#handleLostPointerCapture,
    );
  }

  readonly #handlePointerDown = (event: PointerEvent): void => {
    if (this.#disposed || this.#gestures.size > 0) return;
    if (
      typeof Element !== 'undefined' &&
      event.target instanceof Element &&
      event.target.closest('[data-touch-passthrough]')
    ) {
      return;
    }

    const gesture: AimGesture = { fireTimer: null };
    this.#gestures.set(event.pointerId, gesture);
    this.#emitAim(event);

    if (this.#holdToFireMs === 0) {
      this.#setFiring(true);
    } else {
      gesture.fireTimer = setTimeout(() => {
        gesture.fireTimer = null;
        if (this.#gestures.has(event.pointerId)) this.#setFiring(true);
      }, this.#holdToFireMs);
    }

    try {
      this.#zone.setPointerCapture(event.pointerId);
    } catch {
      // A detached zone may reject capture; release remains idempotent.
    }
    event.preventDefault();
  };

  readonly #handlePointerMove = (event: PointerEvent): void => {
    if (!this.#gestures.has(event.pointerId)) return;
    this.#emitAim(event);
    event.preventDefault();
  };

  readonly #handlePointerEnd = (event: PointerEvent): void => {
    if (!this.#release(event.pointerId)) return;
    this.#releaseCapture(event.pointerId);
    event.preventDefault();
  };

  readonly #handleLostPointerCapture = (event: PointerEvent): void => {
    this.#release(event.pointerId);
  };

  #emitAim(event: PointerEvent): void {
    this.#onAim?.({ clientX: event.clientX, clientY: event.clientY });
  }

  #release(pointerId: number): boolean {
    const gesture = this.#gestures.get(pointerId);
    if (!gesture) return false;

    this.#gestures.delete(pointerId);
    if (gesture.fireTimer !== null) clearTimeout(gesture.fireTimer);
    this.#setFiring(false);
    return true;
  }

  #releaseCapture(pointerId: number): void {
    try {
      if (this.#zone.hasPointerCapture(pointerId)) {
        this.#zone.releasePointerCapture(pointerId);
      }
    } catch {
      // Capture is commonly already gone after iOS emits pointercancel.
    }
  }

  #setFiring(firing: boolean): void {
    if (this.#firing === firing) return;
    this.#firing = firing;
    this.#onFireChange?.(firing);
  }
}
