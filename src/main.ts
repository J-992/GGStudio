import "./style.css";
import { Game } from "./game/Game";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const game = new Game();

let last = performance.now();
let booted = false;

function loop(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  if (booted) game.frame(dt);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

game.init(canvas).then(() => {
  booted = true;
});
