/**
 * The full-screen warning that slams over the arena the moment a wave ends and
 * the next one is bringing something new.
 *
 * It is its own popup rather than another block on the wave-clear card because
 * the card is the payout and was already full. This runs first, over the dark
 * arena, holds for a few seconds, and hands off to the card — so the beat goes
 * "field goes quiet → here is what is coming → here is what you earned →
 * garage", which puts the threat in the player's head before they spend.
 *
 * There is no spotlight fiction here: the models are simply lit and shown, big,
 * turning, walking their own walk. Copy is a name and three words. The model is
 * the description; anything longer competes with it.
 *
 * It owns a second, small WebGL context. Browsers cap how many live contexts a
 * page may hold, so the context is built on show and released on dismiss, and
 * its canvas is rebuilt each time — `forceContextLoss` poisons the old element.
 *
 * Geometry is never disposed here. `instantiateVoxelAsset` clones share the
 * cached template's buffers with the zombies actually on the field; freeing
 * them would strip the horde mid-run. Cloned materials are ours and are freed.
 */

import * as THREE from 'three';

import './ThreatAlert.css';
import { playSfx } from '../app/sfx.ts';
import {
  instantiateVoxelAsset,
  preloadVoxelAsset,
} from './VoxelAssetLoader.ts';
import { ZOMBIE_ASSET_ROOT } from './zombies/Zombie.ts';
import type {
  ThreatDamageRule,
  ThreatPreview,
  ThreatSubject,
} from './threatPreview.ts';
import { CAMERA_FOV_DEG, layoutThreatStage } from './threatStageLayout.ts';
import { BONE_NAMES, type BoneName } from '../tools/rigPose.ts';

/** Everything the alert needs to draw one warning. */
export interface ThreatAlertView {
  readonly preview: ThreatPreview;
  /** Part id -> PNG data URL, from `renderPartIconUrls`. Missing ids draw no tile. */
  readonly counterIcons: ReadonlyMap<string, string>;
  /** Display name per counter part id. */
  readonly counterNames: ReadonlyMap<string, string>;
  /** Catalog ids already bolted to the rig, so a tile can say so instead of nothing. */
  readonly ownedPartIds: ReadonlySet<string>;
}

/** Seconds the alert holds before it moves on by itself. */
const HOLD_SECONDS = 4.5;
const BOSS_HOLD_SECONDS = 6;
/**
 * Input is ignored for this long after the alert appears. The player's hand is
 * still on the keys from the wave they just finished, and an alert that a
 * stray keypress dismisses before it has drawn is no alert at all.
 */
const INPUT_LOCKOUT_MS = 700;

/** Degrees per second the models turn. Slow enough to read as menace. */
const TURN_DEG_PER_SECOND = 24;

export class ThreatAlert {
  readonly root: HTMLElement;

  private readonly headline: HTMLElement;
  private readonly stage: HTMLDivElement;
  private readonly fallback: HTMLDivElement;
  private readonly plates: HTMLDivElement;
  private readonly ruleBlock: HTMLElement;
  private readonly counterBlock: HTMLElement;
  private readonly counterRow: HTMLDivElement;
  private readonly dismissButton: HTMLButtonElement;
  private canvas: HTMLCanvasElement | null = null;

  private view: ThreatAlertView | null = null;
  private onDone: (() => void) | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private readonly mounted: MountedSubject[] = [];
  private readonly ownedMaterials = new Set<THREE.Material>();
  private frameId = 0;
  private clock: THREE.Clock | null = null;
  private elapsed = 0;
  private loadToken = 0;
  private resizeObserver: ResizeObserver | null = null;
  private holdTimer = 0;
  private armedAt = 0;
  private disposed = false;
  private reducedMotion = false;

