export interface TerminalStreamOptions {
  baseUrl: string;
  terminalId: string;
  authToken?: string;
  onData: (data: Uint8Array) => void;
  onExit?: (code: number | null) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
}

export interface TerminalStreamHandle {
  send: (data: string | Uint8Array) => void;
  sendResize: (cols: number, rows: number) => void;
  close: () => void;
}

export function connectTerminal(options: TerminalStreamOptions): TerminalStreamHandle {
  const wsUrl = options.baseUrl
    .replace(/^http/, "ws")
    .replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (options.authToken) {
    params.set("access_token", options.authToken);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const url = `${wsUrl}/v1/terminals/${encodeURIComponent(options.terminalId)}/ws${suffix}`;

  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.addEventListener("open", () => {
    options.onOpen?.();
  });

  ws.addEventListener("message", (event) => {
    if (event.data instanceof ArrayBuffer) {
      options.onData(new Uint8Array(event.data));
    } else if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "exit") {
          options.onExit?.(msg.code ?? null);
        }
      } catch {
        // Non-JSON text frame; treat as output
        const encoder = new TextEncoder();
        options.onData(encoder.encode(event.data));
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
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    },
    close() {
      ws.close();
    },
  };
}
