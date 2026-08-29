// Draws the player and the five rivals as 352px sprites.
//
// They are one family drawn by one function so they read as a set — same build,
// same head, same eyes. What separates them is palette, headwear, face and arm
// pose, because colour and silhouette are all you actually resolve at the 72px
// they render at on a busy board.
//
// Style targets the creature artwork: heavy ink outline, flat fill plus one
// shade, no gradients, big cartoon eyes.
//
// Entry point: drawCast() -> [{ key, label, url, canvas }].

const S = 352;                 // sprite size
const INK = '#241c18';         // outline colour, matches the artwork's linework
const LW = 12;                 // outline weight at 352px

// Proportions. A big head reads at small sizes, but the legs still have to be
// visible or the character looks like a bust on a shelf.
const CX = 176;
const HEAD_Y = 102, HEAD_R = 63;
const SHOULDER = 176, HIP = 268, KNEE = 312, FOOT = 322;

// ---------- drawing helpers ----------

// Stroke-then-fill puts half the line inside the shape, which gives the soft
// brush edge the artwork has instead of a hairline.
function ink(c, path, fill, lw) {
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.lineWidth = lw === undefined ? LW : lw;
  c.strokeStyle = INK;
  c.stroke(path);
  if (fill) { c.fillStyle = fill; c.fill(path); }
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// Rounded and slightly irregular — never a perfect ellipse.
function blob(cx, cy, rx, ry, wobble = 0.05, seed = 1) {
  const p = new Path2D();
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const w = 1 + Math.sin(a * 3 + seed) * wobble;
    const x = cx + Math.cos(a) * rx * w;
    const y = cy + Math.sin(a) * ry * w;
    if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

function roundRect(x, y, w, h, r) {
  const p = new Path2D();
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r);
  p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r);
  p.arcTo(x, y, x + w, y, r);
  p.closePath();
  return p;
}

// Limbs are tubes: a thick stroked polyline, inked underneath.
function limb(c, pts, color, width) {
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = INK; c.lineWidth = width + LW; c.stroke(p);
  c.strokeStyle = color; c.lineWidth = width; c.stroke(p);
}

function hand(c, x, y, skin, r = 13) {
  ink(c, blob(x, y, r, r, 0.06, x), skin, LW * 0.7);
}

function eye(c, x, y, r, px = 0, py = 0, lid = 0) {
  const white = blob(x, y, r, r * 1.06, 0.03, x);
  ink(c, white, '#ffffff', LW * 0.5);
  const pp = new Path2D();
  pp.ellipse(x + px, y + py, r * 0.46, r * 0.52, 0, 0, 7);
  c.fillStyle = '#1a1410'; c.fill(pp);
  const hl = new Path2D();
  hl.ellipse(x + px - r * 0.2, y + py - r * 0.24, r * 0.17, r * 0.19, 0, 0, 7);
  c.fillStyle = '#ffffff'; c.fill(hl);
  if (lid > 0) {                       // heavy lid = sly / bored
    c.save(); c.clip(white);
    const l = new Path2D();
    l.rect(x - r * 1.4, y - r * 1.5, r * 2.8, r * (0.6 + lid));
    c.fillStyle = '#e8d3bd'; c.fill(l);
    c.restore();
    const line = new Path2D();
    line.moveTo(x - r * 0.95, y - r * 0.9 + r * lid);
    line.lineTo(x + r * 0.95, y - r * 0.9 + r * lid);
    c.strokeStyle = INK; c.lineWidth = LW * 0.45; c.lineCap = 'round'; c.stroke(line);
  }
}

function brow(c, x, y, w, tilt) {
  const p = new Path2D();
  p.moveTo(x - w / 2, y + tilt);
  p.quadraticCurveTo(x, y - 5 + tilt * 0.3, x + w / 2, y - tilt);
  c.strokeStyle = INK; c.lineWidth = LW * 0.8; c.lineCap = 'round'; c.stroke(p);
}

