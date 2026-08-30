/**
 * The Blueprint Shop panel: ten finished cars, and the one you are building.
 *
 * The garage is a grid editor, and a grid editor is a hobby. This is the other
 * way to play it — pick the car you like the look of, go and kill zombies, and
 * find the next part already bolted on when you come back. The panel's job is
 * to make that legible: what the car *becomes*, what is coming next, and how
 * far off it is.
 *
 * The preview is the point of the layout. Nobody buys a car off a name and a
 * price, so the panel is a list beside one large spinning render of whatever
 * is selected — the finished car, not the half you can currently afford,
 * because the finished car is the thing being worked towards.
 *
 * One preview, not ten. Each `mountSpinningRigPreview` takes its own WebGL
 * context, browsers cap how many a page may hold, and ten thumbnails plus the
 * garage's own viewport would eventually take the garage down with it. So the
 * render is mounted on selection and torn down on the next one.
 *
 * Presentation only. Prices come from `carShop`, progress from `shopProgress`,
 * and the one thing a click can do is call `onBuyCar` — the garage and `App`
 * own every consequence of that.
 */

import {
  SHOP_CARS,
  carBlueprintAt,
  carStageCost,
  carTotalCost,
  type ShopCar,
} from '../core/carShop.ts';
import { shopCarProgress, type ShopCarProgress } from '../core/shopProgress.ts';
import type { PlayerProfile } from '../core/profile.ts';
import { mountSpinningRigPreview } from './BuildPreview.ts';

export interface CarShopHandlers {
  /** The live profile. Read on open; never held across one. */
  profile(): PlayerProfile;
  /** Buy into a car's base rig. Returns false when the wallet could not. */
  onBuyCar(carId: string): boolean;
  /** True in a mode whose wallet is not real, so prices are not the point. */
  infiniteMoney(): boolean;
}

