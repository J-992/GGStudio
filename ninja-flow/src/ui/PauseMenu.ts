/**
 * Pause.
 *
 * A browser game is played in a tab with a hundred other things happening
 * around it, so being able to stop the run without losing it is not a luxury.
 * Pausing also tells Poki that gameplay has stopped, which matters as much as
 * the player-facing part: a paused run must not be counted as time played.
 *
 * The overlay is deliberately small — resume, restart, quit, sound — because
 * everything else belongs on the menu it can send you back to.
 */
export class PauseMenu {
  private readonly el: HTMLDivElement;
  private readonly soundBtn: HTMLButtonElement;
  private visible = false;

  private onResume: (() => void) | null = null;
  private onRestart: (() => void) | null = null;
  private onQuit: (() => void) | null = null;
  private onSound: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'pause';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="pause__card">
        <div class="pause__title">PAUSED</div>
        <button class="btn" type="button" data-resume>RESUME</button>
        <div class="pause__row">
          <button class="chip" type="button" data-restart>RESTART</button>
          <button class="chip" type="button" data-quit>MENU</button>
          <button class="chip" type="button" data-sound>SOUND ON</button>
        </div>
        <div class="pause__hint">Esc or P to resume</div>
      </div>
    `;
    parent.appendChild(this.el);

    this.soundBtn = this.el.querySelector('[data-sound]')!;
    this.el.querySelector('[data-resume]')!.addEventListener('click', () => this.onResume?.());
    this.el.querySelector('[data-restart]')!.addEventListener('click', () => this.onRestart?.());
    this.el.querySelector('[data-quit]')!.addEventListener('click', () => this.onQuit?.());
    this.soundBtn.addEventListener('click', () => this.onSound?.());
  }

  setHandlers(handlers: {
    onResume: () => void;
    onRestart: () => void;
    onQuit: () => void;
    onSound: () => void;
  }): void {
    this.onResume = handlers.onResume;
    this.onRestart = handlers.onRestart;
    this.onQuit = handlers.onQuit;
    this.onSound = handlers.onSound;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(muted: boolean): void {
    this.visible = true;
    this.setMuted(muted);
    this.el.style.display = '';
    void this.el.offsetWidth;
    this.el.classList.add('visible');
  }

  hide(): void {
    this.visible = false;
    this.el.classList.remove('visible');
    setTimeout(() => {
      if (!this.visible) this.el.style.display = 'none';
    }, 200);
  }

  setMuted(muted: boolean): void {
    this.soundBtn.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
    this.soundBtn.classList.toggle('chip--off', muted);
  }
}
