// Two-stage boot. Stage one draws every texture procedurally so the game is
// always playable with zero assets. Stage two looks for rendered sprites in
// assets/ and swaps them in over the top, one key at a time — anything that is
// missing simply keeps its procedural placeholder, so a half-finished art pass
// still runs.
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    // A missing manifest is the normal no-art case, not an error.
    this.load.once('loaderror', () => { this._noManifest = true; });
    this.load.json('artManifest', CFG.ART_MANIFEST);
  }

  create() {
    TextureFactory.generateAll(this);
    AudioSys.muted = SaveSys.data.muted;

    const man = this._noManifest ? null : this.cache.json.get('artManifest');
    const jobs = this._jobsFrom(man);
    if (jobs.length === 0) { this.scene.start('Menu'); return; }

    // Free the placeholder keys so the images can claim them, but remember
    // them: if a file 404s we put the placeholder straight back.
    this._failed = [];
    this.load.on('loaderror', (file) => this._failed.push(file.key));
    jobs.forEach((j) => {
      this.textures.remove(j.key);
      this.load.image(j.key, j.url);
    });
    this.load.once('complete', () => {
      this._failed.forEach((key) => this._regenerate(key));
      this.scene.start('Menu');
    });
    this.load.start();
  }

  // manifest shape: { "base": "assets/", "sprites": { "<textureKey>": "<file>" } }
  _jobsFrom(man) {
    if (!man || !man.sprites) return [];
    const base = man.base || '';
    return Object.keys(man.sprites).map((key) => ({ key, url: base + man.sprites[key] }));
  }

  // redraw a single placeholder after its replacement failed to load
  _regenerate(key) {
    if (this.textures.exists(key)) return;
    const def = CREATURES.find((c) => 'cr_' + c.id === key);
    if (def) { TextureFactory.creature(this, def); return; }
    if (key === 'player') { TextureFactory.character(this, 'player', 0x26c6da, 0x00838f); return; }
    const bot = CFG.BOTS.find((b) => 'tex_' + b.id === key);
    if (bot) TextureFactory.character(this, key, bot.color, 0x263238);
  }
}
window.BootScene = BootScene;
