type Rect = { x: number; y: number; w: number; h: number };

type Layout = {
  width: number;
  height: number;
  landscape: boolean;
  arena: Rect;
  board: Rect;
  bottom: Rect;
  charScale: number;
  arenaNinjaHeight: number;
  /**
   * Boss presence target: the geometric mean of the drawn frame, not a literal
   * height. Bosses must read as clearly heavier than the roster fighting them.
   */
  bossHeight: number;
  enemy: { x: number; y: number };
  champion: { x: number; y: number };
  groundY: number;
  enemyHpY: number;
  championHpY: number;
  damageY: { enemy: number; champion: number };
  bannerY: number;
  promptY: number;
  slots: {
    startX: number;
    startY: number;
    gapX: number;
    gapY: number;
    radius: number;
    snapRadius: number;
    spriteScale: number;
    tileScale: number;
  };
  buy: { x: number; y: number; w: number; h: number };
  trash: { x: number; y: number; radius: number };
  /** The book button that opens the almanac, pinned to the roster panel. */
  almanac: { x: number; y: number };
  /** The gear button that opens settings, sat beside the book. */
  settings: { x: number; y: number };
  /** The star button that opens the achievements page, third on the rail. */
  achievements: { x: number; y: number };
  /**
   * Where the ascension offer appears when it is earned: the last button on
   * the same rail as the book, the gear and the achievements star.
   *
   * It sits at the end deliberately. The offer only exists once a run has
   * outlived its ladder, so anywhere earlier would leave a hole in the rail
   * for every player who has not earned it yet.
   */
  ascension: { x: number; y: number };
  coin: { x: number; y: number };
};

const colors = {
  background: 0x101822,
  skyTop: 0x8fd3f0,
  skyHorizon: 0xcfeaf5,
  groundEarth: 0xd9a86c,
  groundShade: 0xb9843f,
  matStraw: 0xe8cf94,
  matBorder: 0xc9a25f,
  bambooLight: 0x6fbf52,
  bambooDark: 0x4f9c3a,
  bannerRed: 0xd64541,
  bannerDark: 0xb3332f,
  board: 0xa5714a,
  plankLine: 0x8a5c3a,
  slot: 0xc99a6b,
  slotStroke: 0x8a5c3a,
  bottomBar: 0x7d5233,
  panel: 0x8a5c3a,
  slotActive: 0xffd23f,
  text: '#ffffff',
  textDark: '#2b2118',
  muted: '#2b2118',
  coin: 0xffd23f,
  buy: 0x45b93d,
  buyDisabled: 0x8d968c,
  trash: 0xd64541,
  health: 0x57c94e,
  enemyHealth: 0xd64541,
  shadow: 0x2b1d12,
} as const;

const font = {
  tiny: '17px sans-serif',
  small: '17px sans-serif',
  body: '17px sans-serif',
  title: '17px sans-serif',
  big: '17px sans-serif',
} as const;

export const theme: { colors: typeof colors; font: typeof font; layout: Layout } = {
  colors,
  font,
  layout: {
    width: 720,
    height: 1204,
    landscape: false,
    arena: { x: 18, y: 18, w: 684, h: 540 },
    board: { x: 18, y: 576, w: 684, h: 420 },
    bottom: { x: 18, y: 1014, w: 684, h: 172 },
    charScale: 0.8,
    arenaNinjaHeight: 108,
    bossHeight: 212,
    enemy: { x: 510, y: 362 },
    champion: { x: 272, y: 422 },
    groundY: 504,
    enemyHpY: 126,
    championHpY: 0,
    damageY: { enemy: 270, champion: 390 },
    bannerY: 292,
    promptY: 390,
    slots: { startX: 168, startY: 758, gapX: 128, gapY: 92, radius: 62, snapRadius: 74, spriteScale: 0.78, tileScale: 1.25 },
    buy: { x: 382, y: 1100, w: 230, h: 92 },
    trash: { x: 628, y: 1100, radius: 34 },
    almanac: { x: 70, y: 638 },
    settings: { x: 132, y: 638 },
    achievements: { x: 194, y: 638 },
    ascension: { x: 256, y: 638 },
    coin: { x: 90, y: 1100 },
  },
};

/** Compact whole-number labels keep late-game HUD values inside their plates. */
export function compactNumber(value: number): string {
  const amount = Math.max(0, Math.round(value));
  if (amount < 1_000) return String(amount);

  const suffixes: ReadonlyArray<readonly [number, string]> = [
    [1_000_000_000_000, 'T'],
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K'],
  ];
  const suffix = suffixes.find(([base]) => amount >= base);
  if (suffix === undefined) return String(amount);

  const [base, label] = suffix;
  const scaled = amount / base;
  const precision = scaled >= 100 ? 0 : 1;
  return `${scaled.toFixed(precision).replace(/\.0$/, '')}${label}`;
}

/**
 * Design widths. The horizontal composition is hand-tuned at exactly these
 * numbers and never changes; only the height follows the window.
 */
