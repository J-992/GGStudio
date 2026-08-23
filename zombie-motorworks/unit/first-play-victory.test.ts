/**
 * The two exits off the first-wave celebration.
 *
 * There is no jsdom here, so the card is built against a stand-in element that
 * records only what these assertions need: the class list, the text, and the
 * click listener each button registered. The animations are the component's
 * whole other half and are not testable this way — what is tested is that the
 * player is offered both modes, and that pressing one calls that mode's handler
 * exactly once.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FirstPlayVictory,
  type FirstPlayVictoryHandlers,
} from '../src/survival/FirstPlayVictory.ts';

interface StubElement {
  className: string;
  textContent: string;
  innerHTML: string;
  hidden: boolean;
  disabled: boolean;
  type: string;
  readonly offsetWidth: number;
  readonly children: StubElement[];
  readonly classList: {
    add(...names: string[]): void;
    remove(...names: string[]): void;
    contains(name: string): boolean;
  };
  readonly style: { setProperty(name: string, value: string): void };
  readonly listeners: Map<string, (() => void)[]>;
  append(...nodes: StubElement[]): void;
  appendChild(node: StubElement): StubElement;
  replaceChildren(...nodes: StubElement[]): void;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, run: () => void): void;
  removeEventListener(): void;
  focus(): void;
  remove(): void;
}

function createElement(): StubElement {
  const children: StubElement[] = [];
  const classes = new Set<string>();
  const listeners = new Map<string, (() => void)[]>();
  return {
    className: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    type: '',
    offsetWidth: 0,
    children,
    classList: {
      add(...names) {
        for (const name of names) classes.add(name);
      },
      remove(...names) {
        for (const name of names) classes.delete(name);
      },
      contains: (name) => classes.has(name),
    },
    style: { setProperty() {} },
    listeners,
    append(...nodes) {
      children.push(...nodes);
    },
    appendChild(node) {
      children.push(node);
      return node;
    },
    replaceChildren(...nodes) {
      children.length = 0;
      children.push(...nodes);
    },
    setAttribute() {},
    addEventListener(type, run) {
      const bucket = listeners.get(type) ?? [];
      bucket.push(run);
      listeners.set(type, bucket);
    },
    removeEventListener() {},
    focus() {},
    remove() {},
  };
}

function installDom(): { parent: StubElement; restore(): void } {
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement };
  return {
    parent: createElement(),
    restore() {
      if (previous === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = previous;
      }
    },
  };
}

/** Every button the card built, in the order it built them. */
function buttons(parent: StubElement): StubElement[] {
  const found: StubElement[] = [];
  const walk = (node: StubElement): void => {
    // The variant goes on via `classList`, which this stub keeps apart from
    // `className` — so the base class is an exact match here.
    if (node.className === 'first-play-victory__cta') found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(parent);
  return found;
}

function press(button: StubElement): void {
  button.disabled = false;
  for (const run of button.listeners.get('click') ?? []) run();
}

function build(
  parent: StubElement,
  over: Partial<FirstPlayVictoryHandlers> = {},
): FirstPlayVictory {
  return new FirstPlayVictory(parent as unknown as HTMLElement, {
    onStartRun: vi.fn(),
    ...over,
  });
}

let dom: ReturnType<typeof installDom> | null = null;
afterEach(() => {
  dom?.restore();
  dom = null;
});

describe('first-wave celebration exits', () => {
  it('offers Survival and Creative side by side', () => {
    dom = installDom();
    build(dom.parent, { onCreativeMode: vi.fn() });

    expect(
      buttons(dom.parent).map((button) => button.children[1].textContent),
    ).toEqual(['Survival', 'Creative']);
  });

  it('hands the press to the mode that was chosen', () => {
    dom = installDom();
    const onStartRun = vi.fn();
    const onCreativeMode = vi.fn();
    build(dom.parent, { onStartRun, onCreativeMode });

    press(buttons(dom.parent)[1]);
    expect(onCreativeMode).toHaveBeenCalledTimes(1);
    expect(onStartRun).not.toHaveBeenCalled();

    press(buttons(dom.parent)[0]);
    expect(onStartRun).toHaveBeenCalledTimes(1);
    expect(onCreativeMode).toHaveBeenCalledTimes(1);
  });

  it('drops Creative when the host has no sandbox to offer', () => {
    dom = installDom();
    build(dom.parent);

    expect(buttons(dom.parent)).toHaveLength(1);
  });

  it('takes the card down before the chosen mode tears it apart', () => {
    dom = installDom();
    let visibleInHandler: boolean | null = null;
    const card = build(dom.parent, {
      onCreativeMode: () => {
        visibleInHandler = card.visible;
      },
    });

    press(buttons(dom.parent)[1]);
    expect(visibleInHandler).toBe(false);
  });
});
