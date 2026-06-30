export interface TerminalStreamOptions {
  baseUrl: string;
  terminalId: string;
  authToken?: string;
  webSocketAuthTransport?: TerminalWebSocketAuthTransport;
  afterSeq?: number;
  onData: (data: Uint8Array, frame: TerminalDataFrame) => void;
  onExit?: (code: number | null) => void;
  onReplayGap?: (frame: TerminalReplayGapFrame) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
}

export type AgentLoginTerminalStreamOptions = TerminalStreamOptions;
export type TerminalWebSocketAuthTransport = "query" | "protocol";

export const TERMINAL_WEBSOCKET_BEARER_PROTOCOL = "proliferate-gateway-bearer";

export interface TerminalDataFrame {
  type: "data";
  seq: number;
  terminalId: string;
  dataBase64: string;
  stream?: "stdout" | "stderr";
  commandRunId?: string;
}

export interface TerminalExitFrame {
  type: "exit";
  seq: number;
  terminalId: string;
  code?: number | null;
}

export interface TerminalReplayGapFrame {
  type: "replay_gap";
  terminalId: string;
  requestedAfterSeq: number;
  floorSeq: number;
}

type TerminalOutputFrame = TerminalDataFrame | TerminalExitFrame | TerminalReplayGapFrame;

export interface TerminalStreamHandle {
  send: (data: string | Uint8Array) => void;
  sendResize: (cols: number, rows: number) => void;
  close: () => void;
}

export function connectTerminal(options: TerminalStreamOptions): TerminalStreamHandle {
  return connectTerminalStream(
    options,
    `/v1/terminals/${encodeURIComponent(options.terminalId)}/ws`,
  );
}

export function connectAgentLoginTerminal(
  options: AgentLoginTerminalStreamOptions,
): TerminalStreamHandle {
  return connectTerminalStream(
    options,
    `/v1/agents/login-terminals/${encodeURIComponent(options.terminalId)}/ws`,
  );
}

function connectTerminalStream(
  options: TerminalStreamOptions,
  pathname: string,
): TerminalStreamHandle {
  const wsUrl = options.baseUrl
    .replace(/^http/, "ws")
    .replace(/\/+$/, "");
  const params = new URLSearchParams();
  const useProtocolAuth = Boolean(
    options.authToken && options.webSocketAuthTransport === "protocol",
  );
  if (options.authToken && !useProtocolAuth) {
    params.set("access_token", options.authToken);
  }
  if (options.afterSeq !== undefined) {
    params.set("after_seq", String(options.afterSeq));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const url = `${wsUrl}${pathname}${suffix}`;

  const protocols = options.authToken && useProtocolAuth
    ? [TERMINAL_WEBSOCKET_BEARER_PROTOCOL, options.authToken]
    : undefined;
  const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
  ws.binaryType = "arraybuffer";
  let lastSeq = options.afterSeq ?? 0;
  let pendingResize: { cols: number; rows: number } | null = null;

  function sendResizeFrame(cols: number, rows: number) {
    ws.send(JSON.stringify({ type: "resize", cols, rows }));
  }

  ws.addEventListener("open", () => {
    if (pendingResize) {
      sendResizeFrame(pendingResize.cols, pendingResize.rows);
      pendingResize = null;
    }
    options.onOpen?.();
  });

  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data) as TerminalOutputFrame;
        if (msg.type === "data") {
          if (msg.seq <= lastSeq) return;
          lastSeq = msg.seq;
          options.onData(decodeBase64(msg.dataBase64), msg);
        } else if (msg.type === "exit") {
          if (msg.seq <= lastSeq) return;
          lastSeq = msg.seq;
          options.onExit?.(msg.code ?? null);
        } else if (msg.type === "replay_gap") {
          options.onReplayGap?.(msg);
        }
      } catch {
        options.onError?.(new Event("invalid-terminal-frame"));
      }
    }
  });

  ws.addEventListener("error", (event) => {
    options.onError?.(event);
  });

  ws.addEventListener("close", (event) => {
    options.onClose?.(event);
  });

  return {
    send(data: string | Uint8Array) {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (typeof data === "string") {
        const encoder = new TextEncoder();
        ws.send(encoder.encode(data));
      } else {
        ws.send(data);
      }
    },
    sendResize(cols: number, rows: number) {
      if (ws.readyState !== WebSocket.OPEN) {
        pendingResize = { cols, rows };
        return;
      }
      sendResizeFrame(cols, rows);
    },
    close() {
      ws.close();
    },
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
