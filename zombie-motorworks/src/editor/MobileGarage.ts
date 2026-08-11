/** Touch-first garage layout controller. */

import './editor-mobile.css';

import { onTouchControlsChange, shouldUseTouchControls } from '../ui/device.ts';

const COMPACT_BUTTON_GLYPHS: Readonly<Record<string, string>> = {
  'New Garage': '+',
  Menu: '☰',
  'Save & Quit': '⇥',
  Tutorial: '?',
  Help: 'i',
  Share: '↗',
  'Test Drive': '▶',
};

type GarageSheet = 'none' | 'shop' | 'inventory' | 'stats' | 'share';
type OpenGarageSheet = Exclude<GarageSheet, 'none'>;

interface RestoredAttribute {
  element: HTMLElement;
  name: string;
  value: string | null;
}

interface RestoredClass {
  element: HTMLElement;
  name: string;
  present: boolean;
}

interface NodePlacement {
  node: Node;
  parent: Node;
  nextSibling: Node | null;
}

let nextSheetId = 1;

/** Controls the touch-only presentation layered over the ordinary garage DOM. */
export interface MobileGarage {
  /** Re-applies viewport defaults after the usable width changes. */
  refresh(): void;
  /** Opens or closes the Shop sheet without synthesising pointer input. */
  setPaletteOpen(open: boolean): void;
  /** Closes reference sheets while another modal owns the screen. */
  setCompact(compact: boolean): void;
  /** Detaches the controller and restores the desktop DOM it inherited. */
  dispose(): void;
}

/**
 * Leaves the vehicle as the garage's default mobile screen.
 *
 * The ordinary editor panels stay alive, with their event listeners and live
 * content intact. Mobile only promotes one of them over the canvas at a time.
 */