const DESIGN_WIDTH = { portrait: 720, landscape: 1440 } as const;

/**
 * How tall a canvas the design will ask for, and how much of it the panels are
 * allowed to occupy.
 *
 * Phaser scales the canvas with FIT, so any design whose aspect differs from
 * the window's is letterboxed -- the black bands that used to eat a third of
 * the screen. The fix is to ask for a canvas of exactly the window's shape and
 * then let the backdrop cover all of it. The panels grow into the extra room up
 * to `maxContent`, and anything past that becomes centred dojo backdrop rather
 * than a stretched-out board.
 */
const CANVAS = {
  portrait: { minHeight: 860, maxHeight: 2000, maxContent: 1420 },
  landscape: { minHeight: 520, maxHeight: 1400, maxContent: 720 },
} as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** How much of the screen the OS keeps for notches and home bars, in CSS px. */
export interface SafeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Element index.html renders purely so env() has a home to resolve into. */
const SAFE_PROBE_ID = 'safe-probe';

const ZERO_INSETS: SafeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

const pxValue = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * Reads the OS safe-area insets out of CSS env().
 *
 * The probe element carries a padding of exactly the four env() values;
 * computed style then reports them as pixels. Browsers without env() (and
 * test runners without a document at all) fall back to zeros, never throw.
 */
export function getSafeInsets(): SafeInsets {
  if (typeof document === 'undefined') return { ...ZERO_INSETS };
  try {
    const existing = document.getElementById(SAFE_PROBE_ID);
    const detached = existing === null;
    const probe = existing ?? document.createElement('div');
    probe.id = SAFE_PROBE_ID;
    probe.style.padding =
      'env(safe-area-inset-top) env(safe-area-inset-right) ' +
      'env(safe-area-inset-bottom) env(safe-area-inset-left)';
    if (detached) document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const insets = {
      top: pxValue(style.paddingTop),
      right: pxValue(style.paddingRight),
      bottom: pxValue(style.paddingBottom),
      left: pxValue(style.paddingLeft),
    };
    if (detached) probe.remove();
    return insets;
  } catch {
    return { ...ZERO_INSETS };
  }
}

/** Three rows of slots have to stay readable, so the board never gives up more. */
const MIN_BOARD_HEIGHT = 360;

/**
 * Where the three slot rows sit inside a board panel of any height.
 *
 * The rows hang below the panel's centre to leave the title plate its space,
 * exactly as the hand-placed design does; `drop` and `gap` are the tuned
 * design's own proportions.
 */
function slotRows(boardY: number, boardH: number, drop: number, gapShare: number): { startY: number; gapY: number } {
  const gapY = Math.round(clamp(boardH * gapShare, 76, 130));
  const middle = boardY + boardH / 2 + Math.round(boardH * drop);
  return { startY: Math.round(middle - gapY), gapY };
}

/**
 * The wide layout mirrors the reference: a compact arena on the left and a
 * 4x3 roster plus a shallow management rail on the right.
 *
 * Every vertical number is derived from the panel it belongs to, as a share of
 * the tuned composition, so the design sizes below reproduce the hand-placed
 * originals exactly and every other window shape interpolates from them.
 */
/**
 * Derives the whole layout for a viewport shape.
 *
 * Deterministic and pure for a given (w, h, insets): the only environment
 * access is the lazy `insets` default, so tests pass insets explicitly.
 *
 * Insets carve the notch and home bar out of the composition without changing
 * the canvas aspect (Phaser FIT still matches the window edge to edge):
 * - portrait: the top band starts below the notch and the bottom rail is
 *   lifted above the home bar; the board keeps its share of what is left.
 * - landscape: the left and right edges pad inward by their insets; the
 *   arena-to-board gap is preserved.
 * Zero insets reproduce the tuned compositions exactly.
 */
