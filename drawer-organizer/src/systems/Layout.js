// Orientation manager. The game runs on one of two base canvases:
// landscape 960x640 (the original design) or portrait 640x960.
// On device rotation we swap the base size and restart the active scene,
// which re-lays itself out from this.scale + Layout.portrait.
// LevelScene progress survives the restart via captureState()/restore.
const Layout = {
  portrait: false,

  LANDSCAPE: { w: 960, h: 640 },
  PORTRAIT: { w: 640, h: 960 },

  detect() {
    return window.innerHeight > window.innerWidth;
  },

  size() {
    return this.portrait ? this.PORTRAIT : this.LANDSCAPE;
  },

  install(game) {
    let timer = null;
    const apply = () => {
      const p = this.detect();
      if (p === this.portrait) return; // same orientation (e.g. mobile URL bar resize)
      this.portrait = p;
      const s = this.size();
      game.scale.setGameSize(s.w, s.h);
      game.scale.refresh();

      const active = game.scene.getScenes(true);
      const top = active[active.length - 1];
      if (!top || top.scene.key === 'Boot') return; // Boot's successor reads the new size
      if (top.scene.key === 'Level' && top.captureState) {
        top.scene.restart({ levelId: top.levelId, restore: top.captureState() });
      } else {
        top.scene.restart();
      }
    };
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(apply, 200);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
  }
};
