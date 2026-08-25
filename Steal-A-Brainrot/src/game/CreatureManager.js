// Owns every creature entity in the world: sprite, shadow, rarity FX, labels,
// state machine (belt → transit → pedestal → carried → returning) and the
// ownership transfers that buying and stealing perform.
class CreatureManager {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  tier(cr) { return RARITIES[cr.def.rarity].tier; }

  // ---------- creation ----------
  _make(def, x, y) {
    const s = this.scene;
    const cr = {
      def, owner: null, state: 'belt', x, y,
      img: s.add.image(x, y, 'cr_' + def.id).setOrigin(0.5, 1),
      shadow: s.add.image(x, y + 2, 'shadow').setDepth(2).setScale(1.1),
      ring: null, priceText: null, incomeText: null,
      pedestalIndex: -1, carrier: null,
      wobbleT: Math.random() * 10, sparkAt: 0,
      baseScale: TextureFactory.scaleFor(s, 'cr_' + def.id, CFG.CREATURE_H),
    };
    cr.img.setScale(cr.baseScale);
    const t = this.tier(cr);
    if (t >= 2) {
      cr.ring = s.add.image(x, y - 26, 'ring')
        .setTint(RARITIES[cr.def.rarity].color).setAlpha(0.5).setScale(1.15);
      s.tweens.add({ targets: cr.ring, scale: { from: 1.0, to: 1.35 }, alpha: { from: 0.6, to: 0.25 },
        duration: 700, yoyo: true, repeat: -1 });
    }
    this.list.push(cr);
    return cr;
  }

