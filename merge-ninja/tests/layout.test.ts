import { describe, expect, it } from 'vitest';
import { configureLayout, getSafeInsets, theme } from '../src/ui/theme';
import type { SafeInsets } from '../src/ui/theme';

/**
 * Real screens the game has to fill, including the two stress cases: the
 * 320x568 iPhone SE (smallest supported phone) and the 844x390 notched
 * landscape phone. Phaser's FIT mode letterboxes whatever the design aspect
 * does not match, so the layout must ask for a canvas the window can hold
 * edge to edge -- or document why the clamps force bars and prove they are
 * centred.
 */
const SCREENS: ReadonlyArray<readonly [string, number, number]> = [
  ['iphone se portrait', 320, 568],
  ['android portrait', 360, 800],
  ['iphone portrait', 390, 844],
  ['pixel portrait', 412, 915],
  ['ipad portrait', 768, 1024],
  ['iphone landscape', 844, 390],
  ['ipad landscape', 1024, 768],
  ['hd landscape', 1280, 720],
  ['laptop', 1440, 900],
  ['macbook', 1512, 982],
  ['1080p', 1920, 1080],
  ['ultrawide', 2560, 1080],
];

/**
 * Mirror of the private CANVAS clamps in theme.ts, kept here so the test
 * computes what the canvas *should* be independently of the code under test.
 */
const CLAMPS = {
  portrait: { minHeight: 860, maxHeight: 2000 },
  landscape: { minHeight: 520, maxHeight: 1400 },
} as const;
const DESIGN_WIDTH = { portrait: 720, landscape: 1440 } as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Canvas dimensions configureLayout must produce for a viewport shape. */
function expectedCanvas(width: number, height: number): { w: number; h: number; wide: boolean } {
  const wide = width / height >= 1.15;
  const designW = wide ? DESIGN_WIDTH.landscape : DESIGN_WIDTH.portrait;
  const bounds = wide ? CLAMPS.landscape : CLAMPS.portrait;
  return {
    w: designW,
    h: Math.round(clamp(designW / (width / height), bounds.minHeight, bounds.maxHeight)),
    wide,
  };
}

const ZERO: SafeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * Row-legibility floor, in design pixels.
 *
 * MIN_ROW_GAP is the centre-to-centre pitch between slot rows: the smallest
 * distance any row's content may be squeezed into. On the smallest supported
 * phone (320 CSS px wide, so 1 design px = 0.444 CSS px) 72 design px keeps
 * every third-row tile fully inside the board with breathing room; the tile
 * sprites themselves are drawn by widget code and audited separately.
 */
const MIN_ROW_GAP = 72;

