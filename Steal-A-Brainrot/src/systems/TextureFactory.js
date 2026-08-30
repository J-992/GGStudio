// Generates every texture at boot from Graphics — no image files to load.
// Each creature has its own drawing routine in BODIES, keyed by its `art`
// field, so the silhouettes are actually recognisable. Final rendered sprites
// (see ASSET_PROMPTS.md) can replace these by loading images under the same
// keys (`cr_<id>`); no gameplay code changes.
const TextureFactory = {
  CW: 88,          // creature canvas
  CH: 88,
  CX: 44,          // creature centre x
  GROUND: 86,      // feet line (sprites use origin 0.5, 1)

  generateAll(scene) {
    CREATURES.forEach((def) => this.creature(scene, def));
    this.monsters(scene);
    this.props(scene);
  },

  _g(scene) { return scene.make.graphics({ x: 0, y: 0, add: false }); },

  // Rendered sprites arrive at whatever resolution the render tool used, while
  // the game lays everything out in world px. Every display of a swappable
  // texture multiplies by this so a 352px render and an 88px placeholder
  // occupy exactly the same space.
  scaleFor(scene, key, logicalH) {
    const tex = scene.textures.exists(key) ? scene.textures.get(key) : null;
    const src = tex && tex.getSourceImage ? tex.getSourceImage() : null;
    return src && src.height ? logicalH / src.height : 1;
  },

  shade(color, f) {
    const c = Phaser.Display.Color.IntegerToColor(color);
    const r = Math.max(0, Math.min(255, Math.floor(c.red * f)));
    const gr = Math.max(0, Math.min(255, Math.floor(c.green * f)));
    const b = Math.max(0, Math.min(255, Math.floor(c.blue * f)));
    return Phaser.Display.Color.GetColor(r, gr, b);
  },

  creature(scene, def) {
    const g = this._g(scene);
    const draw = this.BODIES[def.art] || this.BODIES.boneca;
    draw.call(this, g, def);
    g.generateTexture('cr_' + def.id, this.CW, this.CH);
    g.destroy();
  },

  // The horde. Same contract as creature(): a flat stand-in living under the
  // real render's texture key, so an empty assets/ folder still boots a
  // playable game. Keyed by ENEMIES[..].art, which is also the sprite name.
  monsters(scene) {
    [...Object.values(ENEMIES), ...Object.values(BOSSES)]
      .forEach((def) => this.monster(scene, def));
  },

  monster(scene, def) {
    const draw = this.MONSTERS[def.art];
    if (!draw) return;
    const g = this._g(scene);
    draw.call(this, g);
    g.generateTexture(def.art, this.CW, this.CH);
    g.destroy();
  },

  // ---------------------------------------------------------------- helpers
  _blob(g, x, y, w, h, color, outline) {
    g.lineStyle(4, outline !== undefined ? outline : this.shade(color, 0.55), 1);
    g.fillStyle(color, 1);
    g.fillEllipse(x, y, w, h);
    g.strokeEllipse(x, y, w, h);
  },

  _box(g, x, y, w, h, r, color, outline) {
    g.lineStyle(4, outline !== undefined ? outline : this.shade(color, 0.55), 1);
    g.fillStyle(color, 1);
    g.fillRoundedRect(x, y, w, h, r);
    g.strokeRoundedRect(x, y, w, h, r);
  },

  // one cartoon eyeball; px/py nudge the pupil for expression
  _eye(g, x, y, r, px, py) {
    g.fillStyle(0xffffff, 1); g.lineStyle(2, 0x111111, 1);
    g.fillEllipse(x, y, r * 2, r * 2); g.strokeEllipse(x, y, r * 2, r * 2);
    g.fillStyle(0x111111, 1);
    g.fillEllipse(x + (px || 0), y + (py || 0), r * 0.85, r * 0.85);
  },

  _eyes(g, cx, y, sep, r, mood) {
    const nudge = mood === 'derp' ? [1, -1] : [0, 0];
    this._eye(g, cx - sep, y, r, nudge[0], mood === 'derp' ? -1 : 1);
    this._eye(g, cx + sep, y, r, nudge[1], mood === 'derp' ? 2 : 1);
    if (mood === 'angry') {
      g.lineStyle(4, 0x111111, 1);
      g.lineBetween(cx - sep - r - 3, y - r - 5, cx - sep + r - 1, y - r + 1);
      g.lineBetween(cx + sep + r + 3, y - r - 5, cx + sep - r + 1, y - r + 1);
    }
  },

  // dark shades hiding the eyes (Bobritto, Assassino)
  _shades(g, cx, y, w, rim) {
    g.fillStyle(0x212121, 1);
    g.fillRoundedRect(cx - w / 2, y - 6, w, 13, 4);
    g.lineStyle(2, rim || 0xffd54f, 1);
    g.strokeRoundedRect(cx - w / 2, y - 6, w, 13, 4);
  },

  _smile(g, cx, y, w, color) {
    g.lineStyle(3, color || 0x3e2723, 1);
    g.beginPath();
    g.moveTo(cx - w / 2, y);
    g.lineTo(cx - w / 4, y + 5);
    g.lineTo(cx + w / 4, y + 5);
    g.lineTo(cx + w / 2, y);
    g.strokePath();
  },

  _leg(g, x, y0, y1, w, color) {
    g.fillStyle(color, 1);
    g.fillRoundedRect(x - w / 2, y0, w, y1 - y0, w / 2);
  },

  // the trend's signature footwear
  _sneaker(g, x, y, color, s) {
    const k = s || 1;
    g.fillStyle(color, 1);
    g.fillRoundedRect(x - 9 * k, y, 18 * k, 9 * k, 4 * k);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(x - 10 * k, y + 7 * k, 20 * k, 5 * k, 2 * k);
    g.lineStyle(2 * k, 0xffffff, 1);
    g.lineBetween(x - 6 * k, y + 7 * k, x + 4 * k, y + 1 * k);
  },

  _shoe(g, x, y, color) {
    g.fillStyle(color, 1);
    g.fillEllipse(x, y + 5, 20, 11);
    g.fillRoundedRect(x - 6, y - 2, 12, 8, 3);
  },

  // a whole little shark — reused for Tralalero and each of Los Tralaleritos
  _shark(g, cx, cy, s, color, shoeColor, mood, legs) {
    const dark = this.shade(color, 0.6);
    const bw = 66 * s, bh = 34 * s;
    // tail
    g.fillStyle(color, 1);
    g.fillTriangle(cx - bw * 0.42, cy, cx - bw * 0.72, cy - 16 * s, cx - bw * 0.72, cy + 14 * s);
    // dorsal fin
    g.fillTriangle(cx - 6 * s, cy - bh * 0.4, cx + 10 * s, cy - bh * 0.4, cx - 2 * s, cy - bh * 0.95);
    // body
    this._blob(g, cx, cy, bw, bh, color, dark);
    // pale belly
    g.fillStyle(0xf5f5f5, 1);
    g.fillEllipse(cx + 2 * s, cy + bh * 0.26, bw * 0.72, bh * 0.36);
    // snout + gaping mouth
    g.fillStyle(0x37474f, 1);
    g.fillEllipse(cx + bw * 0.24, cy + 5 * s, bw * 0.46, bh * 0.34);
    g.fillStyle(0xffffff, 1);
    for (let i = 0; i < 4; i++) {
      const tx = cx + bw * 0.08 + i * 7 * s;
      g.fillTriangle(tx, cy - 1 * s, tx + 5 * s, cy - 1 * s, tx + 2 * s, cy + 5 * s);
    }
    // gill slashes
    g.lineStyle(2 * s, dark, 1);
    for (let i = 0; i < 3; i++) g.lineBetween(cx - 8 * s + i * 6 * s, cy - 6 * s, cx - 10 * s + i * 6 * s, cy + 4 * s);
    // eye
    this._eye(g, cx + bw * 0.2, cy - bh * 0.28, 7 * s, 1, 0);
    if (mood === 'angry') {
      g.lineStyle(4 * s, 0x111111, 1);
      g.lineBetween(cx + bw * 0.06, cy - bh * 0.6, cx + bw * 0.3, cy - bh * 0.42);
    } else if (mood === 'sad') {
      g.lineStyle(3 * s, 0x111111, 1);
      g.lineBetween(cx + bw * 0.3, cy - bh * 0.62, cx + bw * 0.08, cy - bh * 0.44);
    }
    // the famous legs + sneakers
    const top = cy + bh * 0.34;
    const foot = top + 20 * s;
    for (let i = 0; i < legs; i++) {
      const lx = cx + (i - (legs - 1) / 2) * 23 * s;
      this._leg(g, lx, top, foot, 8 * s, this.shade(color, 0.8));
      this._sneaker(g, lx, foot - 2 * s, shoeColor, s);
    }
  },

  // ------------------------------------------------------------- creatures
  BODIES: {
    // shark in sneakers — the one everybody knows
    tralalero(g, def) {
      this._shark(g, 44, 33, 1, def.color, def.accent, 'angry', 3);
    },

    // baby shark trio
    tralaleritos(g, def) {
      const moods = ['angry', 'happy', 'sad'];
      [16, 44, 72].forEach((x, i) => {
        this._shark(g, x, 34 + (i === 1 ? -4 : 0), 0.42, def.color, def.accent, moods[i], 2);
      });
      g.fillStyle(0x18ffff, 0.9);
      g.fillTriangle(44, 4, 40, 12, 48, 12);
    },

    // crocodile head bolted to a WWII bomber
    bombardiro(g, def) {
      const steel = def.accent, dark = this.shade(def.color, 0.55);
      // wings + tailplane
      this._box(g, 2, 42, 84, 11, 5, steel);
      g.fillStyle(this.shade(steel, 0.8), 1);
      g.fillTriangle(10, 34, 26, 34, 16, 20);
      // fuselage
      this._box(g, 10, 26, 62, 26, 13, def.color, dark);
      g.fillStyle(this.shade(def.color, 1.3), 1);
      for (let i = 0; i < 4; i++) g.fillEllipse(24 + i * 11, 30, 7, 5);   // scutes
      // snout with teeth
      this._box(g, 58, 32, 28, 14, 5, def.color, dark);
      g.fillStyle(0xffffff, 1);
      for (let i = 0; i < 5; i++) g.fillTriangle(62 + i * 5, 46, 66 + i * 5, 46, 64 + i * 5, 51);
      // eye + brow
      this._eye(g, 58, 24, 7, 1, 0);
      g.lineStyle(4, 0x111111, 1); g.lineBetween(50, 17, 66, 21);
      // engines
      [26, 60].forEach((x) => {
        g.fillStyle(0x455a64, 1); g.fillRoundedRect(x - 9, 52, 18, 11, 5);
        g.lineStyle(3, 0xcfd8dc, 1); g.lineBetween(x - 12, 66, x + 12, 66);
      });
      // bomb
      g.fillStyle(0x263238, 1); g.fillEllipse(44, 72, 20, 12);
      g.fillStyle(0xffb300, 1); g.fillRect(38, 69, 12, 3);
    },

    // wooden log man with a bat
    tungtung(g, def) {
      const dark = this.shade(def.color, 0.6);
      // bat, held out to the side
      g.fillStyle(def.accent, 1);
      g.fillRoundedRect(66, 20, 12, 36, 6);
      g.fillRoundedRect(68, 54, 8, 14, 4);
      // body log
      this._box(g, 22, 10, 40, 64, 12, def.color, dark);
      g.lineStyle(2, dark, 1);
      [22, 34, 46].forEach((y) => g.lineBetween(26, y, 58, y + 3));
      // arm reaching for the bat
      this._box(g, 58, 30, 14, 10, 5, def.color, dark);
      // huge staring eyes
      this._eye(g, 34, 30, 9, 1, 0);
      this._eye(g, 52, 30, 9, -1, 0);
      // gaping shouting mouth
      g.fillStyle(0x3e2723, 1); g.fillEllipse(44, 54, 26, 18);
      g.fillStyle(0xffffff, 1); g.fillRect(33, 46, 22, 5);
      // stumpy feet
      g.fillStyle(dark, 1);
      g.fillEllipse(33, 78, 18, 11); g.fillEllipse(55, 78, 18, 11);
    },

    // cappuccino cup in a tutu
    ballerina(g, def) {
      // tutu
      g.fillStyle(this.shade(def.accent, 0.85), 1);
      g.fillTriangle(10, 66, 78, 66, 44, 42);
      g.fillStyle(def.accent, 1);
      g.fillTriangle(16, 62, 72, 62, 44, 40);
      // legs + pointe shoes
      [36, 52].forEach((x) => {
        this._leg(g, x, 60, 78, 7, 0xffe0b2);
        g.fillStyle(def.accent, 1); g.fillEllipse(x, 80, 15, 9);
        g.lineStyle(2, def.accent, 1); g.lineBetween(x, 72, x + 5, 66);
      });
      // mug head + handle
      g.lineStyle(5, 0xe0e0e0, 1); g.strokeEllipse(68, 26, 18, 20);
      this._box(g, 24, 6, 40, 36, 7, def.color, 0xbdbdbd);
      g.fillStyle(0xd7a86e, 1); g.fillEllipse(44, 10, 34, 11);   // foam
      g.fillStyle(0xfff3e0, 1); g.fillEllipse(40, 9, 12, 5);
      this._eyes(g, 44, 26, 10, 6);
      g.lineStyle(2, 0x111111, 1);
      g.lineBetween(30, 18, 36, 15); g.lineBetween(58, 18, 52, 15);  // lashes
      this._smile(g, 44, 36, 14, 0xd32f2f);
    },

    // chimp head on a banana body
    chimpanzini(g, def) {
      const dark = this.shade(def.color, 0.6);
      // banana crescent
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI * (1 - i / 12);
        pts.push({ x: 44 + Math.cos(a) * 26, y: 70 - Math.sin(a) * 32 });
      }
      for (let i = 12; i >= 0; i--) {
        const a = Math.PI * (1 - i / 12);
        pts.push({ x: 44 + Math.cos(a) * 10, y: 78 - Math.sin(a) * 13 });
      }
      g.fillStyle(def.color, 1); g.fillPoints(pts, true);
      g.lineStyle(3, dark, 1); g.strokePoints(pts, true);
      g.fillStyle(0x8d6e63, 1); g.fillEllipse(18, 70, 9, 9); g.fillEllipse(70, 70, 9, 9);
      // chimp head
      g.fillStyle(def.accent, 1);
      g.fillEllipse(26, 26, 15, 15); g.fillEllipse(62, 26, 15, 15);   // ears
      this._blob(g, 44, 26, 36, 32, def.accent);
      g.fillStyle(0xd7a86e, 1); g.fillEllipse(44, 32, 26, 20);        // muzzle
      g.fillStyle(0x3e2723, 1); g.fillEllipse(40, 30, 3, 4); g.fillEllipse(48, 30, 3, 4);
      this._smile(g, 44, 36, 14, 0x3e2723);
      this._eyes(g, 44, 20, 9, 6);
    },

    // espresso cup ninja with twin katanas
    assassino(g, def) {
      // katanas crossed behind
      g.lineStyle(5, 0xcfd8dc, 1);
      g.lineBetween(6, 10, 38, 54); g.lineBetween(82, 10, 50, 54);
      g.lineStyle(6, 0x37474f, 1);
      g.lineBetween(4, 6, 12, 17); g.lineBetween(84, 6, 76, 17);
      // cup body
      const cup = [{ x: 27, y: 28 }, { x: 61, y: 28 }, { x: 55, y: 74 }, { x: 33, y: 74 }];
      g.fillStyle(def.color, 1); g.fillPoints(cup, true);
      g.lineStyle(4, 0xbdbdbd, 1); g.strokePoints(cup, true);
      g.lineStyle(5, 0xe0e0e0, 1); g.strokeEllipse(68, 46, 16, 20);   // handle
      g.fillStyle(0x6d4c41, 1); g.fillRect(29, 33, 30, 7);            // coffee band
      // ninja headband + tails
      g.fillStyle(def.accent, 1);
      g.fillRect(26, 44, 36, 10);
      g.fillTriangle(62, 44, 82, 40, 66, 54);
      // angry slit eyes
      g.fillStyle(0x111111, 1);
      g.fillTriangle(31, 46, 42, 48, 31, 52);
      g.fillTriangle(57, 46, 46, 48, 57, 52);
      // stubby legs
      g.fillStyle(0x37474f, 1);
      g.fillEllipse(36, 79, 17, 10); g.fillEllipse(54, 79, 17, 10);
    },

    // cactus-elephant in sandals
    lirili(g, def) {
      const dark = this.shade(def.color, 0.6);
      // cactus arms
      this._box(g, 10, 34, 13, 24, 6, def.color, dark);
      this._box(g, 65, 30, 13, 26, 6, def.color, dark);
      this._box(g, 16, 44, 56, 12, 6, def.color, dark);
      // cactus trunk
      this._box(g, 29, 20, 30, 54, 14, def.color, dark);
      g.lineStyle(2, 0xe8f5e9, 1);
      for (let i = 0; i < 5; i++) {
        g.lineBetween(33, 30 + i * 9, 30, 27 + i * 9);
        g.lineBetween(55, 30 + i * 9, 58, 27 + i * 9);
      }
      // elephant head
      g.fillStyle(def.accent, 1);
      g.fillEllipse(24, 20, 20, 26); g.fillEllipse(64, 20, 20, 26);   // ears
      this._blob(g, 44, 20, 38, 30, def.accent);
      this._eyes(g, 44, 16, 9, 6);
      // trunk
      g.fillStyle(def.accent, 1);
      g.fillRoundedRect(39, 26, 11, 24, 5);
      g.fillRoundedRect(39, 44, 20, 10, 5);
      g.lineStyle(2, this.shade(def.accent, 0.75), 1);
      for (let i = 0; i < 3; i++) g.lineBetween(39, 31 + i * 5, 50, 31 + i * 5);
      // sandals
      [34, 54].forEach((x) => {
        g.fillStyle(0x8d6e63, 1); g.fillEllipse(x, 79, 21, 11);
        g.lineStyle(3, 0x5d4037, 1); g.lineBetween(x - 6, 76, x + 6, 76);
      });
    },

    // long-nosed monkey grown over with vines
    patapim(g, def) {
      const dark = this.shade(def.color, 0.6);
      // leafy crown
      g.fillStyle(def.accent, 1);
      g.fillEllipse(28, 18, 26, 20); g.fillEllipse(60, 18, 26, 20); g.fillEllipse(44, 11, 30, 22);
      // hanging vines
      g.lineStyle(4, this.shade(def.accent, 0.85), 1);
      [16, 72].forEach((x) => {
        g.beginPath(); g.moveTo(x, 20); g.lineTo(x - 4, 34); g.lineTo(x + 3, 48); g.strokePath();
      });
      // trunk-ish body
      this._box(g, 20, 24, 48, 50, 16, def.color, dark);
      // face
      g.fillStyle(0xd7a86e, 1); g.fillEllipse(44, 44, 34, 28);
      this._eyes(g, 44, 38, 9, 6, 'derp');
      // the nose
      g.fillStyle(0xbf8f68, 1); g.fillEllipse(44, 54, 14, 24);
      g.lineStyle(2, 0x8d6e63, 1); g.strokeEllipse(44, 54, 14, 24);
      // root feet
      g.fillStyle(dark, 1);
      g.fillRoundedRect(24, 70, 16, 14, 5); g.fillRoundedRect(48, 70, 16, 14, 5);
      g.fillEllipse(32, 82, 22, 9); g.fillEllipse(56, 82, 22, 9);
    },

    // frog head on a car tyre, with human legs
    boneca(g, def) {
      // human legs first (they stick out below the tyre)
      [34, 54].forEach((x) => {
        this._leg(g, x, 52, 76, 11, 0xffcc80);
        g.fillStyle(0x263238, 1); g.fillEllipse(x, 79, 21, 11);
      });
      // tyre
      g.lineStyle(13, def.accent, 1); g.strokeEllipse(44, 44, 54, 34);
      g.lineStyle(3, this.shade(def.accent, 2.2), 1);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.lineBetween(44 + Math.cos(a) * 23, 44 + Math.sin(a) * 14,
          44 + Math.cos(a) * 31, 44 + Math.sin(a) * 21);
      }
      g.fillStyle(0x90a4ae, 1); g.fillEllipse(44, 44, 26, 17);
      g.fillStyle(0x607d8b, 1); g.fillEllipse(44, 44, 11, 8);
      // frog head
      this._blob(g, 44, 16, 44, 26, def.color);
      g.fillStyle(def.color, 1);
      g.fillEllipse(31, 5, 20, 18); g.fillEllipse(57, 5, 20, 18);
      this._eye(g, 31, 5, 7, 0, 1); this._eye(g, 57, 5, 7, 0, 1);
      g.lineStyle(3, this.shade(def.color, 0.5), 1);
      g.beginPath(); g.moveTo(28, 20); g.lineTo(44, 26); g.lineTo(60, 20); g.strokePath();
    },

    // beaver mobster in a pinstripe suit
    bobritto(g, def) {
      const dark = this.shade(def.color, 0.6);
      // flat tail
      g.fillStyle(dark, 1); g.fillEllipse(14, 66, 30, 18);
      g.lineStyle(2, this.shade(def.color, 0.4), 1);
      g.lineBetween(4, 62, 26, 70); g.lineBetween(6, 70, 24, 60);
      // suit
      this._box(g, 26, 40, 38, 38, 10, def.accent, 0x9e9e9e);
      g.lineStyle(2, 0x455a64, 1);
      for (let i = 0; i < 4; i++) g.lineBetween(31 + i * 8, 42, 31 + i * 8, 76);
      g.fillStyle(0x212121, 1);
      g.fillTriangle(38, 40, 52, 40, 45, 56);
      // head
      this._blob(g, 44, 28, 36, 30, def.color);
      g.fillStyle(0xd7a86e, 1); g.fillEllipse(44, 34, 22, 15);
      g.fillStyle(0xffffff, 1); g.fillRect(40, 38, 4, 9); g.fillRect(45, 38, 4, 9);  // buck teeth
      g.fillStyle(0x3e2723, 1); g.fillEllipse(44, 29, 6, 4);
      this._shades(g, 44, 22, 34);
      // bowler hat
      g.fillStyle(0x212121, 1);
      g.fillRoundedRect(33, 2, 22, 12, 6);
      g.fillEllipse(44, 14, 42, 9);
      // shoes
      g.fillStyle(0x212121, 1);
      g.fillEllipse(34, 80, 20, 10); g.fillEllipse(56, 80, 20, 10);
    },

    // cat head on a shrimp body
    trippi(g, def) {
      const dark = this.shade(def.color, 0.6);
      // segmented tail curving down-right
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        this._blob(g, 38 + t * 28, 44 + t * 24, 30 - i * 3, 26 - i * 3, def.accent, dark);
      }
      g.fillStyle(def.accent, 1);
      g.fillTriangle(70, 66, 86, 58, 86, 78);
      // little swimmerets
      g.lineStyle(3, dark, 1);
      for (let i = 0; i < 4; i++) g.lineBetween(38 + i * 8, 62 + i * 5, 36 + i * 8, 72 + i * 5);
      // cat head
      g.fillStyle(def.color, 1);
      g.fillTriangle(16, 24, 26, 6, 32, 24);
      g.fillTriangle(46, 24, 42, 6, 54, 22);
      this._blob(g, 34, 28, 38, 32, def.color);
      g.fillStyle(0xfff3e0, 1); g.fillEllipse(34, 34, 22, 14);
      g.fillStyle(0xef5350, 1); g.fillTriangle(30, 30, 38, 30, 34, 35);
      this._eyes(g, 34, 24, 9, 7);
      g.lineStyle(2, 0x3e2723, 1);
      g.lineBetween(8, 32, 24, 35); g.lineBetween(8, 38, 24, 38);
      g.lineBetween(60, 32, 44, 35); g.lineBetween(60, 38, 44, 38);
      // antennae
      g.lineStyle(3, dark, 1);
      g.lineBetween(24, 12, 12, 2); g.lineBetween(44, 12, 56, 2);
    },

    // camel sticking out of a fridge
    frigo(g, def) {
      // fridge
      this._box(g, 18, 26, 52, 50, 6, def.color, 0x90a4ae);
      g.lineStyle(3, 0xb0bec5, 1); g.lineBetween(20, 50, 68, 50);
      g.fillStyle(0x90a4ae, 1);
      g.fillRoundedRect(60, 32, 5, 14, 2); g.fillRoundedRect(60, 55, 5, 14, 2);
      g.fillStyle(0xb0bec5, 1); g.fillRect(24, 60, 16, 4);   // little vent
      // camel neck + head sprouting out of the top door
      g.fillStyle(def.accent, 1);
      g.fillRoundedRect(34, 16, 17, 22, 8);
      g.fillEllipse(42, 34, 24, 14);                                        // hump/shoulder
      g.fillTriangle(30, 8, 37, 0, 41, 10);                                 // ear
      this._blob(g, 44, 12, 36, 24, def.accent);
      g.fillStyle(this.shade(def.accent, 1.25), 1); g.fillEllipse(62, 16, 24, 16);  // muzzle
      g.lineStyle(3, this.shade(def.accent, 0.6), 1); g.strokeEllipse(62, 16, 24, 16);
      g.fillStyle(0x5d4037, 1); g.fillEllipse(69, 13, 4, 5);                // nostril
      g.lineStyle(2, 0x5d4037, 1); g.lineBetween(56, 22, 70, 21);           // lazy grin
      this._eye(g, 46, 8, 7, 2, 0);
      // shoes
      g.fillStyle(0x795548, 1);
      g.fillEllipse(32, 80, 22, 11); g.fillEllipse(56, 80, 22, 11);
    },

    // goose with fighter-jet wings
    gusini(g, def) {
      const steel = def.accent;
      // swept wings
      g.fillStyle(steel, 1);
      g.fillPoints([{ x: 2, y: 54 }, { x: 32, y: 44 }, { x: 58, y: 44 },
        { x: 86, y: 54 }, { x: 58, y: 56 }, { x: 32, y: 56 }], true);
      g.fillStyle(this.shade(steel, 0.75), 1);
      g.fillRoundedRect(16, 56, 22, 11, 5);                    // engine pod
      g.fillStyle(0xff7043, 1);
      g.fillTriangle(16, 58, 16, 65, 4, 61);                   // afterburner
      // tail feathers
      g.fillStyle(0xe0e0e0, 1); g.fillTriangle(14, 34, 32, 40, 16, 46);
      // body
      this._blob(g, 42, 44, 44, 36, def.color, 0xbdbdbd);
      // neck + head
      g.fillStyle(def.color, 1); g.fillRoundedRect(52, 14, 13, 26, 6);
      this._blob(g, 60, 14, 26, 20, def.color, 0xbdbdbd);
      g.fillStyle(0xffa726, 1); g.fillTriangle(70, 10, 86, 15, 70, 20);
      this._eye(g, 58, 10, 6, 1, 0);
      // feet
      g.fillStyle(0xffa726, 1);
      g.fillEllipse(36, 76, 18, 9); g.fillEllipse(54, 76, 18, 9);
    },

    // watermelon crocodile
    glorbo(g, def) {
      const dark = this.shade(def.color, 0.55);
      // tail
      g.fillStyle(def.color, 1);
      g.fillTriangle(6, 46, 26, 36, 26, 58);
      // body
      this._blob(g, 42, 46, 66, 40, def.color, dark);
      g.lineStyle(4, dark, 1);
      for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(42 + i * 16, 28); g.lineTo(38 + i * 16, 46); g.lineTo(42 + i * 16, 64);
        g.strokePath();
      }
      // melon flesh belly + seeds
      g.fillStyle(0xfff8e1, 1); g.fillEllipse(42, 56, 52, 22);
      g.fillStyle(def.accent, 1); g.fillEllipse(42, 57, 46, 17);
      g.fillStyle(0x212121, 1);
      [[30, 55], [42, 60], [54, 55], [36, 62], [50, 62]].forEach((p) => g.fillEllipse(p[0], p[1], 4, 6));
      // snout with teeth
      this._box(g, 56, 30, 30, 15, 5, def.color, dark);
      g.fillStyle(0xffffff, 1);
      for (let i = 0; i < 5; i++) g.fillTriangle(59 + i * 5, 45, 63 + i * 5, 45, 61 + i * 5, 50);
      // eye bumps
      g.fillStyle(def.color, 1); g.fillEllipse(48, 24, 18, 16); g.fillEllipse(64, 22, 16, 14);
      this._eye(g, 48, 24, 7, 1, 0); this._eye(g, 64, 22, 6, 1, 0);
      // stubby legs
      g.fillStyle(dark, 1);
      [24, 44, 60].forEach((x) => g.fillRoundedRect(x - 7, 62, 14, 18, 6));
      [24, 44, 60].forEach((x) => g.fillEllipse(x, 80, 20, 10));
    },

    // jellyfish with a bunch of grapes for a head
    graipuss(g, def) {
      const light = this.shade(def.color, 1.6);
      // tentacles
      g.lineStyle(5, light, 0.9);
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(44 + i * 13, 54);
        g.lineTo(44 + i * 13 - 6, 68);
        g.lineTo(44 + i * 13 + 4, 84);
        g.strokePath();
      }
      // bell
      g.fillStyle(def.accent, 0.95);
      g.fillEllipse(44, 42, 66, 44);
      g.lineStyle(4, def.color, 1); g.strokeEllipse(44, 42, 66, 44);
      g.fillStyle(light, 0.5); g.fillEllipse(32, 34, 18, 10);
      // grape cluster
      const cluster = [[44, 6], [32, 14], [56, 14], [24, 24], [44, 22], [64, 24], [34, 32], [54, 32], [44, 38]];
      cluster.forEach((p) => {
        g.fillStyle(def.color, 1); g.fillCircle(p[0], p[1], 9);
        g.fillStyle(light, 0.55); g.fillCircle(p[0] - 3, p[1] - 3, 3);
      });
      g.fillStyle(0x66bb6a, 1); g.fillEllipse(56, 2, 16, 8);
      // face on the bell
      this._eyes(g, 44, 46, 13, 7);
      this._smile(g, 44, 58, 18, 0x4a148c);
    },

    // cow fused with Saturn
    vacca(g, def) {
      // planetary ring (behind)
      g.lineStyle(9, def.accent, 1); g.strokeEllipse(44, 50, 86, 30);
      g.lineStyle(3, this.shade(def.accent, 1.4), 1); g.strokeEllipse(44, 50, 76, 24);
      // body
      this._blob(g, 44, 48, 58, 44, def.color, 0x9e9e9e);
      g.fillStyle(0x37474f, 1);
      g.fillEllipse(30, 42, 20, 16); g.fillEllipse(56, 56, 22, 14); g.fillEllipse(58, 36, 13, 11);
      // head
      g.fillStyle(0xffe0b2, 1);
      g.fillEllipse(26, 20, 15, 11); g.fillEllipse(62, 20, 15, 11);       // ears
      g.fillStyle(0xfafafa, 1);
      g.fillTriangle(28, 12, 22, 2, 36, 8); g.fillTriangle(60, 12, 66, 2, 52, 8);  // horns
      this._blob(g, 44, 20, 36, 28, def.color, 0x9e9e9e);
      g.fillStyle(0xf8bbd0, 1); g.fillEllipse(44, 27, 24, 15);
      g.fillStyle(0x880e4f, 1); g.fillEllipse(39, 26, 4, 5); g.fillEllipse(49, 26, 4, 5);
      this._eyes(g, 44, 16, 10, 6);
      // human feet
      [33, 55].forEach((x) => {
        this._leg(g, x, 66, 76, 11, 0xffcc80);
        g.fillStyle(0xffcc80, 1); g.fillEllipse(x, 80, 22, 11);
        g.lineStyle(2, 0xe0a060, 1);
        for (let i = -1; i <= 1; i++) g.lineBetween(x + i * 6, 76, x + i * 6, 82);
      });
    },

    // capybara chilling inside a coconut
    burbaloni(g, def) {
      const dark = this.shade(def.color, 0.6);
      // coconut husk
      g.fillStyle(dark, 1); g.fillCircle(44, 48, 34);
      g.lineStyle(3, this.shade(def.color, 0.4), 1);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        g.lineBetween(44 + Math.cos(a) * 30, 48 + Math.sin(a) * 30,
          44 + Math.cos(a) * 37, 48 + Math.sin(a) * 37);
      }
      // capybara ears poke out over the husk rim
      g.fillStyle(def.color, 1);
      g.fillEllipse(26, 20, 16, 14); g.fillEllipse(62, 20, 16, 14);
      g.fillStyle(this.shade(def.color, 0.75), 1);
      g.fillEllipse(26, 21, 8, 7); g.fillEllipse(62, 21, 8, 7);
      g.fillStyle(def.accent, 1); g.fillEllipse(44, 46, 54, 48);
      this._blob(g, 44, 48, 42, 36, def.color);
      g.fillStyle(this.shade(def.color, 0.75), 1); g.fillEllipse(44, 58, 26, 17);
      g.fillStyle(0x3e2723, 1); g.fillEllipse(40, 55, 4, 3); g.fillEllipse(48, 55, 4, 3);
      this._smile(g, 44, 62, 14, 0x3e2723);
      g.fillStyle(0x111111, 1);
      g.fillEllipse(35, 43, 6, 4); g.fillEllipse(53, 43, 6, 4);          // sleepy eyes
      // tiny feet
      g.fillStyle(dark, 1);
      g.fillEllipse(34, 80, 16, 9); g.fillEllipse(54, 80, 16, 9);
    },
  },

  // ---- player / bot characters: 64x72 ----
  character(scene, key, color, capColor) {
    const g = this._g(scene);
    const cx = 32;
    const dark = this.shade(color, 0.55);
    g.lineStyle(4, dark, 1);
    g.fillStyle(color, 1);
    g.fillRoundedRect(12, 14, 40, 48, 17);
    g.strokeRoundedRect(12, 14, 40, 48, 17);
    // cap
    g.fillStyle(capColor, 1);
    g.fillRoundedRect(10, 8, 44, 14, 6);
    g.fillRect(6, 18, 18, 5);
    // eyes
    [-9, 9].forEach((dx) => {
      g.fillStyle(0xffffff, 1); g.lineStyle(2, 0x111111, 1);
      g.fillEllipse(cx + dx, 34, 12, 12); g.strokeEllipse(cx + dx, 34, 12, 12);
      g.fillStyle(0x111111, 1); g.fillEllipse(cx + dx, 35, 5, 5);
    });
    // feet
    g.fillStyle(dark, 1);
    g.fillEllipse(cx - 10, 64, 14, 8);
    g.fillEllipse(cx + 10, 64, 14, 8);
    g.generateTexture(key, 64, 72);
    g.destroy();
  },

  // ---------------------------------------------------------------- horde
  // Deliberately plainer than BODIES: these are never the shipped look, they
  // are what keeps the game running when a render is missing.
  MONSTERS: {
    en_gloopo(g) {
      const skin = 0x52c74d, dark = 0x2b7a2f;
      g.fillStyle(dark, 1); g.fillEllipse(44, 82, 66, 12);
      this._blob(g, 44, 62, 58, 44, skin, dark);
      this._blob(g, 44, 40, 40, 36, skin, dark);
      this._eyes(g, 44, 36, 12, 8, 'derp');
      g.fillStyle(0x1b1b22, 1); g.fillEllipse(44, 54, 14, 8);
    },

    en_sporeling(g) {
      const stalk = 0xf0e6cc, cap = 0xd2352f;
      this._box(g, 32, 34, 24, 50, 10, stalk, 0xbfae8e);
      g.fillStyle(stalk, 1); g.fillEllipse(34, 84, 18, 9); g.fillEllipse(54, 84, 18, 9);
      this._eyes(g, 44, 52, 10, 6, 'angry');
      g.fillStyle(0x1b1b22, 1); g.fillEllipse(44, 66, 9, 6);
      this._blob(g, 44, 30, 68, 34, cap, 0x8e1f1c);
      g.fillStyle(0xfff3dc, 1);
      g.fillEllipse(26, 24, 16, 10); g.fillEllipse(56, 22, 14, 9); g.fillEllipse(42, 16, 10, 7);
    },

    en_zippet(g) {
      const skin = 0x8b55b8, wing = 0x59318f;
      g.fillStyle(wing, 1);
      g.fillTriangle(24, 34, 0, 18, 4, 52);
      g.fillTriangle(64, 34, 88, 18, 84, 52);
      this._leg(g, 36, 66, 84, 6, 0x4a2a78);
      this._leg(g, 52, 66, 84, 6, 0x4a2a78);
      this._blob(g, 44, 52, 34, 38, skin, 0x4a2a78);
      g.fillStyle(skin, 1);
      g.fillTriangle(28, 18, 22, 0, 40, 14);
      g.fillTriangle(60, 18, 66, 0, 48, 14);
      this._blob(g, 44, 30, 36, 32, skin, 0x4a2a78);
      this._eyes(g, 44, 28, 9, 6, 'angry');
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(40, 38, 44, 38, 42, 44);
      g.fillTriangle(46, 38, 50, 38, 48, 44);
    },

    en_crustacle(g) {
      const shell = 0x5c6675, plate = 0x3d4451, flesh = 0xb87050;
      g.fillStyle(plate, 1); g.fillEllipse(16, 82, 12, 7); g.fillEllipse(72, 82, 12, 7);
      g.fillEllipse(8, 58, 18, 16); g.fillEllipse(80, 58, 18, 16);
      g.fillTriangle(2, 50, 14, 50, 8, 38);
      g.fillTriangle(74, 50, 86, 50, 80, 38);
      this._blob(g, 44, 62, 58, 40, flesh, 0x7d452c);
      this._eyes(g, 44, 56, 12, 7);
      g.fillStyle(0x1b1b22, 1); g.fillEllipse(44, 72, 16, 6);
      this._blob(g, 44, 42, 66, 38, shell, plate);
      g.fillStyle(plate, 1);
      g.fillEllipse(44, 28, 40, 12); g.fillEllipse(44, 38, 52, 12);
    },

    en_wispa(g) {
      const veil = 0xdce8fb;
      g.fillStyle(veil, 1);
      g.fillTriangle(18, 34, 70, 34, 44, 80);
      g.fillEllipse(26, 78, 14, 12); g.fillEllipse(38, 78, 14, 12);
      g.fillEllipse(50, 78, 14, 12); g.fillEllipse(62, 78, 14, 12);
      g.fillEllipse(44, 34, 52, 52);
      g.lineStyle(3, 0x8fa8cf, 1); g.strokeEllipse(44, 34, 52, 52);
      g.fillStyle(0x1b2233, 1);
      g.fillEllipse(34, 30, 13, 18); g.fillEllipse(54, 30, 13, 18);
      g.fillEllipse(44, 48, 10, 13);
    },

    en_grumblor(g) {
      const hide = 0x7b5b96, dark = 0x4c3663, horn = 0xe6dcc0;
      g.fillStyle(dark, 1); g.fillEllipse(32, 84, 22, 10); g.fillEllipse(56, 84, 22, 10);
      g.fillStyle(hide, 1); g.fillEllipse(10, 60, 20, 26); g.fillEllipse(78, 60, 20, 26);
      this._blob(g, 44, 58, 62, 46, hide, dark);
      g.fillStyle(horn, 1);
      g.fillTriangle(20, 22, 12, 0, 32, 14);
      g.fillTriangle(68, 22, 76, 0, 56, 14);
      this._blob(g, 44, 32, 44, 36, hide, dark);
      g.fillStyle(dark, 1); g.fillEllipse(44, 22, 42, 9);
      this._eyes(g, 44, 34, 10, 6, 'angry');
      g.fillStyle(0x1b1b22, 1); g.fillEllipse(44, 46, 20, 7);
      g.fillStyle(horn, 1);
      g.fillTriangle(34, 46, 40, 46, 37, 38);
      g.fillTriangle(48, 46, 54, 46, 51, 38);
    },

    en_cyclomunch(g) {
      const hide = 0xb04d4d, dark = 0x76292d, tooth = 0xf5f0e2;
      g.fillStyle(dark, 1); g.fillEllipse(32, 84, 22, 10); g.fillEllipse(56, 84, 22, 10);
      g.fillStyle(hide, 1); g.fillEllipse(8, 50, 18, 30); g.fillEllipse(80, 50, 18, 30);
      this._blob(g, 44, 48, 68, 62, hide, dark);
      g.fillStyle(0x1b1b22, 1); g.fillEllipse(44, 62, 34, 18);
      g.fillStyle(tooth, 1);
      for (let i = 0; i < 5; i++) {
        const x = 30 + i * 7;
        g.fillTriangle(x, 54, x + 5, 54, x + 2, 62);
        g.fillTriangle(x, 70, x + 5, 70, x + 2, 63);
      }
      this._eye(g, 44, 30, 17, 0, 2);
      g.fillStyle(dark, 1); g.fillEllipse(44, 12, 40, 10);
    },

    en_slimeking(g) {
      const skin = 0x4bb864, dark = 0x25763c, gold = 0xffc233;
      g.fillStyle(dark, 1); g.fillEllipse(44, 84, 80, 12);
      this._blob(g, 44, 60, 72, 52, skin, dark);
      this._blob(g, 44, 38, 50, 40, skin, dark);
      this._eyes(g, 44, 36, 13, 8, 'angry');
      g.fillStyle(0x1b1b22, 1); g.fillEllipse(44, 56, 26, 12);
      g.fillStyle(0xffffff, 1);
      for (let i = 0; i < 4; i++) {
        const x = 34 + i * 7;
        g.fillTriangle(x, 50, x + 5, 50, x + 2, 57);
      }
      g.fillStyle(gold, 1);
      g.fillRect(26, 10, 36, 8);
      g.fillTriangle(26, 12, 34, 12, 30, 0);
      g.fillTriangle(38, 12, 50, 12, 44, 0);
      g.fillTriangle(54, 12, 62, 12, 58, 0);
    },
  },

  props(scene) {
    let g;

    // shadow
    g = this._g(scene);
    g.fillStyle(0x000000, 0.28); g.fillEllipse(24, 8, 44, 14);
    g.generateTexture('shadow', 48, 16); g.destroy();

    // pedestal
    g = this._g(scene);
    g.fillStyle(0x455a64, 1); g.fillEllipse(32, 24, 58, 20);
    g.fillStyle(0x607d8b, 1); g.fillEllipse(32, 18, 58, 20);
    g.fillStyle(0x78909c, 1); g.fillEllipse(32, 16, 46, 14);
    g.generateTexture('pedestal', 64, 36); g.destroy();

    // coin
    g = this._g(scene);
    g.fillStyle(0xffb300, 1); g.fillEllipse(10, 10, 18, 18);
    g.fillStyle(0xffe082, 1); g.fillEllipse(10, 10, 12, 12);
    g.fillStyle(0xffb300, 1); g.fillRect(8, 5, 4, 10);
    g.generateTexture('coin', 20, 20); g.destroy();

    // spark (4-point star)
    g = this._g(scene);
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(12, 0, 9, 9, 15, 9);
    g.fillTriangle(12, 24, 9, 15, 15, 15);
    g.fillTriangle(0, 12, 9, 9, 9, 15);
    g.fillTriangle(24, 12, 15, 9, 15, 15);
    g.generateTexture('spark', 24, 24); g.destroy();

    // ring (for glows / hold progress backing)
    g = this._g(scene);
    g.lineStyle(5, 0xffffff, 1); g.strokeEllipse(32, 32, 56, 56);
    g.generateTexture('ring', 64, 64); g.destroy();

    // solid dot (particles, joystick knob base)
    g = this._g(scene);
    g.fillStyle(0xffffff, 1); g.fillEllipse(16, 16, 30, 30);
    g.generateTexture('dot', 32, 32); g.destroy();

    // down arrow indicator
    g = this._g(scene);
    g.fillStyle(0xffffff, 1); g.fillTriangle(0, 0, 30, 0, 15, 22);
    g.generateTexture('arrow', 30, 22); g.destroy();

    this.propHand(scene);

    // 5-point star (merge bursts, star pips)
    g = this._g(scene);
    g.fillStyle(0xffffff, 1);
    (() => {
      const cx = 16, cy = 17, R = 15, r = 6.2;
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? R : r;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
      }
      g.fillPoints(pts, true);
    })();
    g.generateTexture('star', 32, 34); g.destroy();

    // heart (lives)
    g = this._g(scene);
    g.fillStyle(0xef5350, 1);
    g.fillEllipse(11, 11, 18, 18); g.fillEllipse(25, 11, 18, 18);
    g.fillTriangle(2, 15, 34, 15, 18, 34);
    g.generateTexture('heart', 36, 36); g.destroy();

    // gacha capsule (two-tone pill)
    g = this._g(scene);
    g.fillStyle(0xffffff, 1); g.fillEllipse(26, 26, 46, 46);
    g.fillStyle(0xef5350, 1);
    g.beginPath(); g.arc(26, 26, 23, Math.PI, 0, false); g.fillPath();
    g.lineStyle(4, 0x263238, 1); g.strokeEllipse(26, 26, 46, 46);
    g.lineStyle(3, 0x263238, 1); g.lineBetween(4, 26, 48, 26);
    g.generateTexture('capsule', 52, 52); g.destroy();

    // trash bin (sell target)
    g = this._g(scene);
    g.fillStyle(0x546e7a, 1); g.fillRoundedRect(10, 18, 44, 46, 6);
    g.fillStyle(0x455a64, 1); g.fillRect(6, 10, 52, 10);
    g.fillRect(24, 4, 16, 8);
    g.lineStyle(3, 0x263238, 1);
    g.strokeRoundedRect(10, 18, 44, 46, 6); g.strokeRect(6, 10, 52, 10);
    g.lineBetween(22, 26, 22, 56); g.lineBetween(32, 26, 32, 56); g.lineBetween(42, 26, 42, 56);
    g.generateTexture('trash', 64, 68); g.destroy();

    // slot pad (board tiles; tinted per zone)
    g = this._g(scene);
    g.fillStyle(0xffffff, 0.10); g.fillRoundedRect(2, 2, 92, 92, 16);
    g.lineStyle(3, 0xffffff, 0.28); g.strokeRoundedRect(2, 2, 92, 92, 16);
    g.generateTexture('slotPad', 96, 96); g.destroy();

    // ---- projectiles ----
    g = this._g(scene);
    g.fillStyle(0xffe135, 1);
    g.beginPath(); g.arc(14, 4, 12, 0.3, Math.PI - 0.3, false); g.fillPath();
    g.lineStyle(3, 0x8d6e63, 1);
    g.beginPath(); g.arc(14, 4, 12, 0.3, Math.PI - 0.3, false); g.strokePath();
    g.generateTexture('pr_banana', 28, 20); g.destroy();

    g = this._g(scene);
    g.fillStyle(0xeceff1, 1); g.fillTriangle(0, 5, 22, 0, 22, 10);
    g.fillStyle(0x8d6e63, 1); g.fillRect(22, 2, 7, 6);
    g.generateTexture('pr_blade', 30, 10); g.destroy();

    g = this._g(scene);
    g.fillStyle(0x37474f, 1); g.fillEllipse(12, 14, 22, 20);
    g.fillStyle(0x263238, 1); g.fillRect(9, 2, 6, 5);
    g.fillStyle(0xffb300, 1); g.fillEllipse(15, 3, 5, 5);
    g.generateTexture('pr_bomb', 26, 26); g.destroy();

    g = this._g(scene);
    g.lineStyle(4, 0xffffff, 0.9);
    g.beginPath(); g.arc(6, 13, 10, -1.1, 1.1, false); g.strokePath();
    g.lineStyle(3, 0xffffff, 0.5);
    g.beginPath(); g.arc(2, 13, 8, -1.0, 1.0, false); g.strokePath();
    g.generateTexture('pr_wave', 20, 28); g.destroy();

    // pea shot (the default lane bullet)
    g = this._g(scene);
    g.fillStyle(0x66bb6a, 1); g.fillEllipse(9, 9, 16, 16);
    g.fillStyle(0xa5d6a7, 1); g.fillEllipse(6, 6, 6, 6);
    g.lineStyle(2, 0x2e7d32, 1); g.strokeEllipse(9, 9, 16, 16);
    g.generateTexture('pr_pea', 18, 18); g.destroy();

    // slowing goo blob
    g = this._g(scene);
    g.fillStyle(0x4fc3f7, 1); g.fillEllipse(10, 10, 18, 16);
    g.fillStyle(0x81d4fa, 1); g.fillEllipse(7, 7, 7, 6);
    g.lineStyle(2, 0x0277bd, 1); g.strokeEllipse(10, 10, 18, 16);
    g.generateTexture('pr_goo', 20, 20); g.destroy();

    this.propCoin(scene);

    // the lane-saving moped (faces right; it rides the lane when triggered)
    g = this._g(scene);
    g.fillStyle(0x111111, 1); g.fillEllipse(14, 36, 16, 16); g.fillEllipse(50, 36, 16, 16);
    g.fillStyle(0x9e9e9e, 1); g.fillEllipse(14, 36, 8, 8); g.fillEllipse(50, 36, 8, 8);
    g.fillStyle(0xd32f2f, 1);
    g.fillRoundedRect(8, 22, 40, 12, 6);
    g.fillRoundedRect(38, 12, 16, 16, 5);
    g.fillStyle(0xb71c1c, 1); g.fillRoundedRect(10, 14, 20, 8, 4);
    g.lineStyle(4, 0x455a64, 1);
    g.beginPath(); g.moveTo(52, 14); g.lineTo(58, 4); g.strokePath();
    g.fillStyle(0xffe082, 1); g.fillEllipse(56, 20, 7, 7);
    g.generateTexture('moped', 64, 46); g.destroy();

    // shovel (dig up a unit)
    g = this._g(scene);
    g.lineStyle(7, 0x8d6e63, 1);
    g.beginPath(); g.moveTo(20, 6); g.lineTo(20, 30); g.strokePath();
    g.fillStyle(0x6d4c41, 1); g.fillRoundedRect(11, 0, 18, 8, 4);
    g.fillStyle(0xb0bec5, 1);
    g.fillRoundedRect(9, 28, 22, 22, 6);
    g.fillTriangle(9, 44, 31, 44, 20, 56);
    g.lineStyle(2, 0x546e7a, 1); g.strokeRoundedRect(9, 28, 22, 22, 6);
    g.generateTexture('shovel', 40, 58); g.destroy();
  },

  // The doge coin: the in-level currency, and a fallback for the rendered
  // assets/sprites/dogecoin.png that normally covers this key.
  //
  // The face is tan and cream ON gold rather than gold relief on gold. This
  // token is drawn at ~50px on a phone; a same-metal emboss turns to mush at
  // that size, and contrast is the entire job of a currency icon.
  propCoin(scene) {
    const g = this._g(scene);
    const GOLD = 0xf5c02a, RIM = 0xc99206, TAN = 0xe1701f, CREAM = 0xfde9c0, INK = 0x2a1a0d;
    const cx = 24;
    g.fillStyle(RIM, 1); g.fillEllipse(cx, 24, 48, 48);
    g.fillStyle(GOLD, 1); g.fillEllipse(cx, 24, 42, 42);
    g.lineStyle(2, RIM, 1); g.strokeEllipse(cx, 24, 36, 36);
    g.fillStyle(TAN, 1);
    g.fillTriangle(11, 17, 19, 5, 25, 18);
    g.fillTriangle(37, 17, 29, 5, 23, 18);
    g.fillStyle(INK, 1);
    g.fillTriangle(15, 16, 19, 9, 22, 17);
    g.fillTriangle(33, 16, 29, 9, 26, 17);
    g.fillStyle(TAN, 1); g.fillEllipse(cx, 26, 30, 26);
    g.fillStyle(CREAM, 1); g.fillEllipse(cx, 31, 16, 12);
    g.fillEllipse(18, 21, 7, 5); g.fillEllipse(30, 21, 7, 5);
    g.fillStyle(INK, 1);
    g.fillEllipse(18, 23, 4, 5); g.fillEllipse(30, 23, 4, 5);
    g.fillEllipse(cx, 29, 6, 4);
    g.fillEllipse(cx, 34, 8, 2);
    g.generateTexture('dogecoin', 48, 48); g.destroy();
  },

  // The pointing hand (fallback for assets/ui/tutorial-hand.webp).
  propHand(scene) {
    const g = this._g(scene);
      const SKIN = 0xffcc80, LINE = 0x4e342e, CUFF = 0x42a5f5;
      // sleeve cuff at the top
      g.fillStyle(CUFF, 1); g.fillRoundedRect(18, 4, 60, 26, 10);
      g.lineStyle(6, LINE, 1); g.strokeRoundedRect(18, 4, 60, 26, 10);
      // fist
      g.fillStyle(SKIN, 1); g.fillRoundedRect(16, 24, 64, 52, 20);
      g.lineStyle(6, LINE, 1); g.strokeRoundedRect(16, 24, 64, 52, 20);
      // knuckle creases, so the fist does not read as a blob
      g.lineStyle(4, LINE, 0.55);
      g.beginPath(); g.moveTo(60, 38); g.lineTo(76, 38); g.strokePath();
      g.beginPath(); g.moveTo(60, 52); g.lineTo(76, 52); g.strokePath();
      // index finger pointing down
      g.fillStyle(SKIN, 1); g.fillRoundedRect(30, 66, 26, 44, 12);
      g.lineStyle(6, LINE, 1); g.strokeRoundedRect(30, 66, 26, 44, 12);
      g.generateTexture('hand', 96, 116); g.destroy();
  },

};
window.TextureFactory = TextureFactory;
