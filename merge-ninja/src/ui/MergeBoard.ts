import Phaser from 'phaser';
import { BALANCE } from '../data/balance';
import type { GameCore } from '../core/GameCore';
import type { GameEvent } from '../core/EventBus';
import { playVfx, vfxSource } from '../effects/vfxPlayback';
import { NinjaSprite } from './NinjaSprite';
import { TrashSlot, TRASH_PICKUP_RADIUS } from './TrashSlot';
import { SlotOverlays } from './SlotOverlays';
import { PanelChrome } from './PanelChrome';
import { theme } from './theme';
import type { Fx } from '../effects/Fx';
import type { Sfx } from '../audio/Sfx';
import { CLASSIC_DOJO_STYLE, type DojoStyleDef } from '../data/dojoStyles';

/**
 * Purchase-smoke beats. The whole sequence lands inside 450ms so rapid tapping
 * never queues up fog; the wall-clock guard below sweeps anything a hit-stop
 * stretched past its beat.
 */
const SMOKE = { peakMs: 150, cloudMs: 260, cloudStaggerMs: 30, revealMs: 190, blinkMs: 65, guardMs: 620 } as const;

/** Charcoal ramp for the three cloud layers, dark pouch first. */
const CLOUD_LAYERS = [
  { dx: -12, dy: -4, scale: 0.5, tint: 0x4a443c },
  { dx: 11, dy: 2, scale: 0.44, tint: 0x36322c },
  { dx: 0, dy: -12, scale: 0.4, tint: 0x59534a },
] as const;

/**
 * The tug a locked tile gives when it is pressed. Three short shudders across
 * roughly a quarter second: long enough to be read as a refusal, short enough
 * that a player mashing the board is never waiting on it.
 */
const LOCK_RATTLE = { shiftPx: 4, beatMs: 45, beats: 2, jolt: 1.07 } as const;

const EMBER_TINTS = [0xffd23f, 0xff9d3c, 0xfff4a8] as const;
/** Cool blue-white advertising a trade, against the gold that means merge. */
const SWAP_TINT = 0xbfe0ff;

type Hover =
  | { kind: 'trash' }
  | { kind: 'merge' | 'swap' | 'move'; slot: number }
  | { kind: 'none' };

/** One running purchase reveal: its art parts, its sprite, and its state. */
type SmokeRun = {
  parts: Phaser.GameObjects.Sprite[];
  sprite: NinjaSprite;
  revealed: boolean;
  reveal: Phaser.Tweens.Tween | null;
};

