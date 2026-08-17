import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { platformSdk } from '../vite-plugins/platformSdk.ts';

/**
 * The Poki integration was complete in `src/app/pokiSdk.ts` and correct under
 * test long before a build containing any of it was ever produced: nothing set
 * `VITE_PLATFORM`, so `npm run build` shipped the CrazyGames SDK and Poki's
 * inspector reported — accurately — that it could not find their integration.
 *
 * These cases guard the wiring rather than the wrapper. The wrapper's own
 * behaviour lives in `poki-sdk.test.ts`; what is checked here is that a build
 * carrying it is reachable from a command, and that the command really does
 * select Poki.
 */

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;
}

/** Run the plugin's head transform the way Vite does, for one platform value. */
function injectedTags(platform: string): { tag: string; attrs?: object }[] {
  const plugin = platformSdk();
  const configResolved = plugin.configResolved;
  const transformIndexHtml = plugin.transformIndexHtml;
  if (typeof configResolved !== 'function') throw new Error('no configResolved');
  if (typeof transformIndexHtml !== 'function') {
    throw new Error('no transformIndexHtml');
  }
  // Only `env` is read, so a bare stand-in is enough to drive the hook.
  configResolved.call(
    plugin as never,
    { env: { VITE_PLATFORM: platform } } as never,
  );
  return transformIndexHtml.call(plugin as never, '', undefined as never) as {
    tag: string;
    attrs?: object;
  }[];
}

describe('poki build wiring', () => {
  it('exposes a build command that selects the Poki platform', () => {
    const pkg = readJson('../package.json');
    const scripts = pkg.scripts as Record<string, string> | undefined;
    const build = scripts?.['build:poki'];
    expect(build).toBeDefined();
    // The mode is what loads `.env.poki`; without it the build is a CrazyGames
    // build wearing a different script name.
    expect(build).toContain('--mode poki');
    // Type errors must still block a portal submission.
    expect(build).toContain('tsc --noEmit');
  });

  it('selects Poki from the env file that build mode loads', () => {
    const env = readFileSync(new URL('../.env.poki', import.meta.url), 'utf8');
    expect(env).toMatch(/^VITE_PLATFORM=poki$/m);
  });

  it("puts Poki's loader in the head, and only for a Poki build", () => {
    const tags = injectedTags('poki');
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({
      tag: 'script',
      injectTo: 'head',
      attrs: { src: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js' },
    });

    // No other build may reach out to Poki's CDN.
    expect(injectedTags('crazygames')).toHaveLength(0);
    expect(injectedTags('none')).toHaveLength(0);
    expect(injectedTags('')).toHaveLength(0);
  });
});
