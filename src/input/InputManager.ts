import { touchState } from "./touchState";

export type PlayerIndex = 0 | 1;

export interface PlayerInput {
  lateral: number;
  jumpHeld: boolean;
  jumpPressed: boolean;
}

export interface BotSource {
  lat: number;
  jump: boolean;
  active: boolean;
}

export class InputManager {
  private botSrc: BotSource | null = null;
  private remoteSrc: BotSource | null = null;
  private prevBotJump = false;

  setBotSource(src: BotSource | null) {
    this.botSrc = src;
  }

  setRemoteSource(src: BotSource | null) {
    this.remoteSrc = src;
  }

  private keys = new Set<string>();
  private padJumpPrev: boolean[][] = [];
  onAnyKey?: () => void;
  onPauseToggle?: () => void;
  onRestart?: () => void;
  onMuteToggle?: () => void;

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) {
        if (isGameKey(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      if (isGameKey(e.code)) e.preventDefault();
      if (e.code === "Escape") this.onPauseToggle?.();
      if (e.code === "KeyR") this.onRestart?.();
      if (e.code === "KeyM") this.onMuteToggle?.();
      this.onAnyKey?.();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.clearMovementKeys());
  }

  sample(player: PlayerIndex): PlayerInput {
    let lat = 0;
    let jumpHeld = false;
    let jumpPressed = false;
    if (player === 0) {
      if (this.keys.has("KeyA")) lat -= 1;
      if (this.keys.has("KeyD")) lat += 1;
      if (touchState.p1l) lat -= 1;
      if (touchState.p1r) lat += 1;
      jumpHeld = this.keys.has("KeyW") || touchState.p1j;
      const tLatch = touchState.p1jLatch;
      touchState.p1jLatch = false;
      jumpPressed =
        (this.keys.has("KeyW") && !this.keyPrevW) || tLatch;
      this.keyPrevW = this.keys.has("KeyW");
    } else {
      if (this.keys.has("ArrowLeft")) lat -= 1;
      if (this.keys.has("ArrowRight")) lat += 1;
      if (touchState.p2l) lat -= 1;
      if (touchState.p2r) lat += 1;
      jumpHeld = this.keys.has("ArrowUp") || touchState.p2j;
      const tLatch = touchState.p2jLatch;
      touchState.p2jLatch = false;
      jumpPressed =
        (this.keys.has("ArrowUp") && !this.keyPrevUp) || tLatch;
      this.keyPrevUp = this.keys.has("ArrowUp");
    }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const padIdx = player === 0 ? 0 : 1;
    let slot = 0;
    for (const p of pads) {
      if (!p) continue;
      if (slot++ !== padIdx) continue;
      const ax = p.axes[0] ?? 0;
      if (Math.abs(ax) > 0.35) lat += Math.sign(ax);
      const j = p.buttons[0]?.pressed ?? false;
      if (!this.padJumpPrev[player]) this.padJumpPrev[player] = [false];
      if (j && !this.padJumpPrev[player][0]) jumpPressed = true;
      if (j) jumpHeld = true;
      this.padJumpPrev[player][0] = j;
      break;
    }
    if (this.botSrc?.active) {
      lat = Math.max(-1, Math.min(1, this.botSrc.lat));
      jumpHeld = this.botSrc.jump;
      jumpPressed = this.botSrc.jump && !this.prevBotJump;
      this.prevBotJump = this.botSrc.jump;
    }
    if (player === 1 && this.remoteSrc?.active) {
      lat = Math.max(-1, Math.min(1, this.remoteSrc.lat));
      jumpHeld = this.remoteSrc.jump;
      jumpPressed = this.remoteSrc.jump && !this.prevRemoteJump;
      this.prevRemoteJump = this.remoteSrc.jump;
    }
    lat = Math.max(-1, Math.min(1, lat));
    return { lateral: lat, jumpHeld, jumpPressed };
  }

  clearMovementKeys() {
    this.keys.clear();
    this.keyPrevW = false;
    this.keyPrevUp = false;
    this.prevBotJump = false;
    this.prevRemoteJump = false;
    touchState.p1l = touchState.p1r = touchState.p1j = false;
    touchState.p2l = touchState.p2r = touchState.p2j = false;
    touchState.p1jLatch = touchState.p2jLatch = false;
  }

  private keyPrevW = false;
  private keyPrevUp = false;
  private prevRemoteJump = false;
}

function isGameKey(code: string): boolean {
  return (
    code === "ArrowLeft" || code === "ArrowRight" || code === "ArrowUp" ||
    code === "ArrowDown" || code === "Space" || code === "KeyA" ||
    code === "KeyD" || code === "KeyW"
  );
}
