/**
 * Build-time constants inlined by `vite.config.ts`.
 *
 * `__POKI__` is a bare boolean rather than a string compare so Rollup folds the
 * branch in `platform.ts` and drops the platform the build did not ask for.
 * A comparison that survives into the bundle -- `import.meta.env.X.trim()` is
 * the classic -- leaves the other portal's SDK loader in the output, which is
 * exactly what Poki's preflight fails a submission for.
 */
declare const __POKI__: boolean;
