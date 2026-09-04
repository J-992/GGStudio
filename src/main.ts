import "./style.css";
import { Game } from "./game/Game";
import { TouchControls } from "./ui/TouchControls";
import { OnlineSession } from "./network/OnlineSession";
import { poki } from "./platform/Poki";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const game = new Game();

let last = performance.now();
let booted = false;
let online: OnlineSession | null = null;

function loop(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  if (booted) {
    online?.frame(dt);
    game.frame(dt);
  }
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

if (matchMedia("(pointer: coarse)").matches || "ontouchstart" in window) {
  document.body.classList.add("touch");
}

const botMode = new URLSearchParams(location.search).has("bot");
const debugMode = import.meta.env.DEV && botMode;

void poki.init().then(() => game.init(canvas, debugMode)).then(() => {
  game.onGameplayStart = (level) => {
    poki.gameplayStart();
    poki.measureLevel(level, "start");
  };
  game.onGameplayStop = (level, result) => {
    poki.gameplayStop();
    if (result) poki.measureLevel(level, result);
  };
  game.onCommercialBreak = () => poki.commercialBreak();

  booted = true;
  new TouchControls(
    document.getElementById("touch-ui"),
    () => game.pauseGame(),
    () => game.muteGame(),
  );
  if (debugMode) {
    void import("./game/Bot").then(({ Bot }) => {
      game.bot = new Bot(game);
      (window as unknown as Record<string, unknown>).__TR__ &&
        ((window as any).__TR__.bot = game.bot);
    });
  }

  const title = document.getElementById("title-screen")!;
  const onlinePanel = document.getElementById("online-panel")!;
  const modeActions = document.getElementById("mode-actions")!;
  const localIntro = Array.from(document.querySelectorAll<HTMLElement>(".local-intro"));
  const status = document.getElementById("online-status")!;
  const code = document.getElementById("online-code")!;
  const roomInput = document.getElementById("room-code") as HTMLInputElement;

  const showOnline = (show: boolean) => {
    onlinePanel.style.display = show ? "flex" : "none";
    modeActions.style.display = show ? "none" : "flex";
    localIntro.forEach((el) => { el.style.display = show ? "none" : ""; });
    game.titleInputEnabled = !show;
    if (!show) {
      online?.close();
      document.body.classList.remove("online");
      status.textContent = "";
      code.textContent = "";
    }
  };

  online = new OnlineSession(
    game,
    (text, roomCode) => {
      status.textContent = text;
      code.textContent = roomCode ?? "";
    },
    () => {
      onlinePanel.style.display = "none";
      document.body.classList.add("online");
    },
  );

  document.getElementById("btn-local")!.addEventListener("click", () => game.startLocal());
  document.getElementById("btn-online")!.addEventListener("click", () => showOnline(true));
  document.getElementById("btn-host")!.addEventListener("click", () => online?.host());
  document.getElementById("btn-join")!.addEventListener("click", () => online?.join(roomInput.value));
  document.getElementById("btn-online-cancel")!.addEventListener("click", () => showOnline(false));
  roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") online?.join(roomInput.value);
    e.stopPropagation();
  });
  title.addEventListener("pointerdown", (e) => {
    if (onlinePanel.style.display === "flex") return;
    if ((e.target as HTMLElement).closest("button, input")) return;
    game.startLocal();
  });

  poki.loadingFinished();
}).catch((err) => {
  // A silent boot failure reads to a player (or a portal reviewer) as a frozen game.
  const el = document.getElementById("loading");
  if (el) el.textContent = "CONDUIT FAILED TO BOOT — RELOAD";
  console.error("tether-run boot failed", err);
});
