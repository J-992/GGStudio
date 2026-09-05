/**
 * Uploads the build to Poki for Developers, and fails when it fails.
 *
 * That second half is why this wrapper exists. `@poki/cli upload` catches its
 * own errors, prints them, and exits 0 — so a CI step that shells straight into
 * it is green whether or not anything reached Poki, which is worse than having
 * no pipeline. The CLI runs as a child, its output is streamed through, and the
 * step only passes if the success line it prints on a 201 actually appears.
 *
 *   node scripts/poki/upload.mjs [--dry-run]
 *
 * Version name and notes come from POKI_VERSION_NAME / POKI_VERSION_NOTES in the
 * environment, never from argv built by the workflow: a commit message is text
 * somebody else wrote, and interpolating one into a `run:` block is how a
 * workflow gets a shell out of it.
 */

import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

import { readGame } from "./config.mjs";
import { bytes, preflight } from "./preflight.mjs";

/** What @poki/cli prints once the API has answered 201. Nothing else does. */
const SUCCESS = "Version uploaded successfully";

const summary = (md) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
};
const die = (m) => { console.error(`\n  FAIL  ${m}\n`); process.exit(1); };

const dryRun = process.argv.includes("--dry-run");
const game = readGame("poki.json");

if (!game.enabled) die(`poki.json has "ggs.enabled": false.`);
if (!game.registered) {
  die('no Poki game id yet — paste the id from developers.poki.com into "game_id" in poki.json.');
}

console.log(`\n  preflight  ${game.buildDir}\n`);
const checks = preflight(game);
for (const f of checks.failures) console.error(`\n  FAIL  ${f}`);
if (!checks.ok) die("the build is something Poki would reject; nothing was uploaded.");

if (dryRun) {
  console.log(`\n  dry run — preflight passed, ${bytes(checks.compressed)} gzipped, nothing uploaded\n`);
  summary(`### Poki dry run\nPreflight passed · ${bytes(checks.compressed)} gzipped · ${checks.files.length} files`);
  process.exit(0);
}

const token = process.env.POKI_UPLOAD_TOKEN;
if (!token) die("POKI_UPLOAD_TOKEN is not set; add it as a repository secret.");

const args = ["@poki/cli", "upload", game.buildDir, "--game-id", game.id];
if (process.env.POKI_VERSION_NAME) args.push("--name", process.env.POKI_VERSION_NAME);
if (process.env.POKI_VERSION_NOTES) args.push("--notes", process.env.POKI_VERSION_NOTES);
if (String(process.env.POKI_MAKE_PUBLIC) === "true") args.push("--public");

let sawSuccess = false;
const child = spawn("npx", args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    process.stdout.write(chunk);
    if (chunk.includes(SUCCESS)) sawSuccess = true;
  });
}
child.on("close", (code) => {
  // The CLI exits 0 on failure, so its exit code is not the signal — the line is.
  if (code !== 0 || !sawSuccess) {
    summary(`### Poki upload failed\nSee the log above.`);
    die(`upload did not report "${SUCCESS}".`);
  }
  console.log(`\n  uploaded  ${bytes(checks.compressed)} gzipped\n`);
  summary(
    `### Poki version uploaded\n` +
    `\`${process.env.POKI_VERSION_NAME ?? "(unnamed)"}\` · ${bytes(checks.compressed)} gzipped · ` +
    `${String(process.env.POKI_MAKE_PUBLIC) === "true" ? "**published to players**" : "not published — publish it in Poki for Developers"}`,
  );
});
