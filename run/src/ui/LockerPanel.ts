import { SKINS, TRAILS, skinById, trailById } from "../game/Skins";
import { progress } from "../progress/Progress";
import { LockerPreview } from "./Locker";

type Tab = "skins" | "trails";

/**
 * The cosmetics panel. Everything is selectable before it is bought: picking a
 * card only changes what the turntable is wearing, and the button underneath is
 * what spends coins. Nothing is bought from a name and a price alone.
 */
export class LockerPanel {
  private root = document.getElementById("locker")!;
  private body = document.getElementById("locker-body")!;
  private nameEl = document.getElementById("locker-name")!;
  private blurbEl = document.getElementById("locker-blurb")!;
  private coinsEl = document.getElementById("locker-coins")!;
  private action = document.getElementById("locker-action") as HTMLButtonElement;
  private preview: LockerPreview;

  private tab: Tab = "skins";
  /** What the turntable is showing, which is not yet what is worn. */
  private pickedSkin = progress.skin;
  private pickedTrail = progress.trailFor(0);
  /** Which robot a trail is being fitted to. */
  private who = 0;
  private onChange: () => void = () => {};

  constructor() {
    this.preview = new LockerPreview(document.getElementById("locker-canvas") as HTMLCanvasElement);
    document.getElementById("locker-close")!.addEventListener("click", () => this.close());
    for (const t of document.querySelectorAll<HTMLElement>(".locker-tab")) {
      t.addEventListener("click", () => {
        this.tab = t.dataset.tab as Tab;
        for (const o of document.querySelectorAll(".locker-tab")) o.classList.toggle("active", o === t);
        this.render();
      });
    }
    this.action.addEventListener("click", () => this.commit());
  }

  get isOpen() { return this.root.classList.contains("open"); }

  open(onChange: () => void) {
    this.onChange = onChange;
    this.pickedSkin = progress.skin;
    this.pickedTrail = progress.trailFor(this.who);
    this.root.classList.add("open");
    document.body.classList.add("locker-open");
    this.preview.start();
    this.render();
  }

  close() {
    this.root.classList.remove("open");
    document.body.classList.remove("locker-open");
    this.preview.stop();
  }

  private render() {
    this.coinsEl.textContent = `◎ ${progress.coins}`;
    this.preview.setSkin(this.pickedSkin);
    this.preview.setTrail(0, this.tab === "trails" && this.who === 0 ? this.pickedTrail : progress.trailFor(0));
    this.preview.setTrail(1, this.tab === "trails" && this.who === 1 ? this.pickedTrail : progress.trailFor(1));
    this.body.innerHTML = "";
    if (this.tab === "skins") this.renderSkins();
    else this.renderTrails();
    this.renderAction();
  }

  private card(selected: boolean, owned: boolean, worn: boolean, inner: string, onPick: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `cos-card${selected ? " selected" : ""}${owned ? "" : " locked"}`;
    b.innerHTML = inner + (worn ? `<span class="cos-worn">WORN</span>` : "");
    b.addEventListener("click", onPick);
    this.body.append(b);
  }

  private renderSkins() {
    for (const skin of SKINS) {
      const owned = progress.owns(skin.id);
      const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
      this.card(
        this.pickedSkin === skin.id, owned, progress.skin === skin.id,
        `<span class="cos-swatch">` +
          `<i style="background:${hex(skin.body)}"></i>` +
          `<i style="background:${hex(skin.p1)}"></i>` +
          `<i style="background:${hex(skin.p2)}"></i></span>` +
          `<span class="cos-name">${skin.name}</span>` +
          `<span class="${owned ? "cos-owned" : "cos-cost"}">${owned ? "OWNED" : `◎${skin.price}`}</span>`,
        () => { this.pickedSkin = skin.id; this.render(); },
      );
    }
  }

  private renderTrails() {
    const who = document.createElement("div");
    who.className = "locker-who";
    who.style.gridColumn = "1 / -1";
    for (let i = 0; i < 2; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = this.who === i ? "on" : "";
      b.textContent = i === 0 ? "IGNIS" : "VOLTA";
      b.addEventListener("click", () => {
        this.who = i;
        this.pickedTrail = progress.trailFor(i);
        this.preview.clearPuffs();
        this.render();
      });
      who.append(b);
    }
    this.body.append(who);

    const skin = skinById(this.pickedSkin);
    for (const trail of TRAILS) {
      const owned = progress.ownsTrail(trail.id);
      const c = trail.color ?? (this.who === 0 ? skin.p1 : skin.p2);
      const hex = `#${c.toString(16).padStart(6, "0")}`;
      const ribbon = trail.rate === 0
        ? `<span class="cos-ribbon" style="background:rgba(255,255,255,0.08)"></span>`
        : `<span class="cos-ribbon" style="background:linear-gradient(90deg, transparent, ${hex})"></span>`;
      this.card(
        this.pickedTrail === trail.id, owned, progress.trailFor(this.who) === trail.id,
        `<span class="cos-swatch">${ribbon}</span>` +
          `<span class="cos-name">${trail.name}</span>` +
          `<span class="${owned ? "cos-owned" : "cos-cost"}">${owned ? "OWNED" : `◎${trail.price}`}</span>`,
        () => { this.pickedTrail = trail.id; this.preview.clearPuffs(); this.render(); },
      );
    }
  }

  private renderAction() {
    const isSkin = this.tab === "skins";
    const item = isSkin ? skinById(this.pickedSkin) : trailById(this.pickedTrail);
    const owned = isSkin ? progress.owns(item.id) : progress.ownsTrail(item.id);
    const worn = isSkin ? progress.skin === item.id : progress.trailFor(this.who) === item.id;
    this.nameEl.textContent = item.name;
    this.blurbEl.textContent = item.blurb;

    this.action.classList.toggle("equip", owned);
    if (worn) {
      this.action.textContent = "WORN";
      this.action.disabled = true;
    } else if (owned) {
      this.action.textContent = isSkin ? "EQUIP" : `EQUIP ON ${this.who === 0 ? "IGNIS" : "VOLTA"}`;
      this.action.disabled = false;
    } else if (progress.coins >= item.price) {
      this.action.textContent = `BUY ◎${item.price}`;
      this.action.disabled = false;
    } else {
      this.action.textContent = `NEED ◎${item.price - progress.coins} MORE`;
      this.action.disabled = true;
    }
  }

  private commit() {
    if (this.tab === "skins") {
      const skin = skinById(this.pickedSkin);
      if (!progress.buySkin(skin.id, skin.price)) return;
    } else {
      const trail = trailById(this.pickedTrail);
      if (!progress.buyTrail(trail.id, trail.price, this.who)) return;
    }
    this.onChange();
    this.render();
  }
}