// ---------- the shared character ----------
function drawKid(c, cfg) {
  c.clearRect(0, 0, S, S);
  const skin = cfg.skin || '#f2c79a';
  const cloth = cfg.cloth;
  const dark = cfg.clothDark || shade(cloth, 0.74);

  // ---- back arm ----
  if (cfg.arms === 'flung') {
    limb(c, [[CX - 46, SHOULDER + 12], [CX - 100, SHOULDER - 14], [CX - 118, SHOULDER - 56]], cloth, 24);
    hand(c, CX - 118, SHOULDER - 62, skin);
  }
  if (cfg.arms === 'sneak' || cfg.arms === 'hold') {
    limb(c, [[CX - 46, SHOULDER + 12], [CX - 84, SHOULDER + 52], [CX - 68, SHOULDER + 86]], cloth, 24);
    hand(c, CX - 66, SHOULDER + 92, skin);
  }

  // ---- legs + shoes ----
  [-26, 26].forEach((dx) => {
    limb(c, [[CX + dx * 0.72, HIP - 6], [CX + dx, KNEE]], cfg.trousers || dark, 27);
    ink(c, blob(CX + dx * 1.12, FOOT, 27, 15, 0.05, dx), cfg.shoe || '#3d3129', LW * 0.8);
    const sole = new Path2D();
    sole.ellipse(CX + dx * 1.12, FOOT + 7, 26, 7, 0, 0, 7);
    c.fillStyle = '#efe6da'; c.fill(sole);
  });

  // ---- torso ----
  const body = new Path2D();
  body.moveTo(CX - 56, SHOULDER + 6);
  body.quadraticCurveTo(CX - 64, HIP + 4, CX - 40, HIP + 8);
  body.lineTo(CX + 40, HIP + 8);
  body.quadraticCurveTo(CX + 64, HIP + 4, CX + 56, SHOULDER + 6);
  body.quadraticCurveTo(CX, SHOULDER - 24, CX - 56, SHOULDER + 6);
  body.closePath();
  ink(c, body, cloth);

  // one flat shadow shape, like the creature art — no gradient
  c.save(); c.clip(body);
  const sh = new Path2D();
  sh.rect(CX + 14, SHOULDER - 40, 120, HIP - SHOULDER + 80);
  c.fillStyle = shade(cloth, 0.85); c.fill(sh);
  c.restore();

  // ---- front arms ----
  if (cfg.arms === 'sneak') {
    limb(c, [[CX + 46, SHOULDER + 12], [CX + 88, SHOULDER + 34], [CX + 110, SHOULDER + 6]], cloth, 24);
    hand(c, CX + 114, SHOULDER, skin);
  }
  if (cfg.arms === 'pockets') {
    [-1, 1].forEach((s) => {
      limb(c, [[CX + 48 * s, SHOULDER + 12], [CX + 60 * s, HIP - 26], [CX + 34 * s, HIP - 8]], cloth, 24);
    });
  }
  if (cfg.arms === 'folded') {
    limb(c, [[CX - 52, SHOULDER + 26], [CX + 42, SHOULDER + 50]], cloth, 25);
    limb(c, [[CX + 52, SHOULDER + 38], [CX - 36, SHOULDER + 62]], cloth, 25);
    hand(c, CX - 40, SHOULDER + 64, skin, 12);
  }
  if (cfg.arms === 'flung') {
    limb(c, [[CX + 46, SHOULDER + 12], [CX + 100, SHOULDER - 14], [CX + 120, SHOULDER - 58]], cloth, 24);
    hand(c, CX + 120, SHOULDER - 64, skin);
  }
  if (cfg.arms === 'hold') {
    limb(c, [[CX + 46, SHOULDER + 12], [CX + 96, SHOULDER + 6], [CX + 112, SHOULDER - 30]], cloth, 24);
  }

  // Props go on top of the arms — a chain tucked behind folded arms is a chain
  // nobody can see at 72px.
  if (cfg.prop) cfg.prop(c, skin);

  // ---- head ----
  const head = blob(CX, HEAD_Y, HEAD_R, HEAD_R * 0.98, 0.03, 2);
  // ears first, so the skull outline crosses them
  [-1, 1].forEach((s) => ink(c, blob(CX + s * (HEAD_R - 4), HEAD_Y + 14, 12, 15, 0.05, s), skin, LW * 0.65));
  ink(c, head, skin);
  c.save(); c.clip(head);
  const hsh = new Path2D();
  hsh.rect(CX + 22, HEAD_Y - 90, 120, 190);
  c.fillStyle = shade(skin, 0.93); c.fill(hsh);
  c.restore();

  cfg.drawHead && cfg.drawHead(c, skin);
  cfg.drawFace && cfg.drawFace(c);
}

