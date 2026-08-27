import Phaser from 'phaser';
import type { GameCore } from '../core/GameCore';
import { BALANCE } from '../data/balance';
import { DRAFT_CARDS, DRAFT_SHAPE_ORDER, type DraftCardId } from '../data/draftCards';
import type { DojoStyleDef } from '../data/dojoStyles';
import { bossForStage } from '../data/enemies';
import type { Sfx } from '../audio/Sfx';
import type { Fx } from '../effects/Fx';
import type { VFXManager } from '../effects/VFXManager';
import { ATLAS_KEY, FX_FRAMES, ninjaFrame } from '../render/atlasConfig';
import { theme } from './theme';

const CARD_W = 152;
const CARD_H = 196;
const CARD_GAP = 12;
const ICON_SIZE = 68;
/** Corner radius, shared by the shadow, the border and the face. */
const RADIUS = 13;
/** How far the outer cards tilt, so the row reads as a hand rather than a toolbar. */
const FAN_ANGLE = 5;
const FAN_LIFT = 7;

type CardFace = { face: number; ink: number; glyph: number; band: number; bandInk: number };

interface Dealt {
  readonly id: DraftCardId;
  readonly root: Phaser.GameObjects.Container;
  /** Everything printed on the front, hidden while the card is face down. */
  readonly front: Phaser.GameObjects.Container;
  readonly back: Phaser.GameObjects.Container;
  readonly border: Phaser.GameObjects.Graphics;
  readonly restX: number;
  readonly restY: number;
  readonly restAngle: number;
}

/**
 * The three cards offered on a boss kill.
 *
 * Deliberately not a modal: nothing here pauses the simulation, nothing dims
 * the arena, and the row sits clear of the board so a player mid-drag is never
 * interrupted.
 *
 * They are dealt rather than shown. Three backs fly out of the boss that just
 * died, land in a slight fan, and turn face up one after another -- which is
 * the whole reason the row needs no label explaining what it is. Taking one
 * sends it to the part of the HUD it actually changes, so the reward is legible
 * as a movement rather than as a number that quietly ticked up somewhere.
 */
export class DraftCards extends Phaser.GameObjects.Container {
  private readonly dealt: Dealt[] = [];
  private readonly timerBar: Phaser.GameObjects.Rectangle;
  private readonly timerTrack: Phaser.GameObjects.Rectangle;
  private style: DojoStyleDef;
  private live: DraftCardId[] = [];
  private warned = false;
  private origin = new Phaser.Math.Vector2(0, 0);
  /** Which card the pointer is over, for verification of the press target. */
  private hovered: DraftCardId | null = null;

  constructor(
    private readonly sceneRef: Phaser.Scene,
    private readonly core: GameCore,
    private readonly fx: Fx,
    private readonly vfx: VFXManager,
    private readonly sfx: Sfx,
  ) {
    super(sceneRef, 0, 0);
    sceneRef.add.existing(this).setDepth(284);
    this.style = core.equippedDojoStyle;

    const trackW = CARD_W * 3 + CARD_GAP * 2;
    this.timerTrack = sceneRef.add
      .rectangle(0, CARD_H / 2 + 18, trackW, 5, this.style.palette.panelDark, 0.9)
      .setOrigin(0.5);
    this.timerBar = sceneRef.add
      .rectangle(-trackW / 2, CARD_H / 2 + 18, trackW, 5, this.style.palette.accent, 1)
      .setOrigin(0, 0.5);
    this.add([this.timerTrack, this.timerBar]);

    core.events.on('draftOffered', (event) => this.present(event.stage, event.cards));
    core.events.on('draftPicked', (event) => this.resolve(event.card, event.auto));
    core.events.on('bossDefeated', () => this.noteBossPosition());
    this.setVisible(false);
    this.relayout();
  }