  constructor() {
    this.root = document.createElement('section');
    this.root.className = 'threat-alert';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.tabIndex = -1;

    this.headline = document.createElement('h2');
    this.headline.className = 'threat-alert__headline';

    this.stage = document.createElement('div');
    this.stage.className = 'threat-alert__stage';
    this.fallback = document.createElement('div');
    this.fallback.className = 'threat-alert__fallback';
    this.fallback.hidden = true;
    this.stage.appendChild(this.fallback);

    this.plates = document.createElement('div');
    this.plates.className = 'threat-alert__plates';

    this.ruleBlock = document.createElement('section');
    this.ruleBlock.className = 'threat-alert__rule';
    this.ruleBlock.hidden = true;

    this.counterBlock = document.createElement('section');
    this.counterBlock.className = 'threat-alert__counters';
    const counterTitle = document.createElement('h3');
    counterTitle.className = 'threat-alert__counters-title';
    counterTitle.textContent = 'COUNTER WITH';
    this.counterRow = document.createElement('div');
    this.counterRow.className = 'threat-alert__counter-row';
    this.counterBlock.append(counterTitle, this.counterRow);

    this.dismissButton = document.createElement('button');
    this.dismissButton.type = 'button';
    this.dismissButton.className = 'threat-alert__dismiss';
    this.dismissButton.textContent = 'GOT IT';

    this.root.append(
      this.headline,
      this.stage,
      this.plates,
      this.ruleBlock,
      this.counterBlock,
      this.dismissButton,
    );
    this.dismissButton.addEventListener('click', this.onDismissInput);
    this.root.addEventListener('pointerdown', this.onDismissInput);
  }

  isVisible(): boolean {
    return !this.root.hidden;
  }

  /**
   * Slam the warning up. `onDone` fires exactly once, whether the player
   * dismissed it or it timed out — the caller uses it to show the payout card,
   * so dropping it would strand the run.
   */
  show(view: ThreatAlertView, onDone: () => void): void {
    if (this.disposed) {
      onDone();
      return;
    }
    this.dismiss(false);
    this.view = view;
    this.onDone = onDone;
    this.reducedMotion = prefersReducedMotion();

    const boss = view.preview.boss;
    this.root.classList.toggle('threat-alert--boss', boss);
    this.headline.textContent = boss
      ? `⚠ ${view.preview.headline} ⚠`
      : view.preview.headline;
    this.renderPlates(view.preview);
    this.renderRule(view.preview);
    this.renderCounters(view);
    this.fallback.hidden = true;

    this.root.hidden = false;
    // Flushing lets a reused element replay its entrance animation.
    void this.root.offsetWidth;
    this.root.classList.add('threat-alert--visible');
    this.root.focus();
    this.armedAt = performance.now();
    // Capture phase, because `SurvivalMode` registered its own window keydown
    // first and would otherwise see Escape and open the settings menu behind
    // the alert. Capture runs before it, and the dismiss keys stop there.
    window.addEventListener('keydown', this.onKeydown, true);

    playSfx(boss ? 'bossAlarm' : 'threatReveal');
    this.mountStage();

    this.holdTimer = window.setTimeout(
      () => this.dismiss(true),
      (boss ? BOSS_HOLD_SECONDS : HOLD_SECONDS) * 1000,
    );
  }

