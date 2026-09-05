import { ACT_NAMES, ACT_SIZE, actCount, formatTime, progress } from "../progress/Progress";

export class UI {
  private levelLabel = document.getElementById("level-label")!;
  private hintEl = document.getElementById("hint")!;
  private rescue = document.getElementById("rescue-popup")!;
  private banner = document.getElementById("banner")!;
  private bannerMain = document.getElementById("banner-main")!;
  private bannerSub = document.getElementById("banner-sub")!;
  private flashEl = document.getElementById("flash")!;
  private pauseEl = document.getElementById("pause-overlay")!;
  private titleEl = document.getElementById("title-screen")!;
  private finishEl = document.getElementById("finish-screen")!;
  private finishStats = document.getElementById("finish-stats")!;
  private loadingEl = document.getElementById("loading")!;
  private gameOverEl = document.getElementById("gameover-screen")!;
  private hintTimer = 0;

  hideLoading() {
    this.loadingEl.style.display = "none";
  }

  showTitle(v: boolean) {
    this.titleEl.style.display = v ? "flex" : "none";
  }

  setLevel(n: number, total: number, name: string) {
    this.levelLabel.innerHTML = `LEVEL ${n}<small>${name} · ${n}/${total}</small>`;
    this.levelLabel.style.opacity = "1";
  }

  hint(text: string, dur = 4.5) {
    this.hintEl.textContent = text;
    this.hintEl.style.opacity = "1";
    this.hintTimer = dur;
  }

  clearHint() {
    this.hintTimer = 0;
    this.hintEl.style.opacity = "0";
  }

  bannerShow(main: string, sub: string, color: string) {
    this.bannerMain.textContent = main;
    this.bannerMain.style.color = color;
    this.bannerSub.textContent = sub;
    this.banner.style.opacity = "1";
  }

  bannerHide() {
    this.banner.style.opacity = "0";
  }

  rescuePopup() {
    this.rescue.classList.remove("show");
    void this.rescue.offsetWidth;
    this.rescue.classList.add("show");
  }

  flash(color: string, alpha: number) {
    this.flashEl.style.transition = "none";
    this.flashEl.style.background = color;
    this.flashEl.style.opacity = String(alpha);
    requestAnimationFrame(() => {
      this.flashEl.style.transition = "opacity 0.45s ease-out";
      this.flashEl.style.opacity = "0";
    });
  }

  pause(v: boolean) {
    this.pauseEl.style.display = v ? "flex" : "none";
  }

  showFinish(seconds: number, rescues: number, fastest: boolean, clears: number) {
    const time = formatTime(seconds);
    this.finishStats.innerHTML =
      (fastest ? `<b class="new-best">NEW BEST TIME — ${time}</b>` : `TIME ${time} · BEST ${formatTime(progress.bestTime)}`) +
      `<br/>RESCUES ${rescues} · RUNS CLEARED ${clears}<br/>` +
      (rescues > 0 ? "the tether held." : "no rescues needed — try letting each other fall.");
    this.finishEl.style.display = "flex";
  }

  /**
   * The end of a run is the moment a pair finds out whether they got further
   * than last time, so it says so rather than silently dropping them at level 1.
   */
  showGameOver(reached: number, total: number, best: number, isBest: boolean) {
    (document.getElementById("run-reached") as HTMLElement).textContent =
      `REACHED LEVEL ${reached} OF ${total}`;
    (document.getElementById("run-reached-name") as HTMLElement).textContent =
      `ACT ${ACT_NAMES[Math.floor((reached - 1) / ACT_SIZE)] ?? ""}`;
    const fill = document.getElementById("run-bar-fill") as HTMLElement;
    fill.style.width = "0%";
    requestAnimationFrame(() => { fill.style.width = `${(reached / total) * 100}%`; });
    const bestMark = document.getElementById("run-bar-best") as HTMLElement;
    bestMark.style.display = best > 0 ? "block" : "none";
    bestMark.style.left = `${(best / total) * 100}%`;
    (document.getElementById("run-record") as HTMLElement).innerHTML = isBest
      ? `<b class="new-best">FURTHEST YET</b>`
      : `YOUR BEST — <b>LEVEL ${best}</b>`;
    this.gameOverEl.style.display = "flex";
  }

  /** Wires the two buttons on the run-over card. Called once at boot. */
  bindGameOverActions(onAgain: () => void, onTitle: () => void) {
    document.getElementById("btn-again")!.addEventListener("click", onAgain);
    document.getElementById("btn-to-title")!.addEventListener("click", onTitle);
  }

  hideGameOver() {
    this.gameOverEl.style.display = "none";
  }

  /** Title-screen act shortcuts, opened by reaching an act in a full run. */
  buildActSelect(onPick: (act: number) => void) {
    const host = document.getElementById("act-buttons")!;
    host.innerHTML = "";
    const unlocked = progress.acts;
    for (let a = 0; a < actCount(); a++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = `${a + 1} · ${ACT_NAMES[a] ?? ""}`;
      b.disabled = a >= unlocked;
      if (!b.disabled) b.addEventListener("click", () => onPick(a));
      host.append(b);
    }
    const label = document.getElementById("act-label")!;
    label.textContent = unlocked > 1 ? "PRACTISE AN ACT" : "ACTS OPEN AS YOU REACH THEM";
    const rec = document.getElementById("title-record")!;
    rec.textContent = progress.clears > 0
      ? `CAMPAIGN CLEARED ${progress.clears}× · BEST ${formatTime(progress.bestTime)}`
      : progress.best > 0
        ? `FURTHEST — LEVEL ${progress.best}`
        : "";
  }

  hideFinish() {
    this.finishEl.style.display = "none";
  }

  update(dt: number) {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.style.opacity = "0";
    }
  }
}