  /**
   * Where each live card actually is, in scene coordinates: centre plus the
   * on-screen half-extents after the row's scale. Verification uses it to
   * press the corners of a card rather than trusting its middle.
   */
  cardRects(): Array<{ id: DraftCardId; x: number; y: number; halfW: number; halfH: number; angle: number }> {
    return this.dealt
      .filter((card) => this.live.includes(card.id))
      .map((card) => {
        const b = card.root.getBounds();
        return {
        id: card.id,
        x: b.centerX,
        y: b.centerY,
        halfW: b.width / 2,
        halfH: b.height / 2,
        angle: card.root.angle,
        };
      });
  }

  hoveredCard(): DraftCardId | null {
    return this.hovered;
  }

  relayout(): void {
    const a = theme.layout.arena;
    // Quantised, and never above 1.
    //
    // The font is a bitmap and the whole game renders with `pixelArt: true`,
    // which means NEAREST sampling: at an arbitrary scale like 0.873 every
    // glyph lands on a fraction of a texel and the text goes soft. Snapping to
    // eighths keeps letters on clean sample boundaries, and the position is
    // rounded for the same reason -- a container at x=413.5 blurs everything
    // inside it however crisp the scale is.
    const raw = Math.min(1, Math.max(0.6, a.w / (CARD_W * 3 + CARD_GAP * 2 + 56)));
    const scale = Math.round(raw * 8) / 8;
    this.setScale(scale);
    // Always fully inside the arena panel, never straddling the seam. Portrait
    // has barely eighteen pixels between the panels, so a row centred there
    // hung half of every card behind the board's own frame -- the titles and
    // the art wells were the half that vanished. Sitting the row on the arena
    // floor also keeps it clear of any slot the player may be dragging into.
    // Clear of the achievement toast, which is pinned 54px off the arena floor
    // and stands 76 tall: the card row plus its countdown bar has to finish
    // above that or a reward card and an unlock card fight for the same strip.
    const bottom = a.y + a.h - (CARD_H / 2 + 21 + 96) * scale;
    this.setPosition(
      Math.round(a.x + a.w / 2),
      Math.round(theme.layout.landscape ? a.y + a.h * 0.63 : bottom),
    );
  }

  applyDojoStyle(style: DojoStyleDef): void {
    this.style = style;
    this.timerTrack.setFillStyle(style.palette.panelDark, 0.9);
    this.timerBar.setFillStyle(style.palette.accent, 1);
    if (this.live.length > 0) this.rebuild();
  }

  /** Advances the countdown bar. Driven by the scene so it follows the sim's clock. */
  override update(): void {
    const pending = this.core.pendingDraft;
    if (pending === null) return;
    const ratio = Phaser.Math.Clamp(pending.msLeft / BALANCE.draft.autoPickMs, 0, 1);
    this.timerBar.setScale(ratio, 1);
    if (!pending.warning || this.warned) return;
    this.warned = true;
    const first = this.dealt[0];
    if (first === undefined) return;
    this.sceneRef.tweens.add({
      targets: first.root,
      y: first.restY - 10,
      yoyo: true,
      repeat: 2,
      duration: 200,
      ease: 'Sine.easeInOut',
    });
  }

  snapshot(): { visible: boolean; cards: readonly DraftCardId[] } {
    return { visible: this.visible, cards: [...this.live] };
  }

  /** Remembers where the boss stood, so cards are dealt out of the kill. */
  private noteBossPosition(): void {
    this.origin.set(theme.layout.enemy.x, theme.layout.enemy.y);
  }

