import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const readAll = (dir: string): string => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) out.push(readFileSync(path, 'utf8'));
    }
  };
  walk(resolve(root, dir));
  return out.join('\n');
};

const frames = (): Record<string, unknown> =>
  (JSON.parse(readFileSync(resolve(root, 'public/assets/game.json'), 'utf8')) as {
    frames: Record<string, unknown>;
  }).frames;

const blanked = (): readonly string[] =>
  JSON.parse(readFileSync(resolve(root, 'tools/atlas-dead-frames.json'), 'utf8')) as string[];

/**
 * `tools/strip_dead_frames.py` empties the atlas frames nothing draws, which is
 * what took the sheet from 852 KB to 163 KB. Blanked frames are still in
 * game.json at their original coordinates, so drawing one is not an error --
 * it is a sprite that renders as nothing, which is exactly the kind of bug that
 * reaches players. This is the check that stops it.
 */
describe('packed atlas', () => {
  it('draws nothing that has been blanked out of the sheet', () => {
    const source = `${readAll('src')}\n${readAll('tests')}`;
    const referenced = blanked().filter(
      (name) =>
        source.includes(`'${name}'`) ||
        source.includes(`"${name}"`) ||
        source.includes(`\`${name}\``),
    );

    expect(referenced).toEqual([]);
  });

  it('keeps every blanked name pointing at a real frame', () => {
    // If a name here stops matching the JSON, the two files have drifted and
    // the blanking no longer means what this test thinks it means.
    const all = frames();
    for (const name of blanked()) expect(all).toHaveProperty([name]);
  });

  it('still carries the frames the game builds names for at runtime', () => {
    // ninjaFrame() and enemyFrame() assemble these, so no literal appears in
    // the source and the blanking pass has to special-case them. If that
    // special case ever breaks, every streaming fallback silently disappears.
    const all = frames();
    const dead = new Set(blanked());
    for (let tier = 1; tier <= 12; tier += 1) {
      expect(all).toHaveProperty([`ninja_t${tier}`]);
      expect(dead.has(`ninja_t${tier}`)).toBe(false);
    }
    for (let index = 0; index < 6; index += 1) {
      expect(all).toHaveProperty([`enemy_${index}`]);
      expect(dead.has(`enemy_${index}`)).toBe(false);
    }
  });
});
