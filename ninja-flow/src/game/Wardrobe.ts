import {
  Box3,
  Color,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type Bone,
  type Material,
} from 'three';
import { Spring } from '../fx/Physics';
import {
  COSMETIC_SLOTS,
  itemById,
  paletteFor,
  tintFor,
  type CosmeticAnchor,
  type Loadout,
} from './Cosmetics';
import type { BoneKey, RigAdapter } from './Rig';

/**
 * Hangs a loadout on a character.
 *
 * The awkward part of attaching a hat to a rig is that every skeleton points
 * its bones somewhere different — one rig's head bone has +Y up the skull, the
 * next has +Z — so an item authored against one of them lands sideways on the
 * others. Each mount therefore gets a holder whose rotation cancels the bone's
 * *bind* orientation, read from the skinning data rather than from the current
 * pose. Inside that holder the world is plain character space: +Y up, +Z
 * forward, metres. One offset then works on every ninja, and the item still
 * follows the bone exactly once it starts moving.
 *
 * Anything with cloth in it also gets a sway pivot, driven by the hero's own
 * acceleration through the same spring the body's secondary motion uses. A cape
 * that stays rigid through a two-metre dash undoes the weight the rest of the
 * animation system spends its time building.
 */

/** A body part's real extent, in metres, measured around its bone's origin. */
interface Limb {
  box: Box3;
  /**
   * The top of the part's central column, ignoring anything that sticks out
   * sideways. A cat's ears and a fox's ears are weighted to the head bone, so
   * the box's ceiling is above the ear tips — resting a helmet there leaves it
   * hovering. The crown is where a hat actually meets the skull.
   */
  crownY: number;
}

interface SwayPart {
  pivot: Object3D;
  amount: number;
  lateral: Spring;
  pitch: Spring;
  phase: number;
}

const SWAY_PER_ACCEL = 0.016;
const SWAY_LIMIT = 0.62;

export class Wardrobe {
  private readonly holders: Object3D[] = [];
  private readonly materials = new Set<Material>();
  private readonly sway: SwayPart[] = [];
  /** Base colours of the character's own materials, so a tint is reversible. */
  private readonly baseColors = new Map<Material, Color>();
  private loadout: Loadout | null = null;
  private clock = 0;
  /**
   * Measured once, at the bind pose, and reused for every later equip: walking
   * the skin weights is cheap but not free, and the answer cannot change.
   */
  private limbs: Map<Object3D, Limb> | null = null;

  constructor(
    private readonly model: Object3D,
    private readonly rig: RigAdapter,
  ) {}

  get equipped(): Loadout | null {
    return this.loadout;
  }

  /** Measured limb sizes in metres, for scripted checks of the fitting pass. */
  get debugLimbs(): Record<string, { size: number[]; max: number[]; crown: number }> {
    if (!this.limbs) this.limbs = this.measureLimbs();
    const out: Record<string, { size: number[]; max: number[]; crown: number }> = {};
    for (const [bone, limb] of this.limbs) {
      const size = limb.box.getSize(new Vector3());
      out[bone.name] = {
        size: size.toArray().map((n) => +n.toFixed(3)),
        max: limb.box.max.toArray().map((n) => +n.toFixed(3)),
        crown: +limb.crownY.toFixed(3),
      };
    }
    return out;
  }

  /** Number of mounted pieces — used by tests to prove nothing leaks. */
  get mountCount(): number {
    return this.holders.length;
  }

  /**
   * Where each mounted piece ended up, in world metres. `debugLimbs` says what
   * the fitter measured; this says what it did with it, which is the half that
   * catches a piece placed inside a knee or scaled to the size of a tree.
   */
  get debugMounts(): { bone: string; scale: number; world: number[]; size: number[] }[] {
    const out: { bone: string; scale: number; world: number[]; size: number[] }[] = [];
    for (const holder of this.holders) {
      const size = new Box3().setFromObject(holder).getSize(new Vector3());
      out.push({
        bone: holder.parent?.name ?? '?',
        scale: +holder.scale.x.toFixed(4),
        world: holder.getWorldPosition(new Vector3()).toArray().map((n) => +n.toFixed(3)),
        size: size.toArray().map((n) => +n.toFixed(3)),
      });
    }
    return out;
  }

