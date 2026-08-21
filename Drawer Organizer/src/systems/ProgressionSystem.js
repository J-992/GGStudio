// Level/reward progression on top of SaveSystem.
const Progression = {
  get levelCount() { return LEVELS.length; },

  // Next level to play (1-based). After finishing everything, replay the last one.
  get currentLevel() { return Math.min(SaveSystem.completed + 1, LEVELS.length); },

  get allDone() { return SaveSystem.completed >= LEVELS.length; },

  levelData(id) { return LEVELS.find(l => l.id === id); },

  isUnlocked(id) { return id <= SaveSystem.completed + 1; },

  complete(id) { SaveSystem.markCompleted(id); },

  // Reward options for a level, minus decorations already owned.
  rewardOptions(id) {
    const lvl = this.levelData(id);
    if (!lvl || !lvl.reward) return [];
    const owned = SaveSystem.decorations;
    const fresh = lvl.reward.options.filter(k => !owned.includes(k));
    if (fresh.length) return fresh;
    // Everything this level offers is owned — offer any decorations still missing.
    const missing = Object.keys(DECORATIONS).filter(k => !owned.includes(k)).slice(0, 3);
    return missing.length ? missing : lvl.reward.options;
  },

  chooseReward(key) { SaveSystem.addDecoration(key); }
};
