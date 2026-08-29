/**
 * The loading experience.
 *
 * Deliberately lightweight: a title, an animated silhouette and a REAL progress
 * bar fed by byte counts from the essential manifest. There is no splash
 * cinematic, because every second here is a second before the first input.
 */
export class LoadingScreen {
  private readonly el: HTMLDivElement;
  private readonly fill: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'loading';
    this.el.innerHTML = `
      <svg class="loading__ninja" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 6c-9 0-16 6-16 14 0 3 1 5 2 7l-6 6 5 4-3 11c0 4 8 8 18 8s18-4 18-8l-3-11 5-4-6-6c1-2 2-4 2-7 0-8-7-14-16-14z"/>
        <path d="M18 22h28" stroke-width="4" />
      </svg>
      <h1 class="loading__title">NINJA FLOW</h1>
      <div class="loading__bar"><div class="loading__fill"></div></div>
    `;
    this.fill = this.el.querySelector('.loading__fill')!;
    parent.appendChild(this.el);
  }

  setProgress(ratio: number): void {
    this.fill.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  }

  /** Fades out and removes itself; resolves once gameplay is fully visible. */
  hide(): Promise<void> {
    this.setProgress(1);
    this.el.classList.add('done');
    return new Promise((resolve) =>
      setTimeout(() => {
        this.el.remove();
        resolve();
      }, 480),
    );
  }
}