  apply(loadout: Loadout): void {
    this.clear();
    this.loadout = loadout;
    const palette = paletteFor(loadout);
    this.model.updateWorldMatrix(true, true);

    for (const slot of COSMETIC_SLOTS) {
      const item = itemById(loadout[slot]);
      if (!item?.build) continue;
      for (const anchor of item.anchors) {
        this.mount(anchor, item.build(palette, anchor), item.model === true);
      }
    }

    this.tint(tintFor(loadout));
  }

  /**
   * @param accelX lateral acceleration of the hero's root, m/s²
   * @param accelY vertical acceleration of the hero's root, m/s²
   * @param facing +1 or -1, so cloth trails behind whichever way he is turned
   */
  update(dt: number, accelX: number, accelY: number, facing: number): void {
    if (this.sway.length === 0) return;
    this.clock += dt;
    for (const part of this.sway) {
      // A slow breeze keeps cloth alive while standing; without it a cape reads
      // as a painted board every time the hero is idle, which is most of a run.
      const breeze = Math.sin(this.clock * 1.35 + part.phase) * 0.05;
      const lateral = clamp(-accelX * SWAY_PER_ACCEL * facing, -SWAY_LIMIT, SWAY_LIMIT) + breeze;
      const pitch = clamp(accelY * SWAY_PER_ACCEL * 0.7, -SWAY_LIMIT, SWAY_LIMIT) + breeze * 0.4;
      part.pivot.rotation.z = part.lateral.step(lateral * part.amount, dt);
      part.pivot.rotation.x = part.pitch.step(pitch * part.amount, dt);
    }
  }

  /** Drops everything worn and restores the character's own colours. */
  clear(): void {
    // Geometry is shared across every instance of an item and is never
    // disposed here; only the materials this wardrobe created are its own.
    for (const holder of this.holders) holder.parent?.remove(holder);
    this.holders.length = 0;
    this.sway.length = 0;
    for (const m of this.materials) m.dispose();
    this.materials.clear();
    this.tint(null);
    this.loadout = null;
  }

