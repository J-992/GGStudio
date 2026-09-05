import { ACT_NAMES, ACT_SIZE, actCount, formatTime, progress } from "../progress/Progress";
import { SKINS, TRAILS } from "../game/Skins";

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
  private hintTimer = 0;

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

  /** Announces a skin the player has just earned enough coins for. */
  unlockToast(name: string, price: number, extra: number) {
    this.toastEl.innerHTML =
      `NEW SKIN — ${name} ◎${price}` +
      `<small>${extra > 0 ? `AND ${extra} MORE · ` : ""}PAUSE TO EQUIP</small>`;
    this.toastEl.classList.add("show");
    this.toastTimer = 4.5;
  }

  /** Title-screen skin shop. Buys with coins, equips what is already owned. */
  buildShop(onChange: () => void) {
    this.buildShopInto("shop-items", "shop-label", onChange);
  }

  /** The same shop inside the pause menu, the only way back to it mid-session. */
  buildPauseShop(onChange: () => void) {
    this.buildShopInto("pause-shop-items", "pause-shop-label", onChange);
  }

  private buildShopInto(hostId: string, labelId: string, onChange: () => void) {
    const host = document.getElementById(hostId)!;
    this.buildTrailsInto(hostId, onChange);
    host.innerHTML = "";
    for (const skin of SKINS) {
      const owned = progress.owns(skin.id);
      const active = progress.skin === skin.id;
      const b = document.createElement("button");
      b.type = "button";
      b.className = `skin-chip${active ? " active" : ""}`;
      const afford = owned || progress.coins >= skin.price;
      b.disabled = !afford;
      b.innerHTML =
        `<span class="skin-swatch">` +
        `<i style="background:#${skin.p1.toString(16).padStart(6, "0")}"></i>` +
        `<i style="background:#${skin.p2.toString(16).padStart(6, "0")}"></i>` +
        `</span>${skin.name}` +
        (owned ? (active ? " ·ON" : "") : ` <span class="skin-price">◎${skin.price}</span>`);
      if (afford) {
        b.addEventListener("click", () => {
          if (progress.buySkin(skin.id, skin.price)) {
            onChange();
            this.buildShopInto(hostId, labelId, onChange);
            if (hostId === "shop-items" && this.lastActPick) this.buildActSelect(this.lastActPick);
          }
        });
      }
      host.append(b);
    }
    document.getElementById(labelId)!.textContent = `SKINS · ◎${progress.coins}`;
  }

  /**
   * Trails are bought once and fitted per robot, so each player picks their own.
   * Clicking cycles which robot it goes on rather than needing a second control.
   */
  private buildTrailsInto(shopHostId: string, onChange: () => void) {
    const id = `${shopHostId}-trails`;
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement("div");
      host.id = id;
      host.className = "trail-row";
      document.getElementById(shopHostId)!.parentElement!.append(host);
    }
    host.innerHTML = "";
    for (let player = 0; player < 2; player++) {
      const lane = document.createElement("div");
      lane.className = `trail-lane p${player + 1}`;
      const tag = document.createElement("span");
      tag.className = "trail-tag";
      tag.textContent = player === 0 ? "IGNIS" : "VOLTA";
      lane.append(tag);
      for (const trail of TRAILS) {
        const owned = progress.ownsTrail(trail.id);
        const worn = progress.trailFor(player) === trail.id;
        const afford = owned || progress.coins >= trail.price;
        const b = document.createElement("button");
        b.type = "button";
        b.className = `trail-chip${worn ? " active" : ""}`;
        b.disabled = !afford;
        b.textContent = owned ? trail.name : `${trail.name} ◎${trail.price}`;
        if (afford) {
          b.addEventListener("click", () => {
            if (progress.buyTrail(trail.id, trail.price, player)) {
              onChange();
              this.buildShopInto(shopHostId, shopHostId === "shop-items" ? "shop-label" : "pause-shop-label", onChange);
            }
          });
        }
        lane.append(b);
      }
      host.append(lane);
    }
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
