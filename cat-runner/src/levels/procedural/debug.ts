/**
 * Single switch for the procedural track's debug logging (spawn, recycle,
 * chunk-type selection, connection points). No existing debug-flag
 * convention was found elsewhere in the codebase to hook into, so this stays
 * a plain module constant - flip it to `true` locally when diagnosing the
 * streamer or the director.
 */
export const CHUNK_DEBUG = false;