  private mount(anchor: CosmeticAnchor, item: Object3D, shared = false): void {
    const bone = this.resolve(anchor);
    if (!bone) return;
    // An empty piece is a model that has not finished streaming. Mounting it
    // would put a zero-size holder on the bone and leave the wardrobe claiming
    // to be wearing something it cannot draw.
    if (item.children.length === 0) return;

    const holder = new Group();
    holder.quaternion.copy(this.bindOrientation(bone)).invert();
    // The rig is scaled to gameplay height; items are authored in metres, so
    // the holder divides that scale back out.
    const worldScale = bone.getWorldScale(SCRATCH_SCALE);
    const inverseRigScale = worldScale.x > 1e-6 ? 1 / worldScale.x : 1;

    const placement = this.place(bone, anchor, item);
    holder.scale.setScalar(placement.scale * inverseRigScale);
    // The placement is a character-space displacement, so it is applied after
    // the orientation fix rather than in the bone's own axes.
    holder.position.copy(
      placement.position
        .applyQuaternion(this.bindOrientation(bone).invert())
        .multiplyScalar(inverseRigScale),
    );
    bone.add(holder);
    this.holders.push(holder);

    let parent: Object3D = holder;
    if (anchor.sway && anchor.sway > 0) {
      const pivot = new Group();
      holder.add(pivot);
      this.sway.push({
        pivot,
        amount: anchor.sway,
        lateral: new Spring(120, 17),
        pitch: new Spring(140, 19),
        phase: this.sway.length * 1.7,
      });
      parent = pivot;
    }

    if (anchor.rotation) {
      item.rotation.set(anchor.rotation[0], anchor.rotation[1], anchor.rotation[2]);
    }
    parent.add(item);
    // Model-backed pieces are clones that share their prototype's materials, so
    // they are never collected for disposal: unequipping one hat would otherwise
    // take the texture out from under every other copy of it.
    if (shared) return;
    item.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) this.materials.add(m);
    });
  }

  /**
   * Fits a piece to the body part it is going on.
   *
   * The catalogue asks for things like "as wide as the head, sitting on top of
   * it". That is answered here against the measured limb, so the same entry
   * produces a hat that fits a chibi fox and one that would fit a realistic
   * human. A rig with no skin weights falls back to the authored metres.
   */
  private place(
    bone: Object3D,
    anchor: CosmeticAnchor,
    item: Object3D,
  ): { position: Vector3; scale: number } {
    const position = SCRATCH_VEC.set(anchor.offset[0], anchor.offset[1], anchor.offset[2]);
    const limb = anchor.fit ? this.limbFor(bone) : null;
    if (!anchor.fit || !limb) return { position, scale: 1 };

    const fit = anchor.fit;
    const limbSize = limb.box.getSize(SCRATCH_SIZE);
    const limbWidth = Math.max(limbSize.x, 1e-4);
    const limbCenter = limb.box.getCenter(SCRATCH_CENTER);

    ITEM_BOX.setFromObject(item);
    const itemSize = ITEM_BOX.getSize(SCRATCH_SIZE2);
    if (itemSize.x < 1e-6) return { position, scale: 1 };
    // Height wins when it is given: a crested helmet is mostly crest, so sizing
    // it across gives something two heads tall.
    const scale =
      fit.height !== undefined && itemSize.y > 1e-6
        ? (Math.max(limbSize.y, 1e-4) * fit.height) / itemSize.y
        : (limbWidth * fit.width) / itemSize.x;
    const center = ITEM_BOX.getCenter(SCRATCH_CENTER2).multiplyScalar(scale);
    const low = ITEM_BOX.min.y * scale;
    const high = ITEM_BOX.max.y * scale;
    const backFace = ITEM_BOX.max.z * scale;

    if (fit.place === 'face') {
      // A mask straddles the front of the head: its own centre goes on the
      // head's front face, so roughly half of it is buried in the skull and
      // half stands proud. Meeting the two surfaces instead — the mask's back
      // against the head's front — leaves it floating a full mask-depth off the
      // nose, which is what the first version did.
      position.set(
        limbCenter.x - center.x,
        limbCenter.y - center.y,
        limb.box.max.z - center.z,
      );
    } else if (fit.place === 'top') {
      // The item's own underside meets the top of the limb, so a hat sits on a
      // head instead of intersecting it by however tall the hat happens to be.
      position.set(limbCenter.x - center.x, limb.crownY - low, limbCenter.z - center.z);
    } else if (fit.place === 'back') {
      position.set(limbCenter.x - center.x, limb.box.max.y - high, limb.box.min.z - backFace);
    } else {
      position.set(limbCenter.x - center.x, limbCenter.y - center.y, limbCenter.z - center.z);
    }

    const nudge = fit.nudge;
    if (nudge) {
      position.x += nudge[0] * limbWidth;
      position.y += nudge[1] * limbWidth;
      position.z += nudge[2] * limbWidth;
    }
    return { position, scale };
  }

  private limbFor(bone: Object3D): Limb | null {
    if (!this.limbs) this.limbs = this.measureLimbs();
    return this.limbs.get(bone) ?? null;
  }

  /**
   * Measures every bone's own vertices, in metres, around its bind origin.
   *
   * One pass over the skin weights answers "how big is this character's head,
   * actually" for all four ninjas and any future one, which is the only way a
   * single catalogue entry can fit bodies with wildly different proportions.
   */
  private measureLimbs(): Map<Object3D, Limb> {
    const limbs = new Map<Object3D, Limb>();
    const origins = new Map<Object3D, Vector3>();
    const points: { bone: Object3D; x: number; y: number; z: number }[] = [];
    this.model.updateWorldMatrix(true, true);
    const modelRotation = this.model.getWorldQuaternion(new Quaternion()).invert();

    this.model.traverse((o) => {
      if (!(o instanceof SkinnedMesh)) return;
      const geometry = o.geometry;
      const position = geometry.getAttribute('position');
      const index = geometry.getAttribute('skinIndex');
      const weight = geometry.getAttribute('skinWeight');
      if (!position || !index || !weight) return;

      // The bind-pose world transform of each bone's vertices. Skinned geometry
      // is not placed by the mesh's own matrix — it is placed by the skinning
      // chain — so measuring with `mesh.matrixWorld` alone drops the armature's
      // scale and lands every part on the floor.
      // `bindMatrixInverse` is not the inverse of `bindMatrix`: in attached
      // bind mode three keeps the former in step with the mesh's world matrix
      // every frame, which is what puts the skinned result in world metres.
      const pre = new Matrix4().multiplyMatrices(o.matrixWorld, o.bindMatrixInverse);
      const bones = o.skeleton.bones;
      const boneMatrices: (Matrix4 | null)[] = new Array(bones.length).fill(null);
      const matrixFor = (i: number): Matrix4 | null => {
        const bone = bones[i];
        const inverse = o.skeleton.boneInverses[i];
        if (!bone || !inverse) return null;
        let m = boneMatrices[i];
        if (!m) {
          m = new Matrix4()
            .multiplyMatrices(bone.matrixWorld, inverse)
            .premultiply(pre)
            .multiply(o.bindMatrix);
          boneMatrices[i] = m;
        }
        return m;
      };

      for (let v = 0; v < position.count; v++) {
        for (let k = 0; k < 4; k++) {
          // A vertex only counts toward the part that actually owns it —
          // otherwise a head's box would stretch down through the whole neck.
          if (weight.getComponent(v, k) < 0.35) continue;
          const i = index.getComponent(v, k);
          const bone = bones[i];
          const matrix = matrixFor(i);
          if (!bone || !matrix) continue;
          let origin = origins.get(bone);
          if (!origin) {
            origin = bone.getWorldPosition(new Vector3());
            origins.set(bone, origin);
            limbs.set(bone, { box: new Box3(), crownY: -Infinity });
          }
          limbs.get(bone)!.box.expandByPoint(
            SCRATCH_VEC2.set(position.getX(v), position.getY(v), position.getZ(v))
              .applyMatrix4(matrix)
              .sub(origin)
              .applyQuaternion(modelRotation),
          );
          points.push({ bone, x: SCRATCH_VEC2.x, y: SCRATCH_VEC2.y, z: SCRATCH_VEC2.z });
        }
      }
    });

    for (const [bone, limb] of limbs) {
      if (limb.box.isEmpty()) limbs.delete(bone);
    }
    // Second pass for the crown: it needs each part's centre, which only
    // exists once the boxes are complete.
    for (const p of points) {
      const limb = limbs.get(p.bone);
      if (!limb) continue;
      const size = limb.box.getSize(SCRATCH_SIZE);
      const center = limb.box.getCenter(SCRATCH_CENTER);
      const inColumn =
        Math.abs(p.x - center.x) < size.x * 0.18 && Math.abs(p.z - center.z) < size.z * 0.22;
      if (inColumn && p.y > limb.crownY) limb.crownY = p.y;
    }
    for (const limb of limbs.values()) {
      if (limb.crownY === -Infinity) limb.crownY = limb.box.max.y;
    }
    symmetrise(limbs);
    return limbs;
  }

  private resolve(anchor: CosmeticAnchor): Object3D | null {
    const keys: BoneKey[] = [anchor.bone, ...(anchor.alt ?? [])];
    for (const key of keys) {
      const bone = this.rig.get(key);
      if (bone) return bone;
    }
    return null;
  }

  /**
   * The bone's orientation in the bind pose, taken from the skinning matrices
   * so it is independent of whatever frame the animation is on when a player
   * equips something mid-idle.
   */
  private bindOrientation(bone: Object3D): Quaternion {
    const cached = BIND_CACHE.get(bone);
    if (cached) return SCRATCH_QUAT.copy(cached);

    let found: Quaternion | null = null;
    this.model.traverse((o) => {
      if (found || !(o instanceof SkinnedMesh)) return;
      const index = o.skeleton.bones.indexOf(bone as Bone);
      if (index < 0) return;
      const inverse = o.skeleton.boneInverses[index];
      if (!inverse) return;
      SCRATCH_MAT.copy(inverse).invert().decompose(SCRATCH_VEC2, SCRATCH_QUAT2, SCRATCH_SCALE2);
      found = SCRATCH_QUAT2.clone();
    });

    // No skinning data (a prop rig, a test double): fall back to the bone's
    // current orientation relative to the model, which is the bind pose on the
    // frame a character is loaded.
    if (!found) {
      bone.getWorldQuaternion(SCRATCH_QUAT2);
      this.model.getWorldQuaternion(SCRATCH_QUAT3);
      found = SCRATCH_QUAT3.invert().multiply(SCRATCH_QUAT2).clone();
    }

    BIND_CACHE.set(bone, found);
    return SCRATCH_QUAT.copy(found);
  }

  /**
   * Lays an outfit's colour over the CHARACTER, and only the character.
   *
   * What is being worn is deliberately excluded. A built piece already takes
   * the clan palette through its builder, so tinting it again just washes it
   * out; a model-backed piece is something the ninja found rather than
   * something the clan issued, and a kitsune mask that comes out ember-orange
   * because of the trousers is not a mask any more. `traverse` has no way to
   * skip a subtree, so this walks the tree itself and stops at each mount.
   */
  private tint(color: number | null): void {
    const worn = new Set<Object3D>(this.holders);
    const walk = (o: Object3D): void => {
      if (worn.has(o)) return;
      if (o instanceof Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m || !('color' in m)) continue;
          const target = m as Material & { color: Color };
          let base = this.baseColors.get(m);
          if (!base) {
            base = target.color.clone();
            this.baseColors.set(m, base);
          }
          if (color === null) target.color.copy(base);
          else target.color.copy(base).multiply(SCRATCH_COLOR.setHex(color));
        }
      }
      for (const child of o.children) walk(child);
    };
    walk(this.model);
  }
}

