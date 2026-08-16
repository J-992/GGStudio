import {
  clampStickOffset,
  DEFAULT_JOYSTICK_CONFIG,
  NEUTRAL_JOYSTICK,
  readJoystick,
  type JoystickConfig,
  type JoystickVector,
} from '../../core/joystick.ts';

export interface JoystickOptions {
  /** Element the stick is drawn into; must be positioned. */
  readonly parent: HTMLElement;
  /** Hit region the stick answers to. Pointers starting outside it are ignored. */
  readonly zone: HTMLElement;
  readonly config?: Partial<JoystickConfig>;
  readonly onChange?: (vector: JoystickVector) => void;
}

interface JoystickGesture {
  readonly originX: number;
  readonly originY: number;
}

const EMIT_EPSILON = 0.0001;
const NON_PASSIVE: AddEventListenerOptions = { passive: false };

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EMIT_EPSILON;
}

function sameVector(a: JoystickVector, b: JoystickVector): boolean {
  return (
    a.active === b.active &&
    nearlyEqual(a.x, b.x) &&
    nearlyEqual(a.y, b.y) &&
    nearlyEqual(a.magnitude, b.magnitude) &&
    nearlyEqual(a.angle, b.angle)
  );
}

/**
 * A stick that stays where it is drawn.
 *
 * It used to spawn under the thumb wherever the left half was touched, which
 * reads well in a demo and badly in a wave: the control the player is steering
 * with was in a different place every time they looked down, and a stick that
 * moves is one more thing to find while something is chewing the front axle.
 * Now CSS parks it in the bottom-left corner and it never leaves, and the zone
 * it answers to is a pad barely wider than the ring itself: a stick that never
 * moves does not need half the screen to be found on, and the screen it gives
 * back is screen the player can shoot at.
 */
export class TouchJoystick {
  readonly #parent: HTMLElement;
  readonly #zone: HTMLElement;
  readonly #config: Partial<JoystickConfig>;
  readonly #radiusPx: number;
  readonly #onChange?: (vector: JoystickVector) => void;
  readonly #root: HTMLDivElement;
  readonly #knob: HTMLDivElement;
  readonly #gestures = new Map<number, JoystickGesture>();

  #vector: JoystickVector = NEUTRAL_JOYSTICK;
  #lastEmitted: JoystickVector = NEUTRAL_JOYSTICK;
  #visible = true;
  #disposed = false;

  constructor(options: JoystickOptions) {
    this.#parent = options.parent;
    this.#zone = options.zone;
    this.#config = options.config ?? {};
    this.#radiusPx =
      Number.isFinite(options.config?.radiusPx) &&
      (options.config?.radiusPx ?? 0) > 0
        ? (options.config?.radiusPx ?? DEFAULT_JOYSTICK_CONFIG.radiusPx)
        : DEFAULT_JOYSTICK_CONFIG.radiusPx;
    this.#onChange = options.onChange;

    this.#root = document.createElement('div');
    this.#root.className = 'touch-joystick';
    this.#root.setAttribute('aria-hidden', 'true');
    // Published on the parent, not on the stick: the hit zone is a *sibling*
    // of the stick, and it has to be sized from the same radius or the pad and
    // the ring it represents drift apart.
    this.#parent.style.setProperty('--joystick-radius', `${this.#radiusPx}px`);

    const base = document.createElement('div');
    base.className = 'touch-joystick__base';
    this.#knob = document.createElement('div');
    this.#knob.className = 'touch-joystick__knob';
    this.#root.append(base, this.#knob);
    this.#parent.append(this.#root);

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

  /** Latest reading; neutral while no thumb is down. */
  get vector(): JoystickVector {
    return this.#vector;
  }

  get engaged(): boolean {
    return this.#gestures.size > 0;
  }

  /** Drop any in-flight gesture and read neutral. */
  reset(): void {
    const pointerIds = [...this.#gestures.keys()];
    if (pointerIds.length === 0) return;

    this.#gestures.clear();
    this.#hideAndNeutralise();
    for (const pointerId of pointerIds) this.#releaseCapture(pointerId);
  }

  setVisible(visible: boolean): void {
    if (this.#visible === visible) return;
    this.#visible = visible;
    this.#root.hidden = !visible;
    if (!visible) this.reset();
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
    this.#root.remove();
  }

  readonly #handlePointerDown = (event: PointerEvent): void => {
    if (!this.#visible || this.#disposed || this.engaged) return;

    // The origin is the base's own centre, not where the thumb landed: the
    // stick does not move to meet the touch, the knob comes to the touch.
    const centre = this.#centre();
    this.#gestures.set(event.pointerId, {
      originX: centre.x,
      originY: centre.y,
    });
    this.#applyGesture(centre, event.clientX, event.clientY);
    this.#root.classList.add('is-engaged');

    try {
      this.#zone.setPointerCapture(event.pointerId);
    } catch {
      // A detached surface can reject capture; end events still clean up safely.
    }
    event.preventDefault();
  };

  readonly #handlePointerMove = (event: PointerEvent): void => {
    const gesture = this.#gestures.get(event.pointerId);
    if (!gesture) return;

    this.#applyGesture(
      { x: gesture.originX, y: gesture.originY },
      event.clientX,
      event.clientY,
    );
    event.preventDefault();
  };

  readonly #handlePointerEnd = (event: PointerEvent): void => {
    if (!this.#gestures.delete(event.pointerId)) return;

    this.#hideAndNeutralise();
    this.#releaseCapture(event.pointerId);
    event.preventDefault();
  };

  readonly #handleLostPointerCapture = (event: PointerEvent): void => {
    if (!this.#gestures.delete(event.pointerId)) return;
    this.#hideAndNeutralise();
  };

  #releaseCapture(pointerId: number): void {
    try {
      if (this.#zone.hasPointerCapture(pointerId)) {
        this.#zone.releasePointerCapture(pointerId);
      }
    } catch {
      // Capture may already be gone after pointercancel or a DOM removal.
    }
  }

  /** Centre of the base in client coordinates; the root is a zero-sized point. */
  #centre(): { x: number; y: number } {
    const rect = this.#root.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }

  /** Read the stick for one pointer sample and move the knob to match. */
  #applyGesture(
    origin: { x: number; y: number },
    clientX: number,
    clientY: number,
  ): void {
    const vector = readJoystick(
      origin.x,
      origin.y,
      clientX,
      clientY,
      this.#config,
    );
    const offset = clampStickOffset(
      origin.x,
      origin.y,
      clientX,
      clientY,
      this.#radiusPx,
    );
    this.#knob.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0)`;
    this.#emit(vector);
  }

  #hideAndNeutralise(): void {
    this.#root.classList.remove('is-engaged');
    this.#knob.style.transform = 'translate3d(0px, 0px, 0)';
    this.#vector = NEUTRAL_JOYSTICK;
    this.#lastEmitted = NEUTRAL_JOYSTICK;
    this.#onChange?.(NEUTRAL_JOYSTICK);
  }

  #emit(vector: JoystickVector): void {
    this.#vector = vector;
    if (sameVector(vector, this.#lastEmitted)) return;

    this.#lastEmitted = vector;
    this.#onChange?.(vector);
  }
}
