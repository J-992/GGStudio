// Room decorations earned as level rewards. Every decoration has its own dedicated
// spot in the room (base 960x640) so a fully decorated room never overlaps.
// origin: 'bottom' = sits on a surface (desk/stool/floor), 'center' = hangs on the wall.
const DECORATIONS = {
  // Desk surface (top edge y=352, spans x300-660).
  flower_vase:   { label: 'Flower Vase',    x: 318, y: 352, origin: 'bottom' },
  plush_bunny:   { label: 'Plush Bunny',    x: 400, y: 352, origin: 'bottom' },
  jewelry_stand: { label: 'Jewelry Stand',  x: 552, y: 352, origin: 'bottom' },
  candle:        { label: 'Cozy Candle',    x: 628, y: 352, origin: 'bottom' },

  // Stool seat.
  perfume_tray:  { label: 'Perfume Tray',   x: 760, y: 458, origin: 'bottom' },

  // Left wall column.
  wall_clock:    { label: 'Kitty Clock',    x: 150, y: 62,  origin: 'center' },
  wall_art:      { label: 'Wall Art',       x: 150, y: 172, origin: 'center' },
  mirror_round:  { label: 'Round Mirror',   x: 152, y: 292, origin: 'center' },

  // Wall between mirror and window.
  wall_shelf:    { label: 'Wall Shelf',     x: 692, y: 158, origin: 'center' },

  // Garlands along the ceiling.
  string_lights: { label: 'String Lights',  x: 480, y: 40,  origin: 'center' },
  bow_banner:    { label: 'Bow Banner',     x: 480, y: 90,  origin: 'center' },

  // Floor.
  lamp:          { label: 'Mushroom Lamp',  x: 150, y: 618, origin: 'bottom' },
  rug:           { label: 'Fluffy Rug',     x: 480, y: 590, origin: 'bottom', depth: 2 },
  basket:        { label: 'Cute Basket',    x: 825, y: 628, origin: 'bottom' },
  plant:         { label: 'Leafy Plant',    x: 908, y: 602, origin: 'bottom' }
};
