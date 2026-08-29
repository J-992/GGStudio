// Bases: floors, pedestals, and the lock/cooldown state machine for all six.
//
// Bases are OPEN. There are no walls and no doorway -- you walk in from any
// side, at any point. The old layout put a single 96px gap in a solid ring,
// which meant lining yourself up with an invisible slot before you could rob
// anybody, and that lineup was most of the difficulty.
//
// Locking is what closes a base now, and because entry is omnidirectional the
// lock has to be a full perimeter fence rather than one gate. Only the player
// collides with it; bots have never used wall physics and instead refuse to
// target a locked base in their planner.
const PLAYER_BASE_COLORS = [0x00695c, 0x283593, 0x6a1b9a, 0xad1457, 0xbf360c, 0xf57f17, 0x1b5e20];

class BaseManager {
  constructor(scene) {
    this.scene = scene;
    this.barriers = scene.physics.add.staticGroup();   // solid only while locked
    this.barrierParts = {};  // id -> [4 rects]
    this.fences = {};        // id -> graphics ring drawn while locked
    this.lockState = {};     // id -> { locked, until, cdUntil }
    this.pedestalImgs = {};  // id -> [images]
    this.floors = {};        // id -> rounded-rect graphics
    this.lockTexts = {};     // id -> countdown text

    for (const id in CFG.BASES) this._build(id);
  }

  _cfg(id) { return CFG.BASES[id]; }

