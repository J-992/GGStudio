// All sprite art, generated at runtime with Graphics. Every key here can be
// replaced 1:1 later by a rendered Meshy model with the same key (see assets/README.md).
const TextureFactory = {
  generate(scene) {
    this.runnerA(scene);
    this.runnerB(scene);
    this.bolt(scene);
    this.gearHaz(scene);
    this.clouds(scene);
    this.shadow(scene);
    this.particles(scene);
    this.padGlyph(scene);
    this.touchButtons(scene);
  },

  g(scene) { return scene.make.graphics({ x: 0, y: 0, add: false }); },

  // Mascot A: "Volt" — tall round teal robot, single bobble antenna. Back view.
  runnerA(scene) {
    const g = this.g(scene);
    // antenna
    g.lineStyle(6, 0x2c7f8c, 1); g.lineBetween(48, 26, 48, 8);
    g.fillStyle(0xffd35c, 1); g.fillCircle(48, 8, 8);
    // head
    g.fillStyle(0x53c8d6, 1); g.fillRoundedRect(24, 18, 48, 38, 16);
    g.fillStyle(0x3aa8b8, 1); g.fillRoundedRect(24, 40, 48, 16, { tl: 0, tr: 0, bl: 14, br: 14 });
    // ear dots
    g.fillStyle(0xffffff, 1); g.fillCircle(27, 34, 5); g.fillCircle(69, 34, 5);
    // body
    g.fillStyle(0x53c8d6, 1); g.fillRoundedRect(18, 52, 60, 46, 18);
    // backpack
    g.fillStyle(0x2c7f8c, 1); g.fillRoundedRect(32, 58, 32, 30, 10);
    g.fillStyle(0xffd35c, 1); g.fillCircle(48, 73, 6);
    g.fillStyle(0x9ef0e0, 1); g.fillCircle(38, 64, 3); g.fillCircle(58, 64, 3);
    // arms
    g.fillStyle(0x3aa8b8, 1); g.fillRoundedRect(10, 60, 12, 26, 6); g.fillRoundedRect(74, 60, 12, 26, 6);
    // legs
    g.fillStyle(0x2c7f8c, 1); g.fillRoundedRect(28, 96, 14, 14, 5); g.fillRoundedRect(54, 96, 14, 14, 5);
    g.fillStyle(0x255f68, 1); g.fillRoundedRect(26, 106, 18, 8, 4); g.fillRoundedRect(52, 106, 18, 8, 4);
    g.generateTexture('runnerA', 96, 116);
    g.destroy();
  },

  // Mascot B: "Bea" — short square orange robot, twin ear flaps. Back view.
  runnerB(scene) {
    const g = this.g(scene);
    // ear flaps
    g.fillStyle(0xd66a1f, 1);
    g.fillTriangle(20, 30, 34, 14, 38, 34);
    g.fillTriangle(80, 30, 66, 14, 62, 34);
    // head
    g.fillStyle(0xff9a3d, 1); g.fillRoundedRect(28, 18, 44, 34, 10);
    g.fillStyle(0xd66a1f, 1); g.fillRoundedRect(28, 38, 44, 14, { tl: 0, tr: 0, bl: 9, br: 9 });
    g.fillStyle(0xffffff, 1); g.fillCircle(35, 30, 4); g.fillCircle(65, 30, 4);
    // body — wide box
    g.fillStyle(0xff9a3d, 1); g.fillRoundedRect(16, 50, 68, 42, 12);
    // backpack coil
    g.fillStyle(0xd66a1f, 1); g.fillRoundedRect(30, 56, 40, 28, 8);
    g.lineStyle(4, 0xffd35c, 1);
    g.strokeCircle(50, 70, 9);
    g.strokeCircle(50, 70, 4);
    // arms
    g.fillStyle(0xd66a1f, 1); g.fillRoundedRect(8, 58, 11, 24, 5); g.fillRoundedRect(81, 58, 11, 24, 5);
    // legs
    g.fillStyle(0xb35315, 1); g.fillRoundedRect(28, 90, 15, 12, 5); g.fillRoundedRect(57, 90, 15, 12, 5);
    g.fillStyle(0x8f3f0d, 1); g.fillRoundedRect(26, 99, 19, 8, 4); g.fillRoundedRect(55, 99, 19, 8, 4);
    g.generateTexture('runnerB', 100, 108);
    g.destroy();
  },

  // Collectible: a chunky golden bolt/gear.
  bolt(scene) {
    const g = this.g(scene);
    const cx = 22, cy = 22;
    g.fillStyle(0xf4b41f, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.fillCircle(cx + Math.cos(a) * 14, cy + Math.sin(a) * 14, 5);
    }
    g.fillCircle(cx, cy, 14);
    g.fillStyle(0xffd35c, 1); g.fillCircle(cx, cy, 10);
    g.fillStyle(0xb8860b, 1); g.fillCircle(cx, cy, 5);
    g.generateTexture('bolt', 44, 44);
    g.destroy();
  },

  // Hazard: big factory gear.
  gearHaz(scene) {
    const g = this.g(scene);
    const cx = 80, cy = 80;
    g.fillStyle(0x8b93a5, 1);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.fillRoundedRect(cx + Math.cos(a) * 58 - 11, cy + Math.sin(a) * 58 - 11, 22, 22, 6);
    }
    g.fillCircle(cx, cy, 62);
    g.fillStyle(0x6d7688, 1); g.fillCircle(cx, cy, 46);
    g.fillStyle(0x8b93a5, 1);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      g.fillCircle(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30, 8);
    }
    g.fillStyle(0xffd35c, 1); g.fillCircle(cx, cy, 14);
    g.fillStyle(0xb8860b, 1); g.fillCircle(cx, cy, 6);
    g.generateTexture('gearHaz', 160, 160);
    g.destroy();
  },

  clouds(scene) {
    const defs = [
      [110, 46, [[30, 30, 22], [58, 22, 26], [86, 32, 20], [50, 36, 24]]],
      [80, 38, [[24, 24, 18], [48, 18, 20], [60, 26, 15]]],
      [140, 52, [[34, 34, 24], [70, 22, 30], [108, 34, 22], [86, 40, 22]]]
    ];
    defs.forEach((def, i) => {
      const g = this.g(scene);
      g.fillStyle(0xffffff, 1);
      def[2].forEach(([x, y, r]) => g.fillCircle(x, y, r));
      g.generateTexture('cloud' + i, def[0], def[1]);
      g.destroy();
    });
  },

  shadow(scene) {
    const g = this.g(scene);
    g.fillStyle(0x1e2b40, 0.35);
    g.fillEllipse(40, 14, 76, 24);
    g.generateTexture('shadow', 80, 28);
    g.destroy();
  },

  particles(scene) {
    let g = this.g(scene);
    g.fillStyle(0xffffff, 1); g.fillCircle(6, 6, 6);
    g.generateTexture('puff', 12, 12); g.destroy();

    g = this.g(scene);
    g.fillStyle(0xffffff, 1); g.fillCircle(4, 4, 3.2);
    g.generateTexture('spark', 8, 8); g.destroy();

    g = this.g(scene);
    g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 8, 8);
    g.generateTexture('confetti', 8, 8); g.destroy();
  },

  // Launch pad glyph: upward chevrons.
  padGlyph(scene) {
    const g = this.g(scene);
    g.fillStyle(0xffffff, 0.95);
    g.fillTriangle(24, 16, 8, 32, 40, 32);
    g.fillTriangle(24, 32, 8, 48, 40, 48);
    g.generateTexture('padGlyph', 48, 56);
    g.destroy();
  },

  touchButtons(scene) {
    let g = this.g(scene);
    g.fillStyle(0xffffff, 0.16); g.fillCircle(46, 46, 44);
    g.lineStyle(3, 0xffffff, 0.35); g.strokeCircle(46, 46, 44);
    g.generateTexture('touchBtn', 92, 92); g.destroy();

    g = this.g(scene);
    g.fillStyle(0xffffff, 0.8);
    g.fillTriangle(14, 24, 34, 8, 34, 40);
    g.generateTexture('glyphLeft', 48, 48); g.destroy();

    g = this.g(scene);
    g.fillStyle(0xffffff, 0.8);
    g.fillTriangle(34, 24, 14, 8, 14, 40);
    g.generateTexture('glyphRight', 48, 48); g.destroy();

    g = this.g(scene);
    g.fillStyle(0xffffff, 0.8);
    g.fillTriangle(24, 8, 8, 30, 40, 30);
    g.fillRect(17, 30, 14, 10);
    g.generateTexture('glyphJump', 48, 48); g.destroy();
  }
};
