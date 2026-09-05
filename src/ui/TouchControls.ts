import { touchState } from "../input/touchState";

type Key = "l" | "r" | "j" | "g";

export class TouchControls {
  constructor(
    root: HTMLElement | null,
    onPause: () => void,
    onMute: () => void,
  ) {
    if (!root) return;
    root.querySelectorAll<HTMLElement>(".tc-btn").forEach((el) => {
      const player = el.dataset.p === "1" ? 1 : 0;
      const key = (el.dataset.k ?? "j") as Key;
      const set = (v: boolean) => {
        if (player === 0) {
          if (key === "l") touchState.p1l = v;
          else if (key === "r") touchState.p1r = v;
          else if (key === "g") touchState.p1g = v;
          else {
            touchState.p1j = v;
            if (v) touchState.p1jLatch = true;
          }
        } else {
          if (key === "l") touchState.p2l = v;
          else if (key === "r") touchState.p2r = v;
          else if (key === "g") touchState.p2g = v;
          else {
            touchState.p2j = v;
            if (v) touchState.p2jLatch = true;
          }
        }
        el.classList.toggle("active", v);
      };
      el.addEventListener(
        "pointerdown",
        (e) => {
          e.preventDefault();
          set(true);
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* synthetic events may carry invalid ids */
          }
        },
      );
      el.addEventListener("pointerup", () => set(false));
      el.addEventListener("pointercancel", () => set(false));
      el.addEventListener("lostpointercapture", () => set(false));
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    });

    document.getElementById("btn-pause")?.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onPause();
    });
    document.getElementById("btn-mute")?.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onMute();
    });
  }
}
