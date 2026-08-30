import './styles/main.css';
import * as THREE from 'three';
import { Game } from './game/Game';
import { Poki } from './game/PokiSDK';
import { PHYSICS } from './physics/PhysicsConfig';

/**
 * Entry point.
 *
 * Deliberately thin: find the canvas, boot the game, and make any failure
 * visible on screen rather than only in the console - a blank canvas with a
 * silent error is the worst possible outcome for a browser game.
 */

async function boot(): Promise<void> {
  // Started first so Poki's load-time clock begins before a single asset is
  // fetched, and deliberately not awaited: the SDK is allowed to be slow, or
  // ad-blocked, or absent, and none of those may hold up the game. Events
  // raised while it is still coming up are buffered by the wrapper and
  // replayed in order once it answers.
  void Poki.init();

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#game-canvas is missing from the document');

  const game = new Game();
  await game.init(canvas);

  // Handy for tuning from the console, and the surface the headless playtest in
  // scripts/playtest/ drives the game through. Harmless in production.
  const globals = window as unknown as Record<string, unknown>;
  globals.__game = game;
  // THREE is bundled into a shared chunk with no global of its own, and the
  // playtest needs it to measure what is actually *drawn* - bounding boxes,
  // world quaternions - rather than just what the physics body is doing.
  globals.__three = THREE;
  globals.__physicsConfig = PHYSICS;
}

boot().catch((error: unknown) => {
  console.error('[boot] failed to start', error);

  const status = document.getElementById('loading-status');
  const message = error instanceof Error ? error.message : String(error);

  if (status) {
    status.textContent = `Could not start the game: ${message}`;
    status.classList.add('is-error');
  } else {
    document.body.innerHTML =
      `<pre style="padding:2rem;font:14px monospace;color:#c0392b">` +
      `Could not start the game:\n\n${message}</pre>`;
  }
});
