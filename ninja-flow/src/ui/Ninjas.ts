import type { CharacterId } from '../config';

/**
 * The roster's identity, in one place.
 *
 * The icons used to be emoji, which meant every player saw a slightly
 * different game: 🦊 is a different animal on Android, on iOS and on Windows,
 * and none of them match a ninja. These are drawn instead — one silhouette
 * built from the same head, visor and ear vocabulary, so the four read as a
 * set and pick up the theme's colours from CSS.
 */

export interface NinjaMeta {
  readonly name: string;
  readonly blurb: string;
  /** Drives the card's glow, so each ninja owns a colour as well as a shape. */
  readonly accent: string;
  readonly mark: string;
}

const head = (ears: string) => `
  <svg viewBox="0 0 24 24" class="mark" aria-hidden="true">
    ${ears}
    <path class="mark__hood" d="M5.6 11.4c0-3.7 2.7-6.4 6.4-6.4s6.4 2.7 6.4 6.4c0 4.3-2.9 7.7-6.4 7.7s-6.4-3.4-6.4-7.7z"/>
    <rect class="mark__visor" x="5.7" y="10.1" width="12.6" height="3.6" rx="1.8"/>
    <rect class="mark__eye" x="8.1" y="11.2" width="2.5" height="1.5" rx="0.7"/>
    <rect class="mark__eye" x="13.4" y="11.2" width="2.5" height="1.5" rx="0.7"/>
  </svg>`;

export const NINJA_META: Record<CharacterId, NinjaMeta> = {
  fox: {
    name: 'KITSUNE',
    blurb: 'The starter. Quick, balanced, sharp.',
    accent: '#ff9d5c',
    mark: head(`
      <path class="mark__ear" d="M6.6 8.4 5.2 2.9l4.6 3.1z"/>
      <path class="mark__ear" d="M17.4 8.4 18.8 2.9l-4.6 3.1z"/>`),
  },
  cat: {
    name: 'NEKO',
    blurb: 'Light on her feet and hard to read.',
    accent: '#ff9ddb',
    mark: head(`
      <path class="mark__ear" d="M7.1 8.1 6.4 4.1l3.6 2.3z"/>
      <path class="mark__ear" d="M16.9 8.1 17.6 4.1l-3.6 2.3z"/>
      <path class="mark__whisker" d="M3.2 14.2h2.6M18.2 14.2h2.6"/>`),
  },
  bunny: {
    name: 'USAGI',
    blurb: 'Fast hands, faster footwork.',
    accent: '#8fe3ff',
    mark: head(`
      <path class="mark__ear" d="M9 7.6c-1.1-2.2-1.3-4.6-.4-6.4.9.5 2 2.5 2.3 5.2z"/>
      <path class="mark__ear" d="M15 7.6c1.1-2.2 1.3-4.6.4-6.4-.9.5-2 2.5-2.3 5.2z"/>`),
  },
  masked: {
    name: 'ONI',
    blurb: 'Heavy strikes. Nothing subtle about it.',
    accent: '#b47cff',
    mark: head(`
      <path class="mark__horn" d="M7.4 7.3C6.2 5.6 5.6 4 5.7 2.4c1.5.7 2.8 2.2 3.5 4.1z"/>
      <path class="mark__horn" d="M16.6 7.3c1.2-1.7 1.8-3.3 1.7-4.9-1.5.7-2.8 2.2-3.5 4.1z"/>
      <path class="mark__whisker" d="M9.4 16.6h5.2"/>`),
  },
};

/** The locked-slot mark: the same head, blanked out, with a lock over it. */
export const LOCKED_MARK = `
  <svg viewBox="0 0 24 24" class="mark mark--locked" aria-hidden="true">
    <path class="mark__hood" d="M5.6 11.4c0-3.7 2.7-6.4 6.4-6.4s6.4 2.7 6.4 6.4c0 4.3-2.9 7.7-6.4 7.7s-6.4-3.4-6.4-7.7z"/>
    <path class="mark__lockBody" d="M9 11.6h6v5.2H9z"/>
    <path class="mark__lockShackle" d="M10.3 11.6V10a1.7 1.7 0 0 1 3.4 0v1.6"/>
  </svg>`;