export function installMobileGarage(root: HTMLElement): MobileGarage {
  let installed = false;
  let disposed = false;
  let compact = false;
  let currentSheet: GarageSheet = 'none';
  let refreshFrame: number | null = null;
  let listenerController: AbortController | null = null;
  let statsObserver: MutationObserver | null = null;
  let inventoryHiddenBeforeSheet: boolean | null = null;
  let originalTopbarHeight = '';
  let originalTopbarHeightPriority = '';
  let topbar: HTMLElement | null = null;
  let storePanel: HTMLElement | null = null;
  let inventoryPopover: HTMLElement | null = null;
  let vehicleStats: HTMLElement | null = null;
  let abilityLoadout: HTMLElement | null = null;
  let sharePanel: HTMLElement | null = null;
  let actionBar: HTMLElement | null = null;
  let actionToggle: HTMLButtonElement | null = null;
  let actionGroup: HTMLElement | null = null;
  let statsSheet: HTMLElement | null = null;
  let inventoryHeader: HTMLElement | null = null;
  let inventoryBody: HTMLElement | null = null;
  let originalStoreTitle = '';
  let inventoryChildren: Node[] = [];
  const actionButtons = new Map<OpenGarageSheet, HTMLButtonElement>();
  const closeButtons = new Map<OpenGarageSheet, HTMLButtonElement>();
  const restoredAttributes: RestoredAttribute[] = [];
  const restoredClasses: RestoredClass[] = [];
  const nodePlacements: NodePlacement[] = [];
  const generatedElements: HTMLElement[] = [];

  const setTemporaryAttribute = (
    element: HTMLElement,
    name: string,
    value: string,
  ): void => {
    restoredAttributes.push({
      element,
      name,
      value: element.getAttribute(name),
    });
    element.setAttribute(name, value);
  };

  const addTemporaryClass = (element: HTMLElement, name: string): void => {
    restoredClasses.push({
      element,
      name,
      present: element.classList.contains(name),
    });
    element.classList.add(name);
  };

  const restoreDecorations = (): void => {
    for (const { element, name, present } of restoredClasses.reverse()) {
      element.classList.toggle(name, present);
    }
    restoredClasses.length = 0;

    for (const { element, name, value } of restoredAttributes.reverse()) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
    restoredAttributes.length = 0;
  };

  const moveNode = (node: Node, destination: Node): void => {
    const parent = node.parentNode;
    if (!parent) return;
    nodePlacements.push({ node, parent, nextSibling: node.nextSibling });
    destination.appendChild(node);
  };

  const restoreMovedNodes = (): void => {
    for (const { node, parent, nextSibling } of nodePlacements.reverse()) {
      const reference = nextSibling?.parentNode === parent ? nextSibling : null;
      parent.insertBefore(node, reference);
    }
    nodePlacements.length = 0;
  };

  const ensureId = (element: HTMLElement, stem: string): string => {
    if (element.id) return element.id;

    let candidate: string;
    do {
      candidate = `${stem}-${nextSheetId}`;
      nextSheetId += 1;
    } while (document.getElementById(candidate));
    setTemporaryAttribute(element, 'id', candidate);
    return candidate;
  };

  const decorateCompactTopbar = (): void => {
    if (!topbar) return;

    setTemporaryAttribute(topbar, 'data-density', 'compact');
    const nameInput = topbar.querySelector<HTMLElement>('.garage-name');
    if (nameInput && !nameInput.hasAttribute('aria-label')) {
      setTemporaryAttribute(nameInput, 'aria-label', 'Vehicle name');
    }

    const viewSelect = topbar.querySelector<HTMLElement>('select');
    if (viewSelect && !viewSelect.hasAttribute('aria-label')) {
      setTemporaryAttribute(viewSelect, 'aria-label', 'Garage view');
    }

    for (const button of topbar.querySelectorAll<HTMLButtonElement>('button')) {
      const label = button.textContent?.trim();
      if (!label) continue;
      if (!button.hasAttribute('aria-label')) {
        setTemporaryAttribute(button, 'aria-label', label);
      }
      const glyph = COMPACT_BUTTON_GLYPHS[label];
      if (glyph) setTemporaryAttribute(button, 'data-mobile-glyph', glyph);
    }
  };

  const setActionMenuExpanded = (expanded: boolean): void => {
    if (!actionToggle || !actionGroup) return;
    actionToggle.setAttribute('aria-expanded', String(expanded));
    actionGroup.hidden = !expanded;
  };

  const updateStatsAlert = (): void => {
    const statsButton = actionButtons.get('stats');
    if (!statsButton) return;
    if (vehicleStats?.querySelector('.issue-error')) {
      statsButton.setAttribute('data-alert', 'true');
      actionToggle?.setAttribute('data-alert', 'true');
    } else {
      statsButton.removeAttribute('data-alert');
      actionToggle?.removeAttribute('data-alert');
    }
  };

  const restoreInventoryHidden = (): void => {
    if (inventoryHiddenBeforeSheet === null || !inventoryPopover) return;
    inventoryPopover.hidden = inventoryHiddenBeforeSheet;
    inventoryHiddenBeforeSheet = null;
  };

  const setSheet = (sheet: GarageSheet, restoreActionFocus = false): void => {
    if (!installed) return;

    if (currentSheet === 'inventory' && sheet !== 'inventory') {
      restoreInventoryHidden();
    }
    if (sheet === 'inventory' && currentSheet !== 'inventory') {
      inventoryHiddenBeforeSheet = inventoryPopover?.hidden ?? true;
      if (inventoryPopover) inventoryPopover.hidden = false;
    }

    const previousSheet = currentSheet;
    currentSheet = sheet;
    setActionMenuExpanded(false);
    root.setAttribute('data-garage-sheet', sheet);
    for (const [name, button] of actionButtons) {
      button.setAttribute('aria-expanded', String(name === sheet));
    }

    if (sheet !== 'none') {
      closeButtons.get(sheet)?.focus({ preventScroll: true });
    } else if (restoreActionFocus && previousSheet !== 'none') {
      actionToggle?.focus({ preventScroll: true });
    }
  };

  const makeCloseButton = (sheet: OpenGarageSheet): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'garage-sheet__close';
    button.textContent = '×';
    button.setAttribute('data-touch-passthrough', '');
    button.setAttribute('aria-label', `Close ${sheet} sheet`);
    button.addEventListener('click', () => setSheet('none', true), {
      signal: listenerController?.signal,
    });
    closeButtons.set(sheet, button);
    generatedElements.push(button);
    return button;
  };

  const decorateDockSheet = (
    panel: HTMLElement,
    sheet: 'shop' | 'share',
  ): string => {
    setTemporaryAttribute(panel, 'data-garage-sheet-panel', sheet);
    setTemporaryAttribute(panel, 'role', 'dialog');
    setTemporaryAttribute(panel, 'aria-modal', 'true');
    const header = panel.querySelector<HTMLElement>('.dock-panel__header');
    if (header) {
      addTemporaryClass(header, 'garage-sheet__header');
      header.appendChild(makeCloseButton(sheet));
    }
    return ensureId(panel, `garage-${sheet}-sheet`);
  };

  const buildInventorySheet = (panel: HTMLElement): string => {
    const id = ensureId(panel, 'garage-inventory-sheet');
    setTemporaryAttribute(panel, 'data-garage-sheet-panel', 'inventory');
    setTemporaryAttribute(panel, 'role', 'dialog');
    setTemporaryAttribute(panel, 'aria-modal', 'true');

    inventoryChildren = Array.from(panel.childNodes);
    inventoryHeader = document.createElement('header');
    inventoryHeader.className = 'garage-sheet__header';
    const title = document.createElement('h2');
    title.textContent = 'Inventory';
    inventoryHeader.append(title, makeCloseButton('inventory'));

    inventoryBody = document.createElement('div');
    inventoryBody.className = 'garage-sheet__body';
    for (const child of inventoryChildren) inventoryBody.appendChild(child);
    panel.append(inventoryHeader, inventoryBody);
    generatedElements.push(inventoryHeader, inventoryBody);
    return id;
  };

  const buildStatsSheet = (
    stats: HTMLElement,
    abilities: HTMLElement,
  ): string => {
    statsSheet = document.createElement('section');
    statsSheet.className = 'garage-stats-sheet';
    statsSheet.id = `garage-stats-sheet-${nextSheetId}`;
    nextSheetId += 1;
    statsSheet.setAttribute('data-garage-sheet-panel', 'stats');
    statsSheet.setAttribute('role', 'dialog');
    statsSheet.setAttribute('aria-modal', 'true');

    const header = document.createElement('header');
    header.className = 'garage-sheet__header';
    const title = document.createElement('h2');
    title.textContent = 'Stats';
    header.append(title, makeCloseButton('stats'));

    const body = document.createElement('div');
    body.className = 'garage-sheet__body garage-stats-sheet__body';
    statsSheet.append(header, body);
    root.appendChild(statsSheet);
    moveNode(stats, body);
    moveNode(abilities, body);
    generatedElements.push(statsSheet, header, body);
    return statsSheet.id;
  };

  const createActionBar = (
    ids: Readonly<Record<OpenGarageSheet, string>>,
  ): void => {
    actionBar = document.createElement('nav');
    actionBar.className = 'garage-action-bar';
    actionBar.setAttribute('aria-label', 'Garage screens');

    actionGroup = document.createElement('div');
    actionGroup.className = 'garage-action-bar__group';
    actionGroup.id = `garage-action-menu-${nextSheetId}`;
    nextSheetId += 1;
    actionGroup.setAttribute('role', 'group');
    actionGroup.setAttribute('aria-label', 'Garage screens');
    actionGroup.hidden = true;

    actionToggle = document.createElement('button');
    actionToggle.type = 'button';
    actionToggle.className = 'garage-action-bar__toggle';
    actionToggle.textContent = '☰ MENU';
    actionToggle.setAttribute('data-touch-passthrough', '');
    actionToggle.setAttribute('aria-label', 'Garage menu');
    actionToggle.setAttribute('aria-controls', actionGroup.id);
    actionToggle.setAttribute('aria-expanded', 'false');
    actionToggle.addEventListener(
      'click',
      () => {
        setActionMenuExpanded(
          actionToggle?.getAttribute('aria-expanded') !== 'true',
        );
      },
      { signal: listenerController?.signal },
    );

    const names: readonly OpenGarageSheet[] = [
      'shop',
      'inventory',
      'stats',
      'share',
    ];
    for (const name of names) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'garage-action-bar__button';
      button.textContent = name.toUpperCase();
      button.setAttribute('data-touch-passthrough', '');
      button.setAttribute('aria-controls', ids[name]);
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-haspopup', 'dialog');
      button.addEventListener('click', () => setSheet(name), {
        signal: listenerController?.signal,
      });
      actionButtons.set(name, button);
      actionGroup.appendChild(button);
    }
    actionBar.append(actionGroup, actionToggle);
    root.appendChild(actionBar);
    generatedElements.push(actionBar);
  };

  const refresh = (): void => {
    if (!installed) return;
    if (topbar) {
      root.style.setProperty(
        '--garage-topbar-h',
        `${Math.round(topbar.getBoundingClientRect().height)}px`,
      );
    }

    // The notice sits under the between-waves repair banner when there is one,
    // and directly under the top bar when there is not. Reserving the banner's
    // height unconditionally pushed the notice down onto the vehicle during an
    // ordinary garage visit, so it is measured rather than assumed.
    const runBanner = root.querySelector<HTMLElement>('.run-banner.run-active');
    root.style.setProperty(
      '--garage-run-banner-h',
      runBanner ? `${Math.round(runBanner.getBoundingClientRect().height)}px` : '0px',
    );
    updateStatsAlert();
  };

  const scheduleRefresh = (): void => {
    if (refreshFrame !== null) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = null;
      refresh();
    });
  };

  const onStoreChoice = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('.part-btn')) return;
    setSheet('none');
  };

  const install = (): void => {
    if (installed || disposed) return;

    const nextStorePanel = root.querySelector<HTMLElement>('.store-panel');
    const nextInventoryPopover =
      root.querySelector<HTMLElement>('.inventory-popover');
    const nextVehicleStats = root.querySelector<HTMLElement>('.vehicle-stats');
    const nextAbilityLoadout =
      root.querySelector<HTMLElement>('.ability-loadout');
    const nextSharePanel = root.querySelector<HTMLElement>('.share-panel');
    if (
      !nextStorePanel ||
      !nextInventoryPopover ||
      !nextVehicleStats ||
      !nextAbilityLoadout ||
      !nextSharePanel
    ) {
      return;
    }

    installed = true;
    listenerController = new AbortController();
    storePanel = nextStorePanel;
    inventoryPopover = nextInventoryPopover;
    vehicleStats = nextVehicleStats;
    abilityLoadout = nextAbilityLoadout;
    sharePanel = nextSharePanel;
    topbar = root.querySelector<HTMLElement>('.topbar');
    originalTopbarHeight = root.style.getPropertyValue('--garage-topbar-h');
    originalTopbarHeightPriority =
      root.style.getPropertyPriority('--garage-topbar-h');

    setTemporaryAttribute(root, 'data-mobile-garage', 'on');
    setTemporaryAttribute(root, 'data-garage-sheet', 'none');
    decorateCompactTopbar();

    const storeTitle = storePanel.querySelector<HTMLElement>(
      '.dock-panel__header h2',
    );
    if (storeTitle) {
      originalStoreTitle = storeTitle.textContent ?? '';
      storeTitle.textContent = 'Shop';
    }

    const shopId = decorateDockSheet(storePanel, 'shop');
    const shareId = decorateDockSheet(sharePanel, 'share');
    // The dock is itself positioned on desktop. Sheets must instead resolve
    // their inset against the whole UI layer in every browser.
    moveNode(storePanel, root);
    moveNode(sharePanel, root);
    const inventoryId = buildInventorySheet(inventoryPopover);
    moveNode(inventoryPopover, root);
    const statsId = buildStatsSheet(vehicleStats, abilityLoadout);
    createActionBar({
      shop: shopId,
      inventory: inventoryId,
      stats: statsId,
      share: shareId,
    });

    storePanel.addEventListener('click', onStoreChoice, {
      signal: listenerController.signal,
    });
    window.addEventListener('resize', scheduleRefresh, {
      signal: listenerController.signal,
    });
    window.addEventListener('orientationchange', scheduleRefresh, {
      signal: listenerController.signal,
    });
    statsObserver = new MutationObserver(updateStatsAlert);
    statsObserver.observe(vehicleStats, { childList: true, subtree: true });
    refresh();
  };

  const uninstall = (): void => {
    if (!installed) return;
    setSheet('none');
    installed = false;
    listenerController?.abort();
    listenerController = null;
    statsObserver?.disconnect();
    statsObserver = null;
    if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
    refreshFrame = null;

    const storeTitle = storePanel?.querySelector<HTMLElement>(
      '.dock-panel__header h2',
    );
    if (storeTitle) storeTitle.textContent = originalStoreTitle;

    if (inventoryPopover) {
      for (const child of inventoryChildren) {
        inventoryPopover.appendChild(child);
      }
    }
    inventoryChildren = [];
    restoreMovedNodes();

    for (const element of generatedElements.reverse()) element.remove();
    generatedElements.length = 0;
    actionButtons.clear();
    closeButtons.clear();
    actionBar = null;
    actionToggle = null;
    actionGroup = null;
    statsSheet = null;
    inventoryHeader = null;
    inventoryBody = null;
    inventoryHiddenBeforeSheet = null;
    currentSheet = 'none';

    restoreDecorations();
    if (originalTopbarHeight) {
      root.style.setProperty(
        '--garage-topbar-h',
        originalTopbarHeight,
        originalTopbarHeightPriority,
      );
    } else {
      root.style.removeProperty('--garage-topbar-h');
    root.style.removeProperty('--garage-run-banner-h');
    }

    topbar = null;
    storePanel = null;
    inventoryPopover = null;
    vehicleStats = null;
    abilityLoadout = null;
    sharePanel = null;
    originalStoreTitle = '';
  };

  const unsubscribe = onTouchControlsChange((enabled) => {
    if (enabled) install();
    else uninstall();
  });
  if (shouldUseTouchControls()) install();

  return {
    refresh,
    setPaletteOpen: (open) => {
      if (!installed) return;
      if (open) {
        if (!compact) setSheet('shop');
      } else if (currentSheet === 'shop') {
        setSheet('none');
      }
    },
    setCompact: (nextCompact) => {
      compact = nextCompact;
      if (installed && compact) setSheet('none');
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      uninstall();
    },
  };
}
