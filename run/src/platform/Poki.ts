interface PokiApi {
  init(): Promise<void>;
  gameLoadingStart(): void;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(): Promise<void>;
  measure?(category: string, value: string, action: string): void;
}

declare global {
  interface Window {
    PokiSDK?: PokiApi;
    __POKI_EVENTS__?: string[];
  }
}

const SDK_URL = "https://game-cdn.poki.com/scripts/v2/poki-sdk.js";
const SDK_TIMEOUT_MS = 5000;

function withTimeout(work: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    work,
    new Promise((resolve) => setTimeout(resolve, SDK_TIMEOUT_MS)),
  ]);
}

class PokiPlatform {
  private sdk: PokiApi | null = null;
  private playing = false;
  private initialized = false;

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    const params = new URLSearchParams(location.search);
    if (params.get("poki") === "mock") this.installMock();

    const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!window.PokiSDK && !local) {
      // A blocked or slow CDN must never stall the boot chain: the game has to reach
      // its title screen with or without the SDK.
      await withTimeout(new Promise<void>((resolve) => {
        const script = document.createElement("script");
        script.src = SDK_URL;
        script.onload = () => resolve();
        script.onerror = () => resolve();
        document.head.append(script);
      }));
    }

    this.sdk = window.PokiSDK ?? null;
    try {
      await withTimeout(Promise.resolve(this.sdk?.init()));
    } catch {
      // Poki requires games to remain playable if SDK initialization is unavailable.
    }
  }

  loadingStart() {
    try { this.sdk?.gameLoadingStart(); } catch { /* keep the game playable */ }
  }

  loadingFinished() {
    try { this.sdk?.gameLoadingFinished(); } catch { /* keep the game playable */ }
  }

  gameplayStart() {
    if (this.playing) return;
    this.playing = true;
    try { this.sdk?.gameplayStart(); } catch { /* keep the game playable */ }
  }

  gameplayStop() {
    if (!this.playing) return;
    this.playing = false;
    try { this.sdk?.gameplayStop(); } catch { /* keep the game playable */ }
  }

  async commercialBreak() {
    try { await this.sdk?.commercialBreak(); } catch { /* an unavailable ad never blocks play */ }
  }

  measureLevel(level: number, action: "start" | "complete" | "fail") {
    try { this.sdk?.measure?.("level", String(level), action); } catch { /* optional analytics */ }
  }

  private installMock() {
    const events: string[] = [];
    window.__POKI_EVENTS__ = events;
    window.PokiSDK = {
      init: async () => { events.push("init"); },
      gameLoadingStart: () => { events.push("loadingStart"); },
      gameLoadingFinished: () => { events.push("loadingFinished"); },
      gameplayStart: () => { events.push("gameplayStart"); },
      gameplayStop: () => { events.push("gameplayStop"); },
      commercialBreak: async () => { events.push("commercialBreak"); },
      measure: (category, value, action) => { events.push(`measure:${category}:${value}:${action}`); },
    };
  }
}

export const poki = new PokiPlatform();
