import { defineConfig } from 'vite';
import { platformSdk } from './plugins/platformSdk.mjs';

/**
 * One config, two targets.
 *
 * The portal is chosen here rather than through a shell environment variable so
 * that `bun run build` produces the same bytes on every machine, and so the
 * value the bundler inlines and the value the SDK tag is keyed off can never
 * drift apart.
 *
 * Poki hosts the build themselves from a path nobody here controls, so every
 * URL in it has to be relative (`base: './'`) and every byte has to be in the
 * bundle -- a build that reaches out to a CDN for a font or a library is
 * rejected. The only external request a Poki build makes is Poki's own SDK.
 */
export function makeConfig ({ platform, dev = false })
{
    return defineConfig({
        base: './',
        logLevel: dev ? 'info' : 'warning',
        //  Read by src/game/platform/platform.ts. A bare boolean rather than
        //  the platform name so the bundler can fold the branch away: the
        //  playtest build then contains no Poki code and no Poki URL at all,
        //  rather than dead code nobody can prove is unreachable.
        define: {
            'import.meta.env.VITE_POKI': platform === 'poki'
        },
        build: {
            //  Poki serves this to phones on mobile data; the target is the
            //  oldest thing worth supporting, not the newest thing that works.
            target: 'es2019',
            assetsInlineLimit: 4096,
            //  Two chunks: the engine, which never changes between builds, and
            //  the game, which does.
            rollupOptions: {
                output: {
                    manualChunks: { phaser: ['phaser'] }
                }
            },
            minify: 'terser',
            terserOptions: {
                compress: { passes: 2, drop_console: true, drop_debugger: true },
                mangle: true,
                format: { comments: false }
            },
            //  The point of the size discipline is knowing when it slips.
            chunkSizeWarningLimit: 1600,
            reportCompressedSize: true
        },
        server: {
            port: 8080,
            //  A phone on the LAN has to be able to reach the dev server: a
            //  portrait game that was only ever checked on a desktop is a game
            //  that has never been played the way it ships.
            host: true
        },
        preview: {
            port: 8080,
            host: true
        },
        plugins: [ platformSdk(platform) ]
    });
}