// ---------- faces ----------
const EY = HEAD_Y + 6;         // eye line

const faces = {
  grin(c) {
    eye(c, CX - 24, EY, 17, 2, 1);
    eye(c, CX + 24, EY, 17, 2, 1);
    brow(c, CX - 24, EY - 24, 30, -4); brow(c, CX + 24, EY - 24, 30, 4);
    const m = new Path2D();
    m.moveTo(CX - 26, EY + 30); m.quadraticCurveTo(CX, EY + 56, CX + 26, EY + 30);
    m.closePath();
    ink(c, m, '#63302c', LW * 0.55);
    const t = new Path2D();
    t.moveTo(CX - 21, EY + 31); t.lineTo(CX + 21, EY + 31);
    t.lineTo(CX + 17, EY + 39); t.lineTo(CX - 17, EY + 39); t.closePath();
    c.fillStyle = '#fffaf2'; c.fill(t);
  },
  sly(c) {
    eye(c, CX - 24, EY + 2, 17, 5, 0, 0.85);
    eye(c, CX + 24, EY + 2, 17, 5, 0, 0.85);
    brow(c, CX - 25, EY - 22, 30, 8); brow(c, CX + 25, EY - 24, 30, 2);
    const m = new Path2D();
    m.moveTo(CX - 22, EY + 38); m.quadraticCurveTo(CX + 4, EY + 54, CX + 26, EY + 30);
    c.strokeStyle = INK; c.lineWidth = LW * 0.65; c.lineCap = 'round'; c.stroke(m);
  },
  smug(c) {
    const g = roundRect(CX - 48, EY - 13, 96, 32, 13);
    ink(c, g, '#20242c', LW * 0.65);
    const gl = new Path2D();
    gl.moveTo(CX - 40, EY - 6); gl.lineTo(CX - 20, EY - 6);
    gl.lineTo(CX - 30, EY + 12); gl.lineTo(CX - 45, EY + 12); gl.closePath();
    c.fillStyle = 'rgba(255,255,255,0.24)'; c.fill(gl);
    const bar = new Path2D(); bar.rect(CX - 7, EY - 1, 14, 6);
    c.fillStyle = '#20242c'; c.fill(bar);
    const m = new Path2D();
    m.moveTo(CX - 20, EY + 40); m.quadraticCurveTo(CX + 4, EY + 52, CX + 24, EY + 34);
    c.strokeStyle = INK; c.lineWidth = LW * 0.65; c.lineCap = 'round'; c.stroke(m);
  },
  scowl(c) {
    eye(c, CX - 24, EY + 3, 17, 0, 2);
    eye(c, CX + 24, EY + 3, 17, 0, 2);
    brow(c, CX - 26, EY - 20, 34, 14); brow(c, CX + 26, EY - 20, 34, -14);
    const m = new Path2D();
    m.moveTo(CX - 22, EY + 44); m.quadraticCurveTo(CX, EY + 30, CX + 22, EY + 44);
    c.strokeStyle = INK; c.lineWidth = LW * 0.7; c.lineCap = 'round'; c.stroke(m);
  },
  shout(c) {
    eye(c, CX - 25, EY - 2, 18, 0, -3);
    eye(c, CX + 25, EY - 2, 18, 0, -3);
    brow(c, CX - 26, EY - 28, 32, 10); brow(c, CX + 26, EY - 28, 32, -10);
    const m = blob(CX, EY + 40, 24, 20, 0.05, 4);
    ink(c, m, '#63302c', LW * 0.6);
    const t = new Path2D();
    t.moveTo(CX - 19, EY + 24); t.lineTo(CX + 19, EY + 24);
    t.lineTo(CX + 16, EY + 32); t.lineTo(CX - 16, EY + 32); t.closePath();
    c.fillStyle = '#fffaf2'; c.fill(t);
    const tg = blob(CX, EY + 52, 12, 7, 0.05, 5);
    c.fillStyle = '#d2686a'; c.fill(tg);
  },
  pleased(c) {
    [-24, 24].forEach((dx) => {
      const e = new Path2D();
      e.moveTo(CX + dx - 17, EY + 8);
      e.quadraticCurveTo(CX + dx, EY - 14, CX + dx + 17, EY + 8);
      c.strokeStyle = INK; c.lineWidth = LW * 0.75; c.lineCap = 'round'; c.stroke(e);
    });
    brow(c, CX - 24, EY - 26, 28, -3); brow(c, CX + 24, EY - 26, 28, 3);
    const m = new Path2D();
    m.moveTo(CX - 19, EY + 34); m.quadraticCurveTo(CX, EY + 50, CX + 19, EY + 34);
    c.strokeStyle = INK; c.lineWidth = LW * 0.65; c.lineCap = 'round'; c.stroke(m);
  },
};

