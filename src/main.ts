import "./style.css";
import { Game } from "./game/Game";
import { TouchControls } from "./ui/TouchControls";

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

if (matchMedia("(pointer: coarse)").matches || "ontouchstart" in window) {
  document.body.classList.add("touch");
}

game.init(canvas).then(() => {
  booted = true;
  new TouchControls(
    document.getElementById("touch-ui"),
    () => game.pauseGame(),
    () => game.muteGame(),
  );
});
