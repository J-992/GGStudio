// Item catalogue. Each entry maps to a procedurally generated texture (TextureFactory)
// which can later be swapped for Meshy-rendered sprites of the same key.
const ITEM_DEFS = {
  lipstick:  { category: 'lipstick',  label: 'Lipstick',   w: 36,  h: 88  },
  mascara:   { category: 'mascara',   label: 'Mascara',    w: 26,  h: 96  },
  brush:     { category: 'brush',     label: 'Brush',      w: 30,  h: 104 },
  palette:   { category: 'palette',   label: 'Palette',    w: 104, h: 76  },
  polish:    { category: 'polish',    label: 'Nail Polish',w: 44,  h: 82  },
  compact:   { category: 'compact',   label: 'Compact',    w: 78,  h: 78  },
  perfume:   { category: 'perfume',   label: 'Perfume',    w: 66,  h: 92  },
  sponge:    { category: 'sponge',    label: 'Sponge',     w: 54,  h: 66  },
  hairclip:  { category: 'hairclip',  label: 'Hair Clip',  w: 68,  h: 46  },
  skincare:  { category: 'skincare',  label: 'Skincare',   w: 48,  h: 96  },
  cotton:    { category: 'cotton',    label: 'Cotton Pads',w: 66,  h: 40  },
  jewelry:   { category: 'jewelry',   label: 'Jewelry',    w: 50,  h: 50  },
  eyeliner:  { category: 'eyeliner',  label: 'Eyeliner',   w: 24,  h: 100 },
  nailfile:  { category: 'nailfile',  label: 'Nail File',  w: 28,  h: 96  },
  scrunchie: { category: 'scrunchie', label: 'Scrunchie',  w: 62,  h: 62  },
  tweezers:  { category: 'tweezers',  label: 'Tweezers',   w: 30,  h: 92  }
};