  private present(stage: number, cards: readonly DraftCardId[]): void {
    this.live = [...cards];
    this.warned = false;
    this.rebuild(stage);
    this.setVisible(true);
    this.timerBar.setScale(1, 1);

    const from = this.getLocalPoint(this.origin.x, this.origin.y);
    this.dealt.forEach((card, index) => {
      card.root
        .setPosition(from.x, from.y)
        .setScale(0.25)
        .setAlpha(0)
        .setAngle(Phaser.Math.Between(-40, 40));
      card.front.setVisible(false);
      card.back.setVisible(true);

      // Deal: the back travels out of the boss and settles into the fan.
      this.sceneRef.tweens.add({
        targets: card.root,
        x: card.restX, y: card.restY, angle: card.restAngle,
        scaleX: 1, scaleY: 1, alpha: 1,
        duration: 260,
        delay: index * 70,
        ease: 'Back.easeOut',
        onComplete: () => this.flip(card, index),
      });
    });
    this.sfx.play('drop');
  }

  /**
   * Turns one card face up.
   *
   * The horizontal squash is the whole illusion: a card at scaleX 0 is an edge,
   * so swapping the printed side at that exact frame reads as the card turning
   * over rather than as one image replacing another.
   */
  private flip(card: Dealt, index: number): void {
    this.sceneRef.tweens.add({
      targets: card.root,
      scaleX: 0,
      duration: 110,
      delay: index * 40,
      ease: 'Quad.easeIn',
      onComplete: () => {
        card.back.setVisible(false);
        card.front.setVisible(true);
        this.sfx.play('pickup');
        this.sceneRef.tweens.add({
          targets: card.root,
          scaleX: 1,
          duration: 150,
          ease: 'Back.easeOut',
          onComplete: () => {
            const world = card.root.getWorldTransformMatrix();
            this.vfx.sparks(world.tx, world.ty - 40, this.style.palette.vfx, 3);
            this.breathe(card, index);
          },
        });
      },
    });
  }

  /** Each card drifts on its own phase, so the fan shimmers instead of pulsing. */
  private breathe(card: Dealt, index: number): void {
    // Whole pixels only. A half-pixel drift is invisible as motion and very
    // visible as shimmer on bitmap text.
    this.sceneRef.tweens.add({
      targets: card.root,
      y: card.restY - 4,
      duration: 1_900,
      delay: index * 90,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => card.root.setY(Math.round(card.root.y)),
    });
  }

  /**
   * Where a taken card flies to.
   *
   * Each reward has a place on screen it actually changes, and sending the card
   * there is what makes the effect legible without printing a number: coins go
   * to the wallet, healing to the line, a recruit and a damage buff to the
   * board that receives them, a bounty back to the boss it is a bet on.
   */
  private landingFor(id: DraftCardId): Phaser.Math.Vector2 {
    const l = theme.layout;
    if (id === 'purse') return new Phaser.Math.Vector2(l.coin.x, l.coin.y);
    if (id === 'mend') return new Phaser.Math.Vector2(l.arena.x + 120, l.arena.y + 40);
    // The counter shape acts on the boss, so it flies at the boss.
    if (id === 'bounty' || id === 'disarm' || id === 'stagger') return new Phaser.Math.Vector2(l.enemy.x, l.enemy.y);
    return new Phaser.Math.Vector2(l.board.x + l.board.w / 2, l.board.y + l.board.h / 2);
  }

  private resolve(picked: DraftCardId, auto: boolean): void {
    const index = this.live.indexOf(picked);
    this.live = [];

    this.dealt.forEach((card, position) => {
      this.sceneRef.tweens.killTweensOf(card.root);
      if (position === index) {
        this.sendHome(card, auto);
        return;
      }
      // The ones not taken turn back over and slide away under the row.
      this.sceneRef.tweens.add({
        targets: card.root,
        y: card.restY + 56,
        angle: position < index ? -16 : 16,
        scaleX: 0.78, scaleY: 0.78,
        alpha: 0,
        duration: 260,
        ease: 'Quad.easeIn',
      });
    });

    this.sfx.play(picked === 'bounty' ? 'newTier' : 'merge');
    this.sceneRef.time.delayedCall(700, () => { if (this.live.length === 0) this.setVisible(false); });
  }

