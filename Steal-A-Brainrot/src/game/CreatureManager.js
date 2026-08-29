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
      // Income lives on the ENTITY, not on the definition: a merged creature
      // carries the pair's combined rate, which is more than its own
      // definition pays. Everything that asks what a creature earns has to
      // read cr.income -- def.income is only ever the starting value.
      income: def.income,
      img: s.add.image(x, y, 'cr_' + def.id).setOrigin(0.5, 1),
      shadow: s.add.image(x, y + 2, 'shadow').setDepth(2).setScale(1.1),
      ring: null, priceText: null, incomeText: null,
      pedestalIndex: -1, carrier: null, grabbedAt: 0, merging: false,
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
    cr.priceText = this.scene.add.text(cr.x, cr.y - 96, HUD.money(def.price), {
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
      s.fx.floatText(cr.x, cr.y - 90, '-' + HUD.money(cr.def.price), '#ffca28');
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

  // ---------- merging ----------
  // A duplicate landing next to one you already own fuses the pair into the
  // next creature up. Cascades naturally: the result can itself be a duplicate,
  // and each merge consumes two to make one, so it always terminates.
  //
  // The merged creature keeps the pair's COMBINED income -- two of a kind
  // always double. The catalogue's own ladder does not do that on its own (two
  // $2/s commons would fuse into a $3/s one and the player would be poorer for
  // merging), so the sum is the floor and the next definition's own rate wins
  // only when it is already higher.
  mergedIncome(a, b, next) {
    return Math.max(next.income, a.income + b.income);
  }

  duplicateOf(cr) {
    return this.list.find((c) => c !== cr && !c.merging && c.owner === cr.owner &&
      c.state === 'pedestal' && c.def.id === cr.def.id) || null;
  }

  tryMerge(cr) {
    if (!CFG.MERGE_ENABLED || cr.merging || cr.state !== 'pedestal') return false;
    const next = MERGE_INTO[cr.def.id];
    if (!next) return false;                       // top of the catalogue
    const twin = this.duplicateOf(cr);
    if (!twin) return false;
    // Reserve both halves. Without this a sweep over the pedestals schedules
    // the same pair twice -- once from each side -- and two duplicates turn
    // into two upgrades instead of one.
    cr.merging = true;
    twin.merging = true;
    this.scene.time.delayedCall(CFG.MERGE_DELAY_MS, () => this._doMerge(cr, twin, next));
    return true;
  }

  _doMerge(a, b, next) {
    // the world moves during the delay -- either half may have been stolen
    if (a.state !== 'pedestal' || b.state !== 'pedestal' || a.owner !== b.owner) {
      a.merging = false; b.merging = false;
      return;
    }
    const s = this.scene;
    const owner = a.owner;
    const at = { x: a.x, y: a.y };
    const isPlayer = owner === 'player';

    const income = this.mergedIncome(a, b, next);
    const was = a.income;
    this.despawn(a);
    this.despawn(b);
    const merged = this.placeDirect(next, owner, income);
    if (!merged) return;                           // no slot: shouldn't happen, two just freed

    if (isPlayer) {
      SaveSys.discover(next.id);
      SaveSys.addStat('merged');
      if (this.tier(merged) >= 2) SaveSys.addStat('rares');
      AudioSys.sfx(this.tier(merged) >= 4 ? 'legendary' : 'merge');
      s.fx.confetti(at.x, at.y - 30, 24);
      s.fx.banner('MERGE!', this._rarityCss(merged),
        next.name + '  •  +' + HUD.money(merged.income) + '/s');
      Poki.happyTime(0.6);
      s.tutorial.onFirstMerge();
    }
    s.fx.coinBurst(at.x, at.y - 30, 8);
    s.fx.ringPulse(merged.x, merged.y - 20, RARITIES[next.rarity].color, 1.8);
    s.fx.sparks(merged.x, merged.y - 30, RARITIES[next.rarity].color, 14);
    s.fx.floatText(merged.x, merged.y - 96,
      '+' + HUD.money(was) + '/s → +' + HUD.money(merged.income) + '/s', '#ffe082', 16);
    s.fx.squash(merged.img, 0.35);
    this.tryMerge(merged);                         // cascade
  }

  // ---------- selling ----------
  // The way out of a full base: hold on one of your own pedestal creatures and
  // it converts back into cash at CFG.SELL_RATIO.
  sellValue(cr) { return Math.max(1, Math.floor(cr.def.price * CFG.SELL_RATIO)); }

  sell(cr) {
    if (cr.owner !== 'player' || cr.state !== 'pedestal') return false;
    const s = this.scene;
    const paid = this.sellValue(cr);
    s.economy.earn('player', paid);
    SaveSys.addStat('sold');
    AudioSys.sfx('coin');
    s.fx.coinBurst(cr.x, cr.y - 30, 10);
    s.fx.floatText(cr.x, cr.y - 90, '+' + HUD.money(paid), '#b9f6ca', 20);
    s.fx.ringPulse(cr.x, cr.y - 20, 0x69f0ae, 1.2);
    s.fx.coinFly(cr.x, cr.y - 40, s.hud.coinTarget().x, s.hud.coinTarget().y);
    this.despawn(cr);
    return true;
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
        this.tryMerge(cr);
      },
    });
  }

  _makeIncomeLabel(cr) {
    if (cr.incomeText) cr.incomeText.destroy();
    cr.incomeText = this.scene.add.text(cr.x, cr.y - 92, '+' + HUD.money(cr.income) + '/s', {
      fontFamily: 'Arial', fontSize: '13px', color: '#b9f6ca',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0.9).setDepth(855);
  }

  // place a creature straight onto a pedestal with no travel (save restore,
  // bot seeding)
  placeDirect(def, ownerId, income) {
    const slot = this.scene.bases.freeSlotIndex(ownerId);
    if (slot === -1) return null;
    const pos = this.scene.bases.slotPos(ownerId, slot);
    const cr = this._make(def, pos.x, pos.y);
    if (income > 0) cr.income = Math.floor(income);
    cr.owner = ownerId;
    cr.pedestalIndex = slot;
    cr.state = 'pedestal';
    this._makeIncomeLabel(cr);
    return cr;
  }

  // Restoring a save can drop two of a kind straight onto pedestals with no
  // travel, so the merge pass has to run over the restored set as well.
  settleMerges(ownerId) {
    this.creaturesOf(ownerId)
      .filter((c) => c.state === 'pedestal')
      .slice()
      .forEach((c) => { if (this.list.indexOf(c) !== -1) this.tryMerge(c); });
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
    cr.state = 'gone';          // stale references must not read as 'pedestal'
    this.scene.tweens.killTweensOf(cr);
    if (cr.ring) this.scene.tweens.killTweensOf(cr.ring);
    ['img', 'shadow', 'ring', 'priceText', 'incomeText'].forEach((k) => { if (cr[k]) cr[k].destroy(); });
    const i = this.list.indexOf(cr);
    if (i !== -1) this.list.splice(i, 1);
  }

  // remove all of an owner's creatures instantly
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