  rect(id) {
    const b = this._cfg(id);
    return new Phaser.Geom.Rectangle(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
  }

  contains(id, x, y) { return Phaser.Geom.Rectangle.Contains(this.rect(id), x, y); }

  floorColor(id) {
    if (id === 'player') return PLAYER_BASE_COLORS[0];
    return TextureFactory.shade(CFG.BOTS.find((b) => b.id === id).color, 0.45);
  }

  _build(id) {
    const s = this.scene;
    const b = this._cfg(id);
    const r = this.rect(id);

    // floor
    const g = s.add.graphics().setDepth(4);
    this.floors[id] = g;
    this._drawFloor(id);

    // owner label
    const label = id === 'player' ? 'YOUR BASE' : CFG.BOTS.find((x) => x.id === id).name.toUpperCase();
    s.add.text(b.x, r.y + 4, label, {
      fontFamily: 'Arial Black, Arial', fontSize: '13px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 0).setAlpha(0.75).setDepth(5);

    // Perimeter barrier: four static bars around the whole rect, inert until
    // the base is locked. Built once and toggled, so locking costs nothing.
    const T = 14;
    const parts = [
      s.add.rectangle(b.x, r.y, b.w + T, T, 0x000000, 0),           // top
      s.add.rectangle(b.x, r.bottom, b.w + T, T, 0x000000, 0),      // bottom
      s.add.rectangle(r.x, b.y, T, b.h + T, 0x000000, 0),           // left
      s.add.rectangle(r.right, b.y, T, b.h + T, 0x000000, 0),       // right
    ];
    parts.forEach((p) => { this.barriers.add(p); p.body.enable = false; });
    this.barrierParts[id] = parts;

    this.fences[id] = s.add.graphics().setDepth(r.bottom + 6).setVisible(false);

    this.lockTexts[id] = s.add.text(b.x, r.y - 18, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '14px', color: '#ffd54f',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(870);

    this.lockState[id] = { locked: false, until: 0, cdUntil: 0 };
    this.refreshPedestals(id);
  }

  _drawFloor(id) {
    const r = this.rect(id);
    const g = this.floors[id];
    g.clear();
    const col = this.floorColor(id);
    g.fillStyle(col, 0.55);
    g.fillRoundedRect(r.x, r.y, r.width, r.height, 14);
    g.lineStyle(5, TextureFactory.shade(col, 1.6), 0.9);
    g.strokeRoundedRect(r.x, r.y, r.width, r.height, 14);
  }

  redrawPlayerFloor() { this._drawFloor('player'); }

  // hazard-striped ring, drawn only while the base is shut
  _drawFence(id) {
    const r = this.rect(id);
    const g = this.fences[id];
    g.clear();
    g.lineStyle(9, 0x37474f, 1);
    g.strokeRoundedRect(r.x, r.y, r.width, r.height, 14);
    g.lineStyle(5, 0xffb300, 1);
    g.strokeRoundedRect(r.x, r.y, r.width, r.height, 14);
  }

  // ---------- approach points ----------
  // Cosmetic now that every side is open: where the player spawns, and where
  // the tutorial's hand points when it says "get home".
  entrance(id) {
    const b = this._cfg(id);
    const r = this.rect(id);
    if (b.entrance === 'top') return { x: b.x, y: r.y };
    if (b.entrance === 'bottom') return { x: b.x, y: r.bottom };
    if (b.entrance === 'left') return { x: r.x, y: b.y };
    return { x: r.right, y: b.y };
  }

  entranceOutside(id) {
    const b = this._cfg(id), e = this.entrance(id), d = 46;
    if (b.entrance === 'top') return { x: e.x, y: e.y - d };
    if (b.entrance === 'bottom') return { x: e.x, y: e.y + d };
    if (b.entrance === 'left') return { x: e.x - d, y: e.y };
    return { x: e.x + d, y: e.y };
  }

  entranceInside(id) {
    const b = this._cfg(id), e = this.entrance(id), d = 42;
    if (b.entrance === 'top') return { x: e.x, y: e.y + d };
    if (b.entrance === 'bottom') return { x: e.x, y: e.y - d };
    if (b.entrance === 'left') return { x: e.x + d, y: e.y };
    return { x: e.x - d, y: e.y };
  }

  // ---------- slots ----------
  slotCount(id) {
    if (id !== 'player') return CFG.BOT_SLOTS;
    return Math.min(CFG.MAX_SLOTS, CFG.PLAYER_SLOTS + (this.scene.upgrades.slot || 0));
  }

  slotPos(id, idx) {
    const b = this._cfg(id);
    const r = this.rect(id);
    if (id === 'player') {
      const col = idx % 4, row = Math.floor(idx / 4);
      return { x: r.x + 62 + col * 86, y: r.y + 72 + row * 58 };
    }
    const col = idx % 3, row = Math.floor(idx / 3);
    const nearTop = b.entrance === 'bottom';   // keep pedestals off the busy edge
    const y0 = nearTop ? r.y + 46 : r.y + 62;
    return { x: r.x + 48 + col * ((b.w - 96) / 2), y: y0 + row * 52 };
  }

  freeSlotIndex(id) {
    const n = this.slotCount(id);
    const used = {};
    this.scene.creatures.list.forEach((c) => {
      if (c.owner === id && c.state !== 'belt') used[c.pedestalIndex] = true;
    });
    for (let i = 0; i < n; i++) if (!used[i]) return i;
    return -1;
  }

  refreshPedestals(id) {
    (this.pedestalImgs[id] || []).forEach((p) => p.destroy());
    this.pedestalImgs[id] = [];
    const n = this.slotCount(id);
    for (let i = 0; i < n; i++) {
      const p = this.slotPos(id, i);
      this.pedestalImgs[id].push(
        this.scene.add.image(p.x, p.y + 8, 'pedestal').setDepth(p.y - 40).setAlpha(0.95)
      );
    }
  }

  // ---------- locks ----------
  isLocked(id) { return this.lockState[id].locked; }
  locksDisabled() { return this.scene.eventMgr && this.scene.eventMgr.active === 'open'; }

  playerLockDuration() {
    return CFG.LOCK_DUR_MS + (this.scene.upgrades.lock || 0) * 5000;
  }

  // `paid` locks bought at the upgrade station skip the cooldown gate and do
  // not start a new one -- that is precisely what the cash is buying.
  lock(id, durMs, paid) {
    if (this.locksDisabled()) return false;
    const st = this.lockState[id];
    if (st.locked) return false;
    if (id === 'player' && !paid && this.scene.time.now < st.cdUntil) return false;
    st.locked = true;
    st.until = this.scene.time.now + durMs;
    if (id === 'player' && !paid) st.cdUntil = st.until + CFG.LOCK_CD_MS;

    this.barrierParts[id].forEach((p) => { p.body.enable = true; });
    this._drawFence(id);
    const fence = this.fences[id];
    fence.setVisible(true).setAlpha(0);
    this.scene.tweens.add({ targets: fence, alpha: 1, duration: 180 });

    const r = this.rect(id);
    this.scene.fx.ringPulse(this._cfg(id).x, r.centerY, 0xffb300, 2.4);
    if (id === 'player') {
      AudioSys.sfx('lock');
      this.scene.fx.floatText(this._cfg(id).x, r.y - 30, 'LOCKED!', '#ffd54f', 20);
    }
    return true;
  }

  unlock(id) {
    const st = this.lockState[id];
    if (!st.locked) return;
    st.locked = false;
    this.barrierParts[id].forEach((p) => { p.body.enable = false; });
    const fence = this.fences[id];
    this.scene.tweens.add({ targets: fence, alpha: 0, duration: 180,
      onComplete: () => fence.setVisible(false) });
    this.lockTexts[id].setText('');
    if (id === 'player') {
      AudioSys.sfx('unlock');
      this.scene.fx.floatText(this._cfg(id).x, this.rect(id).y - 30, 'BASE OPEN', '#ffffff', 16);
    }
  }

  forceUnlockAll() { for (const id in this.lockState) this.unlock(id); }

  update(time) {
    for (const id in this.lockState) {
      const st = this.lockState[id];
      if (st.locked) {
        if (time >= st.until) this.unlock(id);
        else this.lockTexts[id].setText('🔒 ' + Math.ceil((st.until - time) / 1000));
      }
    }
  }
}
window.BaseManager = BaseManager;