/**
 * Averages each left/right pair of limbs into one shape.
 *
 * Skin weights are never perfectly symmetric — a stray vertex on one arm, a
 * slightly different bind pose — and the fitter sizes each side independently,
 * so a pair of pauldrons came out a third bigger on one shoulder than the
 * other. Nothing in the catalogue wants that, and no player would read it as
 * anything but a bug, so the two sides are reconciled here rather than in every
 * mirrored entry.
 *
 * The pairing is by bone name with Left and Right swapped, which is how every
 * rig this game loads names its sides. A bone with no partner is left alone.
 */
function symmetrise(limbs: Map<Object3D, Limb>): void {
  const byName = new Map<string, Object3D>();
  for (const bone of limbs.keys()) byName.set(bone.name, bone);
  const done = new Set<Object3D>();

  for (const [name, bone] of byName) {
    if (done.has(bone)) continue;
    const partnerName = name.includes('Left')
      ? name.replace('Left', 'Right')
      : name.includes('Right')
        ? name.replace('Right', 'Left')
        : null;
    const partner = partnerName ? byName.get(partnerName) : undefined;
    if (!partner || partner === bone) continue;

    const a = limbs.get(bone)!;
    const b = limbs.get(partner)!;
    // The two boxes are measured around their own bone origins, so the partner
    // reads as this one reflected in x before the two are averaged.
    const mirrored = new Box3(
      new Vector3(-b.box.max.x, b.box.min.y, b.box.min.z),
      new Vector3(-b.box.min.x, b.box.max.y, b.box.max.z),
    );
    const min = a.box.min.clone().add(mirrored.min).multiplyScalar(0.5);
    const max = a.box.max.clone().add(mirrored.max).multiplyScalar(0.5);
    const crownY = (a.crownY + b.crownY) * 0.5;

    a.box.set(min, max);
    a.crownY = crownY;
    b.box.set(new Vector3(-max.x, min.y, min.z), new Vector3(-min.x, max.y, max.z));
    b.crownY = crownY;
    done.add(bone);
    done.add(partner);
  }
}

const BIND_CACHE = new WeakMap<Object3D, Quaternion>();
const SCRATCH_QUAT = new Quaternion();
const SCRATCH_QUAT2 = new Quaternion();
const SCRATCH_QUAT3 = new Quaternion();
const SCRATCH_MAT = new Matrix4();
const SCRATCH_VEC = new Vector3();
const SCRATCH_VEC2 = new Vector3();
const SCRATCH_SIZE = new Vector3();
const SCRATCH_SIZE2 = new Vector3();
const SCRATCH_CENTER = new Vector3();
const SCRATCH_CENTER2 = new Vector3();
const ITEM_BOX = new Box3();
const SCRATCH_SCALE = new Vector3();
const SCRATCH_SCALE2 = new Vector3();
const SCRATCH_COLOR = new Color();

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
