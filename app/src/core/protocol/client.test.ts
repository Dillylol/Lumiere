import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findRobot, StreamClient, type SocketLike } from "./client";
import { fromBrowserGamepad, parseServerMessage } from "./messages";

class FakeSocket implements SocketLike {
  static created: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  private listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};

  constructor(readonly url: string) {
    FakeSocket.created.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }

  emit(type: string, data?: unknown) {
    (this.listeners[type] ?? []).forEach((listener) => listener({ data }));
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }
}

describe("StreamClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.created = [];
  });
  afterEach(() => vi.useRealTimers());

  const client = (options: Partial<ConstructorParameters<typeof StreamClient>[0]> = {}) =>
    new StreamClient({ url: "ws://127.0.0.1:1/stream", socketFactory: (url) => new FakeSocket(url), ...options });

  it("authenticates first, pings, and delivers parsed messages", () => {
    const stream = client({ token: "a-long-simulator-token" });
    const messages: string[] = [];
    stream.onMessage((message) => messages.push(message.type));
    stream.connect();
    const socket = FakeSocket.created[0];
    expect(stream.send({ type: "start" })).toBe(false);
    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({ type: "auth", token: "a-long-simulator-token" });
    expect(stream.initOpMode("Example Auto")).toBe(true);
    expect(JSON.parse(socket.sent[1])).toEqual({ type: "init", opMode: "Example Auto" });
    vi.advanceTimersByTime(2000);
    expect(JSON.parse(socket.sent[2]).type).toBe("ping");
    socket.emit("message", JSON.stringify({ type: "hello", protocol: 1, source: "simulator", library: "x" }));
    socket.emit("message", "not json");
    socket.emit("message", JSON.stringify({ type: "unknown" }));
    expect(messages).toEqual(["hello"]);
  });

  it("reconnects with backoff after an unexpected close, but not after close()", () => {
    const stream = client();
    const statuses: string[] = [];
    stream.onStatus((status) => statuses.push(status));
    stream.connect();
    FakeSocket.created[0].open();
    FakeSocket.created[0].emit("close");
    expect(stream.connectionStatus).toBe("closed");
    vi.advanceTimersByTime(499);
    expect(FakeSocket.created).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.created).toHaveLength(2);
    FakeSocket.created[1].emit("close");
    vi.advanceTimersByTime(999);
    expect(FakeSocket.created).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.created).toHaveLength(3);
    stream.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.created).toHaveLength(3);
    expect(statuses).toEqual(["connecting", "open", "closed", "connecting", "closed", "connecting", "closed"]);
  });

  it("drops commands while disconnected instead of queuing them", () => {
    const stream = client({ reconnect: false });
    stream.connect();
    const socket = FakeSocket.created[0];
    socket.open();
    socket.emit("close");
    expect(stream.stop()).toBe(false);
    expect(socket.sent).toEqual([]);
  });
});

describe("findRobot", () => {
  it("returns the first host that says hello and closes the others", async () => {
    FakeSocket.created = [];
    const pending = findRobot(1000, (url) => new FakeSocket(url));
    const phone = FakeSocket.created.find((socket) => socket.url.includes("192.168.49.1"))!;
    phone.emit("message", JSON.stringify({ type: "hello", protocol: 1, source: "robot", library: "1.0" }));
    const result = await pending;
    expect(result?.host).toBe("192.168.49.1");
    expect(FakeSocket.created.every((socket) => socket.readyState === 3)).toBe(true);
  });

  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    const pending = findRobot(1000, (url) => new FakeSocket(url));
    vi.advanceTimersByTime(1000);
    expect(await pending).toBeNull();
    vi.useRealTimers();
  });
});

describe("messages", () => {
  it("maps a standard browser gamepad to FTC fields with a dead zone", () => {
    const buttons = Array.from({ length: 18 }, (_, index) => ({ pressed: index === 0 || index === 12, value: index === 7 ? 0.5 : 0, touched: false }));
    const state = fromBrowserGamepad({ axes: [0.02, -1, 0.5, 2], buttons, mapping: "standard" });
    expect(state).toMatchObject({ left_stick_x: 0, left_stick_y: -1, right_stick_x: 0.5, right_stick_y: 1, a: true, dpad_up: true, b: false, right_trigger: 0.5 });
  });

  it("ignores non-string frames", () => {
    expect(parseServerMessage(new ArrayBuffer(2))).toBeNull();
  });
});