export function configureLayout(viewWidth: number, viewHeight: number, insets: SafeInsets = getSafeInsets()): Layout {
  const aspect = Math.max(0.2, viewWidth / Math.max(1, viewHeight));
  const wide = aspect >= 1.15;
  const l = theme.layout;

  if (wide) {
    const width = DESIGN_WIDTH.landscape;
    const height = Math.round(clamp(width / aspect, CANVAS.landscape.minHeight, CANVAS.landscape.maxHeight));
    // FIT stretches the design canvas over the window, so one CSS px of notch
    // costs `scaleUp` design px of clearance.
    const scaleUp = width / Math.max(1, viewWidth);
    // The composition sits centred in the canvas; the rest is open backdrop.
    const content = Math.min(height, CANVAS.landscape.maxContent);
    const top = Math.round((height - content) / 2);
    const left = Math.round(insets.left * scaleUp);
    const right = Math.round(insets.right * scaleUp);

    const bottom = { x: 785 - right, y: top + content - 83, w: 631, h: 70 };
    const board = { x: 785 - right, y: top + 76, w: 631, h: bottom.y - (top + 76) - 11 };
    // The arena gives up exactly the padded amount on both sides so the gap
    // between it and the roster column stays at the tuned 26px.
    const arena = { x: 24 + left, y: top + 76, w: Math.max(1, 735 - left - right), h: content - 150 };
    const railY = bottom.y + bottom.h / 2;
    const rows = slotRows(board.y, board.h, 0.1571, 0.2333);

    Object.assign(l, {
      width,
      height,
      landscape: true,
      arena,
      board,
      bottom,
      charScale: 0.78,
      arenaNinjaHeight: 96,
      bossHeight: 196,
      enemy: { x: 615, y: Math.round(arena.y + arena.h * 0.6182) },
      champion: { x: 305, y: Math.round(arena.y + arena.h * 0.7409) },
      groundY: Math.round(arena.y + arena.h * 0.8545),
      enemyHpY: Math.round(arena.y + arena.h * 0.0955),
      championHpY: 0,
      damageY: { enemy: Math.round(arena.y + arena.h * 0.4523), champion: Math.round(arena.y + arena.h * 0.6955) },
      bannerY: Math.round(arena.y + arena.h * 0.4864),
      promptY: Math.round(arena.y + arena.h * 0.6955),
      slots: {
        startX: 918 - right,
        startY: rows.startY,
        gapX: 122,
        gapY: rows.gapY,
        radius: 56, snapRadius: 74, spriteScale: 0.78, tileScale: 1.2,
      },
      buy: { x: 1126 - right, y: railY, w: 232, h: 60 },
      trash: { x: 1368 - right, y: railY, radius: 27 },
      almanac: { x: 831 - right, y: board.y + 62 },
      settings: { x: 887 - right, y: board.y + 62 },
      achievements: { x: 943 - right, y: board.y + 62 },
      ascension: { x: 999 - right, y: board.y + 62 },
      coin: { x: 825 - right, y: railY },
    });
  } else {
    const width = DESIGN_WIDTH.portrait;
    const height = Math.round(clamp(width / aspect, CANVAS.portrait.minHeight, CANVAS.portrait.maxHeight));
    const scaleUp = width / Math.max(1, viewWidth);
    // Notch and home bar shrink the drawable stack; zero insets leave the
    // arithmetic byte-identical to the tuned design.
    const topInset = Math.max(0, Math.round(insets.top * scaleUp));
    const bottomInset = Math.max(0, Math.round(insets.bottom * scaleUp));
    const availH = Math.max(400, height - topInset - bottomInset);
    const content = Math.min(availH, CANVAS.portrait.maxContent);
    const top = topInset + Math.round(Math.max(0, availH - content) / 2);

    const pad = 18;
    const railH = Math.round(clamp(content * 0.143, 132, 190));
    const stack = content - pad * 4 - railH;
    // The grid is the one panel that cannot be squeezed: on a short canvas the
    // arena gives up the room instead, since a cropped stage still reads fine.
    const boardH = Math.max(Math.round(stack * 0.4375), MIN_BOARD_HEIGHT);
    const arena = { x: pad, y: top + pad, w: 684, h: stack - boardH };
    const board = { x: pad, y: arena.y + arena.h + pad, w: 684, h: boardH };
    const bottom = { x: pad, y: board.y + board.h + pad, w: 684, h: railH };
    const railY = bottom.y + bottom.h / 2;
    const rows = slotRows(board.y, board.h, 0.1524, 0.219);

    Object.assign(l, {
      width,
      height,
      landscape: false,
      arena,
      board,
      bottom,
      charScale: 0.8,
      arenaNinjaHeight: 108,
      bossHeight: 212,
      enemy: { x: 510, y: Math.round(arena.y + arena.h * 0.637) },
      champion: { x: 272, y: Math.round(arena.y + arena.h * 0.7481) },
      groundY: Math.round(arena.y + arena.h * 0.9),
      enemyHpY: Math.round(arena.y + arena.h * 0.2),
      championHpY: 0,
      damageY: { enemy: Math.round(arena.y + arena.h * 0.4667), champion: Math.round(arena.y + arena.h * 0.6889) },
      bannerY: Math.round(arena.y + arena.h * 0.5074),
      promptY: Math.round(arena.y + arena.h * 0.6889),
      slots: {
        startX: 168,
        startY: rows.startY,
        gapX: 128,
        gapY: rows.gapY,
        radius: 62, snapRadius: 74, spriteScale: 0.78, tileScale: 1.25,
      },
      buy: { x: 382, y: railY, w: 230, h: 92 },
      trash: { x: 628, y: railY, radius: 34 },
      almanac: { x: 70, y: board.y + 62 },
      settings: { x: 132, y: board.y + 62 },
      achievements: { x: 194, y: board.y + 62 },
      ascension: { x: 256, y: board.y + 62 },
      coin: { x: 90, y: railY },
    });
  }

  return l;
}
