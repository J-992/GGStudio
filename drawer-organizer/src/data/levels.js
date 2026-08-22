// Level configs. New levels are pure data: containers (with auto-grid slots) + item list + reward.
// Containers: x/y is center, accepts lists categories, grid lays slots out automatically.
// Items: key + count, scattered in the messy drawer zone at the top of the screen.
const LEVELS = [
  {
    id: 1,
    name: 'First Tidy',
    containers: [
      { x: 265, y: 468, w: 320, h: 210, tint: 0xffd3e0, label: 'Lipsticks', accepts: ['lipstick'], grid: { cols: 3, rows: 1 } },
      { x: 660, y: 468, w: 320, h: 210, tint: 0xcdeedd, label: 'Brushes',   accepts: ['brush'],    grid: { cols: 3, rows: 1 } }
    ],
    items: [ { key: 'lipstick', count: 3 }, { key: 'brush', count: 3 } ],
    reward: { options: ['flower_vase', 'plush_bunny', 'candle'] }
  },
  {
    id: 2,
    name: 'Makeup Mix',
    containers: [
      { x: 205, y: 470, w: 250, h: 200, tint: 0xffd3e0, label: 'Lipsticks', accepts: ['lipstick'], grid: { cols: 2, rows: 1 } },
      { x: 480, y: 470, w: 250, h: 200, tint: 0xe3d8f7, label: 'Mascara',   accepts: ['mascara'],  grid: { cols: 2, rows: 1 } },
      { x: 755, y: 470, w: 250, h: 200, tint: 0xfdf0c2, label: 'Palettes & Brushes', accepts: ['palette', 'brush'], grid: { cols: 2, rows: 2 } }
    ],
    items: [ { key: 'lipstick', count: 2 }, { key: 'mascara', count: 2 }, { key: 'palette', count: 2 }, { key: 'brush', count: 2 } ],
    reward: { options: ['wall_art', 'mirror_round', 'wall_shelf'] }
  },
  {
    id: 3,
    name: 'Polish Parlor',
    containers: [
      { x: 250, y: 468, w: 340, h: 200, tint: 0xffe0cc, label: 'Nail Polish', accepts: ['polish'],  grid: { cols: 5, rows: 1 } },
      { x: 665, y: 468, w: 380, h: 200, tint: 0xcfe8f7, label: 'Makeup Tray', accepts: ['compact', 'sponge'], grid: { cols: 4, rows: 1 } }
    ],
    items: [ { key: 'polish', count: 5 }, { key: 'compact', count: 2 }, { key: 'sponge', count: 2 } ],
    reward: { options: ['plant', 'rug', 'basket'] }
  },
  {
    id: 4,
    name: 'Shelf Care',
    containers: [
      { x: 210, y: 465, w: 260, h: 205, tint: 0xcdeedd, label: 'Skincare',  accepts: ['skincare'], grid: { cols: 3, rows: 1 } },
      { x: 480, y: 465, w: 220, h: 205, tint: 0xf7f7f7, label: 'Cotton Jar', accepts: ['cotton'],  grid: { cols: 1, rows: 3 } },
      { x: 755, y: 465, w: 280, h: 205, tint: 0xffd3e0, label: 'Cosmetics', accepts: ['lipstick', 'mascara'], grid: { cols: 4, rows: 1 } }
    ],
    items: [ { key: 'skincare', count: 3 }, { key: 'cotton', count: 3 }, { key: 'lipstick', count: 2 }, { key: 'mascara', count: 2 } ],
    reward: { options: ['lamp', 'jewelry_stand', 'perfume_tray'] }
  },
  {
    id: 5,
    name: 'Vanity Deluxe',
    containers: [
      { x: 155, y: 462, w: 210, h: 200, tint: 0xe3d8f7, label: 'Jewelry',  accepts: ['jewelry'],  grid: { cols: 2, rows: 2 } },
      { x: 375, y: 462, w: 180, h: 200, tint: 0xfdf0c2, label: 'Perfume',  accepts: ['perfume'],  grid: { cols: 2, rows: 1 } },
      { x: 585, y: 462, w: 190, h: 200, tint: 0xffe0cc, label: 'Clips',    accepts: ['hairclip'], grid: { cols: 2, rows: 2 } },
      { x: 810, y: 462, w: 220, h: 200, tint: 0xcdeedd, label: 'Brushes & Lips', accepts: ['brush', 'lipstick'], grid: { cols: 2, rows: 2 } }
    ],
    items: [
      { key: 'jewelry', count: 3 }, { key: 'perfume', count: 2 }, { key: 'hairclip', count: 3 },
      { key: 'brush', count: 2 }, { key: 'lipstick', count: 2 }
    ],
    reward: { options: ['string_lights', 'bow_banner', 'wall_clock'] }
  },
  {
    id: 6,
    name: 'Precision Pouch',
    containers: [
      { x: 205, y: 468, w: 250, h: 205, tint: 0xe3d8f7, label: 'Eyeliners',  accepts: ['eyeliner'], grid: { cols: 3, rows: 1 } },
      { x: 480, y: 468, w: 250, h: 205, tint: 0xffe0cc, label: 'Nail Files', accepts: ['nailfile'], grid: { cols: 3, rows: 1 } },
      { x: 755, y: 468, w: 250, h: 205, tint: 0xffd3e0, label: 'Polish & Lips', accepts: ['polish', 'lipstick'], grid: { cols: 2, rows: 2 } }
    ],
    items: [ { key: 'eyeliner', count: 3 }, { key: 'nailfile', count: 3 }, { key: 'polish', count: 2 }, { key: 'lipstick', count: 2 } ],
    reward: { options: ['candle', 'wall_shelf', 'basket'] }
  },
  {
    id: 7,
    name: 'Hair Flair',
    containers: [
      { x: 190, y: 468, w: 230, h: 205, tint: 0xf5d9e8, label: 'Scrunchies', accepts: ['scrunchie'], grid: { cols: 2, rows: 2 } },
      { x: 445, y: 468, w: 230, h: 205, tint: 0xfdf0c2, label: 'Hair Clips', accepts: ['hairclip'],  grid: { cols: 2, rows: 2 } },
      { x: 725, y: 468, w: 300, h: 205, tint: 0xcdeedd, label: 'Brushes & Sponges', accepts: ['brush', 'sponge'], grid: { cols: 2, rows: 2 } }
    ],
    items: [ { key: 'scrunchie', count: 4 }, { key: 'hairclip', count: 3 }, { key: 'brush', count: 2 }, { key: 'sponge', count: 2 } ],
    reward: { options: ['plush_bunny', 'mirror_round', 'plant'] }
  },
  {
    id: 8,
    name: 'Tiny Tools',
    containers: [
      { x: 150, y: 465, w: 200, h: 200, tint: 0xe3d8f7, label: 'Tweezers', accepts: ['tweezers'], grid: { cols: 3, rows: 1 } },
      { x: 370, y: 465, w: 200, h: 200, tint: 0xf7f7f7, label: 'Cotton',   accepts: ['cotton'],   grid: { cols: 1, rows: 3 } },
      { x: 590, y: 465, w: 200, h: 200, tint: 0xcfe8f7, label: 'Compacts', accepts: ['compact'],  grid: { cols: 1, rows: 2 } },
      { x: 815, y: 465, w: 230, h: 200, tint: 0xffd3e0, label: 'Eye Makeup', accepts: ['mascara', 'eyeliner'], grid: { cols: 4, rows: 1 } }
    ],
    items: [
      { key: 'tweezers', count: 3 }, { key: 'cotton', count: 3 }, { key: 'compact', count: 2 },
      { key: 'mascara', count: 2 }, { key: 'eyeliner', count: 2 }
    ],
    reward: { options: ['flower_vase', 'wall_art', 'rug'] }
  },
  {
    id: 9,
    name: 'Glam Night',
    containers: [
      { x: 160, y: 462, w: 220, h: 200, tint: 0xfdf0c2, label: 'Perfume', accepts: ['perfume'],  grid: { cols: 2, rows: 1 } },
      { x: 385, y: 462, w: 200, h: 200, tint: 0xe3d8f7, label: 'Jewelry', accepts: ['jewelry'],  grid: { cols: 2, rows: 2 } },
      { x: 600, y: 462, w: 190, h: 200, tint: 0xffe0cc, label: 'Polish',  accepts: ['polish'],   grid: { cols: 3, rows: 1 } },
      { x: 815, y: 462, w: 220, h: 200, tint: 0xffd3e0, label: 'Lips & Liner', accepts: ['lipstick', 'eyeliner'], grid: { cols: 2, rows: 2 } }
    ],
    items: [
      { key: 'perfume', count: 2 }, { key: 'jewelry', count: 4 }, { key: 'polish', count: 3 },
      { key: 'lipstick', count: 2 }, { key: 'eyeliner', count: 2 }
    ],
    reward: { options: ['lamp', 'string_lights', 'wall_clock'] }
  },
  {
    id: 10,
    name: 'Grand Vanity',
    containers: [
      { x: 108, y: 462, w: 175, h: 200, tint: 0xffd3e0, label: 'Makeup',    accepts: ['lipstick', 'mascara'],  grid: { cols: 2, rows: 2 } },
      { x: 296, y: 462, w: 175, h: 200, tint: 0xe3d8f7, label: 'Liner Kit', accepts: ['eyeliner', 'tweezers'], grid: { cols: 2, rows: 2 } },
      { x: 480, y: 462, w: 175, h: 200, tint: 0xfdf0c2, label: 'Hair',      accepts: ['scrunchie', 'hairclip'],grid: { cols: 2, rows: 2 } },
      { x: 664, y: 462, w: 175, h: 200, tint: 0xffe0cc, label: 'Nails',     accepts: ['polish', 'nailfile'],   grid: { cols: 2, rows: 2 } },
      { x: 852, y: 462, w: 175, h: 200, tint: 0xcdeedd, label: 'Treasures', accepts: ['jewelry', 'perfume'],   grid: { cols: 2, rows: 2 } }
    ],
    items: [
      { key: 'lipstick', count: 2 }, { key: 'mascara', count: 1 },
      { key: 'eyeliner', count: 2 }, { key: 'tweezers', count: 1 },
      { key: 'scrunchie', count: 2 }, { key: 'hairclip', count: 1 },
      { key: 'polish', count: 2 }, { key: 'nailfile', count: 1 },
      { key: 'jewelry', count: 2 }, { key: 'perfume', count: 1 }
    ],
    reward: { options: ['jewelry_stand', 'perfume_tray', 'bow_banner'] }
  },
  {
    id: 11,
    name: 'Brush Hour',
    containers: [
      { x: 205, y: 468, w: 250, h: 205, tint: 0xcdeedd, label: 'Brushes',  accepts: ['brush'],  grid: { cols: 3, rows: 1 } },
      { x: 480, y: 468, w: 250, h: 205, tint: 0xcfe8f7, label: 'Sponges',  accepts: ['sponge'], grid: { cols: 2, rows: 2 } },
      { x: 755, y: 468, w: 250, h: 205, tint: 0xfdf0c2, label: 'Face Kit', accepts: ['compact', 'palette'], grid: { cols: 2, rows: 2 } }
    ],
    items: [ { key: 'brush', count: 3 }, { key: 'sponge', count: 4 }, { key: 'compact', count: 2 }, { key: 'palette', count: 2 } ],
    reward: { options: ['candle', 'rug', 'string_lights'] }
  },
  {
    id: 12,
    name: 'Line & Define',
    containers: [
      { x: 185, y: 468, w: 280, h: 205, tint: 0xe3d8f7, label: 'Eyeliners', accepts: ['eyeliner'], grid: { cols: 4, rows: 1 } },
      { x: 455, y: 468, w: 230, h: 205, tint: 0xffd3e0, label: 'Mascara',   accepts: ['mascara'],  grid: { cols: 3, rows: 1 } },
      { x: 725, y: 468, w: 250, h: 205, tint: 0xf7f7f7, label: 'Tweezers & Pads', accepts: ['tweezers', 'cotton'], grid: { cols: 2, rows: 2 } }
    ],
    items: [ { key: 'eyeliner', count: 4 }, { key: 'mascara', count: 3 }, { key: 'tweezers', count: 2 }, { key: 'cotton', count: 2 } ],
    reward: { options: ['wall_art', 'lamp', 'basket'] }
  },
  {
    id: 13,
    name: 'Scent & Shine',
    containers: [
      { x: 155, y: 465, w: 250, h: 200, tint: 0xfdf0c2, label: 'Perfume',    accepts: ['perfume'],  grid: { cols: 3, rows: 1 } },
      { x: 420, y: 465, w: 230, h: 200, tint: 0xcdeedd, label: 'Skincare',   accepts: ['skincare'], grid: { cols: 3, rows: 1 } },
      { x: 655, y: 465, w: 190, h: 200, tint: 0xe3d8f7, label: 'Jewelry',    accepts: ['jewelry'],  grid: { cols: 2, rows: 2 } },
      { x: 855, y: 465, w: 160, h: 200, tint: 0xf7f7f7, label: 'Cotton Jar', accepts: ['cotton'],   grid: { cols: 1, rows: 2 } }
    ],
    items: [ { key: 'perfume', count: 3 }, { key: 'skincare', count: 3 }, { key: 'jewelry', count: 4 }, { key: 'cotton', count: 2 } ],
    reward: { options: ['mirror_round', 'plant', 'wall_clock'] }
  },
  {
    id: 14,
    name: 'Clip & Curl',
    containers: [
      { x: 160, y: 465, w: 210, h: 200, tint: 0xf5d9e8, label: 'Scrunchies', accepts: ['scrunchie'], grid: { cols: 2, rows: 2 } },
      { x: 370, y: 465, w: 160, h: 200, tint: 0xfdf0c2, label: 'Hair Clips', accepts: ['hairclip'],  grid: { cols: 1, rows: 3 } },
      { x: 585, y: 465, w: 220, h: 200, tint: 0xcdeedd, label: 'Brushes',    accepts: ['brush'],     grid: { cols: 3, rows: 1 } },
      { x: 805, y: 465, w: 170, h: 200, tint: 0xffe0cc, label: 'Nail Files', accepts: ['nailfile'],  grid: { cols: 2, rows: 1 } }
    ],
    items: [ { key: 'scrunchie', count: 4 }, { key: 'hairclip', count: 3 }, { key: 'brush', count: 3 }, { key: 'nailfile', count: 2 } ],
    reward: { options: ['bow_banner', 'plush_bunny', 'wall_shelf'] }
  },
  {
    id: 15,
    name: 'Polish Party',
    containers: [
      { x: 182, y: 465, w: 300, h: 200, tint: 0xffe0cc, label: 'Nail Polish', accepts: ['polish'],   grid: { cols: 5, rows: 1 } },
      { x: 447, y: 465, w: 180, h: 200, tint: 0xe3d8f7, label: 'Nail Files',  accepts: ['nailfile'], grid: { cols: 3, rows: 1 } },
      { x: 632, y: 465, w: 140, h: 200, tint: 0xf7f7f7, label: 'Cotton',      accepts: ['cotton'],   grid: { cols: 1, rows: 2 } },
      { x: 827, y: 465, w: 200, h: 200, tint: 0xcfe8f7, label: 'Sponges',     accepts: ['sponge'],   grid: { cols: 3, rows: 1 } }
    ],
    items: [ { key: 'polish', count: 5 }, { key: 'nailfile', count: 3 }, { key: 'cotton', count: 2 }, { key: 'sponge', count: 3 } ],
    reward: { options: ['flower_vase', 'perfume_tray', 'candle'] }
  },
  {
    id: 16,
    name: 'Beauty Bar',
    containers: [
      { x: 110, y: 465, w: 170, h: 200, tint: 0xffd3e0, label: 'Lipsticks', accepts: ['lipstick'], grid: { cols: 2, rows: 2 } },
      { x: 340, y: 465, w: 250, h: 200, tint: 0xfdf0c2, label: 'Palettes',  accepts: ['palette'],  grid: { cols: 2, rows: 1 } },
      { x: 610, y: 465, w: 250, h: 200, tint: 0xcfe8f7, label: 'Compacts',  accepts: ['compact'],  grid: { cols: 3, rows: 1 } },
      { x: 845, y: 465, w: 180, h: 200, tint: 0xe3d8f7, label: 'Perfume',   accepts: ['perfume'],  grid: { cols: 2, rows: 2 } }
    ],
    items: [ { key: 'lipstick', count: 4 }, { key: 'palette', count: 2 }, { key: 'compact', count: 3 }, { key: 'perfume', count: 4 } ],
    reward: { options: ['jewelry_stand', 'wall_art', 'rug'] }
  },
  {
    id: 17,
    name: 'Morning Routine',
    containers: [
      { x: 108, y: 462, w: 175, h: 200, tint: 0xcdeedd, label: 'Skincare', accepts: ['skincare'], grid: { cols: 2, rows: 2 } },
      { x: 296, y: 462, w: 175, h: 200, tint: 0xf7f7f7, label: 'Cotton',   accepts: ['cotton'],   grid: { cols: 1, rows: 3 } },
      { x: 480, y: 462, w: 175, h: 200, tint: 0xcfe8f7, label: 'Sponges',  accepts: ['sponge'],   grid: { cols: 2, rows: 2 } },
      { x: 664, y: 462, w: 175, h: 200, tint: 0xffe0cc, label: 'Brushes',  accepts: ['brush'],    grid: { cols: 2, rows: 2 } },
      { x: 852, y: 462, w: 175, h: 200, tint: 0xfdf0c2, label: 'Clips',    accepts: ['hairclip'], grid: { cols: 2, rows: 1 } }
    ],
    items: [
      { key: 'skincare', count: 3 }, { key: 'cotton', count: 3 }, { key: 'sponge', count: 3 },
      { key: 'brush', count: 3 }, { key: 'hairclip', count: 2 }
    ],
    reward: { options: ['string_lights', 'mirror_round', 'lamp'] }
  },
  {
    id: 18,
    name: 'Sparkle Stash',
    containers: [
      { x: 108, y: 462, w: 175, h: 200, tint: 0xe3d8f7, label: 'Jewelry',  accepts: ['jewelry'],  grid: { cols: 2, rows: 2 } },
      { x: 296, y: 462, w: 175, h: 200, tint: 0xfdf0c2, label: 'Perfume',  accepts: ['perfume'],  grid: { cols: 2, rows: 1 } },
      { x: 480, y: 462, w: 175, h: 200, tint: 0xffe0cc, label: 'Polish',   accepts: ['polish'],   grid: { cols: 2, rows: 2 } },
      { x: 664, y: 462, w: 175, h: 200, tint: 0xf5d9e8, label: 'Liners',   accepts: ['eyeliner'], grid: { cols: 2, rows: 2 } },
      { x: 852, y: 462, w: 175, h: 200, tint: 0xf7f7f7, label: 'Tweezers', accepts: ['tweezers'], grid: { cols: 2, rows: 1 } }
    ],
    items: [
      { key: 'jewelry', count: 4 }, { key: 'perfume', count: 2 }, { key: 'polish', count: 3 },
      { key: 'eyeliner', count: 3 }, { key: 'tweezers', count: 2 }
    ],
    reward: { options: ['wall_clock', 'basket', 'bow_banner'] }
  },
  {
    id: 19,
    name: 'Full Kit',
    containers: [
      { x: 108, y: 462, w: 175, h: 200, tint: 0xffd3e0, label: 'Lips & Lash', accepts: ['lipstick', 'mascara'],  grid: { cols: 2, rows: 2 } },
      { x: 296, y: 462, w: 175, h: 200, tint: 0xfdf0c2, label: 'Palettes',    accepts: ['palette'],              grid: { cols: 2, rows: 1 } },
      { x: 480, y: 462, w: 175, h: 200, tint: 0xf5d9e8, label: 'Hair',        accepts: ['scrunchie', 'hairclip'],grid: { cols: 2, rows: 2 } },
      { x: 664, y: 462, w: 175, h: 200, tint: 0xe3d8f7, label: 'Precision',   accepts: ['nailfile', 'eyeliner'], grid: { cols: 2, rows: 2 } },
      { x: 852, y: 462, w: 175, h: 200, tint: 0xcfe8f7, label: 'Face',        accepts: ['compact', 'sponge'],    grid: { cols: 2, rows: 2 } }
    ],
    items: [
      { key: 'lipstick', count: 2 }, { key: 'mascara', count: 2 }, { key: 'palette', count: 2 },
      { key: 'scrunchie', count: 2 }, { key: 'hairclip', count: 1 },
      { key: 'nailfile', count: 2 }, { key: 'eyeliner', count: 1 },
      { key: 'compact', count: 2 }, { key: 'sponge', count: 1 }
    ],
    reward: { options: ['plush_bunny', 'plant', 'wall_shelf'] }
  },
  {
    id: 20,
    name: 'Ultimate Vanity',
    containers: [
      { x: 108, y: 462, w: 175, h: 200, tint: 0xffd3e0, label: 'Makeup',    accepts: ['lipstick', 'mascara', 'eyeliner'], grid: { cols: 2, rows: 2 } },
      { x: 296, y: 462, w: 175, h: 200, tint: 0xffe0cc, label: 'Nails',     accepts: ['polish', 'nailfile'],              grid: { cols: 2, rows: 2 } },
      { x: 480, y: 462, w: 175, h: 200, tint: 0xf5d9e8, label: 'Hair',      accepts: ['brush', 'scrunchie', 'hairclip'],  grid: { cols: 2, rows: 2 } },
      { x: 664, y: 462, w: 175, h: 200, tint: 0xcfe8f7, label: 'Face',      accepts: ['compact', 'palette', 'sponge'],    grid: { cols: 2, rows: 2 } },
      { x: 852, y: 462, w: 175, h: 200, tint: 0xcdeedd, label: 'Treasures', accepts: ['jewelry', 'perfume', 'skincare'],  grid: { cols: 2, rows: 2 } }
    ],
    items: [
      { key: 'lipstick', count: 2 }, { key: 'mascara', count: 1 }, { key: 'eyeliner', count: 1 },
      { key: 'polish', count: 2 }, { key: 'nailfile', count: 1 },
      { key: 'brush', count: 1 }, { key: 'scrunchie', count: 1 }, { key: 'hairclip', count: 1 },
      { key: 'compact', count: 1 }, { key: 'palette', count: 1 }, { key: 'sponge', count: 1 },
      { key: 'jewelry', count: 1 }, { key: 'perfume', count: 1 }, { key: 'skincare', count: 1 }
    ],
    reward: { options: ['flower_vase', 'jewelry_stand', 'perfume_tray'] }
  }
];
