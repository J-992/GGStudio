// The whole game lives in one compact 1280x720 screen. This scene builds the
// world, wires the managers together, and runs the update loop.
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    this.upgrades = {};                       // upgrade levels for this run
    this.physics.world.setBounds(0, 0, CFG.W, CFG.H);

    this._drawGround();

    this.fx = new Effects(this);
    this.creatures = new CreatureManager(this);
    this.bases = new BaseManager(this);
    this.economy = new EconomyManager(this);
    this.conveyor = new ConveyorManager(this);
    this.steal = new StealSystem(this);
    this.inputMgr = new InputManager(this);
    this.player = new PlayerController(this);
    this.bots = CFG.BOTS.map((b) => new BotController(this, b));
    this.eventMgr = new EventManager(this);
    this.tutorial = new TutorialSystem(this);
    this.hud = new HUD(this);

    // upgrade station prop
    this.add.image(CFG.UPGRADE_STATION.x, CFG.UPGRADE_STATION.y, 'station')
      .setDepth(CFG.UPGRADE_STATION.y - 40);
    this.add.text(CFG.UPGRADE_STATION.x, CFG.UPGRADE_STATION.y - 62, 'UPGRADES', {
      fontFamily: 'Arial Black, Arial', fontSize: '17px', color: '#80cbc4',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(860);
    // the standing invitation; HUD adds a brighter one when something in there
    // is actually affordable
    this.add.text(CFG.UPGRADE_STATION.x, CFG.UPGRADE_STATION.y - 44, 'walk up to open', {
      fontFamily: 'Arial', fontSize: '12px', color: '#cfd8dc',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(860);

    // physics: bases are open, so the only solid things are the perimeter
    // fences of locked bases -- and only the player is stopped by them
    this.physics.add.collider(this.player.sprite, this.bases.barriers);

    this._restoreRun();
    this._seedBots();

    // visible income: a coin flies from a random creature to the counter
    this.time.addEvent({
      delay: CFG.COIN_FLY_EVERY, loop: true, callback: () => this._coinPop(),
    });
    // autosave
    this.time.addEvent({ delay: CFG.SAVE_EVERY_MS, loop: true, callback: () => this.snapshot() });

    this._sessionT = 0;
    AudioSys.setMusic('normal');
    Poki.gameplayStart();
    this.events.on('shutdown', () => {
      Poki.gameplayStop();
      AudioSys.setMusic(null);
      this.snapshot();
    });
  }

  _drawGround() {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(0x33691e, 1);
    g.fillRect(0, 0, CFG.W, CFG.H);
    // mottled grass patches
    const rnd = new Phaser.Math.RandomDataGenerator(['brainrot']);
    g.fillStyle(0x558b2f, 0.5);
    for (let i = 0; i < 60; i++) {
      g.fillEllipse(rnd.between(0, CFG.W), rnd.between(0, CFG.H), rnd.between(30, 90), rnd.between(16, 40));
    }
    // worn path around the conveyor
    g.fillStyle(0x795548, 0.25);
    g.fillRect(0, CFG.CONVEYOR_Y - 60, CFG.W, 120);
  }

  botById(id) { return this.bots.find((b) => b.id === id); }

  _restoreRun() {
    const run = SaveSys.data.run;
    if (!run) return;
    this.economy.cash.player = run.cash || CFG.START_CASH;
    Object.assign(this.upgrades, run.upgrades || {});
    this.bases.refreshPedestals('player');
    // Entries are { i: id, n: income }. Saves written before merges carried
    // their own income hold bare id strings, which restore at the catalogue
    // rate -- the only thing lost is a merge bonus from an older build.
    (run.creatures || []).forEach((entry) => {
      const id = typeof entry === 'string' ? entry : entry.i;
      const def = CREATURES_BY_ID[id];
      if (def) this.creatures.placeDirect(def, 'player', typeof entry === 'string' ? 0 : entry.n);
    });
    this.creatures.settleMerges('player');
  }

  // every bot opens with one cheap creature so the map is never empty (and the
  // tutorial always has something to steal)
  _seedBots() {
    const commons = CREATURES.filter((c) => c.rarity === 'common');
    this.bots.forEach((b, i) => {
      this.creatures.placeDirect(commons[i % commons.length], b.id);
    });
  }

  _coinPop() {
    const own = this.creatures.creaturesOf('player').filter((c) => c.state === 'pedestal');
    if (own.length === 0) return;
    const cr = own[Math.floor(Math.random() * own.length)];
    const t = this.hud.coinTarget();
    this.fx.floatText(cr.x, cr.y - 60,
      '+' + HUD.money(cr.income * this.economy.mult('player')), '#ffe082', 14);
    this.fx.coinFly(cr.x, cr.y - 40, t.x, t.y, () => AudioSys.sfx('coin'));
  }

  snapshot() {
    SaveSys.addStat('playMs', this._sessionT);
    this._sessionT = 0;
    const owned = this.creatures.creaturesOf('player')
      .filter((c) => c.state !== 'carried' || true)   // carried ones still belong to the player
      .map((c) => ({ i: c.def.id, n: Math.floor(c.income) }));
    SaveSys.snapshotRun(this.economy.cash.player, owned, this.upgrades);
  }

  update(time, delta) {
    const dtSec = Math.min(delta, 100) / 1000;
    this._sessionT += delta;

    this.inputMgr.update();
    if (this.inputMgr.lockJust) this.hud.tryLock();
    if (this.inputMgr.collectionJust) this.hud.toggleCollection();

    this.player.update(time, dtSec);
    for (const b of this.bots) b.update(time, dtSec);
    this.conveyor.update(time, dtSec);
    this.creatures.update(time, dtSec);
    this.steal.update(time);
    this.bases.update(time);
    this.economy.update(dtSec);
    this.eventMgr.update(time);
    this.tutorial.update(time, dtSec);
    this.hud.update(time);

    // chase music whenever the player is robbing or being robbed
    AudioSys.setMusic(this.steal.playerInChase() ? 'chase' : 'normal');
  }
}
window.GameScene = GameScene;
