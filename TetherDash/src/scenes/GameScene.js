// The run itself: physics, the endless tunnel, fake-3D rendering, HUD, touch
// controls, pause and the game-over panel.
//
// Everything visible is re-projected every frame. The tunnel is painted into
// one Graphics in painter's order -- far strips first -- and every sprite is
// one the Track already owns, positioned here and culled with setVisible. No
// display object is created or destroyed while a run is going.
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    const W = CFG.GAME_W, H = CFG.GAME_H;
    this.t = 0; this.runTime = 0;
    this.paused = false; this.over = false; this.dying = false;
    this.bolts = 0; this.flips = 0;
    this.revived = false;
    this.milestone = 0;
    this.hintSide = 0;

    // ---- the void the tunnel hangs in ----
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(CFG.VOID_TOP, CFG.VOID_TOP, CFG.VOID_BOT, CFG.VOID_BOT, 1);
    bg.fillRect(0, 0, W, H);

    // Motes streaming past outside the tube. They are the only thing visible
    // through a hole in a panel, which is what makes a hole read as a hole.
    this.motes = [];
    for (let i = 0; i < 30; i++) {
      const m = this.add.image(0, 0, 'spark').setDepth(5).setTint(0x5b7bd6);
      this.seedMote(m, 4 + Math.random() * (CFG.DRAW_DIST - 6));
      this.motes.push(m);
    }

    this.tunnelGfx = this.add.graphics().setDepth(10);
    this.cordGfx = this.add.graphics().setDepth(19);

    // ---- track + runner ----
    this.sprites = new SpritePool(this);
    Track.init(this, this.sprites).reset();

    this.player = new Runner(this);
    this.player.reset(2);

    this.shadow = this.add.image(0, 0, 'shadow').setVisible(false);
    this.animated = !!Save.meshRunners;
    this.sprH = this.animated ? CFG.SPRITE_H_MESH : CFG.SPRITE_H_PROC;
    this.spr = this.add.sprite(0, 0, 'runnerA').setOrigin(0.5, 1);
    if (this.animated) this.spr.play('runnerA_run');

    this.hint = this.add.image(0, 0, 'glyphFlip').setDepth(88).setVisible(false);

    this.cam = new CameraController();
    this.cam.snapTo(this.player);
    this.fx = new Effects(this);
    this.im = new InputManager(this);

    this.createHUD();
    if (this.sys.game.device.input.touch) this.createTouchControls();
    if (/[?&]debug/.test(location.search)) this.initDebug();

    Poki.gameplayStart();

    this.events.on('shutdown', () => {
      AudioSys.stopRush();
      Poki.gameplayStop();
      const panel = document.getElementById('debug-panel');
      if (panel) panel.style.display = 'none';
    });
  }

  /** Park a mote at a random point outside the tube, `dz` ahead of the camera. */
  seedMote(m, dz) {
    const a = Math.random() * Math.PI * 2;
    const r = CFG.TUBE_R * 1.9 + Math.random() * 9;
    m.wx = Math.cos(a) * r;
    m.wy = Math.sin(a) * r;
    m.wz = dz;
  }

  // ------------------------------------------------------------------ HUD

  createHUD() {
    const W = CFG.GAME_W;
    const style = {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '24px', fontStyle: 'bold',
      color: '#ffffff', stroke: '#101838', strokeThickness: 5
    };
    this.add.image(30, 28, 'bolt').setScale(0.7).setDepth(100);
    this.hudBolts = this.add.text(50, 14, '0', style).setDepth(100);

    this.hudDist = this.add.text(W / 2, 16, '0 m', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '38px', fontStyle: 'bold',
      color: '#ffffff', stroke: '#101838', strokeThickness: 7
    }).setOrigin(0.5, 0).setDepth(100);

    this.hudBest = this.add.text(W - 78, 18, 'BEST ' + Save.data.best, {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '17px', fontStyle: 'bold',
      color: '#9ec7ff', stroke: '#101838', strokeThickness: 4
    }).setOrigin(1, 0).setDepth(100);

    Effects.button(this, W - 40, 30, 48, 40, 'II', () => this.showPause(),
      { color: 0x4a5a92, fontSize: 18, depth: 100 });

    if (!Save.data.seenTutorial) {
      const tip = this.add.text(CFG.GAME_W / 2, 150,
        'Hold  ←  →  into a corner\nto run up the wall', {
        fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '26px', fontStyle: 'bold',
        color: '#ffffff', stroke: '#e0537e', strokeThickness: 6, align: 'center'
      }).setOrigin(0.5).setDepth(100);
      this.tweens.add({ targets: tip, alpha: 0, delay: 4200, duration: 800, onComplete: () => tip.destroy() });
      Save.markTutorialSeen();
    }
  }

  createTouchControls() {
    const H = CFG.GAME_H, W = CFG.GAME_W;
    const t = this.im.touch;
    const mk = (x, y, glyph, scale, onDown, onUp) => {
      const btn = this.add.image(x, y, 'touchBtn').setDepth(120).setScale(scale).setInteractive();
      this.add.image(x, y, glyph).setDepth(121).setScale(scale);
      btn.on('pointerdown', () => { AudioSys.unlock(); onDown(); });
      btn.on('pointerup', onUp);
      btn.on('pointerout', onUp);
      return btn;
    };
    mk(70, H - 66, 'glyphLeft', 1.15, () => { t.left = true; }, () => { t.left = false; });
    mk(186, H - 66, 'glyphRight', 1.15, () => { t.right = true; }, () => { t.right = false; });
    mk(W - 88, H - 88, 'glyphJump', 1.35,
      () => { t.jumpHeld = true; t.jumpJust = true; }, () => { t.jumpHeld = false; });
  }

  // ------------------------------------------------------------------ loop

  update(time, deltaMs) {
    if (this.paused || this.over) return;
    const dt = Math.min(deltaMs / 1000, 0.033);
    this.t += dt;
    const p = this.player;

    // Falling out is worth watching: physics and input stop, the camera and
    // the renderer do not, so the tunnel recedes above you for a beat before
    // the panel arrives.
    if (this.dying) {
      p.h -= 26 * dt;
      p.z += p.speed * 0.4 * dt;
      this.cam.update(dt, p);
      this.render(dt);
      return;
    }

    this.runTime += dt;
    if (this.im.pausePressed()) { this.showPause(); return; }
    if (this.im.retryPressed()) { this.scene.restart(); return; }

    p.update(dt, this.im.get());
    if (this.dying) return;             // the update ran him off the edge

    Track.update(p.z, dt);
    this.collectBolts();
    this.updateHint();
    this.checkMilestone();

    this.cam.update(dt, p);
    this.render(dt);

    const speed01 = Phaser.Math.Clamp(
      (p.speed - CFG.RUN_SPEED) / (CFG.SPEED_MAX - CFG.RUN_SPEED), 0, 1);
    AudioSys.setRush(speed01);

    this.hudDist.setText(Math.floor(p.distance) + ' m');
    this.hudBolts.setText(String(this.bolts));
  }

  get score() { return Math.floor(this.player.distance) + this.bolts * CFG.BOLT_SCORE; }

  onFlip(p) {
    this.flips++;
    this.fx.flipBurst(p);
    this.cam.shake(3, 0.12);
  }

  collectBolts() {
    const p = this.player;
    for (const c of Track.chunks) {
      if (p.z < c.z0 - 2 || p.z > c.z1 + 2) continue;
      for (const b of c.bolts) {
        if (b.taken || b.f !== p.f) continue;
        if (Math.abs(b.z - p.z) > 0.9) continue;
        if (Math.abs(b.u - p.u) > 0.9) continue;
        if (Math.abs(b.h - (p.h + 0.55)) > 1.15) continue;
        b.taken = true;
        if (b.spr) b.spr.setVisible(false);
        this.bolts++;
        AudioSys.play('coin');
        const pr = Projection.face(b.f, b.u, b.h, b.z);
        this.fx.coinBurst(pr.x, pr.y);
      }
    }
  }

  checkMilestone() {
    const m = Math.floor(this.player.distance / 250);
    if (m <= this.milestone) return;
    this.milestone = m;
    AudioSys.play('milestone');
    Poki.happyTime(0.4);
    this.fx.floatText(CFG.GAME_W / 2, 210, (m * 250) + ' m!', '#9ef0e0', 34);
  }

  // Looks ahead down the face the runner is on. If the panels run out inside a
  // gap no jump can clear, and a neighbouring face carries on past it, a
  // chevron points at the wall to take. This is the whole game's tutorial, and
  // it keeps working forever because it reads the live track, not the piece id.
  updateHint() {
    const p = this.player;
    const R = CFG.TUBE_R;
    this.hintSide = 0;
    if (!p.alive) return;

    const d = Track.distToDrop(p.f, p.u, p.z, 22);
    if (d >= 16) return;

    const reach = 2 * CFG.JUMP_VEL / CFG.GRAVITY * p.speed;
    for (let s = d + 0.5; s <= d + reach * 0.85; s += 0.5) {
      if (Track.groundAt(p.f, p.u, p.z + s, 0)) return;   // just a jump, not a wall
    }
    const probe = p.z + d + 3;
    if (Track.groundAt((p.f + 1) % 4, -R + 0.6, probe)) this.hintSide = 1;
    else if (Track.groundAt((p.f + 3) % 4, R - 0.6, probe)) this.hintSide = -1;
  }

  // ------------------------------------------------------------ falling out

  handleFall() {
    if (this.dying || this.over) return;
    this.dying = true;
    this.hintSide = 0;
    this.hint.setVisible(false);
    this.player.alive = false;
    AudioSys.play('fall');
    AudioSys.stopRush();
    this.cam.shake(9, 0.3);
    this.time.delayedCall(650, () => { this.over = true; this.gameOver(); });
  }

  gameOver() {
    const score = this.score;
    const dist = Math.floor(this.player.distance);
    const beat = Save.recordRun(score, dist, this.bolts);
    Poki.gameplayStop();
    AudioSys.play(beat ? 'best' : 'gameover');
    if (beat) { this.fx.winConfetti(); Poki.happyTime(1); }

    const W = CFG.GAME_W, H = CFG.GAME_H;
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x101838, 0.55).setDepth(190);
    const panel = this.add.container(W / 2, H / 2).setDepth(200);
    this.overItems = [dim, panel];
    const g = this.add.graphics();
    g.fillStyle(0x101838, 0.35); g.fillRoundedRect(-235, -164, 470, 340, 26);
    g.fillStyle(0xffffff, 1); g.fillRoundedRect(-240, -170, 470, 340, 26);
    g.lineStyle(5, beat ? 0xffd35c : 0xf2aac6, 1); g.strokeRoundedRect(-240, -170, 470, 340, 26);
    panel.add(g);

    panel.add(this.add.text(-5, -132, beat ? 'NEW BEST!' : 'RUN OVER', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '36px', fontStyle: 'bold',
      color: beat ? '#e8a300' : '#e0537e'
    }).setOrigin(0.5));

    panel.add(this.add.text(-5, -74, String(score), {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '58px', fontStyle: 'bold',
      color: '#33406b'
    }).setOrigin(0.5));

    panel.add(this.add.text(-5, -22,
      dist + ' m      ' + this.bolts + ' bolts      ' + this.flips + ' flips', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '21px', fontStyle: 'bold',
      color: '#4a6a8a'
    }).setOrigin(0.5));

    // One revive per run, and only where an ad can actually be shown. Off
    // platform the button is simply not there rather than being a dead end.
    const canRevive = !this.revived && Poki.ready;
    if (canRevive) {
      panel.add(Effects.button(this, -5, 34, 300, 54, '▶  KEEP RUNNING',
        () => this.tryRevive(), { color: 0x53a8d6, fontSize: 22, depth: 0 }));
    }
    const y = canRevive ? 104 : 54;
    panel.add(Effects.button(this, canRevive ? -85 : -5, y, canRevive ? 180 : 240, 54,
      'RETRY', () => Poki.startRun(this), { fontSize: 24, depth: 0 }));
    panel.add(Effects.button(this, canRevive ? 110 : -5, canRevive ? y : y + 66,
      canRevive ? 150 : 240, canRevive ? 54 : 48, 'MENU',
      () => this.scene.start('Menu'), { color: 0x8899aa, fontSize: 20, depth: 0 }));

    panel.setScale(0.4).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 360, ease: 'Back.easeOut' });
    this.overPanel = panel;
  }

  tryRevive(panel) {
    Poki.rewardedBreak().then((watched) => {
      if (!watched) return;
      this.revived = true;
      panel.destroy();
      this.children.list
        .filter((o) => o.depth === 190 || o.depth === 200)
        .forEach((o) => o.destroy());
      this.resumeAfterRevive();
    });
  }

  resumeAfterRevive() {
    const p = this.player;
    const spot = this.findSafeSpot(p.distance - CFG.REVIVE_BACK);
    p.reset(spot.z);
    p.f = spot.f;
    p.distance = Math.max(spot.z, p.distance);   // keep the speed you earned
    p.roll = -Math.PI / 2 * spot.f;
    p.stun = 0;
    this.cam.snapTo(p);
    this.over = false;
    this.dying = false;
    AudioSys.play('revive');
    const pr = Projection.face(p.f, p.u, p.h, p.z);
    this.fx.reviveBurst(pr.x, pr.y);
    this.im.clear();
    Poki.gameplayStart();
  }

  /** The nearest z at or behind `from` with a panel under u = 0, and its face. */
  findSafeSpot(from) {
    for (let z = from; z > from - 40; z -= 1) {
      for (let f = 0; f < 4; f++) {
        if (Track.groundAt(f, 0, z, 0)) return { z, f };
      }
    }
    // Nothing behind survived the recycler: weld a fresh straight on the front.
    const c = Track._spawn(PIECES[0]);
    return { z: c.z0 + 2, f: 0 };
  }

  // ------------------------------------------------------------------ pause

  showPause() {
    if (this.over) return;
    this.paused = true;
    AudioSys.setRush(0);
    this.im.clear();
    // A pause is not play time, and Poki wants the pair around it: the session
    // ends here and a fresh one starts on RESUME.
    Poki.gameplayStop();
    const W = CFG.GAME_W, H = CFG.GAME_H;
    const items = [];
    items.push(this.add.rectangle(W / 2, H / 2, W, H, 0x101838, 0.6).setDepth(190).setInteractive());
    items.push(this.add.text(W / 2, H / 2 - 110, 'PAUSED', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '44px', fontStyle: 'bold',
      color: '#ffffff', stroke: '#e0537e', strokeThickness: 8
    }).setOrigin(0.5).setDepth(191));
    const close = () => {
      items.forEach((o) => o.destroy());
      this.paused = false;
      this.im.clear();
      if (!this.over) Poki.gameplayStart();
    };
    items.push(Effects.button(this, W / 2, H / 2 - 30, 240, 56, 'RESUME', close, { depth: 191 }));
    items.push(Effects.button(this, W / 2, H / 2 + 42, 240, 52, 'RESTART',
      () => this.scene.restart(), { color: 0x53a8d6, fontSize: 22, depth: 191 }));
    items.push(Effects.button(this, W / 2, H / 2 + 110, 240, 52, 'MENU',
      () => this.scene.start('Menu'), { color: 0x8899aa, fontSize: 22, depth: 191 }));
    this.input.keyboard.once('keydown-ESC', close);
  }

  // -------------------------------------------------------------- rendering

  render(dt) {
    this.drawMotes(dt);
    this.drawTunnel();
    this.placeEntities();
    this.placePlayer();
    this.drawCord();
    this.drawHint();
    if (this.debugReadout) this.updateDebug();
  }

  drawMotes(dt) {
    const speed = this.player.speed;
    for (const m of this.motes) {
      m.wz -= speed * dt;
      if (m.wz < 2.5) this.seedMote(m, CFG.DRAW_DIST - 4);
      const pr = Projection.project(m.wx, m.wy, Projection.cam.z + m.wz);
      m.setPosition(pr.x, pr.y).setScale(Math.max(0.25, pr.s * 0.02));
      m.setAlpha(0.5 * (1 - Projection.fog(pr.dz)));
    }
  }

  // One Graphics, painter's order. Panels are cut into fixed-length strips so
  // the two-tone banding scrolls past at a constant rate however long a piece
  // is, and so a strip's depth is a good enough sort key for a convex tube.
  drawTunnel() {
    const g = this.tunnelGfx;
    g.clear();
    const camZ = Projection.cam.z;
    const zNear = camZ + CFG.NEAR, zFar = camZ + CFG.DRAW_DIST;
    const items = this._items || (this._items = []);
    items.length = 0;

    for (const c of Track.chunks) {
      if (c.z1 < zNear || c.z0 > zFar) continue;
      for (const p of c.panels) {
        const z0 = Math.max(p.z0, zNear), z1 = Math.min(p.z1, zFar);
        if (z1 <= z0 + 0.01) continue;
        let s0 = z0;
        for (let b = Math.ceil(z0 / CFG.STRIP) * CFG.STRIP; b < z1; b += CFG.STRIP) {
          items.push({ z: s0, kind: 0, p, s0, s1: b });
          s0 = b;
        }
        items.push({ z: s0, kind: 0, p, s0, s1: z1 });
        // the panel's own thickness at its near end -- what makes a hole
        // look like an edge you can fall off rather than a change of paint
        if (p.z0 > zNear) items.push({ z: p.z0 - 0.01, kind: 1, p });
      }
      for (const pad of c.pads) {
        if (Projection.inView(pad.z)) items.push({ z: pad.z, kind: 2, pad });
      }
    }

    items.sort((a, b) => b.z - a.z);
    for (const it of items) {
      if (it.kind === 0) this.drawStrip(g, it.p, it.s0, it.s1);
      else if (it.kind === 1) this.drawLip(g, it.p);
      else this.drawPad(g, it.pad);
    }
  }

  drawStrip(g, p, s0, s1) {
    const f = p.f;
    const n1 = Projection.face(f, p.u0, 0, s0);
    const n2 = Projection.face(f, p.u1, 0, s0);
    const f1 = Projection.face(f, p.u0, 0, s1);
    const f2 = Projection.face(f, p.u1, 0, s1);
    const fog = Projection.fog((n1.dz + f1.dz) / 2);
    const even = Math.floor(s0 / CFG.STRIP) % 2 === 0;
    const base = p.ring ? (even ? CFG.RING_A : CFG.RING_B)
      : (even ? CFG.FACE_A[f] : CFG.FACE_B[f]);
    g.fillStyle(Projection.fogColor(base, fog), 1);
    g.beginPath();
    g.moveTo(f1.x, f1.y); g.lineTo(f2.x, f2.y);
    g.lineTo(n2.x, n2.y); g.lineTo(n1.x, n1.y);
    g.closePath(); g.fillPath();
    // The two long edges: the depth cue that makes the corner of a face --
    // the thing you have to walk off to flip -- readable at speed.
    const edge = Projection.fogColor(p.ring ? CFG.RING_EDGE : CFG.FACE_EDGE[f], fog);
    g.lineStyle(Math.max(1.5, n1.s * 0.05), edge, 0.9);
    g.beginPath(); g.moveTo(f1.x, f1.y); g.lineTo(n1.x, n1.y); g.strokePath();
    g.beginPath(); g.moveTo(f2.x, f2.y); g.lineTo(n2.x, n2.y); g.strokePath();
  }

  drawLip(g, p) {
    const f = p.f, z = p.z0;
    const t1 = Projection.face(f, p.u0, 0, z);
    const t2 = Projection.face(f, p.u1, 0, z);
    const b1 = Projection.face(f, p.u0, -0.6, z);
    const b2 = Projection.face(f, p.u1, -0.6, z);
    const fog = Projection.fog(t1.dz);
    g.fillStyle(Projection.fogColor(CFG.PANEL_LIP, fog), 1);
    g.beginPath();
    g.moveTo(t1.x, t1.y); g.lineTo(t2.x, t2.y);
    g.lineTo(b2.x, b2.y); g.lineTo(b1.x, b1.y);
    g.closePath(); g.fillPath();
  }

  drawPad(g, pad) {
    const pr = Projection.face(pad.f, pad.u, 0.02, pad.z);
    const fog = Projection.fog(pr.dz);
    const pulse = 0.75 + Math.sin(this.t * 5) * 0.25;
    g.fillStyle(Projection.fogColor(CFG.PAD_COLOR, fog), 1);
    g.fillEllipse(pr.x, pr.y, pad.r * 2 * pr.s, pad.r * 2 * pr.s * 0.42);
    g.fillStyle(0xffffff, 0.5 * pulse * (1 - fog));
    g.fillEllipse(pr.x, pr.y, pad.r * 1.3 * pr.s, pad.r * 1.3 * pr.s * 0.42);
  }

  placeEntities() {
    const t = this.t;
    for (const c of Track.chunks) {
      for (const b of c.bolts) {
        if (!b.spr) continue;
        if (b.taken || !Projection.inView(b.z)) { b.spr.setVisible(false); continue; }
        const pr = Projection.face(b.f, b.u, b.h + Math.sin(t * 3 + b.z) * 0.12, b.z);
        b.spr.setVisible(true).setPosition(pr.x, pr.y)
          .setScale(pr.s * 0.5 / 44)
          .setDepth(20 + Math.max(0, CFG.DRAW_DIST - pr.dz))
          .setAlpha(1 - Projection.fog(pr.dz));
        b.spr.rotation = t * 1.5;
      }
      for (const h of c.hazards) {
        if (!h.spr) continue;
        if (!Projection.inView(h.z)) { h.spr.setVisible(false); continue; }
        const pr = Projection.face(h.f, h.u, h.r * 0.62, h.z);
        const px = h.kind === 'block' ? 120 : 160;
        h.spr.setVisible(true).setPosition(pr.x, pr.y)
          .setScale(pr.s * h.r * 2 / px)
          .setDepth(20 + Math.max(0, CFG.DRAW_DIST - pr.dz))
          .setAlpha(1 - Projection.fog(pr.dz));
        h.spr.rotation = h.kind === 'gear' ? h.angle : 0;
      }
      for (const pad of c.pads) {
        if (!pad.spr) continue;
        if (!Projection.inView(pad.z)) { pad.spr.setVisible(false); continue; }
        const pr = Projection.face(pad.f, pad.u, 0.02, pad.z);
        const fog = Projection.fog(pr.dz);
        pad.spr.setVisible(true)
          .setPosition(pr.x, pr.y - 0.5 * pr.s - Math.sin(t * 5) * 4)
          .setScale(pr.s * 0.012)
          .setDepth(20 + Math.max(0, CFG.DRAW_DIST - pr.dz))
          .setAlpha(1 - fog);
      }
    }
  }

  placePlayer() {
    const p = this.player;
    const pr = Projection.face(p.f, p.u, p.h, p.z);
    const spr = this.spr;
    const base = this.sprH * pr.s / spr.height;
    spr.setPosition(pr.x, pr.y);
    spr.setScale(base * (1 + p.squash * 0.7), base * (1 - p.squash));
    spr.rotation = Phaser.Math.Clamp(p.vu * 0.035, -0.3, 0.3);
    spr.setDepth(p.h < -0.6 ? 8 : 20 + Math.max(0, CFG.DRAW_DIST - pr.dz));
    spr.setAlpha(p.stun > 0 ? (Math.floor(this.t * 18) % 2 === 0 ? 0.45 : 1) : 1);

    // The run cycle keeps pace with how fast the runner is actually moving,
    // and holds one pose in the air -- a walk cycle mid-jump reads as a bug.
    if (this.animated) {
      if (p.grounded && p.alive) {
        if (!spr.anims.isPlaying) spr.anims.play('runnerA_run', true);
        spr.anims.timeScale = Phaser.Math.Clamp(p.speed / CFG.RUN_SPEED, 0.35, 2.2);
      } else if (spr.anims.isPlaying) {
        spr.anims.stop();
        spr.setFrame(CFG.RUNNER_JUMP_FRAME);
      }
    }

    if (p.h > -0.3 && Track.groundAt(p.f, p.u, p.z)) {
      const sh = Projection.face(p.f, p.u, 0, p.z);
      this.shadow.setVisible(true).setPosition(sh.x, sh.y)
        .setScale(sh.s * 0.014 * Math.max(0.4, 1 - p.h * 0.18))
        .setAlpha(0.5 * Math.max(0.25, 1 - p.h * 0.25))
        .setDepth(spr.depth - 1);
    } else {
      this.shadow.setVisible(false);
    }
  }

  // The magnetic tether: a line from the runner to the tunnel's axis. It is
  // what holds him to whatever face he is on, and watching it swing round the
  // tube is the clearest read of which way is currently down.
  drawCord() {
    const g = this.cordGfx;
    g.clear();
    const p = this.player;
    if (!p.alive) return;
    const a = Projection.face(p.f, p.u, p.h + 0.72, p.z);
    const b = Projection.project(0, 0, p.z + 2.2);
    const flip = p.flipFlash > 0;
    const color = flip ? CFG.CORD_FLIP : CFG.CORD_COLOR;
    // Quiet while it is just holding him down, loud for the third of a second
    // it is biting a new face -- otherwise it is a bright line across the
    // middle of every frame competing with the track for attention.
    const lw = Math.max(1.2, a.s * 0.016) * (flip ? 2.4 : 1);
    g.lineStyle(lw * 2.4, color, flip ? 0.35 : 0.08);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.strokePath();
    g.lineStyle(lw, color, flip ? 1 : 0.42);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.strokePath();
  }

  drawHint() {
    if (this.hintSide === 0) { this.hint.setVisible(false); return; }
    const p = this.player;
    const pr = Projection.face(p.f, this.hintSide * (CFG.TUBE_R + 0.9), 1.1, p.z + 7);
    const pulse = 0.6 + Math.abs(Math.sin(this.t * 6)) * 0.4;
    this.hint.setVisible(true).setPosition(pr.x, pr.y)
      .setScale(pr.s * 0.022 * pulse)
      .setAlpha(pulse)
      .setFlipX(this.hintSide < 0);
  }

  // ------------------------------------------------------------------ debug

  initDebug() {
    const panel = document.getElementById('debug-panel');
    if (!panel) return;
    panel.style.display = 'block';
    panel.innerHTML = '<b>tunnel</b>';
    this.debugReadout = document.createElement('div');
    panel.appendChild(this.debugReadout);
  }

  updateDebug() {
    const p = this.player;
    const s = this.sprites.census();
    this.debugReadout.textContent =
      'face ' + p.f + '  u ' + p.u.toFixed(2) + '  h ' + p.h.toFixed(2) +
      '  spd ' + p.speed.toFixed(1) + '  tier ' + Track.tier() +
      '\nchunks ' + Track.chunks.length +
      '  free bolt/gear ' + (s.bolt || 0) + '/' + (s.gearHaz || 0) +
      '  fps ' + Math.round(this.game.loop.actualFps);
  }
}
