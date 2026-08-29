import { UNLOCKS, type CharacterId } from '../config';
import {
  COSMETIC_SLOTS,
  SLOT_LABEL,
  itemById,
  itemsForSlot,
  type CosmeticSlot,
  type Loadout,
} from '../game/Cosmetics';
import type { UnlockState } from '../game/Progression';
import { LOCKED_MARK, NINJA_META } from './Ninjas';

export interface SelectData {
  selected: CharacterId;
  unlock: UnlockState;
  /** Ninjas whose model has finished streaming in. */
  available: CharacterId[];
  loadout: Loadout;
}

export interface SelectHandlers {
  onClose: () => void;
  onPick: (id: CharacterId) => void;
  onEquip: (slot: CosmeticSlot, itemId: string) => void;
  onRandomize: () => void;
  /** Turntable drag, in radians. */
  onSpin: (radians: number) => void;
}

type Tab = 'ninja' | CosmeticSlot;
const TABS: Tab[] = ['ninja', ...COSMETIC_SLOTS];

/**
 * The character screen.
 *
 * It is built around the ninja himself: the panel is a frame around the live
 * model rather than a page with a portrait on it, so every tap is answered by
 * the character in front of you putting the thing on. That is the whole point
 * of a customiser — the loop is look, tap, see it — and a grid of thumbnails
 * with an "apply" button breaks it.
 *
 * Nothing here is earned, priced or timed. Every piece is available from the
 * first visit, because cosmetics in this game are a way to make the ninja
 * yours, not a reason to keep playing.
 */
export class CharacterSelect {
  private readonly el: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly blurbEl: HTMLDivElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly gridEl: HTMLDivElement;
  private readonly noteEl: HTMLDivElement;
  private readonly stageEl: HTMLDivElement;

  private handlers: SelectHandlers | null = null;
  private data: SelectData | null = null;
  private tab: Tab = 'ninja';
  private visible = false;
  private dragging = false;
  private lastX = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'cs';
    this.el.style.display = 'none';
    this.el.innerHTML = `
      <div class="cs__top">
        <button class="chip cs__back" type="button">‹ BACK</button>
        <div class="cs__title">
          <div class="cs__name"></div>
          <div class="cs__blurb"></div>
        </div>
        <button class="chip cs__dice" type="button" title="Random look">RANDOM</button>
      </div>

      <div class="cs__stage">
        <button class="cs__arrow cs__arrow--l" type="button" aria-label="Previous ninja">‹</button>
        <button class="cs__arrow cs__arrow--r" type="button" aria-label="Next ninja">›</button>
        <div class="cs__note"></div>
        <div class="cs__spinHint">drag to turn</div>
      </div>

      <div class="cs__sheet">
        <div class="cs__tabs"></div>
        <div class="cs__grid"></div>
      </div>
    `;
    parent.appendChild(this.el);

    this.nameEl = this.el.querySelector('.cs__name')!;
    this.blurbEl = this.el.querySelector('.cs__blurb')!;
    this.tabsEl = this.el.querySelector('.cs__tabs')!;
    this.gridEl = this.el.querySelector('.cs__grid')!;
    this.noteEl = this.el.querySelector('.cs__note')!;
    this.stageEl = this.el.querySelector('.cs__stage')!;

    this.el.querySelector('.cs__back')!.addEventListener('click', () => this.handlers?.onClose());
    this.el.querySelector('.cs__dice')!.addEventListener('click', () => this.handlers?.onRandomize());
    this.el.querySelector('.cs__arrow--l')!.addEventListener('click', () => this.step(-1));
    this.el.querySelector('.cs__arrow--r')!.addEventListener('click', () => this.step(1));