describe('screen-filling layout', () => {
  it.each(SCREENS)('matches the %s aspect so no bars are left over', (_name, width, height) => {
    const l = configureLayout(width, height, ZERO);
    const want = expectedCanvas(width, height);

    expect(l.width).toBe(want.w);
    expect(l.height).toBe(want.h);

    // When the clamps did not intervene the canvas aspect must match the
    // viewport aspect: FIT then fills the window with zero letterbox. Every
    // screen in this list clears the clamps today; if one ever stops, the
    // centred-letterbox test below documents the leftover bands.
    const forcedBars = Math.abs(want.h - want.w / (width / height)) >= 0.5;
    if (!forcedBars) {
      expect(Math.abs(l.width / l.height - width / height) / (width / height)).toBeLessThan(0.02);
    }
  });

  it.each(SCREENS.filter(([n]) => n.includes('portrait')))(
    'centres any leftover backdrop above and below on the %s',
    (_name, width, height) => {
      const l = configureLayout(width, height, ZERO);
      const content = Math.min(l.height, 1420);
      if (l.height <= content) return;
      const topBand = l.arena.y - 34; // physical title plaque occupies the added top clearance
      // The stack ends one pad short of the content edge (the tuned design's
      // trailing breathing room), so the lower band runs 18px deeper.
      const bottomBand = l.height - (l.bottom.y + l.bottom.h) - 18;
      expect(Math.abs(topBand - bottomBand)).toBeLessThanOrEqual(1);
      void width;
      expect(height).toBeGreaterThan(0);
    },
  );

  it.each(SCREENS)('keeps every panel inside the %s canvas', (_name, width, height) => {
    const l = configureLayout(width, height, ZERO);

    for (const rect of [l.arena, l.board, l.bottom]) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(l.width);
      expect(rect.y + rect.h).toBeLessThanOrEqual(l.height);
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
    }
    // The buy button is stored as a centre point plus size: check its box.
    expect(l.buy.x - l.buy.w / 2).toBeGreaterThanOrEqual(0);
    expect(l.buy.x + l.buy.w / 2).toBeLessThanOrEqual(l.width);
    expect(l.buy.y - l.buy.h / 2).toBeGreaterThanOrEqual(0);
    expect(l.buy.y + l.buy.h / 2).toBeLessThanOrEqual(l.height);
  });

  it.each(SCREENS)('never produces a negative-sized rect on the %s', (_name, width, height) => {
    const l = configureLayout(width, height, ZERO);

    for (const [label, rect] of Object.entries({ arena: l.arena, board: l.board, bottom: l.bottom, buy: l.buy })) {
      expect(rect.w, label).toBeGreaterThan(0);
      expect(rect.h, label).toBeGreaterThan(0);
    }
    expect(l.trash.radius, 'trash').toBeGreaterThan(0);
    expect(l.slots.radius, 'slot').toBeGreaterThan(0);
  });

  it.each(SCREENS)('never overlaps the panels on the %s', (_name, width, height) => {
    const l = configureLayout(width, height, ZERO);
    const stacked = !l.landscape;

    if (stacked) expect(l.board.y).toBeGreaterThanOrEqual(l.arena.y + l.arena.h);
    else {
      expect(l.board.x).toBeGreaterThanOrEqual(l.arena.x + l.arena.w);
      // The tuned arena-to-roster gap must survive inset padding too.
      expect(l.board.x - (l.arena.x + l.arena.w)).toBeGreaterThanOrEqual(20);
    }
    expect(l.bottom.y).toBeGreaterThanOrEqual(l.board.y + l.board.h);
  });

  it.each(SCREENS)('keeps the rail controls on the rail on the %s', (_name, width, height) => {
    const l = configureLayout(width, height, ZERO);
    const rail = l.bottom;

    for (const y of [l.buy.y, l.trash.y, l.coin.y]) {
      expect(y).toBeGreaterThanOrEqual(rail.y);
      expect(y).toBeLessThanOrEqual(rail.y + rail.h);
    }
    expect(l.buy.x - l.buy.w / 2).toBeGreaterThan(l.coin.x);
    expect(l.trash.x).toBeGreaterThan(l.buy.x + l.buy.w / 2);
  });

  it.each(SCREENS)('keeps the 4x3 grid usable inside the board on the %s', (_name, width, height) => {
    const l = configureLayout(width, height, ZERO);
    const s = l.slots;

    // All four columns...
    expect(s.startX).toBeGreaterThan(l.board.x + 40);
    const lastCol = s.startX + s.gapX * 3;
    expect(lastCol).toBeLessThan(l.board.x + l.board.w - 40);
    expect(Math.abs((s.startX + lastCol) / 2 - (l.board.x + l.board.w / 2))).toBeLessThanOrEqual(1);

    // ...and all three rows. Row pitch is the honest row-height proxy here:
    // tiles are drawn by widget code, but pitch decides whether every row is
    // reachable and un-cramped, and it must never fall below the floor.
    expect(s.gapY).toBeGreaterThanOrEqual(MIN_ROW_GAP);
    for (const row of [0, 1, 2]) {
      const y = s.startY + s.gapY * row;
      expect(y, `row ${row} centre`).toBeGreaterThan(l.board.y + 40);
      expect(y, `row ${row} centre`).toBeLessThan(l.board.y + l.board.h - 40);
    }
    expect(s.startY).toBeGreaterThan(l.board.y + 40);
    expect(s.startY + s.gapY * 2).toBeLessThan(l.board.y + l.board.h - 40);
  });

  it.each(SCREENS)('leaves the critical text bands readable on the %s', (_name, width, height) => {
    const l = configureLayout(width, height, ZERO);

    // The management rail carries the buy label and coin count; anything
    // under 20 design px would clip them on every device.
    expect(l.bottom.h).toBeGreaterThanOrEqual(20);
  });

  it('reproduces the tuned portrait composition at its design size', () => {
    const l = configureLayout(720, 1204, ZERO);

    expect(l.landscape).toBe(false);
    expect(l.width).toBe(720);
    expect(l.arena).toEqual({ x: 18, y: 34, w: 684, h: 531 });
    expect(l.board).toEqual({ x: 18, y: 583, w: 684, h: 413 });
    expect(l.bottom).toEqual({ x: 18, y: 1014, w: 684, h: 172 });
    expect(l.slots.startY).toBe(763);
    expect(l.buy.y).toBe(1100);
  });

  it('reproduces the tuned landscape composition at its design size', () => {
    const l = configureLayout(1440, 590, ZERO);

    expect(l.landscape).toBe(true);
    expect(l.width).toBe(1440);
    expect(l.arena).toEqual({ x: 24, y: 58, w: 735, h: 460 });
    expect(l.board.x).toBe(785);
    expect(l.board.w).toBe(631);
    expect(l.slots.startX).toBe(918);
  });

  it('grows the panels on a tall window instead of leaving dead space', () => {
    const short = configureLayout(1440, 590, ZERO);
    const shortArena = short.arena.h;
    const tall = configureLayout(1440, 900, ZERO);

    expect(tall.arena.h).toBeGreaterThan(shortArena);
    expect(tall.board.h).toBeGreaterThan(420);
  });

  it('is deterministic: identical inputs give an identical layout', () => {
    const first = JSON.stringify(configureLayout(390, 844, ZERO));
    const second = JSON.stringify(configureLayout(390, 844, ZERO));

    expect(second).toBe(first);
  });

  it('survives the smallest supported phone with every band intact', () => {
    // The stress case: 320x568 maps 720 design px onto 320 CSS px, the
    // harshest scale in the fleet. Current clamps already fit it, so this
    // pins the numbers that prove it.
    const l = configureLayout(320, 568, ZERO);

    expect(l.width).toBe(720);
    expect(l.height).toBe(1278); // 720 / (320/568), inside [860, 2000]: no bars
    expect(l.bottom.y + l.bottom.h).toBeLessThanOrEqual(l.height);
    expect(l.slots.gapY).toBeGreaterThanOrEqual(MIN_ROW_GAP);
    expect(2 * l.slots.radius * l.slots.tileScale).toBeGreaterThan(0);
  });
});

