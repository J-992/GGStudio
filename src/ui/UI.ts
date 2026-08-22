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

  showFinish(deaths: number, rescues: number) {
    this.finishStats.innerHTML =
      `DEATHS ${deaths} · RESCUES ${rescues}<br/>` +
      (rescues > 0 ? "the tether held." : "no rescues needed — try letting each other fall.");
    this.finishEl.style.display = "flex";
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
