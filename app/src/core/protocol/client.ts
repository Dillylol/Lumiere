import {
  parseServerMessage,
  robotStreamUrl,
  ROBOT_HOSTS,
  type ClientMessage,
  type GamepadStateMessage,
  type ServerMessage,
} from "./messages";

export type ConnectionStatus = "connecting" | "open" | "closed";

type Listener<T> = (value: T) => void;

/** The WebSocket features the client uses, so tests can supply a fake. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "close" | "error" | "message", listener: (event: { data?: unknown }) => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface StreamClientOptions {
  url: string;
  /** Required by the simulator; the robot needs none. */
  token?: string;
  /** Reconnect after an unexpected close. On by default. */
  reconnect?: boolean;
  pingIntervalMs?: number;
  socketFactory?: SocketFactory;
}

const OPEN = 1;

/**
 * A connection to a robot or simulator stream. It authenticates, keeps the connection alive with pings,
 * and reconnects with backoff. Commands sent while disconnected are dropped rather than queued, so a
 * stale STOP or gamepad state is never delivered late.
 */
export class StreamClient {
  private socket: SocketLike | null = null;
  private status: ConnectionStatus = "closed";
  private closedByUser = false;
  private attempts = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly messageListeners = new Set<Listener<ServerMessage>>();
  private readonly statusListeners = new Set<Listener<ConnectionStatus>>();
  private latencyMs: number | null = null;

  constructor(private readonly options: StreamClientOptions) {}

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  close(): void {
    this.closedByUser = true;
    this.clearTimers();
    this.socket?.close(1000, "Closed by the app");
    this.socket = null;
    this.setStatus("closed");
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  /** Round-trip time of the last ping, in milliseconds, or null before the first reply. */
  get latency(): number | null {
    return this.latencyMs;
  }

  onMessage(listener: Listener<ServerMessage>): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: Listener<ConnectionStatus>): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Sends a message if connected. Returns whether it was sent. */
  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== OPEN || this.status !== "open") return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  stop(): boolean {
    return this.send({ type: "stop" });
  }

  initOpMode(opMode: string): boolean {
    return this.send({ type: "init", opMode });
  }

  start(): boolean {
    return this.send({ type: "start" });
  }

  gamepad(index: 1 | 2, state: GamepadStateMessage): boolean {
    return this.send({ type: "gamepad", index, state });
  }

  place(x: number, y: number, heading: number): boolean {
    return this.send({ type: "place", x, y, heading });
  }

  shutdown(): boolean {
    return this.send({ type: "shutdown" });
  }

  private open() {
    this.clearTimers();
    this.setStatus("connecting");
    const factory = this.options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    let socket: SocketLike;
    try {
      socket = factory(this.options.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      if (this.options.token) socket.send(JSON.stringify({ type: "auth", token: this.options.token }));
      this.attempts = 0;
      this.setStatus("open");
      const interval = this.options.pingIntervalMs ?? 2000;
      this.pingTimer = setInterval(() => {
        if (socket.readyState === OPEN) socket.send(JSON.stringify({ type: "ping", t: Date.now() }));
      }, interval);
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      const message = parseServerMessage(event.data);
      if (!message) return;
      if (message.type === "pong" && typeof message.t === "number") this.latencyMs = Date.now() - message.t;
      this.messageListeners.forEach((listener) => listener(message));
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearTimers();
      this.setStatus("closed");
      if (!this.closedByUser && this.options.reconnect !== false) this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      // A close event follows; reconnection is handled there.
    });
  }

  private scheduleReconnect() {
    this.setStatus("closed");
    if (this.closedByUser || this.options.reconnect === false) return;
    const delay = Math.min(10_000, 500 * 2 ** this.attempts);
    this.attempts++;
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }
}

/**
 * Looks for a Robot Controller on robot Wi-Fi. Resolves with the first host whose stream sends a
 * `hello`, or null when none answers within the timeout.
 */
export function findRobot(timeoutMs = 2500, socketFactory?: SocketFactory): Promise<{ host: string; hello: ServerMessage } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const sockets: SocketLike[] = [];
    const finish = (result: { host: string; hello: ServerMessage } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sockets.forEach((socket) => {
        try {
          socket.close();
        } catch {
          // Already closed.
        }
      });
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const factory = socketFactory ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    for (const host of ROBOT_HOSTS) {
      try {
        const socket = factory(robotStreamUrl(host));
        sockets.push(socket);
        socket.addEventListener("message", (event) => {
          const message = parseServerMessage(event.data);
          if (message?.type === "hello") finish({ host, hello: message });
        });
      } catch {
        // This host is not reachable from here.
      }
    }
  });
}
