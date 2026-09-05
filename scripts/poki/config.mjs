/**
 * Reads this game's poki.json. One game, one file, so there is a single place
 * that says what gets built, what it is allowed to reach, and how big it may be.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PLACEHOLDER = "REPLACE_WITH_POKI_GAME_ID";

export function readGame(configPath = "poki.json") {
  const path = resolve(configPath);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const ggs = raw.ggs ?? {};
  const dir = dirname(path);

  return {
    id: raw.game_id,
    dir,
    buildDir: raw.build_dir ?? "dist",
    buildPath: resolve(dir, raw.build_dir ?? "dist"),
    /** False until somebody pastes the id from Poki for Developers in. */
    registered: !!raw.game_id && raw.game_id !== PLACEHOLDER,
    enabled: ggs.enabled !== false,
    allowedOrigins: ggs.allow_origins ?? ["https://game-cdn.poki.com"],
    ignoredOrigins: ggs.ignore_origins ?? [],
    maxBytes: ggs.max_bytes ?? 8 * 1024 * 1024,
    requireSdk: ggs.require_sdk !== false,
    build: ggs.build ?? "npm run build",
    install: ggs.install ?? "npm ci",
    verify: ggs.verify ?? [],
    nodeVersion: String(ggs.node_version ?? "22"),
    tokenSecret: ggs.token_git_secret_name ?? "POKI_UPLOAD_TOKEN",
  };
}
