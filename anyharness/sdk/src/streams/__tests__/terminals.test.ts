import { afterEach, describe, expect, it, vi } from "vitest";

import {
  connectTerminal,
  TERMINAL_WEBSOCKET_BEARER_PROTOCOL,
} from "../terminals.js";

class MockWebSocket {
  static readonly OPEN = 1;

  readonly url: string;
  readonly protocols?: string | string[];
  readonly readyState = MockWebSocket.OPEN;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    mockSockets.push(this);
  }

  addEventListener = vi.fn();
  close = vi.fn();
  send = vi.fn();
}

let originalWebSocket: typeof WebSocket | undefined;
let mockSockets: MockWebSocket[] = [];

describe("connectTerminal", () => {
  afterEach(() => {
    mockSockets = [];
    vi.restoreAllMocks();
    if (originalWebSocket) {
      globalThis.WebSocket = originalWebSocket;
    } else {
      delete (globalThis as typeof globalThis & { WebSocket?: typeof WebSocket }).WebSocket;
    }
  });

  it("uses query auth by default", () => {
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

    connectTerminal({
      baseUrl: "https://runtime.test",
      terminalId: "terminal/1",
      authToken: "runtime-token",
      onData: vi.fn(),
    });

    expect(mockSockets).toHaveLength(1);
    expect(mockSockets[0]!.url).toBe(
      "wss://runtime.test/v1/terminals/terminal%2F1/ws?access_token=runtime-token",
    );
    expect(mockSockets[0]!.protocols).toBeUndefined();
  });

  it("uses WebSocket protocol auth without putting the token in the URL", () => {
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

    connectTerminal({
      baseUrl: "https://api.test/v1/gateway/managed-sandbox/anyharness",
      terminalId: "terminal/1",
      authToken: "product-token",
      webSocketAuthTransport: "protocol",
      afterSeq: 42,
      onData: vi.fn(),
    });

    expect(mockSockets).toHaveLength(1);
    expect(mockSockets[0]!.url).toBe(
      "wss://api.test/v1/gateway/managed-sandbox/anyharness/v1/terminals/terminal%2F1/ws?after_seq=42",
    );
    expect(mockSockets[0]!.url).not.toContain("product-token");
    expect(mockSockets[0]!.protocols).toEqual([
      TERMINAL_WEBSOCKET_BEARER_PROTOCOL,
      "product-token",
    ]);
  });
});