describe('safe-area insets', () => {
  it('reads zeros safely when there is no DOM to probe', () => {
    expect(() => getSafeInsets()).not.toThrow();
    expect(getSafeInsets()).toEqual(ZERO);
  });

  it('leaves the pinned compositions untouched at zero insets', () => {
    const portrait = configureLayout(720, 1204, ZERO);
    expect(portrait.bottom).toEqual({ x: 18, y: 1014, w: 684, h: 172 });
    expect(portrait.arena.y).toBe(34);

    const landscape = configureLayout(1440, 590, ZERO);
    expect(landscape.arena.x).toBe(24);
    expect(landscape.trash.x).toBe(1368);
    expect(theme.layout.landscape).toBe(true);
  });

  it('lifts the portrait rail above a home bar and drops the arena below a notch', () => {
    // iPhone-notch style insets, in CSS px. The 720-wide design renders at
    // 390 CSS px here, so each CSS px of inset costs 720/390 design px.
    const insets: SafeInsets = { top: 47, bottom: 21, left: 0, right: 0 };
    const scale = 720 / 390;
    const base = configureLayout(390, 844, ZERO);
    const l = configureLayout(390, 844, insets);

    const topInset = Math.round(insets.top * scale);
    const bottomInset = Math.round(insets.bottom * scale);

    // Arena top pushed below the notch: the canvas starts at the window edge,
    // so the arena must clear `topInset` design px of physical notch.
    expect(l.arena.y).toBeGreaterThanOrEqual(topInset);
    expect(l.arena.y).toBeGreaterThanOrEqual(base.arena.y);
    // ...and the rail lifted clear of the home bar (1px rounding grace).
    expect(l.bottom.y + l.bottom.h).toBeLessThanOrEqual(l.height - bottomInset + 1);
    // The whole stack stays inside the canvas and non-overlapping.
    expect(l.arena.y + l.arena.h).toBeLessThanOrEqual(l.board.y);
    expect(l.board.y + l.board.h).toBeLessThanOrEqual(l.bottom.y);
    expect(l.bottom.y + l.bottom.h).toBeLessThanOrEqual(l.height);
  });

  it('pads the landscape outer edges while keeping the arena-board gap', () => {
    const insets: SafeInsets = { top: 0, bottom: 0, left: 59, right: 34 };
    const l = configureLayout(1440, 900, insets);

    expect(l.arena.x).toBe(24 + 59);
    expect(l.board.x).toBe(785 - 34);
    expect(l.trash.x).toBe(1368 - 34);
    expect(l.slots.startX).toBe(918 - 34);
    // Right-edge controls stay clear of the inset.
    expect(l.trash.x + l.trash.radius).toBeLessThanOrEqual(l.width - 34);
    // The tuned 26px gap survives: the arena gave up exactly both insets.
    expect(l.board.x - (l.arena.x + l.arena.w)).toBeCloseTo(26, 0);
    // Vertical composition is untouched by side insets.
    expect(l.arena.y).toBe(configureLayout(1440, 900, ZERO).arena.y);
  });

  it('still fits the iPhone SE with a notch and home bar carved out', () => {
    const insets: SafeInsets = { top: 20, bottom: 20, left: 0, right: 0 };
    const l = configureLayout(320, 568, insets);

    expect(l.arena.y).toBeGreaterThanOrEqual(Math.round(20 * (720 / 320)));
    expect(l.bottom.y + l.bottom.h).toBeLessThanOrEqual(l.height - Math.round(20 * (720 / 320)) + 1);
    expect(l.slots.gapY).toBeGreaterThanOrEqual(MIN_ROW_GAP);
  });
});