    // Turntable. The stage is transparent — it is the arena showing through —
    // so the drag is bound here rather than to anything drawn.
    this.stageEl.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.stageEl.setPointerCapture(e.pointerId);
      this.el.classList.add('cs--dragging');
    });
    this.stageEl.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.handlers?.onSpin((dx / Math.max(320, window.innerWidth)) * Math.PI * 2);
    });
    const release = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.stageEl.releasePointerCapture?.(e.pointerId);
      this.el.classList.remove('cs--dragging');
    };
    this.stageEl.addEventListener('pointerup', release);
    this.stageEl.addEventListener('pointercancel', release);
  }

  setHandlers(handlers: SelectHandlers): void {
    this.handlers = handlers;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(data: SelectData): void {
    this.visible = true;
    this.el.style.display = '';
    this.render(data);
    void this.el.offsetWidth;
    this.el.classList.add('visible');
  }

  /** Repaints in place after an equip or a character swap. */
  refresh(data: SelectData): void {
    if (!this.visible) return;
    this.render(data);
  }

  hide(): void {
    this.visible = false;
    this.el.classList.remove('visible');
    setTimeout(() => {
      if (!this.visible) this.el.style.display = 'none';
    }, 240);
  }

  private render(data: SelectData): void {
    this.data = data;
    const meta = NINJA_META[data.selected];
    this.nameEl.textContent = meta.name;
    this.nameEl.style.setProperty('--accent', meta.accent);
    this.blurbEl.textContent = meta.blurb;
    this.noteEl.textContent = '';
    this.buildTabs();
    this.buildGrid();
  }

  private step(direction: number): void {
    const data = this.data;
    if (!data) return;
    // Arrows walk the unlocked roster only: an arrow that lands on a locked
    // slot makes the two buttons feel broken half the time.
    const pool = UNLOCKS.order.filter((id) => data.unlock.unlocked.includes(id));
    if (pool.length < 2) return;
    const index = pool.indexOf(data.selected);
    const next = pool[(index + direction + pool.length) % pool.length];
    this.handlers?.onPick(next);
  }

  private buildTabs(): void {
    this.tabsEl.replaceChildren();
    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cs__tab';
      btn.textContent = tab === 'ninja' ? 'NINJA' : SLOT_LABEL[tab];
      if (tab === this.tab) btn.classList.add('active');
      btn.addEventListener('click', () => {
        this.tab = tab;
        this.buildTabs();
        this.buildGrid();
      });
      this.tabsEl.appendChild(btn);
    }
  }

  private buildGrid(): void {
    const data = this.data;
    if (!data) return;
    this.gridEl.replaceChildren();
    if (this.tab === 'ninja') this.buildRoster(data);
    else this.buildItems(data, this.tab);
  }

  private buildRoster(data: SelectData): void {
    for (const id of UNLOCKS.order) {
      const unlocked = data.unlock.unlocked.includes(id);
      const meta = NINJA_META[id];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card card--ninja';
      card.style.setProperty('--accent', meta.accent);
      card.innerHTML = `
        <span class="card__art">${unlocked ? meta.mark : LOCKED_MARK}</span>
        <span class="card__name">${unlocked ? meta.name : 'LOCKED'}</span>
      `;
      if (id === data.selected) card.classList.add('equipped');
      if (!unlocked) card.classList.add('locked');
      card.addEventListener('click', () => {
        if (!unlocked) {
          const need = UNLOCKS.thresholds[UNLOCKS.order.indexOf(id)];
          const left = Math.max(0, need - data.unlock.mastery);
          this.noteEl.textContent = `${meta.name} needs ${left.toLocaleString()} more mastery`;
          return;
        }
        if (id === data.selected) return;
        if (!data.available.includes(id)) card.classList.add('busy');
        this.handlers?.onPick(id);
      });
      this.gridEl.appendChild(card);
    }
  }

  private buildItems(data: SelectData, slot: CosmeticSlot): void {
    const equippedId = data.loadout[slot];
    for (const item of itemsForSlot(slot)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.style.setProperty('--a', item.swatch[0]);
      card.style.setProperty('--b', item.swatch[1]);
      card.innerHTML = `
        <span class="card__art card__art--swatch"></span>
        <span class="card__name"></span>
      `;
      card.querySelector('.card__name')!.textContent = item.name;
      card.title = item.blurb;
      if (item.id === equippedId) card.classList.add('equipped');
      card.addEventListener('click', () => {
        this.noteEl.textContent = item.blurb;
        if (item.id === equippedId) return;
        this.handlers?.onEquip(slot, item.id);
      });
      this.gridEl.appendChild(card);
    }
    const equipped = itemById(equippedId);
    if (equipped) this.noteEl.textContent = equipped.blurb;
  }
}