// ---------- headwear ----------
// All of these sit ON the skull and leave the face clear — a hat that reaches
// the eyebrows reads as a swim cap at sprite size.
const heads = {
  capBack: (col) => (c) => {
    const crown = new Path2D();
    crown.moveTo(CX - HEAD_R - 1, HEAD_Y - 16);
    crown.quadraticCurveTo(CX - HEAD_R + 4, HEAD_Y - HEAD_R - 34, CX + 4, HEAD_Y - HEAD_R - 30);
    crown.quadraticCurveTo(CX + HEAD_R + 6, HEAD_Y - HEAD_R - 22, CX + HEAD_R + 1, HEAD_Y - 16);
    crown.quadraticCurveTo(CX, HEAD_Y - 30, CX - HEAD_R - 1, HEAD_Y - 16);
    crown.closePath();
    ink(c, crown, col);
    c.save(); c.clip(crown);
    const s = new Path2D(); s.rect(CX + 18, HEAD_Y - 200, 160, 240);
    c.fillStyle = shade(col, 0.84); c.fill(s); c.restore();
    // brim, worn backwards: a stubby tongue off the left side
    const brim = new Path2D();
    brim.moveTo(CX - HEAD_R + 4, HEAD_Y - 34);
    brim.quadraticCurveTo(CX - HEAD_R - 40, HEAD_Y - 34, CX - HEAD_R - 36, HEAD_Y - 12);
    brim.quadraticCurveTo(CX - HEAD_R - 16, HEAD_Y - 16, CX - HEAD_R + 2, HEAD_Y - 17);
    brim.closePath();
    ink(c, brim, shade(col, 0.78), LW * 0.75);
  },
  hood: (col) => (c) => {
    const h = new Path2D();
    h.moveTo(CX - HEAD_R - 16, HEAD_Y + 34);
    h.quadraticCurveTo(CX - HEAD_R - 22, HEAD_Y - HEAD_R - 32, CX, HEAD_Y - HEAD_R - 28);
    h.quadraticCurveTo(CX + HEAD_R + 22, HEAD_Y - HEAD_R - 32, CX + HEAD_R + 16, HEAD_Y + 34);
    h.quadraticCurveTo(CX + HEAD_R - 10, HEAD_Y - 26, CX, HEAD_Y - 22);
    h.quadraticCurveTo(CX - HEAD_R + 10, HEAD_Y - 26, CX - HEAD_R - 16, HEAD_Y + 34);
    h.closePath();
    ink(c, h, col);
    c.save(); c.clip(h);
    const s = new Path2D(); s.rect(CX + 18, HEAD_Y - 200, 180, 300);
    c.fillStyle = shade(col, 0.85); c.fill(s); c.restore();
    // the shadow the hood throws across the eyes
    const sh = new Path2D();
    sh.moveTo(CX - HEAD_R + 4, HEAD_Y - 18);
    sh.quadraticCurveTo(CX, HEAD_Y + 4, CX + HEAD_R - 4, HEAD_Y - 18);
    sh.quadraticCurveTo(CX, HEAD_Y - 32, CX - HEAD_R + 4, HEAD_Y - 18);
    sh.closePath();
    c.fillStyle = 'rgba(30,22,18,0.26)'; c.fill(sh);
  },
  spikes: (col) => (c) => {
    // one closed path: a scalloped skullcap with triangular spikes off the top
    const p = new Path2D();
    p.moveTo(CX - HEAD_R - 2, HEAD_Y - 12);
    const tips = [[-52, -58], [-26, -84], [2, -92], [30, -80], [54, -54]];
    p.lineTo(CX - HEAD_R + 4, HEAD_Y - 40);
    for (const [tx, ty] of tips) {
      p.lineTo(CX + tx, HEAD_Y + ty);
      p.lineTo(CX + tx + 14, HEAD_Y + ty + 26);
    }
    p.lineTo(CX + HEAD_R + 2, HEAD_Y - 12);
    p.quadraticCurveTo(CX, HEAD_Y - 44, CX - HEAD_R - 2, HEAD_Y - 12);
    p.closePath();
    ink(c, p, col);
  },
  slick: (col) => (c) => {
    const p = new Path2D();
    p.moveTo(CX - HEAD_R - 1, HEAD_Y - 8);
    p.quadraticCurveTo(CX - HEAD_R + 6, HEAD_Y - HEAD_R - 30, CX + 6, HEAD_Y - HEAD_R - 26);
    p.quadraticCurveTo(CX + HEAD_R + 14, HEAD_Y - HEAD_R - 14, CX + HEAD_R + 1, HEAD_Y - 8);
    p.quadraticCurveTo(CX + 26, HEAD_Y - 36, CX - 14, HEAD_Y - 28);
    p.quadraticCurveTo(CX - HEAD_R + 4, HEAD_Y - 22, CX - HEAD_R - 1, HEAD_Y - 8);
    p.closePath();
    ink(c, p, col);
  },
};

