/** Configuration for a collapsible DOM panel. */
export interface CollapsibleOptions {
  /** Panel element to collapse. Must already be in the DOM. */
  readonly panel: HTMLElement;
  /** Accessible label, e.g. "Build card". */
  readonly label: string;
  /** Start collapsed. Default false. */
  readonly startCollapsed?: boolean;
  /**
   * localStorage key. When given, collapsed state survives a reload; omit for
   * panels whose state should reset each session.
   */
  readonly storageKey?: string;
  /** Where the toggle button is placed relative to the panel. Default 'panel-start'. */
  readonly toggleInto?: HTMLElement;
  /** Called after the panel changes between its collapsed and expanded states. */
  readonly onToggle?: (collapsed: boolean) => void;
}

let nextPanelId = 1;

/**
 * Adds an accessible, disposable collapse control to an existing DOM panel.
 *
 * The primitive owns state and attributes only. Stylesheets decide how the
 * panel contracts, which lets each screen keep responsibility for its layout.
 */
export class Collapsible {
  private readonly panel: HTMLElement;
  private readonly label: string;
  private readonly storageKey: string | undefined;
  private readonly onToggle: ((collapsed: boolean) => void) | undefined;
  private readonly toggleButton: HTMLButtonElement;
  private readonly generatedPanelId: string | undefined;
  private isCollapsed = false;
  private isDisposed = false;

  /** Creates and mounts a collapse toggle for `options.panel`. */
  constructor(options: CollapsibleOptions) {
    this.panel = options.panel;
    this.label = options.label;
    this.storageKey = options.storageKey;
    this.onToggle = options.onToggle;
    this.generatedPanelId = this.ensurePanelId();

    this.toggleButton = document.createElement('button');
    this.toggleButton.type = 'button';
    this.toggleButton.className = 'collapsible-toggle';
    this.toggleButton.setAttribute('aria-controls', this.panel.id);
    this.toggleButton.setAttribute('aria-label', this.label);
    this.toggleButton.addEventListener('click', this.handleToggle);

    const toggleContainer = options.toggleInto ?? this.panel;
    toggleContainer.prepend(this.toggleButton);

    const initialState = this.readStoredState(options.startCollapsed ?? false);
    this.applyState(initialState);
  }

  /** Whether the panel is currently collapsed. */
  get collapsed(): boolean {
    return this.isCollapsed;
  }

  /**
   * Expands or collapses the panel and persists the new state when configured.
   * Reapplying the current state is a no-op.
   */
  setCollapsed(collapsed: boolean): void {
    if (this.isDisposed || collapsed === this.isCollapsed) return;

    this.applyState(collapsed);
    this.writeStoredState(collapsed);
    this.onToggle?.(collapsed);
  }

  /** Switches the panel between its expanded and collapsed states. */
  toggle(): void {
    this.setCollapsed(!this.isCollapsed);
  }

  /** Remove the toggle button and listeners; leaves the panel expanded. */
  dispose(): void {
    if (this.isDisposed) return;

    this.toggleButton.removeEventListener('click', this.handleToggle);
    this.toggleButton.remove();
    this.applyState(false);

    if (this.generatedPanelId && this.panel.id === this.generatedPanelId) {
      this.panel.removeAttribute('id');
    }

    this.isDisposed = true;
  }

  private readonly handleToggle = (): void => {
    this.toggle();
  };

  private applyState(collapsed: boolean): void {
    this.isCollapsed = collapsed;
    this.panel.classList.toggle('is-collapsed', collapsed);
    if (collapsed) {
      this.panel.setAttribute('data-collapsed', 'true');
    } else {
      this.panel.removeAttribute('data-collapsed');
    }
    this.toggleButton.setAttribute('aria-expanded', String(!collapsed));
  }

  private ensurePanelId(): string | undefined {
    if (this.panel.id) return undefined;

    let candidate: string;
    do {
      candidate = `collapsible-panel-${nextPanelId}`;
      nextPanelId += 1;
    } while (document.getElementById(candidate));

    this.panel.id = candidate;
    return candidate;
  }

  private readStoredState(fallback: boolean): boolean {
    if (!this.storageKey) return fallback;

    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored === 'true') return true;
      if (stored === 'false') return false;
    } catch {
      // Storage can be unavailable in sandboxed frames and Safari private mode.
    }

    return fallback;
  }

  private writeStoredState(collapsed: boolean): void {
    if (!this.storageKey) return;

    try {
      localStorage.setItem(this.storageKey, String(collapsed));
    } catch {
      // A persistence failure must never interrupt gameplay or panel input.
    }
  }
}
