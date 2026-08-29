// Responsive layout. One design width per orientation, height follows the
// window, Phaser scales with FIT -- so the canvas always matches the window's
// aspect and every widget re-anchors itself off LAYOUT in relayout().
//
// LAYOUT is mutated in place: everything holds a reference to the same object
// and reads it live, so configureLayout() followed by relayout() calls is the
// entire resize story.
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
  const hudH = 76;
  LAYOUT.hud = { x: 0, y: 0, w: width, h: hudH, pad: 12 };

  if (landscape) {
    // Battlefield fills the left ~62%; bench + machine stack in a right column.
    const pad = 10;
    const fieldW = Math.round((width - pad * 3) * 0.62);
    const field = { x: pad, y: hudH + 8, w: fieldW, h: height - hudH - 8 - pad };
    LAYOUT.field = field;

    const colX = field.x + field.w + pad;
    const colW = width - colX - pad;

    // bench: 4 cols x 2 rows at the top of the column
    const bCell = Math.min(colW / 4, 128);
    LAYOUT.bench = {
      x: colX, y: field.y, w: colW, rows: 2, cols: 4,
      cell: bCell, h: bCell * 2 + 16,
    };

    const machTop = LAYOUT.bench.y + LAYOUT.bench.h + 14;
    const machH = Math.min(240, height - machTop - 120);
    LAYOUT.machine = { x: colX, y: machTop, w: colW - 96, h: machH };
    LAYOUT.trash = { x: width - pad - 42, y: machTop + machH - 42, r: 40 };
  } else {
    // Portrait: battlefield top ~57% of the content, bench + machine below.
    const pad = 8;
    const contentTop = hudH + 6;
    const fieldH = Math.round((height - contentTop - pad) * 0.57);
    const field = { x: pad, y: contentTop, w: width - pad * 2, h: fieldH };
    LAYOUT.field = field;

    const benchTop = field.y + field.h + 10;
    const bCell = Math.min((width - pad * 2) / 4, 150);
    LAYOUT.bench = {
      x: pad, y: benchTop, w: width - pad * 2, rows: 2, cols: 4,
      cell: bCell, h: bCell * 2 + 12,
    };

    const machTop = LAYOUT.bench.y + LAYOUT.bench.h + 10;
    const machH = Math.max(120, height - machTop - pad);
    LAYOUT.machine = { x: pad, y: machTop, w: width - pad * 2 - 104, h: machH };
    LAYOUT.trash = { x: width - pad - 46, y: machTop + machH / 2, r: 42 };
  }

  // ---- battlefield internals ----
  // 3 lanes (rows); the 3x3 unit grid sits on the left ~42% of the field,
  // enemies spawn off the right edge and march to the base line on the left.
  const f = LAYOUT.field;
  f.laneH = f.h / 3;
  f.gridLeft = f.x + f.w * 0.05;
  f.gridW = f.w * 0.42;
  f.colW = f.gridW / 3;
  f.baseX = f.x + 14;                    // enemies crossing this cost a life
  f.spawnX = f.x + f.w + 46;             // just off the right edge
  f.right = f.x + f.w;
  f.laneY = (lane) => f.y + f.laneH * (lane + 0.55);

  // How big a unit stands, derived from the tighter of cell width / lane height.
  LAYOUT.unitH = Math.round(Math.min(f.laneH * 0.62, f.colW * 0.92, 118));
  LAYOUT.benchUnitH = Math.round(Math.min(LAYOUT.bench.cell * 0.66, 96));
  LAYOUT.enemyH = Math.round(LAYOUT.unitH * 0.82);

  // Enemy speeds are authored against a ~620px lane; longer lanes walk faster
  // so crossing time (the real difficulty) stays put across orientations.
  LAYOUT.combatScale = (f.right - f.baseX) / 620;
}

// Position of any board slot: 0..8 battlefield (row-major, row = lane),
// 9..16 bench.
LAYOUT.slotPos = function (slot) {
  const f = LAYOUT.field;
  if (slot < 9) {
    const row = Math.floor(slot / 3), col = slot % 3;
    return { x: f.gridLeft + f.colW * (col + 0.5), y: f.laneY(row) };
  }
  const b = LAYOUT.bench;
  const i = slot - 9;
  const row = Math.floor(i / b.cols), col = i % b.cols;
  const x0 = b.x + (b.w - b.cell * b.cols) / 2;
  return { x: x0 + b.cell * (col + 0.5), y: b.y + b.cell * (row + 0.5) };
};

// A default so LAYOUT is never empty (the check harness boots without a window).
configureLayout(720, 1280);

window.LAYOUT = LAYOUT;
window.configureLayout = configureLayout;
