// All 15 levels as data. The Course builder (src/systems/Course.js) compiles
// these segment lists into platforms, walls, gears, pads, bolts and checkpoints.
//
// Segment vocabulary:
//   run       { len, w? }                  plain floor (default width 6)
//   gap       { len }                      void with a bolt arc over it
//   narrow    { len, w? }                  skinny track (default 2.2)
//   steps     { n, len, gap, w? }          hop-hop-hop platforms
//   split     { len, sep, w? }             floor diverges into two lanes at ±sep/2
//   lanes     { len, sep, w? }             two parallel lanes
//   merge     { len, sep, w? }             lanes converge back to center
//   slalom    { n, len, gap, off, w? }     platforms alternating left/right
//   moving    { n, len, gap, w?, amp, speed }  side-to-side moving platforms
//   gate      { openings:[{c,w}], w? }     wall with openings, floor continues
//   divider   { len, w? }                  floor with a center wall between the pair
//   gears     { len, w?, side }            floor with spinning gears ('alt'|'center'|'left'|'right')
//   conveyor  { len, w?, dir }             +1 speeds you up, -1 drags you back
//   pads      { len, w? }                  floor with a bouncy launch pad
//   checkpoint {}                          respawn marker
//
// Every level ends with an implicit finish straight. Gap rule of thumb: a full
// jump at speed 1.0 covers ~7 units, so required gaps stay under ~4.5. Levels
// aim for 30-75 seconds; base run speed is 10 units/sec times level speed.
const LEVELS = [
  {
    id: 1, name: 'First Steps', speed: 1.0,
    tip: 'You run by yourselves — steer and jump the gaps. Stay together!',
    segments: [
      { t: 'run', len: 24 },
      { t: 'gap', len: 2.5 },
      { t: 'run', len: 16 },
      { t: 'gap', len: 3 },
      { t: 'run', len: 14 },
      { t: 'gap', len: 3 },
      { t: 'run', len: 12 },
      { t: 'checkpoint' },
      { t: 'gap', len: 3.5 },
      { t: 'run', len: 10 },
      { t: 'gap', len: 3.5 },
      { t: 'run', len: 10 },
      { t: 'steps', n: 3, len: 6, gap: 2.5 },
      { t: 'run', len: 12 },
      { t: 'checkpoint' },
      { t: 'gap', len: 4 },
      { t: 'run', len: 10 },
      { t: 'steps', n: 4, len: 5, gap: 3 },
      { t: 'run', len: 14 },
      { t: 'gap', len: 4 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 2, name: 'Stick Together', speed: 1.0,
    tip: 'The cord stretches if you drift apart — feel the pull!',
    segments: [
      { t: 'run', len: 16 },
      { t: 'narrow', len: 12, w: 3 },
      { t: 'run', len: 10 },
      { t: 'gap', len: 3 },
      { t: 'narrow', len: 14, w: 2.6 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'gap', len: 3 },
      { t: 'narrow', len: 12, w: 2.4 },
      { t: 'gap', len: 3 },
      { t: 'run', len: 10 },
      { t: 'steps', n: 3, len: 5, gap: 3, w: 3 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'narrow', len: 16, w: 2.2 },
      { t: 'gap', len: 3.5 },
      { t: 'run', len: 8 },
      { t: 'steps', n: 3, len: 4.5, gap: 3, w: 2.8 },
      { t: 'narrow', len: 10, w: 2.6 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 3, name: 'Bolt Rush', speed: 1.0,
    tip: 'Grab golden bolts — the risky ones are worth the detour.',
    segments: [
      { t: 'run', len: 14 },
      { t: 'gap', len: 3.5 },
      { t: 'run', len: 10 },
      { t: 'steps', n: 4, len: 4.5, gap: 3 },
      { t: 'run', len: 10 },
      { t: 'checkpoint' },
      { t: 'gap', len: 4 },
      { t: 'run', len: 8 },
      { t: 'slalom', n: 4, len: 5, gap: 2, off: 1.6, w: 2.8 },
      { t: 'run', len: 10 },
      { t: 'gap', len: 4 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'steps', n: 5, len: 4, gap: 3 },
      { t: 'run', len: 8 },
      { t: 'slalom', n: 4, len: 4.5, gap: 2.5, off: 1.8, w: 2.6 },
      { t: 'gap', len: 4 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 4, name: 'Wide Gate', speed: 1.0,
    tip: 'Spread apart to pass the double gates — then snap back together!',
    segments: [
      { t: 'run', len: 14 },
      { t: 'gate', openings: [{ c: -1.9, w: 1.8 }, { c: 1.9, w: 1.8 }] },
      { t: 'run', len: 10 },
      { t: 'gate', openings: [{ c: -2.1, w: 1.6 }, { c: 2.1, w: 1.6 }] },
      { t: 'narrow', len: 10, w: 2.6 },
      { t: 'run', len: 6 },
      { t: 'checkpoint' },
      { t: 'gate', openings: [{ c: 0, w: 2.2 }] },
      { t: 'gap', len: 3 },
      { t: 'run', len: 8 },
      { t: 'gate', openings: [{ c: -2, w: 1.7 }, { c: 2, w: 1.7 }] },
      { t: 'narrow', len: 8, w: 2.4 },
      { t: 'gap', len: 3.5 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'gate', openings: [{ c: -2.2, w: 1.6 }, { c: 2.2, w: 1.6 }] },
      { t: 'run', len: 6 },
      { t: 'gate', openings: [{ c: 0, w: 2 }] },
      { t: 'run', len: 6 },
      { t: 'gate', openings: [{ c: -2, w: 1.6 }, { c: 2, w: 1.6 }] },
      { t: 'narrow', len: 8, w: 2.2 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 5, name: 'Moving Day', speed: 1.0,
    tip: 'Moving platforms! Time your hops — the cord can steady you.',
    segments: [
      { t: 'run', len: 14 },
      { t: 'moving', n: 2, len: 5, gap: 2.5, w: 3.2, amp: 1.1, speed: 1.3 },
      { t: 'run', len: 10 },
      { t: 'gap', len: 3.5 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'moving', n: 3, len: 4.5, gap: 2.8, w: 3, amp: 1.4, speed: 1.5 },
      { t: 'run', len: 10 },
      { t: 'steps', n: 3, len: 4.5, gap: 3 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'moving', n: 3, len: 4, gap: 3, w: 2.8, amp: 1.6, speed: 1.7 },
      { t: 'run', len: 8 },
      { t: 'gap', len: 4 },
      { t: 'moving', n: 2, len: 4.5, gap: 3, w: 2.8, amp: 1.4, speed: 1.9 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 6, name: 'Conveyor Chaos', speed: 1.05,
    tip: 'Silver belts push you around. Jump off the fast ones!',
    segments: [
      { t: 'run', len: 12 },
      { t: 'conveyor', len: 12, dir: 1 },
      { t: 'gap', len: 4 },
      { t: 'run', len: 8 },
      { t: 'conveyor', len: 10, dir: -1 },
      { t: 'run', len: 6 },
      { t: 'checkpoint' },
      { t: 'gap', len: 3 },
      { t: 'conveyor', len: 10, dir: 1 },
      { t: 'gap', len: 4.5 },
      { t: 'run', len: 10 },
      { t: 'steps', n: 3, len: 4.5, gap: 3 },
      { t: 'run', len: 6 },
      { t: 'checkpoint' },
      { t: 'conveyor', len: 8, dir: -1 },
      { t: 'gap', len: 3 },
      { t: 'conveyor', len: 8, dir: 1 },
      { t: 'gap', len: 4.5 },
      { t: 'narrow', len: 10, w: 2.6 },
      { t: 'conveyor', len: 8, dir: 1 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 7, name: 'Split Ends', speed: 1.05,
    tip: 'The track splits — one lane each! The cord stretches over the middle.',
    segments: [
      { t: 'run', len: 12 },
      { t: 'split', len: 6, sep: 5, w: 2.6 },
      { t: 'lanes', len: 14, sep: 5, w: 2.6 },
      { t: 'merge', len: 5, sep: 5, w: 2.6 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'split', len: 5, sep: 6, w: 2.4 },
      { t: 'lanes', len: 12, sep: 6, w: 2.4 },
      { t: 'merge', len: 5, sep: 6, w: 2.4 },
      { t: 'gap', len: 3.5 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'split', len: 5, sep: 6.5, w: 2.3 },
      { t: 'lanes', len: 14, sep: 6.5, w: 2.3 },
      { t: 'merge', len: 5, sep: 6.5, w: 2.3 },
      { t: 'run', len: 6 },
      { t: 'gap', len: 4 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 8, name: 'Anchor Buddy', speed: 1.05,
    tip: 'If your buddy falls, stay on solid ground — the cord swings them back!',
    segments: [
      { t: 'run', len: 12 },
      { t: 'narrow', len: 10, w: 2.2 },
      { t: 'steps', n: 3, len: 4.5, gap: 3.5, w: 2.6 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'narrow', len: 12, w: 1.9 },
      { t: 'gap', len: 4 },
      { t: 'steps', n: 4, len: 4, gap: 3, w: 2.4 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'narrow', len: 10, w: 1.8 },
      { t: 'gap', len: 4.5 },
      { t: 'narrow', len: 10, w: 2 },
      { t: 'steps', n: 3, len: 4, gap: 3.5, w: 2.2 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 9, name: 'Gear Alley', speed: 1.05,
    tip: 'Dodge the spinning gears — they knock you flat!',
    segments: [
      { t: 'run', len: 12 },
      { t: 'gears', len: 14, side: 'alt' },
      { t: 'gap', len: 3 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'gears', len: 12, side: 'center' },
      { t: 'gap', len: 3.5 },
      { t: 'run', len: 6 },
      { t: 'gears', len: 12, side: 'alt' },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'steps', n: 3, len: 4.5, gap: 3 },
      { t: 'gears', len: 14, side: 'alt' },
      { t: 'gap', len: 4 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 10, name: 'Speed Run', speed: 1.2,
    tip: 'Faster now! Short hops, quick feet.',
    segments: [
      { t: 'run', len: 16 },
      { t: 'gap', len: 4 },
      { t: 'narrow', len: 12, w: 2.6 },
      { t: 'gap', len: 4.5 },
      { t: 'run', len: 10 },
      { t: 'checkpoint' },
      { t: 'steps', n: 4, len: 5, gap: 3.5 },
      { t: 'conveyor', len: 10, dir: 1 },
      { t: 'gap', len: 5 },
      { t: 'run', len: 10 },
      { t: 'checkpoint' },
      { t: 'narrow', len: 12, w: 2.4 },
      { t: 'gap', len: 5 },
      { t: 'run', len: 8 },
      { t: 'steps', n: 4, len: 4.5, gap: 3.5 },
      { t: 'gap', len: 5 },
      { t: 'run', len: 14 }
    ]
  },
  {
    id: 11, name: 'Divided', speed: 1.1,
    tip: 'A wall between you — pick your sides before it starts!',
    segments: [
      { t: 'run', len: 14 },
      { t: 'divider', len: 12 },
      { t: 'run', len: 8 },
      { t: 'gate', openings: [{ c: -2, w: 1.7 }, { c: 2, w: 1.7 }] },
      { t: 'divider', len: 10 },
      { t: 'run', len: 6 },
      { t: 'checkpoint' },
      { t: 'split', len: 5, sep: 5.5, w: 2.4 },
      { t: 'lanes', len: 10, sep: 5.5, w: 2.4 },
      { t: 'merge', len: 5, sep: 5.5, w: 2.4 },
      { t: 'narrow', len: 8, w: 2.4 },
      { t: 'run', len: 6 },
      { t: 'checkpoint' },
      { t: 'divider', len: 14 },
      { t: 'gap', len: 3.5 },
      { t: 'gate', openings: [{ c: -2.1, w: 1.6 }, { c: 2.1, w: 1.6 }] },
      { t: 'divider', len: 10 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 12, name: 'Slalom Storm', speed: 1.1,
    tip: 'Weave side to side — swing the cord with you!',
    segments: [
      { t: 'run', len: 12 },
      { t: 'slalom', n: 5, len: 5, gap: 2.5, off: 1.8, w: 2.8 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'moving', n: 3, len: 4.5, gap: 3, w: 2.8, amp: 1.5, speed: 1.7 },
      { t: 'run', len: 8 },
      { t: 'slalom', n: 4, len: 4.5, gap: 3, off: 2, w: 2.6 },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'slalom', n: 5, len: 4, gap: 3, off: 2.1, w: 2.4 },
      { t: 'gap', len: 4 },
      { t: 'moving', n: 2, len: 4.5, gap: 3, w: 2.6, amp: 1.6, speed: 1.9 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 13, name: 'Launch Party', speed: 1.1,
    tip: 'Pink pads bounce you sky-high — launch over the big gaps!',
    segments: [
      { t: 'run', len: 12 },
      { t: 'pads', len: 6 },
      { t: 'gap', len: 6 },
      { t: 'run', len: 10 },
      { t: 'checkpoint' },
      { t: 'pads', len: 6 },
      { t: 'gap', len: 7 },
      { t: 'narrow', len: 10, w: 2.6 },
      { t: 'run', len: 6 },
      { t: 'checkpoint' },
      { t: 'pads', len: 5 },
      { t: 'gap', len: 7 },
      { t: 'steps', n: 3, len: 4.5, gap: 3 },
      { t: 'pads', len: 5 },
      { t: 'gap', len: 6.5 },
      { t: 'moving', n: 2, len: 4.5, gap: 3, w: 2.8, amp: 1.3, speed: 1.6 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 14, name: 'Tangle Factory', speed: 1.15,
    tip: 'Gears, gates and splits — keep that cord out of trouble!',
    segments: [
      { t: 'run', len: 12 },
      { t: 'gears', len: 12, side: 'alt' },
      { t: 'gate', openings: [{ c: -1.9, w: 1.7 }, { c: 1.9, w: 1.7 }] },
      { t: 'run', len: 8 },
      { t: 'checkpoint' },
      { t: 'split', len: 5, sep: 5.5, w: 2.4 },
      { t: 'lanes', len: 12, sep: 5.5, w: 2.4 },
      { t: 'merge', len: 5, sep: 5.5, w: 2.4 },
      { t: 'gears', len: 12, side: 'center' },
      { t: 'run', len: 6 },
      { t: 'checkpoint' },
      { t: 'moving', n: 3, len: 4.5, gap: 3, w: 2.8, amp: 1.4, speed: 1.6 },
      { t: 'run', len: 6 },
      { t: 'divider', len: 12 },
      { t: 'gate', openings: [{ c: -2, w: 1.7 }, { c: 2, w: 1.7 }] },
      { t: 'gears', len: 10, side: 'alt' },
      { t: 'gap', len: 4 },
      { t: 'run', len: 12 }
    ]
  },
  {
    id: 15, name: 'The Gauntlet', speed: 1.25,
    tip: 'Everything at once. You two have got this!',
    segments: [
      { t: 'run', len: 14 },
      { t: 'conveyor', len: 10, dir: 1 },
      { t: 'gap', len: 5 },
      { t: 'narrow', len: 10, w: 2.4 },
      { t: 'gate', openings: [{ c: -2, w: 1.7 }, { c: 2, w: 1.7 }] },
      { t: 'run', len: 6 },
      { t: 'checkpoint' },
      { t: 'gears', len: 12, side: 'alt' },
      { t: 'split', len: 5, sep: 6, w: 2.3 },
      { t: 'lanes', len: 12, sep: 6, w: 2.3 },
      { t: 'merge', len: 5, sep: 6, w: 2.3 },
      { t: 'run', len: 6 },
      { t: 'checkpoint' },
      { t: 'pads', len: 5 },
      { t: 'gap', len: 7 },
      { t: 'moving', n: 3, len: 4.5, gap: 3.2, w: 2.7, amp: 1.5, speed: 1.8 },
      { t: 'run', len: 6 },
      { t: 'checkpoint' },
      { t: 'divider', len: 12 },
      { t: 'gears', len: 10, side: 'center' },
      { t: 'steps', n: 3, len: 4.5, gap: 3.5, w: 2.6 },
      { t: 'gap', len: 5 },
      { t: 'slalom', n: 4, len: 4, gap: 3, off: 1.9, w: 2.5 },
      { t: 'run', len: 14 }
    ]
  }
];
