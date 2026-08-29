import "./style.css";
import { Game } from "./game/Game";
import { TouchControls } from "./ui/TouchControls";
import { Bot } from "./game/Bot";

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

const botMode = new URLSearchParams(location.search).has("bot");

game.init(canvas).then(() => {
  booted = true;
  new TouchControls(
    document.getElementById("touch-ui"),
    () => game.pauseGame(),
    () => game.muteGame(),
  );
  if (botMode) {
    game.bot = new Bot(game);
    (window as unknown as Record<string, unknown>).__TR__ &&
      ((window as any).__TR__.bot = game.bot);
  }
});
