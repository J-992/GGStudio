import { Network } from "@poki/netlib";
import { Game, GameState, type NetworkGameState } from "../game/Game";

type Role = "none" | "host" | "guest";
type WireMessage =
  | { t: "input"; lateral: number; jumpHeld: boolean }
  | { t: "start"; state: NetworkGameState }
  | { t: "state"; state: NetworkGameState }
  | { t: "pause" }
  | { t: "restart" };

// A stable development UUID is supported by Netlib. Replace with the assigned Poki
// game ID through VITE_POKI_GAME_ID before the production upload.
const GAME_ID = import.meta.env.VITE_POKI_GAME_ID || "f3bb534d-7c83-4ff3-b51c-a5d57a45ee4c";

export class OnlineSession {
  private network: Network | null = null;
  private role: Role = "none";
  private sendTimer = 0;
  private started = false;

  constructor(
    private game: Game,
    private onStatus: (text: string, code?: string) => void,
    private onStarted: () => void,
  ) {}

  host() {
    this.open("host", (network) => {
      void network.create({ public: false, maxPlayers: 2, codeFormat: "short", codeLength: 4 })
        .catch(() => this.onStatus("COULD NOT CREATE ROOM — TRY AGAIN"));
    });
  }

  join(code: string) {
    const clean = code.trim().toUpperCase();
    if (!/^[a-z0-9]{4,8}$/i.test(clean)) {
      this.onStatus("ENTER A VALID ROOM CODE");
      return;
    }
    this.open("guest", (network) => {
      void network.join(clean).catch(() => this.onStatus("ROOM NOT FOUND — CHECK THE CODE"));
    });
  }

  frame(dt: number) {
    if (!this.network || !this.started) return;
    this.sendTimer -= dt;
    if (this.sendTimer > 0) return;
    this.sendTimer = 1 / 20;

    if (this.role === "host") {
      this.send({ t: "state", state: this.game.networkSnapshot() }, "unreliable");
    } else if (this.role === "guest") {
      const input = this.game.readOnlineInput();
      this.send({ t: "input", ...input }, "unreliable");
    }
  }

  close() {
    this.network?.close("player left");
    this.network = null;
    this.role = "none";
    this.started = false;
    this.game.setNetworkRole("local");
    this.game.pauseInterceptor = undefined;
    this.game.restartInterceptor = undefined;
  }

  private open(role: Exclude<Role, "none">, ready: (network: Network) => void) {
    this.close();
    this.role = role;
    this.game.titleInputEnabled = false;
    this.onStatus("CONNECTING TO POKI NETLIB…");

    const network = this.network = new Network(GAME_ID);
    network.on("ready", () => ready(network));
    network.on("lobby", (code) => this.onStatus("ROOM READY — WAITING FOR PLAYER 2", code));
    network.on("connected", () => {
      if (this.role !== "host" || this.started) return;
      this.started = true;
      this.game.setNetworkRole("host");
      this.game.startOnlineRun();
      this.onStarted();
      this.send({ t: "start", state: this.game.networkSnapshot() }, "reliable");
    });
    network.on("message", (_peer, _channel, data) => this.receive(data));
    network.on("disconnected", () => {
      this.game.setRemoteInput(0, false);
      if (this.game.state === GameState.Playing) this.game.pauseFromNetwork();
      this.onStatus("PLAYER 2 DISCONNECTED");
    });
    network.on("failed", () => this.onStatus("CONNECTION FAILED — TRY A NEW ROOM"));
    network.on("signalingerror", () => this.onStatus("NETWORK UNAVAILABLE — TRY AGAIN"));
    network.on("rtcerror", () => this.onStatus("PEER CONNECTION FAILED — TRY AGAIN"));

    if (role === "guest") {
      this.game.pauseInterceptor = () => { this.send({ t: "pause" }, "reliable"); return true; };
      this.game.restartInterceptor = () => { this.send({ t: "restart" }, "reliable"); return true; };
    }
  }

  private receive(data: string | Blob | ArrayBuffer | ArrayBufferView) {
    if (typeof data !== "string") return;
    let msg: WireMessage;
    try { msg = JSON.parse(data) as WireMessage; } catch { return; }

    if (this.role === "host") {
      if (msg.t === "input") this.game.setRemoteInput(msg.lateral, msg.jumpHeld);
      else if (msg.t === "pause") this.game.pauseGame();
      else if (msg.t === "restart") this.game.restartGame();
      return;
    }

    if (this.role === "guest" && msg.t === "start") {
      this.started = true;
      this.game.setNetworkRole("guest");
      this.game.startOnlineRun();
      this.game.applyNetworkSnapshot(msg.state);
      this.onStarted();
    } else if (this.role === "guest" && msg.t === "state") {
      this.game.applyNetworkSnapshot(msg.state);
    }
  }

  private send(msg: WireMessage, channel: "reliable" | "unreliable") {
    if (!this.network || this.network.size === 0) return;
    this.network.broadcast(channel, JSON.stringify(msg));
  }
}
