// Generates every sprite procedurally with Phaser Graphics so the game is playable
// with zero binary assets. Swap any key for a Meshy-rendered PNG later — same key, same size.
const TextureFactory = {
  generateAll(scene) {
    this.scene = scene;
    this.particles();
    this.items();
    this.decorations();
  },

  g(w, h) {
    const gr = this.scene.make.graphics({ add: false });
    gr._w = w; gr._h = h;
    return gr;
  },
  bake(gr, key) {
    gr.generateTexture(key, gr._w, gr._h);
    gr.destroy();
  },

  // ---------- particles / helpers ----------
  particles() {
    let gr = this.g(96, 40); // soft drop shadow
    for (let i = 5; i >= 1; i--) {
      gr.fillStyle(0x5a3c50, 0.05);
      gr.fillEllipse(48, 20, 18 * i, 7.4 * i);
    }
    this.bake(gr, 'softshadow');

    gr = this.g(24, 24); // 4-point sparkle star
    gr.fillStyle(0xffffff, 1);
    gr.beginPath();
    gr.moveTo(12, 0); gr.lineTo(15, 9); gr.lineTo(24, 12); gr.lineTo(15, 15);
    gr.lineTo(12, 24); gr.lineTo(9, 15); gr.lineTo(0, 12); gr.lineTo(9, 9);
    gr.closePath(); gr.fillPath();
    this.bake(gr, 'spark');

    gr = this.g(12, 12);
    gr.fillStyle(0xffffff, 1); gr.fillRoundedRect(0, 0, 12, 12, 3);
    this.bake(gr, 'confetti');

    gr = this.g(16, 16);
    gr.fillStyle(0xffffff, 1); gr.fillCircle(8, 8, 8);
    this.bake(gr, 'dot');

    gr = this.g(40, 40); // star for completion panel
    gr.fillStyle(0xffd24a, 1);
    this.starPath(gr, 20, 20, 5, 19, 8.5);
    gr.lineStyle(3, 0xd9962e, 1);
    this.starPath(gr, 20, 20, 5, 19, 8.5, true);
    this.bake(gr, 'star');
  },

  starPath(gr, cx, cy, points, outer, inner, strokeOnly) {
    gr.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / points;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i === 0 ? gr.moveTo(x, y) : gr.lineTo(x, y);
    }
    gr.closePath();
    strokeOnly ? gr.strokePath() : gr.fillPath();
  },

  // ---------- cosmetic items ----------
  items() {
    const O = 0x6b4a5e; // outline color

    // lipstick 36x88
    let gr = this.g(36, 88);
    gr.fillStyle(0xe84a7f, 1); gr.fillRoundedRect(9, 6, 18, 30, { tl: 8, tr: 3, bl: 0, br: 0 }); // bullet
    gr.fillStyle(0xf7b32b, 1); gr.fillRoundedRect(6, 34, 24, 14, 3);   // gold collar
    gr.fillStyle(0x3d2b3d, 1); gr.fillRoundedRect(4, 48, 28, 36, 5);   // base
    gr.fillStyle(0xffffff, 0.35); gr.fillRoundedRect(11, 9, 5, 24, 2); // shine
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(4, 48, 28, 36, 5); gr.strokeRoundedRect(6, 34, 24, 14, 3);
    this.bake(gr, 'lipstick');

    // mascara 26x96
    gr = this.g(26, 96);
    gr.fillStyle(0x4a3b6b, 1); gr.fillRoundedRect(3, 4, 20, 40, 6);   // cap
    gr.fillStyle(0xe84a9b, 1); gr.fillRoundedRect(5, 44, 16, 48, 5);  // tube
    gr.fillStyle(0xffffff, 0.3); gr.fillRoundedRect(8, 8, 4, 32, 2);
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(3, 4, 20, 40, 6); gr.strokeRoundedRect(5, 44, 16, 48, 5);
    this.bake(gr, 'mascara');

    // brush 30x104
    gr = this.g(30, 104);
    gr.fillStyle(0xf2a7c3, 1); gr.fillEllipse(15, 16, 22, 28);        // bristles
    gr.fillStyle(0xd889a9, 1); gr.fillEllipse(19, 13, 8, 16);
    gr.fillStyle(0xcfd6dd, 1); gr.fillRoundedRect(7, 28, 16, 14, 3);  // ferrule
    gr.fillStyle(0xa9689b, 1); gr.fillRoundedRect(9, 42, 12, 56, 6);  // handle
    gr.lineStyle(3, O, 1);
    gr.strokeEllipse(15, 16, 22, 28); gr.strokeRoundedRect(7, 28, 16, 14, 3); gr.strokeRoundedRect(9, 42, 12, 56, 6);
    this.bake(gr, 'brush');

    // palette 104x76
    gr = this.g(104, 76);
    gr.fillStyle(0x8e6bb5, 1); gr.fillRoundedRect(2, 2, 100, 72, 12);
    gr.fillStyle(0xf2e8fa, 1); gr.fillRoundedRect(8, 8, 88, 60, 8);
    const pans = [0xe84a7f, 0xf7b32b, 0x62c48f, 0x5a9df2, 0xd96bb0, 0x8a5ad9];
    pans.forEach((c, i) => {
      const px = 24 + (i % 3) * 28, py = 24 + Math.floor(i / 3) * 28;
      gr.fillStyle(c, 1); gr.fillCircle(px, py, 11);
      gr.fillStyle(0xffffff, 0.35); gr.fillCircle(px - 3, py - 4, 3.5);
    });
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(2, 2, 100, 72, 12);
    this.bake(gr, 'palette');

    // polish 44x82
    gr = this.g(44, 82);
    gr.fillStyle(0x3d2b3d, 1); gr.fillRoundedRect(14, 2, 16, 28, 4);  // cap
    gr.fillStyle(0xf25aa3, 1); gr.fillRoundedRect(6, 32, 32, 46, 10); // bottle
    gr.fillStyle(0xffffff, 0.35); gr.fillRoundedRect(11, 38, 7, 32, 3);
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(14, 2, 16, 28, 4); gr.strokeRoundedRect(6, 32, 32, 46, 10);
    this.bake(gr, 'polish');

    // compact 78x78
    gr = this.g(78, 78);
    gr.fillStyle(0xf7c8dd, 1); gr.fillCircle(39, 39, 36);
    gr.fillStyle(0xfdeef4, 1); gr.fillCircle(39, 39, 27);
    gr.fillStyle(0xf0b6cf, 1); gr.fillCircle(39, 39, 18);              // powder
    gr.fillStyle(0xffffff, 0.5); gr.fillEllipse(30, 28, 14, 8);
    gr.lineStyle(3, O, 1); gr.strokeCircle(39, 39, 36);
    this.bake(gr, 'compact');

    // perfume 66x92
    gr = this.g(66, 92);
    gr.fillStyle(0xcfd6dd, 1); gr.fillRoundedRect(26, 2, 14, 12, 3);   // sprayer
    gr.fillStyle(0xf7b32b, 1); gr.fillRoundedRect(23, 14, 20, 12, 3);  // neck
    gr.fillStyle(0xa3d5f7, 0.95); gr.fillRoundedRect(6, 26, 54, 62, 14); // bottle
    gr.fillStyle(0x7db8e8, 0.9); gr.fillRoundedRect(6, 56, 54, 32, { tl: 0, tr: 0, bl: 14, br: 14 }); // liquid
    gr.fillStyle(0xffffff, 0.4); gr.fillRoundedRect(14, 32, 9, 40, 4);
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(6, 26, 54, 62, 14); gr.strokeRoundedRect(26, 2, 14, 12, 3);
    this.bake(gr, 'perfume');

    // sponge 54x66 (egg shape)
    gr = this.g(54, 66);
    gr.fillStyle(0xf28ba7, 1); gr.fillEllipse(27, 38, 48, 52);
    gr.fillStyle(0xf28ba7, 1); gr.fillEllipse(27, 22, 34, 38);
    gr.fillStyle(0xffffff, 0.3); gr.fillEllipse(19, 22, 10, 16);
    gr.lineStyle(3, O, 1); gr.strokeEllipse(27, 38, 48, 52);
    this.bake(gr, 'sponge');

    // hairclip 68x46 (bow)
    gr = this.g(68, 46);
    gr.fillStyle(0xf25aa3, 1);
    gr.fillTriangle(34, 23, 4, 5, 4, 41);
    gr.fillTriangle(34, 23, 64, 5, 64, 41);
    gr.fillStyle(0xd9438c, 1); gr.fillCircle(34, 23, 9);
    gr.fillStyle(0xffffff, 0.3); gr.fillTriangle(30, 18, 10, 9, 10, 20);
    gr.lineStyle(3, O, 1);
    gr.strokeTriangle(34, 23, 4, 5, 4, 41); gr.strokeTriangle(34, 23, 64, 5, 64, 41); gr.strokeCircle(34, 23, 9);
    this.bake(gr, 'hairclip');

    // skincare 48x96 (pump bottle)
    gr = this.g(48, 96);
    gr.fillStyle(0xcfd6dd, 1); gr.fillRoundedRect(18, 2, 20, 10, 3);   // pump top
    gr.fillStyle(0xcfd6dd, 1); gr.fillRect(21, 10, 8, 14);             // pump stem
    gr.fillStyle(0xbde8cf, 1); gr.fillRoundedRect(6, 24, 36, 68, 10);  // bottle
    gr.fillStyle(0xffffff, 0.75); gr.fillRoundedRect(12, 44, 24, 28, 5); // label
    gr.fillStyle(0x62c48f, 1); gr.fillCircle(24, 58, 6);
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(6, 24, 36, 68, 10); gr.strokeRoundedRect(18, 2, 20, 10, 3);
    this.bake(gr, 'skincare');

    // cotton 66x40 (pad stack)
    gr = this.g(66, 40);
    gr.fillStyle(0xe8e2ea, 1); gr.fillEllipse(33, 28, 60, 20);
    gr.fillStyle(0xf5f0f7, 1); gr.fillEllipse(33, 20, 60, 20);
    gr.fillStyle(0xffffff, 1); gr.fillEllipse(33, 12, 60, 20);
    gr.lineStyle(3, O, 0.8); gr.strokeEllipse(33, 12, 60, 20);
    this.bake(gr, 'cotton');

    // jewelry 50x50 (ring with gem)
    gr = this.g(50, 50);
    gr.lineStyle(8, 0xf7b32b, 1); gr.strokeCircle(25, 30, 14);
    gr.lineStyle(3, O, 1); gr.strokeCircle(25, 30, 18); gr.strokeCircle(25, 30, 10);
    gr.fillStyle(0x8ad9f2, 1);
    gr.fillTriangle(25, 2, 13, 14, 37, 14); gr.fillTriangle(13, 14, 37, 14, 25, 24);
    gr.lineStyle(3, O, 1); gr.strokeTriangle(25, 2, 13, 14, 37, 14);
    gr.fillStyle(0xffffff, 0.5); gr.fillTriangle(22, 6, 18, 12, 26, 12);
    this.bake(gr, 'jewelry');

    // eyeliner 24x100 (pencil)
    gr = this.g(24, 100);
    gr.fillStyle(0xe8c39a, 1); gr.fillTriangle(12, 2, 4, 24, 20, 24);   // sharpened wood
    gr.fillStyle(0x3d2b3d, 1); gr.fillTriangle(12, 2, 9, 11, 15, 11);   // lead point
    gr.fillStyle(0x8a5ad9, 1); gr.fillRoundedRect(4, 24, 16, 72, 5);    // body
    gr.fillStyle(0xffffff, 0.3); gr.fillRoundedRect(7, 30, 4, 58, 2);
    gr.lineStyle(3, O, 1); gr.strokeTriangle(12, 2, 4, 24, 20, 24); gr.strokeRoundedRect(4, 24, 16, 72, 5);
    this.bake(gr, 'eyeliner');

    // nailfile 28x96
    gr = this.g(28, 96);
    gr.fillStyle(0xf2a7c3, 1); gr.fillRoundedRect(6, 2, 16, 66, 8);     // file board
    gr.fillStyle(0xd96bb0, 1);                                          // grit specks
    for (let i = 0; i < 12; i++) gr.fillCircle(11 + (i % 3) * 3.5, 12 + Math.floor(i / 3) * 14, 1.4);
    gr.fillStyle(0xfdf0c2, 1); gr.fillRoundedRect(8, 66, 12, 28, 5);    // handle
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(6, 2, 16, 66, 8); gr.strokeRoundedRect(8, 66, 12, 28, 5);
    this.bake(gr, 'nailfile');

    // scrunchie 62x62 (ruffled ring)
    gr = this.g(62, 62);
    gr.fillStyle(0xf2a7c3, 1);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      gr.fillCircle(31 + Math.cos(a) * 19, 31 + Math.sin(a) * 19, 10);
    }
    gr.fillStyle(0xd96bb0, 1);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      gr.fillCircle(31 + Math.cos(a) * 19, 31 + Math.sin(a) * 19, 6);
    }
    gr.lineStyle(3, O, 1); gr.strokeCircle(31, 31, 29); gr.strokeCircle(31, 31, 9);
    this.bake(gr, 'scrunchie');

    // tweezers 30x92
    gr = this.g(30, 92);
    gr.fillStyle(0xcfd6dd, 1);
    gr.fillTriangle(11, 14, 3, 86, 12, 90);                             // left arm
    gr.fillTriangle(19, 14, 27, 86, 18, 90);                            // right arm
    gr.fillStyle(0xf7b32b, 1); gr.fillRoundedRect(9, 2, 12, 16, 5);     // joined top band
    gr.lineStyle(3, O, 1);
    gr.strokeTriangle(11, 14, 3, 86, 12, 90); gr.strokeTriangle(19, 14, 27, 86, 18, 90);
    gr.strokeRoundedRect(9, 2, 12, 16, 5);
    this.bake(gr, 'tweezers');
  },

  // ---------- room decorations ----------
  decorations() {
    const O = 0x6b4a5e;

    let gr = this.g(80, 110); // flower_vase
    gr.fillStyle(0xa3d5f7, 1); gr.fillRoundedRect(24, 56, 32, 50, { tl: 6, tr: 6, bl: 14, br: 14 });
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(24, 56, 32, 50, { tl: 6, tr: 6, bl: 14, br: 14 });
    [[40, 20, 0xf25aa3], [22, 34, 0xf7b32b], [58, 34, 0xd96bb0]].forEach(([x, y, c]) => {
      gr.lineStyle(3, 0x62a86f, 1); gr.lineBetween(x, y + 8, 40, 60);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        gr.fillStyle(c, 1); gr.fillCircle(x + Math.cos(a) * 8, y + Math.sin(a) * 8, 6);
      }
      gr.fillStyle(0xffe08a, 1); gr.fillCircle(x, y, 5);
    });
    this.bake(gr, 'deco_flower_vase');

    gr = this.g(90, 100); // plush_bunny
    gr.fillStyle(0xf5e6ed, 1);
    gr.fillEllipse(32, 26, 14, 40); gr.fillEllipse(58, 26, 14, 40);   // ears
    gr.fillStyle(0xf2c7dd, 1); gr.fillEllipse(32, 28, 7, 26); gr.fillEllipse(58, 28, 7, 26);
    gr.fillStyle(0xf5e6ed, 1); gr.fillCircle(45, 58, 26);             // head
    gr.fillEllipse(45, 88, 50, 26);                                    // body
    gr.fillStyle(0x3d2b3d, 1); gr.fillCircle(37, 55, 3); gr.fillCircle(53, 55, 3);
    gr.fillStyle(0xf25aa3, 1); gr.fillEllipse(45, 64, 8, 5);
    gr.lineStyle(3, O, 1); gr.strokeCircle(45, 58, 26); gr.strokeEllipse(32, 26, 14, 40); gr.strokeEllipse(58, 26, 14, 40);
    this.bake(gr, 'deco_plush_bunny');

    gr = this.g(60, 90); // candle
    gr.fillStyle(0xffe08a, 1); gr.fillEllipse(30, 18, 10, 16);
    gr.fillStyle(0xf7913d, 1); gr.fillEllipse(30, 21, 6, 9);
    gr.fillStyle(0xf5cfd9, 1); gr.fillRoundedRect(12, 30, 36, 54, 8);
    gr.fillStyle(0xffffff, 0.4); gr.fillRoundedRect(17, 36, 8, 40, 3);
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(12, 30, 36, 54, 8);
    this.bake(gr, 'deco_candle');

    gr = this.g(110, 90); // wall_art
    gr.fillStyle(0xd9a86c, 1); gr.fillRoundedRect(0, 0, 110, 90, 8);
    gr.fillStyle(0xfdf6ec, 1); gr.fillRoundedRect(10, 10, 90, 70, 4);
    gr.fillStyle(0x8ad9f2, 1); gr.fillCircle(38, 38, 16);
    gr.fillStyle(0xf2a7c3, 1); gr.fillTriangle(50, 80, 72, 40, 94, 80);
    gr.fillStyle(0x62c48f, 1); gr.fillTriangle(16, 80, 40, 48, 64, 80);
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(0, 0, 110, 90, 8);
    this.bake(gr, 'deco_wall_art');

    gr = this.g(100, 100); // mirror_round
    gr.fillStyle(0xf7b32b, 1); gr.fillCircle(50, 50, 48);
    gr.fillStyle(0xcfeaf7, 1); gr.fillCircle(50, 50, 38);
    gr.fillStyle(0xffffff, 0.6); gr.fillEllipse(38, 36, 16, 24);
    gr.lineStyle(3, O, 1); gr.strokeCircle(50, 50, 48);
    this.bake(gr, 'deco_mirror_round');

    gr = this.g(130, 70); // wall_shelf
    gr.fillStyle(0xd9a86c, 1); gr.fillRoundedRect(0, 40, 130, 14, 5);
    gr.fillStyle(0xf25aa3, 1); gr.fillRoundedRect(14, 16, 18, 24, 3);  // book
    gr.fillStyle(0x8a5ad9, 1); gr.fillRoundedRect(34, 12, 18, 28, 3);  // book
    gr.fillStyle(0xbde8cf, 1); gr.fillRoundedRect(70, 18, 22, 22, 6);  // pot
    gr.fillStyle(0x62c48f, 1); gr.fillCircle(81, 12, 10);
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(0, 40, 130, 14, 5);
    this.bake(gr, 'deco_wall_shelf');

    gr = this.g(100, 130); // plant
    gr.fillStyle(0xe8a87c, 1); gr.fillRoundedRect(30, 86, 40, 40, { tl: 4, tr: 4, bl: 12, br: 12 });
    gr.fillStyle(0x62c48f, 1);
    gr.fillEllipse(50, 50, 20, 66); gr.fillEllipse(26, 62, 16, 50); gr.fillEllipse(74, 62, 16, 50);
    gr.fillStyle(0x4da878, 1); gr.fillEllipse(38, 56, 12, 44); gr.fillEllipse(62, 56, 12, 44);
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(30, 86, 40, 40, { tl: 4, tr: 4, bl: 12, br: 12 });
    this.bake(gr, 'deco_plant');

    gr = this.g(240, 70); // rug
    gr.fillStyle(0xf2c7dd, 1); gr.fillEllipse(120, 35, 236, 64);
    gr.fillStyle(0xf5d9e8, 1); gr.fillEllipse(120, 35, 180, 46);
    gr.fillStyle(0xfdeef4, 1); gr.fillEllipse(120, 35, 120, 30);
    gr.lineStyle(3, O, 0.6); gr.strokeEllipse(120, 35, 236, 64);
    this.bake(gr, 'deco_rug');

    gr = this.g(90, 80); // basket
    gr.fillStyle(0xe8c39a, 1); gr.fillRoundedRect(6, 26, 78, 50, { tl: 6, tr: 6, bl: 20, br: 20 });
    gr.lineStyle(3, 0xc79a68, 1);
    for (let i = 0; i < 3; i++) gr.lineBetween(8, 40 + i * 12, 82, 40 + i * 12);
    gr.lineStyle(6, 0xd9a86c, 1); gr.beginPath(); gr.arc(45, 28, 26, Math.PI, 0); gr.strokePath();
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(6, 26, 78, 50, { tl: 6, tr: 6, bl: 20, br: 20 });
    this.bake(gr, 'deco_basket');

    gr = this.g(90, 110); // mushroom lamp
    gr.fillStyle(0xf25aa3, 1); gr.beginPath(); gr.arc(45, 44, 40, Math.PI, 0); gr.closePath(); gr.fillPath();
    gr.fillStyle(0xffffff, 0.8); gr.fillCircle(28, 28, 7); gr.fillCircle(56, 20, 5);
    gr.fillStyle(0xfdf0c2, 1); gr.fillRoundedRect(35, 44, 20, 46, 5);
    gr.fillStyle(0xd9a86c, 1); gr.fillRoundedRect(22, 90, 46, 14, 6);
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(35, 44, 20, 46, 5); gr.strokeRoundedRect(22, 90, 46, 14, 6);
    this.bake(gr, 'deco_lamp');

    gr = this.g(80, 110); // jewelry_stand
    gr.fillStyle(0xf7b32b, 1); gr.fillRoundedRect(14, 96, 52, 12, 5);
    gr.fillStyle(0xf7b32b, 1); gr.fillRect(37, 30, 6, 66);
    gr.lineStyle(6, 0xf7b32b, 1); gr.beginPath(); gr.arc(40, 32, 22, Math.PI * 0.15, Math.PI * 0.85, true); gr.strokePath();
    gr.fillStyle(0x8ad9f2, 1); gr.fillCircle(20, 42, 6); gr.fillCircle(60, 42, 6);
    gr.fillStyle(0xf25aa3, 1); gr.fillCircle(40, 12, 7);
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(14, 96, 52, 12, 5);
    this.bake(gr, 'deco_jewelry_stand');

    gr = this.g(110, 70); // perfume_tray
    gr.fillStyle(0xf5d9e8, 1); gr.fillRoundedRect(2, 46, 106, 18, 8);
    gr.fillStyle(0xa3d5f7, 1); gr.fillRoundedRect(14, 18, 24, 30, 6);
    gr.fillStyle(0xf2a7c3, 1); gr.fillRoundedRect(46, 10, 20, 38, 6);
    gr.fillStyle(0xffe08a, 1); gr.fillRoundedRect(74, 22, 22, 26, 6);
    gr.lineStyle(3, O, 1); gr.strokeRoundedRect(2, 46, 106, 18, 8);
    this.bake(gr, 'deco_perfume_tray');

    gr = this.g(420, 70); // string_lights
    gr.lineStyle(3, 0x9a86a8, 1);
    gr.beginPath(); gr.moveTo(0, 10);
    for (let x = 0; x <= 420; x += 10) gr.lineTo(x, 10 + Math.sin((x / 420) * Math.PI) * 26);
    gr.strokePath();
    const cols = [0xffe08a, 0xf2a7c3, 0x8ad9f2, 0xbde8cf];
    for (let i = 0; i < 8; i++) {
      const x = 26 + i * 52, y = 12 + Math.sin((x / 420) * Math.PI) * 26;
      gr.fillStyle(cols[i % 4], 1); gr.fillCircle(x, y + 12, 8);
      gr.fillStyle(0xffffff, 0.5); gr.fillCircle(x - 2, y + 9, 2.5);
    }
    this.bake(gr, 'deco_string_lights');

    gr = this.g(420, 66); // bow_banner
    gr.lineStyle(3, 0x9a86a8, 1);
    gr.beginPath(); gr.moveTo(0, 8);
    for (let x = 0; x <= 420; x += 10) gr.lineTo(x, 8 + Math.sin((x / 420) * Math.PI) * 22);
    gr.strokePath();
    for (let i = 0; i < 6; i++) {
      const x = 40 + i * 68, y = 12 + Math.sin((x / 420) * Math.PI) * 22;
      const c = i % 2 ? 0xf2a7c3 : 0xa3d5f7;
      gr.fillStyle(c, 1);
      gr.fillTriangle(x, y + 10, x - 14, y, x - 14, y + 20);
      gr.fillTriangle(x, y + 10, x + 14, y, x + 14, y + 20);
      gr.fillStyle(0xffffff, 0.5); gr.fillCircle(x, y + 10, 3.5);
    }
    this.bake(gr, 'deco_bow_banner');

    gr = this.g(100, 110); // kitty clock
    gr.fillStyle(0xf5e6ed, 1);
    gr.fillTriangle(22, 26, 12, 2, 42, 12); gr.fillTriangle(78, 26, 88, 2, 58, 12); // ears
    gr.fillCircle(50, 58, 44);
    gr.fillStyle(0xffffff, 1); gr.fillCircle(50, 58, 34);
    gr.lineStyle(4, O, 1); gr.lineBetween(50, 58, 50, 36); gr.lineBetween(50, 58, 66, 62);
    gr.fillStyle(0xf25aa3, 1); gr.fillCircle(50, 58, 4);
    gr.lineStyle(3, O, 1); gr.strokeCircle(50, 58, 44);
    gr.strokeTriangle(22, 26, 12, 2, 42, 12); gr.strokeTriangle(78, 26, 88, 2, 58, 12);
    this.bake(gr, 'deco_wall_clock');
  }
};
