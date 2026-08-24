import Phaser from 'phaser';
import { BALANCE } from '../data/balance';
import type { GameCore } from '../core/GameCore';
import type { GameEvent } from '../core/EventBus';
import { VFX_ANIMATIONS } from '../data/vfxAssets';
import { NinjaSprite } from './NinjaSprite';
import { TrashSlot, TRASH_PICKUP_RADIUS } from './TrashSlot';
import { theme } from './theme';
import type { Fx } from '../effects/Fx';
import type { Sfx } from '../audio/Sfx';

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
  private readonly boardFrame: Phaser.GameObjects.NineSlice;
  private readonly titlePlate: Phaser.GameObjects.NineSlice;
  private readonly title: Phaser.GameObjects.BitmapText;
  private readonly deck: Phaser.GameObjects.TileSprite;
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
    this.boardFrame = sceneRef.add
      .nineslice(b.x + b.w / 2, b.y + b.h / 2, 'game', 'frame_bezel', b.w, b.h, 20, 20, 20, 20)
      .setDepth(5);
    this.titlePlate = sceneRef.add
      .nineslice(b.x + b.w / 2, b.y + 28, 'game', 'banner_name_9', b.w - 42, 28, 11, 11, 7, 7)
      .setDepth(6);
    this.title = sceneRef.add
      .bitmapText(b.x + b.w / 2, b.y + 28, 'pixel', 'YOUR NINJAS', 14)
      .setOrigin(0.5)
      .setTint(0xffffff)
      .setDepth(7);
    this.contentMaskShape = sceneRef.add.graphics().setVisible(false);
    this.contentMask = this.contentMaskShape.createGeometryMask();
    this.add([this.deck, this.boardFrame, this.titlePlate, this.title]);

    for (let slot = 0; slot < BALANCE.board.slots; slot += 1) {
      const p = this.slotPos(slot);
      const pad = sceneRef
        .add.image(p.x, p.y + 6, 'game', 'tile_stone')
        .setScale(theme.layout.slots.tileScale)
        .setDepth(2.5);
      this.pads.push(pad);
      this.add(pad);
    }
    this.hoverOutline = sceneRef.add.graphics().setVisible(false).setDepth(4);
    this.add(this.hoverOutline);
    this.dragHint = sceneRef.add.container(0, 0, [
      sceneRef.add.circle(0, 4, 15, 0x000000, 0.22),
      sceneRef.add.circle(0, 0, 13, 0xfff6dd).setStrokeStyle(3, 0x3a2a12),
    ]).setVisible(false).setDepth(9);
    this.add(this.dragHint);
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
    this.boardFrame.setPosition(b.x + b.w / 2, b.y + b.h / 2).setSize(b.w, b.h);
    this.titlePlate.setPosition(b.x + b.w / 2, b.y + 28).setSize(b.w - 42, 28);
    this.title.setPosition(b.x + b.w / 2, b.y + 28);
    // Clip to the panel interior: below the title plate, in to the bezel. The
    // grid fills this box, so it must not stop short of the lower bezel.
    this.contentMaskShape.clear().fillRect(b.x + 22, b.y + 56, b.w - 44, b.h - 78);

    this.pads.forEach((pad, slot) => {
      const p = this.slotPos(slot);
      pad.setPosition(p.x, p.y + 6).setScale(theme.layout.slots.tileScale);
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
   * Grab whatever character the finger is actually over. The body is drawn
   * above its slot anchor, so hit-testing a radius around (x, y) meant tapping
   * the empty tile below a ninja picked it up while tapping its head did not.
   */
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
      this.sfx.play(trashHit ? 'sell' : 'drop');
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

  refreshExternalState(): void {
    if (this.fingerprint() !== this.boardFingerprint) this.syncFromCore();
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
        this.fx.mergeFlash(this.trash.x, this.trash.y);
        this.fx.coins(sprite.x, sprite.y, 4);
        this.sceneRef.tweens.add({
          targets: sprite,
          x: this.trash.x,
          y: this.trash.y + 20,
          scale: 0,
          alpha: 0,
          duration: 220,
          onComplete: () => {
            sprite.destroy();
            this.sprites.delete(event.id);
          },
        });
      }
      this.boardFingerprint = this.fingerprint();
    } else if (event.type === 'stateLoaded') {
      this.syncFromCore();
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
    for (const id of event.consumedIds) {
      const sprite = this.sprites.get(id);
      if (sprite !== undefined) {
        this.sceneRef.tweens.add({
          targets: sprite,
          x: target.x,
          y: target.y,
          alpha: 0.15,
          duration: 150,
          onComplete: () => {
            sprite.destroy();
            this.sprites.delete(id);
          },
        });
      }
    }
    this.sceneRef.time.delayedCall(155, () => this.fx.mergeFlash(target.x, target.y), undefined, this);
    this.sceneRef.time.delayedCall(245, () => {
      this.fx.merge(target.x, target.y, event.result.tier);
      this.sfx.play('merge', event.result.tier);
      const result = this.make(event.result.id, event.result.tier, event.toSlot, true);
      result.setScale(1.5);
      this.sceneRef.tweens.add({ targets: result, scale: 1, duration: 360, ease: 'Back.easeOut' });
      if (event.result.tier >= 5) this.fx.shake(event.result.tier >= 8 ? 0.011 : 0.006, 130);
    });
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
    const merge = VFX_ANIMATIONS.merge;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.8;
      const distance = 30 + Math.random() * 24;
      const tint = EMBER_TINTS[i % EMBER_TINTS.length] ?? 0xffd23f;
      const ember = this.sceneRef.add
        .sprite(x, y, merge.textureKey, 0)
        .setTint(tint)
        .setDepth(26)
        .setScale(0.12)
        .setMask(this.contentMask)
        .play(merge.animationKey);
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
    const smoke = VFX_ANIMATIONS.smoke;
    return this.sceneRef.add
      .sprite(x, y, smoke.textureKey, 0)
      .setTint(tint)
      .setDepth(depth)
      .setMask(this.contentMask)
      .play(smoke.animationKey);
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
