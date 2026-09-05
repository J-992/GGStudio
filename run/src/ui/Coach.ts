import * as THREE from "three";

const _v = new THREE.Vector3();

interface Learned {
  moved: boolean;
  jumped: boolean;
}

/**
 * Teaches the controls where the confusion actually is: which keys drive which
 * robot. A label rides above each one showing its own keys, each half ticking
 * off as it gets used, and the whole thing retires for good once a player has
 * shown they can move and jump both robots.
 */
export class Coach {
  private root = document.getElementById("coach")!;
  private tags = [
    document.getElementById("coach-p1")!,
    document.getElementById("coach-p2")!,
  ];
  private moveEls = this.tags.map((t) => t.querySelector(".coach-move") as HTMLElement);
  private jumpEls = this.tags.map((t) => t.querySelector(".coach-jump") as HTMLElement);
  private learned: Learned[] = [
    { moved: false, jumped: false },
    { moved: false, jumped: false },
  ];
  private visible = false;
  private elapsed = 0;

  /** True once both robots have been moved and jumped. */
  get complete(): boolean {
    return this.learned.every((l) => l.moved && l.jumped);
  }

  private labels(touch: boolean): [string, string][] {
    // On touch the pads are colour-matched to the robots, so the label only has
    // to name the action; the colour says which pad.
    return touch
      ? [["◀ ▶", "JUMP"], ["◀ ▶", "JUMP"]]
      : [["A  D", "W"], ["◀  ▶", "▲"]];
  }

  start() {
    const touch = document.body.classList.contains("touch");
    const text = this.labels(touch);
    for (let i = 0; i < 2; i++) {
      this.moveEls[i].textContent = text[i][0];
      this.jumpEls[i].textContent = text[i][1];
      this.moveEls[i].classList.remove("done");
      this.jumpEls[i].classList.remove("done");
      this.tags[i].classList.add("show");
      this.tags[i].style.opacity = "1";
      this.learned[i] = { moved: false, jumped: false };
    }
    this.visible = true;
    this.elapsed = 0;
    document.body.classList.add("coaching");
  }

  stop() {
    this.visible = false;
    document.body.classList.remove("coaching");
    for (const t of this.tags) t.classList.remove("show");
  }

  /** Records that a robot did something, so its half of the label can tick off. */
  note(player: number, what: "moved" | "jumped") {
    if (!this.visible) return;
    const l = this.learned[player];
    if (l[what]) return;
    l[what] = true;
    (what === "moved" ? this.moveEls : this.jumpEls)[player].classList.add("done");
  }

  /**
   * Pins each label over its robot. Called every rendered frame while level one
   * is running; `positions` are world-space, `camera` projects them to screen.
   */
  update(
    dt: number,
    camera: THREE.Camera,
    canvas: HTMLElement,
    positions: [THREE.Vector3, THREE.Vector3],
  ) {
    if (!this.visible) return;
    this.elapsed += dt;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (let i = 0; i < 2; i++) {
      _v.copy(positions[i]).project(camera);
      const onScreen = _v.z < 1 && Math.abs(_v.x) < 1.3 && Math.abs(_v.y) < 1.3;
      this.tags[i].style.opacity = onScreen ? "1" : "0";
      if (!onScreen) continue;
      this.tags[i].style.left = `${(_v.x * 0.5 + 0.5) * w}px`;
      this.tags[i].style.top = `${(-_v.y * 0.5 + 0.5) * h - 74}px`;
    }

    // Retire once they have shown they can do it, or if they clearly do not need
    // telling. The fade is short so it never overstays the opening runway.
    if (this.complete && this.elapsed > 1.2) this.fadeOut();
    else if (this.elapsed > 16) this.fadeOut();
  }

  private fadeOut() {
    for (const t of this.tags) t.style.opacity = "0";
    this.visible = false;
    document.body.classList.remove("coaching");
    window.setTimeout(() => {
      for (const t of this.tags) t.classList.remove("show");
    }, 400);
  }

  dispose() {
    this.stop();
    void this.root;
  }
}
