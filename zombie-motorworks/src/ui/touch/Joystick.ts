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
  /** Hit region that spawns the stick. Pointers starting outside it are ignored. */
  readonly zone: HTMLElement;
  readonly config?: Partial<JoystickConfig>;
  readonly onChange?: (vector: JoystickVector) => void;
}

interface JoystickGesture {
  readonly originX: number;
  readonly originY: number;
}

const EMIT_EPSILON = 0.0001;
const EDGE_GUTTER_PX = 12;
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

function clampedCentre(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

export class FloatingJoystick {
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
    this.#root.hidden = true;
    this.#root.setAttribute('aria-hidden', 'true');
    this.#root.style.setProperty('--joystick-radius', `${this.#radiusPx}px`);

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

    const gesture = { originX: event.clientX, originY: event.clientY };
    this.#gestures.set(event.pointerId, gesture);

    const zoneRect = this.#zone.getBoundingClientRect();
    const parentRect = this.#parent.getBoundingClientRect();
    const edgeMargin = this.#radiusPx + EDGE_GUTTER_PX;
    const centreX = clampedCentre(
      event.clientX,
      zoneRect.left + edgeMargin,
      zoneRect.right - edgeMargin,
    );
    const centreY = clampedCentre(
      event.clientY,
      zoneRect.top + edgeMargin,
      zoneRect.bottom - edgeMargin,
    );
    this.#root.style.left = `${centreX - parentRect.left}px`;
    this.#root.style.top = `${centreY - parentRect.top}px`;
    this.#knob.style.transform = 'translate3d(0px, 0px, 0)';
    this.#root.hidden = false;

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

    const vector = readJoystick(
      gesture.originX,
      gesture.originY,
      event.clientX,
      event.clientY,
      this.#config,
    );
    const offset = clampStickOffset(
      gesture.originX,
      gesture.originY,
      event.clientX,
      event.clientY,
      this.#radiusPx,
    );
    this.#knob.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0)`;
    this.#emit(vector);
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

  #hideAndNeutralise(): void {
    this.#root.hidden = true;
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