  /** Lifts the chosen card, flashes the screen in its colour, and flies it home. */
  private sendHome(card: Dealt, auto: boolean): void {
    const world = card.root.getWorldTransformMatrix();
    this.vfx.shockwave(world.tx, world.ty, this.style.palette.accent, 1.6);
    if (!auto) this.fx.hitStop(45);
    this.screenPulse();

    const target = this.getLocalPoint(this.landingFor(card.id).x, this.landingFor(card.id).y);
    this.sceneRef.tweens.add({
      targets: card.root,
      y: card.restY - 26,
      scaleX: 1.16, scaleY: 1.16,
      angle: 0,
      duration: 170,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.sceneRef.tweens.add({
          targets: card.root,
          x: target.x, y: target.y,
          scaleX: 0.12, scaleY: 0.12,
          alpha: 0,
          duration: 420,
          ease: 'Cubic.easeIn',
          onComplete: () => {
            const landed = card.root.getWorldTransformMatrix();
            this.vfx.sparks(landed.tx, landed.ty, this.style.palette.accentBright, 5);
            this.fx.shake(0.003, 90);
          },
        });
      },
    });
  }

  /**
   * A single screen-wide wash in the skin's bright accent.
   *
   * Deliberately brief and additive rather than a dimming scrim: the point is
   * to mark that something the player chose has just taken effect, not to
   * interrupt the fight running underneath it.
   */
  private screenPulse(): void {
    const l = theme.layout;
    const wash = this.sceneRef.add
      .rectangle(l.width / 2, l.height / 2, l.width, l.height, this.style.palette.accentBright, 0.16)
      .setDepth(300)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.sceneRef.tweens.add({
      targets: wash,
      alpha: 0,
      duration: 420,
      ease: 'Quad.easeOut',
      onComplete: () => wash.destroy(),
    });
  }

  private rebuild(stage = this.core.currentStage): void {
    this.dealt.forEach((card) => { this.sceneRef.tweens.killTweensOf(card.root); card.root.destroy(); });
    this.dealt.length = 0;

    const total = this.live.length;
    const span = CARD_W * total + CARD_GAP * (total - 1);
    const middle = (total - 1) / 2;
    this.live.forEach((id, index) => {
      const offset = index - middle;
      const card = this.buildCard(id, stage, {
        x: Math.round(-span / 2 + CARD_W / 2 + index * (CARD_W + CARD_GAP)),
        // The fan: outer cards tilt away from centre and hang a little lower,
        // which is what separates a hand of cards from three aligned buttons.
        y: Math.round(Math.abs(offset) * FAN_LIFT),
        angle: offset * FAN_ANGLE,
      });
      this.dealt.push(card);
      this.add(card.root);
    });
    this.bringToTop(this.timerTrack);
    this.bringToTop(this.timerBar);
  }

  /**
   * `glyph` is deliberately not `ink`: the icons are silhouettes of real
   * things, and painting the coin in body-text black turned it into a hole in
   * the card. Text wants contrast; a coin wants to look like a coin.
   *
   * Classic's plate is pale straw and takes near-black ink. Crimson's lacquer
   * red does not become readable by swapping the ink alone -- red against gold
   * is still muddy at 11px -- so its face goes darker and the gold sits on
   * something close to black, which is the contrast the rest of this game's
   * text already runs at. Picking by luminance means a future skin gets
   * legible cards for free.
   */
  private cardFace(): CardFace {
    const p = this.style.palette;
    const pale = DraftCards.isPale(p.plate);
    return {
      face: pale ? p.plate : p.panelDark,
      ink: pale ? p.panelDark : p.accentBright,
      glyph: pale ? p.accent : p.accentBright,
      band: p.accent,
      // The name strip is its own surface and gets its own decision: Classic's
      // gold band takes black, Crimson's is a dark red that needs light ink.
      bandInk: DraftCards.isPale(p.accent) ? p.panelDark : 0xffffff,
    };
  }

  /** Perceived brightness, for deciding whether a surface takes dark or light ink. */
  private static isPale(color: number): boolean {
    const luminance = (
      ((color >> 16) & 0xff) * 0.299 + ((color >> 8) & 0xff) * 0.587 + (color & 0xff) * 0.114
    ) / 255;
    return luminance > 0.55;
  }

  private buildCard(id: DraftCardId, stage: number, at: { x: number; y: number; angle: number }): Dealt {
    const def = DRAFT_CARDS[id];
    const p = this.style.palette;
    const { face, ink, glyph, band, bandInk } = this.cardFace();
    const root = this.sceneRef.add.container(at.x, at.y).setAngle(at.angle);

    // A soft offset slab under the card. Without it three flat rectangles read
    // as panels painted onto the backdrop rather than objects lying on it.
    const shadow = this.sceneRef.add.graphics();
    shadow.fillStyle(0x000000, 0.34).fillRoundedRect(-CARD_W / 2 + 4, -CARD_H / 2 + 8, CARD_W, CARD_H, RADIUS);

    const border = this.sceneRef.add.graphics();
    this.paintBorder(border, false);

    const front = this.sceneRef.add.container(0, 0);
    const body = this.sceneRef.add.graphics();
    const left = -CARD_W / 2;
    const top = -CARD_H / 2;
    body.fillStyle(face, 0.97).fillRoundedRect(left + 6, top + 6, CARD_W - 12, CARD_H - 12, RADIUS - 4);

    // A title band across the top, like a printed card's name strip.
    body.fillStyle(band, 0.94).fillRoundedRect(left + 6, top + 6, CARD_W - 12, 30, RADIUS - 4);
    body.fillStyle(band, 0.94).fillRect(left + 6, top + 24, CARD_W - 12, 12);
    // A darker lip under the band so the strip has thickness rather than
    // reading as a rectangle of flat colour laid on the face.
    body.fillStyle(p.panelDark, 0.35).fillRect(left + 6, top + 34, CARD_W - 12, 2);

    // Hairline inner frame, inset from the border. Printed cards almost all
    // have one and its absence is most of what made these look like buttons.
    body.lineStyle(1, ink, 0.28).strokeRect(left + 11, top + 41, CARD_W - 22, CARD_H - 52);

    // The art well, so the icon sits in a recess instead of floating.
    body.fillStyle(p.panelDark, face === p.panelDark ? 0.55 : 0.16)
      .fillRoundedRect(left + 18, top + 46, CARD_W - 36, 84, 8);
    body.lineStyle(1, ink, 0.22).strokeRoundedRect(left + 18, top + 46, CARD_W - 36, 84, 8);

    // Corner ticks on the well, the small printed detail that reads as
    // craftsmanship at a glance without adding anything to read.
    const wellLeft = left + 18;
    const wellRight = left + CARD_W - 18;
    const wellTop = top + 46;
    const wellBottom = top + 130;
    body.lineStyle(2, band, 0.85);
    for (const [cx, cy, dx, dy] of [
      [wellLeft, wellTop, 1, 1], [wellRight, wellTop, -1, 1],
      [wellLeft, wellBottom, 1, -1], [wellRight, wellBottom, -1, -1],
    ] as const) {
      body.lineBetween(cx, cy, cx + dx * 9, cy);
      body.lineBetween(cx, cy, cx, cy + dy * 9);
    }

    // A rule between the art and the line of copy, with a diamond on it.
    const ruleY = top + 136;
    body.lineStyle(1, ink, 0.3).lineBetween(left + 26, ruleY, left + CARD_W - 26, ruleY);
    body.fillStyle(band, 0.9);
    body.fillPoints([
      new Phaser.Geom.Point(0, ruleY - 4),
      new Phaser.Geom.Point(4, ruleY),
      new Phaser.Geom.Point(0, ruleY + 4),
      new Phaser.Geom.Point(-4, ruleY),
    ], true);

    const title = this.sceneRef.add
      .bitmapText(0, -CARD_H / 2 + 21, 'pixel', def.label, 13)
      .setOrigin(0.5)
      .setTint(bandInk);
    // One pip per step of the shape's place in the draw order, printed in both
    // top corners. It is a suit mark: two cards of the same shape wear the same
    // marks, so a player learns the families without any of them being named.
    const pips = DRAFT_SHAPE_ORDER.indexOf(def.shape) + 1;
    for (let i = 0; i < pips; i += 1) {
      const dy = top + 14 + i * 5;
      body.fillStyle(bandInk, 0.8);
      body.fillRect(left + 11, dy, 4, 3);
      body.fillRect(left + CARD_W - 15, dy, 4, 3);
    }

    const icon = this.buildIcon(def.icon, stage, glyph).setPosition(0, -CARD_H / 2 + 88);
    // Wrapped at the card's inner width: the bitmap font measures in whole
    // glyphs, so a maxWidth close to the plate edge leaves a word hanging out.
    const blurb = this.sceneRef.add
      .bitmapText(0, -CARD_H / 2 + 142, 'pixel', def.blurb, 11)
      .setOrigin(0.5, 0)
      .setCenterAlign()
      .setMaxWidth(CARD_W - 30)
      .setTint(ink);
    blurb.setAlpha(0.88);
    front.add([body, title, icon, blurb]);

    const back = this.buildBack();

    root.add([shadow, border, back, front]);
    root.setSize(CARD_W, CARD_H).setInteractive(
      new Phaser.Geom.Rectangle(0, 0, CARD_W, CARD_H),
      Phaser.Geom.Rectangle.Contains,
    );

    const dealt: Dealt = { id, root, front, back, border, restX: at.x, restY: at.y, restAngle: at.angle };
    // Same language the board already uses for a valid drop target, so the
    // affordance is one the player has learned rather than a new one.
    root.on('pointerover', () => {
      if (this.live.length === 0) return;
      this.hovered = id;
      this.paintBorder(border, true);
      this.sceneRef.tweens.add({ targets: root, y: at.y - 9, duration: 110, ease: 'Quad.easeOut' });
    });
    root.on('pointerout', () => {
      if (this.live.length === 0) return;
      if (this.hovered === id) this.hovered = null;
      this.paintBorder(border, false);
      this.sceneRef.tweens.add({ targets: root, y: at.y, duration: 140, ease: 'Quad.easeOut' });
    });
    root.on('pointerdown', () => {
      if (this.live.length === 0) return;
      this.sfx.play('click');
      this.core.pickDraftCard(id);
    });
    return dealt;
  }

  private paintBorder(border: Phaser.GameObjects.Graphics, hovered: boolean): void {
    const p = this.style.palette;
    border.clear();
    border.fillStyle(hovered ? p.slotActive : p.accent, 0.97)
      .fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, RADIUS);
  }

  /** The face-down side: a plain lacquered back with the dojo's ring on it. */
  private buildBack(): Phaser.GameObjects.Container {
    const p = this.style.palette;
    const back = this.sceneRef.add.container(0, 0);
    const slab = this.sceneRef.add.graphics();
    slab.fillStyle(p.panelDark, 0.98).fillRoundedRect(-CARD_W / 2 + 6, -CARD_H / 2 + 6, CARD_W - 12, CARD_H - 12, RADIUS - 4);
    slab.lineStyle(2, p.accent, 0.7).strokeRoundedRect(-CARD_W / 2 + 15, -CARD_H / 2 + 15, CARD_W - 30, CARD_H - 30, 8);
    // A lattice of small diamonds, the way a real deck patterns its backs. It
    // is only on screen for a quarter of a second per card, but a flat back is
    // exactly what makes a flip read as two images rather than one object.
    slab.fillStyle(p.accent, 0.16);
    for (let row = -3; row <= 3; row += 1) {
      for (let col = -2; col <= 2; col += 1) {
        const cx = col * 26 + (row % 2 === 0 ? 0 : 13);
        const cy = row * 24;
        if (Math.abs(cx) > CARD_W / 2 - 26 || Math.abs(cy) > CARD_H / 2 - 26) continue;
        slab.fillPoints([
          new Phaser.Geom.Point(cx, cy - 5),
          new Phaser.Geom.Point(cx + 5, cy),
          new Phaser.Geom.Point(cx, cy + 5),
          new Phaser.Geom.Point(cx - 5, cy),
        ], true);
      }
    }
    const crest = this.sceneRef.add
      .image(0, 0, ATLAS_KEY, FX_FRAMES.ring)
      .setDisplaySize(58, 58)
      .setTint(p.accent)
      .setAlpha(0.85);
    back.add([slab, crest]);
    return back;
  }

  /**
   * Card art, drawn entirely from textures already in memory.
   *
   * `recruit` shows the fighter it will actually hand over and `bounty` shows
   * the boss it is betting on, so neither card needs a number to say what it
   * does -- and neither costs a byte of download.
   */
  private buildIcon(icon: DraftCardDefIcon, stage: number, glyph: number): Phaser.GameObjects.Image {
    if (icon.kind === 'weakest') {
      // Shows the fighter it is actually about to promote, so the card says
      // what it does without a number or a name.
      const lowest = this.core.board.slots.reduce<number | null>(
        (best, ninja) => ninja === null ? best : best === null ? ninja.tier : Math.min(best, ninja.tier),
        null,
      );
      return this.sceneRef.add
        .image(0, 0, ATLAS_KEY, ninjaFrame(lowest ?? 1))
        .setDisplaySize(ICON_SIZE, ICON_SIZE);
    }
    if (icon.kind === 'strongest') {
      // Shows the fighter it is about to copy, so the card reads as "another
      // one of these" rather than as an unnamed favour.
      const highest = this.core.board.slots.reduce<number | null>(
        (best, ninja) => ninja === null || ninja.tier >= BALANCE.tiers.count
          ? best
          : best === null ? ninja.tier : Math.max(best, ninja.tier),
        null,
      );
      return this.sceneRef.add
        .image(0, 0, ATLAS_KEY, ninjaFrame(highest ?? 1))
        .setDisplaySize(ICON_SIZE, ICON_SIZE);
    }
    if (icon.kind === 'ninja') {
      const tier = Math.min(BALANCE.tiers.count, this.core.buyTier + BALANCE.draft.recruitTierBonus);
      return this.sceneRef.add.image(0, 0, ATLAS_KEY, ninjaFrame(tier)).setDisplaySize(ICON_SIZE, ICON_SIZE);
    }
    if (icon.kind === 'boss') {
      // Standalone catalog portrait, not an atlas frame: the boss art lives in
      // its own texture and is already resident for the fight on screen.
      return this.sceneRef.add
        .image(0, 0, bossForStage(stage + 1).textureKey)
        .setDisplaySize(ICON_SIZE, ICON_SIZE);
    }
    if (icon.kind === 'texture') {
      // Authored pickup art, already resident. Left untinted: these are
      // finished icons rather than the neutral silhouettes the atlas frames are.
      return this.sceneRef.add.image(0, 0, icon.key).setDisplaySize(ICON_SIZE, ICON_SIZE);
    }
    return this.sceneRef.add
      .image(0, 0, ATLAS_KEY, icon.frame)
      .setDisplaySize(ICON_SIZE, ICON_SIZE)
      .setTint(icon.frame === 'icon_potion' ? 0xffffff : glyph);
  }
}

type DraftCardDefIcon = (typeof DRAFT_CARDS)[DraftCardId]['icon'];
