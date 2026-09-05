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
  private coinCount = document.getElementById("coin-count")!;
  private coinRun = document.getElementById("coin-run")!;
  private coinRunTimer = 0;
  private toastEl = document.getElementById("unlock-toast")!;
  private toastTimer = 0;
  private autoOffer = document.getElementById("auto-offer")!;
  private autoOfferText = document.getElementById("auto-offer-text")!;
  private autoOfferTimer = 0;
  private offerFor = -1;
  private hintTimer = 0;
  private elasticEl = document.getElementById("elastic-readout")!;

  elasticStatus(text: string) {
    if (this.elasticEl.textContent !== text) this.elasticEl.textContent = text;
  }

  /**
   * Keeps `body.overlay-open` in sync with the menus. The touch pads are hidden
   * while any of them is up — they used to render straight over the title.
   */
  private refreshOverlay() {
    const open = [this.titleEl, this.pauseEl, this.finishEl, this.gameOverEl]
      .some((el) => getComputedStyle(el).display !== "none");
    document.body.classList.toggle("overlay-open", open);
  }

  hideLoading() {
    this.loadingEl.style.display = "none";
  }

  showTitle(v: boolean) {
    this.titleEl.style.display = v ? "flex" : "none";
    this.refreshOverlay();
  }

  setLevel(n: number, total: number, name: string) {
    this.levelLabel.innerHTML = `LEVEL ${n}<small>${name} · ${n}/${total}</small>`;
    this.levelLabel.style.opacity = "1";
  }

  hint(text: string, touchText?: string, dur = 4.5) {
    this.hintEl.textContent =
      touchText && document.body.classList.contains("touch") ? touchText : text;
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
    this.refreshOverlay();
  }

  showFinish(seconds: number, rescues: number, fastest: boolean, clears: number) {
    const time = formatTime(seconds);
    this.finishStats.innerHTML =
      (fastest ? `<b class="new-best">NEW BEST TIME — ${time}</b>` : `TIME ${time} · BEST ${formatTime(progress.bestTime)}`) +
      `<br/>RESCUES ${rescues} · RUNS CLEARED ${clears}<br/>` +
      (rescues > 0 ? "the tether held." : "clean run — nobody needed pulling back.");
    this.finishEl.style.display = "flex";
    this.refreshOverlay();
  }

  /**
   * The end of a run is the moment a pair finds out whether they got further
   * than last time, so it says so rather than silently dropping them at level 1.
   */
  /** Banked total, plus a brief "+n" for what this run has added. */
  setCoins(total: number, thisRun: number) {
    this.coinCount.textContent = String(total);
    if (thisRun > 0) {
      this.coinRun.textContent = `+${thisRun}`;
      this.coinRun.classList.add("show");
      this.coinRunTimer = 1.6;
    }
  }

  /**
   * Offers to fly a robot nobody is holding. Phrased as an offer, not a warning:
   * one person running the pair is a supported way to play, not a mistake.
   */
  offerAutopilot(player: number) {
    this.offerFor = player;
    this.autoOfferText.textContent =
      `${player === 0 ? "IGNIS" : "VOLTA"} IS UNMANNED — FLY IT?`;
    this.autoOffer.classList.add("show");
    this.autoOfferTimer = 8;
  }

  hideAutopilotOffer() {
    this.autoOffer.classList.remove("show");
    this.autoOfferTimer = 0;
  }

  /** Wired once at boot; hands back which robot the offer was about. */
  bindAutopilotOffer(accept: (player: number) => void) {
    document.getElementById("auto-offer-yes")!.addEventListener("click", () => {
      if (this.offerFor >= 0) accept(this.offerFor);
      this.hideAutopilotOffer();
    });
  }

  setAutopilot(player: number, on: boolean) {
    document.getElementById(`auto-badge-${player}`)!.classList.toggle("show", on);
    if (on) this.hideAutopilotOffer();
  }

  /** Announces a skin the player has just earned enough coins for. */
  unlockToast(name: string, price: number, extra: number) {
    this.toastEl.innerHTML =
      `NEW SKIN — ${name} ◎${price}` +
      `<small>${extra > 0 ? `AND ${extra} MORE · ` : ""}PAUSE TO EQUIP</small>`;
    this.toastEl.classList.add("show");
    this.toastTimer = 4.5;
  }


  private lastActPick: ((act: number) => void) | null = null;

  showGameOver(reached: number, total: number, best: number, isBest: boolean, runCoins = 0) {
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
    (document.getElementById("run-record") as HTMLElement).innerHTML =
      (isBest ? `<b class="new-best">FURTHEST YET</b>` : `YOUR BEST — <b>LEVEL ${best}</b>`) +
      (runCoins > 0 ? ` · <b class="skin-price">◎${runCoins} KEPT</b>` : "");
    this.gameOverEl.style.display = "flex";
    this.refreshOverlay();
  }



  hideGameOver() {
    this.gameOverEl.style.display = "none";
    this.refreshOverlay();
  }

  /** Title-screen act shortcuts, opened by reaching an act in a full run. */
  buildActSelect(onPick: (act: number) => void) {
    this.lastActPick = onPick;
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
    this.refreshOverlay();
  }

  update(dt: number) {
    if (this.autoOfferTimer > 0) {
      this.autoOfferTimer -= dt;
      if (this.autoOfferTimer <= 0) this.hideAutopilotOffer();
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove("show");
    }
    if (this.coinRunTimer > 0) {
      this.coinRunTimer -= dt;
      if (this.coinRunTimer <= 0) this.coinRun.classList.remove("show");
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.style.opacity = "0";
    }
  }
}
