/**
 * The dev tuner is a developer-build-only opt-in. It mounts when a Vite dev
 * build carries `?dev=1`; a production bundle ignores the parameter entirely.
 * Kept in its own module so both `main.ts` and `SurvivalMode` can ask the same
 * question cheaply.
 *
 * The build check is what makes the URL safe to ship. `?dev=1&wave=20` in the
 * public build would otherwise hand every player a leaderboard exploit, and a
 * comment promising the parameter is inert is not a gate — this is.
 */
let cachedDevMode: boolean | null = null;

export function isDevMode(): boolean {
  if (cachedDevMode !== null) return cachedDevMode;
  let enabled = false;
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    enabled = import.meta.env.DEV && params.get('dev') === '1';
  } catch {
    enabled = false;
  }
  cachedDevMode = enabled;
  return enabled;
}

/** Test/manual override so unit tests can force the flag deterministically. */
export function setDevModeForTesting(value: boolean | null): void {
  cachedDevMode = value;
}

/**
 * Wave to open the game on, from `?dev=1&wave=N`.
 *
 * Checking a change at wave 12 otherwise costs a full playthrough to reach it,
 * which is the single slowest step in tuning balance. Gated behind dev mode so
 * the parameter does nothing at all in the public build — a shipped game that
 * honoured `?wave=20` would be a leaderboard exploit.
 */
export function waveJumpTarget(): number | null {
  if (!isDevMode()) return null;
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(globalThis.location?.search ?? '').get('wave');
  } catch {
    return null;
  }
  if (raw === null) return null;
  const wave = Number(raw);
  if (!Number.isFinite(wave) || !Number.isInteger(wave) || wave < 1)
    return null;
  return wave;
}
