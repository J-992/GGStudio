import type { CharacterId } from '../config';
import type { UnlockState } from '../game/Progression';
import { NINJA_META } from './Ninjas';

export interface MenuData {
  best: number;
  bestCombo: number;
  runs: number;
  unlock: UnlockState;
  selected: CharacterId;
  /** Ninjas whose model has finished streaming in. */
  available: CharacterId[];
  muted: boolean;
}

/**
 * The main menu.
 *
 * Deliberately NOT on the path to a first game: a brand-new player is dropped
 * straight into the arena, because time-to-gameplay is the number Poki cares
 * about most and a title screen in front of a first session costs it. The menu
 * exists for the second visit onward, where the questions are different — which
 * ninja am I playing, how far off is the next one, what was my best — and it
 * answers them over the live arena, so picking a ninja swaps the one standing
 * in front of you rather than showing a portrait of them.
 */
export class MainMenu {
  private readonly el: HTMLDivElement;
  private readonly charBtn: HTMLButtonElement;
  private readonly charMark: HTMLSpanElement;
  private readonly charName: HTMLSpanElement;
  private readonly blurbEl: HTMLDivElement;
  private readonly bestEl: HTMLSpanElement;
  private readonly comboEl: HTMLSpanElement;
  private readonly runsEl: HTMLSpanElement;
  private readonly unlockLabel: HTMLDivElement;
  private readonly unlockFill: HTMLDivElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly helpEl: HTMLDivElement;
  private readonly creditsEl: HTMLDivElement;

  private onPlay: (() => void) | null = null;
  private onCharacters: (() => void) | null = null;
  private onSound: (() => void) | null = null;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="menu__title">
        <div class="menu__name">NINJA<span>FLOW</span></div>
        <div class="menu__tag">Strike left. Strike right. Don't blink.</div>
      </div>

      <button class="btn btn--play" type="button">PLAY</button>

      <div class="menu__roster">
        <button class="charbtn" type="button" data-characters>
          <span class="charbtn__mark"></span>
          <span>
            <span class="charbtn__name"></span>
            <span class="charbtn__sub">CHANGE NINJA &amp; GEAR</span>
          </span>
          <span class="charbtn__cta">CUSTOMIZE ›</span>
        </button>
        <div class="menu__blurb"></div>
      </div>

      <div class="unlock">
        <div class="unlock__label"></div>
        <div class="unlock__track"><div class="unlock__fill"></div></div>
      </div>

      <div class="menu__stats">
        <div><div class="stat__label">BEST</div><div class="stat__value" data-best>0</div></div>
        <div><div class="stat__label">TOP COMBO</div><div class="stat__value" data-combo>0</div></div>
        <div><div class="stat__label">RUNS</div><div class="stat__value" data-runs>0</div></div>
      </div>

      <div class="menu__actions">
        <button class="chip" type="button" data-help>HOW TO PLAY</button>
        <button class="chip" type="button" data-sound>SOUND ON</button>
        <button class="chip" type="button" data-credits>CREDITS</button>
      </div>

      <div class="menu__help">
        <p><b>Two buttons, that's it.</b> Enemies run at you from both sides. Hit the
        one that's about to strike — <b>←</b> or <b>A</b> for the left, <b>→</b> or
        <b>D</b> for the right. On a phone, tap the left or right half of the screen.</p>
        <p><b>Wait for them.</b> Striking early whiffs and leaves you wide open, so
        swinging wildly is worse than doing nothing. The later you leave it, the
        better the hit.</p>
        <p><b>Some carry a plate.</b> Break it first, then take them on the way back in.</p>
        <p><b>Fill the Flow bar</b> and you go into Flow: a run of targets, one press
        each, side by side. The glowing one is the one to hit.</p>
      </div>

