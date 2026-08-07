/**
 * The crate-effect timers over the ability boxes. There is no jsdom here, so
 * the bar is driven against a tiny element stand-in that records only what the
 * assertions need: whether a row is up, how far its fill has drained, and what
 * the readout says.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { BuffBar, type BuffView } from '../src/ui/BuffBar.ts';

interface StubElement {
  className: string;
  textContent: string;
  hidden: boolean;
  readonly children: StubElement[];
  readonly style: { transform: string; setProperty(name: string, value: string): void };
  readonly props: Record<string, string>;
  append(...nodes: StubElement[]): void;
  appendChild(node: StubElement): StubElement;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

function createElement(): StubElement {
  const props: Record<string, string> = {};
  const children: StubElement[] = [];
  return {
    className: '',
    textContent: '',
    hidden: false,
    children,
    style: {
      transform: '',
      setProperty(name, value) {
        props[name] = value;
      },
    },
    props,
    append(...nodes) {
      children.push(...nodes);
    },
    appendChild(node) {
      children.push(node);
      return node;
    },
    setAttribute(name, value) {
      props[name] = value;
    },
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

function view(over: Partial<BuffView> = {}): BuffView {
  return {
    id: 'colossus',
    label: 'COLOSSUS',
    color: '#4fa8ff',
    remainingSeconds: 12,
    totalSeconds: 12,
    ...over,
  };
}

/** The bar's own root, and the rows it has built inside it. */
function readBar(parent: StubElement): {
  root: StubElement;
  rows: StubElement[];
} {
  const root = parent.children[0];
  return { root, rows: root.children };
}

let dom: ReturnType<typeof installDom> | null = null;
afterEach(() => {
  dom?.restore();
  dom = null;
});

describe('buff timer bar', () => {
  it('stays off screen while nothing is running', () => {
    dom = installDom();
    const bar = new BuffBar(dom.parent as unknown as HTMLElement);
    const { root } = readBar(dom.parent);

    expect(root.hidden).toBe(true);
    bar.render([]);
    expect(root.hidden).toBe(true);
    expect(root.children).toHaveLength(0);
  });

  it('drains the fill as the effect runs out', () => {
    dom = installDom();
    const bar = new BuffBar(dom.parent as unknown as HTMLElement);

    bar.render([view({ remainingSeconds: 12 })]);
    const { root, rows } = readBar(dom.parent);
    const fill = rows[0].children[1].children[0];
    expect(root.hidden).toBe(false);
    expect(fill.style.transform).toBe('scaleX(1)');

    bar.render([view({ remainingSeconds: 6 })]);
    expect(fill.style.transform).toBe('scaleX(0.5)');

    bar.render([view({ remainingSeconds: 0 })]);
    expect(fill.style.transform).toBe('scaleX(0)');
  });

  it('labels the row, colours it, and counts down in tenths', () => {
    dom = installDom();
    const bar = new BuffBar(dom.parent as unknown as HTMLElement);

    bar.render([view({ remainingSeconds: 4.25 })]);
    const { rows } = readBar(dom.parent);
    const [label, timer] = rows[0].children[0].children;

    expect(label.textContent).toBe('COLOSSUS');
    expect(timer.textContent).toBe('4.3s');
    expect(rows[0].props['--buff-color']).toBe('#4fa8ff');
  });

  it('shows one row per live effect and hides the row an effect vacates', () => {
    dom = installDom();
    const bar = new BuffBar(dom.parent as unknown as HTMLElement);

    bar.render([
      view(),
      view({ id: 'sentry', label: 'SENTRY', color: '#f04a3c', totalSeconds: 5 }),
    ]);
    const { root, rows } = readBar(dom.parent);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !row.hidden)).toBe(true);

    bar.render([view()]);
    expect(rows[0].hidden).toBe(false);
    expect(rows[1].hidden).toBe(true);

    // Rows are reused rather than rebuilt when the effect comes back.
    bar.render([view(), view({ id: 'sentry', label: 'SENTRY' })]);
    expect(root.children).toHaveLength(2);
    expect(rows[1].hidden).toBe(false);
  });

  it('clamps a value past its own total rather than overfilling', () => {
    dom = installDom();
    const bar = new BuffBar(dom.parent as unknown as HTMLElement);

    bar.render([view({ remainingSeconds: 30, totalSeconds: 12 })]);
    const { rows } = readBar(dom.parent);
    expect(rows[0].children[1].children[0].style.transform).toBe('scaleX(1)');
  });
});
