# Assets

All art and audio are currently **procedural** (generated at runtime by
`src/systems/TextureFactory.js` and `src/systems/AudioSystem.js`), so these folders are
empty placeholders. Drop real assets in and load them in a `preload()` step with the
**same texture keys** — nothing else needs to change.

```
assets/
  items/         one PNG per item key: lipstick.png, mascara.png, brush.png, palette.png,
                 polish.png, compact.png, perfume.png, sponge.png, hairclip.png,
                 skincare.png, cotton.png, jewelry.png
  containers/    tray/organizer art (currently drawn as vector trays per level config)
  room/          room backdrop layers: wall, floor, vanity, mirror, drawer unit
  decorations/   deco_<key>.png for every key in src/data/decorations.js
  ui/            buttons, icons, panels (currently vector)
  audio/         pick.mp3, drop.mp3, wrong.mp3, complete.mp3, reward.mp3 (currently WebAudio)
```

## Meshy pipeline

1. Generate each item/decoration as a **low-poly** model in Meshy (one prompt per item,
   consistent "cute pastel toy" style words across prompts).
2. Render every model from the **same 3/4 top-down camera angle**, transparent background.
3. Export PNG at 2x the sizes in `src/data/items.js` (e.g. lipstick 72x176) and let the
   game scale down — keeps sprites crisp on retina.
4. Pack into a sprite atlas (TexturePacker/free-tex-packer) as `items.png/json` for
   production; swap `TextureFactory.generateAll()` for `this.load.atlas(...)` in BootScene.
5. Keep textures ≤1024px per atlas page for low-end mobile GPUs.