      <div class="menu__help menu__help--credits">
        <p><b>Ninja Flow</b> — game, code, characters and effects by Reaper8202.</p>
        <p><b>Weapon models</b>, used under CC-BY 4.0:</p>
        <p>“Low-poly Japanese Swords” by Brunoszwa · sketchfab.com/BrunoszwaPl</p>
        <p>“Katana Low poly” by Creator · sketchfab.com/leimoses3</p>
        <p>“low-poly scifi Katana” by Max · sketchfab.com/maximpuzenko22</p>
      </div>

      <div class="menu__credit">by Reaper8202</div>
    `;
    parent.appendChild(this.el);

    this.charBtn = this.el.querySelector('.charbtn')!;
    this.charMark = this.el.querySelector('.charbtn__mark')!;
    this.charName = this.el.querySelector('.charbtn__name')!;
    this.blurbEl = this.el.querySelector('.menu__blurb')!;
    this.bestEl = this.el.querySelector('[data-best]')!;
    this.comboEl = this.el.querySelector('[data-combo]')!;
    this.runsEl = this.el.querySelector('[data-runs]')!;
    this.unlockLabel = this.el.querySelector('.unlock__label')!;
    this.unlockFill = this.el.querySelector('.unlock__fill')!;
    this.soundBtn = this.el.querySelector('[data-sound]')!;
    this.helpEl = this.el.querySelector('.menu__help')!;
    this.creditsEl = this.el.querySelector('.menu__help--credits')!;

    this.el.querySelector('.btn--play')!.addEventListener('click', () => this.onPlay?.());
    this.charBtn.addEventListener('click', () => this.onCharacters?.());
    this.el.querySelector('[data-help]')!.addEventListener('click', () => {
      this.creditsEl.classList.remove('open');
      this.helpEl.classList.toggle('open');
    });
    // CC-BY asks for the credit to travel with the work, so it lives in the
    // game rather than only in the repository's licence file.
    this.el.querySelector('[data-credits]')!.addEventListener('click', () => {
      this.helpEl.classList.remove('open');
      this.creditsEl.classList.toggle('open');
    });
    this.soundBtn.addEventListener('click', () => this.onSound?.());
  }

  setHandlers(onPlay: () => void, onCharacters: () => void, onSound: () => void): void {
    this.onPlay = onPlay;
    this.onCharacters = onCharacters;
    this.onSound = onSound;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(data: MenuData): void {
    this.visible = true;
    this.el.style.display = '';
    this.bestEl.textContent = data.best.toLocaleString();
    this.comboEl.textContent = `${data.bestCombo}`;
    this.runsEl.textContent = `${data.runs}`;
    this.setMuted(data.muted);

    if (data.unlock.next) {
      const meta = NINJA_META[data.unlock.next];
      this.unlockLabel.textContent = `NEXT NINJA · ${meta.name}`;
      this.unlockFill.style.width = '0%';
      void this.unlockFill.offsetWidth;
      this.unlockFill.style.width = `${Math.round(data.unlock.progress * 100)}%`;
    } else {
      this.unlockLabel.textContent = 'ALL NINJAS UNLOCKED';
      this.unlockFill.style.width = '100%';
    }

    this.paintCharacter(data);
    void this.el.offsetWidth;
    this.el.classList.add('visible');
  }

  /** Repaints in place, e.g. after a ninja is picked on the character screen. */
  refresh(data: MenuData): void {
    if (!this.visible) return;
    this.paintCharacter(data);
  }

  setMuted(muted: boolean): void {
    this.soundBtn.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
    this.soundBtn.classList.toggle('chip--off', muted);
  }

  hide(): void {
    this.visible = false;
    this.el.classList.remove('visible');
    this.helpEl.classList.remove('open');
    this.creditsEl.classList.remove('open');
    setTimeout(() => {
      if (!this.visible) this.el.style.display = 'none';
    }, 260);
  }

  private paintCharacter(data: MenuData): void {
    const meta = NINJA_META[data.selected];
    this.charMark.innerHTML = meta.mark;
    this.charMark.style.color = meta.accent;
    this.charName.textContent = meta.name;
    this.blurbEl.textContent = meta.blurb;
  }
}
