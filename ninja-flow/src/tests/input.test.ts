import { describe, expect, it } from 'vitest';
import { INPUT } from '../config';
import { InputManager, type Lane } from '../input/InputManager';

function surface(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  // jsdom gives every element a zero-sized box, so the lane split needs a real
  // one: the manager reads clientX against the surface's own rectangle.
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0 }) as DOMRect;
  document.body.append(canvas);
  return canvas;
}

function tap(canvas: HTMLElement, clientX: number, init: PointerEventInit = {}): void {
  // jsdom has no PointerEvent constructor; a MouseEvent carries every field the
  // handler reads, and the extra pointer fields are attached by hand.
  const event = new MouseEvent('pointerdown', { clientX, bubbles: true, cancelable: true });
  Object.assign(event, { pointerType: 'touch', isPrimary: true, ...init });
  canvas.dispatchEvent(event);
}

describe('InputManager', () => {
  it('routes a tap to the half of the screen it landed on', () => {
    const canvas = surface();
    const input = new InputManager(canvas);
    input.attach();
    input.setEnabled(true);

    tap(canvas, 40);
    expect(input.consume()?.lane).toBe('left');

    tap(canvas, 360);
    expect(input.consume()?.lane).toBe('right');

    input.detach();
  });

  it('accepts a second finger — two-thumb play is how a phone is held', () => {
    const canvas = surface();
    const input = new InputManager(canvas);
    input.attach();
    input.setEnabled(true);

    // The thumb already resting on the screen owns the primary pointer, so the
    // thumb that actually strikes never has it.
    tap(canvas, 360, { isPrimary: false, pointerId: 3 });

    expect(input.consume()?.lane).toBe('right');
    input.detach();
  });

  it('holds a press for the buffer window instead of dropping it', async () => {
    const canvas = surface();
    const input = new InputManager(canvas);
    input.attach();
    input.setEnabled(true);

    // A press arriving mid-commitment is not consumed by the frames that run
    // while the player is still locked; it must survive until control returns.
    tap(canvas, 40);
    await new Promise((r) => setTimeout(r, INPUT.bufferMs / 2));

    expect(input.consume()?.lane).toBe('left');
    input.detach();
  });

  it('expires a press older than the buffer window', async () => {
    const canvas = surface();
    const input = new InputManager(canvas);
    input.attach();
    input.setEnabled(true);

    tap(canvas, 40);
    await new Promise((r) => setTimeout(r, INPUT.bufferMs + 60));

    expect(input.consume()).toBeNull();
    input.detach();
  });

  it('acknowledges every press at the event, including one that will be buffered', () => {
    const canvas = surface();
    const input = new InputManager(canvas);
    const seen: Lane[] = [];
    input.attach();
    input.setEnabled(true);
    input.setPressListener((lane) => seen.push(lane));

    tap(canvas, 40);
    tap(canvas, 360);

    expect(seen).toEqual(['left', 'right']);
    input.detach();
  });

  it('leaves touch scrolling alone outside the arena surface', () => {
    const canvas = surface();
    const panel = document.createElement('div');
    document.body.append(panel);
    const input = new InputManager(canvas);
    input.attach();

    const onPanel = new Event('touchmove', { bubbles: true, cancelable: true });
    panel.dispatchEvent(onPanel);
    const onArena = new Event('touchmove', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(onArena);

    // A menu list or wardrobe row has to keep its own gestures; the arena
    // itself must never rubber-band.
    expect(onPanel.defaultPrevented).toBe(false);
    expect(onArena.defaultPrevented).toBe(true);
    input.detach();
  });
});
