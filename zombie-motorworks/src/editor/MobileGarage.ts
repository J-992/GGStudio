/** Touch-first garage layout controller. */

import './editor-mobile.css';

import { onTouchControlsChange, shouldUseTouchControls } from '../ui/device.ts';
import { STORE_PURCHASE_EVENT, type StorePurchaseDetail } from './ui.ts';

const COMPACT_BUTTON_GLYPHS: Readonly<Record<string, string>> = {
  'New Garage': '+',
  Menu: '☰',
  'Save & Quit': '⇥',
  Tutorial: '?',
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
/**
 * One mark per screen, drawn at 16 px on the pixel grid so they stay crisp
 * beside the labels: a shopfront awning, a crate of blocks, a stat bar chart,
 * and a share arrow. `currentColor` keeps each one on the button's own colour,
 * including the danger tint the stats button takes when the rig has an error.
 */
const ACTION_ICONS: Readonly<Record<OpenGarageSheet, string>> = {
  shop:
    `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ` +
    `focusable="false" shape-rendering="crispEdges">` +
    `<path d="M2 3h12v3H2Z" fill="currentColor" opacity="0.55"/>` +
    `<path d="M3 7h10v6H3Z" fill="none" stroke="currentColor" ` +
    `stroke-width="2"/>` +
    `<path d="M6 9h4v4H6Z" fill="currentColor"/>` +
    `</svg>`,
  inventory:
    `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ` +
    `focusable="false" shape-rendering="crispEdges">` +
    `<path d="M2 3h12v10H2Z" fill="none" stroke="currentColor" ` +
    `stroke-width="2"/>` +
    `<path d="M4 5h3v3H4Zm5 0h3v3H9Zm-5 4h3v2H4Zm5 0h3v2H9Z" ` +
    `fill="currentColor"/>` +
    `</svg>`,
  stats:
    `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ` +
    `focusable="false" shape-rendering="crispEdges">` +
    `<path d="M2 10h3v4H2Zm4.5-4h3v8h-3ZM11 2h3v12h-3Z" ` +
    `fill="currentColor"/>` +
    `</svg>`,
  share:
    `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ` +
    `focusable="false" shape-rendering="crispEdges">` +
    `<path d="M7 3h2v7H7Z" fill="currentColor"/>` +
    `<path d="M4 6 8 2l4 4H9V4H7v2Z" fill="currentColor"/>` +
    `<path d="M3 9h2v4h6V9h2v6H3Z" fill="currentColor" opacity="0.7"/>` +
    `</svg>`,
};

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
  let actionGroup: HTMLElement | null = null;
  let statsSheet: HTMLElement | null = null;
  let inventoryHeader: HTMLElement | null = null;
  let inventoryBody: HTMLElement | null = null;
  let originalStoreTitle = '';
  let inventoryChildren: Node[] = [];
  let purchaseToast: HTMLElement | null = null;
  let purchaseToastTimer: number | null = null;
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
    // The name field and the view picker used to be labelled here. Both have
    // left the bar — the name lives in the Share panel with its own label, and
    // the view picker is gone entirely — so all that is left to decorate are
    // the buttons.
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

  const updateStatsAlert = (): void => {
    const statsButton = actionButtons.get('stats');
    if (!statsButton) return;
    if (vehicleStats?.querySelector('.issue-error')) {
      statsButton.setAttribute('data-alert', 'true');
    } else {
      statsButton.removeAttribute('data-alert');
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
    root.setAttribute('data-garage-sheet', sheet);
    for (const [name, button] of actionButtons) {
      button.setAttribute('aria-expanded', String(name === sheet));
    }

    if (sheet !== 'none') {
      closeButtons.get(sheet)?.focus({ preventScroll: true });
    } else if (restoreActionFocus && previousSheet !== 'none') {
      // Back to the tab that opened it, which is where the player's attention
      // already is now that the bar no longer collapses into one button.
      actionButtons.get(previousSheet)?.focus({ preventScroll: true });
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

    // No toggle: four destinations behind a menu button cost a tap each and
    // hide where the player is. They are cheap enough to leave on screen.
    actionGroup = document.createElement('div');
    actionGroup.className = 'garage-action-bar__group';
    actionGroup.id = `garage-action-menu-${nextSheetId}`;
    nextSheetId += 1;
    actionGroup.setAttribute('role', 'group');
    actionGroup.setAttribute('aria-label', 'Garage screens');

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
      const icon = document.createElement('span');
      icon.className = 'garage-action-bar__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = ACTION_ICONS[name];
      const label = document.createElement('span');
      label.className = 'garage-action-bar__label';
      label.textContent = name.toUpperCase();
      button.append(icon, label);
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
    actionBar.append(actionGroup);
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
      runBanner
        ? `${Math.round(runBanner.getBoundingClientRect().height)}px`
        : '0px',
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

  /**
   * Say what was bought without closing the shop.
   *
   * Shopping is a run of purchases — a frame, four wheels, the gun — and
   * dropping the player back on the build screen after each one made the phone
   * shop unusable for anything but a single part. The receipt goes on top of
   * the shelf they are still looking at instead.
   */
  const onStorePurchase = (event: Event): void => {
    const detail = (event as CustomEvent<StorePurchaseDetail>).detail;
    if (!detail || storePanel === null) return;

    if (purchaseToast === null) {
      const toast = root.ownerDocument.createElement('div');
      toast.className = 'garage-purchase-toast';
      toast.setAttribute('role', 'status');
      storePanel.appendChild(toast);
      generatedElements.push(toast);
      purchaseToast = toast;
    }
    purchaseToast.textContent = `1 ${detail.name} bought!`;
    // Re-triggered rather than queued: buying three in a row should read as one
    // receipt counting up, not as three overlapping cards.
    purchaseToast.classList.remove('is-visible');
    void purchaseToast.offsetWidth;
    purchaseToast.classList.add('is-visible');
    if (purchaseToastTimer !== null) clearTimeout(purchaseToastTimer);
    purchaseToastTimer = window.setTimeout(() => {
      purchaseToastTimer = null;
      purchaseToast?.classList.remove('is-visible');
    }, 1400);
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

    storePanel.addEventListener(STORE_PURCHASE_EVENT, onStorePurchase, {
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
    if (purchaseToastTimer !== null) {
      clearTimeout(purchaseToastTimer);
      purchaseToastTimer = null;
    }
    purchaseToast = null;
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
