import type { SessionEventEnvelope } from "../types/events.js";

export interface SessionStreamOptions {
  baseUrl: string;
  sessionId: string;
  authToken?: string;
  headers?: HeadersInit;
  afterSeq?: number;
  onEvent: (envelope: SessionEventEnvelope) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export interface SessionStreamHandle {
  close: () => void;
}

export function streamSession(options: SessionStreamOptions): SessionStreamHandle {
  const query = options.afterSeq != null
    ? `?after_seq=${encodeURIComponent(String(options.afterSeq))}`
    : "";
  const url = `${options.baseUrl.replace(/\/+$/, "")}/v1/sessions/${encodeURIComponent(options.sessionId)}/stream${query}`;
  const controller = new AbortController();

  void (async () => {
    try {
      const headers = new Headers({ accept: "text/event-stream" });
      if (options.headers) {
        const requestHeaders = new Headers(options.headers);
        requestHeaders.forEach((value, key) => {
          headers.set(key, value);
        });
      }
      if (options.authToken) {
        headers.set("authorization", `Bearer ${options.authToken}`);
      }

      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Session stream failed with status ${response.status}`);
      }

      options.onOpen?.();

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Session stream response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";
      let dataLines: string[] = [];

      const flushEvent = () => {
        if (dataLines.length === 0) {
          eventType = "";
          return;
        }
        const payload = dataLines.join("\n");
        dataLines = [];
        eventType = "";
        if (!payload) return;
        try {
          const envelope = JSON.parse(payload) as SessionEventEnvelope;
          options.onEvent(envelope);
        } catch {
          // Ignore malformed payloads.
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          flushEvent();
          options.onClose?.();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        let lineBreakIndex = buffer.indexOf("\n");
        while (lineBreakIndex >= 0) {
          let line = buffer.slice(0, lineBreakIndex);
          buffer = buffer.slice(lineBreakIndex + 1);
          if (line.endsWith("\r")) {
            line = line.slice(0, -1);
          }

          if (line === "") {
            flushEvent();
          } else if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          } else if (line.startsWith(":")) {
            // Comment line; ignore.
          }

          lineBreakIndex = buffer.indexOf("\n");
        }

        if (eventType && dataLines.length === 0) {
          // Keep event type until matching data arrives.
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      options.onError?.(
        error instanceof Error ? error : new Error("Session stream failed"),
      );
    }
  })();

  return {
    close: () => controller.abort(),
  };
}