  spawnOnBelt(def) {
    const cr = this._make(def, -50, CFG.CONVEYOR_Y + 8);
    cr.priceText = this.scene.add.text(cr.x, cr.y - 96, '$' + def.price, {
      fontFamily: 'Arial Black, Arial', fontSize: '17px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(860);
    return cr;
  }

  // ---------- queries ----------
  creaturesOf(ownerId) { return this.list.filter((c) => c.owner === ownerId); }
  onBelt() { return this.list.filter((c) => c.state === 'belt'); }
  stealableOf(ownerId) { return this.list.filter((c) => c.owner === ownerId && c.state === 'pedestal'); }
  bestOf(ownerId) {
    let best = null;
    this.creaturesOf(ownerId).forEach((c) => { if (!best || this.tier(c) > this.tier(best)) best = c; });
    return best;
  }
  hasTierAtLeast(ownerId, tier) {
    return this.creaturesOf(ownerId).some((c) => this.tier(c) >= tier);
  }

  // ---------- buying ----------
  // Returns the creature on success, a string reason on failure.
  purchase(cr, ownerId) {
    const s = this.scene;
    if (cr.state !== 'belt') return 'gone';
    const slot = s.bases.freeSlotIndex(ownerId);
    if (slot === -1) return 'full';
    if (!s.economy.spend(ownerId, cr.def.price)) return 'cash';

    if (cr.priceText) { cr.priceText.destroy(); cr.priceText = null; }
    cr.owner = ownerId;
    cr.pedestalIndex = slot;
    const isPlayer = ownerId === 'player';
    if (isPlayer) {
      SaveSys.addStat('bought');
      const isNew = SaveSys.discover(cr.def.id);
      if (this.tier(cr) >= 2) SaveSys.addStat('rares');
      AudioSys.sfx(this.tier(cr) >= 4 ? 'legendary' : 'buy');
      s.fx.coinBurst(cr.x, cr.y - 30, 8);
      s.fx.floatText(cr.x, cr.y - 90, '-$' + cr.def.price, '#ffca28');
      if (isNew) s.fx.floatText(cr.x, cr.y - 116, 'NEW!', '#69f0ae', 22);
      if (this.tier(cr) >= 4) {
        s.fx.banner(RARITIES[cr.def.rarity].name + '!', this._rarityCss(cr), cr.def.name);
        Poki.happyTime(0.7);
      }
    } else {
      AudioSys.sfx('coin');
    }
    s.fx.squash(cr.img);
    this._travelToPedestal(cr);
    return cr;
  }

  _rarityCss(cr) {
    return '#' + RARITIES[cr.def.rarity].color.toString(16).padStart(6, '0');
  }

  _travelToPedestal(cr) {
    const s = this.scene;
    cr.state = 'transit';
    const pos = s.bases.slotPos(cr.owner, cr.pedestalIndex);
    const dist = Phaser.Math.Distance.Between(cr.x, cr.y, pos.x, pos.y);
    s.tweens.add({
      targets: cr, x: pos.x, y: pos.y,
      duration: Math.max(500, dist * 3.2), ease: 'Sine.easeInOut',
      onComplete: () => {
        if (cr.state !== 'transit') return;   // stolen mid-travel? keep whatever state won
        cr.state = 'pedestal';
        s.fx.squash(cr.img, 0.3);
        s.fx.ringPulse(cr.x, cr.y - 20, RARITIES[cr.def.rarity].color, 1.1);
        this._makeIncomeLabel(cr);
      },
    });
  }

  _makeIncomeLabel(cr) {
    if (cr.incomeText) cr.incomeText.destroy();
    cr.incomeText = this.scene.add.text(cr.x, cr.y - 92, '+$' + cr.def.income + '/s', {
      fontFamily: 'Arial', fontSize: '13px', color: '#b9f6ca',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0.9).setDepth(855);
  }

  // place a creature straight onto a pedestal with no travel (save restore,
  // bot seeding)
  placeDirect(def, ownerId) {
    const slot = this.scene.bases.freeSlotIndex(ownerId);
    if (slot === -1) return null;
    const pos = this.scene.bases.slotPos(ownerId, slot);
    const cr = this._make(def, pos.x, pos.y);
    cr.owner = ownerId;
    cr.pedestalIndex = slot;
    cr.state = 'pedestal';
    this._makeIncomeLabel(cr);
    return cr;
  }

  // ---------- stealing lifecycle (called by StealSystem) ----------
  startCarry(cr, carrier) {
    cr.state = 'carried';
    cr.carrier = carrier;
    if (cr.incomeText) { cr.incomeText.destroy(); cr.incomeText = null; }
    this.scene.tweens.killTweensOf(cr);
  }

  // dropped by a caught thief: fly back home to its pedestal
  returnHome(cr) {
    const s = this.scene;
    cr.carrier = null;
    cr.state = 'returning';
    // pedestal may have been taken while carried; reassign
    if (this._slotTaken(cr.owner, cr.pedestalIndex, cr)) {
      const idx = s.bases.freeSlotIndex(cr.owner);
      cr.pedestalIndex = idx === -1 ? cr.pedestalIndex : idx;
    }
    const pos = s.bases.slotPos(cr.owner, cr.pedestalIndex);
    s.tweens.add({
      targets: cr, x: pos.x, y: pos.y, duration: 700, ease: 'Quad.easeInOut',
      onComplete: () => {
        cr.state = 'pedestal';
        s.fx.squash(cr.img, 0.3);
        this._makeIncomeLabel(cr);
      },
    });
  }

  _slotTaken(ownerId, idx, except) {
    return this.list.some((c) => c !== except && c.owner === ownerId && c.pedestalIndex === idx &&
      (c.state === 'pedestal' || c.state === 'transit' || c.state === 'returning'));
  }

  // successful theft: creature changes owner and settles on the thief's pedestal
  transferTo(cr, newOwner) {
    const s = this.scene;
    cr.carrier = null;
    cr.owner = newOwner;
    cr.pedestalIndex = s.bases.freeSlotIndex(newOwner);
    if (cr.pedestalIndex === -1) cr.pedestalIndex = 0;   // shouldn't happen; checked before steal
    if (newOwner === 'player') {
      SaveSys.discover(cr.def.id);
      if (this.tier(cr) >= 2) SaveSys.addStat('rares');
    }
    this._travelToPedestal(cr);
  }

  despawn(cr) {
    this.scene.tweens.killTweensOf(cr);
    if (cr.ring) this.scene.tweens.killTweensOf(cr.ring);
    ['img', 'shadow', 'ring', 'priceText', 'incomeText'].forEach((k) => { if (cr[k]) cr[k].destroy(); });
    const i = this.list.indexOf(cr);
    if (i !== -1) this.list.splice(i, 1);
  }

  // remove all of an owner's creatures instantly (rebirth reset)
  removeAllOf(ownerId) {
    this.creaturesOf(ownerId).slice().forEach((c) => this.despawn(c));
  }

  // ---------- per-frame ----------
  update(time, dtSec) {
    const s = this.scene;
    for (let i = 0; i < this.list.length; i++) {
      const cr = this.list[i];
      cr.wobbleT += dtSec * 3;

      if (cr.state === 'carried' && cr.carrier) {
        cr.x = cr.carrier.x;
        cr.y = cr.carrier.y - 44 + Math.sin(cr.wobbleT * 2.4) * 2;
      }

      // sprite follows logical position; idle wobble on pedestal/belt
      cr.img.setPosition(cr.x, cr.y);
      cr.img.setAngle(cr.state === 'carried' ? Math.sin(cr.wobbleT * 3) * 8 : Math.sin(cr.wobbleT) * 4);
      cr.img.setScale(cr.baseScale * (cr.state === 'carried' ? 0.85 : 1));
      cr.img.setDepth(cr.state === 'carried' ? cr.carrier.y + 1 : cr.y);
      cr.shadow.setPosition(cr.x, (cr.state === 'carried' ? cr.carrier.y : cr.y) + 2);
      if (cr.ring) {
        cr.ring.setPosition(cr.x, cr.y - 26);
        cr.ring.setDepth((cr.state === 'carried' ? cr.carrier.y : cr.y) - 1);
        // mythic/secret: cycle the aura hue for an electric look
        if (this.tier(cr) >= 5) {
          const hue = (time / 6) % 360;
          cr.ring.setTint(Phaser.Display.Color.HSLToColor(hue / 360, 1, 0.6).color);
        }
      }
      if (cr.priceText) {
        cr.priceText.setPosition(cr.x, cr.y - 96);
        cr.priceText.setColor(s.economy.canAfford('player', cr.def.price) ? '#b9f6ca' : '#ff8a80');
      }
      if (cr.incomeText) cr.incomeText.setPosition(cr.x, cr.y - 92);

      // epic+ creatures shed sparks
      if (this.tier(cr) >= 3 && time > cr.sparkAt) {
        cr.sparkAt = time + 500 + Math.random() * 500;
        s.fx.sparks(cr.x + (Math.random() - 0.5) * 30, cr.y - 20 - Math.random() * 30,
          RARITIES[cr.def.rarity].color, 1);
      }
    }
  }
}
window.CreatureManager = CreatureManager;