// ---------- props ----------
function chain(c) {
  const y = SHOULDER + 16;
  const p = new Path2D();
  p.moveTo(CX - 34, y); p.quadraticCurveTo(CX, y + 54, CX + 34, y);
  c.lineCap = 'round';
  c.strokeStyle = INK; c.lineWidth = 13; c.stroke(p);
  c.strokeStyle = '#f3c53f'; c.lineWidth = 7; c.stroke(p);
  ink(c, blob(CX, y + 46, 15, 14, 0.09, 3), '#f3c53f', LW * 0.5);
}
function padlock(c) {
  const y = HIP - 40;
  const sh = new Path2D();
  sh.arc(CX, y, 11, Math.PI, 0);
  c.strokeStyle = INK; c.lineWidth = 15; c.stroke(sh);
  c.strokeStyle = '#c9d2da'; c.lineWidth = 8; c.stroke(sh);
  ink(c, roundRect(CX - 18, y - 2, 36, 30, 7), '#f3c53f', LW * 0.55);
  const kh = new Path2D(); kh.ellipse(CX, y + 12, 4.5, 5.5, 0, 0, 7);
  c.fillStyle = INK; c.fill(kh);
}
function satchel(c) {
  const strap = new Path2D();
  strap.moveTo(CX - 44, SHOULDER - 4); strap.lineTo(CX + 34, HIP - 22);
  c.lineCap = 'round';
  c.strokeStyle = INK; c.lineWidth = 20; c.stroke(strap);
  c.strokeStyle = '#8a6742'; c.lineWidth = 12; c.stroke(strap);
  ink(c, roundRect(CX + 22, HIP - 34, 56, 46, 9), '#a97a4c', LW * 0.7);
  ink(c, roundRect(CX + 22, HIP - 34, 56, 20, 7), '#8a6742', LW * 0.55);
}
function magnifier(c, skin) {
  // held in the raised right hand
  const hx = CX + 112, hy = SHOULDER - 34;
  const h = new Path2D(); h.moveTo(hx - 6, hy + 22); h.lineTo(hx - 16, hy + 44);
  c.lineCap = 'round';
  c.strokeStyle = INK; c.lineWidth = 17; c.stroke(h);
  c.strokeStyle = '#8a6742'; c.lineWidth = 10; c.stroke(h);
  const r = new Path2D(); r.arc(hx, hy, 23, 0, 7);
  ink(c, r, 'rgba(196,229,255,0.6)', LW * 0.7);
  hand(c, hx - 12, hy + 36, skin, 12);
}

