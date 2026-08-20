// Tiny localStorage wrapper. All persistent state lives in one JSON blob.
const SaveSystem = {
  KEY: 'drawer_organizer_save_v1',
  _cache: null,

  load() {
    if (this._cache) return this._cache;
    let data = null;
    try { data = JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { /* corrupted/blocked */ }
    this._cache = Object.assign({ completed: 0, decorations: [], sound: true }, data || {});
    return this._cache;
  },

  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this._cache)); } catch (e) { /* storage blocked */ }
  },

  get completed() { return this.load().completed; },
  markCompleted(levelId) {
    const s = this.load();
    if (levelId > s.completed) s.completed = levelId;
    this.save();
  },

  addDecoration(key) {
    const s = this.load();
    if (!s.decorations.includes(key)) s.decorations.push(key);
    this.save();
  },
  get decorations() { return this.load().decorations; },

  get soundOn() { return this.load().sound; },
  set soundOn(v) { this.load().sound = !!v; this.save(); },

  reset() { this._cache = { completed: 0, decorations: [], sound: true }; this.save(); }
};