/** A clipped 4x3 roster: the board model and the presentation now agree. */
export class MergeBoard extends Phaser.GameObjects.Container {
  private readonly boardFrame: PanelChrome;
  private readonly titlePlate: Phaser.GameObjects.NineSlice;
  private readonly title: Phaser.GameObjects.BitmapText;
  private readonly deck: Phaser.GameObjects.TileSprite;
  private readonly padShadows: Phaser.GameObjects.Ellipse[] = [];
  private readonly pads: Phaser.GameObjects.Image[] = [];
  private readonly sprites = new Map<number, NinjaSprite>();
  private readonly contentMaskShape: Phaser.GameObjects.Graphics;
  private readonly contentMask: Phaser.Display.Masks.GeometryMask;
  private dragged: NinjaSprite | null = null;
  private dragSlot = -1;
  private dragOffsetY = 0;
  private boardFingerprint = 0;
  /** Neutral dashed-cell outline shown under an empty-slot drop target. */
  private readonly hoverOutline: Phaser.GameObjects.Graphics;
  /** The occupant currently nudged or leaned by hover feedback, to restore. */
  private feedbackSprite: NinjaSprite | null = null;
  /** Key of the hover state currently applied; empty string means none. */
  private feedbackKey = '';
  /** Live purchase smokes keyed by slot, so a re-buy interrupts its predecessor. */
  private readonly smokes = new Map<number, SmokeRun>();
  /**
   * The one-time drag demonstration: a fingertip sliding from one pulsing pad
   * to its match. Shown only while `core.metrics.merges` is still zero --
   * PLAN.md's "disappears forever after first merge" -- so a first-time
   * player is told what the pulse means instead of just seeing it glow.
   */
  private readonly dragHint: Phaser.GameObjects.Container;
  private dragHintTween: Phaser.Tweens.Tween | null = null;
  private style: DojoStyleDef = CLASSIC_DOJO_STYLE;
  private readonly overlays: SlotOverlays;
  /** Chevrons above the title plate showing how far the merge chain has run. */
  private readonly chainMeter: Phaser.GameObjects.Graphics;

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly core: GameCore,
    private readonly trash: TrashSlot,
    private readonly fx: Fx,
    private readonly sfx: Sfx,
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this);

    const b = theme.layout.board;
    this.deck = sceneRef.add
      .tileSprite(b.x + b.w / 2, b.y + b.h / 2, b.w - 16, b.h - 16, 'dojo_roster_deck')
      .setDepth(2);
    this.boardFrame = new PanelChrome(sceneRef, b, 'MERGE BOARD', 5);
    this.titlePlate = sceneRef.add
      .nineslice(b.x + b.w / 2, b.y + 39, 'game', 'banner_name_9', b.w - 52, 26, 11, 11, 7, 7)
      .setTint(theme.colors.woodDark)
      .setDepth(6);
    this.title = sceneRef.add
      .bitmapText(b.x + b.w / 2, b.y + 39, 'pixel', 'YOUR NINJAS', 13)
      .setOrigin(0.5)
      .setTint(0xf2dfaa)
      .setDepth(7);
    this.contentMaskShape = sceneRef.add.graphics().setVisible(false);
    this.contentMask = this.contentMaskShape.createGeometryMask();
    this.add([this.deck, this.titlePlate, this.title]);

    for (let slot = 0; slot < BALANCE.board.slots; slot += 1) {
      const p = this.slotPos(slot);
      const shadow = sceneRef
        .add.ellipse(p.x, p.y + 15, 78, 20, 0x070505, 0.34)
        .setDepth(2.4);
      const pad = sceneRef
        .add.image(p.x, p.y + 6, 'game', 'tile_stone')
        .setScale(theme.layout.slots.tileScale)
        .setDepth(2.5);
      this.padShadows.push(shadow);
      this.pads.push(pad);
      this.add([shadow, pad]);
    }
    this.refreshLockedPads();
    this.hoverOutline = sceneRef.add.graphics().setVisible(false).setDepth(4);
    this.add(this.hoverOutline);
    this.dragHint = sceneRef.add.container(0, 0, [
      sceneRef.add.circle(0, 4, 15, 0x000000, 0.22),
      sceneRef.add.circle(0, 0, 13, 0xfff6dd).setStrokeStyle(3, 0x3a2a12),
    ]).setVisible(false).setDepth(9);
    this.add(this.dragHint);
    this.overlays = new SlotOverlays(sceneRef, core, (slot) => this.slotPos(slot), fx, sfx);
    this.chainMeter = sceneRef.add.graphics().setDepth(7.5);
    this.add(this.chainMeter);
    core.events.on('mergeComboRewarded', () => this.playChainPayout());
    this.relayout();
    core.events.onAny((event) => this.handle(event));
  }

  slotPos(slot: number): { x: number; y: number } {
    const col = slot % BALANCE.board.cols;
    const row = Math.floor(slot / BALANCE.board.cols);
    return {
      x: theme.layout.slots.startX + col * theme.layout.slots.gapX,
      y: theme.layout.slots.startY + row * theme.layout.slots.gapY,
    };
  }

  relayout(): void {
    const b = theme.layout.board;
    this.deck
      .setPosition(b.x + b.w / 2, b.y + b.h / 2)
      .setSize(b.w - 16, b.h - 16);
    this.boardFrame.relayout(b);
    this.titlePlate.setPosition(b.x + b.w / 2, b.y + 39).setSize(b.w - 52, 26);
    this.title.setPosition(b.x + b.w / 2, b.y + 39);
    // Clip to the panel interior: below the title plate, in to the bezel. The
    // grid fills this box, so it must not stop short of the lower bezel.
    this.contentMaskShape.clear().fillRect(b.x + 22, b.y + 56, b.w - 44, b.h - 78);

    this.pads.forEach((pad, slot) => {
      const p = this.slotPos(slot);
      pad.setPosition(p.x, p.y + 6).setScale(theme.layout.slots.tileScale);
      this.padShadows[slot]?.setPosition(p.x, p.y + 15).setScale(theme.layout.slots.tileScale, theme.layout.slots.tileScale);
    });
    for (const [id, sprite] of this.sprites) {
      const slot = this.findSlot(id);
      if (slot < 0) continue;
      const p = this.slotPos(slot);
      sprite.setHome(p.x, p.y);
      sprite.setRosterScale(theme.layout.slots.spriteScale);
      if (sprite !== this.dragged) sprite.setPosition(p.x, p.y);
    }
  }

  /**
   * A locked slot wears a different pad, not a decoration over the same one.
   *
   * Crossed bars drawn over the live ivory tile read as ornament: the stone
   * underneath stayed exactly as warm and usable as its eleven neighbours, so
   * nothing said the cell was shut. `slot_locked` is that same tile gone cold
   * and chained, which is legible before any icon is read -- and being one
   * texture swap on one image, it costs a frame nothing.
   */
  private refreshLockedPads(): void {
    const locked = new Set(this.core.lockedSlots);
    this.pads.forEach((pad, slot) => {
      if (locked.has(slot)) pad.setTexture('slot_locked');
      else pad.setTexture('game', 'tile_stone');
    });
  }

  applyDojoStyle(style: DojoStyleDef): void {
    this.style = style;
    this.deck.setTint(style.palette.board);
    this.boardFrame.applyDojoStyle(style);
    this.titlePlate.setTint(style.palette.panelDark);
    this.title.setTint(style.id === 'crimson-dojo' ? 0xfff1c2 : 0xf2dfaa);
    this.pads.forEach((pad) => pad.setTint(style.palette.slot));
    this.sprites.forEach((sprite) => sprite.applyDojoStyle(style));
    this.overlays.applyDojoStyle(style);
  }

  /**
   * Grab whatever character the finger is actually over. The body is drawn
   * above its slot anchor, so hit-testing a radius around (x, y) meant tapping
   * the empty tile below a ninja picked it up while tapping its head did not.
   */
  /**
   * A press on a slot the run has not earned yet.
   *
   * Nothing else on the board can say no. A locked cell holds no character to
   * pick up and accepts no drop, so a player testing one gets silence back,
   * which reads as a game that has stopped responding rather than as a rule.
   * The tile now tugs against its chain and the lock rattles; the caller pairs
   * that with the coach card naming the stage that opens it.
   *
   * Returns the slot pressed, or null if the press was not on a locked one.
   */
  pressLocked(pointer: Phaser.Input.Pointer): number | null {
    const radius = theme.layout.slots.radius;
    for (const slot of this.core.lockedSlots) {
      const at = this.slotPos(slot);
      if (Phaser.Math.Distance.Between(pointer.x, pointer.y, at.x, at.y + 6) > radius) continue;
      this.rattleLock(slot);
      return slot;
    }
    return null;
  }

  /** Test seam: how far a pad has been shoved from its resting place. */
  padOffset(slot: number): number {
    const pad = this.pads[slot];
    if (pad === undefined) return 0;
    return pad.x - this.slotPos(slot).x;
  }

  private rattleLock(slot: number): void {
    const pad = this.pads[slot];
    if (pad === undefined) return;
    const home = this.slotPos(slot);
    const base = theme.layout.slots.tileScale;
    this.sceneRef.tweens.killTweensOf(pad);
    pad.setPosition(home.x, home.y + 6).setScale(base);
    this.sfx.play('error');
    this.sceneRef.tweens.add({
      targets: pad,
      x: home.x + LOCK_RATTLE.shiftPx,
      duration: LOCK_RATTLE.beatMs,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: LOCK_RATTLE.beats,
      // The shudder ends wherever the last half-beat left it, so the tile is
      // put back by hand rather than trusted to land home.
      onComplete: () => pad.setPosition(home.x, home.y + 6).setScale(base),
    });
    this.sceneRef.tweens.add({
      targets: pad,
      scale: base * LOCK_RATTLE.jolt,
      duration: LOCK_RATTLE.beatMs * 1.5,
      ease: 'Quad.easeOut',
      yoyo: true,
    });
  }

  beginDrag(pointer: Phaser.Input.Pointer): boolean {
    let candidate: NinjaSprite | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const sprite of this.sprites.values()) {
      // A recruit still hidden inside its purchase smoke cannot be grabbed.
      if (!sprite.visible) continue;
      const bounds = sprite.grabBounds();
      if (!bounds.contains(pointer.x, pointer.y)) continue;
      const distance = Phaser.Math.Distance.Between(pointer.x, pointer.y, sprite.x, sprite.bodyCenterY());
      if (distance < best) {
        best = distance;
        candidate = sprite;
      }
    }
    if (candidate === null) return false;

    this.dragged = candidate;
    this.dragSlot = this.findSlot(candidate.id);
    if (this.dragSlot < 0) {
      this.dragged = null;
      return false;
    }

    // Carry the character by its body, not by its feet, so it does not jump
    // out from under the finger the moment the drag starts.
    this.dragOffsetY = candidate.y - candidate.bodyCenterY();
    candidate.setDepth(100).setScale(1.15).setAngle(-7);
    this.sfx.play('pickup');
    return true;
  }

  moveDrag(pointer: Phaser.Input.Pointer): void {
    if (this.dragged === null) return;

    const carry = this.carryPosition(pointer);
    this.dragged.setPosition(carry.x, carry.y);

    // Feedback states only rebuild on a real change, but the merge magnet
    // keeps tracking the finger every frame while its state holds.
    const hover = this.hoverAt(pointer);
    const key = this.hoverKey(hover);
    if (key !== this.feedbackKey) {
      this.feedbackKey = key;
      this.clearFeedback();
      this.applyHover(hover);
    }
    if (hover.kind === 'merge') {
      const occupant = this.occupantOf(hover.slot);
      if (occupant !== null) this.nudgeToward(occupant, pointer);
    }
  }

  endDrag(pointer: Phaser.Input.Pointer): void {
    const sprite = this.dragged;
    if (sprite === null) return;

    const hover = this.hoverAt(pointer);
    const trashHit = hover.kind === 'trash';
    const result = trashHit
      ? this.core.drop(this.dragSlot, { kind: 'trash' })
      : hover.kind === 'merge' || hover.kind === 'swap' || hover.kind === 'move'
        ? this.core.drop(this.dragSlot, { kind: 'slot', slot: hover.slot })
        : 'rejected';

    this.feedbackKey = '';
    this.clearFeedback();
    if (result === 'rejected') {
      this.sfx.play('error');
      this.sceneRef.tweens.add({
        targets: sprite,
        x: sprite.homeX,
        y: sprite.homeY,
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        duration: 180,
        ease: 'Back.easeOut',
        onComplete: () => this.shakeSprite(sprite),
      });
    } else {
      sprite.setScale(1).setAngle(0);
      this.sfx.play(result === 'swapped' ? 'swap' : trashHit ? 'sell' : 'drop');
    }
    sprite.setDepth(3);
    this.dragged = null;
    this.dragSlot = -1;
  }

  /** Tiny horizontal wobble after a rejected drop: the drop "bounced". */
  private shakeSprite(sprite: NinjaSprite): void {
    this.sceneRef.tweens.add({
      targets: sprite,
      x: sprite.homeX + 3,
      yoyo: true,
      repeat: 1,
      duration: 45,
      ease: 'Sine.easeInOut',
      onComplete: () => sprite.setPosition(sprite.homeX, sprite.homeY),
    });
  }

  /**
   * The five pre-release outcomes a 6-year-old has to tell apart by colour and
   * shape alone: gold pulse + magnet for merge, cool blue-white + lean for
   * swap, faint outline for a move, red glow + wobble on the bin, nothing at
   * all when the release would bounce.
   */
  private hoverAt(pointer: Phaser.Input.Pointer): Hover {
    if (this.overTrash(pointer)) return { kind: 'trash' };
    if (this.dragged === null) return { kind: 'none' };
    const slot = this.targetSlot(pointer);
    if (slot === null || slot === this.dragSlot) return { kind: 'none' };
    const other = this.core.board.at(slot);
    if (other === null) return { kind: 'move', slot };
    if (other.tier !== this.dragged.tier) return { kind: 'swap', slot };
    // Two maxed-out ninjas cannot merge; their drop resolves as a trade
    // (see the max-tier pair test in tests/merge.test.ts), so it advertises
    // the swap look rather than the merge gold.
    return { kind: 'swap', slot };
  }

  private hoverKey(hover: Hover): string {
    return hover.kind === 'merge' || hover.kind === 'swap' || hover.kind === 'move'
      ? `${hover.kind}:${hover.slot}`
      : hover.kind;
  }

  private applyHover(hover: Hover): void {
    if (hover.kind === 'none') return;
    if (hover.kind === 'trash') {
      this.trash.setTrashActive(true);
      return;
    }
    const occupant = this.occupantOf(hover.slot);
    if (hover.kind === 'move') {
      this.showOutline(hover.slot);
    } else if (hover.kind === 'merge' && occupant !== null) {
      this.glowMergePad(hover.slot);
      this.nudgeToward(occupant, null);
      this.feedbackSprite = occupant;
    } else if (hover.kind === 'swap' && occupant !== null) {
      this.tintSwapPad(hover.slot);
      this.leanAside(occupant);
      this.feedbackSprite = occupant;
    }
  }

  private occupantOf(slot: number): NinjaSprite | null {
    const ninja = this.core.board.at(slot);
    if (ninja === null) return null;
    const sprite = this.sprites.get(ninja.id);
    return sprite ?? null;
  }

  /** Merge target: the occupant is tugged toward the incoming character. */
  private nudgeToward(occupant: NinjaSprite, pointer: Phaser.Input.Pointer | null): void {
    const dragged = this.dragged;
    if (dragged === null) return;
    const dx = (pointer?.x ?? dragged.x) - occupant.homeX;
    const dy = (pointer?.y ?? dragged.y) - occupant.homeY;
    const length = Math.hypot(dx, dy) || 1;
    const pull = Math.min(6, length * 0.12);
    occupant.setPosition(occupant.homeX + (dx / length) * pull, occupant.homeY + (dy / length) * pull);
    this.feedbackSprite = occupant;
  }

  /** Swap target: the occupant leans 4px away from the character coming in. */
  private leanAside(occupant: NinjaSprite): void {
    const dragged = this.dragged;
    if (dragged === null) return;
    const sign = dragged.x >= occupant.homeX ? -1 : 1;
    occupant.setPosition(occupant.homeX + sign * 4, occupant.homeY).setAngle(sign * 4);
    this.feedbackSprite = occupant;
  }

  private glowMergePad(slot: number): void {
    const pad = this.pads[slot];
    if (pad === undefined) return;
    const base = theme.layout.slots.tileScale;
    pad.setTint(theme.colors.slotActive);
    this.sceneRef.tweens.add({
      targets: pad,
      scale: base * 1.16,
      yoyo: true,
      repeat: -1,
      duration: 105,
    });
  }

  private tintSwapPad(slot: number): void {
    const pad = this.pads[slot];
    if (pad === undefined) return;
    pad.setTint(SWAP_TINT).setScale(theme.layout.slots.tileScale * 1.05);
  }

  /** Empty-cell move target reads as a place, not an action: quiet outline. */
  private showOutline(slot: number): void {
    const p = this.slotPos(slot);
    const w = theme.layout.slots.gapX - 18;
    const h = theme.layout.slots.gapY - 16;
    this.hoverOutline
      .clear()
      .lineStyle(3, 0xffffff, 0.35)
      .strokeRoundedRect(p.x - w / 2, p.y - h / 2 + 6, w, h, 10)
      .setVisible(true);
  }

  private hideOutline(): void {
    this.hoverOutline.clear().setVisible(false);
  }

  /** Undoes every positional/visual nudge hover feedback ever applied. */
  private resetFeedbackSprite(): void {
    if (this.feedbackSprite === null) return;
    this.feedbackSprite.setPosition(this.feedbackSprite.homeX, this.feedbackSprite.homeY).setAngle(0);
    this.feedbackSprite = null;
  }

  /** Reconcile the presentation with the authoritative board after non-streamed state changes. */
  syncFromCore(): void {
    for (let slot = 0; slot < BALANCE.board.slots; slot += 1) {
      const ninja = this.core.board.at(slot);
      if (ninja === null) continue;
      const sprite = this.sprites.get(ninja.id);
      if (sprite === undefined) this.make(ninja.id, ninja.tier, slot, true);
      else {
        const p = this.slotPos(slot);
        sprite.setHome(p.x, p.y);
        sprite.setRosterScale(theme.layout.slots.spriteScale);
        if (sprite !== this.dragged) sprite.setPosition(p.x, p.y);
      }
    }
    for (const [id, sprite] of this.sprites) {
      if (this.findSlot(id) >= 0) continue;
      sprite.destroy();
      this.sprites.delete(id);
    }
    this.boardFingerprint = this.fingerprint();
  }

  refreshExternalState(dtMs = 0): void {
    if (this.fingerprint() !== this.boardFingerprint) this.syncFromCore();
    this.overlays.update(dtMs);
    this.refreshTitle();
    this.drawChainMeter();
  }

  /**
   * Four chevrons that fill with the chain and drain as its window closes.
   *
   * The drain is the point: a meter that only counted up would tell the player
   * they have a chain but not that it is about to end, and the whole skill the
   * chain asks for is lining the next pair up before the current one lands.
   */
  private drawChainMeter(): void {
    const { count, windowMs, target } = this.core.mergeCombo;
    const g = this.chainMeter.clear();
    if (count <= 0) return;

    const b = theme.layout.board;
    const p = this.style.palette;
    const width = 15;
    const gap = 7;
    const span = target * width + (target - 1) * gap;
    const left = b.x + b.w / 2 - span / 2;
    const y = b.y + 58;
    // The last part of the window drains the whole row, so the closing gap is
    // visible without adding a second widget to read.
    const fade = windowMs < 600 ? Math.max(0.15, windowMs / 600) : 1;

    for (let i = 0; i < target; i += 1) {
      const lit = i < count;
      const x = left + i * (width + gap);
      g.lineStyle(4, lit ? p.accentBright : p.panelDark, lit ? fade : 0.5);
      g.beginPath();
      g.moveTo(x, y + 5);
      g.lineTo(x + width / 2, y - 5);
      g.lineTo(x + width, y + 5);
      g.strokePath();
    }
  }

  /** The chevrons converge into the board centre and hand over the powerup. */
  private playChainPayout(): void {
    const b = theme.layout.board;
    const x = b.x + b.w / 2;
    const y = b.y + 58;
    this.fx.mergeFlash(x, y);
    this.fx.shake(0.004, 90);
    this.sfx.play('newTier');
    const ring = this.sceneRef.add
      .image(x, y, 'game', 'fx_ring')
      .setDepth(9.5)
      .setTint(this.style.palette.vfx)
      .setScale(0.2);
    this.sceneRef.tweens.add({
      targets: ring,
      scale: 1.5,
      alpha: 0,
      duration: 400,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * The board's own title advertises the next reward.
   *
   * The unlock ladder is the only thing on screen that tells a player a
   * concrete good thing is a known number of stages away, so it is worth the
   * one line it costs -- and it costs nothing once the board is whole.
   */
  private refreshTitle(): void {
    const stage = this.core.nextUnlockStage;
    const wanted = stage === null ? 'YOUR NINJAS' : `NEXT SLOT - STAGE ${stage}`;
    if (this.title.text !== wanted) this.title.setText(wanted);
  }

  /** Apply streamed portrait strips to roster units already on the board. */
  refreshPortraits(): void {
    for (const sprite of this.sprites.values()) sprite.refreshPortrait();
  }

  private handle(event: GameEvent): void {
    if (event.type === 'ninjaSpawned') {
      // Every unit that arrives through this event was just created by
      // core.buy() or a debug spawnTier() -- cost is always >= 0 here. Units
      // restored from a save never reach it: GameCore's constructor replays
      // them straight into board.load() and announces 'stateLoaded', which
      // this class answers with a silent syncFromCore(). So the smoke below
      // plays for live purchases only, never on boot, load, or relayout.
      const slot = event.ninja.slot;
      const sprite = this.make(event.ninja.id, event.ninja.tier, slot, false);
      this.playPurchaseSmoke(slot, sprite);
      this.boardFingerprint = this.fingerprint();
    } else if (event.type === 'ninjaMoved') {
      // If the hidden recruit is dragged out of its smoke cell mid-puff, show
      // it at once rather than letting it travel invisible.
      this.finalizeSmoke(event.id, 'reveal');
      const sprite = this.sprites.get(event.id);
      if (sprite !== undefined) {
        const p = this.slotPos(event.to);
        sprite.setHome(p.x, p.y);
        this.sceneRef.tweens.add({ targets: sprite, x: p.x, y: p.y, duration: 140 });
      }
      this.boardFingerprint = this.fingerprint();
    } else if (event.type === 'ninjaSwapped') {
      // Both characters travel at once; the endDrag snap already played the
      // drop cue, so this stays silent.
      this.finalizeSmoke(event.ids[0], 'reveal');
      this.finalizeSmoke(event.ids[1], 'reveal');
      const home = this.slotPos(event.fromSlot);
      const away = this.slotPos(event.toSlot);
      const leaving = this.sprites.get(event.ids[0]);
      const standing = this.sprites.get(event.ids[1]);
      if (leaving !== undefined) {
        leaving.setHome(away.x, away.y);
        this.sceneRef.tweens.add({ targets: leaving, x: away.x, y: away.y, duration: 140 });
      }
      if (standing !== undefined) {
        standing.setHome(home.x, home.y);
        this.sceneRef.tweens.add({ targets: standing, x: home.x, y: home.y, duration: 140 });
      }
      this.boardFingerprint = this.fingerprint();
    } else if (event.type === 'ninjaMerged') {
      for (const id of event.consumedIds) this.finalizeSmoke(id, 'cancel');
      this.animateMerge(event);
      this.boardFingerprint = this.fingerprint();
    } else if (event.type === 'ninjaSold') {
      this.finalizeSmoke(event.id, 'cancel');
      const sprite = this.sprites.get(event.id);
      if (sprite !== undefined) {
        this.fx.coins(sprite.x, sprite.y, 4);
        this.sceneRef.tweens.add({
          targets: sprite,
          x: this.trash.x,
          y: this.trash.y + 20,
          scaleX: 0.12,
          scaleY: 0.04,
          alpha: 0,
          angle: sprite.x < this.trash.x ? 16 : -16,
          duration: 210,
          ease: 'Cubic.easeIn',
          onComplete: () => {
            this.fx.mergeFlash(this.trash.x, this.trash.y);
            this.trash.consume();
            sprite.destroy();
            this.sprites.delete(event.id);
          },
        });
      }
      this.boardFingerprint = this.fingerprint();
    } else if (event.type === 'stateLoaded') {
      this.syncFromCore();
      this.refreshLockedPads();
    } else if (event.type === 'slotUnlocked') {
      this.refreshLockedPads();
    } else if (event.type === 'mergeHint') {
      for (const slot of event.slots) this.pulse(slot);
      if (this.core.metrics.merges === 0) this.showDragHint(event.slots[0], event.slots[1]);
    }
  }

  /** One fingertip sliding pad-to-pad and back, twice, then gone for good. */
  private showDragHint(fromSlot: number, toSlot: number): void {
    this.dragHintTween?.stop();
    const from = this.slotPos(fromSlot);
    const to = this.slotPos(toSlot);
    this.dragHint.setPosition(from.x, from.y).setAlpha(0).setScale(1).setVisible(true);
    this.sceneRef.tweens.add({ targets: this.dragHint, alpha: 1, duration: 180 });
    this.dragHintTween = this.sceneRef.tweens.add({
      targets: this.dragHint,
      x: { from: from.x, to: to.x },
      y: { from: from.y, to: to.y },
      scale: { from: 1, to: 0.82 },
      duration: 520,
      hold: 160,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.sceneRef.tweens.add({
          targets: this.dragHint,
          alpha: 0,
          duration: 200,
          onComplete: () => this.dragHint.setVisible(false),
        });
      },
    });
  }

  private animateMerge(event: Extract<GameEvent, { type: 'ninjaMerged' }>): void {
    const target = this.slotPos(event.toSlot);
    for (const [index, id] of event.consumedIds.entries()) {
      const sprite = this.sprites.get(id);
      if (sprite !== undefined) {
        this.sceneRef.tweens.add({
          targets: sprite,
          x: target.x,
          y: target.y,
          scaleX: 0.68,
          scaleY: 1.16,
          angle: index === 0 ? 8 : -8,
          alpha: 0.2,
          duration: 175,
          ease: 'Cubic.easeIn',
          onComplete: () => {
            sprite.destroy();
            this.sprites.delete(id);
          },
        });
      }
    }
    this.sceneRef.time.delayedCall(135, () => this.fx.mergeFlash(target.x, target.y), undefined, this);
    this.sceneRef.time.delayedCall(225, () => {
      this.fx.merge(target.x, target.y, event.result.tier);
      if (this.style.id === 'crimson-dojo') this.embers(target.x, target.y - 30, 9);
      this.sfx.play('merge', event.result.tier);
      const result = this.make(event.result.id, event.result.tier, event.toSlot, true);
      result.setScale(1.36, 0.82).setAlpha(0.2).setY(target.y - 8);
      this.sceneRef.tweens.add({
        targets: result,
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        y: target.y,
        duration: 330,
        ease: 'Back.easeOut',
      });
      if (event.result.tier >= 5) {
        this.sceneRef.time.delayedCall(80, () => this.fx.mergeFlash(target.x, target.y), undefined, this);
      }
      if (event.result.tier >= 5) this.fx.shake(event.result.tier >= 8 ? 0.011 : 0.006, 130);
      this.escalateForChain(target.x, target.y);
    });
  }

  /**
   * Layers extra spectacle onto a merge as the chain grows.
   *
   * Deliberately additive: the authored merge animation is untouched, and each
   * chain step only adds one thing on top of it. A chain that rewrote the
   * merge would make the core verb feel different depending on state, which is
   * exactly the confusion the escalation is meant to avoid.
   */
  private escalateForChain(x: number, y: number): void {
    const { count } = this.core.mergeCombo;
    if (count >= 2) this.fx.mergeFlash(x, y);
    if (count >= 3) this.fx.shake(0.003, 70);
  }

  /**
   * The buy moment: a charcoal pouch pops, smoke swallows the cell, and the
   * new recruit bounces out of it at the cloud's peak with a badge blink and
   * a handful of embers. Re-buying into the same slot cancels any smoke still
   * running there, so rapid tapping never stacks fog.
   */
  private playPurchaseSmoke(slot: number, sprite: NinjaSprite): void {
    this.cancelSmoke(slot);
    const p = this.slotPos(slot);
    const parts: Phaser.GameObjects.Sprite[] = [];

    // (a) The pouch lands: a small dark puff that pops and lifts away.
    this.sfx.play('drop');
    const pouch = this.maskedPuff(p.x, p.y + 8, 0x26231f, 22);
    pouch.setScale(0.04).setAlpha(0);
    this.sceneRef.tweens.add({ targets: pouch, scale: 0.2, alpha: 0.95, duration: 100, ease: 'Back.easeOut' });
    this.sceneRef.tweens.add({ targets: pouch, alpha: 0, y: p.y - 4, delay: 110, duration: 130, onComplete: () => pouch.destroy() });
    parts.push(pouch);

    // (b) Three layered clouds bloom fast enough to cover the whole cell.
    for (let i = 0; i < CLOUD_LAYERS.length; i += 1) {
      const layer = CLOUD_LAYERS[i];
      if (layer === undefined) continue;
      const puff = this.maskedPuff(p.x + layer.dx, p.y + layer.dy, layer.tint, 20 + i * 0.1);
      puff.setScale(0.12).setAlpha(0.95).setAngle(i % 2 === 0 ? 12 : -9);
      this.sceneRef.tweens.add({
        targets: puff,
        scale: layer.scale,
        alpha: 0,
        angle: puff.angle * 2,
        duration: SMOKE.cloudMs,
        delay: i * SMOKE.cloudStaggerMs,
        ease: 'Cubic.easeOut',
        onComplete: () => puff.destroy(),
      });
      parts.push(puff);
    }

    // (c) The ninja stays hidden until the cloud peaks, then pops out.
    const run: SmokeRun = { parts, sprite, revealed: false, reveal: null };
    this.smokes.set(slot, run);
    sprite.setVisible(false).setScale(0);
    this.sceneRef.time.delayedCall(SMOKE.peakMs, () => {
      if (this.smokes.get(slot) !== run) return;
      this.revealSpawned(run, p.x, p.y);
    }, undefined, this);

    // Wall-clock sweep: a hit-stop slows scene tweens and timers alike, so
    // cleanup cannot trust them to ever finish on their own.
    window.setTimeout(() => {
      if (!this.sceneRef.scene.isActive()) {
        this.smokes.delete(slot);
        return;
      }
      if (this.smokes.get(slot) !== run) return;
      if (!run.revealed) {
        run.revealed = true;
        sprite.setVisible(true).setScale(1);
      }
      for (const part of run.parts) {
        this.sceneRef.tweens.killTweensOf(part);
        part.destroy();
      }
      this.smokes.delete(slot);
    }, SMOKE.guardMs);
  }

  /** Pop the recruit out of the smoke: bounce, badge blink, embers, cue. */
  private revealSpawned(run: SmokeRun, x: number, y: number): void {
    run.revealed = true;
    this.sfx.play('pickup');
    run.sprite.setVisible(true).setScale(0);
    run.reveal = this.sceneRef.tweens.add({ targets: run.sprite, scale: 1, duration: SMOKE.revealMs, ease: 'Back.easeOut' });
    this.sceneRef.tweens.add({
      targets: run.sprite.badge,
      alpha: 0,
      yoyo: true,
      repeat: 3,
      duration: SMOKE.blinkMs,
      onComplete: () => {
        run.sprite.badge.setAlpha(1);
      },
    });
    this.embers(x, y - 40, 5);
  }

  private embers(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.8;
      const distance = 30 + Math.random() * 24;
      const crimsonTints = [this.style.palette.vfx, this.style.palette.accentBright, 0xffffff] as const;
      const palette = this.style.id === 'crimson-dojo' ? crimsonTints : EMBER_TINTS;
      const tint = palette[i % palette.length] ?? 0xffd23f;
      const source = vfxSource(this.sceneRef, 'merge');
      const ember = this.sceneRef.add
        .sprite(x, y, source.texture, source.frame)
        .setTint(tint)
        .setDepth(26)
        .setScale(0.12)
        .setMask(this.contentMask);
      playVfx(this.sceneRef, ember, 'merge');
      this.sceneRef.tweens.add({
        targets: ember,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance - 10,
        scale: 0.03,
        alpha: 0,
        duration: 220 + Math.random() * 80,
        ease: 'Quad.easeOut',
        onComplete: () => ember.destroy(),
      });
    }
  }

  private maskedPuff(x: number, y: number, tint: number, depth: number): Phaser.GameObjects.Sprite {
    const source = vfxSource(this.sceneRef, 'smoke');
    const puff = this.sceneRef.add
      .sprite(x, y, source.texture, source.frame)
      .setTint(tint)
      .setDepth(depth)
      .setMask(this.contentMask);
    playVfx(this.sceneRef, puff, 'smoke');
    return puff;
  }

  /**
   * Ends whatever smoke owns `id`. 'reveal' shows a sprite that was still
   * hidden (it left its cell alive); 'cancel' just clears the art because the
   * sprite's own animation takes over.
   */
  private finalizeSmoke(id: number, mode: 'reveal' | 'cancel'): void {
    for (const [slot, run] of this.smokes) {
      if (run.sprite.id !== id) continue;
      if (!run.revealed && mode === 'reveal' && run.sprite.active) {
        run.reveal?.remove();
        this.revealSpawned(run, run.sprite.x, run.sprite.y);
      } else if (!run.revealed && mode === 'cancel') {
        run.revealed = true;
        run.sprite.setVisible(true).setScale(1);
      }
      for (const part of run.parts) {
        this.sceneRef.tweens.killTweensOf(part);
        part.destroy();
      }
      this.smokes.delete(slot);
      return;
    }
  }

  private cancelSmoke(slot: number): void {
    const run = this.smokes.get(slot);
    if (run === undefined) return;
    for (const part of run.parts) {
      this.sceneRef.tweens.killTweensOf(part);
      part.destroy();
    }
    run.reveal?.remove();
    this.smokes.delete(slot);
  }

  private make(id: number, tier: number, slot: number, visible: boolean): NinjaSprite {
    const existing = this.sprites.get(id);
    if (existing !== undefined) return existing;

    const p = this.slotPos(slot);
    const sprite = new NinjaSprite(this.sceneRef, id, tier, p.x, p.y);
    sprite.applyDojoStyle(this.style);
    sprite.setDepth(3).setVisible(visible).setMask(this.contentMask);
    sprite.setRosterScale(theme.layout.slots.spriteScale);
    this.sprites.set(id, sprite);
    return sprite;
  }

  private findSlot(id: number): number {
    return this.core.board.slots.findIndex((ninja) => ninja?.id === id);
  }

  /** The carried character rides under the finger by its body, not its feet. */
  private carryPosition(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    return { x: pointer.x, y: pointer.y + this.dragOffsetY };
  }

  /**
   * A slot occupies a whole cell -- the tile plus the character standing on it
   * -- but its anchor is the tile. Aiming at the middle of the cell instead of
   * the anchor means a drop reads the same whether the player let go over the
   * empty tile or over the ninja drawn above it.
   */
  private targetSlot(pointer: Phaser.Input.Pointer): number | null {
    return this.nearestSlot(pointer.x, pointer.y + theme.layout.slots.gapY * 0.42);
  }

  private overTrash(pointer: Phaser.Input.Pointer): boolean {
    return (
      Phaser.Math.Distance.Between(pointer.x, pointer.y, this.trash.x, this.trash.y) <=
      theme.layout.trash.radius * TRASH_PICKUP_RADIUS
    );
  }

  private nearestSlot(x: number, y: number): number | null {
    let nearest: number | null = null;
    let distance = theme.layout.slots.snapRadius;
    for (let slot = 0; slot < BALANCE.board.slots; slot += 1) {
      const p = this.slotPos(slot);
      const candidateDistance = Phaser.Math.Distance.Between(x, y, p.x, p.y);
      if (candidateDistance <= distance) {
        nearest = slot;
        distance = candidateDistance;
      }
    }
    return nearest;
  }

  private fingerprint(): number {
    let hash = 17;
    for (const ninja of this.core.board.slots) hash = Math.imul(hash, 31) + (ninja === null ? 0 : ninja.id * 17 + ninja.tier);
    return hash;
  }

  /**
   * Every hover state dies here: pad tints and pulses, the occupant nudge or
   * lean, the empty-cell outline, the bin's glow. endDrag calls it whatever
   * the outcome was.
   */
  private clearFeedback(): void {
    for (const pad of this.pads) {
      this.sceneRef.tweens.killTweensOf(pad);
      pad.clearTint().setScale(theme.layout.slots.tileScale);
    }
    this.resetFeedbackSprite();
    this.hideOutline();
    this.trash.setTrashActive(false);
  }

  private pulse(slot: number): void {
    const pad = this.pads[slot];
    if (pad === undefined) return;
    const base = theme.layout.slots.tileScale;
    pad.setTint(theme.colors.slotActive);
    this.sceneRef.tweens.add({
      targets: pad,
      scale: base * 1.16,
      yoyo: true,
      repeat: 2,
      duration: 150,
      onComplete: () => pad.clearTint().setScale(base),
    });
  }

  pulseMergeable(): void {
    for (let first = 0; first < BALANCE.board.slots; first += 1) {
      for (let second = first + 1; second < BALANCE.board.slots; second += 1) {
        const left = this.core.board.at(first);
        const right = this.core.board.at(second);
        if (left !== null && right !== null && left.tier === right.tier) {
          this.pulse(first);
          this.pulse(second);
          return;
        }
      }
    }
  }
}
