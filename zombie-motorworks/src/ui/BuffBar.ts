/**
 * Timers for effects the player is currently under, stacked directly above the
 * ability boxes: one draining bar per live effect, in that effect's own colour.
 *
 * Abilities are things you spend and wait for, so their boxes carry a cooldown
 * sweep. These are the opposite — something good that is running out — so they
 * read as a bar emptying rather than a box refilling, and they are not on
 * screen at all when nothing is running.
 *
 * The renderer diffs against what is already up, so a running buff costs no DOM
 * writes on most frames.
 */

/** One live effect, handed to {@link BuffBar.render} once a frame. */
export interface BuffView {
  /** Stable identity for diffing; also the row's order key. */
  id: string;
  /** Short uppercase name, e.g. "COLOSSUS". */
  label: string;
  /** CSS colour for the fill and the label. */
  color: string;
  /** Seconds left. */
  remainingSeconds: number;
  /** Seconds this effect started from, the denominator of the drain. */
  totalSeconds: number;
}

/** Drain steps, so the fill only redraws on visible changes. */
const DRAIN_STEPS = 120;

interface BuffRow {
  readonly root: HTMLDivElement;
  readonly label: HTMLSpanElement;
  readonly timer: HTMLSpanElement;
  readonly fill: HTMLSpanElement;
  id: string;
  lastFraction: number;
  lastTimer: string;
}

export class BuffBar {
  private readonly root: HTMLDivElement;
  private readonly rows: BuffRow[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'survival-buffs';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-label', 'Active effects');
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  /**
   * Draw the effects running right now. Rows are created on demand and reused
   * from then on: an effect that lapses hides its row rather than destroying
   * it, since the same one comes back the next time a crate is taken.
   */
  render(views: readonly BuffView[]): void {
    this.root.hidden = views.length === 0;
    for (let index = 0; index < views.length; index++) {
      const view = views[index];
      const row = this.rows[index] ?? this.createRow();
      this.fillRow(row, view);
    }
    for (let index = views.length; index < this.rows.length; index++) {
      const row = this.rows[index];
      if (row.root.hidden) continue;
      row.root.hidden = true;
      row.id = '';
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private fillRow(row: BuffRow, view: BuffView): void {
    if (row.root.hidden) row.root.hidden = false;
    if (row.id !== view.id) {
      row.id = view.id;
      row.label.textContent = view.label;
      row.root.style.setProperty('--buff-color', view.color);
    }

    const fraction =
      view.totalSeconds <= 0
        ? 0
        : Math.round(
            (Math.min(Math.max(view.remainingSeconds, 0), view.totalSeconds) /
              view.totalSeconds) *
              DRAIN_STEPS,
          ) / DRAIN_STEPS;
    if (fraction !== row.lastFraction) {
      row.lastFraction = fraction;
      row.fill.style.transform = `scaleX(${fraction})`;
    }

    // One decimal: these run for a handful of seconds, and whole seconds would
    // spend a third of a short buff showing the same number.
    const timer = `${Math.max(0, view.remainingSeconds).toFixed(1)}s`;
    if (timer === row.lastTimer) return;
    row.lastTimer = timer;
    row.timer.textContent = timer;
  }

  private createRow(): BuffRow {
    const root = document.createElement('div');
    root.className = 'survival-buff';

    const header = document.createElement('div');
    header.className = 'survival-buff__header';
    const label = document.createElement('span');
    label.className = 'survival-buff__label';
    const timer = document.createElement('span');
    timer.className = 'survival-buff__timer';
    header.append(label, timer);

    const track = document.createElement('div');
    track.className = 'survival-buff__track';
    const fill = document.createElement('span');
    fill.className = 'survival-buff__fill';
    track.appendChild(fill);

    root.append(header, track);
    this.root.appendChild(root);

    const row: BuffRow = {
      root,
      label,
      timer,
      fill,
      id: '',
      // Nothing written yet: -1 can never equal a real fraction, so the first
      // render always states the fill rather than trusting the CSS default.
      lastFraction: -1,
      lastTimer: '',
    };
    this.rows.push(row);
    return row;
  }
}
