import { HEALTH } from '../config';
import type { Lane } from '../input/InputManager';

/**
 * In-game HUD.
 *
 * Only four things are permanently on screen — health, score, Flow and combo —
 * and none of them sit in the middle band where threats approach. Everything
 * else (callouts, milestone banners, tutorial prompts) is transient and fades
 * inside a second so it can never mask a telegraph.
 */
export class HUD {
  private readonly root: HTMLDivElement;
  private readonly hearts: HTMLDivElement[] = [];
  private readonly scoreEl: HTMLDivElement;
  private readonly bestEl: HTMLDivElement;
  private readonly comboEl: HTMLDivElement;
  private readonly flowEl: HTMLDivElement;
  private readonly flowFill: HTMLDivElement;
  private readonly zones: Record<Lane, HTMLDivElement>;
  private readonly zoneKeys: Record<Lane, HTMLDivElement>;
  private readonly callouts: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly tutEl: HTMLDivElement;
  private tutText = '';
  private readonly muteBtn: HTMLButtonElement;

  private shownScore = 0;
  private targetScore = 0;

  constructor(parent: HTMLElement, onMuteToggle: () => void, onPause: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="zones">
        <div class="zone" data-lane="left"><div class="zone__key"></div></div>
        <div class="zone" data-lane="right"><div class="zone__key"></div></div>
      </div>
      <div class="hud__top">
        <div class="hearts"></div>
        <div class="score">
          <div class="score__value">0</div>
          <div class="score__best"></div>
        </div>
      </div>
      <div class="combo"></div>
      <div class="flow">
        <div class="flow__track"><div class="flow__fill"></div></div>
        <div class="flow__label">FLOW</div>
      </div>
      <div class="tut"></div>
      <div class="callouts"></div>
      <div class="cinebar cinebar--top"></div>
      <div class="cinebar cinebar--bot"></div>
      <div class="subtitle"></div>
      <button class="mute" type="button" aria-label="Toggle sound">♪</button>
      <button class="pausebtn" type="button" aria-label="Pause">❚❚</button>
    `;
    parent.appendChild(this.root);

    const heartsEl = this.root.querySelector('.hearts')!;
    for (let i = 0; i < HEALTH.hearts; i++) {
      const h = document.createElement('div');
      h.className = 'heart';
      heartsEl.appendChild(h);
      this.hearts.push(h);
    }

    this.scoreEl = this.root.querySelector('.score__value')!;
    this.bestEl = this.root.querySelector('.score__best')!;
    this.comboEl = this.root.querySelector('.combo')!;
    this.flowEl = this.root.querySelector('.flow')!;
    this.flowFill = this.root.querySelector('.flow__fill')!;
    this.callouts = this.root.querySelector('.callouts')!;
    this.subtitleEl = this.root.querySelector('.subtitle')!;
    this.tutEl = this.root.querySelector('.tut')!;

    const zoneEls = Array.from(this.root.querySelectorAll<HTMLDivElement>('.zone'));
    this.zones = { left: zoneEls[0], right: zoneEls[1] };
    this.zoneKeys = {
      left: zoneEls[0].querySelector('.zone__key')!,
      right: zoneEls[1].querySelector('.zone__key')!,
    };

    this.muteBtn = this.root.querySelector('.mute')!;
    this.muteBtn.addEventListener('click', (e) => {
      // Stopped here so a tap on the chrome is never also read as a strike.
      e.stopPropagation();
      onMuteToggle();
    });
    const pauseBtn = this.root.querySelector('.pausebtn') as HTMLButtonElement;
    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onPause();
    });
  }

  show(): void {
    this.root.classList.add('visible');
  }

  hide(): void {
    this.root.classList.remove('visible');
  }

  setMuted(muted: boolean): void {
    this.muteBtn.textContent = muted ? '♪̸' : '♪';
  }

  setHealth(hearts: number): void {
    this.hearts.forEach((h, i) => h.classList.toggle('lost', i >= hearts));
  }

  setScore(score: number): void {
    this.targetScore = score;
  }

  setBest(best: number): void {
    this.bestEl.textContent = best > 0 ? `BEST ${best.toLocaleString()}` : '';
  }

  setCombo(count: number, pop: boolean): void {
    const on = count >= 2;
    this.comboEl.classList.toggle('on', on);
    if (on) this.comboEl.textContent = `${count}×`;
    if (pop && on) {
      this.comboEl.classList.remove('pop');
      void this.comboEl.offsetWidth;
      this.comboEl.classList.add('pop');
    }
  }

  setFlow(ratio: number, pulse: boolean): void {
    this.flowFill.style.width = `${Math.round(ratio * 100)}%`;
    this.flowEl.classList.toggle('full', ratio >= 1);
    if (pulse) {
      this.flowEl.classList.remove('pulse');
      void this.flowEl.offsetWidth;
      this.flowEl.classList.add('pulse');
    }
  }

  /**
   * One-line tutorial instruction, kept on screen while its stage is active.
   * Setting the same text repeatedly is free; setting '' fades it out.
   */
  /** Letterbox bars + hidden gameplay chrome for the death reel. */
  setCinematic(on: boolean): void {
    this.root.classList.toggle('hud--cine', on);
    if (!on) this.subtitleEl.classList.remove('on');
  }

  /** One cutscene subtitle, e.g. "PERFECT ×24". Re-triggers its animation. */
  subtitle(text: string): void {
    this.subtitleEl.textContent = text;
    this.subtitleEl.classList.remove('on');
    void this.subtitleEl.offsetWidth;
    this.subtitleEl.classList.add('on');
  }

  setTutorialText(text: string): void {
    if (text === this.tutText) return;
    this.tutText = text;
    this.tutEl.textContent = text;
    this.tutEl.classList.toggle('on', text.length > 0);
  }

  /** Tutorial affordance: pulses a touch zone and shows the key to press. */
  setHint(lane: Lane | null, keyLabel: string): void {
    for (const l of ['left', 'right'] as Lane[]) {
      const active = l === lane;
      this.zones[l].classList.toggle('hint', active);
      this.zoneKeys[l].textContent = active ? keyLabel : '';
    }
  }

  /** Momentary tap feedback so touch input feels acknowledged instantly. */
  flashZone(lane: Lane): void {
    const el = this.zones[lane];
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 90);
  }

  callout(text: string, kind: 'good' | 'perfect' | 'flow' | 'miss', x = 0.5): void {
    const el = document.createElement('div');
    el.className = `callout callout--${kind}`;
    el.textContent = text;
    el.style.left = `${Math.round(x * 100)}%`;
    el.style.top = '42%';
    el.style.transform = 'translateX(-50%)';
    this.callouts.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  banner(text: string): void {
    const el = document.createElement('div');
    el.className = 'banner';
    el.textContent = text;
    this.callouts.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  welcomeBack(): void {
    const el = document.createElement('div');
    el.className = 'welcome';
    el.textContent = 'WELCOME BACK';
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  /** Counts the score up smoothly; called with real delta so it never freezes. */
  update(dtReal: number): void {
    if (this.shownScore !== this.targetScore) {
      const diff = this.targetScore - this.shownScore;
      const step = Math.max(1, Math.abs(diff) * Math.min(1, dtReal * 14));
      this.shownScore += Math.sign(diff) * Math.min(Math.abs(diff), step);
      this.scoreEl.textContent = Math.round(this.shownScore).toLocaleString();
    }
  }

  resetScore(): void {
    this.shownScore = 0;
    this.targetScore = 0;
    this.scoreEl.textContent = '0';
  }
}