export interface CarShopPanel {
  /** Topbar button that opens the panel. */
  button: HTMLButtonElement;
  /** Modal layer; the caller appends it wherever its other dialogs live. */
  overlay: HTMLDivElement;
  open(): void;
  close(): void;
  /** Rebuild from the profile, for a wallet that moved while the panel is up. */
  refresh(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function money(amount: number): string {
  return `$${Math.max(0, Math.round(amount)).toLocaleString()}`;
}

export function createCarShop(handlers: CarShopHandlers): CarShopPanel {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'topbar-btn car-shop__open';
  button.textContent = 'Car Shop';
  button.setAttribute('aria-haspopup', 'dialog');

  // The garage's own scrim and panel chrome, so the shop looks like every
  // other confirm in here without restating any of it.
  const overlay = el('div', 'garage-confirm-overlay car-shop-overlay');
  overlay.hidden = true;

  const dialog = el('div', 'panel garage-confirm car-shop');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Car Shop');

  const head = el('div', 'car-shop__head');
  const wallet = el('span', 'car-shop__wallet');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'car-shop__close';
  closeBtn.textContent = 'Close';
  closeBtn.setAttribute('aria-label', 'Close the Car Shop');
  head.append(el('h2', 'car-shop__title', 'Car Shop'), wallet, closeBtn);

  const lede = el(
    'p',
    'car-shop__lede',
    'Pick a car and keep fighting. Every part it still needs bolts itself on ' +
      'as soon as you can afford it.',
  );

  const body = el('div', 'car-shop__body');
  const list = el('div', 'car-shop__list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Cars for sale');

  const detail = el('div', 'car-shop__detail');
  const stage = el('div', 'car-shop__stage');
  const detailName = el('span', 'car-shop__detail-name');
  const detailChassis = el('span', 'car-shop__chassis');
  const detailBlurb = el('p', 'car-shop__blurb');
  const track = el('div', 'car-shop__track');
  const plan = el('ol', 'car-shop__plan');
  const status = el('p', 'car-shop__status');
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'car-shop__action';
  detail.append(
    stage,
    detailName,
    detailChassis,
    detailBlurb,
    track,
    plan,
    status,
    action,
  );

  body.append(list, detail);
  dialog.append(head, lede, body);
  overlay.appendChild(dialog);

  let returnFocus: HTMLElement | null = null;
  let selected: ShopCar = SHOP_CARS[0];
  /** Tears down the live preview's WebGL context. Never leave one behind. */
  let stopPreview: (() => void) | null = null;

  function dropPreview(): void {
    stopPreview?.();
    stopPreview = null;
    stage.replaceChildren();
  }

  /**
   * Show the finished car, whatever the player currently owns of it.
   *
   * The half-built version is already sitting in the bay behind the panel;
   * what the shop is selling is the other end of the build order.
   */
  function showPreview(car: ShopCar): void {
    dropPreview();
    stopPreview = mountSpinningRigPreview(
      stage,
      carBlueprintAt(car, car.stages.length - 1),
    );
  }

  /** One row in the list. The detail pane is what actually sells the car. */
  function row(
    car: ShopCar,
    profile: PlayerProfile,
    progress: ShopCarProgress | null,
  ): HTMLElement {
    const active = progress?.car.id === car.id;
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'car-shop__row';
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', String(car.id === selected.id));
    if (car.id === selected.id) node.classList.add('car-shop__row--selected');
    if (active) node.classList.add('car-shop__row--active');

    const name = el('span', 'car-shop__row-name', car.name);
    const meta = el('span', 'car-shop__row-meta');
    if (active) {
      meta.textContent = progress.complete
        ? 'Built'
        : `${progress.installed}/${progress.total} fitted`;
    } else {
      meta.textContent = handlers.infiniteMoney()
        ? 'Free'
        : money(carTotalCost(car, profile.unlockedDefIds));
    }

    const pips = el('span', 'car-shop__row-pips');
    car.stages.forEach((_, index) => {
      const pip = el('span', 'car-shop__pip');
      if (active && index < progress.installed) {
        pip.classList.add('car-shop__pip--on');
      }
      pip.setAttribute('aria-hidden', 'true');
      pips.appendChild(pip);
    });

    node.append(name, meta, pips);
    node.addEventListener('click', () => select(car));
    return node;
  }

  function renderDetail(
    profile: PlayerProfile,
    progress: ShopCarProgress | null,
  ): void {
    const car = selected;
    const active = progress?.car.id === car.id;
    const installed = active ? progress.installed : 0;
    const free = handlers.infiniteMoney();

    detailName.textContent = car.name;
    detailChassis.textContent = car.chassis;
    detailBlurb.textContent = car.blurb;

    // The build order as a row of boxes: how many there are, and how many are
    // yours. It is the promise made visible before anything has been spent.
    track.replaceChildren();
    track.setAttribute(
      'aria-label',
      `${installed} of ${car.stages.length} fitted`,
    );
    car.stages.forEach((carStage, index) => {
      const pip = el('span', 'car-shop__pip');
      if (index < installed) pip.classList.add('car-shop__pip--on');
      else if (active && index === installed) {
        pip.classList.add('car-shop__pip--next');
      }
      pip.title = carStage.label;
      pip.setAttribute('aria-hidden', 'true');
      track.appendChild(pip);
    });

    // The build order in words, so the player can see what they are waiting
    // for rather than only how many boxes are left.
    plan.replaceChildren(
      ...car.stages.map((carStage, index) => {
        const item = el('li', 'car-shop__plan-item');
        if (index < installed) item.classList.add('car-shop__plan-item--on');
        else if (active && index === installed) {
          item.classList.add('car-shop__plan-item--next');
        }
        item.append(
          el('span', 'car-shop__plan-label', carStage.label),
          el('span', 'car-shop__plan-note', carStage.note),
        );
        return item;
      }),
    );

    // Three states, and the button says which one you are in: you own it, you
    // are saving for the next part, or you have not started.
    action.className = 'car-shop__action';
    if (active && progress.complete) {
      status.textContent = 'Finished. Every part fitted.';
      action.textContent = 'Built';
      action.disabled = true;
    } else if (active && progress.nextStage !== null) {
      status.textContent = `Next up: ${progress.nextStage.label}. It fits itself as soon as you can afford it.`;
      action.textContent = free
        ? 'Fitting now'
        : `${money(progress.nextCost)} to go`;
      action.disabled = true;
      action.classList.add('car-shop__action--waiting');
    } else {
      const base = carStageCost(car, 0, profile.unlockedDefIds);
      const total = carTotalCost(car, profile.unlockedDefIds);
      status.textContent = free
        ? `${car.stages.length} stages, all of them yours the moment you pick it.`
        : `${money(base)} gets it rolling. ${money(total)} finishes it.`;
      action.textContent = free ? 'Build this car' : `Build for ${money(base)}`;
      action.disabled = !free && profile.money < base;
    }
  }

  action.addEventListener('click', () => {
    if (action.disabled) return;
    if (handlers.onBuyCar(selected.id)) close();
  });

  /** Move the selection, and the one preview with it. */
  function select(car: ShopCar): void {
    if (car.id === selected.id) return;
    selected = car;
    refresh();
    showPreview(car);
  }

  function refresh(): void {
    const profile = handlers.profile();
    const progress = shopCarProgress(profile);
    wallet.textContent = handlers.infiniteMoney()
      ? 'Unlimited funds'
      : money(profile.money);
    list.replaceChildren(
      ...SHOP_CARS.map((car) => row(car, profile, progress)),
    );
    renderDetail(profile, progress);
  }

  function open(): void {
    returnFocus = document.activeElement as HTMLElement | null;
    // Open on the car being built, so the panel answers "how is mine doing"
    // before it answers "what else is there".
    selected = shopCarProgress(handlers.profile())?.car ?? SHOP_CARS[0];
    refresh();
    showPreview(selected);
    overlay.hidden = false;
    closeBtn.focus();
  }

  function close(): void {
    // Before hiding, not after: a context left running behind a hidden panel
    // is the one that eventually costs the garage its own viewport.
    dropPreview();
    overlay.hidden = true;
    returnFocus?.focus();
    returnFocus = null;
  }

  button.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  // Clicking the scrim closes; clicking the dialog must not, or every press
  // inside would shut the panel behind itself.
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });

  return {
    button,
    overlay,
    open,
    close,
    refresh: () => {
      if (overlay.hidden) return;
      refresh();
      showPreview(selected);
    },
  };
}