  /**
   * Tear the alert down. `notify` is false for an internal reset, so the
   * hand-off only fires for a real end of life.
   */
  dismiss(notify = true): void {
    const onDone = this.onDone;
    this.onDone = null;
    if (this.holdTimer !== 0) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = 0;
    }
    window.removeEventListener('keydown', this.onKeydown, true);
    this.teardownStage();
    this.root.classList.remove('threat-alert--visible');
    this.root.hidden = true;
    if (notify) onDone?.();
  }

  /** Close without handing off — for a game over or a mode teardown. */
  hide(): void {
    this.dismiss(false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.dismiss(false);
    this.disposed = true;
    this.dismissButton.removeEventListener('click', this.onDismissInput);
    this.root.removeEventListener('pointerdown', this.onDismissInput);
    this.root.remove();
    this.root.replaceChildren();
  }

  private readonly onDismissInput = (): void => {
    if (performance.now() - this.armedAt < INPUT_LOCKOUT_MS) return;
    this.dismiss(true);
  };

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (![' ', 'Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    // Immediate, not ordinary propagation: both listeners sit on `window`, and
    // only stopping the immediate kind keeps the key off the mode behind.
    event.stopImmediatePropagation();
    this.onDismissInput();
  };

  private renderPlates(preview: ThreatPreview): void {
    this.plates.replaceChildren();
    for (const subject of preview.subjects) {
      const plate = document.createElement('div');
      plate.className = 'threat-alert__plate';
      const name = document.createElement('strong');
      name.className = 'threat-alert__plate-name';
      name.textContent = subject.name.toUpperCase();
      plate.appendChild(name);
      if (subject.tagline !== '') {
        const tagline = document.createElement('span');
        tagline.className = 'threat-alert__plate-tagline';
        tagline.textContent = subject.tagline;
        plate.appendChild(tagline);
      }
      this.plates.appendChild(plate);
    }
  }

  /**
   * The damage-rule chart, for the threats that live or die by one — today
   * only the Phone Addict's bubble.
   *
   * Two labelled bars, drawn to scale against each other, above the counter
   * tiles. The bar lengths carry the message on their own: a player who reads
   * nothing at all still sees a stub next to a full bar and takes away "one of
   * these does nothing". The percentages and the footnote are for the player
   * who does read, in that order.
   */
  private renderRule(preview: ThreatPreview): void {
    this.ruleBlock.replaceChildren();
    const owner = preview.subjects.find((subject) => subject.rule !== null);
    const rule: ThreatDamageRule | undefined = owner?.rule ?? undefined;
    if (owner === undefined || rule === undefined) {
      this.ruleBlock.hidden = true;
      return;
    }
    this.ruleBlock.hidden = false;

    // On a wave introducing several kinds the chart has to say whose rule it
    // is; on a solo introduction the plate directly above already did.
    if (preview.subjects.length > 1) {
      const kicker = document.createElement('p');
      kicker.className = 'threat-alert__rule-kicker';
      kicker.textContent = `${owner.name.toUpperCase()} ONLY`;
      this.ruleBlock.appendChild(kicker);
    }

    const headline = document.createElement('h3');
    headline.className = 'threat-alert__rule-headline';
    headline.textContent = rule.headline;
    this.ruleBlock.appendChild(headline);

    const chart = document.createElement('div');
    chart.className = 'threat-alert__rule-chart';
    for (const bar of rule.bars) {
      const row = document.createElement('div');
      row.className = `threat-alert__rule-row threat-alert__rule-row--${bar.tone}`;

      const label = document.createElement('span');
      label.className = 'threat-alert__rule-label';
      // Decorative: the bar, the number and the colour already carry this, and
      // a screen reader announcing "check mark" adds nothing to "100%".
      const mark = document.createElement('span');
      mark.className = 'threat-alert__rule-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = bar.tone === 'good' ? '✓' : '✕';
      label.append(mark, document.createTextNode(bar.label));

      const track = document.createElement('div');
      track.className = 'threat-alert__rule-track';
      const fill = document.createElement('div');
      fill.className = 'threat-alert__rule-fill';
      const percent = Math.round(clamp01(bar.fraction) * 100);
      // Floored so a tiny share still draws something. A bar of literally no
      // width reads as a broken chart rather than as "almost nothing lands".
      fill.style.width = `${Math.max(percent, 4)}%`;
      track.appendChild(fill);

      // Outside the bar, in its own column: at 10% there is no room to print
      // inside the fill, and a number that lands in a different place per row
      // is one the eye has to hunt for.
      const value = document.createElement('span');
      value.className = 'threat-alert__rule-value';
      value.textContent = `${percent}%`;

      const detail = document.createElement('span');
      detail.className = 'threat-alert__rule-detail';
      detail.textContent = bar.detail;

      row.append(label, track, value, detail);
      chart.appendChild(row);
    }
    this.ruleBlock.appendChild(chart);

    const footnote = document.createElement('p');
    footnote.className = 'threat-alert__rule-footnote';
    footnote.textContent = rule.footnote;
    this.ruleBlock.appendChild(footnote);
  }

  private renderCounters(view: ThreatAlertView): void {
    this.counterRow.replaceChildren();
    let shown = 0;
    for (const partId of view.preview.counters) {
      const name = view.counterNames.get(partId);
      const iconUrl = view.counterIcons.get(partId);
      // Icon-led by design: with no render there is no tile, because a bare
      // name in this row is exactly the text the alert exists to replace.
      if (name === undefined || iconUrl === undefined) continue;

      const tile = document.createElement('div');
      tile.className = 'threat-alert__counter';
      tile.classList.toggle(
        'threat-alert__counter--owned',
        view.ownedPartIds.has(partId),
      );
      const icon = document.createElement('img');
      icon.className = 'threat-alert__counter-icon';
      icon.src = iconUrl;
      icon.alt = '';
      icon.decoding = 'async';
      const label = document.createElement('span');
      label.className = 'threat-alert__counter-name';
      label.textContent = name;
      tile.append(icon, label);
      this.counterRow.appendChild(tile);
      shown += 1;
    }
    this.counterBlock.hidden = shown === 0;
  }

  private mountStage(): void {
    const view = this.view;
    if (view === null || this.renderer !== null) return;

    for (const subject of view.preview.subjects) {
      preloadVoxelAsset(`${ZOMBIE_ASSET_ROOT}/${subject.modelFile}`);
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'threat-alert__canvas';
    // Decorative: the plates below carry the same information as text.
    canvas.setAttribute('aria-hidden', 'true');

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
    } catch {
      // No context to spare, or none at all. The plates already say who is
      // coming, so drop to those.
      this.showFallback();
      return;
    }
    this.canvas = canvas;
    this.stage.insertBefore(canvas, this.fallback);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.05, 400);

    // A plain studio rig, not a stage light. The job is to read the model —
    // its silhouette, its paint, how it moves — so nothing here is allowed to
    // throw the shape into shadow for atmosphere's sake.
    const boss = view.preview.boss;
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x241d18, 1.5));
    const key = new THREE.DirectionalLight(0xfff2e0, 2.5);
    key.position.set(2.4, 3.6, 3.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(boss ? 0xff6a4a : 0x8fb4ff, 1.4);
    rim.position.set(-3, 1.8, -3.4);
    scene.add(rim);

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stage);

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    void this.loadSubjects(view.preview);
    this.tick();
  }

  /**
   * Load every subject's model and stand them all up together. They are framed
   * as a group, so the stage waits for the set rather than popping one in and
   * re-framing when the second arrives. A model that fails to load simply does
   * not appear; only an empty stage falls back.
   *
   * `loadToken` guards the await: the alert can be dismissed while a boss's
   * several megabytes are still in flight.
   */
  private async loadSubjects(preview: ThreatPreview): Promise<void> {
    const token = ++this.loadToken;
    const results = await Promise.all(
      preview.subjects.map(async (subject) => {
        try {
          return {
            subject,
            model: await instantiateVoxelAsset(
              `${ZOMBIE_ASSET_ROOT}/${subject.modelFile}`,
              true,
            ),
          };
        } catch {
          return null;
        }
      }),
    );
    if (token !== this.loadToken || this.scene === null) {
      for (const result of results) {
        if (result) disposeMaterialsOnly(result.model);
      }
      return;
    }

    for (const result of results) {
      if (result === null) continue;
      this.mounted.push(this.standUp(result.subject, result.model));
    }
    if (this.mounted.length === 0) {
      this.showFallback();
      return;
    }
    this.layoutStage();
    // The still-image path parked its loop before this model existed.
    if (this.reducedMotion) this.tick();
  }

  /** Fit one model to its world height and bind its rig. */
  private standUp(subject: ThreatSubject, model: THREE.Group): MountedSubject {
    const scene = this.scene!;
    const bounds = new THREE.Box3().setFromObject(model);
    const rawHeight = Math.max(1e-3, bounds.max.y - bounds.min.y);
    model.scale.setScalar(subject.heightM / rawHeight);

    // Two frames: the pedestal holds the subject's place on the stage and
    // never moves, the spinner inside it is the turntable. Splitting them
    // keeps the placement out of the rotation, so a subject cannot drift off
    // its mark as it turns.
    const pedestal = new THREE.Group();
    const spinner = new THREE.Group();
    spinner.add(model);
    pedestal.add(spinner);
    scene.add(pedestal);

    for (const material of collectMaterials(model)) {
      this.ownedMaterials.add(material);
    }

    const bones = new Map<BoneName, THREE.Object3D>();
    const rest = new Map<BoneName, THREE.Euler>();
    for (const name of BONE_NAMES) {
      const node = model.getObjectByName(name);
      if (!node) continue;
      bones.set(name, node);
      rest.set(name, node.rotation.clone());
    }

    const mountedSubject: MountedSubject = {
      subject,
      pedestal,
      spinner,
      model,
      bones,
      rest,
      width: 0,
    };
    // A T-pose rig looks broken until something poses it, so put every rigged
    // model into frame one of its own clip before the first render.
    this.applyPose(mountedSubject, 0);
    const posed = new THREE.Box3().setFromObject(model);
    mountedSubject.width = Math.max(0.4, posed.max.x - posed.min.x);
    return mountedSubject;
  }

  /** Apply `layoutThreatStage` to whatever has actually arrived so far. */
  private layoutStage(): void {
    const camera = this.camera;
    if (camera === null || this.mounted.length === 0) return;

    const layout = layoutThreatStage(
      this.mounted.map((entry) => ({
        heightM: entry.subject.heightM,
        widthM: entry.width,
      })),
      camera.aspect,
    );
    this.mounted.forEach((entry, index) => {
      entry.pedestal.position.x = layout.positionsX[index];
    });
    camera.position.set(0, layout.cameraY, layout.cameraZ);
    camera.lookAt(0, layout.lookAtY, 0);
  }

  /**
   * Write one frame of the subject's own walk cycle onto its rig. It walks on
   * the spot rather than standing: a still model reads as a trophy, and the
   * gait is half of what makes a kamikaze's scuttle different from a
   * behemoth's plod. Reduced motion holds the rig's resting pose instead —
   * which for a T-pose bind is a real pose, not the bind.
   *
   * `rootLift` is in the model's own local units, so it goes on the model
   * rather than on the spinner that turns it.
   */
  private applyPose(entry: MountedSubject, time: number): void {
    const clips = entry.subject.clips;
    if (clips === null || entry.bones.size === 0) return;
    const pose = this.reducedMotion
      ? (clips.rest?.() ?? clips.walk(0, { cadence: clips.cadence }))
      : clips.walk(time, { cadence: clips.cadence });
    entry.model.position.y = pose.rootLift;
    for (const [name, node] of entry.bones) {
      const restRotation = entry.rest.get(name)!;
      const delta = pose.bones[name];
      node.rotation.set(
        restRotation.x + (delta?.rx ?? 0),
        restRotation.y + (delta?.ry ?? 0),
        restRotation.z + (delta?.rz ?? 0),
      );
    }
  }

  /**
   * One frame. Under reduced motion it does not queue the next one — the stage
   * is a still image then, so it is repainted only when something actually
   * changes (a model arriving, a resize) rather than sixty times a second.
   */
  private tick = (): void => {
    if (this.disposed || this.renderer === null) return;
    const dt = this.clock?.getDelta() ?? 0;
    if (this.reducedMotion) {
      this.frameId = 0;
    } else {
      this.frameId = requestAnimationFrame(this.tick);
      this.elapsed += dt;
      const turn = (TURN_DEG_PER_SECOND * Math.PI * dt) / 180;
      for (const entry of this.mounted) {
        entry.spinner.rotation.y += turn;
        this.applyPose(entry, this.elapsed);
      }
    }
    if (this.scene !== null && this.camera !== null) {
      this.renderer.render(this.scene, this.camera);
    }
  };

  private resize(): void {
    const renderer = this.renderer;
    const camera = this.camera;
    if (renderer === null || camera === null) return;
    const width = Math.max(1, this.stage.clientWidth);
    const height = Math.max(1, this.stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    this.layoutStage();
    if (this.reducedMotion) this.tick();
  }

  /**
   * No stage — no context to spare, or every model failed to load. The names
   * go where the models would have been.
   */
  private showFallback(): void {
    const names =
      this.view?.preview.subjects
        .map((subject) => subject.name.toUpperCase())
        .join('  +  ') ?? '';
    // Reached either before a context exists or after one turned out to have
    // nothing to draw, so it tears the stage down rather than assuming.
    this.teardownStage();
    this.fallback.hidden = false;
    this.fallback.textContent = names;
  }

  private teardownStage(): void {
    this.loadToken += 1;
    if (this.frameId !== 0) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const entry of this.mounted) entry.pedestal.removeFromParent();
    this.mounted.length = 0;
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedMaterials.clear();
    this.scene?.clear();
    this.scene = null;
    this.camera = null;
    this.clock = null;
    if (this.renderer !== null) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
    this.canvas?.remove();
    this.canvas = null;
    this.fallback.hidden = true;
  }
}

interface MountedSubject {
  readonly subject: ThreatSubject;
  /** Fixed place on the stage. */
  readonly pedestal: THREE.Group;
  /** The turntable inside the pedestal. Only the model rides it. */
  readonly spinner: THREE.Group;
  readonly model: THREE.Group;
  readonly bones: Map<BoneName, THREE.Object3D>;
  readonly rest: Map<BoneName, THREE.Euler>;
  /** Posed width in metres, used to space the stage. */
  width: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function collectMaterials(root: THREE.Object3D): THREE.Material[] {
  const materials: THREE.Material[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (Array.isArray(child.material)) materials.push(...child.material);
    else materials.push(child.material);
  });
  return materials;
}

/**
 * Free a discarded clone's materials and nothing else. Its geometry belongs to
 * the shared template every live zombie is also drawing from.
 */
function disposeMaterialsOnly(root: THREE.Object3D): void {
  for (const material of collectMaterials(root)) material.dispose();
}