// ---------- the cast ----------
const CAST = [
  { key: 'player', label: 'Player', cfg: {
      cloth: '#2fbfc9', trousers: '#3c5a63', shoe: '#efe6da', skin: '#f6cda4',
      arms: 'sneak', drawHead: heads.capBack('#17828d'), drawFace: faces.grin } },
  { key: 'tex_bot0', label: 'Sneaky', cfg: {
      cloth: '#8558c8', trousers: '#4a3670', shoe: '#2f2740', skin: '#e8bd93',
      arms: 'pockets', drawHead: heads.hood('#6f45ab'), drawFace: faces.sly } },
  { key: 'tex_bot1', label: 'Rich Kid', cfg: {
      cloth: '#38a7e8', trousers: '#2b6fa0', shoe: '#f4f1e8', skin: '#f3c79c',
      arms: 'folded', prop: chain, drawHead: heads.slick('#3a2c22'), drawFace: faces.smug } },
  { key: 'tex_bot2', label: 'Guard Dog', cfg: {
      cloth: '#e2544c', trousers: '#7d2f2c', shoe: '#3d3129', skin: '#e3ab7c',
      arms: 'folded', prop: padlock, drawHead: heads.capBack('#a83a34'), drawFace: faces.scowl } },
  { key: 'tex_bot3', label: 'Chaos Kid', cfg: {
      cloth: '#f59331', trousers: '#9c5518', shoe: '#efe6da', skin: '#f6cda4',
      arms: 'flung', drawHead: heads.spikes('#d94f2a'), drawFace: faces.shout } },
  { key: 'tex_bot4', label: 'Collector', cfg: {
      cloth: '#5ab758', trousers: '#356b35', shoe: '#4a3a2c', skin: '#eec49b',
      arms: 'hold', prop: (c, skin) => { satchel(c); magnifier(c, skin); },
      drawHead: heads.slick('#6d4b2a'), drawFace: faces.pleased } },
];

// ---------- entry point ----------
function drawCast() {
  const out = [];
  for (const ch of CAST) {
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    drawKid(cv.getContext('2d'), ch.cfg);
    out.push({ key: ch.key, label: ch.label, url: cv.toDataURL('image/png'), canvas: cv });
  }
  return out;
}

window.drawCast = drawCast;
window.CAST = CAST;
