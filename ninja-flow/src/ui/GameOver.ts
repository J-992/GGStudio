import { UNLOCKS, type CharacterId } from '../config';
import type { UnlockState } from '../game/Progression';
import { LOCKED_MARK, NINJA_META } from './Ninjas';

export interface GameOverData {
  score: number;
  best: number;
  previousBest: number;
  maxCombo: number;
  flowChains: number;
  unlock: UnlockState;
  newlyUnlocked: CharacterId[];
  selected: CharacterId;
  available: CharacterId[];
}

/**
 * Game-over screen.
 *
 * It exists to answer four questions immediately — how did I do, did I beat my
 * best, how close is the next ninja, how fast can I retry — and then get out of
 * the way. PLAY AGAIN dominates; the roster is secondary and never gates it.
 */
export class GameOverScreen {
  private readonly el: HTMLDivElement;
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly comboEl: HTMLDivElement;
  private readonly flowEl: HTMLDivElement;
  private readonly chaseEl: HTMLDivElement;
  private readonly newEl: HTMLDivElement;
  private readonly unlockLabel: HTMLDivElement;
  private readonly unlockFill: HTMLDivElement;
  private readonly roster: HTMLDivElement;
  private readonly playBtn: HTMLButtonElement;

  private onPlay: (() => void) | null = null;
  private onSelect: ((id: CharacterId) => void) | null = null;
  private onMenu: (() => void) | null = null;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'over';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="over__new"></div>
      <div class="over__score">
        <div class="stat__label">SCORE</div>
        <div class="stat__value" data-score>0</div>
      </div>
      <div class="over__chase"></div>
      <div class="over__stats">
        <div><div class="stat__label">BEST</div><div class="stat__value" data-best>0</div></div>
        <div><div class="stat__label">MAX COMBO</div><div class="stat__value" data-combo>0</div></div>
        <div><div class="stat__label">FLOW</div><div class="stat__value" data-flow>0</div></div>
      </div>
      <button class="btn" type="button">PLAY AGAIN</button>
      <button class="chip chip--menu" type="button" data-menu>MENU</button>
      <div class="unlock">
        <div class="unlock__label"></div>
        <div class="unlock__track"><div class="unlock__fill"></div></div>
      </div>
      <div class="roster"></div>
    `;
    parent.appendChild(this.el);

    this.scoreEl = this.el.querySelector('[data-score]')!;
    this.bestEl = this.el.querySelector('[data-best]')!;
    this.comboEl = this.el.querySelector('[data-combo]')!;
    this.flowEl = this.el.querySelector('[data-flow]')!;
    this.chaseEl = this.el.querySelector('.over__chase')!;
    this.newEl = this.el.querySelector('.over__new')!;
    this.unlockLabel = this.el.querySelector('.unlock__label')!;
    this.unlockFill = this.el.querySelector('.unlock__fill')!;
    this.roster = this.el.querySelector('.roster')!;
    this.playBtn = this.el.querySelector('.btn')!;

    this.playBtn.addEventListener('click', () => this.onPlay?.());
    this.el.querySelector('[data-menu]')!.addEventListener('click', () => this.onMenu?.());
  }

  setHandlers(
    onPlay: () => void,
    onSelect: (id: CharacterId) => void,
    onMenu: () => void,
  ): void {
    this.onPlay = onPlay;
    this.onSelect = onSelect;
    this.onMenu = onMenu;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(data: GameOverData): void {
    this.visible = true;
    this.el.style.display = '';
    this.scoreEl.textContent = data.score.toLocaleString();
    this.bestEl.textContent = data.best.toLocaleString();
    this.comboEl.textContent = `${data.maxCombo}`;
    this.flowEl.textContent = `${data.flowChains}`;

    const beat = data.score > data.previousBest && data.previousBest > 0;
    this.newEl.textContent = beat ? 'NEW BEST' : '';

    // "So close" framing only when it is genuinely close — a manipulative
    // near-miss message on a distant score reads as noise and gets ignored.
    const gap = data.previousBest - data.score;
    this.chaseEl.textContent =
      !beat && gap > 0 && gap <= Math.max(400, data.previousBest * 0.2)
        ? `${gap.toLocaleString()} from your best`
        : '';

    if (data.unlock.next) {
      const meta = NINJA_META[data.unlock.next];
      this.unlockLabel.textContent = `NEXT NINJA · ${meta.name}`;
      // Animate from zero so the bar visibly fills rather than appearing full.
      // Forced reflow instead of rAF: a background tab throttles rAF, and the
      // result screen must render fully even when shown off-screen.
      this.unlockFill.style.width = '0%';
      void this.unlockFill.offsetWidth;
      this.unlockFill.style.width = `${Math.round(data.unlock.progress * 100)}%`;
    } else {
      this.unlockLabel.textContent = 'ALL NINJAS UNLOCKED';
      this.unlockFill.style.width = '100%';
    }

    this.buildRoster(data);

    void this.el.offsetWidth;
    this.el.classList.add('visible');
  }

  hide(): void {
    this.visible = false;
    this.el.classList.remove('visible');
    setTimeout(() => {
      if (!this.visible) this.el.style.display = 'none';
    }, 300);
  }

  private buildRoster(data: GameOverData): void {
    this.roster.replaceChildren();
    for (const id of UNLOCKS.order) {
      const unlocked = data.unlock.unlocked.includes(id);
      const meta = NINJA_META[id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ninja';
      btn.innerHTML = unlocked ? meta.mark : LOCKED_MARK;
      if (unlocked) btn.style.color = meta.accent;
      btn.title = unlocked ? meta.name : 'Locked';
      btn.setAttribute('aria-label', btn.title);
      if (id === data.selected) btn.classList.add('selected');
      if (!unlocked) btn.classList.add('locked');
      if (unlocked && id !== data.selected) {
        // One tap switches, no confirmation — confirmation here is friction
        // between the player and the next run. An unlocked ninja whose deferred
        // download has not landed yet is still selectable: the select path
        // awaits the load, and the button shows a brief busy state meanwhile.
        btn.addEventListener('click', () => {
          if (!data.available.includes(id)) btn.classList.add('loading');
          this.onSelect?.(id);
        });
      }
      this.roster.appendChild(btn);
    }
  }
}
