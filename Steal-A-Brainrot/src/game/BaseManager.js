// Bases: floors, walls (physical for the player), entrance gates, pedestals,
// and the lock/cooldown state machine for all six bases.
const PLAYER_BASE_COLORS = [0x00695c, 0x283593, 0x6a1b9a, 0xad1457, 0xbf360c, 0xf57f17, 0x1b5e20];

class BaseManager {
  constructor(scene) {
    this.scene = scene;
    this.walls = scene.physics.add.staticGroup();
    this.gates = {};        // id -> gate image (with static body)
    this.lockState = {};    // id -> { locked, until, cdUntil }
    this.pedestalImgs = {}; // id -> [images]
    this.floors = {};       // id -> rounded-rect graphics
    this.lockTexts = {};    // id -> countdown text
    this._slotCache = {};

    for (const id in CFG.BASES) this._build(id);
  }

  _cfg(id) { return CFG.BASES[id]; }

  rect(id) {
    const b = this._cfg(id);
    return new Phaser.Geom.Rectangle(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
  }

  contains(id, x, y) { return Phaser.Geom.Rectangle.Contains(this.rect(id), x, y); }

  floorColor(id) {
    if (id === 'player') return PLAYER_BASE_COLORS[SaveSys.data.rebirths % PLAYER_BASE_COLORS.length];
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

    // walls: full sides except the entrance side, which gets two flanking stubs
    const T = 12, gap = CFG.ENTRANCE_GAP;
    const addWall = (x, y, w, h) => {
      const w1 = s.add.rectangle(x, y, w, h, 0x000000, 0);
      this.walls.add(w1);
    };
    const sides = { top: false, bottom: false, left: false, right: false };
    sides[b.entrance] = true;
    // top
    if (!sides.top) addWall(b.x, r.y, b.w + T, T);
    else this._flank(addWall, b.x, r.y, b.w, gap, true);
    // bottom
    if (!sides.bottom) addWall(b.x, r.bottom, b.w + T, T);
    else this._flank(addWall, b.x, r.bottom, b.w, gap, true);
    // left
    if (!sides.left) addWall(r.x, b.y, T, b.h + T);
    else this._flank(addWall, r.x, b.y, b.h, gap, false);
    // right
    if (!sides.right) addWall(r.right, b.y, T, b.h + T);
    else this._flank(addWall, r.right, b.y, b.h, gap, false);

    // gate at the entrance
    const ep = this.entrance(id);
    const horiz = b.entrance === 'top' || b.entrance === 'bottom';
    const gate = s.add.image(ep.x, ep.y, horiz ? 'gate_h' : 'gate_v').setDepth(ep.y + 8);
    s.physics.add.existing(gate, true);
    gate.setVisible(false);
    gate.body.enable = false;
    this.gates[id] = gate;

    this.lockTexts[id] = s.add.text(ep.x, ep.y - 22, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '14px', color: '#ffd54f',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(870);

    this.lockState[id] = { locked: false, until: 0, cdUntil: 0 };
    this.refreshPedestals(id);
  }

  _flank(addWall, cx, cy, len, gap, horiz) {
    const seg = (len - gap) / 2;
    if (horiz) {
      addWall(cx - gap / 2 - seg / 2, cy, seg + 12, 12);
      addWall(cx + gap / 2 + seg / 2, cy, seg + 12, 12);
    } else {
      addWall(cx, cy - gap / 2 - seg / 2, 12, seg + 12);
      addWall(cx, cy + gap / 2 + seg / 2, 12, seg + 12);
    }
  }

  _drawFloor(id) {
    const b = this._cfg(id);
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

  // entrance center point on the base edge; `out`/`in` points offset from it
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
    return Math.min(CFG.MAX_SLOTS,
      CFG.PLAYER_SLOTS + SaveSys.data.rebirths * CFG.REBIRTH_SLOT_BONUS + (this.scene.upgrades.slot || 0));
  }

  slotPos(id, idx) {
    const b = this._cfg(id);
    const r = this.rect(id);
    if (id === 'player') {
      const col = idx % 4, row = Math.floor(idx / 4);
      return { x: r.x + 62 + col * 86, y: r.y + 72 + row * 58 };
    }
    const col = idx % 3, row = Math.floor(idx / 3);
    const nearTop = b.entrance === 'bottom';   // keep pedestals away from the door
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

  lock(id, durMs) {
    if (this.locksDisabled()) return false;
    const st = this.lockState[id];
    if (st.locked) return false;
    if (id === 'player' && this.scene.time.now < st.cdUntil) return false;
    st.locked = true;
    st.until = this.scene.time.now + durMs;
    if (id === 'player') st.cdUntil = st.until + CFG.LOCK_CD_MS;
    const gate = this.gates[id];
    gate.setVisible(true).setAlpha(0);
    gate.body.enable = true;
    this.scene.tweens.add({ targets: gate, alpha: 1, duration: 180 });
    this.scene.fx.ringPulse(gate.x, gate.y, 0xffb300, 1.3);
    if (id === 'player') { AudioSys.sfx('lock'); this.scene.fx.floatText(gate.x, gate.y - 24, 'LOCKED!', '#ffd54f', 20); }
    return true;
  }

  unlock(id) {
    const st = this.lockState[id];
    if (!st.locked) return;
    st.locked = false;
    const gate = this.gates[id];
    gate.body.enable = false;
    this.scene.tweens.add({ targets: gate, alpha: 0, duration: 180, onComplete: () => gate.setVisible(false) });
    this.lockTexts[id].setText('');
    if (id === 'player') { AudioSys.sfx('unlock'); this.scene.fx.floatText(gate.x, gate.y - 24, 'BASE OPEN', '#ffffff', 16); }
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
