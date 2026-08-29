import './ui/style.css';
import { Game } from './game/Game';

/**
 * Entry point. Nothing between page load and the arena but the essential asset
 * set — no splash, no tutorial modal, and for a first-time player no menu
 * either: they are dropped straight into a run. The menu opens on the second
 * visit onward, when "which ninja" and "how far to the next one" are questions
 * worth asking.
 */
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

const game = new Game(canvas, ui);
void game.boot();
