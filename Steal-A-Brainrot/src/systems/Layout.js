// Responsive layout. One design width per orientation, height follows the
// window, Phaser scales with FIT -- so the canvas always matches the window's
// aspect and every widget re-anchors itself off LAYOUT in relayout().
//
// LAYOUT is mutated in place: everything holds a reference to the same object
// and reads it live, so configureLayout() followed by relayout() calls is the
// entire resize story.
//
// The lawn keeps horizontal lanes in BOTH orientations (enemies always march
// right-to-left); portrait just gets narrower cells and taller lanes.
const LAYOUT = {};

function configureLayout(viewW, viewH) {
  const aspect = Math.min(3.2, Math.max(0.42, (viewW || 720) / Math.max(1, viewH || 1280)));
  const landscape = aspect >= 1.15;
  const width = landscape ? 1440 : 720;
  const height = Math.round(Math.min(
    landscape ? 1200 : 1800,
    Math.max(landscape ? 620 : 960, width / aspect)
  ));

  LAYOUT.width = width;
  LAYOUT.height = height;
  LAYOUT.landscape = landscape;

  // ---- HUD band across the top ----
  const hudH = 60;
  LAYOUT.hud = { x: 0, y: 0, w: width, h: hudH, pad: 12 };

  // ---- card bar (seed packets + shovel) right under the HUD ----
  const slots = CFG.TEAM.size + 1;          // +1 for the shovel
  const cardH = landscape ? 96 : 92;
  const cardW = Math.min(landscape ? 118 : 96, (width - 20 - slots * 6) / slots);
  const barW = slots * (cardW + 6);
  LAYOUT.cards = {
    x: Math.round((width - barW) / 2), y: hudH + 4,
    w: barW, h: cardH + 10, cardW, cardH, gap: 6,
  };
  LAYOUT.cards.slotX = (i) => LAYOUT.cards.x + i * (cardW + 6) + cardW / 2;
  LAYOUT.cards.slotY = LAYOUT.cards.y + 5 + cardH / 2;

  // ---- the lawn ----
  const pad = 6;
  const top = LAYOUT.cards.y + LAYOUT.cards.h + 6;
  const fieldW = width - pad * 2;
  const mowerW = Math.round(landscape ? 54 : 46);     // moped strip left of col 0
  const rightGap = 8;                                  // sliver before the spawn edge
  const colW = (fieldW - mowerW - rightGap) / CFG.GRID.cols;
  const avail = height - top - pad;
  const laneH = Math.min(avail / CFG.GRID.lanes, colW * 2.35);
  // tall phones leave space over: bias the lawn slightly up, the backdrop
  // (Lawn._drawBoard) fills the rest so nothing reads as dead canvas
  const spare = Math.max(0, avail - laneH * CFG.GRID.lanes);
  const f = {
    x: pad, y: top + Math.round(spare * 0.42), w: fieldW, h: laneH * CFG.GRID.lanes,
    laneH, colW, mowerW,
    gridX: pad + mowerW,
    bgTop: top,
  };
  LAYOUT.field = f;
  f.right = f.x + f.w;
  f.spawnX = f.right + 40;                 // just off the right edge
  f.laneY = (lane) => f.y + laneH * (lane + 1) - laneH * 0.14;   // feet line
  f.colX = (col) => f.gridX + colW * (col + 0.5);
  f.laneAt = (y) => Math.floor((y - f.y) / laneH);
  f.colAt = (x) => Math.floor((x - f.gridX) / colW);

  // How big things stand on the lawn.
  LAYOUT.unitH = Math.round(Math.min(laneH * 0.8, colW * 1.15, 128));
  LAYOUT.enemyH = Math.round(LAYOUT.unitH * 0.98);

  // Enemy speeds are authored against a ~620px walk; longer lawns walk faster
  // so crossing time (the real difficulty) stays put across orientations.
  LAYOUT.combatScale = (f.spawnX - f.gridX) / 620;
}

// A default so LAYOUT is never empty (the check harness boots without a window).
configureLayout(720, 1280);

window.LAYOUT = LAYOUT;
window.configureLayout = configureLayout;
