import type { JoystickConfig, JoystickVector } from '../../core/joystick.ts';
import { AimPad, type AimPadSample } from './AimPad.ts';
import { FloatingJoystick } from './Joystick.ts';
import './touch.css';

export interface TouchButtonSpec {
  readonly id: string;
  /** Short glyph or 1-2 letters. */
  readonly glyph: string;
  readonly label: string;
  /** 'tap' fires once per press; 'hold' reports press and release. */
  readonly mode: 'tap' | 'hold';
}

export interface TouchControlsOptions {
  readonly parent: HTMLElement;
  readonly buttons: readonly TouchButtonSpec[];
  readonly onButton?: (id: string, pressed: boolean) => void;
  readonly onAim?: (sample: AimPadSample) => void;
  readonly onFireChange?: (firing: boolean) => void;
  readonly joystickConfig?: Partial<JoystickConfig>;
}

interface ButtonEntry {
  readonly spec: TouchButtonSpec;
  readonly element: HTMLButtonElement;
}

interface ButtonGesture {
  readonly id: string;
  readonly element: HTMLButtonElement;
  readonly mode: TouchButtonSpec['mode'];
}

const NON_PASSIVE: AddEventListenerOptions = { passive: false };

export class TouchControls {
  readonly #root: HTMLDivElement;
  readonly #joystick: FloatingJoystick;
  readonly #aimPad: AimPad;
  readonly #onButton?: (id: string, pressed: boolean) => void;
  readonly #buttons = new Map<string, ButtonEntry>();
  readonly #buttonGestures = new Map<number, ButtonGesture>();
  readonly #pressed = new Set<string>();
  readonly #buttonCluster: HTMLDivElement;

  #visible = false;
  #disposed = false;

