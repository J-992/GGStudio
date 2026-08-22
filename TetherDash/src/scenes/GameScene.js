// The run itself: physics, tether, rescue drama, fake-3D rendering, HUD,
// touch controls, pause and the completion panel. Everything visible is
// re-projected every frame; the course is drawn painter's-order into one
// Graphics object, sprites get their depth from camera distance.
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) { this.levelId = (data && data.levelId) || 1; }

  create() {
    const W = CFG.GAME_W, H = CFG.GAME_H;
    this.level = LEVELS[this.levelId - 1];
    this.course = Course.build(this.level);
    this.mode = Save.data.mode;
    this.t = 0; this.runTime = 0;
    this.paused = false; this.finished = false; this.respawning = false;
    this.falls = 0; this.boltsGot = 0;
    this.critWarned = false;
    this.lastCheckpoint = this.course.checkpoints[0];
    this.passedCp = 0;

    // ---- background ----
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(CFG.SKY_TOP, CFG.SKY_TOP, CFG.SKY_BOT, CFG.SKY_BOT, 1);
    bg.fillRect(0, 0, W, CFG.HORIZON_Y + 40);
    bg.fillGradientStyle(0xbfe0f7, 0xbfe0f7, 0xa8cae8, 0xa8cae8, 1);
    bg.fillRect(0, CFG.HORIZON_Y + 40, W, H - CFG.HORIZON_Y - 40);

    // slow clouds above the horizon
    this.skyClouds = [];
    for (let i = 0; i < 5; i++) {
      const c = this.add.image(Math.random() * W, 25 + Math.random() * (CFG.HORIZON_Y - 60), 'cloud' + (i % 3))
        .setAlpha(0.65).setScale(0.5 + Math.random() * 0.6).setDepth(1);
      c.drift = 4 + Math.random() * 8;
      this.skyClouds.push(c);
    }
    // clouds streaming past far below — the "you are high up" motion cue
    this.deepClouds = [];
    for (let i = 0; i < 10; i++) {
      const c = this.add.image(0, 0, 'cloud' + (i % 3)).setDepth(3).setAlpha(0.85);
      c.wx = -30 + Math.random() * 60;
      c.wz = 5 + Math.random() * 65;
      c.size = 1.2 + Math.random() * 2.2;
      this.deepClouds.push(c);
    }

    this.courseGfx = this.add.graphics().setDepth(10);
    this.tetherGfx = this.add.graphics().setDepth(19);

    // ---- world sprites ----
    for (const b of this.course.bolts) {
      b.spr = this.add.image(0, 0, 'bolt').setVisible(false);
    }
    for (const g of this.course.gears) {
      g.spr = this.add.image(0, 0, 'gearHaz').setVisible(false);
    }
    for (const pad of this.course.pads) {
      pad.spr = this.add.image(0, 0, 'padGlyph').setVisible(false);
    }

    this.playerA = new PlayerController(this, this.course, 'A', -0.9);
    this.playerB = new PlayerController(this, this.course, 'B', 0.9);
    this.shadowA = this.add.image(0, 0, 'shadow');
    this.shadowB = this.add.image(0, 0, 'shadow');
    this.sprA = this.add.image(0, 0, 'runnerA');
    this.sprB = this.add.image(0, 0, 'runnerB');

    this.tether = new TetherSystem();
    this.cam = new CameraController();
    this.cam.snapTo(this.playerA, this.playerB);
    this.fx = new Effects(this);
    this.im = new InputManager(this, this.mode);
    this.aiA = new CompanionAI(this.course);
    this.aiB = new CompanionAI(this.course);
    this.activeId = 'A';
    this.rescue = null;

    this.youTag = this.add.text(0, 0, '▼', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '22px', fontStyle: 'bold',
      color: '#ffd35c', stroke: '#a06b20', strokeThickness: 4
    }).setOrigin(0.5).setDepth(85).setVisible(this.mode === 'solo');

    this.createHUD();
    if (this.sys.game.device.input.touch) this.createTouchControls();
    if (/[?&]debug/.test(location.search)) this.initDebug();

    Poki.gameplayStart();

    this.events.on('shutdown', () => {
      AudioSys.stopTension();
      Poki.gameplayStop();
      const panel = document.getElementById('debug-panel');
      if (panel) panel.style.display = 'none';
    });
  }

  // ------------------------------------------------------------------ HUD

  createHUD() {
    const W = CFG.GAME_W;
    const style = {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '24px', fontStyle: 'bold',
      color: '#ffffff', stroke: '#33334d', strokeThickness: 5
    };
    this.hudLevel = this.add.text(18, 14, 'LV ' + this.levelId, style).setDepth(100);
    this.add.image(W / 2 - 44, 28, 'bolt').setScale(0.7).setDepth(100);
    this.hudBolts = this.add.text(W / 2 - 22, 14, '0/' + this.course.bolts.length, style).setDepth(100);
    this.hudTime = this.add.text(W - 130, 14, '0:00', style).setDepth(100);

    Effects.button(this, W - 40, 30, 48, 40, 'II', () => this.showPause(),
      { color: 0x8899aa, fontSize: 18, depth: 100 });

    if (this.level.tip) {
      const tip = this.add.text(W / 2, 130, this.level.tip, {
        fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '22px', fontStyle: 'bold',
        color: '#ffffff', stroke: '#e0537e', strokeThickness: 5,
        align: 'center', wordWrap: { width: 640 }
      }).setOrigin(0.5).setDepth(100);
      this.tweens.add({ targets: tip, alpha: 0, delay: 3400, duration: 700, onComplete: () => tip.destroy() });
    }
  }

  createTouchControls() {
    const H = CFG.GAME_H, W = CFG.GAME_W;
    const mk = (x, y, glyph, scale, onDown, onUp) => {
      const btn = this.add.image(x, y, 'touchBtn').setDepth(120).setScale(scale).setInteractive();
      if (glyph) this.add.image(x, y, glyph).setDepth(121).setScale(scale);
      btn.on('pointerdown', () => { AudioSys.unlock(); onDown(); });
      btn.on('pointerup', onUp);
      btn.on('pointerout', onUp);
      return btn;
    };
    const wire = (id, x0, mirror) => {
      const t = this.im.touch[id];
      const s = mirror ? -1 : 1;
      mk(x0, H - 62, 'glyphLeft', 1, () => { t.left = true; }, () => { t.left = false; });
      mk(x0 + s * 104, H - 62, 'glyphRight', 1, () => { t.right = true; }, () => { t.right = false; });
      mk(x0 + s * 52, H - 160, 'glyphJump', 1.05,
        () => { t.jumpHeld = true; t.jumpJust = true; }, () => { t.jumpHeld = false; });
    };
    if (this.mode === 'coop') {
      wire('A', 66, false);
      wire('B', W - 66, true);
    } else {
      wire('A', 66, false);
      const jump = this.add.image(W - 84, H - 84, 'touchBtn').setDepth(120).setScale(1.3).setInteractive();
      this.add.image(W - 84, H - 84, 'glyphJump').setDepth(121).setScale(1.3);
      const t = this.im.touch.A;
      jump.on('pointerdown', () => { AudioSys.unlock(); t.jumpHeld = true; t.jumpJust = true; });
      jump.on('pointerup', () => { t.jumpHeld = false; });
      jump.on('pointerout', () => { t.jumpHeld = false; });
    }
    if (this.mode === 'solo') {
      Effects.button(this, W - 84, H - 190, 96, 44, 'SWAP', () => this.swapRunner(),
        { color: 0x53a8d6, fontSize: 18, depth: 120 });
    }
  }

  // ------------------------------------------------------------------ update

  update(time, deltaMs) {
    if (this.paused || this.finished) return;
    const dt = Math.min(deltaMs / 1000, 0.033);
    this.t += dt; this.runTime += dt;
    const A = this.playerA, B = this.playerB;

    if (this.im.pausePressed()) { this.showPause(); return; }
    if (this.im.retryPressed()) { this.scene.restart({ levelId: this.levelId }); return; }
    if (this.mode === 'solo' && this.im.swapPressed()) this.swapRunner();

    const inpA = this.im.getFor('A', this.activeId) || this.aiA.getInput(A, B, this.t, dt);
    const inpB = this.im.getFor('B', this.activeId) || this.aiB.getInput(B, A, this.t, dt);
    A.update(dt, inpA, this.t);
    B.update(dt, inpB, this.t);

    // the companion eases off when it gets too far ahead of the human
    if (this.mode === 'solo') {
      const aiP = this.activeId === 'A' ? B : A;
      const hum = this.activeId === 'A' ? A : B;
      if (aiP.z - hum.z > CFG.tether.slackLength * 0.8) {
        aiP.vzExtra = Math.max(aiP.vzExtra - 8 * dt, -3);
      }
    }

    this.updateRescue(dt);
    this.tether.update(dt, A, B);

    for (const g of this.course.gears) g.angle += g.speed * dt;

    this.collectBolts(A);
    this.collectBolts(B);
    this.checkCheckpoints();

    if (A.z > this.course.finishZ && B.z > this.course.finishZ) { this.complete(); return; }

    this.cam.update(dt, A, B, this.tether);
    this.render(dt);

    AudioSys.setTension(this.tether.state >= 1 ? this.tether.tension01 : 0);
    if (this.tether.state === 3 && !this.critWarned) { AudioSys.play('warn'); this.critWarned = true; }
    if (this.tether.state < 3) this.critWarned = false;

    const m = Math.floor(this.runTime / 60), s = Math.floor(this.runTime % 60);
    this.hudTime.setText(m + ':' + (s < 10 ? '0' : '') + s);
  }

  swapRunner() {
    this.activeId = this.activeId === 'A' ? 'B' : 'A';
    AudioSys.play('swap');
  }

  collectBolts(p) {
    for (const b of this.course.bolts) {
      if (b.taken) continue;
      if (Math.abs(b.z - p.z) < 0.9 && Math.abs(b.x - p.x) < 0.85 && Math.abs(b.y - (p.y + 0.55)) < 1.15) {
        b.taken = true;
        b.spr.setVisible(false);
        this.boltsGot++;
        AudioSys.play('coin');
        const pr = Projection.project(b.x, b.y, b.z);
        this.fx.coinBurst(pr.x, pr.y);
        this.hudBolts.setText(this.boltsGot + '/' + this.course.bolts.length);
      }
    }
  }

  checkCheckpoints() {
    const cps = this.course.checkpoints;
    const behind = Math.min(this.playerA.z, this.playerB.z);
    for (let i = this.passedCp + 1; i < cps.length; i++) {
      if (behind > cps[i]) {
        this.passedCp = i;
        this.lastCheckpoint = cps[i];
        AudioSys.play('checkpoint');
        Poki.happyTime(0.4);
        this.fx.floatText(CFG.GAME_W / 2, 200, 'CHECKPOINT!', '#9ef0e0', 34);
      }
    }
  }

  // ------------------------------------------------------------------ falling & rescue

  handleFall(p) {
    if (p.state !== 'run' || this.finished || this.respawning) return;
    const o = p === this.playerA ? this.playerB : this.playerA;
    this.falls++;
    if (o.state === 'run' && o.grounded && this.tether.dist <= CFG.RESCUE_MAX) {
      p.state = 'rescued';
      AudioSys.play('fall');
      AudioSys.play('rescue');
      const pr = Projection.project(o.x, o.y + 1.6, o.z);
      this.fx.floatText(pr.x, pr.y - 20, 'SAVED!', '#9ef0e0', 34);
      this.rescue = { p, o, k: 0, sx: p.x, sy: p.y, sz: p.z };
      this.cam.shake(5, 0.2);
    } else {
      this.respawn();
    }
  }

  updateRescue(dt) {
    const r = this.rescue;
    if (!r) return;
    r.k = Math.min(1, r.k + dt / CFG.RESCUE_TIME);
    const e = r.k * r.k * (3 - 2 * r.k);   // smoothstep
    const side = Math.sign(r.sx - r.o.x) || (r.p.id === 'A' ? -1 : 1);
    const tx = r.o.x + side * 1.15;
    const tz = r.o.z - 0.7;
    r.p.x = r.sx + (tx - r.sx) * e;
    r.p.z = r.sz + (tz - r.sz) * e;
    // swing: sink along the cord, then whip up over the edge
    r.p.y = r.sy * (1 - e) * (1 - e) + Math.sin(e * Math.PI) * 1.4 * e;
    if (r.k >= 1) {
      r.p.state = 'run';
      r.p.y = 0.6; r.p.vy = 2; r.p.vx = 0; r.p.vzExtra = 0;
      r.p.grounded = false;
      const pr = Projection.project(r.p.x, r.p.y, r.p.z);
      this.fx.rescueBurst(pr.x, pr.y);
      this.rescue = null;
    }
  }

  respawn() {
    if (this.respawning) return;
    this.respawning = true;
    this.rescue = null;
    AudioSys.play('fall');
    const cover = this.add.rectangle(CFG.GAME_W / 2, CFG.GAME_H / 2, CFG.GAME_W, CFG.GAME_H, 0x33334d)
      .setDepth(180).setAlpha(0);
    this.tweens.add({
      targets: cover, alpha: 1, duration: CFG.RESPAWN_FADE * 500, yoyo: true,
      onYoyo: () => {
        this.playerA.respawnAt(this.lastCheckpoint);
        this.playerB.respawnAt(this.lastCheckpoint);
        this.cam.snapTo(this.playerA, this.playerB);
      },
      onComplete: () => { cover.destroy(); this.respawning = false; }
    });
  }

  // ------------------------------------------------------------------ finish

  complete() {
    this.finished = true;
    AudioSys.stopTension();
    AudioSys.play('win');
    this.fx.winConfetti();
    // The run is over: gameplay stops here, not when the scene changes, so the
    // results panel is never counted as play time and never eats an ad.
    Poki.gameplayStop();
    Poki.happyTime(1);

    // synchronized victory hops on the frozen frame
    [this.sprA, this.sprB].forEach((spr, i) => {
      this.tweens.add({
        targets: spr, y: spr.y - 26, duration: 320, yoyo: true, repeat: -1,
        ease: 'Quad.easeOut', delay: i * 160
      });
    });

    const total = this.course.bolts.length;
    let stars = 1;
    const boltsOK = total > 0 && this.boltsGot >= Math.ceil(total * CFG.BOLT_STAR_RATIO);
    if (boltsOK) stars++;
    const cleanOK = this.falls === 0 || this.runTime <= this.course.targetTime;
    if (cleanOK) stars++;
    Save.recordResult(this.levelId, stars, this.boltsGot, this.runTime);

    const W = CFG.GAME_W, H = CFG.GAME_H;
    this.add.rectangle(W / 2, H / 2, W, H, 0x33334d, 0.45).setDepth(190);
    const panel = this.add.container(W / 2, H / 2).setDepth(200);
    const g = this.add.graphics();
    g.fillStyle(0x33334d, 0.3); g.fillRoundedRect(-235, -164, 470, 340, 26);
    g.fillStyle(0xffffff, 1); g.fillRoundedRect(-240, -170, 470, 340, 26);
    g.lineStyle(5, 0xf2aac6, 1); g.strokeRoundedRect(-240, -170, 470, 340, 26);
    panel.add(g);
    panel.add(this.add.text(-5, -128, 'LEVEL COMPLETE!', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '34px', fontStyle: 'bold', color: '#e0537e'
    }).setOrigin(0.5));

    for (let i = 0; i < 3; i++) {
      const star = this.add.text(-5 + (i - 1) * 78, -62, '★', {
        fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '64px',
        color: i < stars ? '#ffd35c' : '#d8dde4'
      }).setOrigin(0.5);
      panel.add(star);
      if (i < stars) {
        star.setScale(0);
        this.tweens.add({
          targets: star, scale: 1, delay: 350 + i * 250, duration: 300, ease: 'Back.easeOut',
          onStart: () => AudioSys.play('coin')
        });
      }
    }

    const m = Math.floor(this.runTime / 60), s = Math.floor(this.runTime % 60);
    panel.add(this.add.text(-5, 6,
      'Time  ' + m + ':' + (s < 10 ? '0' : '') + s + '        Bolts  ' + this.boltsGot + '/' + total, {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '24px', fontStyle: 'bold', color: '#4a6a8a'
    }).setOrigin(0.5));

    const next = this.levelId < LEVELS.length;
    if (next) {
      panel.add(Effects.button(this, -5, 76, 210, 56, 'NEXT →',
        () => Poki.startLevel(this, this.levelId + 1), { fontSize: 26, depth: 0 }));
    }
    panel.add(Effects.button(this, next ? -120 : -5, next ? 138 : 90, 150, 46, 'REPLAY',
      () => Poki.startLevel(this, this.levelId), { color: 0x53a8d6, fontSize: 20, depth: 0 }));
    panel.add(Effects.button(this, next ? 112 : -5, next ? 138 : 145, 150, 46, 'MENU',
      () => this.scene.start('Menu'), { color: 0x8899aa, fontSize: 20, depth: 0 }));

    panel.setScale(0.4).setAlpha(0);
    this.tweens.add({ targets: panel, scale: 1, alpha: 1, duration: 360, ease: 'Back.easeOut' });
  }

  showPause() {
    this.paused = true;
    AudioSys.setTension(0);
    const W = CFG.GAME_W, H = CFG.GAME_H;
    const items = [];
    items.push(this.add.rectangle(W / 2, H / 2, W, H, 0x33334d, 0.55).setDepth(190).setInteractive());
    items.push(this.add.text(W / 2, H / 2 - 110, 'PAUSED', {
      fontFamily: 'Nunito, "Trebuchet MS", sans-serif', fontSize: '44px', fontStyle: 'bold',
      color: '#ffffff', stroke: '#e0537e', strokeThickness: 8
    }).setOrigin(0.5).setDepth(191));
    const close = () => {
      items.forEach((o) => o.destroy());
      this.paused = false;
    };
    items.push(Effects.button(this, W / 2, H / 2 - 30, 240, 56, 'RESUME', close, { depth: 191 }));
    items.push(Effects.button(this, W / 2, H / 2 + 42, 240, 52, 'RETRY',
      () => this.scene.restart({ levelId: this.levelId }), { color: 0x53a8d6, fontSize: 22, depth: 191 }));
    items.push(Effects.button(this, W / 2, H / 2 + 110, 240, 52, 'MENU',
      () => this.scene.start('Menu'), { color: 0x8899aa, fontSize: 22, depth: 191 }));
    this.input.keyboard.once('keydown-ESC', close);
  }

  // ------------------------------------------------------------------ rendering

  render(dt) {
    this.drawBackground(dt);
    this.drawCourse();
    this.placeSprites();
    this.drawTether();
    if (this.debugReadout) this.updateDebug();
  }

  drawBackground(dt) {
    for (const c of this.skyClouds) {
      c.x += c.drift * dt;
      if (c.x > CFG.GAME_W + 80) c.x = -80;
    }
    const speed = (this.playerA.vzTotal + this.playerB.vzTotal) / 2;
    for (const c of this.deepClouds) {
      c.wz -= speed * dt;
      if (c.wz < 3) { c.wz = 60 + Math.random() * 10; c.wx = -30 + Math.random() * 60; }
      const pr = Projection.project(c.wx + Projection.cam.x * 0.6, -7.5, Projection.cam.z + c.wz);
      c.setPosition(pr.x, pr.y).setScale(pr.s * c.size * 0.02);
      c.setAlpha(0.85 * (1 - Projection.fog(pr.dz) * 0.8));
    }
  }

  drawCourse() {
    const g = this.courseGfx;
    g.clear();
    const course = this.course;
    const camZ = Projection.cam.z;
    const zNear = camZ + CFG.NEAR, zFar = camZ + CFG.DRAW_DIST;
    const items = [];

    for (const p of course.platforms) {
      const z0 = Math.max(p.z0, zNear), z1 = Math.min(p.z1, zFar);
      if (z1 <= z0 + 0.01) continue;
      let s0 = z0;
      for (let b = Math.ceil(z0 / 3) * 3; b < z1; b += 3) {
        items.push({ z: s0, kind: 'strip', p, s0, s1: b });
        s0 = b;
      }
      items.push({ z: s0, kind: 'strip', p, s0, s1: z1 });
      if (p.z0 > zNear) items.push({ z: p.z0 - 0.01, kind: 'face', p });
    }
    for (const b of course.blocks) {
      if (b.z0 < zFar && b.z1 > zNear) items.push({ z: Math.max(b.z0, zNear), kind: 'block', b });
    }
    for (const pad of course.pads) {
      if (Projection.inView(pad.z)) items.push({ z: pad.z, kind: 'pad', pad });
    }
    course.checkpoints.forEach((cz, i) => {
      if (i > 0 && Projection.inView(cz)) items.push({ z: cz, kind: 'arch', cz, passed: i <= this.passedCp });
    });
    if (course.finishZ < zFar && course.finishZ > zNear) {
      items.push({ z: course.finishZ, kind: 'finish', cz: course.finishZ });
    }

    items.sort((a, b) => b.z - a.z);
    for (const it of items) {
      if (it.kind === 'strip') this.drawStrip(g, it.p, it.s0, it.s1);
      else if (it.kind === 'face') this.drawFace(g, it.p);
      else if (it.kind === 'block') this.drawBlock(g, it.b);
      else if (it.kind === 'pad') this.drawPad(g, it.pad);
      else if (it.kind === 'arch') this.drawArch(g, it.cz, it.passed);
      else if (it.kind === 'finish') this.drawFinish(g, it.cz);
    }
  }

  drawStrip(g, p, s0, s1) {
    const c = this.course;
    const n = c.platformAt(p, s0, this.t);
    const f = c.platformAt(p, s1, this.t);
    const pn1 = Projection.project(n.c - n.w / 2, 0, s0);
    const pn2 = Projection.project(n.c + n.w / 2, 0, s0);
    const pf1 = Projection.project(f.c - f.w / 2, 0, s1);
    const pf2 = Projection.project(f.c + f.w / 2, 0, s1);
    const fog = Projection.fog((pn1.dz + pf1.dz) / 2);
    const conveyor = p.kind === 'conveyor';
    const even = Math.floor(s0 / 3) % 2 === 0;
    // conveyor stripes scroll with the belt direction
    const shift = conveyor ? Math.floor(this.t * p.conv * 3) % 2 === 0 : even;
    const base = conveyor ? (shift ? CFG.CONV_A : CFG.CONV_B) : (even ? CFG.FLOOR_A : CFG.FLOOR_B);
    g.fillStyle(Projection.fogColor(base, fog), 1);
    g.beginPath();
    g.moveTo(pf1.x, pf1.y); g.lineTo(pf2.x, pf2.y);
    g.lineTo(pn2.x, pn2.y); g.lineTo(pn1.x, pn1.y);
    g.closePath(); g.fillPath();
    // side edges — the depth cue that makes ledges readable
    const edge = Projection.fogColor(conveyor ? CFG.CONV_EDGE : CFG.FLOOR_EDGE, fog);
    g.lineStyle(Math.max(1.5, pn1.s * 0.06), edge, 0.9);
    g.beginPath(); g.moveTo(pf1.x, pf1.y); g.lineTo(pn1.x, pn1.y); g.strokePath();
    g.beginPath(); g.moveTo(pf2.x, pf2.y); g.lineTo(pn2.x, pn2.y); g.strokePath();
  }

  drawFace(g, p) {
    const c = this.course;
    const n = c.platformAt(p, p.z0, this.t);
    const t1 = Projection.project(n.c - n.w / 2, 0, p.z0);
    const t2 = Projection.project(n.c + n.w / 2, 0, p.z0);
    const b1 = Projection.project(n.c - n.w / 2, -1.1, p.z0);
    const b2 = Projection.project(n.c + n.w / 2, -1.1, p.z0);
    const fog = Projection.fog(t1.dz);
    g.fillStyle(Projection.fogColor(CFG.FLOOR_SIDE, fog), 1);
    g.beginPath();
    g.moveTo(t1.x, t1.y); g.lineTo(t2.x, t2.y);
    g.lineTo(b2.x, b2.y); g.lineTo(b1.x, b1.y);
    g.closePath(); g.fillPath();
  }

  drawBlock(g, b) {
    const zc = Math.max(b.z0, Projection.cam.z + CFG.NEAR);
    const fog = Projection.fog(zc - Projection.cam.z);
    // top face first (behind), then front face
    const ft1 = Projection.project(b.c - b.w / 2, b.h, b.z1);
    const ft2 = Projection.project(b.c + b.w / 2, b.h, b.z1);
    const nt1 = Projection.project(b.c - b.w / 2, b.h, zc);
    const nt2 = Projection.project(b.c + b.w / 2, b.h, zc);
    g.fillStyle(Projection.fogColor(0x9d91f5, fog), 1);
    g.beginPath();
    g.moveTo(ft1.x, ft1.y); g.lineTo(ft2.x, ft2.y);
    g.lineTo(nt2.x, nt2.y); g.lineTo(nt1.x, nt1.y);
    g.closePath(); g.fillPath();
    const nb1 = Projection.project(b.c - b.w / 2, 0, zc);
    const nb2 = Projection.project(b.c + b.w / 2, 0, zc);
    g.fillStyle(Projection.fogColor(CFG.WALL_COLOR, fog), 1);
    g.beginPath();
    g.moveTo(nt1.x, nt1.y); g.lineTo(nt2.x, nt2.y);
    g.lineTo(nb2.x, nb2.y); g.lineTo(nb1.x, nb1.y);
    g.closePath(); g.fillPath();
    g.lineStyle(2, Projection.fogColor(CFG.WALL_EDGE, fog), 1);
    g.strokeRect(Math.min(nt1.x, nt2.x), Math.min(nt1.y, nb1.y),
      Math.abs(nt2.x - nt1.x), Math.abs(nb1.y - nt1.y));
  }

  drawPad(g, pad) {
    const pr = Projection.project(pad.c, 0.02, pad.z);
    const fog = Projection.fog(pr.dz);
    const pulse = 0.75 + Math.sin(this.t * 5) * 0.25;
    g.fillStyle(Projection.fogColor(CFG.PAD_COLOR, fog), 1);
    g.fillEllipse(pr.x, pr.y, pad.r * 2 * pr.s, pad.r * 2 * pr.s * 0.42);
    g.fillStyle(0xffffff, 0.5 * pulse);
    g.fillEllipse(pr.x, pr.y, pad.r * 1.3 * pr.s, pad.r * 1.3 * pr.s * 0.42);
    pad.spr.setVisible(true).setPosition(pr.x, pr.y - 0.55 * pr.s - Math.sin(this.t * 5) * 4)
      .setScale(pr.s * 0.012).setAlpha(1 - fog);
  }

  drawArch(g, cz, passed) {
    const color = passed ? 0xffd35c : 0x59d98c;
    const fog = Projection.fog(cz - Projection.cam.z);
    const col = Projection.fogColor(color, fog);
    for (const px of [-3.6, 3.6]) {
      const top = Projection.project(px, 3, cz);
      const bot = Projection.project(px, 0, cz);
      g.lineStyle(Math.max(2, top.s * 0.22), col, 1);
      g.beginPath(); g.moveTo(bot.x, bot.y); g.lineTo(top.x, top.y); g.strokePath();
    }
    const l = Projection.project(-3.6, 3, cz);
    const r = Projection.project(3.6, 3, cz);
    g.lineStyle(Math.max(3, l.s * 0.3), col, 1);
    g.beginPath(); g.moveTo(l.x, l.y); g.lineTo(r.x, r.y); g.strokePath();
  }

  drawFinish(g, cz) {
    for (let i = 0; i < 14; i++) {
      const x0 = -3.5 + i * 0.5;
      for (let row = 0; row < 2; row++) {
        const z0 = cz + row * 0.45;
        const a = Projection.project(x0, 0.01, z0);
        const b = Projection.project(x0 + 0.5, 0.01, z0);
        const c2 = Projection.project(x0 + 0.5, 0.01, z0 + 0.45);
        const d = Projection.project(x0, 0.01, z0 + 0.45);
        g.fillStyle((i + row) % 2 === 0 ? 0x33334d : 0xffffff, 1);
        g.beginPath();
        g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c2.x, c2.y); g.lineTo(d.x, d.y);
        g.closePath(); g.fillPath();
      }
    }
  }

  placeSprites() {
    for (const b of this.course.bolts) {
      if (b.taken || !Projection.inView(b.z)) { b.spr.setVisible(false); continue; }
      const pr = Projection.project(b.x, b.y + Math.sin(this.t * 3 + b.z) * 0.12, b.z);
      b.spr.setVisible(true).setPosition(pr.x, pr.y)
        .setScale(pr.s * 0.5 / 44).setDepth(20 + Math.max(0, CFG.DRAW_DIST - pr.dz))
        .setAlpha(1 - Projection.fog(pr.dz));
      b.spr.rotation = this.t * 1.5;
    }
    for (const gear of this.course.gears) {
      if (!Projection.inView(gear.z)) { gear.spr.setVisible(false); continue; }
      const pr = Projection.project(gear.c, gear.r * 0.62, gear.z);
      gear.spr.setVisible(true).setPosition(pr.x, pr.y)
        .setScale(pr.s * gear.r * 2 / 160).setDepth(20 + Math.max(0, CFG.DRAW_DIST - pr.dz))
        .setAlpha(1 - Projection.fog(pr.dz));
      gear.spr.rotation = gear.angle;
    }
    for (const pad of this.course.pads) {
      if (!Projection.inView(pad.z)) pad.spr.setVisible(false);
    }
    this.placePlayer(this.playerA, this.sprA, this.shadowA);
    this.placePlayer(this.playerB, this.sprB, this.shadowB);

    if (this.mode === 'solo') {
      const p = this.activeId === 'A' ? this.playerA : this.playerB;
      const pr = Projection.project(p.x, p.y + 1.5, p.z);
      this.youTag.setPosition(pr.x, pr.y - 8 + Math.sin(this.t * 6) * 3);
      this.youTag.setDepth(85);
    }
  }

  placePlayer(p, spr, shadow) {
    const pr = Projection.project(p.x, p.y + 0.58, p.z);
    const base = 1.18 * pr.s / spr.height;
    spr.setPosition(pr.x, pr.y);
    spr.setScale(base * (1 + p.squash * 0.7), base * (1 - p.squash));
    spr.rotation = Phaser.Math.Clamp(p.vx * 0.035, -0.3, 0.3);
    spr.setDepth(p.y < -0.6 ? 8 : 20 + Math.max(0, CFG.DRAW_DIST - pr.dz));
    spr.setAlpha(p.stun > 0 ? (Math.floor(this.t * 18) % 2 === 0 ? 0.45 : 1) : 1);
    spr.setVisible(true);

    const ground = this.course.groundAt(p.x, p.z, this.t);
    if (ground && p.y > -0.3) {
      const sh = Projection.project(p.x, 0, p.z);
      shadow.setVisible(true).setPosition(sh.x, sh.y)
        .setScale(sh.s * 0.014 * Math.max(0.4, 1 - p.y * 0.18))
        .setAlpha(0.5 * Math.max(0.25, 1 - p.y * 0.25))
        .setDepth(spr.depth - 1);
    } else {
      shadow.setVisible(false);
    }
  }

  drawTether() {
    const g = this.tetherGfx;
    g.clear();
    const A = this.playerA, B = this.playerB;
    const p1 = Projection.project(A.x, A.y + 0.72, A.z);
    const p2 = Projection.project(B.x, B.y + 0.72, B.z);
    const st = this.tether.state;
    const colors = [CFG.TETHER_SLACK, CFG.TETHER_TENSE, CFG.TETHER_HIGH, CFG.TETHER_CRIT];
    const t01 = this.tether.tension01;
    const avgS = (p1.s + p2.s) / 2;
    const sagPx = 1.15 * Math.pow(1 - t01, 1.5) * avgS;
    let mx = (p1.x + p2.x) / 2;
    let my = (p1.y + p2.y) / 2 + sagPx;
    if (st === 3) {   // critical: the cord trembles
      mx += (Math.random() * 2 - 1) * 2.5;
      my += (Math.random() * 2 - 1) * 2.5;
    }
    const lw = Math.max(2, (5.5 - t01 * 2.8) * avgS / 80);
    if (st >= 2) {   // glow pass
      g.lineStyle(lw * 2.6, colors[st], 0.25);
      this.strokeCord(g, p1, p2, mx, my);
    }
    g.lineStyle(lw, colors[st], 1);
    this.strokeCord(g, p1, p2, mx, my);

    // slingshot speed streaks
    for (const p of [A, B]) {
      if (p.vzExtra > 3.2 && p.state === 'run') {
        const pr = Projection.project(p.x, p.y + 0.6, p.z);
        g.lineStyle(2, 0xffffff, 0.5);
        for (let i = -1; i <= 1; i++) {
          g.beginPath();
          g.moveTo(pr.x + i * 14, pr.y + 10 + Math.abs(i) * 6);
          g.lineTo(pr.x + i * 20, pr.y + 34 + Math.abs(i) * 6);
          g.strokePath();
        }
      }
    }
  }

  strokeCord(g, p1, p2, mx, my) {
    g.beginPath();
    g.moveTo(p1.x, p1.y);
    for (let i = 1; i <= 18; i++) {
      const t = i / 18, o = 1 - t;
      g.lineTo(o * o * p1.x + 2 * o * t * mx + t * t * p2.x,
               o * o * p1.y + 2 * o * t * my + t * t * p2.y);
    }
    g.strokePath();
  }

  // ------------------------------------------------------------------ debug

  initDebug() {
    const panel = document.getElementById('debug-panel');
    if (!panel) return;
    panel.style.display = 'block';
    panel.innerHTML = '<b>tether tuning</b>';
    const T = CFG.tether;
    const rows = [
      ['slackLength', 1, 8, 0.5], ['warningLength', 3, 12, 0.5], ['maxLength', 6, 16, 0.5],
      ['springStrength', 0, 30, 1], ['damping', 0, 10, 0.5], ['maxTetherForce', 10, 120, 5]
    ];
    for (const [key, min, max, step] of rows) {
      const label = document.createElement('label');
      label.textContent = key + ' ';
      const input = document.createElement('input');
      input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = T[key];
      const val = document.createElement('span');
      val.textContent = T[key];
      input.oninput = () => { T[key] = parseFloat(input.value); val.textContent = input.value; };
      label.appendChild(input); label.appendChild(val);
      panel.appendChild(label);
    }
    this.debugReadout = document.createElement('div');
    panel.appendChild(this.debugReadout);
  }

  updateDebug() {
    this.debugReadout.textContent =
      'dist ' + this.tether.dist.toFixed(2) +
      '  stretch ' + this.tether.stretch.toFixed(2) +
      '  state ' + this.tether.state +
      '  fps ' + Math.round(this.game.loop.actualFps);
  }
}
