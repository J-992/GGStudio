/**
 * Draws the whole game sprite sheet with Canvas 2D at boot, into one Phaser
 * CanvasTexture keyed ATLAS_KEY. Stand-in art until real chibi sprites land —
 * see atlasConfig.ts for the swap seam.
 */
import Phaser from 'phaser';
import { ATLAS_KEY, CHAR_FRAME, ninjaFrame, enemyFrame, FX_FRAMES } from './atlasConfig';

// Palette
const BODY_DARK = '#384566';
const OUTLINE = '#2b1d12';
const SKIN = '#f3c99a';
const EYE_WHITE = '#ffffff';

// Specs
type WeaponKind =
  | 'stick'
  | 'sword'
  | 'dualSword'
  | 'flameSword'
  | 'boltBlade'
  | 'curvedBlade'
  | 'heavyBlade'
  | 'ornate'
  | 'ribbon'
  | 'dagger'
  | 'club'
  | 'twinBlades'
  | 'none';

interface NinjaSpec {
  body: string;
  accent: string;
  weapon: WeaponKind;
  trim?: string;
  hood?: boolean;
  scarf?: boolean;
  horns?: boolean;
  aura?: boolean;
  alpha?: number;
  floating?: boolean;
  symbols?: boolean;
  robe?: boolean;
  armorPlates?: boolean;
  shoulderGuards?: boolean;
  zigzag?: boolean;
  scale?: number;
}

const NINJA_SPECS: readonly NinjaSpec[] = [
  { body: '#e8d5a8', accent: '#9b642f', weapon: 'stick' },
  { body: '#4a5a86', accent: '#8fd3f0', weapon: 'sword', hood: true },
  { body: '#377cab', accent: '#71d5f5', weapon: 'dualSword', shoulderGuards: true },
  { body: '#554378', accent: '#c879cc', weapon: 'sword', scarf: true },
  { body: '#b94432', accent: '#ff8b38', weapon: 'flameSword' },
  { body: '#536e9b', accent: '#ffd23f', weapon: 'boltBlade', zigzag: true },
  { body: '#3a947b', accent: '#8ef0cd', weapon: 'curvedBlade', robe: true },
  { body: '#8f3430', accent: '#f06b51', weapon: 'heavyBlade', horns: true, scale: 1.05 },
  { body: '#7961a8', accent: '#c7adff', weapon: 'none', alpha: 0.82, floating: true, symbols: true },
  { body: '#8a5732', accent: '#ffd35a', weapon: 'ornate', armorPlates: true, aura: true, scale: 1.06, trim: '#fff3c4' },
  { body: '#3d789f', accent: '#9be2ff', weapon: 'ribbon', floating: true, symbols: true },
  { body: '#a4433f', accent: '#fff5d4', weapon: 'ornate', armorPlates: true, aura: true, scale: 1.16, trim: '#ffd23f' },
] as const;

// Small draw helpers
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 0xff) + Math.round(255 * amount)));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + Math.round(255 * amount)));
  const b = Math.max(0, Math.min(255, (n & 0xff) + Math.round(255 * amount)));
  return `rgb(${r}, ${g}, ${b})`;
}

function drawShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(10, 12, 20, 0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, rx * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAura(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = r * 0.1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function outlineFillRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.stroke();
}

// Ninja body parts
function drawScarf(ctx: CanvasRenderingContext2D, cx: number, neckY: number, accent: string): void {
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(cx - 4, neckY);
  ctx.quadraticCurveTo(cx - 30, neckY + 20, cx - 22, neckY + 46);
  ctx.quadraticCurveTo(cx - 14, neckY + 24, cx + 2, neckY + 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawHorns(ctx: CanvasRenderingContext2D, cx: number, headCY: number, headR: number, accent: string): void {
  ctx.fillStyle = shade(accent, -0.1);
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.moveTo(cx + side * headR * 0.6, headCY - headR * 0.7);
    ctx.quadraticCurveTo(cx + side * headR * 1.25, headCY - headR * 1.35, cx + side * headR * 0.95, headCY - headR * 1.5);
    ctx.quadraticCurveTo(cx + side * headR * 0.85, headCY - headR * 1.05, cx + side * headR * 0.4, headCY - headR * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
}

function drawHeadbandTails(ctx: CanvasRenderingContext2D, cx: number, headCY: number, headR: number, accent: string): void {
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(cx + headR * 0.95, headCY - headR * 0.05);
  ctx.quadraticCurveTo(cx + headR * 1.6, headCY + headR * 0.3, cx + headR * 1.35, headCY + headR * 0.9);
  ctx.quadraticCurveTo(cx + headR * 1.15, headCY + headR * 0.35, cx + headR * 0.75, headCY + headR * 0.2);
  ctx.closePath();
  ctx.fill();
}

function drawShoulderGuards(ctx: CanvasRenderingContext2D, cx: number, bodyTopY: number, bodyW: number, accent: string): void {
  ctx.fillStyle = shade(accent, 0.1);
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.ellipse(cx + side * bodyW * 0.55, bodyTopY + bodyW * 0.14, bodyW * 0.26, bodyW * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}

function drawArmorPlates(ctx: CanvasRenderingContext2D, cx: number, bodyTopY: number, bodyW: number, bodyH: number, trim: string): void {
  ctx.strokeStyle = trim;
  ctx.lineWidth = Math.max(1.5, bodyW * 0.05);
  for (let i = 1; i <= 2; i += 1) {
    const y = bodyTopY + (bodyH * i) / 3;
    ctx.beginPath();
    ctx.moveTo(cx - bodyW / 2 + 3, y);
    ctx.lineTo(cx + bodyW / 2 - 3, y);
    ctx.stroke();
  }
  ctx.strokeStyle = OUTLINE;
}

function drawRobeSkirt(ctx: CanvasRenderingContext2D, cx: number, topY: number, bottomY: number, width: number): void {
  ctx.beginPath();
  ctx.moveTo(cx - width * 0.28, topY);
  ctx.quadraticCurveTo(cx - width * 0.55, bottomY * 0.6 + topY * 0.4, cx - width * 0.5, bottomY);
  ctx.lineTo(cx + width * 0.5, bottomY);
  ctx.quadraticCurveTo(cx + width * 0.55, bottomY * 0.6 + topY * 0.4, cx + width * 0.28, topY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawFloatingSymbols(ctx: CanvasRenderingContext2D, cx: number, headCY: number, figureH: number, accent: string): void {
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = accent;
  const positions: ReadonlyArray<readonly [number, number]> = [
    [-1, -0.2],
    [1.05, 0.1],
    [-0.85, 0.75],
  ];
  positions.forEach(([sx, sy]) => {
    const px = cx + sx * figureH * 0.4;
    const py = headCY + sy * figureH * 0.4;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
  });
  ctx.restore();
}

// Weapons — drawn to the figure's right side, hilt near the hand
function drawBlade(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, width: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(width / 2, len * 0.18);
  ctx.lineTo(width * 0.28, len);
  ctx.lineTo(-width * 0.28, len);
  ctx.lineTo(-width / 2, len * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawHilt(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(x - size * 0.35, y - size * 0.5, size * 0.7, size * 0.5);
  ctx.strokeRect(x - size * 0.35, y - size * 0.5, size * 0.7, size * 0.5);
}

function drawWeapon(
  ctx: CanvasRenderingContext2D,
  kind: WeaponKind,
  cx: number,
  bodyTopY: number,
  bodyBottomY: number,
  figureH: number,
  accent: string,
  trim: string,
  zigzag: boolean,
): void {
  const hx = cx + figureH * 0.34;
  const hy = (bodyTopY + bodyBottomY) / 2;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1.5, figureH * 0.025);

  switch (kind) {
    case 'none':
      return;
    case 'stick':
      ctx.strokeStyle = '#7a5230';
      ctx.lineWidth = figureH * 0.05;
      ctx.beginPath();
      ctx.moveTo(hx, hy + figureH * 0.2);
      ctx.lineTo(hx + figureH * 0.05, hy - figureH * 0.45);
      ctx.stroke();
      return;
    case 'sword':
      drawHilt(ctx, hx, hy + figureH * 0.15, figureH * 0.22);
      drawBlade(ctx, hx, hy + figureH * 0.15 - figureH * 0.5, figureH * 0.5, figureH * 0.16, '#d8dde6');
      return;
    case 'dualSword':
      [-1, 1].forEach((side) => {
        ctx.save();
        ctx.translate(hx, hy + figureH * 0.1);
        ctx.rotate((side * Math.PI) / 10);
        drawHilt(ctx, 0, figureH * 0.1, figureH * 0.2);
        drawBlade(ctx, 0, figureH * 0.1 - figureH * 0.46, figureH * 0.46, figureH * 0.14, '#cfe6f4');
        ctx.restore();
      });
      return;
    case 'flameSword': {
      drawHilt(ctx, hx, hy + figureH * 0.15, figureH * 0.22);
      const tipY = hy + figureH * 0.15 - figureH * 0.5;
      drawBlade(ctx, hx, tipY, figureH * 0.5, figureH * 0.16, '#ffb64f');
      ctx.fillStyle = '#ff6b2c';
      ctx.beginPath();
      ctx.moveTo(hx - figureH * 0.08, tipY + figureH * 0.15);
      ctx.quadraticCurveTo(hx, tipY - figureH * 0.14, hx + figureH * 0.06, tipY + figureH * 0.1);
      ctx.quadraticCurveTo(hx + figureH * 0.02, tipY + figureH * 0.2, hx - figureH * 0.08, tipY + figureH * 0.15);
      ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(hx, tipY, figureH * 0.05, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case 'boltBlade': {
      drawHilt(ctx, hx, hy + figureH * 0.15, figureH * 0.22);
      ctx.fillStyle = accent;
      const top = hy + figureH * 0.15;
      ctx.beginPath();
      ctx.moveTo(hx - figureH * 0.08, top);
      ctx.lineTo(hx + figureH * 0.1, top - figureH * 0.2);
      ctx.lineTo(hx - figureH * 0.02, top - figureH * 0.2);
      ctx.lineTo(hx + figureH * 0.12, top - figureH * 0.5);
      ctx.lineTo(hx - figureH * 0.04, top - figureH * 0.28);
      ctx.lineTo(hx + figureH * 0.04, top - figureH * 0.28);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (zigzag) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      return;
    }
    case 'curvedBlade':
      drawHilt(ctx, hx, hy + figureH * 0.2, figureH * 0.22);
      ctx.fillStyle = '#eafaf3';
      ctx.beginPath();
      ctx.moveTo(hx, hy + figureH * 0.2);
      ctx.quadraticCurveTo(hx + figureH * 0.45, hy + figureH * 0.05, hx + figureH * 0.4, hy - figureH * 0.45);
      ctx.quadraticCurveTo(hx + figureH * 0.22, hy - figureH * 0.02, hx - figureH * 0.04, hy + figureH * 0.24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    case 'heavyBlade':
      drawHilt(ctx, hx, hy + figureH * 0.2, figureH * 0.28);
      drawBlade(ctx, hx, hy + figureH * 0.2 - figureH * 0.55, figureH * 0.55, figureH * 0.26, '#e2e6ee');
      return;
    case 'ornate':
      drawHilt(ctx, hx, hy + figureH * 0.2, figureH * 0.3);
      drawBlade(ctx, hx, hy + figureH * 0.2 - figureH * 0.58, figureH * 0.58, figureH * 0.22, trim);
      ctx.strokeStyle = trim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hx, hy + figureH * 0.2, figureH * 0.18, 0, Math.PI * 2);
      ctx.stroke();
      return;
    case 'ribbon':
      ctx.strokeStyle = accent;
      ctx.lineWidth = figureH * 0.035;
      ctx.beginPath();
      ctx.moveTo(cx - figureH * 0.4, hy - figureH * 0.3);
      ctx.bezierCurveTo(
        cx + figureH * 0.3,
        hy - figureH * 0.55,
        cx + figureH * 0.4,
        hy + figureH * 0.1,
        cx - figureH * 0.1,
        hy + figureH * 0.35,
      );
      ctx.stroke();
      return;
    case 'dagger':
      drawHilt(ctx, hx, hy + figureH * 0.1, figureH * 0.16);
      drawBlade(ctx, hx, hy + figureH * 0.1 - figureH * 0.22, figureH * 0.22, figureH * 0.12, '#dfe3ea');
      return;
    case 'club':
      ctx.strokeStyle = '#5b4a36';
      ctx.lineWidth = figureH * 0.06;
      ctx.beginPath();
      ctx.moveTo(hx, hy + figureH * 0.25);
      ctx.lineTo(hx + figureH * 0.05, hy - figureH * 0.3);
      ctx.stroke();
      ctx.fillStyle = '#6d5a42';
      ctx.beginPath();
      ctx.arc(hx + figureH * 0.06, hy - figureH * 0.34, figureH * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      return;
    case 'twinBlades':
      [-1, 1].forEach((side) => {
        drawHilt(ctx, hx + side * figureH * 0.12, hy + figureH * 0.22, figureH * 0.16);
        drawBlade(ctx, hx + side * figureH * 0.12, hy + figureH * 0.22 - figureH * 0.3, figureH * 0.3, figureH * 0.1, '#f2c9c9');
      });
      return;
    default:
      return;
  }
}

// Ninja figure
function drawNinja(ctx: CanvasRenderingContext2D, size: number, spec: NinjaSpec): void {
  ctx.save();
  ctx.globalAlpha = spec.alpha ?? 1;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(4, size * 0.035);

  const scale = spec.scale ?? 1;
  const cx = size / 2;
  const groundY = size * 0.92;
  const figureH = size * 0.84 * scale;
  const headR = figureH * 0.21;
  const bodyW = figureH * 0.34;
  const bodyH = figureH * 0.4;
  const legH = spec.floating ? 0 : figureH * 0.18;

  const footY = spec.floating ? groundY - figureH * 0.12 : groundY;
  const bodyBottomY = footY - legH;
  const bodyTopY = bodyBottomY - bodyH;
  const headCY = bodyTopY - headR * 0.75;

  if (!spec.floating) {
    drawShadow(ctx, cx, groundY + 4, bodyW * 1.1);
  }
  if (spec.aura) {
    drawAura(ctx, cx, (bodyTopY + bodyBottomY) / 2, figureH * 0.62, spec.accent);
  }

  // Legs / feet
  if (!spec.floating) {
    ctx.fillStyle = spec.body;
    [-1, 1].forEach((side) => {
      const legX = cx + side * bodyW * 0.22;
      outlineFillRect(ctx, legX - bodyW * 0.12, bodyBottomY, bodyW * 0.24, legH, bodyW * 0.1);
    });
  }

  // Body / robe
  ctx.fillStyle = spec.body;
  if (spec.robe) {
    drawRobeSkirt(ctx, cx, bodyTopY, bodyBottomY + legH * 0.5, bodyW * 1.3);
  } else {
    outlineFillRect(ctx, cx - bodyW / 2, bodyTopY, bodyW, bodyH, bodyW * 0.28);
  }

  if (spec.armorPlates) {
    drawArmorPlates(ctx, cx, bodyTopY, bodyW, bodyH, spec.trim ?? spec.accent);
  }
  if (spec.shoulderGuards) {
    drawShoulderGuards(ctx, cx, bodyTopY, bodyW, spec.accent);
  }

  // Sash band across torso
  ctx.fillStyle = spec.accent;
  ctx.fillRect(cx - bodyW / 2, bodyTopY + bodyH * 0.15, bodyW, bodyH * 0.22);

  if (spec.scarf) {
    drawScarf(ctx, cx, bodyTopY, spec.accent);
  }

  // Head
  ctx.fillStyle = spec.body;
  ctx.beginPath();
  ctx.arc(cx, headCY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (spec.hood) {
    ctx.fillStyle = shade(spec.accent, -0.3);
    ctx.beginPath();
    ctx.arc(cx, headCY - headR * 0.12, headR * 1.1, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
  }
  if (spec.horns) {
    drawHorns(ctx, cx, headCY, headR, spec.accent);
  }

  // Headband + tails
  ctx.fillStyle = spec.accent;
  ctx.fillRect(cx - headR, headCY - headR * 0.08, headR * 2, headR * 0.32);
  ctx.strokeRect(cx - headR, headCY - headR * 0.08, headR * 2, headR * 0.32);
  drawHeadbandTails(ctx, cx, headCY, headR, spec.accent);

  // Eye strip + eyes
  ctx.fillStyle = SKIN;
  ctx.fillRect(cx - headR * 0.85, headCY + headR * 0.06, headR * 1.7, headR * 0.5);
  ctx.fillStyle = EYE_WHITE;
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.ellipse(cx + side * headR * 0.38, headCY + headR * 0.31, headR * 0.16, headR * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  drawWeapon(ctx, spec.weapon, cx, bodyTopY, bodyBottomY, figureH, spec.accent, spec.trim ?? spec.accent, spec.zigzag ?? false);

  if (spec.symbols) {
    drawFloatingSymbols(ctx, cx, headCY, figureH, spec.accent);
  }

  ctx.restore();
}

// Bespoke enemies
function drawTrainingDummy(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.save();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(4, size * 0.035);
  const cx = size / 2;
  const groundY = size * 0.92;
  drawShadow(ctx, cx, groundY + 4, size * 0.22);

  // Post
  ctx.fillStyle = '#8a6a3d';
  ctx.fillRect(cx - size * 0.06, size * 0.3, size * 0.12, groundY - size * 0.3);
  ctx.strokeRect(cx - size * 0.06, size * 0.3, size * 0.12, groundY - size * 0.3);

  // Crossbar arms
  ctx.fillRect(cx - size * 0.24, size * 0.42, size * 0.48, size * 0.08);
  ctx.strokeRect(cx - size * 0.24, size * 0.42, size * 0.48, size * 0.08);

  // Sack head
  ctx.fillStyle = '#d8c39a';
  outlineFillRect(ctx, cx - size * 0.17, size * 0.14, size * 0.34, size * 0.28, size * 0.08);
  ctx.strokeStyle = '#a9905f';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.15, size * 0.2);
  ctx.lineTo(cx + size * 0.15, size * 0.2);
  ctx.moveTo(cx - size * 0.15, size * 0.28);
  ctx.lineTo(cx + size * 0.15, size * 0.28);
  ctx.stroke();

  // Target rings on torso
  ctx.strokeStyle = '#c2352f';
  [0.16, 0.1, 0.04].forEach((r) => {
    ctx.beginPath();
    ctx.arc(cx, size * 0.6, size * r, 0, Math.PI * 2);
    ctx.stroke();
  });

  ctx.restore();
}

function drawDojoMaster(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.save();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(2, size * 0.022);
  const cx = size / 2;
  const groundY = size * 0.95;
  drawShadow(ctx, cx, groundY + 3, size * 0.34);

  const figureH = size * 0.86;
  const bodyW = figureH * 0.5;
  const bodyTopY = size * 0.34;
  const bodyBottomY = groundY - figureH * 0.06;

  // Wide robe
  ctx.fillStyle = '#2a2536';
  drawRobeSkirt(ctx, cx, bodyTopY, bodyBottomY, bodyW * 1.6);

  // Gold trim hem
  ctx.strokeStyle = '#d8b23c';
  ctx.lineWidth = size * 0.02;
  ctx.beginPath();
  ctx.moveTo(cx - bodyW * 0.78, bodyBottomY - 2);
  ctx.lineTo(cx + bodyW * 0.78, bodyBottomY - 2);
  ctx.stroke();
  ctx.strokeStyle = OUTLINE;

  // Head
  const headR = figureH * 0.17;
  const headCY = bodyTopY - headR * 0.5;
  ctx.fillStyle = BODY_DARK;
  ctx.beginPath();
  ctx.arc(cx, headCY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Wide-brimmed hat
  ctx.fillStyle = '#3a3346';
  ctx.beginPath();
  ctx.ellipse(cx, headCY - headR * 0.55, headR * 1.9, headR * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - headR * 0.55, headCY - headR * 1.4);
  ctx.lineTo(cx + headR * 0.55, headCY - headR * 1.4);
  ctx.lineTo(cx + headR * 0.4, headCY - headR * 0.6);
  ctx.lineTo(cx - headR * 0.4, headCY - headR * 0.6);
  ctx.closePath();
  ctx.fillStyle = '#4a4056';
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#d8b23c';
  ctx.beginPath();
  ctx.ellipse(cx, headCY - headR * 0.55, headR * 1.9, headR * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Eyes glow beneath the brim shadow
  ctx.fillStyle = '#c2352f';
  [-1, 1].forEach((side) => {
    ctx.beginPath();
    ctx.arc(cx + side * headR * 0.35, headCY + headR * 0.15, headR * 0.12, 0, Math.PI * 2);
    ctx.fill();
  });

  // Staff
  const staffX = cx + bodyW * 0.85;
  ctx.strokeStyle = '#6d5a3c';
  ctx.lineWidth = figureH * 0.035;
  ctx.beginPath();
  ctx.moveTo(staffX, bodyBottomY);
  ctx.lineTo(staffX, headCY - headR * 1.6);
  ctx.stroke();
  ctx.fillStyle = '#d8b23c';
  ctx.beginPath();
  ctx.arc(staffX, headCY - headR * 1.7, headR * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// FX frames — white/near-white so they can be tinted at runtime
function drawCoin(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.44;
  ctx.strokeStyle = '#b8860f';
  ctx.lineWidth = 2;
  ctx.fillStyle = '#f4c542';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffe58a';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff6d6';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.25, cy - r * 0.3, r * 0.18, r * 0.1, -Math.PI / 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawStar(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.min(w, h) * 0.48;
  const inner = outer * 0.32;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < 4; i += 1) {
    const angle = (Math.PI / 2) * i;
    const tipX = cx + Math.cos(angle) * outer;
    const tipY = cy + Math.sin(angle) * outer;
    const nextAngle = angle + Math.PI / 2;
    const c1x = cx + Math.cos(angle + Math.PI / 4) * inner;
    const c1y = cy + Math.sin(angle + Math.PI / 4) * inner;
    if (i === 0) ctx.moveTo(tipX, tipY);
    else ctx.lineTo(tipX, tipY);
    const nextTipX = cx + Math.cos(nextAngle) * outer;
    const nextTipY = cy + Math.sin(nextAngle) * outer;
    ctx.quadraticCurveTo(c1x, c1y, nextTipX, nextTipY);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff9e0';
  ctx.beginPath();
  ctx.arc(cx, cy, inner * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

function drawPuff(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.22;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  const blobs: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 1],
    [-0.6, 0.1, 0.72],
    [0.6, 0.1, 0.72],
    [-0.25, -0.4, 0.62],
    [0.3, -0.35, 0.6],
    [0, 0.35, 0.7],
  ];
  blobs.forEach(([dx, dy, s]) => {
    ctx.beginPath();
    ctx.arc(cx + dx * r, cy + dy * r, r * s, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = 'rgba(220, 224, 232, 0.55)';
  ctx.beginPath();
  ctx.arc(cx + r * 0.1, cy + r * 0.15, r * 0.9, 0, Math.PI * 2);
  ctx.fill();
}

function drawSpark(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.42;
  ctx.fillStyle = '#fffbe0';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.4, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.4, cy);
  ctx.closePath();
  ctx.fill();
}

function drawRing(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.38;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSlash(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineCap = 'round';
  const steps = 5;
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const taper = Math.sin(t * Math.PI);
    ctx.lineWidth = 2 + taper * (h * 0.5);
    const x0 = cx - w * 0.42 + t * w * 0.84;
    const y0 = cy + Math.sin(t * Math.PI) * -h * 0.3;
    const x1 = x0 + w * 0.01;
    const y1 = y0 - h * 0.02;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

// Shelf packing
interface FrameSpec {
  name: string;
  w: number;
  h: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

interface PackedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Transparent gutter between packed frames.
 *
 * Without it, frames touch edge-to-edge and linear filtering samples across the
 * seam when a sprite is drawn scaled up — the white FX frames bled a visible
 * arc into the neighbouring character sprites in the arena.
 */
const PAD = 4;

function packShelves(frames: readonly FrameSpec[], maxWidth: number): { rects: Map<string, PackedRect>; width: number; height: number } {
  const rects = new Map<string, PackedRect>();
  let cursorX = PAD;
  let cursorY = PAD;
  let rowH = 0;
  let maxX = 0;
  for (const f of frames) {
    if (cursorX + f.w + PAD > maxWidth && cursorX > PAD) {
      cursorX = PAD;
      cursorY += rowH + PAD;
      rowH = 0;
    }
    rects.set(f.name, { x: cursorX, y: cursorY, w: f.w, h: f.h });
    cursorX += f.w + PAD;
    rowH = Math.max(rowH, f.h);
    maxX = Math.max(maxX, cursorX);
  }
  return { rects, width: maxX + PAD, height: cursorY + rowH + PAD };
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Entry point
export function generatePlaceholderAtlas(scene: Phaser.Scene): void {
  if (scene.textures.exists(ATLAS_KEY)) return;

  const frames: FrameSpec[] = [];

  NINJA_SPECS.forEach((spec, i) => {
    frames.push({
      name: ninjaFrame(i + 1),
      w: CHAR_FRAME,
      h: CHAR_FRAME,
      draw: (ctx, w) => drawNinja(ctx, w, spec),
    });
  });

  const enemyDraws: ReadonlyArray<(ctx: CanvasRenderingContext2D, w: number) => void> = [
    (ctx, w) => drawTrainingDummy(ctx, w),
    (ctx, w) => drawNinja(ctx, w, { body: '#43864d', accent: '#9ee26d', weapon: 'sword' }),
    (ctx, w) => drawNinja(ctx, w, { body: '#66488d', accent: '#d18df0', weapon: 'dagger', hood: true }),
    (ctx, w) => drawNinja(ctx, w, { body: '#697789', accent: '#d8e2ea', weapon: 'club', scale: 1.12 }),
    (ctx, w) => drawNinja(ctx, w, { body: '#a33d39', accent: '#ff8070', weapon: 'twinBlades', scale: 0.96 }),
    (ctx, w) => drawDojoMaster(ctx, w),
  ];
  enemyDraws.forEach((draw, i) => {
    frames.push({ name: enemyFrame(i), w: CHAR_FRAME, h: CHAR_FRAME, draw: (ctx, w) => draw(ctx, w) });
  });

  frames.push(
    { name: FX_FRAMES.coin, w: 32, h: 32, draw: drawCoin },
    { name: FX_FRAMES.star, w: 32, h: 32, draw: drawStar },
    { name: FX_FRAMES.puff, w: 48, h: 48, draw: drawPuff },
    { name: FX_FRAMES.spark, w: 16, h: 16, draw: drawSpark },
    { name: FX_FRAMES.ring, w: 64, h: 64, draw: drawRing },
    { name: FX_FRAMES.slash, w: 96, h: 48, draw: drawSlash },
  );

  const { rects, width, height } = packShelves(frames, CHAR_FRAME * 6);
  const sheetW = nextPow2(width);
  const sheetH = nextPow2(height);

  const tex = scene.textures.createCanvas(ATLAS_KEY, sheetW, sheetH)!;
  const ctx = tex.getContext();

  for (const f of frames) {
    const r = rects.get(f.name);
    if (!r) continue;
    ctx.save();
    ctx.translate(r.x, r.y);
    f.draw(ctx, f.w, f.h);
    ctx.restore();
    tex.add(f.name, 0, r.x, r.y, f.w, f.h);
  }

  tex.refresh();
}