  constructor(options: TouchControlsOptions) {
    this.#onButton = options.onButton;
    this.#root = document.createElement('div');
    this.#root.className = 'touch-controls';
    this.#root.setAttribute('aria-hidden', 'false');

    const joystickZone = document.createElement('div');
    joystickZone.className =
      'touch-controls__zone touch-controls__zone--joystick';
    const aimZone = document.createElement('div');
    aimZone.className = 'touch-controls__zone touch-controls__zone--aim';

    this.#buttonCluster = document.createElement('div');
    this.#buttonCluster.className = 'touch-controls__buttons';
    this.#buttonCluster.setAttribute('data-touch-passthrough', '');
    // A sibling of the zones rather than a child of the aim zone: a zone that
    // carries its own z-index opens a stacking context, and anything nested
    // inside one can never climb past it — which is how the buttons ended up
    // buried under the minimap. Taps still never reach the aim pad, because a
    // press that lands on a button never hits the zone at all.
    this.#root.append(joystickZone, aimZone, this.#buttonCluster);
    options.parent.append(this.#root);

    for (const spec of options.buttons) this.#addButton(spec);

    this.#joystick = new FloatingJoystick({
      parent: this.#root,
      zone: joystickZone,
      config: options.joystickConfig,
    });
    this.#aimPad = new AimPad({
      zone: aimZone,
      onAim: options.onAim,
      onFireChange: options.onFireChange,
    });

    this.#buttonCluster.addEventListener(
      'pointerdown',
      this.#handleButtonDown,
      NON_PASSIVE,
    );
    this.#buttonCluster.addEventListener(
      'pointerup',
      this.#handleButtonEnd,
      NON_PASSIVE,
    );
    this.#buttonCluster.addEventListener(
      'pointercancel',
      this.#handleButtonEnd,
      NON_PASSIVE,
    );
    this.#buttonCluster.addEventListener(
      'lostpointercapture',
      this.#handleButtonLostCapture,
      NON_PASSIVE,
    );

    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this.#handleInterruption);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'visibilitychange',
        this.#handleVisibilityChange,
      );
    }
  }

  /**
   * The overlay root, so the owner can place it in its own stacking order.
   *
   * The zones are full-bleed, so a HUD that renders behind them would become
   * untappable; giving the owner the node lets it put the overlay underneath
   * its panels rather than guessing at a z-index that outranks them all.
   */
  get element(): HTMLElement {
    return this.#root;
  }

  /** Live stick reading, polled once per fixed step by the game. */
  get stick(): JoystickVector {
    return this.#joystick.vector;
  }

  get firing(): boolean {
    return this.#aimPad.firing;
  }

  /** Is a hold-mode button currently down. */
  isPressed(id: string): boolean {
    return this.#pressed.has(id);
  }

  /** Show or hide a button without rebuilding the cluster. */
  setButtonVisible(id: string, visible: boolean): void {
    const entry = this.#buttons.get(id);
    if (!entry) return;
    if (!visible) this.#releaseButton(id);
    entry.element.hidden = !visible;
  }

  setButtonEnabled(id: string, enabled: boolean): void {
    const entry = this.#buttons.get(id);
    if (!entry) return;
    if (!enabled) this.#releaseButton(id);
    entry.element.disabled = !enabled;
  }

  /** Cooldown sweep from ready (0) to fully covered (1). */
  setButtonCooldown(id: string, fraction: number): void {
    const entry = this.#buttons.get(id);
    if (!entry) return;
    const finiteFraction = Number.isFinite(fraction) ? fraction : 0;
    const cooldown = Math.min(1, Math.max(0, finiteFraction));
    entry.element.style.setProperty('--cooldown', String(cooldown));
  }

  setVisible(visible: boolean): void {
    if (this.#visible === visible) return;
    this.#visible = visible;
    this.#joystick.setVisible(visible);
    if (visible) {
      this.#root.setAttribute('data-touch', 'on');
    } else {
      this.reset();
      this.#root.removeAttribute('data-touch');
    }
  }

  /** Drop every in-flight gesture. Safe to call repeatedly from lifecycle hooks. */
  reset(): void {
    this.#joystick.reset();
    this.#aimPad.reset();
    if (this.#buttonGestures.size === 0 && this.#pressed.size === 0) return;

    const gestures = [...this.#buttonGestures.entries()];
    this.#buttonGestures.clear();
    const pressed = [...this.#pressed];
    this.#pressed.clear();
    for (const id of pressed) {
      this.#buttons.get(id)?.element.setAttribute('aria-pressed', 'false');
      this.#onButton?.(id, false);
    }
    for (const [pointerId, gesture] of gestures) {
      this.#releaseButtonCapture(gesture.element, pointerId);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.reset();
    this.#joystick.dispose();
    this.#aimPad.dispose();
    this.#buttonCluster.removeEventListener(
      'pointerdown',
      this.#handleButtonDown,
    );
    this.#buttonCluster.removeEventListener('pointerup', this.#handleButtonEnd);
    this.#buttonCluster.removeEventListener(
      'pointercancel',
      this.#handleButtonEnd,
    );
    this.#buttonCluster.removeEventListener(
      'lostpointercapture',
      this.#handleButtonLostCapture,
    );
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this.#handleInterruption);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener(
        'visibilitychange',
        this.#handleVisibilityChange,
      );
    }
    this.#root.remove();
  }

  #addButton(spec: TouchButtonSpec): void {
    if (this.#buttons.has(spec.id)) {
      throw new Error(`Duplicate touch button id: ${spec.id}`);
    }

    const button = document.createElement('button');
    button.className = 'touch-button';
    button.type = 'button';
    button.setAttribute('aria-label', spec.label);
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('data-touch-passthrough', '');
    button.dataset.touchButton = spec.id;
    button.style.setProperty('--cooldown', '0');

    const glyph = document.createElement('span');
    glyph.className = 'touch-button__glyph';
    glyph.textContent = spec.glyph;
    const cooldown = document.createElement('span');
    cooldown.className = 'touch-button__cooldown';
    cooldown.setAttribute('aria-hidden', 'true');
    button.append(glyph, cooldown);
    this.#buttonCluster.append(button);
    this.#buttons.set(spec.id, { spec, element: button });
  }

  readonly #handleButtonDown = (event: PointerEvent): void => {
    const button = this.#buttonFromTarget(event.target);
    if (
      !button ||
      button.disabled ||
      this.#buttonGestures.has(event.pointerId)
    ) {
      return;
    }
    const id = button.dataset.touchButton;
    if (id === undefined) return;
    const entry = this.#buttons.get(id);
    if (!entry) return;

    this.#buttonGestures.set(event.pointerId, {
      id,
      element: button,
      mode: entry.spec.mode,
    });
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // The pointer still gets an idempotent release if capture is unavailable.
    }

    if (entry.spec.mode === 'tap') {
      this.#onButton?.(id, true);
    } else if (!this.#pressed.has(id)) {
      this.#pressed.add(id);
      button.setAttribute('aria-pressed', 'true');
      this.#onButton?.(id, true);
    }
    event.preventDefault();
  };

  readonly #handleButtonEnd = (event: PointerEvent): void => {
    if (!this.#releaseButtonPointer(event.pointerId)) return;
    event.preventDefault();
  };

  readonly #handleButtonLostCapture = (event: PointerEvent): void => {
    this.#releaseButtonPointer(event.pointerId);
  };

  readonly #handleInterruption = (): void => {
    this.reset();
  };

  readonly #handleVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') this.reset();
  };

  #buttonFromTarget(target: EventTarget | null): HTMLButtonElement | null {
    if (!(target instanceof Element)) return null;
    const button = target.closest<HTMLButtonElement>('[data-touch-button]');
    return button instanceof HTMLButtonElement ? button : null;
  }

  #releaseButtonPointer(pointerId: number): boolean {
    const gesture = this.#buttonGestures.get(pointerId);
    if (!gesture) return false;
    this.#buttonGestures.delete(pointerId);

    if (
      gesture.mode === 'hold' &&
      ![...this.#buttonGestures.values()].some(
        (candidate) => candidate.id === gesture.id,
      )
    ) {
      this.#pressed.delete(gesture.id);
      gesture.element.setAttribute('aria-pressed', 'false');
      this.#onButton?.(gesture.id, false);
    }
    this.#releaseButtonCapture(gesture.element, pointerId);
    return true;
  }

  #releaseButton(id: string): void {
    const pointers = [...this.#buttonGestures.entries()].filter(
      ([, gesture]) => gesture.id === id,
    );
    for (const [pointerId] of pointers) {
      this.#releaseButtonPointer(pointerId);
    }
  }

  #releaseButtonCapture(element: HTMLButtonElement, pointerId: number): void {
    try {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    } catch {
      // Capture may already be gone after cancellation or a hidden button.
    }
  }
}
